#!/usr/bin/env node
/**
 * Fills captions/ from the show's own server, so the generator does not have to.
 *
 *   node scripts/fetch-captions.mjs              # fetch what is missing
 *   node scripts/fetch-captions.mjs --force      # refetch everything
 *   node scripts/fetch-captions.mjs --to 266     # highest episode to try
 *
 * This is the ONLY file here that uses the network, and that is the point:
 * update-mentions.mjs reads files and nothing else, the same contract it has for
 * the other four sources. captions/ is gitignored — about 250 files at ~165 KB
 * is 41 MB, and what gets committed is the derived JSON, as it already is for
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
const OUT = resolve(arg('out') ?? process.env.PC20_CAPTIONS ?? join(ROOT, 'captions'));
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
  for (let episode = 1; episode <= LAST; episode += 1) {
    const target = join(OUT, name(episode));
    if (!flag('force') && (await stat(target).catch(() => null))) continue;

    const response = await fetch(`${HOST}/${name(episode)}`);
    if (!response.ok) {
      missing += 1;
      continue;
    }
    await writeFile(target, await response.text());
    fetched += 1;
    if (fetched % 25 === 0) console.log(`  ${fetched} fetched…`);
  }
  console.log(`\nfetched ${fetched}, ${missing} not published`);
  return report();
}

/** What the generator will actually be able to read. */
async function report() {
  const files = (await readdir(OUT)).filter((file) => captionEpisode(file) !== null);
  const stubs = [];
  for (const file of files) {
    if (parseSrt(await readFile(join(OUT, file), 'utf8')).length < CAPTION_MIN_CUES) {
      stubs.push(captionEpisode(file));
    }
  }
  stubs.sort((a, b) => a - b);
  console.log(`${files.length} file(s) in ${tilde(OUT)}, ${files.length - stubs.length} usable`);
  if (stubs.length) console.log(`still processing: ${stubs.join(', ')}`);
}

await main();
