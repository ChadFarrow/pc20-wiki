/**
 * The show's history as one chronology.
 *
 * pc20-timeline holds 204 milestones — the first boost, the day keysend was
 * deprecated, the launch of each app — each pinned to an episode. They are not
 * a compilation from other sources: they came from relistening to the whole run
 * from E1 and noting what mattered, which makes a milestone title primary
 * evidence and a stronger source than any chapter title annotating it. That
 * repo is private and undeployed, so the work exists but nobody can read it.
 * This turns those entries into a page on the public wiki, cross-linked to the
 * notes that explain what each one was about.
 *
 * Milestones only, deliberately. The mention data on each note already answers
 * "when did they talk about this", and a chapter title like "Podping fun" is a
 * moment, not a milestone — mixing the two would turn a history into a log.
 *
 * Pure functions over plain objects, same rule as wiki-lib.mjs and
 * mentions-lib.mjs, so the placement rules are testable without a filesystem.
 */

import { formsFor, matchesForm, isMatchable, denied, TIMELINE_TAG_NOTES } from './mentions-lib.mjs';

/** The labels pc20-timeline's eras.yml gives each `kind`, and the order to show them in. */
export const KINDS = {
  first: 'First time',
  launch: 'Launch',
  death: 'Shut down',
  spec: 'Spec',
  event: 'Event',
};

/**
 * eras.yml, normalised.
 *
 * `start` is unquoted in the YAML, so js-yaml parses it into a Date and a naive
 * toISOString would shift it a day either side of UTC. Slicing the string form
 * keeps the date the file actually says.
 */
export function parseEras(doc) {
  return (doc?.eras ?? []).map((era) => ({
    id: era.id,
    title: era.title,
    start: String(era.start instanceof Date ? era.start.toISOString() : era.start).slice(0, 10),
    blurb: era.blurb ?? null,
  }));
}

/**
 * The last era that had started by this date.
 *
 * Placement is by date rather than by episode range, which is what makes the
 * eras gapless by construction — the same rule pc20-timeline uses, kept
 * identical so the two never disagree about which era something belongs to.
 */
export function eraForDate(eras, date) {
  let match = null;
  for (const era of eras) if (era.start <= date) match = era;
  return match;
}

/** Which wiki notes a milestone is about — the same rules the mentions matcher uses. */
export function notesForEntry(notes, title, tags) {
  const tagged = new Set((tags ?? []).map((tag) => TIMELINE_TAG_NOTES[tag]).filter(Boolean));
  return notes
    .filter(isMatchable)
    .filter((note) => !denied(note.title, title))
    .filter((note) => tagged.has(note.title) || formsFor(note).some((form) => matchesForm(form, title)))
    .map((note) => ({ slug: note.slug, title: note.title }));
}

/**
 * Milestones + eras + episode facts → the chronology the page renders.
 *
 * An entry whose episode is not in the index is dropped rather than guessed at:
 * without a date it cannot be placed in an era, and a milestone in the wrong
 * decade is worse than a missing one. Same for a date before the first era
 * starts, which pc20-timeline treats as a hard error.
 */
export function buildTimeline({ milestones, eras, episodes, notes }) {
  const entries = [];
  const dropped = [];

  for (const milestone of milestones) {
    const episode = episodes[String(milestone.episode)];
    if (!episode?.d) {
      dropped.push(`${milestone.id}: episode ${milestone.episode} is not in the episode index`);
      continue;
    }

    const era = eraForDate(eras, episode.d);
    if (!era) {
      dropped.push(`${milestone.id}: ${episode.d} falls before the first era starts`);
      continue;
    }

    entries.push({
      id: milestone.id,
      title: milestone.title,
      kind: milestone.kind,
      tags: milestone.tags ?? [],
      episode: milestone.episode,
      episodeTitle: episode.t ?? null,
      date: episode.d,
      seconds: milestone.seconds ?? null,
      audioUrl: episode.a ?? null,
      era: era.id,
      body: milestone.body ?? null,
      notes: notesForEntry(notes, milestone.title, milestone.tags),
    });
  }

  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.episode - b.episode ||
      (a.seconds ?? Infinity) - (b.seconds ?? Infinity) ||
      a.id.localeCompare(b.id),
  );

  return { entries, dropped };
}

/**
 * Entries grouped under their era, oldest first, empty eras dropped.
 *
 * Oldest first because this is a history and it should read as one — the
 * opposite of the mention list on a note, which is newest first because it is a
 * capped citation list and the recent end is the useful slice. An era with no
 * entries is dropped rather than shown empty: `present` starts at E252 and
 * nothing has been curated there yet.
 */
export function groupByEra(eras, entries) {
  return eras
    .map((era, i) => ({ ...era, index: i + 1, entries: entries.filter((entry) => entry.era === era.id) }))
    .filter((era) => era.entries.length);
}

/**
 * What a regeneration would change, field by field.
 *
 * This compared title and episode only, and the blind spot cost 34 milestone
 * bodies: a checkout whose milestone files had gone back to `TODO` regenerated
 * into a file carrying one body instead of 34, and `--dry-run` called it
 * "no change". A guard that cannot see the loss it exists to catch is worse
 * than no guard, because it is believed. The comparison is now the whole entry.
 */
export function diffEntries(next, previous) {
  const before = new Map((previous ?? []).map((entry) => [entry.id, entry]));
  const after = new Map(next.map((entry) => [entry.id, entry]));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changes = [];

  for (const [id, entry] of after) {
    const was = before.get(id);
    if (!was) {
      changes.push({ kind: 'added', entry });
      continue;
    }
    const fields = [...new Set([...Object.keys(was), ...Object.keys(entry)])]
      .filter((field) => !same(was[field], entry[field]))
      .sort();
    if (fields.length) changes.push({ kind: 'changed', entry, was, fields });
  }
  for (const [id, entry] of before) if (!after.has(id)) changes.push({ kind: 'removed', entry });

  return changes;
}
