#!/usr/bin/env node
/**
 * Refreshes data/mentions.json — which episodes of the show discussed each note.
 *
 *   node scripts/update-mentions.mjs                  # write data/mentions.json
 *   node scripts/update-mentions.mjs --dry-run        # diff against the committed file
 *   node scripts/update-mentions.mjs --report         # every matched moment, by note
 *   node scripts/update-mentions.mjs --report --only rss
 *   node scripts/update-mentions.mjs --allow-missing  # build from whatever is present
 *
 * Reads four sibling checkouts and writes one file. The result is committed for
 * the same reason data/apps.json is: the Vercel build has neither the siblings
 * nor a guarantee of network access, and a wiki that silently lost its episode
 * citations on deploy would be worse than one that never had them.
 *
 * Nothing here touches the network, and nothing here reads the NAS. Every
 * source is a file in a git checkout — which is also why the transcripts are
 * not a source, however much better they would be.
 *
 * The report is the quality gate, not the tests. Matching 3,000-odd hand-written
 * labels against 60 note titles goes wrong in ways only reading it catches, so
 * run `--report`, read it, and add to EXTRA_DENY or the note's `aliases:` until
 * it reads clean.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';

import { parseFrontmatter, slugify } from './wiki-lib.mjs';
import { flag, arg, sourcePath, announce, provenance, missing, tilde, writeGenerated } from './source-lib.mjs';
import {
  collectChapters,
  collectShowNotes,
  collectMilestones,
  collectClips,
  dedupeClips,
  buildMentions,
  diffMentions,
  validateTagMap,
  formsFor,
  isMatchable,
  toStamp,
} from './mentions-lib.mjs';
import { collectCaptions, buildTranscriptMentions, captionEpisode } from './captions-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where each source lives — source-lib.mjs explains why each is overridable. */
const SOURCES = {
  chapters: sourcePath(ROOT, 'chapters', 'PC20_ARCHIVE_CHAPTERS', '../pc20-archive/chapters'),
  shownotes: sourcePath(ROOT, 'feed', 'PC20_ARCHIVE_FEED', '../pc20-archive/pc20-archive.xml'),
  milestones: sourcePath(ROOT, 'milestones', 'PC20_TIMELINE_MILESTONES', '../pc20-timeline/content/milestones'),
  episodes: sourcePath(ROOT, 'episodes', 'PC20_TIMELINE_EPISODES', '../pc20-timeline/data/episodes.json'),
  eras: sourcePath(ROOT, 'eras', 'PC20_TIMELINE_ERAS', '../pc20-timeline/content/eras.yml'),
  clips: sourcePath(ROOT, 'checklist', 'PC20_CLIPS_CHECKLIST', '../pc20-clips/pc2-clip-checklist.md'),
  captions: sourcePath(ROOT, 'captions', 'PC20_CAPTIONS', 'captions'),
};

const FLAGS = {
  chapters: '--chapters',
  shownotes: '--feed',
  milestones: '--milestones',
  episodes: '--episodes',
  eras: '--eras',
  clips: '--checklist',
  captions: '--captions',
};

const SOURCE_LABELS = { c: 'chapter', n: 'show notes', m: 'timeline', k: 'clip note', t: 'transcript' };

/** A source that is not checked out — fatal unless --allow-missing. */
const fell = (id, err) => missing({ id, err, sources: SOURCES, flags: FLAGS });

/**
 * The notes, read directly rather than through build.mjs.
 *
 * build.mjs exports loadNotes but also calls main() at module scope, so
 * importing it would run a build. This needs less anyway: titles, slugs and
 * frontmatter. Validating the notes is the build's job, and a note too broken
 * to parse simply contributes no mentions rather than stopping the generator.
 */
async function readNotes(contentDir) {
  const dir = join(contentDir, 'notes');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();

  const notes = [];
  for (const file of files) {
    const title = basename(file, '.md');
    try {
      const { data } = parseFrontmatter(await readFile(join(dir, file), 'utf8'));
      notes.push({ title, slug: slugify(title), data });
    } catch {
      console.warn(`  ! notes/${file}: unreadable frontmatter, skipped`);
    }
  }
  return notes;
}

async function readChapters(dir) {
  const files = (await readdir(dir)).filter((file) => /-Chapters\.json$/i.test(file)).sort();
  const parsed = [];
  for (const name of files) {
    parsed.push({ name, json: JSON.parse(await readFile(join(dir, name), 'utf8')) });
  }
  return { files: parsed, count: files.length };
}

/**
 * The caption cache.
 *
 * Read like every other source — from files, never the network. Filling the
 * cache is scripts/fetch-captions.mjs's job, and it is the only thing here that
 * is allowed to reach out.
 */
async function readCaptions(dir) {
  const names = (await readdir(dir)).filter((file) => /-Captions\.srt$/i.test(file)).sort();
  const files = [];
  for (const name of names) files.push({ name, text: await readFile(join(dir, name), 'utf8') });
  return files;
}

async function readMilestones(dir) {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.md')).sort();
  const entries = [];
  for (const file of files) {
    try {
      entries.push(parseFrontmatter(await readFile(join(dir, file), 'utf8')));
    } catch {
      console.warn(`  ! ${file}: unreadable frontmatter, skipped`);
    }
  }
  return entries;
}

function report(mentions, notes, only) {
  const titles = new Map(notes.map((note) => [note.slug, note.title]));
  for (const [slug, list] of Object.entries(mentions)) {
    if (only && slug !== only) continue;
    const episodes = new Set(list.map((mention) => mention.e));
    console.log(`\n## ${titles.get(slug) ?? slug}  —  ${list.length} moments, ${episodes.size} episodes`);
    for (const mention of list) {
      const stamp = mention.t == null ? '' : ` ${toStamp(mention.t)}`;
      console.log(`  E${String(mention.e).padStart(3)}${stamp.padEnd(9)} [${SOURCE_LABELS[mention.s]}] ${mention.x}`);
    }
  }
}

/** Prints what diffMentions found; the rule itself lives in mentions-lib.mjs. */
function diff(next, previous) {
  const changes = diffMentions(next, previous);

  for (const change of changes) {
    const delta = change.after - change.before;
    const count = delta === 0
      ? `${change.after}, swapped`
      : `${change.before} → ${change.after} (${delta > 0 ? '+' : ''}${delta})`;
    console.log(`  ${change.slug}: ${count}`);
    for (const mention of change.added) console.log(`      + E${mention.e} ${mention.x}`);
    for (const mention of change.removed) console.log(`      - E${mention.e} ${mention.x}`);
  }

  console.log(changes.length ? `\n${changes.length} note(s) changed.` : '\nno change.');
}

async function main() {
  const out = resolve(arg('out') ?? join(ROOT, 'data', 'mentions.json'));
  const content = sourcePath(ROOT, 'content', 'PC20_CONTENT', 'content');

  announce(SOURCES);

  const notes = await readNotes(content);
  const candidates = [];
  const sources = [];

  const record = async (id, count) => {
    sources.push({ id, path: tilde(SOURCES[id]), ...(await provenance(SOURCES[id])), records: count });
  };

  try {
    const { files, count } = await readChapters(SOURCES.chapters);
    candidates.push(...collectChapters(files));
    await record('chapters', count);
  } catch (err) {
    if (fell('chapters', err) === null) sources.push({ id: 'chapters', missing: true });
  }

  try {
    const xml = await readFile(SOURCES.shownotes, 'utf8');
    candidates.push(...collectShowNotes(xml));
    await record('shownotes', (xml.match(/<item>/g) ?? []).length);
  } catch (err) {
    if (fell('shownotes', err) === null) sources.push({ id: 'shownotes', missing: true });
  }

  let milestones = [];
  let timelineTags = new Set();
  try {
    const entries = await readMilestones(SOURCES.milestones);
    milestones = collectMilestones(entries);
    candidates.push(...milestones);
    await record('milestones', entries.length);

    const eras = load(await readFile(SOURCES.eras, 'utf8'));
    timelineTags = new Set(Object.keys(eras?.tags ?? {}));
  } catch (err) {
    if (fell('milestones', err) === null) sources.push({ id: 'milestones', missing: true });
  }

  try {
    const clips = dedupeClips(collectClips(await readFile(SOURCES.clips, 'utf8')), milestones);
    candidates.push(...clips);
    await record('clips', clips.length);
  } catch (err) {
    if (fell('clips', err) === null) sources.push({ id: 'clips', missing: true });
  }

  // A typo on either side of the tag map costs a note its mentions forever and
  // reads as "they never discussed it" — the same failure the element check in
  // build.mjs exists to prevent.
  const problems = validateTagMap(timelineTags, new Set(notes.map((note) => note.title)));
  if (problems.length) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${problems.length} problem(s) in TIMELINE_TAG_NOTES`);
  }

  const mentions = buildMentions(notes, candidates);

  // Captions are consulted only where the curated sources said nothing, so this
  // has to run after them and be given what they found.
  let transcripts = {};
  let stubs = [];
  let duplicates = [];
  try {
    const files = await readCaptions(SOURCES.captions);
    const collected = collectCaptions(files);
    stubs = collected.stubs;
    duplicates = collected.duplicates;
    transcripts = buildTranscriptMentions(notes, collected.candidates, mentions);
    sources.push({
      id: 'captions',
      path: tilde(SOURCES.captions),
      episodes: files.length - stubs.length - duplicates.length,
      newest: Math.max(0, ...files.map((file) => captionEpisode(file.name) ?? 0)),
      stubs,
      duplicates,
      records: collected.candidates.length,
    });
    if (stubs.length) console.warn(`  ! still processing, no transcript: ${stubs.join(', ')}`);
    // Two URLs, one transcript. Named rather than dropped in silence, for the
    // same reason a stub is: "nothing was said" and "we have no transcript"
    // are different facts.
    if (duplicates.length) console.warn(`  ! same file served twice, episode unknowable: ${duplicates.join(', ')}`);
  } catch (err) {
    if (fell('captions', err) === null) sources.push({ id: 'captions', missing: true });
  }

  // Merge, curated first inside each note, then by episode.
  //
  // Four keys, not three. Ties on episode, timestamp and source are real: 36
  // of them today, all show-notes mentions with no timestamp that differ only
  // in their text. Without the fourth key those ties come out in the order
  // buildMentions already sorted them into, but only because sort is stable
  // and that upstream order happens to be there — not because this sort
  // guarantees it. data/mentions.json is committed and determinism is a
  // stated constraint, so the order here has to be explicit, not incidental.
  for (const [slug, list] of Object.entries(transcripts)) {
    (mentions[slug] ??= []).push(...list);
    mentions[slug].sort(
      (a, b) =>
        a.e - b.e ||
        (a.t ?? Infinity) - (b.t ?? Infinity) ||
        a.s.localeCompare(b.s) ||
        a.x.localeCompare(b.x),
    );
  }

  let episodeFacts = {};
  let total = 0;
  try {
    const { episodes } = JSON.parse(await readFile(SOURCES.episodes, 'utf8'));
    total = episodes.length;
    const cited = new Set(Object.values(mentions).flat().map((mention) => mention.e));
    for (const episode of episodes) {
      if (!cited.has(episode.number)) continue;
      episodeFacts[episode.number] = { d: episode.date, t: episode.title, a: episode.audioUrl };
    }
  } catch (err) {
    if (fell('episodes', err) === null) sources.push({ id: 'episodes', missing: true });
  }

  if (flag('report')) {
    report(mentions, notes, arg('only'));
    return;
  }

  const cited = new Set(Object.values(mentions).flat().map((mention) => mention.e));
  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    sources,
    coverage: {
      episodes: total,
      // What the reader is told on the page: not every episode has curated
      // notes, and an empty section usually means the sources stop rather than
      // that the subject never came up.
      withSources: new Set(candidates.map((candidate) => candidate.episode)).size,
      newest: cited.size ? Math.max(...cited) : null,
      transcripts: Object.values(transcripts).reduce((sum, list) => sum + list.length, 0),
    },
    episodes: Object.fromEntries(
      Object.entries(episodeFacts).sort(([a], [b]) => Number(a) - Number(b)),
    ),
    // A fingerprint of what the match ran against, so build.mjs can tell when an
    // alias was added in the vault but never regenerated here.
    notes: Object.fromEntries(
      notes.filter(isMatchable).map((note) => [note.slug, { title: note.title, forms: formsFor(note) }]),
    ),
    mentions,
  };

  if (flag('dry-run')) {
    let previous = null;
    try {
      previous = JSON.parse(await readFile(out, 'utf8')).mentions;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    diff(mentions, previous);
    return;
  }

  const moved = await writeGenerated(out, doc);
  if (!moved) console.log(`no change — ${tilde(out)} left alone`);

  const pairs = Object.values(mentions).reduce((sum, list) => sum + list.length, 0);
  console.log(
    `wrote ${pairs} mentions across ${Object.keys(mentions).length} notes ` +
      `and ${Object.keys(doc.episodes).length} episodes to ${tilde(out)}`,
  );
  console.log(`from ${candidates.length} candidates in ${sources.filter((s) => !s.missing).length} sources`);
}

await main();
