import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMarkdown, escapeHtml, pageShell } from '../scripts/render.mjs';

/** Resolves the two titles the fixtures use; anything else is an unwritten stub. */
const resolver = (target) => {
  const known = { keysend: 'keysend', 'value 4 value': 'value-4-value' };
  const slug = known[target.toLowerCase()];
  return slug
    ? { slug, stub: false, title: target }
    : { slug: target.toLowerCase().replace(/[^a-z0-9]+/g, '-'), stub: true, title: target };
};

const md = createMarkdown(resolver);

test('escapeHtml neutralises every character that could open a tag', () => {
  assert.equal(escapeHtml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

test('renders ordinary markdown', () => {
  const html = md('## Why it matters\n\nA **bold** point.\n\n- one\n- two');
  assert.match(html, /<h2[^>]*>Why it matters<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
});

test('headings carry ids so [[Note#Heading]] can land on them', () => {
  const html = md('## Why it matters');
  assert.match(html, /id="why-it-matters"/);
});

test('a wikilink becomes a link to the note page', () => {
  const html = md('See [[Keysend]].');
  assert.match(html, /<a class="wikilink" href="\/notes\/keysend\/">Keysend<\/a>/);
});

test('a wikilink alias is what the reader sees', () => {
  const html = md('[[Keysend|paying without an invoice]]');
  assert.match(html, /href="\/notes\/keysend\/">paying without an invoice</);
});

test('a heading anchor appends a fragment', () => {
  const html = md('[[Keysend#How it works]]');
  assert.match(html, /href="\/notes\/keysend\/#how-it-works"/);
});

test('a link to an unwritten note is marked as a stub, not dropped', () => {
  const html = md('[[Boostagram]]');
  assert.match(html, /class="wikilink wikilink--stub"/);
    assert.match(html, /href="\/notes\/boostagram\/"/);
});

test('wikilinks inside code are left alone', () => {
  assert.match(md('`[[Keysend]]`'), /<code>\[\[Keysend\]\]<\/code>/);
  assert.doesNotMatch(md('```\n[[Keysend]]\n```'), /<a /);
});

test('raw HTML in a note is escaped rather than rendered', () => {
  const html = md('An <img src=x onerror=alert(1)> attempt.');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('a script tag in a note cannot execute', () => {
  const html = md('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
});

test('ordinary markdown links still work and are safe to click', () => {
  const html = md('[Podcast Index](https://podcastindex.org)');
  assert.match(html, /href="https:\/\/podcastindex.org"/);
  assert.match(html, /rel="noopener"/);
});

test('a javascript: url is not turned into a link', () => {
  const html = md('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript:/);
});

test('pageShell escapes the title and sets the canonical url', () => {
  const html = pageShell({
    title: 'Keysend & "friends"',
    description: 'A note',
    canonical: 'https://example.com/notes/keysend/',
    body: '<main></main>',
  });
  assert.match(html, /<title>Keysend &amp; &quot;friends&quot;<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/notes\/keysend\/">/);
  assert.match(html, /<html lang="en">/);
});
