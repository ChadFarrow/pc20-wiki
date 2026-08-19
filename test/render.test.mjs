import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMarkdown,
  escapeHtml,
  pageShell,
  mentionsSection,
  renderTimelinePage,
} from '../scripts/render.mjs';

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

// ---------- mentions ----------

const mentionsFixture = (overrides = {}) => ({
  total: 2,
  coverage: { episodes: 266, withSources: 214 },
  episodes: [
    {
      number: 118,
      date: '2023-02-24',
      title: 'Value Time Splits',
      audioUrl: 'https://mp3s.nashownotes.com/PC20-118.mp3',
      moments: [
        { seconds: 3840, source: 'c', text: 'Lightning address vs value block?' },
        { seconds: null, source: 'n', text: 'Value time splits' },
      ],
    },
  ],
  ...overrides,
});

test('mentionsSection renders nothing for a note nothing was said about', () => {
  assert.equal(mentionsSection(null), '');
  assert.equal(mentionsSection({ total: 0, episodes: [] }), '');
});

test('a moment with a timestamp deep-links into the audio at that second', () => {
  const html = mentionsSection(mentionsFixture());
  assert.match(html, /href="https:\/\/mp3s\.nashownotes\.com\/PC20-118\.mp3#t=3840"/);
  assert.match(html, />1:04:00</);
});

test('a moment with no timestamp gets no fragment and no stamp', () => {
  const html = mentionsSection({
    total: 1,
    episodes: [
      {
        number: 97,
        date: '2022-08-12',
        title: 'Forever Fifteen',
        audioUrl: 'https://example.com/PC20-97.mp3',
        moments: [{ seconds: null, source: 'n', text: 'Block Tag' }],
      },
    ],
  });
  assert.doesNotMatch(html, /#t=/);
  assert.match(html, /Block Tag/);
});

test('the episode line carries the number, date and title', () => {
  assert.match(mentionsSection(mentionsFixture()), /E118 · 24 Feb 2023 · Value Time Splits/);
});

test('mentionsSection caps the episodes and names the oldest it did not show', () => {
  const episodes = Array.from({ length: 12 }, (_, i) => ({
    number: 120 - i,
    date: i === 11 ? '2021-01-15' : '2023-01-01',
    title: `Episode ${120 - i}`,
    audioUrl: 'https://example.com/a.mp3',
    moments: [{ seconds: 10, source: 'c', text: `moment ${i}` }],
  }));

  const html = mentionsSection({ total: 12, episodes });
  assert.equal(html.match(/class="mentions__episode"/g).length, 8);
  assert.match(html, /and 4 more episodes, back to E109 \(15 Jan 2021\)/);
});

test('mentionsSection caps the moments within one episode too', () => {
  const html = mentionsSection({
    total: 5,
    episodes: [
      {
        number: 118,
        date: '2023-02-24',
        title: 'T',
        audioUrl: 'https://example.com/a.mp3',
        moments: Array.from({ length: 5 }, (_, i) => ({ seconds: i, source: 'c', text: `m${i}` })),
      },
    ],
  });
  assert.match(html, /and 2 more in this episode/);
  assert.doesNotMatch(html, />m4</);
});

test('mentionsSection escapes a chapter title rather than rendering it', () => {
  const html = mentionsSection({
    total: 1,
    episodes: [
      {
        number: 1,
        date: '2020-08-28',
        title: 'x',
        audioUrl: 'https://example.com/a.mp3',
        moments: [{ seconds: 1, source: 'c', text: '<script>alert(1)</script> & chapters' }],
      },
    ],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; chapters/);
});

test('the source footer names the transcript as the fallback source', () => {
  const html = mentionsSection(mentionsFixture());
  assert.match(html, /episode transcript/);
  assert.match(html, /214 of 266 episodes have curated notes/);
});

test('the footer omits the coverage sentence when the data does not carry it', () => {
  const html = mentionsSection(mentionsFixture({ coverage: null }));
  assert.match(html, /episode transcript/);
  assert.doesNotMatch(html, /episodes have curated notes/);
});

test('a transcript episode never pushes a curated episode off the page', () => {
  // Transcript-only episodes are by definition the ones the curated sources
  // miss — mostly the newest. Episodes sort newest-first and the page shows 8,
  // so without separate caps the weaker source evicts the better one entirely.
  const episodes = [];
  for (let n = 260; n > 250; n -= 1) {
    episodes.push({ number: n, date: '2026-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 't', text: `transcript ${n}` }] });
  }
  for (let n = 100; n > 90; n -= 1) {
    episodes.push({ number: n, date: '2022-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 'c', text: `chapter ${n}` }] });
  }

  const html = mentionsSection({ total: 20, episodes, coverage: null });
  for (let n = 100; n > 92; n -= 1) assert.ok(html.includes(`chapter ${n}`), `E${n} must survive`);
  assert.ok(html.includes('transcript 260'));
  assert.ok(!html.includes('transcript 256'), 'only MENTION_TRANSCRIPT_CAP of them');
});

test('a transcript moment says where it came from', () => {
  const html = mentionsSection({
    total: 1, coverage: null,
    episodes: [{ number: 251, date: '2026-02-27', title: 'E251', audioUrl: null,
      moments: [{ seconds: 4140, source: 't', text: 'I access helipad over Tor.' }] }],
  });
  assert.ok(html.includes('transcript'));
  assert.ok(html.includes('I access helipad over Tor.'));
});

test('the footer no longer claims the transcripts are excluded', () => {
  const html = mentionsSection({
    total: 1, coverage: null,
    episodes: [{ number: 1, date: null, title: null, audioUrl: null,
      moments: [{ seconds: null, source: 'c', text: 'x' }] }],
  });
  assert.ok(!html.includes('not the show’s transcripts'));
});

test('the episode it says to go back to is not one already on the page', () => {
  // Asymmetric overflow: the curated tier is UNDER its cap of 8 (three
  // episodes shown, none hidden), its oldest episode is older than anything
  // in the transcript tier, and the transcript tier is OVER its cap of 4. The
  // globally-oldest episode belongs to the tier that did NOT overflow, so a
  // "back to" line derived from the combined array's tail names an episode
  // that is sitting right there on the page — which happened on four live
  // pages (soundbites, liquidity, cross-app-comments, sovereign-feeds) before
  // `oldest` and `rest` were both derived from the same `hidden` list.
  const episodes = [];
  for (let n = 260; n > 250; n -= 1) {
    episodes.push({ number: n, date: '2026-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 't', text: `transcript ${n}` }] });
  }
  for (const n of [50, 40, 30]) {
    episodes.push({ number: n, date: '2021-01-01', title: `E${n}`, audioUrl: null,
      moments: [{ seconds: 10, source: 'c', text: `chapter ${n}` }] });
  }

  const html = mentionsSection({ total: 13, episodes, coverage: null });

  // The curated tier (50, 40, 30) is fully shown — three episodes, well under
  // the cap of 8 — so E30 is genuinely on the page.
  assert.ok(html.includes('chapter 30'), 'E30 must be shown, under the curated cap');

  const more = html.match(/<p class="mentions__more-eps">([^<]*)<\/p>/)?.[1];
  assert.ok(more, 'the more-episodes line must render');
  assert.doesNotMatch(more, /E30\b/, 'must not send the reader back to an episode already on the page');
  assert.match(more, /back to E251\b/, 'must name the genuinely oldest hidden episode');
});

// ---------- timeline ----------

const timelineFixture = {
  eras: [
    { id: 'genesis', title: 'Genesis', start: '2020-08-28', blurb: 'A new namespace.' },
    { id: 'boosts', title: 'Boosts', start: '2021-07-09', blurb: null },
  ],
  entries: [
    {
      id: 'liftoff',
      title: 'We have liftoff',
      kind: 'event',
      tags: [],
      episode: 1,
      episodeTitle: 'We are upgrading podcasting',
      date: '2020-08-28',
      seconds: null,
      audioUrl: 'https://example.com/PC20-01.mp3',
      era: 'genesis',
      notes: [],
    },
    {
      id: 'first-ever-boost',
      title: 'First-ever boost <script>',
      kind: 'first',
      tags: ['boosts'],
      episode: 46,
      episodeTitle: "Sliding into your PM's",
      date: '2021-07-16',
      seconds: 3898,
      audioUrl: 'https://example.com/PC20-46.mp3',
      era: 'boosts',
      notes: [{ slug: 'boost', title: 'Boost' }],
    },
  ],
};

test('the timeline page renders every entry into the markup', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.match(html, /2 milestones from the Podcasting 2\.0 podcast, 28 Aug 2020 to 16 Jul 2021/);
  assert.equal(html.match(/class="entry"/g).length, 2);
  assert.equal(html.match(/<section class="era"/g).length, 2);
});

test('the timeline runs oldest first and numbers its eras', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.ok(html.indexOf('era-genesis') < html.indexOf('era-boosts'));
  assert.ok(html.indexOf('We have liftoff') < html.indexOf('First-ever boost'));
  assert.match(html, /<p class="era__no">01<\/p>/);
});

test('an entry with a timestamp opens the audio at that moment', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.match(html, /href="https:\/\/example\.com\/PC20-46\.mp3#t=3898">E46 · 1:04:58</);
  // Without one, the episode still links — just not to a point inside it.
  assert.match(html, /href="https:\/\/example\.com\/PC20-01\.mp3">E1</);
});

test('a timeline entry links to the notes it is about', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.match(html, /<a href="\/notes\/boost\/">Boost<\/a>/);
});

test('a milestone title is escaped, not rendered', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.doesNotMatch(html, /First-ever boost <script>/);
  assert.match(html, /First-ever boost &lt;script&gt;/);
});

test('every entry gets an id so a milestone can be linked to directly', () => {
  const html = renderTimelinePage({ timeline: timelineFixture, baseUrl: 'https://example.com' });
  assert.match(html, /<li class="entry" id="first-ever-boost">/);
});

test('the timeline page survives having no entries at all', () => {
  const html = renderTimelinePage({ timeline: { eras: [], entries: [] }, baseUrl: 'https://example.com' });
  assert.match(html, /0 milestones/);
  assert.doesNotMatch(html, /class="entry"/);
});

test('a timeline entry renders its context when the milestone has one', () => {
  const md = (text) => `<p>${text}</p>`;
  const withBody = {
    ...timelineFixture,
    entries: timelineFixture.entries.map((entry) =>
      entry.id === 'liftoff' ? { ...entry, body: 'The show notes place it in Austin.' } : entry,
    ),
  };

  const html = renderTimelinePage({ timeline: withBody, markdown: md, baseUrl: 'https://example.com' });
  assert.match(html, /<div class="entry__note"><p>The show notes place it in Austin\.<\/p><\/div>/);
  // The other entry has no body, so it gets no empty container. Matched on the
  // full class, since entry__notes — the note links — contains it as a prefix.
  assert.equal(html.match(/class="entry__note"/g).length, 1);
});

test('the timeline renders without a markdown pipeline at all', () => {
  const html = renderTimelinePage({
    timeline: { ...timelineFixture, entries: [{ ...timelineFixture.entries[0], body: 'Context.' }] },
    baseUrl: 'https://example.com',
  });
  assert.doesNotMatch(html, /entry__note/);
  assert.match(html, /We have liftoff/);
});
