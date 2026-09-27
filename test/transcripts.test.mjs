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
  TRANSCRIPT_MORE_CAP,
  TRANSCRIPT_CONTEXT_MAX,
  transcriptContext,
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

test('a long query does not join the end of one word to the start of another', () => {
  // Each of these squashes to contain "nostr", and none of them says it. They are
  // from the archive: E33, E108, E96, E114, E189.
  const words = buildIndex([
    {
      episode: 1,
      cues: cues(
        [1, 'that app has no structure to pass'],
        [2, 'was that a Diet Dr. Pepper no straight up'],
        [3, 'per minute boosts or Beano street streaming'],
        [4, 'Spotify exec Dawn Ostroff have heard'],
        [5, "There's no string."],
        [6, 'should use nostr. It does not'],
      ),
    },
  ]);
  const result = searchTranscripts(words, 'nostr');
  assert.deepEqual(hit(result), ['1@6']);
  assert.deepEqual(marked(result.results[0]), ['nostr']);
});

test('a long query still finds a split word that carries an ending', () => {
  const words = buildIndex([
    {
      episode: 1,
      cues: cues(
        [1, "we'd get 25,000 pod pings in three seconds"],
        [2, 'the moment you guys start pod pinging'],
        [3, 'if all the podcast indexes'],
        [4, 'the chapter spec says'],
        [5, 'the value split. So this scale'],
      ),
    },
  ]);
  assert.deepEqual(hit(searchTranscripts(words, 'podping')), ['1@1', '1@2']);
  assert.deepEqual(hit(searchTranscripts(words, 'podcast index')), ['1@3']);
  // "chapter s|pec" and "split. S|o" end partway into a word that is not an ending.
  assert.equal(searchTranscripts(words, 'chapters').total, 0);
  assert.equal(searchTranscripts(words, 'splits').total, 0);
});

test('the passage around a result marks by the same rule as the search', () => {
  const words = buildIndex([{ episode: 1, cues: cues([1, 'Dr. Pepper no straight up'], [2, 'should use nostr. It']) }]);
  const passage = transcriptContext(words, 1, 0, 2, 'nostr');
  assert.deepEqual(passage.lines.map((line) => marked(line)), [[], ['nostr']]);
});

test('a long query still matches inside one word, which is how the captions spell Nostr', () => {
  // The captions write Nostr as "nostra", "nostre" or "nostril" 289 times, as "nostr" 59.
  const words = buildIndex([{ episode: 1, cues: cues([1, 'I have been hearing about nostre'], [2, 'your nostril login']) }]);
  assert.deepEqual(hit(searchTranscripts(words, 'nostr')), ['1@1', '1@2']);
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

test('a later page starts where the first one ended', () => {
  const many = buildIndex([
    { episode: 1, cues: Array.from({ length: TRANSCRIPT_RESULT_CAP + 20 }, (_, i) => ({ seconds: i, text: 'boost' })) },
  ]);
  const result = searchTranscripts(many, 'boost', { from: TRANSCRIPT_RESULT_CAP });
  assert.equal(result.results.length, 20);
  assert.equal(result.results[0].t, TRANSCRIPT_RESULT_CAP);
  assert.equal(result.truncated, false);
  // The counts still describe every hit, not the page.
  assert.equal(result.total, TRANSCRIPT_RESULT_CAP + 20);
});

test('a later page is TRANSCRIPT_MORE_CAP rows, and says when more remain', () => {
  const length = TRANSCRIPT_RESULT_CAP + TRANSCRIPT_MORE_CAP + 5;
  const many = buildIndex([
    { episode: 1, cues: Array.from({ length }, (_, i) => ({ seconds: i, text: 'boost' })) },
  ]);
  const second = searchTranscripts(many, 'boost', { from: TRANSCRIPT_RESULT_CAP });
  assert.equal(second.results.length, TRANSCRIPT_MORE_CAP);
  assert.equal(second.truncated, true);
  const third = searchTranscripts(many, 'boost', { from: TRANSCRIPT_RESULT_CAP + TRANSCRIPT_MORE_CAP });
  assert.equal(third.results.length, 5);
  assert.equal(third.truncated, false);
});

test('pages laid end to end hold every row once, in order', () => {
  const whole = hit(searchTranscripts(index, 'podping', { limit: Infinity }));
  const paged = [];
  for (let from = 0; ; ) {
    const page = searchTranscripts(index, 'podping', { from, limit: 1 });
    paged.push(...hit(page));
    from += page.results.length;
    if (!page.truncated) break;
  }
  assert.deepEqual(paged, whole);
  assert.deepEqual(whole, ['203@5', '203@9', '35@10']);
});

test('a page past the end is empty and not truncated', () => {
  const result = searchTranscripts(index, 'podping', { from: 50 });
  assert.deepEqual(result.results, []);
  assert.equal(result.truncated, false);
  assert.equal(result.total, 3);
});

test('a later page inside one episode stays in that episode', () => {
  assert.deepEqual(hit(searchTranscripts(index, 'podping', { episode: 203, from: 1 })), ['203@9']);
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

test('a row carries its cue\'s place in the episode', () => {
  const rows = searchTranscripts(index, 'podping').results.map((row) => `${row.e}@${row.t}#${row.n}`);
  assert.deepEqual(rows, ['203@5#0', '203@9#1', '35@10#0']);
});

test('transcriptContext returns the cues asked for, by place in the episode', () => {
  const context = transcriptContext(index, 35, 1, 3);
  assert.equal(context.count, 4);
  assert.equal(context.from, 1);
  assert.equal(context.to, 3);
  assert.deepEqual(
    context.lines.map(({ n, t, x }) => [n, t, x]),
    [
      [1, 14, 'ping went out to every app'],
      [2, 20, 'that is the whole story'],
    ],
  );
});

test('transcriptContext stays inside its episode', () => {
  // E35 is followed by E120 in the joined index; asking past its end must not reach it.
  const context = transcriptContext(index, 35, -5, 99);
  assert.equal(context.from, 0);
  assert.equal(context.to, 4);
  assert.equal(context.lines.length, 4);
  assert.ok(context.lines.every((line) => !line.x.includes('nothing to see')));
});

test('a match across a caption break is marked in both lines', () => {
  const [pod, ping] = transcriptContext(index, 35, 0, 2, 'podping').lines;
  assert.deepEqual(pod.ranges.map(([f, t]) => pod.x.slice(f, t)), ['pod']);
  assert.deepEqual(ping.ranges.map(([f, t]) => ping.x.slice(f, t)), ['ping']);
});

test('a short query marks whole words in the context, as the search does', () => {
  const [, , , tor] = transcriptContext(index, 35, 0, 4, 'Tor').lines;
  assert.deepEqual(tor.ranges.map(([f, t]) => tor.x.slice(f, t)), ['Tor']);
  const story = transcriptContext(index, 35, 2, 3, 'Tor').lines[0];
  assert.deepEqual(story.ranges, [], '"tor" must not mark "story"');
});

test('no query, or one too short to search, marks nothing', () => {
  for (const query of ['', 'ab']) {
    assert.ok(transcriptContext(index, 35, 0, 4, query).lines.every((line) => line.ranges.length === 0), query);
  }
});

test('an unknown episode has no cues', () => {
  assert.deepEqual(transcriptContext(index, 999, 0, 10), { e: 999, count: 0, from: 0, to: 0, lines: [] });
});

test('transcriptContext caps the span', () => {
  const many = buildIndex([
    { episode: 1, cues: Array.from({ length: TRANSCRIPT_CONTEXT_MAX + 50 }, (_, i) => ({ seconds: i, text: 'boost' })) },
  ]);
  const context = transcriptContext(many, 1, 0, TRANSCRIPT_CONTEXT_MAX + 50);
  assert.equal(context.lines.length, TRANSCRIPT_CONTEXT_MAX);
  assert.equal(context.to, TRANSCRIPT_CONTEXT_MAX);
});
