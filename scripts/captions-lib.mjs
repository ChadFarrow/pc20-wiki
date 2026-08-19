/**
 * The show's captions, as a source for episode mentions.
 *
 * The four curated sources stop early — chapter titles at E145, show notes at
 * E100 — and the show is at E266, so the back half of the run cites nothing.
 * Captions are the only source that reaches. They are also the worst one: a
 * chapter title is somebody deciding "this bit is about X", while a caption line
 * is only somebody saying the word. Every rule here exists to tell those apart,
 * and each is measured — see the spec at
 * docs/superpowers/specs/2026-08-18-transcript-mentions-design.md.
 *
 * Pure, like every other *-lib.mjs here: strings and plain objects in, no
 * filesystem, no network.
 */

import { denyForms, squash, norm, SQUASH_MIN, formsFor, isMatchable, denied } from './mentions-lib.mjs';

/** Fewer cues than this and the file is a "Transcript is Processing" stub. */
export const CAPTION_MIN_CUES = 10;

/** `PC20-07-Captions.srt` → 7. Single digits are zero-padded on the server. */
export function captionEpisode(name) {
  const found = /PC20-0*(\d+)-Captions\.srt$/i.exec(String(name ?? ''));
  return found ? Number(found[1]) : null;
}

/**
 * SRT → `[{ seconds, text }]`, one entry per cue.
 *
 * A cue's text is joined onto one line and its whitespace collapsed. The
 * captions wrap mid-sentence, so a form landing on the break — "an ln\naddress
 * attribute" — is invisible to a matcher that reads the lines separately.
 */
export function parseSrt(text) {
  const cues = [];

  for (const block of String(text ?? '').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim());
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at === -1) continue;

    const stamp = /(\d+):(\d{2}):(\d{2})/.exec(lines[at]);
    if (!stamp) continue;

    const body = lines.slice(at + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (!body) continue;

    cues.push({
      seconds: Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3]),
      text: body,
    });
  }

  return cues;
}

/** How long a stretch of talk counts as one passage. */
export const DWELL_WINDOW = 300;

/**
 * The most hits inside any `window` seconds, and where that window opens.
 *
 * This is the measure that tells a segment from a habit, and it is the second
 * one tried. Tightness — the shortest span holding three hits — does not work:
 * cues are about four seconds apart, so three consecutive "boost"s score as
 * tight as anything, and the show says boost constantly.
 *
 * `seconds` must be ascending, which is what parseSrt already gives.
 */
export function densest(seconds, window = DWELL_WINDOW) {
  if (!seconds.length) return { peak: 0, at: null };

  let peak = 0;
  let at = seconds[0];

  for (let i = 0; i < seconds.length; i += 1) {
    let j = i;
    while (j < seconds.length && seconds[j] - seconds[i] <= window) j += 1;
    if (j - i > peak) {
      peak = j - i;
      at = seconds[i];
    }
  }

  return { peak, at };
}

/**
 * Lines that are the show's furniture rather than its subject.
 *
 * The other deny mechanism — denyForms, derived from frequency — is applied to
 * captions too, and it earns its place on the phrases that repeat word for word.
 * It cannot touch the boostagram readout, because every line of that carries a
 * different amount and a different name, so no two are the same text. Same
 * reason STRUCTURAL_BOILERPLATE exists next to it for the written sources.
 *
 * Measured on eight episodes: these caught 10 of 10 readout lines and 0 of 12
 * real ones.
 *
 * The digit rule is the blunt one. It drops ANY line with a run of three or
 * more digits — an episode number, a year, a spec number, a price. Measured on
 * 16,468 real caption lines from eight episodes: 442 lines (2.7%) contain 3+
 * digits. Of those, 94 match a wiki note — that is the rule's cost. But: 51 are
 * an explicit sat amount like "1,001,001 SATs from Dred Scott", 34 are the
 * payment readout in other words like "1234 from SLC", 2 are the spoken intro
 * (which the intro pattern catches anyway), leaving exactly ONE substantive line
 * lost in 16,468 cues. That was judged worth it because the readout is thirty
 * minutes of every episode and the amounts are what make it dense. If the report
 * shows it swallowing facts, narrow it — do not delete it.
 */
export const TRANSCRIPT_BOILERPLATE = [
  /\d{3,}/,
  /podcasting\s*2\.?\s*0\s+for\b[^]{0,40}\bepisode\b/i,
  /\bboost\s?a\s?grams?\b|\bbooster\s+grams?\b|\bboost\s+grams?\b/i,
];

/** Is this cue the show reading out its own plumbing? */
export function isReadout(text) {
  const line = String(text ?? '');
  return TRANSCRIPT_BOILERPLATE.some((pattern) => pattern.test(line));
}

/**
 * Caption files → candidates, in the shape every other source produces.
 *
 * Same `{ source, episode, seconds, text }` as collectChapters, so denyForms and
 * the rest of mentions-lib work on these without knowing where they came from.
 *
 * A stub is returned rather than dropped in silence: "this note is not discussed
 * in E86" and "E86 has no transcript" are different facts, and the report should
 * be able to say which.
 *
 * ORDERING INVARIANT: Task 5's straddle matcher pairs each cue with its successor
 * to find forms split across caption breaks. The pairing walks the candidate array
 * positionally, so candidates must: (1) be sorted ascending by time within each
 * episode, and (2) group by episode contiguously, never interleaved. The loop
 * structure guarantees both — each file's cues arrive in SRT order, and files are
 * processed sequentially — but this contract is load-bearing, not incidental.
 */
export function collectCaptions(files) {
  const candidates = [];
  const stubs = [];

  for (const { name, text } of files) {
    const episode = captionEpisode(name);
    if (!Number.isInteger(episode)) continue;

    const cues = parseSrt(text);
    if (cues.length < CAPTION_MIN_CUES) {
      stubs.push(episode);
      continue;
    }

    for (const cue of cues) {
      candidates.push({ source: 't', episode, seconds: cue.seconds, text: cue.text });
    }
  }

  return { candidates, stubs: stubs.sort((a, b) => a - b) };
}

/** Hits needed inside one window before a passage counts as a passage. */
export const DWELL_FLOOR = 2;

/** How present the note must be against its own average across the run. */
export const LIFT_MIN = 1;

/** Episodes a note may gain from captions. The data is capped, not just the page. */
export const TRANSCRIPT_EPISODE_CAP = 6;

/**
 * matchesForm, with the text prepared once instead of per comparison.
 *
 * matchesForm squashes or normalises its `text` on every call. There are roughly
 * 500,000 cues and 56 matchable notes, so calling it directly means 28 million
 * squashes of a 200-character string. This is the same rule with the work moved:
 * the five-character threshold, the squashed form for long forms, word
 * boundaries for short ones. A test asserts the two agree; if you change
 * matchesForm, that test is what tells you this went stale.
 */
function prepareForms(forms) {
  return forms
    .map((form) => {
      const squashed = squash(form);
      if (!squashed) return null;
      return squashed.length >= SQUASH_MIN
        ? { squashed }
        : { normalised: norm(form) };
    })
    .filter(Boolean);
}

const matchesPrepared = (prepared, cue) =>
  prepared.some((form) =>
    form.squashed ? cue.squashed.includes(form.squashed) : cue.normalised.includes(form.normalised),
  );

/**
 * Captions → mentions, through four gates. Every one is measured; see the spec.
 *
 *   1. gap only   — a note that already has a curated mention in an episode
 *                   does not consult the transcript for it, so the better
 *                   source is never diluted by the worse one
 *   2. furniture  — the readout and the spoken intro by shape, plus the
 *                   frequency-derived list the written sources already use
 *   3. dwell      — DWELL_FLOOR hits inside DWELL_WINDOW, which keeps Tor
 *                   ("I access helipad over Tor") and drops NIP ("nip it in
 *                   the bud")
 *   4. lift, then rank and cap — lift is a filter, not a ranking: a note keeps
 *                   only the episodes where its count is at least LIFT_MIN
 *                   times its own average over the episodes that cleared the
 *                   dwell floor. The max count is always >= the mean, so lift
 *                   can never empty a note, and wherever counts tie across
 *                   episodes lift does nothing at all — it is a floor, not a
 *                   sort. What survives is ranked by the densest passage
 *                   (`peak`, then `count`), ties broken toward the NEWER
 *                   episode, and the top `cap` are kept. The newer-episode
 *                   tiebreak matters more than it looks: DWELL_FLOOR is only
 *                   2, so ties are the ordinary outcome, not the exception,
 *                   and this source exists to reach the episodes after 145
 *                   that the curated sources cannot — the newer ones are the
 *                   ones nothing else cites.
 *
 * One moment per surviving episode: the cue that opens the densest window.
 */
export function buildTranscriptMentions(notes, candidates, curated = {}, options = {}) {
  const {
    floor = DWELL_FLOOR,
    lift: liftMin = LIFT_MIN,
    cap = TRANSCRIPT_EPISODE_CAP,
    window = DWELL_WINDOW,
  } = options;

  const boilerplate = denyForms(candidates);
  const covered = new Map(
    Object.entries(curated).map(([slug, list]) => [slug, new Set(list.map((mention) => mention.e))]),
  );

  const terms = notes.filter(isMatchable).map((note) => ({
    note,
    forms: prepareForms(formsFor(note)),
  }));

  // Every cue prepared once, so the per-note loop below is plain `includes`.
  const prepared = candidates.map((candidate) => ({
    squashed: squash(candidate.text),
    normalised: norm(candidate.text),
    skip: isReadout(candidate.text),
  }));

  /**
   * The two cues either side of a caption break, as one string.
   *
   * The captions break mid-sentence — "…This is episode number" / "seven." — so
   * a form that spans the break is invisible to a matcher reading one cue at a
   * time. Measured on eight episodes: 41 of 815 matches live only across a
   * boundary, and every one is a multi-word form — "Value 4 Value" 18 times,
   * "Podcasting 2.0" nine, "Podcast Index" eight. Single words never straddle.
   *
   * No extra squashing: squash() drops the space, so a pair's squashed text is
   * the two squashed texts joined, and norm() wraps in spaces, so the normalised
   * pair is the two joined on one. Both are O(1) from the neighbours.
   *
   * A readout or boilerplate neighbour is not joined — pasting an amount onto
   * the next line invents text nobody said.
   */
  const joined = (i) => {
    const next = candidates[i + 1];
    if (!next || next.episode !== candidates[i].episode) return null;
    if (prepared[i + 1].skip || boilerplate.has(prepared[i + 1].squashed)) return null;
    return {
      squashed: prepared[i].squashed + prepared[i + 1].squashed,
      normalised: `${prepared[i].normalised.slice(0, -1)}${prepared[i + 1].normalised}`,
    };
  };

  // slug → episode → the cues that hit, in time order
  const found = new Map();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (prepared[i].skip) continue;
    if (boilerplate.has(prepared[i].squashed)) continue;

    const pair = joined(i);

    for (const { note, forms } of terms) {
      if (covered.get(note.slug)?.has(candidate.episode)) continue;

      let hit = matchesPrepared(forms, prepared[i]);
      // The text the hit was actually made on — cue i alone, or the joined
      // pair for a straddle. This governs only the published excerpt, so a
      // straddling citation quotes the words it was matched on rather than
      // half of them.
      let text = candidate.text;
      if (!hit && pair) {
        // Only a form in NEITHER cue alone counts as a straddle. Without that
        // second check, a form sitting wholly inside the next cue is counted
        // once there and once here, and every dwell measure doubles.
        hit = matchesPrepared(forms, pair) && !matchesPrepared(forms, prepared[i + 1]);
        if (hit) text = `${candidate.text} ${candidates[i + 1].text}`;
      }
      if (!hit) continue;

      // Deny reads the neighbour whenever there is one, however the match was
      // made. The two are different questions: "RSS" is short enough to match
      // this cue on a word boundary by itself, while the phrase that should
      // deny it — "RSS Blue", a hosting company — does not exist until the next
      // cue is joined on. Tying the deny context to the straddle branch let it
      // through, which is the failure CLAUDE.md already records shipping once.
      const context = pair ? `${candidate.text} ${candidates[i + 1].text}` : candidate.text;
      if (denied(note.title, context)) continue;

      if (!found.has(note.slug)) found.set(note.slug, new Map());
      const byEpisode = found.get(note.slug);
      if (!byEpisode.has(candidate.episode)) byEpisode.set(candidate.episode, []);
      // Never mutate `candidate` — it is the caller's array. A straddle gets
      // its own object carrying the joined text; a plain hit reuses candidate.
      byEpisode.get(candidate.episode).push(text === candidate.text ? candidate : { ...candidate, text });
    }
  }

  const mentions = {};

  for (const [slug, byEpisode] of found) {
    const passages = [];

    for (const [episode, hits] of byEpisode) {
      // parseSrt truncates to whole seconds, so two hits can tie on `seconds`.
      // A secondary key on text keeps the sort a total order, so which cue is
      // found first at that timestamp cannot depend on the order candidates
      // arrived in.
      hits.sort((a, b) => a.seconds - b.seconds || a.text.localeCompare(b.text));
      const { peak, at } = densest(hits.map((h) => h.seconds), window);
      if (peak < floor) continue;
      passages.push({ episode, peak, at, count: hits.length, hits });
    }

    if (!passages.length) continue;

    // Lift is measured against the episodes the note actually turns up in, which
    // is what makes a Boost episode have to be a Boost episode rather than a
    // Tuesday. It is a filter, not a ranking: max count is always >= mean, so
    // lift can never empty a note, and it decides nothing where counts tie.
    const mean = passages.reduce((sum, p) => sum + p.count, 0) / passages.length;
    const ranked = passages
      .filter((p) => p.count / mean >= liftMin)
      // Ties broken toward the NEWER episode. DWELL_FLOOR is only 2, so ties
      // are the ordinary outcome, and this source exists to reach the
      // episodes after 145 that the curated sources cannot — the newer ones
      // are the ones nothing else cites, so they are what a tie should keep.
      .sort((a, b) => b.peak - a.peak || b.count - a.count || b.episode - a.episode)
      .slice(0, cap);

    if (!ranked.length) continue;

    mentions[slug] = ranked
      .map((passage) => {
        const opener = passage.hits.find((h) => h.seconds === passage.at) ?? passage.hits[0];
        return { e: passage.episode, t: passage.at, s: 't', x: opener.text };
      })
      .sort((a, b) => a.e - b.e);
  }

  return Object.fromEntries(Object.entries(mentions).sort(([a], [b]) => a.localeCompare(b)));
}
