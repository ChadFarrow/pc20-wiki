// test/captions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSrt, captionEpisode, CAPTION_MIN_CUES, densest, DWELL_WINDOW, isReadout, collectCaptions } from '../scripts/captions-lib.mjs';

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

test('isReadout matches the literal first cue of episode 7', () => {
  // This is the real shape of the spoken intro in the captions, not the
  // invented fixtures above. The "Oh," prefix and the run-on ending are what
  // the real line has, so the pattern must match this or a future edit can
  // regress silently.
  assert.ok(isReadout('Oh, podcasting 2.0 for October 16 2020 This is episode number'));
});

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

test('candidates stay grouped by episode, because the straddle matcher walks them in order', () => {
  // Task 5 pairs each cue with its successor to catch a form split across a
  // caption break. That pairing is positional and assumes: (1) within one
  // episode, candidates are in ascending time order, and (2) one episode's
  // candidates never interleave with another's. This must hold regardless of
  // input order, so we test both.
  const files1 = [
    { name: 'PC20-07-Captions.srt', text: full(12) },
    { name: 'PC20-09-Captions.srt', text: full(8) },
  ];
  const files2 = [
    { name: 'PC20-09-Captions.srt', text: full(8) },
    { name: 'PC20-07-Captions.srt', text: full(12) },
  ];

  const { candidates: result1 } = collectCaptions(files1);
  const { candidates: result2 } = collectCaptions(files2);

  // Verify both orders produce identical candidate sequences.
  assert.deepEqual(result1, result2);

  const candidates = result1;
  // Group candidates by episode.
  const byEpisode = new Map();
  for (const c of candidates) {
    if (!byEpisode.has(c.episode)) byEpisode.set(c.episode, []);
    byEpisode.get(c.episode).push(c);
  }

  // Assert contiguity: no episode's candidates can have another episode between them.
  const episodes = Array.from(byEpisode.keys()).sort((a, b) => a - b);
  let lastEpisode = null;
  let lastIndex = -1;
  for (const episode of episodes) {
    const start = candidates.findIndex((c) => c.episode === episode);
    const end = candidates.findLastIndex((c) => c.episode === episode);
    // There should be no gap between end of last episode and start of this one.
    assert.ok(start <= end + 1, `episode ${episode} is not contiguous`);
    if (lastEpisode !== null) {
      const lastEnd = candidates.findLastIndex((c) => c.episode === lastEpisode);
      assert.ok(lastEnd < start, `episode ${episode} interleaves with ${lastEpisode}`);
    }
    lastEpisode = episode;
  }

  // Assert time order within each episode.
  for (const [episode, cues] of byEpisode) {
    for (let i = 1; i < cues.length; i++) {
      assert.ok(
        cues[i - 1].seconds <= cues[i].seconds,
        `episode ${episode} seconds not ascending at index ${i - 1}`
      );
    }
  }
});
