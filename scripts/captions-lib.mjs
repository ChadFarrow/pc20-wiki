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
