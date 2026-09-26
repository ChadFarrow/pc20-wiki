// test/transcripts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  corpusName,
  corpusEpisode,
  formatCorpus,
  parseCorpus,
  buildIndex,
  searchTranscripts,
  TRANSCRIPT_QUERY_MIN,
  TRANSCRIPT_QUERY_MAX,
  TRANSCRIPT_RESULT_CAP,
} from '../scripts/transcripts-lib.mjs';

const cues = (...lines) => lines.map(([seconds, text]) => ({ seconds, text }));

const ARCHIVE = [
  {
    episode: 35,
    cues: cues(
      [10, 'so the pod'],
      [14, 'ping went out to every app'],
      [20, 'that is the whole story'],
      [30, 'run it over Tor if you like'],
    ),
  },
  {
    episode: 203,
    cues: cues([5, 'Podping is one word now'], [9, 'and podping.cloud is up'], [40, 'value for value, always']),
  },
  { episode: 120, cues: cues([100, 'nothing to see here'], [104, 'value 4 value in the feed']) },
];

const index = buildIndex(ARCHIVE);
const hit = (result) => result.results.map((row) => `${row.e}@${row.t}`);
const marked = (row) => row.ranges.map(([from, to]) => row.x.slice(from, to));

test('corpusName pads so a directory listing sorts by episode', () => {
  assert.equal(corpusName(7), '007.txt');
  assert.equal(corpusName(272), '272.txt');
  assert.equal(corpusEpisode('007.txt'), 7);
  assert.equal(corpusEpisode('index.json'), null);
});

test('formatCorpus and parseCorpus round-trip', () => {
  const original = cues([0, 'first line'], [3723, 'an hour in, with a tab-free line']);
  assert.deepEqual(parseCorpus(formatCorpus(original)), original);
});

test('formatCorpus is one line per cue, seconds then text', () => {
  assert.equal(formatCorpus(cues([4, 'a b'], [9, 'c'])), '4\ta b\n9\tc\n');
});

test('a query shorter than the minimum is refused, not run', () => {
  const result = searchTranscripts(index, 'ab');
  assert.equal(result.error, 'too-short');
  assert.equal(result.results.length, 0);
  assert.equal(TRANSCRIPT_QUERY_MIN, 3);
});

test('punctuation does not count towards the minimum', () => {
  assert.equal(searchTranscripts(index, 'a.b!').error, 'too-short');
});

test('a long query squashes, so "podping" finds "pod ping"', () => {
  const result = searchTranscripts(index, 'podping');
  assert.deepEqual(hit(result).sort(), ['203@5', '203@9', '35@10'].sort());
});

test('a match straddling a caption break is found and reported at the cue it starts in', () => {
  // "pod" ends cue 10 and "ping" starts cue 14.
  const row = searchTranscripts(index, 'pod ping').results.find((r) => r.e === 35);
  assert.equal(row.t, 10);
  assert.deepEqual(marked(row), ['pod ping']);
});

test('a match never straddles two episodes', () => {
  // The last cue of E35 ends "like" and E120 begins "nothing"; squashed, they touch.
  assert.equal(searchTranscripts(index, 'likenothing').total, 0);
});

test('a short query matches whole words only, so "tor" does not find "story"', () => {
  // The same rule as SQUASH_MIN in mentions-lib.mjs: under five characters,
  // squashing is all false positives.
  const result = searchTranscripts(index, 'tor');
  assert.deepEqual(hit(result), ['35@30']);
});

test('a short query is case-insensitive', () => {
  assert.deepEqual(hit(searchTranscripts(index, 'TOR')), ['35@30']);
});

test('highlight ranges cover the matched text as written, not as squashed', () => {
  const row = searchTranscripts(index, 'podping').results.find((r) => r.t === 9);
  // The previous cue is in the snippet as context, and its match is marked too.
  assert.deepEqual(marked(row), ['Podping', 'podping']);
  const spaced = searchTranscripts(index, 'value for value').results.find((r) => r.e === 203);
  assert.deepEqual(marked(spaced), ['value for value']);
});

test('a row carries its neighbours for context, from the same episode only', () => {
  const row = searchTranscripts(index, 'whole story').results[0];
  assert.equal(row.x, 'ping went out to every app that is the whole story run it over Tor if you like');
  const first = searchTranscripts(index, 'nothing to see').results[0];
  assert.ok(!first.x.includes('like'), 'the previous episode leaked into the snippet');
});

test('results run newest episode first, then by time', () => {
  const result = searchTranscripts(index, 'value');
  assert.deepEqual(hit(result), ['203@40', '120@104']);
});

test('the count per episode covers every hit, even past the cap', () => {
  const result = searchTranscripts(index, 'podping', { limit: 1 });
  assert.equal(result.results.length, 1);
  assert.equal(result.total, 3);
  assert.deepEqual(result.episodes, { 35: 1, 203: 2 });
  assert.equal(result.truncated, true);
});

test('the default cap bounds the rows returned', () => {
  const many = buildIndex([
    { episode: 1, cues: Array.from({ length: TRANSCRIPT_RESULT_CAP + 20 }, (_, i) => ({ seconds: i, text: 'boost' })) },
  ]);
  const result = searchTranscripts(many, 'boost');
  assert.equal(result.results.length, TRANSCRIPT_RESULT_CAP);
  assert.equal(result.total, TRANSCRIPT_RESULT_CAP + 20);
});

test('an episode filter returns only that episode', () => {
  const result = searchTranscripts(index, 'podping', { episode: 203 });
  assert.deepEqual(hit(result), ['203@5', '203@9']);
  // The per-episode counts still describe the whole archive, so the page can
  // offer the other episodes.
  assert.deepEqual(result.episodes, { 35: 1, 203: 2 });
});

test('regex characters in a query are text, not syntax', () => {
  assert.equal(searchTranscripts(index, 'v.a.l*').error, undefined);
  assert.equal(searchTranscripts(index, '(tor)').total, 1);
});

test('an overlong query is cut to the maximum', () => {
  const result = searchTranscripts(index, 'x'.repeat(TRANSCRIPT_QUERY_MAX + 50));
  assert.equal(result.query.length, TRANSCRIPT_QUERY_MAX);
});

test('buildIndex does not depend on input order', () => {
  const shuffled = buildIndex([...ARCHIVE].reverse());
  assert.deepEqual(searchTranscripts(shuffled, 'value'), searchTranscripts(index, 'value'));
});
