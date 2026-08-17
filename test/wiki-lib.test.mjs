import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFrontmatter,
  slugify,
  parseWikilinks,
  relatedTargets,
  headings,
  plainText,
  wordCount,
  validateNote,
  buildGraph,
  TYPES,
  STATUSES,
} from '../scripts/wiki-lib.mjs';

test('parseFrontmatter splits the YAML header from the body', () => {
  const { data, body } = parseFrontmatter('---\ntype: concept\nstatus: seed\n---\n\n# Keysend\n\nText.');
  assert.equal(data.type, 'concept');
  assert.equal(data.status, 'seed');
  assert.equal(body, '# Keysend\n\nText.');
});

test('parseFrontmatter rejects a file with no header', () => {
  assert.throws(() => parseFrontmatter('# Keysend\n'), /frontmatter/i);
});

test('parseFrontmatter rejects a header that is not a mapping', () => {
  assert.throws(() => parseFrontmatter('---\n- a\n- b\n---\n\nbody'), /mapping/i);
});

test('slugify makes titles URL-safe without losing meaning', () => {
  assert.equal(slugify('Value 4 Value'), 'value-4-value');
  assert.equal(slugify('Podcasting 2.0'), 'podcasting-2-0');
  assert.equal(slugify('NIP-46'), 'nip-46');
  assert.equal(slugify('Bitcoin and Lightning MOC'), 'bitcoin-and-lightning-moc');
  assert.equal(slugify('Reverse Proxy'), 'reverse-proxy');
});

test('slugify collapses punctuation rather than emitting empty segments', () => {
  assert.equal(slugify('C & R  --  Space'), 'c-r-space');
  assert.equal(slugify('  Padded  '), 'padded');
});

test('parseWikilinks finds plain links', () => {
  const links = parseWikilinks('See [[Keysend]] and [[Value 4 Value]].');
  assert.deepEqual(
    links.map((l) => l.target),
    ['Keysend', 'Value 4 Value'],
  );
});

test('parseWikilinks handles aliases and heading anchors', () => {
  const links = parseWikilinks('[[Keysend|how it pays]] then [[RSS#History]] and [[LND|the node]]');
  assert.deepEqual(links[0], { target: 'Keysend', alias: 'how it pays', heading: null });
  assert.deepEqual(links[1], { target: 'RSS', alias: null, heading: 'History' });
  assert.equal(links[2].alias, 'the node');
});

test('parseWikilinks combines an anchor with an alias', () => {
  const [link] = parseWikilinks('[[Podcast Namespace#Tags|the tag list]]');
  assert.deepEqual(link, { target: 'Podcast Namespace', alias: 'the tag list', heading: 'Tags' });
});

test('parseWikilinks ignores empty and malformed links', () => {
  assert.deepEqual(parseWikilinks('[[]] and [[ ]] and [single] and [[unclosed'), []);
});

test('parseWikilinks reports each occurrence, so link counts are real', () => {
  const links = parseWikilinks('[[LND]] here and [[LND]] again');
  assert.equal(links.length, 2);
});

test('relatedTargets reads the wikilink strings in frontmatter', () => {
  assert.deepEqual(relatedTargets(['[[Lightning Network]]', '[[Keysend]]']), [
    'Lightning Network',
    'Keysend',
  ]);
});

test('relatedTargets tolerates bare titles and a missing field', () => {
  assert.deepEqual(relatedTargets(['Keysend']), ['Keysend']);
  assert.deepEqual(relatedTargets(undefined), []);
  assert.deepEqual(relatedTargets('[[Keysend]]'), ['Keysend']);
});

test('headings lists the section titles below the H1', () => {
  const body = '# Keysend\n\nText.\n\n## Why it matters\n\nMore.\n\n### Detail\n';
  assert.deepEqual(headings(body), ['Why it matters', 'Detail']);
});

test('plainText strips markdown so the search index holds words, not syntax', () => {
  const body = '# Keysend\n\nA **bold** claim with `code`, a [link](https://x.com) and [[Value 4 Value]].';
  const text = plainText(body);
  assert.match(text, /bold claim with code/);
  assert.match(text, /Value 4 Value/);
  assert.doesNotMatch(text, /[[\]*`#]|https/);
});

test('plainText keeps the alias rather than the target when a link has one', () => {
  assert.match(plainText('[[Keysend|paying without an invoice]]'), /paying without an invoice/);
});

test('wordCount counts prose, not punctuation', () => {
  assert.equal(wordCount('# T\n\none two three'), 4);
});

test('validateNote accepts a well-formed note', () => {
  const { errors } = validateNote({
    file: 'notes/Keysend.md',
    title: 'Keysend',
    data: { type: 'protocol', status: 'seed', tags: ['lightning'] },
    body: '# Keysend\n\nOne sentence.',
  });
  assert.deepEqual(errors, []);
});

test('validateNote names the file and the problem for every error at once', () => {
  const { errors } = validateNote({
    file: 'notes/Broken.md',
    title: 'Broken',
    data: { type: 'nonsense', status: 'imaginary' },
    body: 'No heading here.',
  });
  assert.equal(errors.length, 3);
  assert.ok(errors.every((e) => e.startsWith('notes/Broken.md:')));
  assert.ok(errors.some((e) => /type/.test(e)));
  assert.ok(errors.some((e) => /status/.test(e)));
  assert.ok(errors.some((e) => /h1|heading/i.test(e)));
});

test('validateNote requires the H1 to match the filename', () => {
  const { errors } = validateNote({
    file: 'notes/Keysend.md',
    title: 'Keysend',
    data: { type: 'protocol', status: 'seed' },
    body: '# Something Else\n\nText.',
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Something Else/);
});

test('the vocabulary matches what Home.md documents', () => {
  for (const type of ['concept', 'protocol', 'spec', 'tool', 'project', 'source', 'person']) {
    assert.ok(TYPES.has(type), `${type} should be a valid type`);
  }
  assert.deepEqual([...STATUSES].sort(), ['evergreen', 'growing', 'seed']);
});

const NOTES = [
  {
    slug: 'value-4-value',
    title: 'Value 4 Value',
    data: { type: 'concept', status: 'growing', tags: ['v4v'] },
    body: '# Value 4 Value\n\nPaid over [[Lightning Network]] using [[Keysend]] and [[Boostagram]].',
    related: ['Lightning Network'],
  },
  {
    slug: 'keysend',
    title: 'Keysend',
    data: { type: 'protocol', status: 'seed', tags: ['lightning'] },
    body: '# Keysend\n\nUsed by [[Value 4 Value]].',
    related: [],
  },
  {
    slug: 'lightning-network',
    title: 'Lightning Network',
    data: { type: 'protocol', status: 'growing', tags: ['lightning'] },
    body: '# Lightning Network\n\nCarries [[Keysend]] payments.',
    related: [],
  },
];

test('buildGraph links notes by title and records backlinks', () => {
  const graph = buildGraph(NOTES);
  assert.deepEqual(graph.backlinks.get('keysend').sort(), ['lightning-network', 'value-4-value']);
  assert.deepEqual(graph.outbound.get('lightning-network'), ['keysend']);
});

test('buildGraph counts a frontmatter related: link as a real edge', () => {
  const graph = buildGraph(NOTES);
  assert.ok(graph.outbound.get('value-4-value').includes('lightning-network'));
  assert.ok(graph.backlinks.get('lightning-network').includes('value-4-value'));
});

test('buildGraph creates a stub node for an unwritten target', () => {
  const graph = buildGraph(NOTES);
  const stub = graph.nodes.find((n) => n.slug === 'boostagram');
  assert.ok(stub, 'Boostagram should exist as a stub');
  assert.equal(stub.stub, true);
  assert.equal(stub.title, 'Boostagram');
  assert.deepEqual(graph.backlinks.get('boostagram'), ['value-4-value']);
});

test('buildGraph does not invent self-edges or duplicates', () => {
  const graph = buildGraph([
    {
      slug: 'a',
      title: 'A',
      data: {},
      body: '# A\n\n[[A]] and [[B]] and [[B]] again.',
      related: ['B'],
    },
  ]);
  assert.deepEqual(graph.outbound.get('a'), ['b']);
  assert.deepEqual(graph.backlinks.get('b'), ['a']);
});

test('buildGraph reports every edge once for the graph view', () => {
  const graph = buildGraph(NOTES);
  const seen = new Set(graph.edges.map((e) => `${e.from}->${e.to}`));
  assert.equal(seen.size, graph.edges.length);
});

test('buildGraph resolves links case-insensitively', () => {
  const graph = buildGraph([
    { slug: 'keysend', title: 'Keysend', data: {}, body: '# Keysend', related: [] },
    { slug: 'a', title: 'A', data: {}, body: '# A\n\n[[keysend]]', related: [] },
  ]);
  assert.deepEqual(graph.outbound.get('a'), ['keysend']);
  assert.equal(graph.nodes.filter((n) => n.stub).length, 0);
});

test('stripTitle removes the H1 so summaries do not repeat the title', async () => {
  const { stripTitle } = await import('../scripts/wiki-lib.mjs');
  assert.equal(stripTitle('# Value 4 Value\n\nA model where content is free.'), 'A model where content is free.');
  assert.equal(stripTitle('No heading at all.'), 'No heading at all.');
});
