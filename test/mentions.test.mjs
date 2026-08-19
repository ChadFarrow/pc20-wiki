import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  squash,
  norm,
  matchesForm,
  toSeconds,
  toStamp,
  stripHtml,
  collectChapters,
  collectShowNotes,
  isStructural,
  isMatchable,
  denied,
  collectMilestones,
  collectClips,
  dedupeClips,
  denyForms,
  formsFor,
  buildMentions,
  compareMentions,
  diffMentions,
  mentionsFor,
  validateTagMap,
  TIMELINE_TAG_NOTES,
} from '../scripts/mentions-lib.mjs';

const note = (title, slug, data = {}) => ({ title, slug, data: { type: 'concept', ...data } });

test('squash drops separators and case but keeps digits', () => {
  assert.equal(squash('Podcasting 2.0'), 'podcasting20');
  assert.equal(squash('PodcastIndex.org'), 'podcastindexorg');
  assert.equal(squash('  Value 4 Value! '), 'value4value');
});

test('norm collapses to space-separated words and wraps in spaces', () => {
  assert.equal(norm('RSS.com — mega donation'), ' rss com mega donation ');
});

// The whole risk of this feature is here. Each case below is a real string from
// the archive that the naive rule got wrong.

test('a long form matches across the separators the show is inconsistent about', () => {
  assert.ok(matchesForm('Podcast Index', 'Welcome to PodcastIndex.org'));
  assert.ok(matchesForm('Boostagram', 'Boostagrams'));
  assert.ok(matchesForm('Podping', 'Pod ping overview'));
  assert.ok(matchesForm('Value 4 Value', 'value4value streaming'));
});

test('a short form does not match inside a longer word', () => {
  assert.ok(!matchesForm('Tor', 'Podfather story time'));
  assert.ok(!matchesForm('Tor', 'Art Generator Splits'));
  assert.ok(!matchesForm('Tor', 'Weathering the storm?'));
  assert.ok(!matchesForm('NIP', 'Mini pub .dev'));
  assert.ok(!matchesForm('NIP', 'The cassette deck on an iPhone'));
});

test('a short form still matches when it stands alone', () => {
  assert.ok(matchesForm('Tor', 'Running a node behind Tor'));
  assert.ok(matchesForm('RSS', 'Spotify hating on RSS'));
  assert.ok(matchesForm('RSS', 'RSS.com mega donation'));
  assert.ok(!matchesForm('RSS', 'Dreb is serving up chapters soon!'));
  assert.ok(matchesForm('Sats', 'Stacking Sats'));
});

test('toSeconds handles both timestamp shapes the sources use', () => {
  assert.equal(toSeconds('1:04:58'), 3898);
  assert.equal(toSeconds('9:30'), 570);
  assert.equal(toSeconds(150), 150);
  assert.equal(toSeconds(null), null);
  assert.equal(toSeconds('soon'), null);
});

test('toStamp drops the hour when there is not one', () => {
  assert.equal(toStamp(3898), '1:04:58');
  assert.equal(toStamp(570), '9:30');
  assert.equal(toStamp(5), '0:05');
});

test('stripHtml unwraps a show-note line to what a reader would see', () => {
  assert.equal(stripHtml('<p><a href="#">Boost&nbsp;Bait</a> &amp; friends</p>'), 'Boost Bait & friends');
});

test('collectChapters reads the episode from the filename and keeps seconds', () => {
  const got = collectChapters([
    { name: 'PC20-097-Chapters.json', json: { chapters: [{ title: 'Block Tag', startTime: 150 }, { title: '  ' }] } },
  ]);
  assert.deepEqual(got, [{ source: 'c', episode: 97, seconds: 150, text: 'Block Tag' }]);
});

test('collectShowNotes joins on itunes:episode, not guid', () => {
  const xml = `<item>
    <guid>http://podcastindex.org/</guid>
    <description><![CDATA[<p>PodPing new version</p><p>a</p>]]></description>
    <itunes:episode>71</itunes:episode>
  </item>`;
  assert.deepEqual(collectShowNotes(xml), [
    { source: 'n', episode: 71, seconds: null, text: 'PodPing new version' },
  ]);
});

test('isStructural catches the feed template lines a frequency count cannot', () => {
  // Every instance carries a different date and title, so denyForms never sees
  // them repeat — which is the entire reason this list exists.
  assert.ok(isStructural('Podcasting 2.0 for September 11th 2020 Episode 2: We Have Liftoff!'));
  assert.ok(isStructural("Adam & Dave discuss the week's developments on podcastindex.org"));
  assert.ok(!isStructural('Podcasting 2.0 Explainer Doc'));
  assert.ok(!isStructural('Measuring Success for Podcasting 2.0'));
});

test('collectShowNotes drops the template lines', () => {
  const xml = `<item>
    <description><![CDATA[<p>Podcasting 2.0 for October 2nd 2020 Episode 5: Juggling the Junket</p><p>Live tag</p>]]></description>
    <itunes:episode>5</itunes:episode>
  </item>`;
  assert.deepEqual(
    collectShowNotes(xml).map((candidate) => candidate.text),
    ['Live tag'],
  );
});

test('collectMilestones reads frontmatter only, never the TODO body', () => {
  const got = collectMilestones([
    { data: { title: 'First-ever boost', episode: 46, timestamp: '1:04:58', tags: ['boosts'] }, body: 'TODO: add context' },
  ]);
  assert.deepEqual(got, [
    { source: 'm', episode: 46, seconds: 3898, text: 'First-ever boost', tags: ['boosts'] },
  ]);
});

test('collectClips parses a checklist line and drops the star', () => {
  const got = collectClips('- [ ] **E46 · 1:05:00** — ⭐ First-ever boost\nnot a clip line\n');
  assert.deepEqual(got, [{ source: 'k', episode: 46, seconds: 3900, text: 'First-ever boost' }]);
});

test('dedupeClips drops a clip the timeline already carries, and keeps the rest', () => {
  const milestones = [{ episode: 46, seconds: 3898, text: 'First-ever boost' }];
  const clips = [
    { episode: 46, seconds: 3900, text: 'The first boost' }, // 2s away — same moment
    { episode: 46, seconds: 4019, text: 'Something else' }, // 121s away — kept
    { episode: 79, seconds: 900, text: '"LIT" coined' }, // different episode
  ];
  assert.deepEqual(
    dedupeClips(clips, milestones).map((clip) => clip.text),
    ['Something else', '"LIT" coined'],
  );
});

test('dedupeClips drops an identical title however far apart it is', () => {
  const kept = dedupeClips(
    [{ episode: 46, seconds: 10, text: 'First-ever boost!' }],
    [{ episode: 46, seconds: 3898, text: 'First-ever boost' }],
  );
  assert.deepEqual(kept, []);
});

test('denyForms denies a form at the threshold and spares one below it', () => {
  const candidates = [
    ...[1, 2, 3, 4].map((episode) => ({ episode, text: 'Boostagrams' })),
    ...[1, 2, 3].map((episode) => ({ episode, text: 'Podping' })),
    ...[9, 9, 9, 9].map((episode) => ({ episode, text: 'Repeated in one episode' })),
  ];
  const denied = denyForms(candidates);
  assert.ok(denied.has(squash('Boostagrams')));
  assert.ok(!denied.has(squash('Podping')));
  assert.ok(!denied.has(squash('Repeated in one episode')));
});

test('formsFor unions the title, vault aliases and the bootstrap table', () => {
  const forms = formsFor(note('Value 4 Value', 'value-4-value', { aliases: ['value block'] }));
  assert.ok(forms.includes('Value 4 Value'));
  assert.ok(forms.includes('value block'));
  assert.ok(forms.includes('v4v'));
});

test('formsFor does not repeat a vault alias the bootstrap table also has', () => {
  const forms = formsFor(note('Value 4 Value', 'value-4-value', { aliases: ['V4V'] }));
  assert.equal(forms.filter((form) => squash(form) === 'v4v').length, 1);
});

test('buildMentions matches, denies boilerplate and sorts deterministically', () => {
  const notes = [note('Podping', 'podping'), note('Tor', 'tor'), note('Nostr MOC', 'nostr-moc', { type: 'moc' })];
  const candidates = [
    { source: 'c', episode: 118, seconds: 1953, text: 'Blueberry adds podping' },
    { source: 'c', episode: 90, seconds: 10, text: 'Pod ping through power press' },
    { source: 'n', episode: 71, seconds: null, text: 'Podfather story time' },
    ...[1, 2, 3, 4].map((episode) => ({ source: 'c', episode, seconds: 5, text: 'Podping' })),
  ];

  const mentions = buildMentions(notes, candidates);
  assert.deepEqual(Object.keys(mentions), ['podping']);
  assert.deepEqual(
    mentions.podping.map((m) => m.e),
    [90, 118],
  );
  assert.equal(mentions.podping[0].t, 10);
  assert.equal(mentions.podping.at(-1).x, 'Blueberry adds podping');
});

test('compareMentions orders by episode, then timestamp, then source, then text', () => {
  // The same four-key comparator used to be written out separately in
  // buildMentions and in update-mentions.mjs's merge step. Exported once here
  // and imported by both, so a change to the ordering can only happen in one
  // place — data/mentions.json is committed and determinism is a stated
  // constraint, so two copies drifting apart would silently reorder the file.
  const a = { e: 1, t: 10, s: 'c', x: 'a' };
  const b = { e: 1, t: 10, s: 'c', x: 'b' };
  const c = { e: 1, t: 10, s: 't', x: 'a' };
  const d = { e: 1, t: 20, s: 'c', x: 'a' };
  const f = { e: 2, t: null, s: 'c', x: 'a' };
  const g = { e: 1, s: 'c', x: 'a' }; // no t key at all
  const h = { e: 1, t: null, s: 'c', x: 'a' }; // t explicitly null

  assert.ok(compareMentions(a, b) < 0, 'ties on episode/timestamp/source break on text');
  assert.ok(compareMentions(b, c) < 0, 'ties on episode/timestamp break on source');
  assert.ok(compareMentions(a, d) < 0, 'ties on episode break on timestamp');
  assert.ok(compareMentions(d, f) < 0, 'episode outranks everything else');
  assert.ok(compareMentions(a, g) < 0, 'a timestamped mention sorts before an untimestamped one');
  assert.equal(compareMentions(g, h), 0, 'a missing t key and an explicit null t sort identically');
});

test('buildMentions omits t entirely when a moment has no timestamp', () => {
  const mentions = buildMentions(
    [note('Podping', 'podping')],
    [{ source: 'n', episode: 71, seconds: null, text: 'PodPing new version' }],
  );
  assert.deepEqual(mentions.podping, [{ e: 71, s: 'n', x: 'PodPing new version' }]);
});

test('buildMentions honours a timeline tag even when the title is absent', () => {
  const mentions = buildMentions(
    [note('Value 4 Value', 'value-4-value')],
    [{ source: 'm', episode: 200, seconds: null, text: 'Adam floats a new split', tags: ['v4v'] }],
  );
  assert.equal(mentions['value-4-value'].length, 1);
});

test('buildMentions skips a note the vault opted out of', () => {
  const mentions = buildMentions(
    [note('Podping', 'podping', { mentions: false })],
    [{ source: 'c', episode: 118, seconds: 1, text: 'Blueberry adds podping' }],
  );
  assert.deepEqual(mentions, {});
});

test('buildMentions applies a per-note deny phrase', () => {
  const mentions = buildMentions(
    [note('RSS', 'rss')],
    [
      { source: 'c', episode: 90, seconds: 1, text: 'Welcome RSS.com' },
      { source: 'c', episode: 91, seconds: 1, text: 'NOSTR to replace RSS?' },
    ],
  );
  assert.deepEqual(
    mentions.rss.map((m) => m.x),
    ['NOSTR to replace RSS?'],
  );
});

test('validateTagMap rejects a tag the timeline does not define', () => {
  const problems = validateTagMap(new Set(['podping']), new Set(Object.values(TIMELINE_TAG_NOTES)));
  assert.ok(problems.some((problem) => /not a tag/.test(problem)));
});

test('validateTagMap rejects a mapping to a title that is not a note', () => {
  const tags = new Set(Object.keys(TIMELINE_TAG_NOTES));
  const problems = validateTagMap(tags, new Set(['Podping']));
  assert.ok(problems.some((problem) => /not a note/.test(problem)));
  assert.ok(!problems.some((problem) => /'podping' maps/.test(problem)));
});

test('validateTagMap passes when both vocabularies agree', () => {
  const tags = new Set(Object.keys(TIMELINE_TAG_NOTES));
  const titles = new Set(Object.values(TIMELINE_TAG_NOTES));
  assert.deepEqual(validateTagMap(tags, titles), []);
});

test('mentionsFor groups by episode, newest first, and joins episode facts', () => {
  const doc = {
    episodes: {
      46: { d: '2021-07-16', t: "Sliding into your PM's", a: 'https://example.com/PC20-46.mp3' },
      118: { d: '2023-02-24', t: 'Value Time Splits', a: 'https://example.com/PC20-118.mp3' },
    },
    coverage: { episodes: 266 },
    mentions: {
      splits: [
        { e: 46, t: 3898, s: 'm', x: 'First-ever boost' },
        { e: 118, t: 3840, s: 'c', x: 'Splits?' },
        { e: 118, s: 'n', x: 'Value time splits' },
      ],
    },
  };

  const got = mentionsFor(doc, 'splits');
  assert.equal(got.total, 3);
  assert.deepEqual(
    got.episodes.map((episode) => episode.number),
    [118, 46],
  );
  assert.equal(got.episodes[0].title, 'Value Time Splits');
  assert.equal(got.episodes[0].moments.length, 2);
  assert.equal(got.episodes[1].audioUrl, 'https://example.com/PC20-46.mp3');
});

test('mentionsFor is null for a note nothing was said about', () => {
  assert.equal(mentionsFor({ mentions: {} }, 'tor'), null);
  assert.equal(mentionsFor(null, 'tor'), null);
});

test('isMatchable excludes maps of content and opted-out notes', () => {
  assert.ok(isMatchable(note('Podping', 'podping')));
  assert.ok(!isMatchable(note('Nostr MOC', 'nostr-moc', { type: 'moc' })));
  assert.ok(!isMatchable(note('Podping', 'podping', { mentions: false })));
});

test('a per-note deny phrase rules out the company but not the protocol', () => {
  // Every RSS link on the timeline was RSS Blue or rss.com — hosting companies,
  // not the thing the note is about.
  assert.ok(denied('RSS', 'RSS Blue adds music'));
  assert.ok(denied('RSS', 'Welcome RSS.com'));
  assert.ok(!denied('RSS', 'NOSTR to replace RSS?'));
  assert.ok(!denied('Podping', 'RSS Blue adds music'), 'a phrase only denies the note it belongs to');
});

// A swap keeps the count identical, so comparing lengths reported "no change"
// while the citation under a note moved to a different moment.
test('diffMentions sees a moment swapped for another', () => {
  const was = { podping: [{ e: 100, t: 60, x: 'Podping goes live' }] };
  const now = { podping: [{ e: 100, t: 60, x: 'Podping rewritten in Rust' }] };

  const changes = diffMentions(now, was);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before, 1);
  assert.equal(changes[0].after, 1);
  assert.deepEqual(changes[0].added.map((m) => m.x), ['Podping rewritten in Rust']);
  assert.deepEqual(changes[0].removed.map((m) => m.x), ['Podping goes live']);
});

test('diffMentions sees a timestamp move, which changes where the link lands', () => {
  const was = { podping: [{ e: 100, t: 60, x: 'Podping goes live' }] };
  const now = { podping: [{ e: 100, t: 900, x: 'Podping goes live' }] };
  assert.equal(diffMentions(now, was).length, 1);
});

test('diffMentions stays quiet when nothing moved', () => {
  const mentions = { podping: [{ e: 100, t: 60, x: 'Podping goes live' }] };
  assert.deepEqual(diffMentions(mentions, structuredClone(mentions)), []);
});

test('diffMentions reports a note that lost every mention it had', () => {
  const changes = diffMentions({}, { podping: [{ e: 100, t: null, x: 'Podping goes live' }] });
  assert.deepEqual(changes.map((c) => [c.slug, c.before, c.after]), [['podping', 1, 0]]);
});
