/**
 * Writing a generated file without churning it.
 *
 * The launchd agent runs both generators on every publish. Both stamp the day
 * they ran, so without this the stamp would be the only line that moved on most
 * days — a commit every day saying nothing changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeGenerated } from '../scripts/source-lib.mjs';

const out = async () => join(await mkdtemp(join(tmpdir(), 'pc20-generated-')), 'data.json');

test('writeGenerated creates a file that is not there yet', async () => {
  const file = await out();
  assert.equal(await writeGenerated(file, { generated: '2026-08-18', entries: [1] }), true);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { generated: '2026-08-18', entries: [1] });
});

test('writeGenerated leaves the file alone when only the day moved', async () => {
  const file = await out();
  await writeGenerated(file, { generated: '2026-08-18', entries: [1] });
  const before = await readFile(file, 'utf8');

  assert.equal(await writeGenerated(file, { generated: '2026-09-01', entries: [1] }), false);
  assert.equal(await readFile(file, 'utf8'), before, 'the old stamp stands, so git sees nothing');
});

test('writeGenerated writes the new day when the data moved with it', async () => {
  const file = await out();
  await writeGenerated(file, { generated: '2026-08-18', entries: [1] });

  assert.equal(await writeGenerated(file, { generated: '2026-09-01', entries: [1, 2] }), true);
  const doc = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(doc.generated, '2026-09-01', 'generated means the day the data last changed');
  assert.deepEqual(doc.entries, [1, 2]);
});

test('writeGenerated writes over a file it cannot parse', async () => {
  const file = await out();
  await writeFile(file, 'not json at all');
  assert.equal(await writeGenerated(file, { generated: '2026-08-18', entries: [] }), true);
});

test('writeGenerated keeps the one-space indent and the trailing newline', async () => {
  // Both committed files are formatted this way, and a diff of 5,000 reindented
  // lines would bury whatever actually changed.
  const file = await out();
  await writeGenerated(file, { generated: '2026-08-18', entries: [{ id: 'a' }] });
  const text = await readFile(file, 'utf8');
  assert.ok(text.includes('\n "generated"'), 'one space of indent');
  assert.ok(text.endsWith('}\n'));
});
