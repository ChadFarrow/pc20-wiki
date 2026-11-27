/**
 * The User-Agent every script sends: one name, the package version, the live site.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { APP_URL, USER_AGENT } from '../scripts/user-agent.mjs';

test('USER_AGENT is pc20-wiki/<package.json version> (+live site)', async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(USER_AGENT, `pc20-wiki/${version} (+https://pc20-wiki.vercel.app/)`);
  assert.match(USER_AGENT, /^[\w.-]+\/\d+\.\d+\.\d+ \(\+https:\/\/[^\s)]+\)$/);
});

test('USER_AGENT carries no email and does not pose as a browser', () => {
  assert.doesNotMatch(USER_AGENT, /@|Mozilla|Chrome|Safari/);
  assert.equal(new URL(APP_URL).protocol, 'https:');
});

test('every network script sends USER_AGENT', async () => {
  for (const script of ['fetch-captions.mjs', 'update-apps.mjs']) {
    const source = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    assert.match(source, /from '\.\/user-agent\.mjs'/, script);
    const calls = source.match(/\bfetch\(/g) ?? [];
    const sent = source.match(/'User-Agent': USER_AGENT/g) ?? [];
    assert.ok(calls.length > 0, script);
    assert.equal(sent.length, calls.length, `${script}: every fetch() sends USER_AGENT`);
  }
});
