#!/usr/bin/env node
/**
 * Refreshes data/timeline.json — the show's history, era by era.
 *
 *   node scripts/update-timeline.mjs
 *   node scripts/update-timeline.mjs --dry-run       # what would change
 *   node scripts/update-timeline.mjs --allow-missing
 *
 * pc20-timeline curates 204 milestones and the era vocabulary they sit in, but
 * that repo is private and undeployed, so the work exists where nobody can read
 * it. This copies it into the public wiki, cross-linked to the notes that
 * explain what each milestone was about.
 *
 * Milestones only. The mention data on each note already covers "when did they
 * talk about this", and folding 770 chapter titles in here would turn a history
 * into a log.
 *
 * Read-only on the siblings, no network, no NAS — same contract as
 * update-mentions.mjs, and committed for the same reason.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';

import { parseFrontmatter, slugify } from './wiki-lib.mjs';
import { flag, arg, sourcePath, announce, provenance, missing, tilde, writeGenerated } from './source-lib.mjs';
import { toSeconds } from './mentions-lib.mjs';
import { parseEras, buildTimeline, diffEntries, KINDS } from './timeline-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where each source lives — source-lib.mjs explains why each is overridable. */
const SOURCES = {
  milestones: sourcePath(ROOT, 'milestones', 'PC20_TIMELINE_MILESTONES', '../pc20-timeline/content/milestones'),
  eras: sourcePath(ROOT, 'eras', 'PC20_TIMELINE_ERAS', '../pc20-timeline/content/eras.yml'),
  episodes: sourcePath(ROOT, 'episodes', 'PC20_TIMELINE_EPISODES', '../pc20-timeline/data/episodes.json'),
};

const FLAGS = { milestones: '--milestones', eras: '--eras', episodes: '--episodes' };

/** A source that is not checked out — fatal unless --allow-missing. */
const fell = (id, err) => missing({ id, err, sources: SOURCES, flags: FLAGS });

/**
 * Milestone frontmatter and, where there is one, its body.
 *
 * A body that is still the seeded "TODO: add context for this milestone" is
 * dropped rather than published — a placeholder on the page is worse than a
 * bare entry. The rest are written from chapter titles and show notes, so they
 * carry the same provenance as everything else on the page.
 */
async function readMilestones(dir) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  const milestones = [];

  for (const file of files) {
    const id = basename(file, '.md');
    let data;
    let body;
    try {
      ({ data, body } = parseFrontmatter(await readFile(join(dir, file), 'utf8')));
    } catch {
      console.warn(`  ! ${file}: unreadable frontmatter, skipped`);
      continue;
    }

    if (!data.title || !Number.isInteger(data.episode)) {
      console.warn(`  ! ${file}: needs a title and an integer episode, skipped`);
      continue;
    }
    if (data.kind && !KINDS[data.kind]) {
      console.warn(`  ! ${file}: unknown kind '${data.kind}', skipped`);
      continue;
    }

    milestones.push({
      id,
      title: String(data.title),
      kind: data.kind ?? 'event',
      tags: Array.isArray(data.tags) ? data.tags : [],
      episode: data.episode,
      seconds: toSeconds(data.timestamp),
      body: /^TODO\b/i.test(String(body ?? '').trim()) ? null : String(body ?? '').trim() || null,
    });
  }

  return milestones;
}

async function readNotes(contentDir) {
  const dir = join(contentDir, 'notes');
  const notes = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const title = basename(file, '.md');
    try {
      const { data } = parseFrontmatter(await readFile(join(dir, file), 'utf8'));
      notes.push({ title, slug: slugify(title), data });
    } catch {
      /* the build reports unparseable notes; here one simply matches nothing */
    }
  }
  return notes;
}

/** Prints what diffEntries found; the rule itself lives in timeline-lib.mjs. */
function diff(next, previous) {
  const changes = diffEntries(next, previous);
  const mark = { added: '+', removed: '-', changed: '~' };

  for (const change of changes) {
    const { entry } = change;
    const fields = change.fields ? `  (${change.fields.join(', ')})` : '';
    console.log(`  ${mark[change.kind]} ${entry.date} E${entry.episode} ${entry.title}${fields}`);
    // A body is prose somebody wrote after a relisten. Losing one should read
    // as a loss, not as a field name in a list.
    if (change.was?.body && !entry.body) console.log(`      - body: ${change.was.body}`);
  }

  console.log(changes.length ? `\n${changes.length} entr(y|ies) changed.` : '\nno change.');
}

async function main() {
  const out = resolve(arg('out') ?? join(ROOT, 'data', 'timeline.json'));
  const content = sourcePath(ROOT, 'content', 'PC20_CONTENT', 'content');

  announce(SOURCES);

  const notes = await readNotes(content);
  const sources = [];
  let milestones = [];
  let eras = [];
  let episodes = {};

  try {
    milestones = await readMilestones(SOURCES.milestones);
    sources.push({
      id: 'milestones',
      path: tilde(SOURCES.milestones),
      ...(await provenance(SOURCES.milestones)),
      records: milestones.length,
    });
  } catch (err) {
    if (fell('milestones', err) === null) sources.push({ id: 'milestones', missing: true });
  }

  try {
    eras = parseEras(load(await readFile(SOURCES.eras, 'utf8')));
    sources.push({ id: 'eras', path: tilde(SOURCES.eras), ...(await provenance(SOURCES.eras)), records: eras.length });
  } catch (err) {
    if (fell('eras', err) === null) sources.push({ id: 'eras', missing: true });
  }

  try {
    const parsed = JSON.parse(await readFile(SOURCES.episodes, 'utf8'));
    for (const episode of parsed.episodes ?? []) {
      episodes[episode.number] = { d: episode.date, t: episode.title, a: episode.audioUrl };
    }
  } catch (err) {
    if (fell('episodes', err) === null) sources.push({ id: 'episodes', missing: true });
  }

  const { entries, dropped } = buildTimeline({ milestones, eras, episodes, notes });

  // Loud rather than silent: an entry that cannot be dated is an entry that
  // vanishes from the page, and a history with a hole in it should say so.
  for (const problem of dropped) console.warn(`  ! ${problem}`);

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    sources,
    kinds: KINDS,
    eras,
    entries,
  };

  if (flag('dry-run')) {
    let previous = null;
    try {
      previous = JSON.parse(await readFile(out, 'utf8')).entries;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    diff(entries, previous);
    return;
  }

  const moved = await writeGenerated(out, doc);
  if (!moved) console.log(`no change — ${tilde(out)} left alone`);

  const written = entries.filter((entry) => entry.body).length;
  const linked = entries.filter((entry) => entry.notes.length).length;
  const span = entries.length ? `${entries[0].date} to ${entries.at(-1).date}` : 'nothing';
  console.log(`wrote ${entries.length} entries (${span}) across ${new Set(entries.map((e) => e.era)).size} eras to ${tilde(out)}`);
  console.log(
    `${linked} link to a note, ${written} carry context${dropped.length ? `, ${dropped.length} dropped` : ''}`,
  );
}

await main();
