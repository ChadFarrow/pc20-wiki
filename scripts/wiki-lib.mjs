/**
 * Turning a folder of Obsidian notes into a linked wiki.
 *
 * Everything here is a pure function over strings and plain objects, so the
 * build can be tested without a filesystem and every rule has a test naming the
 * behaviour rather than the implementation.
 *
 * The validation functions follow the house pattern from pc20-timeline: collect
 * every problem in one pass and report file + message, rather than throwing on
 * the first one. A vault edited by hand for years drifts, and being told about
 * one typo per run is a bad way to find out.
 */

import { load } from 'js-yaml';

/** The vocabulary Home.md documents, plus the two kinds the vault uses in practice. */
export const TYPES = new Set([
  'concept',
  'protocol',
  'spec',
  'tool',
  'project',
  'source',
  'person',
  'moc',
  'home',
]);

export const STATUSES = new Set(['seed', 'growing', 'evergreen']);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits a note into its frontmatter object and markdown body. */
export function parseFrontmatter(source) {
  const match = source.match(FRONTMATTER);
  if (!match) throw new Error('missing YAML frontmatter (a note must open with ---)');

  const data = load(match[1]);
  if (data == null) return { data: {}, body: match[2].trim() };
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return { data, body: match[2].trim() };
}

/**
 * `Value 4 Value` → `value-4-value`.
 *
 * Dots become separators rather than vanishing, so `Podcasting 2.0` reads as
 * `podcasting-2-0` instead of the ambiguous `podcasting-20`.
 */
export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const WIKILINK = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;

/**
 * Finds `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` and the combination.
 *
 * Every occurrence is reported, not every unique target: how often a note is
 * linked is what ranks the writing queue.
 */
export function parseWikilinks(body) {
  const links = [];
  for (const match of String(body ?? '').matchAll(WIKILINK)) {
    const target = match[1].trim();
    if (!target) continue;
    links.push({
      target,
      alias: match[3]?.trim() || null,
      heading: match[2]?.trim() || null,
    });
  }
  return links;
}

/**
 * `related:` holds wikilink strings — `["[[Keysend]]"]` — because Obsidian
 * renders them as links in the properties panel. A bare title is accepted too,
 * since that is the easy thing to type by hand.
 */
export function relatedTargets(related) {
  const list = related == null ? [] : Array.isArray(related) ? related : [related];
  return list
    .flatMap((entry) => {
      const text = String(entry).trim();
      const links = parseWikilinks(text);
      return links.length ? links.map((link) => link.target) : [text];
    })
    .filter(Boolean);
}

/** Section titles below the H1, used for search ranking and page outlines. */
export function headings(body) {
  return String(body ?? '')
    .split('\n')
    .map((line) => line.match(/^#{2,6}\s+(.*)$/))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

/**
 * Sections the vault keeps but the site does not publish.
 *
 * `Open questions` is the author's working margin — what a note cannot yet
 * assert. The heading invites an answer, and a static wiki has no way for a
 * reader to give one, so it stays in Obsidian and stops here.
 */
export const UNPUBLISHED_SECTIONS = ['Open questions'];

/**
 * Removes a heading and everything under it, up to the next heading at the same
 * level or higher.
 *
 * Line by line rather than one regex because in 14 of the 36 notes that have it
 * the section is last in the file, so there is no following heading to anchor
 * on. Fenced code is skipped: a heading inside a sample is prose about a
 * convention, not the convention.
 */
export function dropSections(body, titles = UNPUBLISHED_SECTIONS) {
  const drop = new Set(titles.map((title) => String(title).trim().toLowerCase()));
  const kept = [];
  let fenced = false;
  // The level being dropped, or 0 when keeping. Levels, not a flag, so a
  // '### Worth answering' under the heading goes with it and the next '##'
  // does not.
  let dropping = 0;

  for (const line of String(body ?? '').split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;

    const heading = fenced ? null : line.match(/^(#{2,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (dropping && level <= dropping) dropping = 0;
      if (!dropping && drop.has(heading[2].trim().toLowerCase())) {
        dropping = level;
        continue;
      }
    }

    if (!dropping) kept.push(line);
  }

  return kept.join('\n').trim();
}

/**
 * Drops the H1 line.
 *
 * The title is already known from the filename, so leaving it in the prose
 * makes every summary open by saying the title twice.
 */
export function stripTitle(body) {
  return String(body ?? '').replace(/^#\s+.*$\r?\n?/m, '').trim();
}

/**
 * Markdown → words. The search index should match on what a note says, not on
 * the punctuation it says it with.
 */
export function plainText(body) {
  return String(body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\][|#]+)(?:#[^\][|]+)?(?:\|([^\][]+))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#]/g, '')
    // Blockquote and list markers only at the start of a line: a '>' mid-prose
    // belongs to the text, and dropping it turns <podcast:value> into
    // something nobody would ever search for.
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(body) {
  const text = plainText(body);
  return text ? text.split(/\s+/).length : 0;
}

/** The first H1 in a note, which Obsidian keeps in step with the filename. */
export function firstHeading(body) {
  const match = String(body ?? '').match(/^#\s+(.*)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Checks one note. Returns { errors, warnings }; a note with errors never
 * reaches the site, while warnings only fail the build under --strict.
 */
export function validateNote({ file, title, data, body }) {
  const errors = [];
  const warnings = [];

  if (data.type == null) errors.push(`${file}: missing 'type' in frontmatter`);
  else if (!TYPES.has(data.type)) {
    errors.push(`${file}: unknown type '${data.type}' (expected one of ${[...TYPES].join(', ')})`);
  }

  if (data.status == null) errors.push(`${file}: missing 'status' in frontmatter`);
  else if (!STATUSES.has(data.status)) {
    errors.push(`${file}: unknown status '${data.status}' (expected seed, growing or evergreen)`);
  }

  const h1 = firstHeading(body);
  if (!h1) errors.push(`${file}: no H1 heading — a note must open with '# ${title}'`);
  else if (h1 !== title) {
    errors.push(`${file}: H1 is '${h1}' but the filename says '${title}' — they must match`);
  }

  if (data.tags != null && !Array.isArray(data.tags)) {
    errors.push(`${file}: 'tags' must be a list`);
  }

  // Obsidian's own key, reused to tell the mention matcher what the show calls
  // this thing. A typo here costs the note its episode citations silently, so it
  // is worth failing the build over.
  if (data.aliases != null) {
    if (!Array.isArray(data.aliases)) errors.push(`${file}: 'aliases' must be a list`);
    else if (data.aliases.some((alias) => typeof alias !== 'string' || !alias.trim())) {
      errors.push(`${file}: 'aliases' must be a list of non-empty strings`);
    }
  }

  const words = wordCount(body);
  if (words < 40) warnings.push(`${file}: only ${words} words — still a stub in practice`);

  return { errors, warnings };
}

/**
 * Which apps implement a namespace element, out of how many.
 *
 * The wiki has an opinion — see the Podcasting 2.0 MOC's open thread — that a
 * tag in the spec is not a tag in the apps. This is the number that settles it,
 * so it is computed from the directory at build time rather than typed into a
 * note where it would rot.
 */
export function adoption(apps, element) {
  if (!apps?.apps || !element) return null;
  const supporting = apps.apps
    .filter((app) => app.elements.includes(element))
    .map((app) => app.name);

  return {
    element,
    count: supporting.length,
    total: apps.apps.length,
    apps: supporting,
    updated: apps.updated ?? null,
  };
}

/** Every element name the directory knows, for catching a typo'd `element:`. */
export function knownElements(apps) {
  return new Set((apps?.apps ?? []).flatMap((app) => app.elements));
}

/**
 * Builds the link graph.
 *
 * Notes are addressed by slug, and links resolve by title case-insensitively —
 * Obsidian itself is forgiving about case, so the build should be too. A link
 * to a note that does not exist becomes a stub node: the vault treats
 * unresolved links as the writing queue, and the site publishes that queue
 * rather than throwing 404s at readers.
 */
export function buildGraph(notes) {
  const bySlug = new Map(notes.map((note) => [note.slug, note]));
  const byTitle = new Map(notes.map((note) => [note.title.toLowerCase(), note.slug]));

  const stubs = new Map();
  const outbound = new Map(notes.map((note) => [note.slug, []]));
  const backlinks = new Map(notes.map((note) => [note.slug, []]));
  const edges = [];
  const linkCounts = new Map();

  const resolve = (target) => {
    const key = target.toLowerCase();
    if (byTitle.has(key)) return byTitle.get(key);

    const slug = slugify(target);
    if (bySlug.has(slug)) return slug;
    if (!stubs.has(slug)) stubs.set(slug, target);
    return slug;
  };

  for (const note of notes) {
    const targets = [
      ...parseWikilinks(note.body).map((link) => link.target),
      ...relatedTargets(note.related),
    ];

    for (const target of targets) {
      const to = resolve(target);
      linkCounts.set(to, (linkCounts.get(to) ?? 0) + 1);

      // A note linking itself is a writing habit, not a graph edge.
      if (to === note.slug) continue;
      if (outbound.get(note.slug).includes(to)) continue;

      outbound.get(note.slug).push(to);
      if (!backlinks.has(to)) backlinks.set(to, []);
      backlinks.get(to).push(note.slug);
      edges.push({ from: note.slug, to });
    }
  }

  const nodes = [
    ...notes.map((note) => ({
      slug: note.slug,
      title: note.title,
      type: note.data.type ?? 'concept',
      status: note.data.status ?? 'seed',
      tags: note.data.tags ?? [],
      stub: false,
      inbound: backlinks.get(note.slug)?.length ?? 0,
    })),
    ...[...stubs].map(([slug, title]) => ({
      slug,
      title,
      type: 'stub',
      status: 'seed',
      tags: [],
      stub: true,
      inbound: backlinks.get(slug)?.length ?? 0,
    })),
  ];

  return { nodes, edges, outbound, backlinks, stubs, linkCounts, bySlug, byTitle };
}
