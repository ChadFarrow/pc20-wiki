#!/usr/bin/env node
/**
 * Refreshes data/apps.json — the Podcast Index apps directory, which is what
 * newpodcastapps.com now redirects to.
 *
 *   node scripts/update-apps.mjs                    # upstream master (the directory)
 *   node scripts/update-apps.mjs --from <path>      # a local checkout instead
 *   node scripts/update-apps.mjs --url <url>        # some other copy
 *
 * Upstream is the default on purpose. The local ~/Vibe/web-ui fork exists to
 * open PRs against this file, so it is a working branch rather than a mirror:
 * it lags whatever has merged since, and it can still hold entries that were
 * later removed upstream. Counting those would overstate adoption using apps
 * the directory no longer lists.
 *
 * The result is committed, for the same reason content/ is: the Vercel build
 * has neither the checkout nor a guarantee of network access, and a wiki that
 * silently loses its adoption numbers on deploy would be worse than one that
 * never had them.
 *
 * The file records where it came from and when, so a stale number is
 * identifiable as stale rather than being quietly presented as current.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const UPSTREAM =
  'https://raw.githubusercontent.com/Podcastindex-org/web-ui/master/server/data/apps.json';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

/** The date the source file last changed, so "updated" means something. */
async function sourceDate(path) {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%cs', '--', path], {
      cwd: dirname(path),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const from = arg('from');
  let apps;
  let source;
  let updated = null;

  if (from) {
    const path = resolve(from);
    apps = JSON.parse(await readFile(path, 'utf8'));
    source = path.replace(process.env.HOME ?? '', '~');
    updated = await sourceDate(path);
  } else {
    const url = arg('url') ?? UPSTREAM;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
    apps = await response.json();
    source = url;
    updated = new Date().toISOString().slice(0, 10);
  }

  if (!Array.isArray(apps)) throw new Error('expected an array of apps');

  // Only the fields the wiki actually renders. The full file is 125KB of icons
  // and taglines the site never shows.
  const trimmed = apps
    .map((app) => ({
      name: app.appName,
      elements: (app.supportedElements ?? []).map((element) => element.elementName).sort(),
    }))
    .filter((app) => app.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const out = join(ROOT, 'data', 'apps.json');
  await writeFile(out, `${JSON.stringify({ source, updated, apps: trimmed }, null, 1)}\n`);

  const elements = new Set(trimmed.flatMap((app) => app.elements));
  console.log(`wrote ${trimmed.length} apps and ${elements.size} elements to data/apps.json`);
  console.log(`source: ${source}${updated ? ` (updated ${updated})` : ''}`);
}

await main();
