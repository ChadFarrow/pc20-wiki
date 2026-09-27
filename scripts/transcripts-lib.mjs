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

  let i = 0;
  let textAt = 0;
  let squashedAt = 0;
  for (const entry of sorted) {
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
      push(
        cueAt(index.squashedStarts, index.count, at),
        cueAt(index.squashedStarts, index.count, at + sq.length - 1),
      );
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
    for (let at = squashed.indexOf(sq); at !== -1; at = squashed.indexOf(sq, at + sq.length)) {
      ranges.push([origin[at], origin[at + sq.length - 1] + 1]);
    }
  } else {
    for (const match of x.matchAll(wordPattern(query))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }

  return { x, ranges };
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
    ...snippet(index, i, query, sq),
  }));

  return { query, total: cues.length, episodes, results, truncated: scoped.length > from + cap };
}
