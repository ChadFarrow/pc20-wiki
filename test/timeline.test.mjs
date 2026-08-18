import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEras, eraForDate, notesForEntry, buildTimeline, groupByEra } from '../scripts/timeline-lib.mjs';

const ERAS = [
  { id: 'genesis', title: 'Genesis', start: '2020-08-28', blurb: 'A new namespace.' },
  { id: 'boosts', title: 'Boosts', start: '2021-07-09', blurb: null },
  { id: 'present', title: 'The present day', start: '2026-03-06', blurb: null },
];

const EPISODES = {
  1: { d: '2020-08-28', t: 'We are upgrading podcasting', a: 'https://example.com/PC20-01.mp3' },
  46: { d: '2021-07-16', t: "Sliding into your PM's", a: 'https://example.com/PC20-46.mp3' },
};

const note = (title, slug, data = {}) => ({ title, slug, data: { type: 'concept', ...data } });

test('parseEras keeps the date the file says, not the one UTC would give', () => {
  // js-yaml turns an unquoted 2020-08-28 into a Date; a naive conversion in a
  // negative-offset timezone would render it as the 27th.
  const eras = parseEras({ eras: [{ id: 'genesis', title: 'Genesis', start: new Date('2020-08-28T00:00:00Z') }] });
  assert.equal(eras[0].start, '2020-08-28');
  assert.equal(eras[0].blurb, null);
});

test('an entry lands in the last era that had started', () => {
  assert.equal(eraForDate(ERAS, '2020-09-01').id, 'genesis');
  assert.equal(eraForDate(ERAS, '2021-07-09').id, 'boosts', 'the era start date is inside that era');
  assert.equal(eraForDate(ERAS, '2021-07-08').id, 'genesis');
  assert.equal(eraForDate(ERAS, '2020-08-01'), null, 'before the run began');
});

test('notesForEntry links a milestone to the notes it names', () => {
  const notes = [note('Boost', 'boost'), note('Tor', 'tor'), note('Nostr MOC', 'nostr-moc', { type: 'moc' })];
  assert.deepEqual(notesForEntry(notes, 'First-ever boost', []), [{ slug: 'boost', title: 'Boost' }]);
  // The same length threshold the mention matcher uses: "Tor" must not match
  // "Podfather story time" here either.
  assert.deepEqual(notesForEntry(notes, 'Podfather story time', []), []);
});

test('notesForEntry honours the same deny phrases the mention matcher uses', () => {
  const notes = [note('RSS', 'rss')];
  assert.deepEqual(notesForEntry(notes, 'RSS Blue and Fountain merging', []), []);
  assert.deepEqual(notesForEntry(notes, 'NOSTR to replace RSS?', []), [{ slug: 'rss', title: 'RSS' }]);
});

test('notesForEntry trusts a curator tag over the words in the title', () => {
  const notes = [note('Value 4 Value', 'value-4-value')];
  assert.deepEqual(notesForEntry(notes, 'Adam floats a new split', ['v4v']), [
    { slug: 'value-4-value', title: 'Value 4 Value' },
  ]);
});

test('buildTimeline dates each entry from its episode and sorts chronologically', () => {
  const { entries, dropped } = buildTimeline({
    milestones: [
      { id: 'first-ever-boost', title: 'First-ever boost', kind: 'first', tags: ['boosts'], episode: 46, seconds: 3898 },
      { id: 'liftoff', title: 'We have liftoff', kind: 'event', tags: [], episode: 1, seconds: null },
    ],
    eras: ERAS,
    episodes: EPISODES,
    notes: [note('Boost', 'boost')],
  });

  assert.deepEqual(dropped, []);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['liftoff', 'first-ever-boost'],
  );
  assert.equal(entries[1].date, '2021-07-16');
  assert.equal(entries[1].era, 'boosts');
  assert.equal(entries[1].episodeTitle, "Sliding into your PM's");
  assert.deepEqual(entries[1].notes, [{ slug: 'boost', title: 'Boost' }]);
});

test('buildTimeline drops an entry it cannot date, and says which', () => {
  const { entries, dropped } = buildTimeline({
    milestones: [{ id: 'ghost', title: 'Ghost', kind: 'event', tags: [], episode: 999, seconds: null }],
    eras: ERAS,
    episodes: EPISODES,
    notes: [],
  });

  assert.deepEqual(entries, []);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /ghost: episode 999 is not in the episode index/);
});

test('buildTimeline drops an entry that predates the first era', () => {
  const { dropped } = buildTimeline({
    milestones: [{ id: 'prehistory', title: 'Before', kind: 'event', tags: [], episode: 1, seconds: null }],
    eras: [{ id: 'later', title: 'Later', start: '2022-01-01' }],
    episodes: EPISODES,
    notes: [],
  });
  assert.match(dropped[0], /falls before the first era starts/);
});

test('groupByEra runs oldest first, numbers the eras and drops the empty ones', () => {
  const entries = [
    { id: 'a', era: 'boosts' },
    { id: 'b', era: 'genesis' },
  ];
  const grouped = groupByEra(ERAS, entries);

  assert.deepEqual(
    grouped.map((era) => era.id),
    ['genesis', 'boosts'],
    'a history reads forwards',
  );
  assert.deepEqual(
    grouped.map((era) => era.index),
    [1, 2],
    'numbering follows the full era list, not the filtered one',
  );
  assert.ok(!grouped.some((era) => era.id === 'present'));
});

test('groupByEra numbers by position in the run, not by how many survived', () => {
  const grouped = groupByEra(ERAS, [{ id: 'a', era: 'present' }]);
  assert.deepEqual(
    grouped.map((era) => [era.id, era.index]),
    [['present', 3]],
  );
});

test('buildTimeline carries a milestone body through to the entry', () => {
  const { entries } = buildTimeline({
    milestones: [
      { id: 'a', title: 'A', kind: 'event', tags: [], episode: 1, seconds: null, body: 'Sourced context.' },
      { id: 'b', title: 'B', kind: 'event', tags: [], episode: 1, seconds: null },
    ],
    eras: ERAS,
    episodes: EPISODES,
    notes: [],
  });
  assert.equal(entries.find((e) => e.id === 'a').body, 'Sourced context.');
  assert.equal(entries.find((e) => e.id === 'b').body, null, 'no body is null, never undefined');
});
