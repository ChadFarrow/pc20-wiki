# Transcript Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cite episodes from the show's captions where the four curated sources say nothing, without diluting the citations that already exist.

**Architecture:** A new pure module `scripts/captions-lib.mjs` holds every rule; a new `scripts/fetch-captions.mjs` is the only thing that touches the network; `scripts/update-mentions.mjs` gains a fifth source and merges two mention sets; `scripts/render.mjs` caps the two tiers separately. Curated matching in `mentions-lib.mjs` is not changed — the new module imports from it.

**Tech Stack:** Plain ESM Node ≥20, no new dependencies. `node --test` with `node:assert/strict`. No mocking library.

**Spec:** `docs/superpowers/specs/2026-08-18-transcript-mentions-design.md`

## Global Constraints

- **No new runtime dependencies.** The repo has two (`js-yaml`, `marked`) and that is the point.
- **`*-lib.mjs` files are pure** — functions over strings and plain objects, no filesystem, no network. Every rule gets a test naming the case that produced it.
- **Generators never touch the network or the NAS.** Only `fetch-captions.mjs` may.
- **Determinism:** same inputs → byte-identical output. Sort everything explicitly.
- **`npm test` must be run bare** — `node --test test/` fails to resolve modules.
- **`npm run build:strict` must report zero warnings.** It is the deploy gate.
- **Never edit `content/`.** It is a mirror; sync destroys edits.
- **No escape sentinels in string literals.** A real NUL byte once made a script binary to `grep`.
- **Commit after every task.** Do not push; the author pushes.
- Starting thresholds: `DWELL_WINDOW = 300`, `DWELL_FLOOR = 2`, `LIFT_MIN = 1`, `TRANSCRIPT_EPISODE_CAP = 6`, `CAPTION_MIN_CUES = 10`. Task 9 exists to move them.

---

### Task 1: Parse an SRT into cues

**Files:**
- Create: `scripts/captions-lib.mjs`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSrt(text) → [{ seconds: number, text: string }]`; `captionEpisode(name) → number | null`; `CAPTION_MIN_CUES = 10`.

- [ ] **Step 1: Write the failing test**

```js
// test/captions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSrt, captionEpisode, CAPTION_MIN_CUES } from '../scripts/captions-lib.mjs';

const SRT = `1
00:00:01,000 --> 00:00:04,120
Adam Curry: Podcasting 2.0

2
00:19:07,500 --> 00:19:11,000
an ln address attribute. An ln
address attribute would be

3
01:02:03,000 --> 01:02:05,000
   `;

test('parseSrt reads the start time as whole seconds', () => {
  // The third cue in SRT has no words, so it never becomes a cue — see below.
  const cues = parseSrt(SRT);
  assert.deepEqual(cues.map((c) => c.seconds), [1, 1147]);
});

test('parseSrt reads an hour off the clock', () => {
  assert.equal(parseSrt('1\n01:02:03,000 --> 01:02:05,000\nlate in the show')[0].seconds, 3723);
});

test('parseSrt joins a wrapped cue into one line', () => {
  // A cue split across two lines must match as one string, or a form landing on
  // the break is invisible.
  assert.equal(parseSrt(SRT)[1].text, 'an ln address attribute. An ln address attribute would be');
});

test('parseSrt keeps a cue whose text is only whitespace out of the way', () => {
  // The third cue has no words. It must not become an empty candidate that
  // squashes to '' and matches nothing but still costs a comparison.
  assert.equal(parseSrt(SRT).length, 2);
});

test('parseSrt survives a file with no cues at all', () => {
  assert.deepEqual(parseSrt('Transcript is Processing …'), []);
  assert.deepEqual(parseSrt(''), []);
});

test('captionEpisode reads the episode from the file name', () => {
  // Single digits are zero-padded on the server: PC20-7 is a 404, PC20-07 is not.
  assert.equal(captionEpisode('PC20-07-Captions.srt'), 7);
  assert.equal(captionEpisode('PC20-266-Captions.srt'), 266);
  assert.equal(captionEpisode('PC20-100-Chapters.json'), null);
  assert.equal(captionEpisode('notes.txt'), null);
});

test('CAPTION_MIN_CUES is what tells a stub from a transcript', () => {
  // E46 and E86 come back as 60-byte "Transcript is Processing" files.
  assert.equal(typeof CAPTION_MIN_CUES, 'number');
  assert.ok(CAPTION_MIN_CUES > 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — `Cannot find module '../scripts/captions-lib.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/captions-lib.mjs
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS, 7 more tests than before.

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs
git commit -m "Read an SRT into cues"
```

---

### Task 2: The dwell window

**Files:**
- Modify: `scripts/captions-lib.mjs`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DWELL_WINDOW = 300`; `densest(seconds, window?) → { peak: number, at: number | null }`.

- [ ] **Step 1: Write the failing test**

```js
// append to test/captions.test.mjs — add densest, DWELL_WINDOW to the import
test('densest finds the busiest five minutes, not the whole episode', () => {
  // Lightning Address in E120: 11 hits between 19m and 24m. That is a segment.
  const clustered = [1140, 1200, 1320, 1380, 1440];
  assert.deepEqual(densest(clustered), { peak: 5, at: 1140 });
});

test('densest is unimpressed by hits spread across the hour', () => {
  // Boost in E100: said constantly, nowhere in particular.
  const scattered = [600, 1800, 3000, 4200, 5400];
  assert.equal(densest(scattered).peak, 1);
});

test('densest counts a hit on the window boundary as inside it', () => {
  assert.equal(densest([0, 300]).peak, 2);
  assert.equal(densest([0, 301]).peak, 1);
});

test('densest handles one hit and no hits', () => {
  assert.deepEqual(densest([100]), { peak: 1, at: 100 });
  assert.deepEqual(densest([]), { peak: 0, at: null });
});

test('DWELL_WINDOW is five minutes', () => {
  assert.equal(DWELL_WINDOW, 300);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — `densest is not a function`

- [ ] **Step 3: Write the implementation**

```js
// append to scripts/captions-lib.mjs

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs
git commit -m "Measure how long the show dwells on a subject"
```

---

### Task 3: The readout filter (gate 2b)

**Files:**
- Modify: `scripts/captions-lib.mjs`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `TRANSCRIPT_BOILERPLATE` (array of RegExp); `isReadout(text) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
// append to test/captions.test.mjs — add isReadout to the import
test('isReadout drops the boostagram readout, which no frequency count can see', () => {
  // Every episode ends with half an hour of reading boostagrams aloud. It is
  // the densest passage in the episode, so the dwell floor SELECTS for it. And
  // denyForms cannot catch it: every line carries a different amount and a
  // different name, so no two are the same text.
  assert.ok(isReadout('boob boost which did come through 808 CELTA Crayon 7'));
  assert.ok(isReadout('at 100,100 SATs happy 100 show thank you very much.'));
  assert.ok(isReadout("of the future starship boost with 1701 Satoshi's."));
  assert.ok(isReadout('Gene been 1337 elite booster cast Matic and he says'));
  assert.ok(isReadout('Got some booster grams.'));
});

test('isReadout drops the spoken intro, which the written isStructural misses', () => {
  // The written rule is tuned to "Podcasting 2.0 for <date> Episode N: <title>".
  // Spoken, it has a comma and no title, so that rule returns false for it.
  assert.ok(isReadout('Podcasting 2.0 for August 15th, 2025, episode'));
  assert.ok(isReadout('Podcasting 2.0 for February 27th, 2026, episode'));
});

test('isReadout leaves the real lines alone', () => {
  // Measured: 0 of 12 real lines caught. "2.0" is not a run of three digits.
  assert.ok(!isReadout('an ln address attribute. An ln address attribute would be'));
  assert.ok(!isReadout('I access helipad over Tor.'));
  assert.ok(!isReadout('alternate enclosure, none of this stuff.'));
  assert.ok(!isReadout('another hero of podcasting 2.0 The Revolution'));
  assert.ok(!isReadout('You need pod ping.'));
  assert.ok(!isReadout('RSS is a content distribution standard.'));
});

test('isReadout knowingly swallows a line naming a long number', () => {
  // This is the rule's cost, recorded so nobody rediscovers it as a surprise:
  // the TLV record Boostagram.md is written around cannot survive it.
  assert.ok(isReadout('the TLV record is 7629169'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — `isReadout is not a function`

- [ ] **Step 3: Write the implementation**

```js
// append to scripts/captions-lib.mjs

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
 * The digit rule is the blunt one, and it has a real cost: a line naming TLV
 * record 7629169, or a port, goes with it. That was judged worth it because the
 * readout is thirty minutes of every episode and the amounts are what make it
 * dense. If the report shows it swallowing facts, narrow it — do not delete it.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs
git commit -m "Tell the boostagram readout from the show's subject"
```

---

### Task 4: Captions to candidates

**Files:**
- Modify: `scripts/captions-lib.mjs`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Consumes: `parseSrt`, `captionEpisode`, `CAPTION_MIN_CUES` from Task 1.
- Produces: `collectCaptions(files) → { candidates: [{ source: 't', episode, seconds, text }], stubs: number[] }`, where `files` is `[{ name, text }]`. The candidate shape is deliberately identical to `collectChapters`' so `denyForms` works on it unchanged.

- [ ] **Step 1: Write the failing test**

```js
// append to test/captions.test.mjs — add collectCaptions to the import
const cue = (n, s) => `${n}\n00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000 --> 00:00:00,000\nline ${n}`;
const full = (count) => Array.from({ length: count }, (_, i) => cue(i + 1, i * 10)).join('\n\n');

test('collectCaptions produces the same candidate shape the other sources do', () => {
  const { candidates } = collectCaptions([{ name: 'PC20-07-Captions.srt', text: full(12) }]);
  assert.equal(candidates.length, 12);
  assert.deepEqual(candidates[0], { source: 't', episode: 7, seconds: 0, text: 'line 1' });
});

test('collectCaptions reports a processing stub instead of publishing it', () => {
  // A note with no transcript mentions must be tellable from an episode with no
  // transcript. E46 and E86 come back as 60-byte stubs.
  const { candidates, stubs } = collectCaptions([
    { name: 'PC20-46-Captions.srt', text: 'Transcript is Processing …' },
    { name: 'PC20-86-Captions.srt', text: full(3) },
    { name: 'PC20-07-Captions.srt', text: full(12) },
  ]);
  assert.deepEqual(stubs, [46, 86]);
  assert.deepEqual([...new Set(candidates.map((c) => c.episode))], [7]);
});

test('collectCaptions ignores a file that is not a caption file', () => {
  const { candidates, stubs } = collectCaptions([{ name: 'README.md', text: full(12) }]);
  assert.deepEqual(candidates, []);
  assert.deepEqual(stubs, []);
});

test('collectCaptions sorts the stub list, so the output is deterministic', () => {
  const { stubs } = collectCaptions([
    { name: 'PC20-86-Captions.srt', text: '' },
    { name: 'PC20-09-Captions.srt', text: '' },
  ]);
  assert.deepEqual(stubs, [9, 86]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — `collectCaptions is not a function`

- [ ] **Step 3: Write the implementation**

```js
// append to scripts/captions-lib.mjs

/**
 * Caption files → candidates, in the shape every other source produces.
 *
 * Same `{ source, episode, seconds, text }` as collectChapters, so denyForms and
 * the rest of mentions-lib work on these without knowing where they came from.
 *
 * A stub is returned rather than dropped in silence: "this note is not discussed
 * in E86" and "E86 has no transcript" are different facts, and the report should
 * be able to say which.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs
git commit -m "Turn caption files into mention candidates"
```

---

### Task 5: The four gates

**Files:**
- Modify: `scripts/captions-lib.mjs`
- Test: `test/captions.test.mjs`

**Interfaces:**
- Consumes: `densest`, `DWELL_WINDOW`, `isReadout` from Tasks 2–3; from `./mentions-lib.mjs`: `denyForms`, `squash`, `norm`, `SQUASH_MIN`, `formsFor`, `isMatchable`, `denied`, `matchesForm`.
- Produces: `DWELL_FLOOR = 2`; `LIFT_MIN = 1`; `TRANSCRIPT_EPISODE_CAP = 6`; `buildTranscriptMentions(notes, candidates, curated, options) → { [slug]: [{ e, t, s: 't', x }] }`.

**Note on cost.** `matchesForm` calls `squash(text)` or `norm(text)` on every call. Captions are roughly 500,000 cues against 56 notes, so calling it directly would squash 28 million times. This task prepares each cue once and each note's forms once, then matches with plain `includes`. Step 1 includes a test that the prepared path agrees with `matchesForm`, because a divergence there would be a silent scoring bug.

- [ ] **Step 1: Write the failing test**

```js
// append to test/captions.test.mjs — add buildTranscriptMentions, DWELL_FLOOR,
// LIFT_MIN, TRANSCRIPT_EPISODE_CAP to the import, and add:
//   import { formsFor, matchesForm } from '../scripts/mentions-lib.mjs';

const note = (title, slug, data = {}) => ({ title, slug, data: { type: 'concept', ...data } });
const hit = (episode, seconds, text) => ({ source: 't', episode, seconds, text });

test('the prepared matcher agrees with the library, form for form', () => {
  // buildTranscriptMentions prepares each cue once instead of calling
  // matchesForm 28 million times. If the two ever disagree, the transcript tier
  // scores by a different rule than the curated one and nothing says so.
  //
  // Compare against formsFor(note), NOT against the title alone: a note's forms
  // are its title plus its aliases, and EXTRA_ALIASES gives Lightning Address
  // `lnaddress`, which is the only reason "an ln address attribute" matches at
  // all. Comparing to the bare title would test a rule neither path uses.
  const titles = ['Tor', 'NIP', 'Boost', 'Podping', 'Lightning Address', 'RSS'];
  const lines = [
    'I access helipad over Tor.',
    'You got to nip it in the bud.',
    'Podfather story time',
    'when y\'all put in pod ping all of a sudden',
    'an ln address attribute',
    'RSS is a content distribution standard',
    'Weathering the storm',
  ];
  for (const title of titles) {
    const one = note(title, title.toLowerCase());
    for (const line of lines) {
      const viaLib = formsFor(one).some((form) => matchesForm(form, line));
      const mentions = buildTranscriptMentions([one], [hit(1, 0, line)], {}, { floor: 1 });
      assert.equal(Boolean(mentions[title.toLowerCase()]), viaLib, `${title} vs ${line}`);
    }
  }
});

test('gate 1: a transcript never competes with a curated mention', () => {
  const notes = [note('Podping', 'podping')];
  const candidates = [hit(200, 100, 'podping is great'), hit(200, 140, 'podping again')];
  const curated = { podping: [{ e: 200, s: 'c', x: 'Podping' }] };
  assert.deepEqual(buildTranscriptMentions(notes, candidates, curated), {});
});

test('gate 3: two hits in five minutes survive, one does not', () => {
  // Tor, E251: real hits inside a minute, and Tor has no mentions at all today.
  // NIP, E120: one hit, "nip it in the bud" — the false positive SQUASH_MIN
  // exists for, which a dwell floor catches where a length rule cannot.
  const notes = [note('Tor', 'tor'), note('NIP', 'nip')];
  const candidates = [
    hit(251, 4140, 'I access helipad over Tor.'),
    hit(251, 4150, 'my vault warden server right over Tor,'),
    hit(120, 60, 'like nip the inside of my lip'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  // One moment per episode, not one per hit — the two Tor hits are one passage.
  assert.equal(out.tor.length, 1);
  assert.equal(out.tor[0].e, 251);
  assert.equal(out.tor[0].t, 4140, 'the moment is where the densest window opens');
  assert.ok(!out.nip, 'a single passing mention is not a moment');
});

test('gate 3: hits further apart than the window do not add up', () => {
  const notes = [note('Tor', 'tor')];
  const candidates = [hit(251, 0, 'over Tor'), hit(251, 4000, 'over Tor')];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('gate 2: the readout is dropped before anything is counted', () => {
  const notes = [note('Sats', 'sats')];
  const candidates = [
    hit(100, 5000, 'at 100,100 SATs happy 100 show thank you very much.'),
    hit(100, 5010, 'and 1000 SATs from Ben'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('gate 4: a note keeps only its densest episodes, up to the cap', () => {
  const notes = [note('Boost', 'boost')];
  const candidates = [];
  // Six episodes, each qualifying, with descending density. The text has to
  // differ per episode: identical text in four or more episodes is what
  // denyForms calls furniture, and it would drop every one of these.
  for (let ep = 1; ep <= 6; ep += 1) {
    for (let i = 0; i < 8 - ep; i += 1) candidates.push(hit(ep, i * 10, `boost ${'a'.repeat(ep)}`));
  }
  const out = buildTranscriptMentions(notes, candidates, {}, { cap: 2 });
  assert.deepEqual([...new Set(out.boost.map((m) => m.e))], [1, 2]);
});

test('one moment per episode: the densest window is what gets linked', () => {
  const notes = [note('Podping', 'podping')];
  const candidates = [
    hit(230, 100, 'podping in passing'),
    hit(230, 2400, 'podping the first of a run'),
    hit(230, 2440, 'podping again'),
    hit(230, 2480, 'podping a third time'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  assert.equal(out.podping.length, 1);
  assert.equal(out.podping[0].t, 2400);
  assert.equal(out.podping[0].x, 'podping the first of a run');
  assert.equal(out.podping[0].s, 't');
});

test('a MOC or an opted-out note is never matched', () => {
  const notes = [note('Nostr MOC', 'nostr-moc', { type: 'moc' }), note('Podping', 'podping', { mentions: false })];
  const candidates = [hit(1, 0, 'nostr moc'), hit(1, 10, 'podping'), hit(1, 20, 'podping')];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}), {});
});

test('the output is sorted, so a rerun is byte-identical', () => {
  const notes = [note('Tor', 'tor'), note('Podping', 'podping')];
  const candidates = [
    hit(251, 20, 'over Tor'), hit(251, 10, 'over Tor'),
    hit(200, 10, 'podping'), hit(200, 20, 'podping'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {});
  assert.deepEqual(Object.keys(out), ['podping', 'tor']);
});

test('a form split across a caption break is found, and counted once', () => {
  // The captions wrap mid-sentence BETWEEN cues, not only inside them:
  //   "…This is episode number" / "seven. Tag your"
  // 41 of 815 matches on the sample live only across a break, all multi-word.
  const notes = [note('Lightning Address', 'lightning-address')];
  const candidates = [
    hit(200, 100, 'he gave me his lightning'),
    hit(200, 104, 'address, which resolves to a node'),
    hit(200, 130, 'the lightning address spec is simple'),
  ];
  const out = buildTranscriptMentions(notes, candidates, {}, { floor: 2 });
  assert.equal(out['lightning-address'].length, 1, 'one moment per episode');
  assert.equal(out['lightning-address'][0].t, 100, 'the straddle opens the densest window');
});

test('a form wholly inside the next cue is not also charged to this one', () => {
  // Without the second check, the cue before every real mention would score a
  // straddle of its own and every dwell measure would double.
  const notes = [note('Podping', 'podping')];
  const candidates = [
    hit(200, 100, 'and then he said'),
    hit(200, 104, 'podping handles it'),
    hit(200, 108, 'which is neat'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}, { floor: 2 }), {});
});

test('cues from different episodes are never joined across the seam', () => {
  const notes = [note('Lightning Address', 'lightning-address')];
  const candidates = [
    hit(200, 3000, 'he gave me his lightning'),
    hit(201, 0, 'address, which resolves to a node'),
  ];
  assert.deepEqual(buildTranscriptMentions(notes, candidates, {}, { floor: 1 }), {});
});

test('the starting thresholds are the ones the spec names', () => {
  assert.equal(DWELL_FLOOR, 2);
  assert.equal(LIFT_MIN, 1);
  assert.equal(TRANSCRIPT_EPISODE_CAP, 6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — `buildTranscriptMentions is not a function`

- [ ] **Step 3: Write the implementation**

```js
// add to the TOP of scripts/captions-lib.mjs, under the file comment:
import { denyForms, squash, norm, SQUASH_MIN, formsFor, isMatchable, denied } from './mentions-lib.mjs';

// append to scripts/captions-lib.mjs

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
 *   1. gap only      — a note that already has a curated mention in an episode
 *                      does not consult the transcript for it, so the better
 *                      source is never diluted by the worse one
 *   2. furniture     — the readout and the spoken intro by shape, plus the
 *                      frequency-derived list the written sources already use
 *   3. dwell         — DWELL_FLOOR hits inside DWELL_WINDOW, which keeps Tor
 *                      ("I access helipad over Tor") and drops NIP ("nip it in
 *                      the bud")
 *   4. lift, and cap — rank by how unusually present the note is in that
 *                      episode against its own average, keep the top `cap`
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
      if (!hit && pair) {
        // Only a form in NEITHER cue alone counts as a straddle. Without that
        // second check, a form sitting wholly inside the next cue is counted
        // once there and once here, and every dwell measure doubles.
        hit = matchesPrepared(forms, pair) && !matchesPrepared(forms, prepared[i + 1]);
      }
      if (!hit) continue;
      if (denied(note.title, candidate.text)) continue;

      if (!found.has(note.slug)) found.set(note.slug, new Map());
      const byEpisode = found.get(note.slug);
      if (!byEpisode.has(candidate.episode)) byEpisode.set(candidate.episode, []);
      byEpisode.get(candidate.episode).push(candidate);
    }
  }

  const mentions = {};

  for (const [slug, byEpisode] of found) {
    const passages = [];

    for (const [episode, hits] of byEpisode) {
      hits.sort((a, b) => a.seconds - b.seconds);
      const { peak, at } = densest(hits.map((h) => h.seconds), window);
      if (peak < floor) continue;
      passages.push({ episode, peak, at, count: hits.length, hits });
    }

    if (!passages.length) continue;

    // Lift is measured against the episodes the note actually turns up in, which
    // is what makes a Boost episode have to be a Boost episode rather than a
    // Tuesday.
    const mean = passages.reduce((sum, p) => sum + p.count, 0) / passages.length;
    const ranked = passages
      .filter((p) => p.count / mean >= liftMin)
      .sort((a, b) => b.peak - a.peak || b.count - a.count || a.episode - b.episode)
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs
git commit -m "Cite a caption only where the show dwells and nothing else does"
```

---

### Task 6: Fetch the captions

**Files:**
- Create: `scripts/fetch-captions.mjs`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Consumes: `captionEpisode`, `parseSrt`, `CAPTION_MIN_CUES` from Tasks 1 and 4.
- Produces: a populated `captions/` directory. No exports; this is a CLI.

This task has no unit test. It is the one file in the repo that touches the network, and the repo has no mocking library — a test would be testing `fetch`. It is verified by running it, which Step 3 does.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/**
 * Fills captions/ from the show's own server, so the generator does not have to.
 *
 *   node scripts/fetch-captions.mjs              # fetch what is missing
 *   node scripts/fetch-captions.mjs --force      # refetch everything
 *   node scripts/fetch-captions.mjs --to 266     # highest episode to try
 *
 * This is the ONLY file here that uses the network, and that is the point:
 * update-mentions.mjs reads files and nothing else, the same contract it has for
 * the other four sources. captions/ is gitignored — about 250 files at ~165 KB
 * is 41 MB, and what gets committed is the derived JSON, as it already is for
 * mentions and the timeline.
 *
 * If the NAS share is mounted, use it and fetch nothing. It is the same data.
 */
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, arg, tilde } from './source-lib.mjs';
import { captionEpisode, parseSrt, CAPTION_MIN_CUES } from './captions-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(arg('out') ?? process.env.PC20_CAPTIONS ?? join(ROOT, 'captions'));
const NAS = '/Volumes/pc20-archive';
const HOST = 'https://mp3s.nashownotes.com';
const LAST = Number(arg('to') ?? 266);

/** PC20-7 is a 404 and PC20-07 is not; three digits go plain. */
const name = (episode) => `PC20-${episode < 10 ? `0${episode}` : episode}-Captions.srt`;

async function fromNas() {
  try {
    const files = (await readdir(NAS)).filter((file) => captionEpisode(file) !== null);
    if (!files.length) return 0;
    let copied = 0;
    for (const file of files) {
      const target = join(OUT, file);
      if (!flag('force') && (await stat(target).catch(() => null))) continue;
      await writeFile(target, await readFile(join(NAS, file)));
      copied += 1;
    }
    console.log(`copied ${copied} file(s) from ${NAS}`);
    return files.length;
  } catch {
    return 0;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`writing to ${tilde(OUT)}\n`);

  if (await fromNas()) return report();

  let fetched = 0;
  let missing = 0;
  for (let episode = 1; episode <= LAST; episode += 1) {
    const target = join(OUT, name(episode));
    if (!flag('force') && (await stat(target).catch(() => null))) continue;

    const response = await fetch(`${HOST}/${name(episode)}`);
    if (!response.ok) {
      missing += 1;
      continue;
    }
    await writeFile(target, await response.text());
    fetched += 1;
    if (fetched % 25 === 0) console.log(`  ${fetched} fetched…`);
  }
  console.log(`\nfetched ${fetched}, ${missing} not published`);
  return report();
}

/** What the generator will actually be able to read. */
async function report() {
  const files = (await readdir(OUT)).filter((file) => captionEpisode(file) !== null);
  const stubs = [];
  for (const file of files) {
    if (parseSrt(await readFile(join(OUT, file), 'utf8')).length < CAPTION_MIN_CUES) {
      stubs.push(captionEpisode(file));
    }
  }
  stubs.sort((a, b) => a - b);
  console.log(`${files.length} file(s) in ${tilde(OUT)}, ${files.length - stubs.length} usable`);
  if (stubs.length) console.log(`still processing: ${stubs.join(', ')}`);
}

await main();
```

- [ ] **Step 2: Gitignore the cache and add the command**

In `.gitignore`, under the build-output block, add:

```
# Caption cache — ~41 MB, filled by scripts/fetch-captions.mjs, never committed.
# What gets committed is the derived data/mentions.json, same as everything else.
captions/
```

In `package.json` `"scripts"`, after `"update:timeline"`, add:

```json
"fetch:captions": "node scripts/fetch-captions.mjs"
```

- [ ] **Step 3: Run it and check the result**

Run: `npm run fetch:captions`
Expected: roughly 250 files fetched, a few reported as still processing (E46 and E86 among them), and `git status` clean — `captions/` must not appear.

Run: `git status --porcelain | grep captions` — expected: no output.

- [ ] **Step 4: Confirm it is idempotent**

Run: `npm run fetch:captions`
Expected: `fetched 0`, and the same usable count.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-captions.mjs .gitignore package.json
git commit -m "Fetch the show's captions into a local cache"
```

---

### Task 7: The fifth source

**Files:**
- Modify: `scripts/update-mentions.mjs`
- Test: run the generator; the rules already have unit tests.

**Interfaces:**
- Consumes: `collectCaptions`, `buildTranscriptMentions` from Tasks 4–5.
- Produces: `data/mentions.json` with `s: 't'` entries, a `captions` entry in `sources`, and `coverage.transcripts`.

- [ ] **Step 1: Add the source, the read and the merge**

In the `SOURCES` object, after `clips`, add:

```js
  captions: sourcePath(ROOT, 'captions', 'PC20_CAPTIONS', 'captions'),
```

In `FLAGS`, add `captions: '--captions',`.

In `SOURCE_LABELS`, add `t: 'transcript'`.

Add the imports:

```js
import { collectCaptions, buildTranscriptMentions } from './captions-lib.mjs';
```

Add a reader beside `readChapters`:

```js
/**
 * The caption cache.
 *
 * Read like every other source — from files, never the network. Filling the
 * cache is scripts/fetch-captions.mjs's job, and it is the only thing here that
 * is allowed to reach out.
 */
async function readCaptions(dir) {
  const names = (await readdir(dir)).filter((file) => /-Captions\.srt$/i.test(file)).sort();
  const files = [];
  for (const name of names) files.push({ name, text: await readFile(join(dir, name), 'utf8') });
  return files;
}
```

In `main()`, **immediately after** `const mentions = buildMentions(notes, candidates);` and
**before** the `episodeFacts` block, add the following. The position is not a style
preference: `episodeFacts` is built from the episodes `mentions` cites, so a merge placed
after it would leave every transcript-only episode without a date, a title or an audio URL —
and therefore with no deep link, which is most of the point. The `report()` branch reads
`mentions` too, and Task 9 depends on transcripts appearing in it.

```js
  // Captions are consulted only where the curated sources said nothing, so this
  // has to run after them and be given what they found.
  let transcripts = {};
  let stubs = [];
  try {
    const files = await readCaptions(SOURCES.captions);
    const collected = collectCaptions(files);
    stubs = collected.stubs;
    transcripts = buildTranscriptMentions(notes, collected.candidates, mentions);
    await record('captions', files.length - stubs.length);
    if (stubs.length) console.warn(`  ! still processing, no transcript: ${stubs.join(', ')}`);
  } catch (err) {
    if (fell('captions', err) === null) sources.push({ id: 'captions', missing: true });
  }

  // Merge, curated first inside each note, then by episode.
  for (const [slug, list] of Object.entries(transcripts)) {
    (mentions[slug] ??= []).push(...list);
    mentions[slug].sort((a, b) => a.e - b.e || (a.t ?? Infinity) - (b.t ?? Infinity) || a.s.localeCompare(b.s));
  }
```

- [ ] **Step 2: Give captions their own provenance shape**

`provenance()` reads a git revision, and the cache is not in git. In `main()`, replace the `record('captions', …)` call above with a local record:

```js
    sources.push({
      id: 'captions',
      path: tilde(SOURCES.captions),
      episodes: files.length - stubs.length,
      newest: Math.max(0, ...files.map((file) => captionEpisode(file.name) ?? 0)),
      stubs,
      records: collected.candidates.length,
    });
```

Add `captionEpisode` to the `captions-lib.mjs` import. A stale caption cache should read as stale the same way a stale checkout does — the episode count and the newest episode are what say so.

- [ ] **Step 3: Record the transcript coverage**

In the `coverage` object, add:

```js
      transcripts: Object.values(transcripts).reduce((sum, list) => sum + list.length, 0),
```

- [ ] **Step 4: Run it and read the result**

Run: `node scripts/update-mentions.mjs --dry-run 2>&1 | tail -40`
Expected: a long list of notes gaining mentions, and no note losing one — gate 1 guarantees the second, so **a removal here is a bug, not a surprise.**

Run: `node scripts/update-mentions.mjs`
Run: `node scripts/update-mentions.mjs --dry-run`
Expected: `no change.` — the generator is deterministic.

Run: `npm run build:strict`
Expected: zero warnings.

- [ ] **Step 5: Commit**

```bash
git add scripts/update-mentions.mjs data/mentions.json
git commit -m "Cite the captions where the curated sources stop"
```

---

### Task 8: The page

**Files:**
- Modify: `scripts/render.mjs:259-353`
- Test: `test/render.test.mjs`, `test/site.test.mjs`, `scripts/browser-check.mjs`

**Interfaces:**
- Consumes: mentions carrying `s: 't'` from Task 7.
- Produces: `MENTION_TRANSCRIPT_CAP = 4`; a `transcript` label; two tiers in the rendered section.

- [ ] **Step 1: Write the failing test**

```js
// append to test/render.test.mjs
test('a transcript episode never pushes a curated episode off the page', () => {
  // Transcript-only episodes are by definition the ones the curated sources
  // miss — mostly the newest. Episodes sort newest-first and the page shows 8,
  // so without separate caps the weaker source evicts the better one entirely.
  const episodes = [];
  for (let n = 260; n > 250; n -= 1) {
    episodes.push({ number: n, date: '2026-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 't', text: `transcript ${n}` }] });
  }
  for (let n = 100; n > 90; n -= 1) {
    episodes.push({ number: n, date: '2022-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 'c', text: `chapter ${n}` }] });
  }

  const html = mentionsSection({ total: 20, episodes, coverage: null });
  for (let n = 100; n > 92; n -= 1) assert.ok(html.includes(`chapter ${n}`), `E${n} must survive`);
  assert.ok(html.includes('transcript 260'));
  assert.ok(!html.includes('transcript 256'), 'only MENTION_TRANSCRIPT_CAP of them');
});

test('a transcript moment says where it came from', () => {
  const html = mentionsSection({
    total: 1, coverage: null,
    episodes: [{ number: 251, date: '2026-02-27', title: 'E251', audioUrl: null,
      moments: [{ seconds: 4140, source: 't', text: 'I access helipad over Tor.' }] }],
  });
  assert.ok(html.includes('transcript'));
  assert.ok(html.includes('I access helipad over Tor.'));
});

test('the footer no longer claims the transcripts are excluded', () => {
  const html = mentionsSection({
    total: 1, coverage: null,
    episodes: [{ number: 1, date: null, title: null, audioUrl: null,
      moments: [{ seconds: null, source: 'c', text: 'x' }] }],
  });
  assert.ok(!html.includes('not the show’s transcripts'));
});
```

`mentionsSection` is already exported from `render.mjs:295`, so the import needs no change.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: FAIL — the first case fails on `chapter 100` being absent, because the
shared cap of 8 filled with transcript episodes. That failure IS the bug this
task fixes; check you see that one and not a different one.

- [ ] **Step 3: Split the tiers**

Add the cap beside the two that exist (`render.mjs:259-262`):

```js
export const MENTION_EPISODE_CAP = 8;
export const MENTION_MOMENT_CAP = 3;

/**
 * Transcript episodes are shown under the curated ones and capped separately.
 *
 * Not cosmetic. The transcript tier exists precisely where the curated sources
 * stop, which is the back half of the run — the newest episodes. Episodes sort
 * newest-first, so one shared cap of 8 would fill entirely with transcripts and
 * push every curated episode below the fold. The better source would be evicted
 * by the worse one.
 */
export const MENTION_TRANSCRIPT_CAP = 4;

const MENTION_SOURCES = { c: 'chapter', n: 'show notes', m: 'timeline', k: 'clip note', t: 'transcript' };
```

Change `export function mentionsSection(mentions)` (add `export`), and replace the single `shown`/`rest` calculation with two tiers:

```js
  const isTranscript = (episode) => episode.moments.every((moment) => moment.source === 't');
  const curated = mentions.episodes.filter((episode) => !isTranscript(episode));
  const heard = mentions.episodes.filter(isTranscript);

  const shown = [...curated.slice(0, MENTION_EPISODE_CAP), ...heard.slice(0, MENTION_TRANSCRIPT_CAP)];
  const rest = (curated.length - Math.min(curated.length, MENTION_EPISODE_CAP)) +
    (heard.length - Math.min(heard.length, MENTION_TRANSCRIPT_CAP));
  const oldest = mentions.episodes.at(-1);
```

Replace the source sentence:

```js
  return `<section class="mentions">
  <h2>Heard on the show</h2>
  <p class="mentions__count">
    <strong>${mentions.total}</strong> moment${mentions.total === 1 ? '' : 's'} across
    ${mentions.episodes.length} episode${mentions.episodes.length === 1 ? '' : 's'}.
  </p>
  <ol class="mentions__list">${episodes}</ol>
  ${more}
  <p class="mentions__source">From chapter titles, show notes, the PC 2.0 Timeline and the clip
    notes. Where those say nothing, from the episode transcript — which reaches further but
    only records that a word was said.${scope}</p>
</section>`;
```

And extend the coverage sentence:

```js
  const scope = coverage?.episodes
    ? ` ${coverage.withSources} of ${coverage.episodes} episodes have curated notes` +
      `${coverage.transcripts ? `; ${coverage.transcripts} moment${coverage.transcripts === 1 ? '' : 's'} come from transcripts` : ''}.`
    : '';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: PASS

- [ ] **Step 5: Assert it against the built site and a real browser**

In `test/site.test.mjs`, add a case that finds a note whose built HTML carries both a `chapter` and a `transcript` label, derived from `data/mentions.json` rather than pinned to an episode number. Watch for substring collisions when counting classes — `entry__notes` contains `entry__note`, and the same trap exists here.

In `scripts/browser-check.mjs`, add one check: a note page carrying a transcript moment renders its label and its timestamp link.

Run: `npm run build && npm run check:browser`
Expected: 20/20 checks pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/render.mjs test/render.test.mjs test/site.test.mjs scripts/browser-check.mjs
git commit -m "Show transcript episodes under the curated ones, not instead of them"
```

---

### Task 9: Calibrate, then write down what changed

**Files:**
- Modify: `scripts/captions-lib.mjs` (thresholds only), `CLAUDE.md`, `README.md`, `data/mentions.json`
- Modify: `docs/superpowers/specs/2026-08-18-transcript-mentions-design.md` (record the final values)

This task is the point of the whole plan. The thresholds shipped in Task 5 were set from **eight episodes**. This is where they meet 250. **Do not skip it, and do not treat a clean test run as evidence that the numbers are right — the tests pin the cases already known, and the report is what finds the next one.**

- [ ] **Step 1: Read the report, all of it**

Run: `node scripts/update-mentions.mjs --report > /tmp/mentions-report.txt && wc -l /tmp/mentions-report.txt`
Run: `node scripts/update-mentions.mjs --report --only boost | head -60`
Run: `node scripts/update-mentions.mjs --report --only tor`

Read for four things specifically:

1. **What the 3-digit rule swallowed.** This is the known risk and the reason it is first. Search the cache for real lines it removed: `grep -rhiE "[0-9]{3,}" captions/ | grep -iE "tlv|record|port|nip-" | head -30`. If it is eating facts, narrow the pattern — require the digits to sit near a sat or boost word — rather than deleting the rule, and add a test naming the line that made you change it.
2. **Whether any note is flooded.** A note with 6 transcript episodes that are all the same kind of passing remark means the lift cutoff is too low.
3. **Whether a note that should have gained nothing gained something.** `NIP` is the one to check first; it was the reason `SQUASH_MIN` exists.
4. **Whether `Tor`, `Reverse Proxy` and the other notes with no mentions gained the right ones.** That is the feature working.

- [ ] **Step 2: Move the thresholds, with a test for each move**

Change `DWELL_FLOOR`, `LIFT_MIN` or `TRANSCRIPT_EPISODE_CAP` in `scripts/captions-lib.mjs`, or narrow `TRANSCRIPT_BOILERPLATE`. For every change, add a test in `test/captions.test.mjs` naming the real line from the report that caused it — that is how every other rule in `mentions-lib.mjs` is written, and why they have held.

Run after each change: `node scripts/update-mentions.mjs --report --only <slug>`

- [ ] **Step 3: Regenerate and check the whole thing**

```bash
node scripts/update-mentions.mjs
node scripts/update-mentions.mjs --dry-run     # must say "no change."
npm test
npm run build:strict                           # zero warnings
npm run check:browser                          # 20/20
ls -la data/mentions.json                      # expect 200–350 KB
```

- [ ] **Step 4: Write down what was decided**

In `CLAUDE.md`, in *The matching rules*, add a subsection for the transcript tier: the four gates, the final threshold values, and **the measurement that set each one**. The existing sections are written that way — "`Tor` matched ~80 moments and every one was false" — because the number is the argument, and a later reader who does not have it will lower the threshold.

Add to *Transcripts are deliberately not a source* that they now are, what changed, and what did not: they are still not in git, still fetched by hand, and still out of the search index.

In `README.md`, update the mentions paragraph with the new totals and the two tiers.

In the spec, replace the "Starting values" line with the values that shipped and one sentence on why each moved.

- [ ] **Step 5: Commit**

```bash
git add scripts/captions-lib.mjs test/captions.test.mjs data/mentions.json CLAUDE.md README.md docs/
git commit -m "Calibrate the transcript thresholds against the whole archive"
```

---

## Self-review

**Spec coverage.** Gate 1 → Task 5. Gate 2a (`denyForms`) → Task 5. Gate 2b (structural) → Task 3. Gate 3 (dwell) → Tasks 2 and 5. Gate 4 (lift, cap) → Task 5. Fetching, the NAS preference, gitignore, stub reporting → Task 6. Fifth source, provenance shape, coverage field → Task 7. Two-tier page cap, `transcript` label, two prose lines → Task 8. Calibration and documentation → Task 9. Search index deliberately untouched — no task, which is correct, and Task 9 records it.

**Type consistency.** `collectCaptions` returns `{ candidates, stubs }` in Task 4 and is destructured that way in Tasks 6 and 7. `densest` returns `{ peak, at }` in Task 2 and is read that way in Task 5. `buildTranscriptMentions(notes, candidates, curated, options)` in Task 5 is called with that argument order in Task 7. `captionEpisode` returns `number | null` in Task 1 and is null-checked in Tasks 4, 6 and 7.

**Known gap, deliberately left.** Task 8's `isTranscript` treats an episode as a transcript episode only when *every* moment in it is a transcript. Gate 1 makes mixed episodes impossible today, so the two definitions agree. If gate 1 is ever relaxed, this is the second place that has to change, and the test in Task 8 is what will fail.
