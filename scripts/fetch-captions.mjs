#!/usr/bin/env node
/**
 * Fills captions/ from the show's own server, so the generator does not have to.
 *
 *   node scripts/fetch-captions.mjs              # fetch what is missing or a stub
 *   node scripts/fetch-captions.mjs --force      # refetch everything
 *   node scripts/fetch-captions.mjs --to 266     # highest episode to try
 *   node scripts/fetch-captions.mjs --captions <dir>  # alias for --out, so an
 *                                                      # operator who types the
 *                                                      # flag Task 7's generator
 *                                                      # uses still gets it right
 *
 * This is the ONLY file here that uses the network, and that is the point:
 * update-mentions.mjs reads files and nothing else, the same contract it has for
 * the other four sources. captions/ is gitignored — 270 files at ~150 KB
 * is about 39 MB, and what gets committed is the derived JSON, as it already is for
 * mentions and the timeline.
 *
 * The server comes first. Where it leaves an episode without a usable
 * transcript — a "Transcript is Processing" stub, one of a byte-identical pair,
 * or no file at all — the pc20-archive project publishes one made with Whisper,
 * on GitHub Pages under the server's own file name, and that copy is kept in
 * captions/archive/. The server's file stays where it is, so collectCaptions can
 * prefer it again the day the server finishes; nothing here has to remember
 * which episodes were filled.
 *
 * Neither source is the NAS. The share at /Volumes/pc20-archive holds the same
 * files, and this once copied from it first. It no longer does: the share is the
 * owner's personal backup of what is on the internet, not an input to a public
 * site, and a backup that is unmounted, stale or hung must never decide what the
 * wiki publishes. The cost is one request per new episode.
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, arg, tilde, sourcePath } from './source-lib.mjs';
import { captionEpisode, collectCaptions, isStub } from './captions-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(
  arg('captions') ?? arg('out') ?? process.env.PC20_CAPTIONS ?? join(ROOT, 'captions'),
);
const HOST = 'https://mp3s.nashownotes.com';
const ARCHIVE = 'https://chadfarrow.github.io/pc20-archive/captions';
const ARCHIVE_DIR = join(OUT, 'archive');
const EPISODES = sourcePath(ROOT, 'episodes', 'PC20_TIMELINE_EPISODES', '../pc20-timeline/data/episodes.json');

/** A request that stalls must not hang an unattended run for ever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The newest episode to ask for.
 *
 * This was a literal 266 once. A copy off the NAS happened to carry E267-E272, so
 * the cache kept up — but from the server alone, no episode past the literal would
 * ever have been fetched, and the ceiling warning in report() was the only sign.
 * The episode list in pc20-timeline is rebuilt from the live feed, so it knows.
 */
async function lastEpisode() {
  if (arg('to')) return Number(arg('to'));
  try {
    const { episodes } = JSON.parse(await readFile(EPISODES, 'utf8'));
    return Math.max(...episodes.map((episode) => episode.number));
  } catch (err) {
    throw new Error(
      `cannot tell the newest episode: ${tilde(EPISODES)} unreadable (${err.code ?? err.message}) — pass --to <n>`,
    );
  }
}

/**
 * Write via a temp file and a rename.
 *
 * auto-publish.sh regenerates from this cache every 15 minutes, on its own
 * schedule. A plain writeFile over a file it is reading hands it half a
 * transcript, which it would commit. The temp name ends `.tmp`, so neither
 * captionEpisode() nor a generator ever sees it.
 */
async function writeAtomic(target, body) {
  const temp = join(dirname(target), `.${target.split('/').pop()}.tmp`);
  await writeFile(temp, body);
  await rename(temp, target);
}

/** PC20-7 is a 404 and PC20-07 is not; three digits go plain. */
const name = (episode) => `PC20-${episode < 10 ? `0${episode}` : episode}-Captions.srt`;

/**
 * What is on disk for this episode: `ready`, `stub`, or `missing`.
 *
 * The server publishes "Transcript is Processing ..." at the real URL, so a stub is a
 * file that exists and holds nothing. A plain existence test skips it for ever, and
 * the cache stays short at exactly the episodes most likely to have finished since —
 * eight of them when this was written. Reading the file to tell the two apart costs
 * one read per episode and lets an ordinary run heal the cache. `--force` could only
 * do it by pulling all 270 files down again.
 */
async function state(target) {
  const text = await readFile(target, 'utf8').catch(() => null);
  if (text === null) return 'missing';
  return isStub(text) ? 'stub' : 'ready';
}

let LAST;

async function main() {
  LAST = await lastEpisode();
  await mkdir(OUT, { recursive: true });
  console.log(`writing to ${tilde(OUT)}\n`);

  let fetched = 0;
  let missing = 0;
  let failed = 0;
  let retried = 0;
  let cleared = 0;
  for (let episode = 1; episode <= LAST; episode += 1) {
    const target = join(OUT, name(episode));

    // Read what is held before the request, not after: writeFile destroys the
    // evidence of what the file used to be, and a retried stub is the one outcome
    // an operator most wants named.
    const held = flag('force') ? 'missing' : await state(target);
    if (held === 'ready') continue;
    if (held === 'stub') retried += 1;

    // One bad episode must never end a run of ~270 sequential requests: a DNS
    // failure, a refused connection or a reset partway through takes down the
    // whole process otherwise, and report() never runs — so the operator learns
    // nothing about what did land. The cache itself is always fine either way
    // (writeFile only runs after the body has fully arrived), so the only job
    // here is to keep going and say what happened.
    try {
      const response = await fetch(`${HOST}/${name(episode)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        missing += 1;
        continue;
      }
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const body = await response.text();
      await writeAtomic(target, body);
      fetched += 1;
      if (held === 'stub' && !isStub(body)) cleared += 1;
      if (fetched % 25 === 0) console.log(`  ${fetched} fetched…`);
    } catch {
      failed += 1;
    }
  }
  console.log(`\nfetched ${fetched}, ${missing} not published`);
  if (retried) {
    console.log(
      `retried ${retried} stub(s): ${cleared} now have a transcript, ${retried - cleared} not yet`,
    );
  }
  if (failed) console.log(`${failed} failed — rerun to pick them up`);
  await fillFromArchive();
  return report();
}

/** A folder's caption files as `{ name, text }`, the shape collectCaptions reads. */
async function readCache(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const files = [];
  for (const file of names.filter((entry) => captionEpisode(entry) !== null).sort()) {
    files.push({ name: file, text: await readFile(join(dir, file), 'utf8') });
  }
  return files;
}

/**
 * Ask pc20-archive for every episode the server leaves without a transcript.
 *
 * The gaps are worked out with collectCaptions, the rule the generators use, so
 * this asks for exactly what they would read. A copy already held is kept, like
 * a server file (`--force` asks again). A 404 is normal — the archive makes a
 * transcript only for the episodes it was asked to — and costs one request per
 * run until one appears.
 */
async function fillFromArchive() {
  const served = await readCache(OUT);
  const { stubs, duplicates } = collectCaptions(served);
  const held = new Set(served.map((file) => captionEpisode(file.name)));
  const absent = Array.from({ length: LAST }, (_, i) => i + 1).filter((episode) => !held.has(episode));
  const gaps = [...new Set([...stubs, ...duplicates, ...absent])].sort((a, b) => a - b);
  if (!gaps.length) return;
  await mkdir(ARCHIVE_DIR, { recursive: true });

  let fetched = 0;
  let kept = 0;
  let failed = 0;
  const none = [];
  for (const episode of gaps) {
    const target = join(ARCHIVE_DIR, name(episode));
    if (!flag('force') && (await state(target)) === 'ready') {
      kept += 1;
      continue;
    }
    try {
      const response = await fetch(`${ARCHIVE}/${name(episode)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        none.push(episode);
        continue;
      }
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const body = await response.text();
      if (isStub(body)) {
        none.push(episode);
        continue;
      }
      await writeAtomic(target, body);
      fetched += 1;
    } catch {
      failed += 1;
    }
  }
  console.log(
    `pc20-archive: ${gaps.length} episode(s) with no usable transcript on the server — ` +
      `fetched ${fetched}, ${kept} already held${none.length ? `, none for ${none.join(', ')}` : ''}`,
  );
  if (failed) console.log(`pc20-archive: ${failed} failed — rerun to pick them up`);
}

/** What the generator will actually be able to read. */
async function report() {
  const files = (await readdir(OUT)).filter((file) => captionEpisode(file) !== null);
  const stubs = [];
  const usable = [];
  for (const file of files) {
    const episode = captionEpisode(file);
    if (isStub(await readFile(join(OUT, file), 'utf8'))) {
      stubs.push(episode);
    } else {
      usable.push(episode);
    }
  }
  stubs.sort((a, b) => a - b);
  console.log(`${files.length} file(s) in ${tilde(OUT)}, ${files.length - stubs.length} usable`);
  if (stubs.length) console.log(`still processing: ${stubs.join(', ')}`);

  const { archived, stubs: open, duplicates } = collectCaptions(await readCache(OUT), await readCache(ARCHIVE_DIR));
  if (archived.length) console.log(`read from pc20-archive instead: ${archived.join(', ')}`);
  const unsearchable = [...open, ...duplicates].sort((a, b) => a - b);
  if (unsearchable.length) console.log(`no usable transcript anywhere: ${unsearchable.join(', ')}`);

  // A short cache looks exactly like a complete one once the loop has stopped
  // at LAST. If the highest usable episode IS the ceiling, the show may well
  // have gone past it since --to was last chosen, and the fix is one flag.
  // Only a hand-picked --to can be behind the show; the default comes from the
  // episode list, and saying this on every run would teach people to ignore it.
  if (arg('to') && usable.length && Math.max(...usable) === LAST) {
    console.log(
      `highest usable episode (${LAST}) is the ceiling (--to ${LAST}) — the show may have moved past it; rerun with a higher --to`,
    );
  }
}

await main();
