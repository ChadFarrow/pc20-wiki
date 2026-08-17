/**
 * The sync script reads a vault the user edits by hand and mirrors it into the
 * repo. The tests that matter most are the ones proving it cannot damage that
 * vault, so they run against a throwaway fixture vault and assert the fixture
 * is untouched afterwards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plan, applyPlan, sync, shouldPublish } from '../scripts/sync-lib.mjs';

async function makeVault() {
  const dir = await mkdtemp(join(tmpdir(), 'pc20-vault-'));
  await mkdir(join(dir, 'notes'), { recursive: true });
  await mkdir(join(dir, 'templates'), { recursive: true });
  await mkdir(join(dir, 'daily'), { recursive: true });
  await mkdir(join(dir, 'attachments'), { recursive: true });
  await mkdir(join(dir, '.obsidian'), { recursive: true });

  await writeFile(join(dir, 'Home.md'), '---\ntype: home\n---\n\n# Home\n');
  await writeFile(join(dir, 'notes', 'Keysend.md'), '---\ntype: concept\n---\n\n# Keysend\n');
  await writeFile(join(dir, 'notes', 'Secret.md'), '---\ntype: concept\npublish: false\n---\n\n# Secret\n');
  await writeFile(join(dir, 'templates', 'Concept.md'), '# {{title}}\n');
  await writeFile(join(dir, 'daily', '2026-08-17.md'), '# Monday\n');
  await writeFile(join(dir, 'attachments', 'diagram.png'), 'PNG');
  await writeFile(join(dir, '.obsidian', 'app.json'), '{}');
  await writeFile(join(dir, '.DS_Store'), 'junk');
  return dir;
}

async function makeContent() {
  return mkdtemp(join(tmpdir(), 'pc20-content-'));
}

/** Every file under a directory, relative and sorted, so trees can be compared. */
async function tree(dir) {
  const out = [];
  async function walk(current, prefix) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(current, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(dir, '');
  return out.sort();
}

/** Path → contents, for asserting a directory is byte-identical to before. */
async function snapshot(dir) {
  const files = await tree(dir);
  const entries = await Promise.all(
    files.map(async (rel) => [rel, await readFile(join(dir, rel), 'utf8')]),
  );
  return Object.fromEntries(entries);
}

test('shouldPublish keeps notes, Home and attachments; drops the rest', () => {
  assert.equal(shouldPublish('notes/Keysend.md'), true);
  assert.equal(shouldPublish('Home.md'), true);
  assert.equal(shouldPublish('attachments/diagram.png'), true);

  assert.equal(shouldPublish('templates/Concept.md'), false);
  assert.equal(shouldPublish('daily/2026-08-17.md'), false);
  assert.equal(shouldPublish('.obsidian/app.json'), false);
  assert.equal(shouldPublish('.DS_Store'), false);
  assert.equal(shouldPublish('notes/.DS_Store'), false);
  assert.equal(shouldPublish('README - Setup.md'), false);
});

test('sync copies only publishable files', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  await sync({ vault, content });

  assert.deepEqual(await tree(content), ['Home.md', 'attachments/diagram.png', 'notes/Keysend.md']);
});

test('sync leaves the vault byte-identical', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  const before = await snapshot(vault);
  await sync({ vault, content });
  assert.deepEqual(await snapshot(vault), before);
});

test('sync mirrors deletions rather than leaving ghost pages', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  await sync({ vault, content });
  assert.ok((await tree(content)).includes('notes/Keysend.md'));

  await rm(join(vault, 'notes', 'Keysend.md'));
  const result = await sync({ vault, content });

  assert.equal((await tree(content)).includes('notes/Keysend.md'), false);
  assert.deepEqual(result.deleted, ['notes/Keysend.md']);
});

test('a note that turns publish: false is removed on the next sync', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  await sync({ vault, content });
  assert.ok((await tree(content)).includes('notes/Keysend.md'));

  await writeFile(
    join(vault, 'notes', 'Keysend.md'),
    '---\ntype: concept\npublish: false\n---\n\n# Keysend\n',
  );
  await sync({ vault, content });

  assert.equal((await tree(content)).includes('notes/Keysend.md'), false);
});

test('sync reports which notes opted out', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  const result = await sync({ vault, content });
  assert.deepEqual(result.unpublished, ['notes/Secret.md']);
});

test('sync only rewrites files whose contents changed', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  await sync({ vault, content });
  const mtimeBefore = (await stat(join(content, 'notes', 'Keysend.md'))).mtimeMs;

  const second = await sync({ vault, content });

  assert.deepEqual(second.written, []);
  assert.equal((await stat(join(content, 'notes', 'Keysend.md'))).mtimeMs, mtimeBefore);
});

test('plan reports drift without touching anything', async (t) => {
  const vault = await makeVault();
  const content = await makeContent();
  t.after(() => Promise.all([rm(vault, { recursive: true }), rm(content, { recursive: true })]));

  const first = await plan({ vault, content });
  assert.equal(first.inSync, false);
  assert.deepEqual(await tree(content), []);

  await applyPlan(first, { content });
  const second = await plan({ vault, content });
  assert.equal(second.inSync, true);
});

test('sync fails loudly when the vault path does not exist', async (t) => {
  const content = await makeContent();
  t.after(() => rm(content, { recursive: true }));

  await assert.rejects(
    () => sync({ vault: join(tmpdir(), 'pc20-no-such-vault'), content }),
    /vault not found/i,
  );
});
