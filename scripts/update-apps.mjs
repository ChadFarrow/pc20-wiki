#!/usr/bin/env node
/**
 * Refreshes data/apps.json — the Podcast Index apps directory, which is what
 * newpodcastapps.com now redirects to.
 *
 *   node scripts/update-apps.mjs                    # from the local web-ui checkout
 *   node scripts/update-apps.mjs --from <path>      # from another checkout
 *   node scripts/update-apps.mjs --url <url>        # straight from GitHub raw
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

const DEFAULT_SOURCE = resolve(
  process.env.HOME ?? '',
  'Vibe/web-ui/server/data/apps.json',
);

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
  const url = arg('url');
  let apps;
  let source;
  let updated = null;

  if (url) {
    const response = await fetch(url === 'upstream' ? UPSTREAM : url);
    if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
    apps = await response.json();
    source = url === 'upstream' ? UPSTREAM : url;
    updated = new Date().toISOString().slice(0, 10);
  } else {
    const path = arg('from') ? resolve(arg('from')) : DEFAULT_SOURCE;
    apps = JSON.parse(await readFile(path, 'utf8'));
    source = path.replace(process.env.HOME ?? '', '~');
    updated = await sourceDate(path);
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
