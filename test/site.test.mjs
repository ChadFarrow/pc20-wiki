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
  assert.ok(pages.has('timeline/'), 'the timeline page exists');
  assert.equal(pages.size, noteCount + 4, 'every note, plus home, queue, graph and timeline');
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

test('the vault keeps its open questions, the site does not publish them', async () => {
  for (const [page, html] of pages) {
    assert.doesNotMatch(html, /Open questions/i, `${page} publishes an open questions section`);
  }

  // Not just the heading: nothing that only the dropped section said may reach
  // the page or the index. Derived from the notes, so it keeps holding as the
  // vault changes.
  const { parseFrontmatter, dropSections, slugify } = await import('../scripts/wiki-lib.mjs');
  const index = JSON.parse(await readFile(join(OUT, 'data', 'search-index.json'), 'utf8'));
  const dir = join(ROOT, 'content', 'notes');

  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.md'))) {
    const { body } = parseFrontmatter(await readFile(join(dir, file), 'utf8'));
    const published = dropSections(body);
    if (published === body) continue;

    // Words the dropped section is alone in using — a word the rest of the note
    // also uses proves nothing either way. Compared on the raw note so a URL in
    // Sources counts as usage.
    const kept = new Set(published.toLowerCase().match(/[a-z]{6,}/g) ?? []);
    const onlyDropped = [...new Set(body.toLowerCase().match(/[a-z]{6,}/g) ?? [])]
      .filter((word) => !kept.has(word));

    const slug = slugify(file.replace(/\.md$/, ''));
    const html = pages.get(`notes/${slug}/`);
    // The note's prose only. A link the section carried still shows up in the
    // sidebar by design, and the mentions below it quote the show, not the note.
    const prose = html.slice(html.indexOf('<article'), html.indexOf('</article>')).split('<section')[0];
    const entry = index.find((note) => note.slug === slug);
    for (const word of onlyDropped) {
      assert.ok(!prose.toLowerCase().includes(word), `${slug} page still says '${word}'`);
      assert.ok(!entry.text.toLowerCase().includes(word), `${slug} index still says '${word}'`);
    }
  }
});

test('a wikilink still counts as a link when it sits in an unpublished section', async () => {
  const { parseFrontmatter, dropSections, parseWikilinks, slugify } = await import('../scripts/wiki-lib.mjs');
  const graph = JSON.parse(await readFile(join(OUT, 'data', 'graph.json'), 'utf8'));
  const dir = join(ROOT, 'content', 'notes');

  // Three notes reach Custody and NIP-46 only from an open question. Dropping the
  // prose is a display decision; the relationship between the two concepts is not.
  let checked = 0;
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.md'))) {
    const { data, body } = parseFrontmatter(await readFile(join(dir, file), 'utf8'));
    const published = dropSections(body);
    if (published === body) continue;

    const from = slugify(file.replace(/\.md$/, ''));
    const kept = new Set([
      ...parseWikilinks(published).map((link) => slugify(link.target)),
      ...parseWikilinks(String(data.related ?? '')).map((link) => slugify(link.target)),
    ]);

    for (const link of parseWikilinks(body)) {
      const to = slugify(link.target);
      if (kept.has(to) || to === from) continue;
      assert.ok(
        graph.edges.some((edge) => edge.from === from && edge.to === to),
        `${from} → ${to} was written in an open question and must survive it`,
      );
      checked += 1;
    }
  }

  assert.ok(checked > 0, 'the guard has something to guard');
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

test('a note the show discussed lists the episodes it came up on', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  const html = pages.get('notes/podping/');
  const section = html.slice(html.indexOf('Heard on the show'));

  // Derived from the data rather than pinned to today's episode numbers — the
  // archive grows, and a test naming E118 is a test that gets updated blindly.
  const mentions = doc.mentions.podping;
  const episodes = [...new Set(mentions.map((mention) => mention.e))];
  assert.match(section, new RegExp(`<strong>${mentions.length}</strong> moments`));
  assert.match(section, new RegExp(`across\\s+${episodes.length} episodes`));

  const newest = Math.max(...episodes);
  assert.match(section, new RegExp(`E${newest}\\b`));
  assert.match(section, /mp3s\.nashownotes\.com/);
});

test('a note with both curated and transcript mentions shows both labels', async () => {
  // Derived from the data, not pinned to a slug — a hard-coded slug is exactly
  // what broke two tests in the previous task. Watch for substring collisions
  // when counting classes: mentions__from is fine here, but mentions__more and
  // mentions__moments both start with "mentions__mo", so match the label text
  // that follows the class, not just the class name.
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  const slug = Object.entries(doc.mentions).find(
    ([, list]) => list.some((m) => m.s === 'c') && list.some((m) => m.s === 't'),
  )?.[0];
  assert.ok(slug, 'no note has both a chapter and a transcript mention to test against');

  const html = pages.get(`notes/${slug}/`);
  assert.match(html, /<span class="mentions__from">chapter<\/span>/);
  assert.match(html, /<span class="mentions__from">transcript<\/span>/);
});

test('mentions appear only on notes the sources actually name', () => {
  // Tor used to be the canary for "no mentions at all" — it had zero, because
  // the four curated sources never named it. The transcripts genuinely discuss
  // it (E121 "it's all Tor", E210 "a Tor exit node", …), so that premise is now
  // false and Tor has a section. What is still true, and what this threshold is
  // actually for: Tor squash-matches "Podfather story time" and "Art Generator
  // Splits" — false positives — and the five-character threshold in
  // mentions-lib is the only thing keeping those out. Tor is now the canary for
  // that rule instead.
  assert.doesNotMatch(pages.get('notes/tor/'), /Podfather story time/);
  assert.doesNotMatch(pages.get('notes/tor/'), /Art Generator Splits/);
  assert.match(pages.get('notes/podping/'), /Heard on the show/);
});

test('every note the mentions data names was actually built', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  for (const slug of Object.keys(doc.mentions)) {
    assert.ok(pages.has(`notes/${slug}/`), `mentions.json names ${slug}, which has no page`);
  }
});

test('every mention cites an episode the data can name', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  for (const [slug, list] of Object.entries(doc.mentions)) {
    for (const mention of list) {
      assert.ok(doc.episodes[String(mention.e)], `${slug}: E${mention.e} has no episode record`);
      if (mention.t != null) {
        assert.ok(mention.t >= 0 && mention.t <= 20000, `${slug}: E${mention.e} timestamp ${mention.t}`);
      }
    }
  }
});

test('recurring show furniture never reaches a note', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  for (const [slug, list] of Object.entries(doc.mentions)) {
    const episodes = new Map();
    for (const mention of list) {
      const key = mention.x.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!episodes.has(key)) episodes.set(key, new Set());
      episodes.get(key).add(mention.e);
    }
    for (const [key, seen] of episodes) {
      assert.ok(seen.size < 4, `${slug}: "${key}" appears in ${seen.size} episodes — boilerplate`);
    }
  }
});

test('the search index carries what the show called a thing', async () => {
  const index = JSON.parse(await readFile(join(OUT, 'data', 'search-index.json'), 'utf8'));
  const podping = index.find((note) => note.slug === 'podping');

  assert.ok(podping.episodes.length > 0);
  assert.deepEqual(podping.episodes, [...podping.episodes].sort((a, b) => b - a));
  assert.ok(podping.moments.length > 0);
  assert.doesNotMatch(podping.moments, /[<>]/, 'index holds words, not markup');

  // A note nothing was said about still carries the fields, just empty. Tor
  // used to be that note, but the transcripts now genuinely discuss it, so
  // this is derived from data/mentions.json rather than pinned to a slug —
  // pinning to "tor" is exactly how this assertion went stale once already.
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'mentions.json'), 'utf8'));
  const silent = Object.keys(doc.notes).find((slug) => !doc.mentions[slug]);
  if (silent) {
    const note = index.find((n) => n.slug === silent);
    assert.deepEqual(note.episodes, []);
    assert.equal(note.moments, '');
  }
  // If every matchable note now has a citation, that is the feature working,
  // not a gap in this test — nothing to assert against.
});

test('the build still works when the mentions data has not been generated', async () => {
  const out = await mkdtemp(join(tmpdir(), 'pc20-nomentions-'));
  const { stdout, stderr } = await run(
    'node',
    ['scripts/build.mjs', '--out', out, '--mentions', join(out, 'nothing-here.json')],
    { cwd: ROOT },
  );
  await rm(out, { recursive: true, force: true });

  assert.match(stderr + stdout, /mentions\.json is missing/);
  assert.match(stdout, /built \d+ notes/);
});

test('the build says so when the vault has moved on from the mentions data', async () => {
  const { writeFile, mkdir, cp } = await import('node:fs/promises');
  const content = await mkdtemp(join(tmpdir(), 'pc20-stale-'));
  await cp(join(ROOT, 'content'), content, { recursive: true });

  // An alias added in Obsidian, and a note written since the last regenerate.
  // The launchd agent syncs, builds and pushes but never runs update:mentions,
  // so without these warnings both changes publish as "no episodes" in silence.
  const podping = join(content, 'notes', 'Podping.md');
  await writeFile(podping, (await readFile(podping, 'utf8')).replace('---\n\n#', 'aliases: [pinging the pod]\n---\n\n#'));
  await mkdir(join(content, 'notes'), { recursive: true });
  await writeFile(
    join(content, 'notes', 'Widget.md'),
    '---\ntype: concept\nstatus: seed\n---\n\n# Widget\n\nA widget is a placeholder concept that exists only so this test has a note the mentions data has never seen.\n',
  );

  const out = await mkdtemp(join(tmpdir(), 'pc20-stale-out-'));
  const { stdout, stderr } = await run('node', ['scripts/build.mjs', '--content', content, '--out', out], { cwd: ROOT });
  await rm(out, { recursive: true, force: true });
  await rm(content, { recursive: true, force: true });

  const output = stdout + stderr;
  assert.match(output, /the forms matched for 'Podping' have changed/);
  assert.match(output, /'Widget' has never been matched/);
});

test('the timeline page publishes the whole curated history', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'timeline.json'), 'utf8'));
  const html = pages.get('timeline/');

  assert.ok(html, 'the build produces /timeline/');
  assert.equal((html.match(/class="entry"/g) ?? []).length, doc.entries.length);
  assert.match(html, new RegExp(`${doc.entries.length} milestones`));
});

test('every era on the timeline can be jumped to', () => {
  const html = pages.get('timeline/');
  const sections = [...html.matchAll(/<section class="era" id="(era-[a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(sections.length > 1);
  for (const id of sections) assert.match(html, new RegExp(`href="#${id}"`));
});

test('the timeline is reachable from every page', () => {
  for (const [path, html] of pages) {
    assert.match(html, /href="\/timeline\/"/, `${path} has no link to the timeline`);
  }
});

test('every note a timeline entry links to is a page that exists', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'timeline.json'), 'utf8'));
  for (const entry of doc.entries) {
    for (const note of entry.notes) {
      assert.ok(pages.has(`notes/${note.slug}/`), `${entry.id} links to ${note.slug}, which has no page`);
    }
  }
});

test('every timeline entry is dated and placed in an era', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'timeline.json'), 'utf8'));
  const eras = new Set(doc.eras.map((era) => era.id));
  let previous = '';

  for (const entry of doc.entries) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} has no usable date`);
    assert.ok(eras.has(entry.era), `${entry.id} is in era '${entry.era}', which eras.yml does not define`);
    assert.ok(entry.date >= previous, `${entry.id} is out of chronological order`);
    previous = entry.date;
  }
});

test('the build still works when the timeline data has not been generated', async () => {
  const out = await mkdtemp(join(tmpdir(), 'pc20-notimeline-'));
  const { stdout, stderr } = await run(
    'node',
    ['scripts/build.mjs', '--out', out, '--timeline', join(out, 'nothing-here.json')],
    { cwd: ROOT },
  );
  await rm(out, { recursive: true, force: true });

  assert.match(stderr + stdout, /timeline\.json is missing/);
  assert.match(stdout, /built \d+ notes/);
});

test('a milestone with written context shows it on the timeline', async () => {
  const doc = JSON.parse(await readFile(join(ROOT, 'data', 'timeline.json'), 'utf8'));
  const written = doc.entries.filter((entry) => entry.body);
  const html = pages.get('timeline/');

  assert.ok(written.length > 0, 'some milestones have context written');
  assert.equal((html.match(/class="entry__note"/g) ?? []).length, written.length);
  // No entry still carries the seeded placeholder into the published page.
  assert.doesNotMatch(html, /TODO: add context/);
});
