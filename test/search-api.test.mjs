/**
 * api/search.js — the one part of the site that runs on a server.
 *
 * Driven through its real GET export with a real Request, over a small corpus
 * on disk, so the loading and the HTTP layer are covered and not just the
 * matching (test/transcripts.test.mjs has that).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatCorpus, corpusName } from '../scripts/transcripts-lib.mjs';

let dir;
let GET;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pc20-search-'));
  await writeFile(join(dir, corpusName(35)), formatCorpus([{ seconds: 10, text: 'the pod ping went out' }]));
  await writeFile(
    join(dir, corpusName(203)),
    formatCorpus([
      { seconds: 5, text: 'Podping is <one> word & now' },
      { seconds: 9, text: 'nothing else here' },
    ]),
  );
  await writeFile(
    join(dir, 'index.json'),
    JSON.stringify({
      coverage: { episodes: 2, newest: 203 },
      episodes: {
        35: { d: '2021-05-07', t: 'Early', a: 'https://example.com/PC20-35.mp3' },
        203: { d: '2024-12-06', t: 'Later', a: 'https://example.com/PC20-203.mp3' },
      },
    }),
  );
  process.env.PC20_TRANSCRIPTS_DIR = dir;
  ({ GET } = await import('../api/search.js'));
});

after(() => rm(dir, { recursive: true, force: true }));

const call = async (query) => {
  const response = await GET(new Request(`https://wiki.example/api/search/?${query}`));
  return { response, body: await response.json() };
};

test('a search returns rows, per-episode counts and the facts to label them', async () => {
  const { response, body } = await call('q=podping');
  assert.equal(response.status, 200);
  assert.equal(body.total, 2);
  assert.deepEqual(body.episodes, { 35: 1, 203: 1 });
  assert.deepEqual(
    body.results.map((row) => [row.e, row.t]),
    [
      [203, 5],
      [35, 10],
    ],
  );
  assert.equal(body.facts[203].a, 'https://example.com/PC20-203.mp3');
});

test('facts are sent only for the episodes that matched', async () => {
  const { body } = await call('q=nothing');
  assert.deepEqual(Object.keys(body.facts), ['203']);
});

test('caption text comes back as text, markup and all', async () => {
  // The page inserts it with textContent; the API must not pre-escape it, or a
  // reader sees "&lt;one&gt;".
  const { body } = await call('q=podping&e=203');
  assert.match(body.results[0].x, /<one> word & now/);
});

test('an episode filter narrows the rows', async () => {
  const { body } = await call('q=podping&e=35');
  assert.deepEqual(body.results.map((row) => row.e), [35]);
});

test('`from` returns the rows after the first ones, and the counts stay whole', async () => {
  const { response, body } = await call('q=podping&from=1');
  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((row) => [row.e, row.t]), [[35, 10]]);
  assert.equal(body.total, 2);
  assert.deepEqual(body.episodes, { 35: 1, 203: 1 });
  assert.equal(body.truncated, false);
});

test('a malformed `from` is a 400, not the first page', async () => {
  for (const from of ['-1', 'abc', '1.5']) {
    const { response, body } = await call(`q=podping&from=${from}`);
    assert.equal(response.status, 400, `from=${from}`);
    assert.equal(body.error, 'bad-from');
  }
});

test('a short query is a 400 with a reason', async () => {
  const { response, body } = await call('q=ab');
  assert.equal(response.status, 400);
  assert.equal(body.error, 'too-short');
});

test('a malformed episode is a 400, not a search of everything', async () => {
  const { response, body } = await call('q=podping&e=abc');
  assert.equal(response.status, 400);
  assert.equal(body.error, 'bad-episode');
});

test('answers are cacheable at the CDN', async () => {
  const { response } = await call('q=podping');
  assert.match(response.headers.get('cache-control'), /s-maxage=\d+/);
});
