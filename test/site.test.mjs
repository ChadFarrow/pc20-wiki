/**
 * End-to-end checks against a real build of the real content.
 *
 * The unit tests prove the pieces behave; these prove the site does. The link
 * check is the one that earns its keep: a wiki whose links rot is worse than no
 * wiki, and "click through every page" is not a thing anyone does twice.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let OUT;
let pages = new Map();
// Counted from the content rather than hard-coded: the wiki is supposed to grow,
// and a test that has to be edited every time a note is written is a test that
// gets edited without being read.
let noteCount = 0;

before(async () => {
  OUT = await mkdtemp(join(tmpdir(), 'pc20-site-'));
  await run('node', ['scripts/build.mjs', '--out', OUT], { cwd: ROOT });

  noteCount = (await readdir(join(ROOT, 'content', 'notes'))).filter((f) => f.endsWith('.md')).length;

  async function collect(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await collect(path, `${prefix}${entry.name}/`);
      else if (entry.name === 'index.html') pages.set(prefix || '/', await readFile(path, 'utf8'));
    }
  }
  await collect(OUT, '');
});

test.after(() => rm(OUT, { recursive: true, force: true }));

function hrefs(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

test('the build produces a page for every note', () => {
  assert.ok(pages.has('/'), 'home page exists');
  assert.ok(pages.has('notes/value-4-value/'), 'Value 4 Value has a page');
  assert.ok(pages.has('queue/'), 'the writing queue exists');
  assert.ok(pages.has('graph/'), 'the graph page exists');
  assert.equal(pages.size, noteCount + 3, 'every note, plus home, queue and graph');
});

test('every internal link lands on a page that exists', () => {
  const broken = [];
  for (const [page, html] of pages) {
    for (const href of hrefs(html)) {
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const path = href.split(/[?#]/)[0].replace(/^\//, '');
      if (path.startsWith('assets/') || path.startsWith('data/') || path === 'sitemap.xml') continue;
      if (!pages.has(path || '/')) broken.push(`${page} -> ${href}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('a note shows what links to it', () => {
  const html = pages.get('notes/value-4-value/');
  const section = html.slice(html.indexOf('Linked from'));
  assert.match(section, /\/notes\/podcasting-2-0\//);
  assert.match(section, /\/notes\/bitcoin-and-lightning-moc\//);
});

test('backlinks are reciprocal — a link out is a link in somewhere else', () => {
  assert.ok(pages.get('notes/keysend/').includes('/notes/value-4-value/'));
  assert.ok(pages.get('notes/value-4-value/').includes('/notes/keysend/'));
});

test('the first sentence of a note becomes its meta description', () => {
  const html = pages.get('notes/value-4-value/');
  assert.match(
    html,
    /<meta name="description" content="Value 4 Value is a model where content is given away freely[^"]*">/,
  );
});

test('note pages are canonical and self-describing for a link unfurl', () => {
  const html = pages.get('notes/keysend/');
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/notes\/keysend\/">/);
  assert.match(html, /<meta property="og:type" content="article">/);
});

test('no note page leaks an unrendered wikilink', () => {
  for (const [page, html] of pages) {
    const body = html.slice(html.indexOf('<main'));
    assert.doesNotMatch(body, /\[\[/, `${page} contains a raw wikilink`);
  }
});

test('the search index carries every note with searchable text', async () => {
  const index = JSON.parse(await readFile(join(OUT, 'data', 'search-index.json'), 'utf8'));
  assert.equal(index.length, noteCount);

  const v4v = index.find((note) => note.slug === 'value-4-value');
  assert.match(v4v.text, /streaming sats/);
  assert.ok(v4v.headings.includes('How it works'));
  assert.doesNotMatch(v4v.text, /\[\[|\*\*|`/, 'index holds words, not markup');
  // A namespace tag is a thing people search for, so it has to survive intact.
  assert.match(v4v.text, /<podcast:value>/);
});

test('the graph data matches the pages that were built', async () => {
  const graph = JSON.parse(await readFile(join(OUT, 'data', 'graph.json'), 'utf8'));
  const slugs = new Set(graph.nodes.map((node) => node.slug));

  assert.equal(graph.nodes.filter((node) => !node.stub).length, noteCount);
  for (const edge of graph.edges) {
    assert.ok(slugs.has(edge.from), `${edge.from} is a known node`);
    assert.ok(slugs.has(edge.to), `${edge.to} is a known node`);
  }
});

test('the sitemap lists only pages that exist', async () => {
  const xml = await readFile(join(OUT, 'sitemap.xml'), 'utf8');
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  assert.ok(paths.includes('/'));
  for (const path of paths) {
    assert.ok(pages.has(path.replace(/^\//, '') || '/'), `${path} exists`);
  }
});

test('a broken note fails the build instead of being published', async () => {
  const content = await mkdtemp(join(tmpdir(), 'pc20-broken-'));
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(content, 'notes'), { recursive: true });
  await writeFile(join(content, 'Home.md'), '---\ntype: home\nstatus: evergreen\n---\n\n# Home\n');
  await writeFile(
    join(content, 'notes', 'Broken.md'),
    '---\ntype: invented\nstatus: seed\n---\n\n# Wrong Title\n',
  );

  const out = await mkdtemp(join(tmpdir(), 'pc20-broken-out-'));
  await assert.rejects(
    () => run('node', ['scripts/build.mjs', '--content', content, '--out', out], { cwd: ROOT }),
    (err) => {
      assert.match(err.stderr, /notes\/Broken\.md: unknown type 'invented'/);
      assert.match(err.stderr, /notes\/Broken\.md: H1 is 'Wrong Title'/);
      assert.match(err.stderr, /build failed/);
      return true;
    },
  );

  await Promise.all([rm(content, { recursive: true }), rm(out, { recursive: true })]);
});

test('an unwritten link becomes a stub page rather than a 404', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const content = await mkdtemp(join(tmpdir(), 'pc20-stub-'));
  await mkdir(join(content, 'notes'), { recursive: true });
  await writeFile(join(content, 'Home.md'), '---\ntype: home\nstatus: evergreen\n---\n\n# Home\n');
  await writeFile(
    join(content, 'notes', 'Value 4 Value.md'),
    '---\ntype: concept\nstatus: growing\n---\n\n# Value 4 Value\n\nA boost carries a [[Boostagram]] with it, which is the message a listener attaches to a payment when they send sats to a show they like.\n',
  );

  const out = await mkdtemp(join(tmpdir(), 'pc20-stub-out-'));
  await run('node', ['scripts/build.mjs', '--content', content, '--out', out], { cwd: ROOT });

  const stub = await readFile(join(out, 'notes', 'boostagram', 'index.html'), 'utf8');
  assert.match(stub, /has not been written yet/);
  assert.match(stub, /\/notes\/value-4-value\//, 'the stub says what links to it');

  const queue = await readFile(join(out, 'queue', 'index.html'), 'utf8');
  assert.match(queue, /Boostagram/);

  await Promise.all([rm(content, { recursive: true }), rm(out, { recursive: true })]);
});

test('a feature note shows how many apps implement it', async () => {
  const apps = JSON.parse(await readFile(join(ROOT, 'data', 'apps.json'), 'utf8'));
  const html = pages.get('notes/cross-app-comments/');
  const section = html.slice(html.indexOf('Who implements it'));

  // The counts come from a directory that changes, so this checks the claim is
  // built correctly rather than checking today's number — which is the mistake
  // the adoption block exists to avoid making in prose.
  const expected = apps.apps.filter((app) => app.elements.includes('Social Interact'));
  assert.match(section, new RegExp(`<strong>${expected.length}</strong> of ${apps.apps.length} apps`));
  assert.match(section, new RegExp(expected[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(section, /podcastindex\.org\/apps/);
  assert.match(section, new RegExp(`as of ${apps.updated}`));
});

test('adoption appears only on notes that name an element', () => {
  assert.doesNotMatch(pages.get('notes/tor/'), /Who implements it/);
  assert.match(pages.get('notes/transcripts/'), /Who implements it/);
});

test('a typo in a note element name fails the build', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const content = await mkdtemp(join(tmpdir(), 'pc20-element-'));
  await mkdir(join(content, 'notes'), { recursive: true });
  await writeFile(join(content, 'Home.md'), '---\ntype: home\nstatus: evergreen\n---\n\n# Home\n');
  await writeFile(
    join(content, 'notes', 'Chapters.md'),
    '---\ntype: spec\nstatus: seed\nelement: Chpaters\n---\n\n# Chapters\n\nChapters divide an episode into titled segments, linked from the feed as an external JSON file rather than baked into the audio itself.\n',
  );

  const out = await mkdtemp(join(tmpdir(), 'pc20-element-out-'));
  await assert.rejects(
    () => run('node', ['scripts/build.mjs', '--content', content, '--out', out], { cwd: ROOT }),
    (err) => {
      assert.match(err.stderr, /element 'Chpaters' is not in the apps directory/);
      return true;
    },
  );

  await Promise.all([rm(content, { recursive: true }), rm(out, { recursive: true })]);
});
