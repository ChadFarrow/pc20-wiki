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
 * the other four sources. captions/ is gitignored — 264 files at ~150 KB
 * is about 39 MB, and what gets committed is the derived JSON, as it already is for
 * mentions and the timeline.
 *
 * If the NAS share is mounted, copy from it first — it is the same data where it has
 * it, and free. It is not authoritative: it lags the server and carries the same
 * stubs, so whatever it cannot supply is still fetched.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, arg, tilde } from './source-lib.mjs';
import { captionEpisode, isStub } from './captions-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(
  arg('captions') ?? arg('out') ?? process.env.PC20_CAPTIONS ?? join(ROOT, 'captions'),
);
const NAS = '/Volumes/pc20-archive';
const HOST = 'https://mp3s.nashownotes.com';
const LAST = Number(arg('to') ?? 266);

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
 * do it by pulling all 264 files down again.
 */
async function state(target) {
  const text = await readFile(target, 'utf8').catch(() => null);
  if (text === null) return 'missing';
  return isStub(text) ? 'stub' : 'ready';
}

/**
 * Copy what the share already holds, so the network is asked for less.
 *
 * A pre-fill, not a substitute. The share is a copy someone made, and a copy goes
 * stale: when this was written it held 257 caption files to the cache's 264, missing
 * E260-E266 entirely, and carried the same eight "Transcript is Processing" stubs.
 * It is also no help for a stub — a stub there overwrites a stub here and nothing
 * moves. So take what is useful and let main() go to the server for the rest.
 */
async function fromNas() {
  try {
    const files = (await readdir(NAS)).filter((file) => captionEpisode(file) !== null);
    if (!files.length) return 0;
    let copied = 0;
    let stale = 0;
    for (const file of files) {
      const target = join(OUT, file);
      if (!flag('force') && (await state(target)) === 'ready') continue;

      // A stub for a stub is not a copy worth making: it rewrites the file, leaves
      // the cache exactly as short as it was, and reports as progress.
      const body = await readFile(join(NAS, file), 'utf8');
      if (isStub(body)) {
        stale += 1;
        continue;
      }
      await writeFile(target, body);
      copied += 1;
    }
    console.log(`copied ${copied} file(s) from ${NAS}`);
    if (stale) console.log(`${stale} still a stub there too — the server gets asked instead`);
    return files.length;
  } catch {
    return 0;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`writing to ${tilde(OUT)}\n`);

  // The share is a head start, never the whole job. It short-circuited to report()
  // here once, on the assumption in the header that it holds the same data. It does
  // not: it was seven episodes behind the server the day this was written, and it
  // carries the same stubs. Returning early meant a mounted share silently capped
  // the cache at whatever someone last copied onto it.
  await fromNas();

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

    // One bad episode must never end a run of ~266 sequential requests: a DNS
    // failure, a refused connection or a reset partway through takes down the
    // whole process otherwise, and report() never runs — so the operator learns
    // nothing about what did land. The cache itself is always fine either way
    // (writeFile only runs after the body has fully arrived), so the only job
    // here is to keep going and say what happened.
    try {
      const response = await fetch(`${HOST}/${name(episode)}`);
      if (response.status === 404) {
        missing += 1;
        continue;
      }
      if (!response.ok) {
        failed += 1;
        continue;
      }
      const body = await response.text();
      await writeFile(target, body);
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
  return report();
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

  // A short cache looks exactly like a complete one once the loop has stopped
  // at LAST. If the highest usable episode IS the ceiling, the show may well
  // have gone past it since --to was last chosen, and the fix is one flag.
  if (usable.length && Math.max(...usable) === LAST) {
    console.log(
      `highest usable episode (${LAST}) is the ceiling (--to ${LAST}) — the show may have moved past it; rerun with a higher --to`,
    );
  }
}

await main();
