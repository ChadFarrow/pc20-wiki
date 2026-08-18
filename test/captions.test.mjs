// test/captions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSrt, captionEpisode, CAPTION_MIN_CUES, densest, DWELL_WINDOW } from '../scripts/captions-lib.mjs';

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
