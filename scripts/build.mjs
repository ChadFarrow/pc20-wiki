#!/usr/bin/env node
/**
 * Compiles content/ into a static wiki under public/.
 *
 *   node scripts/build.mjs
 *   node scripts/build.mjs --strict    # also fails on warnings (used to deploy)
 *
 * Validation is deliberately loud: every problem in every note is reported in
 * one pass and then the build fails. The alternative — a wiki that quietly
 * drops a note with a typo'd frontmatter key — is how a reference rots.
 *
 * Input and output paths can be overridden (--content, --out) so the build can
 * run against fixtures.
 */

import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFrontmatter,
  slugify,
  buildGraph,
  validateNote,
  plainText,
  stripTitle,
  headings,
  adoption,
  knownElements,
} from './wiki-lib.mjs';
import {
  createMarkdown,
  renderNotePage,
  renderStubPage,
  renderHome,
  renderQueue,
  renderGraphPage,
  summarise,
} from './render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : resolve(ROOT, fallback);
}

const CONTENT = arg('content', 'content');
const OUT = arg('out', 'public');
const strict = process.argv.includes('--strict');

// Canonical and OG URLs need an absolute origin. Vercel supplies the deploy
// host; locally the links simply point at the production site.
const BASE_URL = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  'https://pc20-wiki.vercel.app'
).replace(/\/$/, '');

async function writePage(path, html) {
  const target = join(OUT, path, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
}

export async function loadNotes(contentDir) {
  const dir = join(contentDir, 'notes');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();

  const notes = [];
  const problems = [];
  const warnings = [];
  const slugs = new Map();

  for (const file of files) {
    const rel = `notes/${file}`;
    const title = basename(file, '.md');
    const source = await readFile(join(dir, file), 'utf8');

    let parsed;
    try {
      parsed = parseFrontmatter(source);
    } catch (err) {
      problems.push(`${rel}: ${err.message}`);
      continue;
    }

    const slug = slugify(title);
    if (slugs.has(slug)) {
      problems.push(`${rel}: slug '${slug}' already used by ${slugs.get(slug)}`);
      continue;
    }
    slugs.set(slug, rel);

    const check = validateNote({ file: rel, title, data: parsed.data, body: parsed.body });
    problems.push(...check.errors);
    warnings.push(...check.warnings);
    if (check.errors.length) continue;

    notes.push({
      file: rel,
      slug,
      title,
      data: parsed.data,
      body: parsed.body,
      related: parsed.data.related,
      plain: plainText(stripTitle(parsed.body)),
      headings: headings(parsed.body),
    });
  }

  return { notes, problems, warnings };
}

async function main() {
  const { notes, problems, warnings } = await loadNotes(CONTENT);

  // Optional: the wiki builds fine without it, just without adoption numbers.
  let apps = null;
  try {
    apps = JSON.parse(await readFile(join(ROOT, 'data', 'apps.json'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    warnings.push('data/apps.json is missing — run `npm run update:apps`');
  }

  // A typo'd element name would silently render "0 of 129 apps", which reads as
  // a finding rather than a mistake.
  const elements = knownElements(apps);
  if (elements.size) {
    for (const note of notes) {
      if (note.data.element && !elements.has(note.data.element)) {
        problems.push(
          `${note.file}: element '${note.data.element}' is not in the apps directory`,
        );
      }
    }
  }

  const homeSource = await readFile(join(CONTENT, 'Home.md'), 'utf8');
  const home = parseFrontmatter(homeSource);

  const graph = buildGraph(notes);
  const nodesBySlug = new Map(graph.nodes.map((node) => [node.slug, node]));

  // A note nothing links to is reachable only from the index, which usually
  // means a missing link somewhere rather than a deliberate island.
  for (const note of notes) {
    if ((graph.backlinks.get(note.slug) ?? []).length === 0 && note.data.type !== 'moc') {
      warnings.push(`${note.file}: nothing links to this note`);
    }
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
  }
  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const warning of warnings) console.warn(`  ${warning}`);
  }
  if (problems.length || (strict && warnings.length)) {
    console.error('\nbuild failed.');
    process.exitCode = 1;
    return;
  }

  const resolveLink = (target) => {
    const bySlug = graph.byTitle.get(target.toLowerCase()) ?? slugify(target);
    const node = nodesBySlug.get(bySlug);
    return { slug: bySlug, stub: node?.stub ?? true, title: node?.title ?? target };
  };
  const markdown = createMarkdown(resolveLink);

  // Generated directories are cleared so a renamed note cannot leave its old
  // page behind, published forever at a URL nothing links to any more.
  for (const dir of ['notes', 'data', 'queue', 'graph']) {
    await rm(join(OUT, dir), { recursive: true, force: true });
  }

  for (const note of notes) {
    const node = nodesBySlug.get(note.slug);
    await writePage(
      `notes/${note.slug}`,
      renderNotePage({
        note,
        node,
        graph,
        nodesBySlug,
        markdown,
        baseUrl: BASE_URL,
        adoption: adoption(apps, note.data.element),
      }),
    );
  }

  for (const node of graph.nodes.filter((n) => n.stub)) {
    await writePage(`notes/${node.slug}`, renderStubPage({ node, graph, nodesBySlug, baseUrl: BASE_URL }));
  }

  const mocs = notes
    .filter((note) => note.data.type === 'moc')
    .map((note) => ({ ...note, ...nodesBySlug.get(note.slug) }))
    .sort((a, b) => a.title.localeCompare(b.title));

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, 'index.html'),
    renderHome({ home, mocs, nodes: graph.nodes, markdown, baseUrl: BASE_URL }),
  );
  await writePage('queue', renderQueue({ nodes: graph.nodes, graph, nodesBySlug, baseUrl: BASE_URL }));
  await writePage('graph', renderGraphPage({ baseUrl: BASE_URL }));

  await mkdir(join(OUT, 'data'), { recursive: true });
  await writeFile(
    join(OUT, 'data', 'search-index.json'),
    JSON.stringify(
      notes.map((note) => ({
        slug: note.slug,
        title: note.title,
        type: note.data.type,
        tags: note.data.tags ?? [],
        headings: note.headings,
        summary: summarise(note.plain),
        text: note.plain,
      })),
    ),
  );

  await writeFile(
    join(OUT, 'data', 'graph.json'),
    JSON.stringify({
      nodes: graph.nodes.map((node) => ({
        slug: node.slug,
        title: node.title,
        type: node.type,
        stub: node.stub,
        inbound: node.inbound,
      })),
      edges: graph.edges,
    }),
  );

  await writeFile(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[
  '/',
  '/queue/',
  '/graph/',
  ...graph.nodes.filter((node) => !node.stub).map((node) => `/notes/${node.slug}/`),
]
  .map((path) => `  <url><loc>${BASE_URL}${path}</loc></url>`)
  .join('\n')}
</urlset>
`,
  );

  await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);

  const stubCount = graph.nodes.filter((node) => node.stub).length;
  const withAdoption = notes.filter((note) => note.data.element).length;
  console.log(
    `built ${notes.length} notes, ${stubCount} stub(s), ${graph.edges.length} links` +
      `${withAdoption ? `, ${withAdoption} with adoption data` : ''} → ${OUT}`,
  );
}

await main();
