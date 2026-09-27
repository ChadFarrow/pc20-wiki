/**
 * Full-text search over the show's transcripts.
 *
 * The site's own search (public/assets/site.js) ranks sixty notes in the
 * browser from a 107 KB index. The transcripts are 27 MB of text across 482,000
 * cues, which no reader should download to look for one phrase, so this runs in
 * a Vercel function (api/search.js) and sends back only the rows that match.
 *
 * Measured on the full archive: building the index takes about 0.4 s, and a
 * query over it takes 1–30 ms. That is small enough that an inverted index
 * would buy nothing — the same conclusion pc20-clips/app/search.py reached — and
 * a word index would break the one rule that matters most here, below.
 *
 * The matching rules are the ones mentions-lib.mjs already settled on, for the
 * same reasons:
 *
 * - **Five squashed characters or more, match squashed.** The transcriber does
 *   not agree with itself — "pod ping" becomes "podping" around E203 — and
 *   squashing both sides finds both. It preserves order and contiguity, so it
 *   can only add matches.
 * - **Fewer, match whole words.** Squashed, "tor" finds "story" and "generator";
 *   see SQUASH_MIN.
 *
 * And one rule the mentions do not have: **a squashed match that crosses a word
 * break must join whole words** — see holdsAsWords. Without it "nostr" finds "no
 * straight". The mentions get by without it because their dwell and lift gates
 * drop a lone stray hit; a search shows every hit, so it cannot.
 *
 * Pure, like every other *-lib.mjs here: strings and plain objects in, no
 * filesystem, no network.
 */

import { squash, SQUASH_MIN } from './mentions-lib.mjs';

/** Squashed characters a query needs before it runs. "RSS", "LND" and "Tor" are three. */
export const TRANSCRIPT_QUERY_MIN = 3;

/** Raw characters kept from a query. Anything longer is cut, not refused. */
export const TRANSCRIPT_QUERY_MAX = 100;

/**
 * Rows in the first answer. "the" matches 130,000 cues — 26 MB as JSON — so the
 * rest come a page at a time, when a reader asks for them.
 */
export const TRANSCRIPT_RESULT_CAP = 100;

/** Rows returned when the query is narrowed to one episode. */
export const TRANSCRIPT_EPISODE_RESULT_CAP = 500;

/** Rows in each later page — what the page's "Show more" asks for with `from`. */
export const TRANSCRIPT_MORE_CAP = 500;

/** Cues in one transcriptContext answer. The page asks for 25 at most. */
export const TRANSCRIPT_CONTEXT_MAX = 100;

/** 7 → `007.txt`. Padded so a directory listing and a git diff sort by episode. */
export function corpusName(episode) {
  return `${String(episode).padStart(3, '0')}.txt`;
}

export function corpusEpisode(name) {
  const found = /^(\d+)\.txt$/.exec(String(name ?? ''));
  return found ? Number(found[1]) : null;
}

/**
 * Cues → one episode's corpus file: `seconds<TAB>text`, one cue per line.
 *
 * Plain text rather than JSON so git can delta it and a diff reads as the
 * transcript. parseSrt has already collapsed every run of whitespace in a cue to
 * one space, so a cue can hold neither a tab nor a newline.
 */
export function formatCorpus(cues) {
  return cues.map((cue) => `${cue.seconds}\t${cue.text}\n`).join('');
}

export function parseCorpus(text) {
  const cues = [];
  for (const line of String(text ?? '').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    cues.push({ seconds: Number(line.slice(0, tab)), text: line.slice(tab + 1) });
  }
  return cues;
}

/**
 * `[{ episode, cues }]` → the structure a search runs over.
 *
 * Two joined strings, each with a table of where every cue starts in it:
 *
 * - `text`, the cues as written, separated by '\n'. The short-query regex runs
 *   here, and the snippets are cut from it.
 * - `squashed`, the cues squashed, with no separator — so a phrase landing on a
 *   caption break ("the pod" / "ping went out") still matches.
 *
 * One string per form rather than an array of cue strings: the array cost about
 * 370 MB on the full archive, the strings about a third of that.
 */
export function buildIndex(episodes) {
  const sorted = [...episodes].sort((a, b) => a.episode - b.episode);
  const count = sorted.reduce((sum, { cues }) => sum + cues.length, 0);

  const episode = new Uint16Array(count);
  const seconds = new Int32Array(count);
  // One past the end, so a cue's extent is always starts[i] to starts[i + 1].
  const textStarts = new Int32Array(count + 1);
  const squashedStarts = new Int32Array(count + 1);
  const textParts = [];
  const squashedParts = [];

  // Each episode's cues as `[first, end)` — episodes are contiguous, since the list is sorted.
  const bounds = new Map();

  let i = 0;
  let textAt = 0;
  let squashedAt = 0;
  for (const entry of sorted) {
    bounds.set(entry.episode, [i, i + entry.cues.length]);
    for (const cue of entry.cues) {
      episode[i] = entry.episode;
      seconds[i] = cue.seconds;
      textStarts[i] = textAt;
      squashedStarts[i] = squashedAt;
      const sq = squash(cue.text);
      textParts.push(cue.text);
      squashedParts.push(sq);
      textAt += cue.text.length + 1;
      squashedAt += sq.length;
      i++;
    }
  }
  textStarts[count] = textAt;
  squashedStarts[count] = squashedAt;

  return {
    count,
    bounds,
    episode,
    seconds,
    text: textParts.join('\n') + '\n',
    textStarts,
    squashed: squashedParts.join(''),
    squashedStarts,
  };
}

/** The cue an offset falls in: the last start at or before it. */
function cueAt(starts, count, offset) {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const cueText = (index, i) => index.text.slice(index.textStarts[i], index.textStarts[i + 1] - 1);

/** Words of a query, joined so that any run of punctuation or space between them matches. */
function wordPattern(query) {
  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // The `i` flag makes [a-z0-9] case-insensitive too, so the lookarounds hold for "Tor".
  return new RegExp(`(?<![a-z0-9])${words.join('[^a-z0-9]+')}(?![a-z0-9])`, 'gi');
}

/** What a split word may still carry after the match: "pod ping|s", "pod ping|ing", "podcast index|es". */
const ENDINGS = new Set(['s', 'es', 'd', 'ed', 'er', 'ers', 'ing', 'ings']);

/** The per-character form of squash(): true for what squash() keeps. */
const isWordChar = (ch) => ch !== undefined && /[a-z0-9]/.test(ch.toLowerCase());

/**
 * Does a squashed match, at `[from, to)` in the written `text`, join whole words?
 *
 * Squashing exists to rejoin a word the transcriber split — "pod ping". It must
 * not join the end of one word to the start of another: squashed, "no straight",
 * "Beano street" and "Dawn Ostroff" all contain "nostr".
 *
 * - **Inside one written word, a match always holds**, as before. That is how
 *   "nostr" finds "nostra", "nostre" and "nostril": the captions write Nostr
 *   those ways 289 times, and as "nostr" 59.
 * - **Across a space or a caption break**, it holds only if it starts where a word
 *   starts, and ends where a word ends or before an ending from ENDINGS that is
 *   shorter than the part of the word matched. The second half keeps "pod
 *   pings" and drops "no str|ing".
 *
 * Measured in cues on the full archive, before → after: "nostr" 382 → 353, and
 * all 29 lost were false; "there" 29,301 → 24,869 ("the reason", "right here");
 * "splits" 649 → 568 and "chapters" 1,201 → 1,155 ("split. So", "chapter spec").
 * "podping" 802 → 800 ("iPod ping", "pod pin goes"), "podcast index" 2,164 →
 * 2,162, "value for value" 2,132 unchanged. The cost: "Podcasting 2.0" written
 * with a digit straight after it, 12 of 2,674, and one doubtful cue each for
 * "homepod Verse" and "alive items".
 */
function holdsAsWords(text, from, to) {
  if (![...text.slice(from, to)].some((ch) => !isWordChar(ch))) return true;
  if (isWordChar(text[from - 1])) return false;
  let end = to;
  while (isWordChar(text[end])) end++;
  if (end === to) return true;
  let start = to;
  while (isWordChar(text[start - 1])) start--;
  return ENDINGS.has(text.slice(to, end).toLowerCase()) && end - to < to - start;
}

/**
 * holdsAsWords for a match in the index's squashed string: `length` squashed
 * characters, starting `offset` into cue `first` and ending in cue `last`.
 * The written cues are read from index.text, where '\n' separates them, so a
 * caption break is a word break.
 */
function holdsInCues(index, first, last, offset, length) {
  const text = index.text.slice(index.textStarts[first], index.textStarts[last + 1] - 1);
  let seen = 0;
  let from = 0;
  for (let k = 0; k < text.length; k++) {
    if (!isWordChar(text[k])) continue;
    if (seen === offset) from = k;
    if (seen === offset + length - 1) return holdsAsWords(text, from, k + 1);
    seen++;
  }
  return true;
}

/**
 * Every cue a match starts in, ascending, each once.
 *
 * A match that runs from one episode's last cue into the next episode's first
 * is dropped: in the joined string they touch, and on the page it would quote a
 * sentence nobody said.
 */
function matchingCues(index, query, sq) {
  const found = [];
  const push = (from, to) => {
    if (index.episode[from] !== index.episode[to]) return;
    if (found[found.length - 1] !== from) found.push(from);
  };

  if (sq.length >= SQUASH_MIN) {
    for (let at = index.squashed.indexOf(sq); at !== -1; at = index.squashed.indexOf(sq, at + 1)) {
      const first = cueAt(index.squashedStarts, index.count, at);
      const last = cueAt(index.squashedStarts, index.count, at + sq.length - 1);
      if (holdsInCues(index, first, last, at - index.squashedStarts[first], sq.length)) push(first, last);
    }
  } else {
    for (const match of index.text.matchAll(wordPattern(query))) {
      push(
        cueAt(index.textStarts, index.count, match.index),
        cueAt(index.textStarts, index.count, match.index + match[0].length - 1),
      );
    }
  }
  return found;
}

/**
 * A row's text — the cue with its neighbours, from the same episode only — and
 * where the query sits in it, as `[from, to)` offsets into that text.
 *
 * A five-word caption alone is unreadable in a list, and the neighbours also
 * show a match that straddles a break whole. Ranges are found again over the
 * snippet rather than carried from the global search, because squashing shifts
 * every offset and a map over 18 million characters would cost far more than
 * re-matching a few hundred.
 */
function snippet(index, i, query, sq) {
  const parts = [];
  for (const j of [i - 1, i, i + 1]) {
    if (j >= 0 && j < index.count && index.episode[j] === index.episode[i]) parts.push(cueText(index, j));
  }
  const x = parts.join(' ');
  return { x, ranges: rangesIn(x, query, sq) };
}

/** Where the query sits in `x`, as `[from, to)` offsets, by the same rule the search matched with. */
function rangesIn(x, query, sq) {
  const ranges = [];

  if (sq.length >= SQUASH_MIN) {
    // Squash the snippet and remember where each surviving character came from.
    const origin = [];
    let squashed = '';
    for (let k = 0; k < x.length; k++) {
      const ch = x[k].toLowerCase();
      if (/[a-z0-9]/.test(ch)) {
        squashed += ch;
        origin.push(k);
      }
    }
    for (let at = squashed.indexOf(sq); at !== -1; ) {
      const range = [origin[at], origin[at + sq.length - 1] + 1];
      // A match the search would not count is not marked, and the next one may overlap it.
      const holds = holdsAsWords(x, ...range);
      if (holds) ranges.push(range);
      at = squashed.indexOf(sq, holds ? at + sq.length : at + 1);
    }
  } else {
    for (const match of x.matchAll(wordPattern(query))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  return ranges;
}

/**
 * Search the index.
 *
 * Returns `{ query, total, episodes, results, truncated }`, or the same shape
 * with `error` set and no rows. `episodes` counts every matching cue per
 * episode across the whole archive, past the cap and regardless of the episode
 * filter — it is what lets the page say "in 97 episodes" and offer each one.
 *
 * Rows run newest episode first, then by time: the newest end is what no
 * curated source reaches, and the same order the mentions use.
 *
 * `from` skips that many rows of the same order, so pages laid end to end hold
 * every match once. A later page is TRANSCRIPT_MORE_CAP rows; `truncated` says
 * whether any remain after this one.
 */
export function searchTranscripts(index, rawQuery, { episode = null, from = 0, limit = null } = {}) {
  const query = String(rawQuery ?? '').trim().slice(0, TRANSCRIPT_QUERY_MAX);
  const sq = squash(query);
  const empty = { query, total: 0, episodes: {}, results: [], truncated: false };
  if (sq.length < TRANSCRIPT_QUERY_MIN) return { ...empty, error: 'too-short' };

  const cues = matchingCues(index, query, sq);

  const episodes = {};
  for (const i of cues) episodes[index.episode[i]] = (episodes[index.episode[i]] ?? 0) + 1;

  const cap =
    limit ?? (from > 0 ? TRANSCRIPT_MORE_CAP : episode == null ? TRANSCRIPT_RESULT_CAP : TRANSCRIPT_EPISODE_RESULT_CAP);
  const scoped = episode == null ? cues : cues.filter((i) => index.episode[i] === episode);
  scoped.sort((a, b) => index.episode[b] - index.episode[a] || a - b);

  const results = scoped.slice(from, from + cap).map((i) => ({
    e: index.episode[i],
    t: index.seconds[i],
    // The cue's place in its episode — what the page asks transcriptContext for.
    // `t` cannot stand in: two cues can start in the same second.
    n: i - index.bounds.get(index.episode[i])[0],
    ...snippet(index, i, query, sq),
  }));

  return { query, total: cues.length, episodes, results, truncated: scoped.length > from + cap };
}

/**
 * The cues `[from, to)` of one episode, counted from its first cue, with the
 * query marked in them — what a result opens into on the page.
 *
 * `from` and `to` are clamped to the episode, so a request can never read into
 * the next one, and the span is cut to TRANSCRIPT_CONTEXT_MAX.
 *
 * The query is matched over the lines joined with spaces and each range is then
 * split onto the lines it covers, so a match on a caption break ("the pod" /
 * "ping went out") is marked in both halves. A query too short to search marks
 * nothing; it is not an error, because the text is what was asked for.
 */
export function transcriptContext(index, episode, from, to, rawQuery = '') {
  const bounds = index.bounds.get(episode);
  if (!bounds) return { e: episode, count: 0, from: 0, to: 0, lines: [] };

  const [first, end] = bounds;
  const count = end - first;
  const a = Math.min(Math.max(0, from), count);
  const b = Math.min(Math.max(a, to), count, a + TRANSCRIPT_CONTEXT_MAX);

  const texts = [];
  for (let k = a; k < b; k++) texts.push(cueText(index, first + k));

  const query = String(rawQuery ?? '').trim().slice(0, TRANSCRIPT_QUERY_MAX);
  const sq = squash(query);
  const ranges = sq.length >= TRANSCRIPT_QUERY_MIN ? rangesIn(texts.join(' '), query, sq) : [];

  let at = 0;
  const lines = texts.map((x, k) => {
    const start = at;
    at += x.length + 1;
    const own = [];
    for (const [rf, rt] of ranges) {
      const lo = Math.max(rf, start);
      const hi = Math.min(rt, start + x.length);
      if (lo < hi) own.push([lo - start, hi - start]);
    }
    return { n: a + k, t: index.seconds[first + a + k], x, ranges: own };
  });

  return { e: episode, count, from: a, to: b, lines };
}
