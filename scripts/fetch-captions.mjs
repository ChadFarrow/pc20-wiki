#!/usr/bin/env node
/**
 * Fills captions/ from the show's own server, so the generator does not have to.
 *
 *   node scripts/fetch-captions.mjs              # fetch what is missing
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
 * If the NAS share is mounted, use it and fetch nothing. It is the same data.
 */
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, arg, tilde } from './source-lib.mjs';
import { captionEpisode, parseSrt, CAPTION_MIN_CUES } from './captions-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(
  arg('captions') ?? arg('out') ?? process.env.PC20_CAPTIONS ?? join(ROOT, 'captions'),
);
const NAS = '/Volumes/pc20-archive';
const HOST = 'https://mp3s.nashownotes.com';
const LAST = Number(arg('to') ?? 266);

/** PC20-7 is a 404 and PC20-07 is not; three digits go plain. */
const name = (episode) => `PC20-${episode < 10 ? `0${episode}` : episode}-Captions.srt`;

async function fromNas() {
  try {
    const files = (await readdir(NAS)).filter((file) => captionEpisode(file) !== null);
    if (!files.length) return 0;
    let copied = 0;
    for (const file of files) {
      const target = join(OUT, file);
      if (!flag('force') && (await stat(target).catch(() => null))) continue;
      await writeFile(target, await readFile(join(NAS, file)));
      copied += 1;
    }
    console.log(`copied ${copied} file(s) from ${NAS}`);
    return files.length;
  } catch {
    return 0;
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`writing to ${tilde(OUT)}\n`);

  if (await fromNas()) return report();

  let fetched = 0;
  let missing = 0;
  let failed = 0;
  for (let episode = 1; episode <= LAST; episode += 1) {
    const target = join(OUT, name(episode));
    if (!flag('force') && (await stat(target).catch(() => null))) continue;

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
      await writeFile(target, await response.text());
      fetched += 1;
      if (fetched % 25 === 0) console.log(`  ${fetched} fetched…`);
    } catch {
      failed += 1;
    }
  }
  console.log(`\nfetched ${fetched}, ${missing} not published`);
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
    if (parseSrt(await readFile(join(OUT, file), 'utf8')).length < CAPTION_MIN_CUES) {
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
