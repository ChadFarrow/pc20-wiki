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
