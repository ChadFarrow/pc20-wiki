#!/usr/bin/env node
/**
 * Refreshes data/transcripts/ — the text the transcript search runs over.
 *
 *   node scripts/update-transcripts.mjs                  # write data/transcripts/
 *   node scripts/update-transcripts.mjs --dry-run        # say what would change, write nothing
 *   node scripts/update-transcripts.mjs --allow-missing  # a missing source is a warning
 *
 * One plain-text file per episode, `NNN.txt`, each line `seconds<TAB>text`, and
 * an `index.json` of episode facts and coverage. Committed, because the search
 * runs in a Vercel function and Vercel never sees the caption cache.
 *
 * The raw SRTs stay out of git (captions/ is still in .gitignore): they carry
 * cue numbers and end times the search never reads, and they are 39 MB to this
 * 27 MB. One file per episode rather than one big one because an episode's text
 * does not change once it is transcribed, so a new episode is a new file and
 * git stores every old one once — a single compressed file would be a new 10 MB
 * blob in history every week.
 *
 * The same caption rules as update-mentions.mjs, through the same
 * collectCaptions: a "Transcript is Processing" stub is skipped, and the two
 * byte-identical pairs the server publishes (50/51, 248/249) are dropped both,
 * because one of each is not that episode and nothing says which. Where
 * captions/archive/ holds pc20-archive's Whisper transcript for such an episode,
 * or for one the server never published, that is read instead, and the episode
 * is listed on `coverage.archived` so the page can say where its text came from.
 *
 * A file is removed only for a reason: its episode became a stub, a duplicate
 * or a collision. An episode that is merely absent from the cache keeps its
 * committed text — a cache filled on another machine, or half-filled, must not
 * be able to delete transcripts from the live search.
 */

import { readFile, readdir, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, sourcePath, announce, missing, tilde, writeGenerated } from './source-lib.mjs';
import { collectCaptions } from './captions-lib.mjs';
import { corpusName, corpusEpisode, formatCorpus } from './transcripts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/transcripts');

const SOURCES = {
  captions: sourcePath(ROOT, 'captions', 'PC20_CAPTIONS', 'captions'),
  episodes: sourcePath(ROOT, 'episodes', 'PC20_TIMELINE_EPISODES', '../pc20-timeline/data/episodes.json'),
};

const FLAGS = { captions: '--captions', episodes: '--episodes' };

const fell = (id, err) => missing({ id, err, sources: SOURCES, flags: FLAGS });

/** The caption cache — read like every other source, from files, never the network. */
async function readCaptions(dir) {
  const names = (await readdir(dir)).filter((file) => /-Captions\.srt$/i.test(file)).sort();
  const files = [];
  for (const name of names) files.push({ name, text: await readFile(join(dir, name), 'utf8') });
  return files;
}

/**
 * pc20-archive's Whisper transcripts, which fetch-captions.mjs keeps in
 * captions/archive/ for the episodes the server has none for. No folder is no
 * archive, not an error: every episode then stands on the server's file alone.
 */
async function readArchive(dir) {
  try {
    return await readCaptions(join(dir, 'archive'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** What is committed now: episode → file text. */
async function readCorpus(dir) {
  const corpus = new Map();
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const name of names.sort()) {
    const episode = corpusEpisode(name);
    if (episode !== null) corpus.set(episode, await readFile(join(dir, name), 'utf8'));
  }
  return corpus;
}

async function main() {
  announce(SOURCES);

  let files;
  let archive;
  try {
    files = await readCaptions(SOURCES.captions);
    archive = await readArchive(SOURCES.captions);
  } catch (err) {
    fell('captions', err);
    // --allow-missing: with no cache there is nothing to say about any episode,
    // and an empty corpus would delete the lot. Leave what is committed.
    console.warn('  ! no caption cache — data/transcripts/ left alone');
    return;
  }

  const { candidates, stubs, duplicates, collisions, archived } = collectCaptions(files, archive);
  if (archived.length) console.log(`  from pc20-archive, none usable on the server: ${archived.join(', ')}`);
  if (stubs.length) console.warn(`  ! still processing, no transcript: ${stubs.join(', ')}`);
  if (duplicates.length) console.warn(`  ! same file served twice, episode unknowable: ${duplicates.join(', ')}`);
  if (collisions.length) console.warn(`  ! two files named the same episode, kept the first: ${collisions.join(', ')}`);

  // collectCaptions emits cues in file order, one episode at a time.
  const fresh = new Map();
  for (const { episode, seconds, text } of candidates) {
    if (!fresh.has(episode)) fresh.set(episode, []);
    fresh.get(episode).push({ seconds, text });
  }

  const previous = await readCorpus(OUT);
  const next = new Map(previous);
  const dropped = new Set([...stubs, ...duplicates, ...collisions]);
  for (const episode of dropped) next.delete(episode);
  for (const [episode, cues] of fresh) next.set(episode, formatCorpus(cues));

  const kept = [...previous.keys()].filter((e) => !fresh.has(e) && !dropped.has(e));
  if (kept.length) console.warn(`  ! not in the caption cache, kept the committed text: ${kept.join(', ')}`);

  const added = [...next.keys()].filter((e) => !previous.has(e));
  const changed = [...next.keys()].filter((e) => previous.has(e) && previous.get(e) !== next.get(e));
  const removed = [...previous.keys()].filter((e) => !next.has(e));
  const sort = (list) => list.sort((a, b) => a - b);
  sort(added);
  sort(changed);
  sort(removed);

  let facts = {};
  let unpublished = [];
  try {
    const { episodes } = JSON.parse(await readFile(SOURCES.episodes, 'utf8'));
    // Episodes the show released with no caption file at all — not a stub, not a
    // duplicate, simply absent from the server.
    unpublished = episodes
      .map((episode) => episode.number)
      .filter((e) => !next.has(e) && !dropped.has(e));
    for (const episode of episodes) {
      if (next.has(episode.number)) facts[episode.number] = { d: episode.date, t: episode.title, a: episode.audioUrl };
    }
  } catch (err) {
    if (fell('episodes', err) === null) {
      // Keep the committed facts rather than publish a search with no titles.
      try {
        const committed = JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8'));
        facts = committed.episodes ?? {};
        unpublished = committed.coverage?.unpublished ?? [];
      } catch {
        facts = {};
      }
    }
  }

  const numbers = sort([...next.keys()]);
  const cues = numbers.reduce((sum, e) => sum + next.get(e).split('\n').length - 1, 0);
  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    coverage: {
      episodes: numbers.length,
      newest: numbers.at(-1) ?? null,
      cues,
      stubs,
      duplicates,
      collisions,
      unpublished: sort(unpublished),
      archived,
    },
    episodes: Object.fromEntries(numbers.filter((e) => facts[e]).map((e) => [e, facts[e]])),
  };

  const say = (label, list) => list.length && console.log(`  ${label}: ${list.map((e) => `E${e}`).join(', ')}`);

  if (flag('dry-run')) {
    if (!added.length && !changed.length && !removed.length) console.log('no change');
    say('would add', added);
    say('would change', changed);
    say('would remove', removed);
    return;
  }

  await mkdir(OUT, { recursive: true });
  for (const episode of [...added, ...changed]) await writeFile(join(OUT, corpusName(episode)), next.get(episode));
  for (const episode of removed) await unlink(join(OUT, corpusName(episode)));
  const moved = await writeGenerated(join(OUT, 'index.json'), doc);

  if (!added.length && !changed.length && !removed.length && !moved) {
    console.log(`no change — ${tilde(OUT)} left alone`);
  }
  say('added', added);
  say('changed', changed);
  say('removed', removed);
  console.log(`${numbers.length} episodes, ${cues} cues in ${tilde(OUT)} (newest E${doc.coverage.newest})`);
}

await main();
