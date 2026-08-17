#!/usr/bin/env node
/**
 * Mirrors the Obsidian vault into content/.
 *
 *   node scripts/sync.mjs              # copy vault -> content
 *   node scripts/sync.mjs --check      # report drift, change nothing, exit 1 if behind
 *
 * The vault path comes from --vault, then PC20_VAULT, then the iCloud default.
 *
 * --check is deliberately forgiving about a missing vault: the same command runs
 * on Vercel, which has no iCloud and must build from committed content alone.
 * A plain sync with no vault is an error, because it was asked to copy something.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { plan, applyPlan } from './sync-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_VAULT = resolve(
  process.env.HOME ?? '',
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/PC 2.0 hivemind',
);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
}

const VAULT = arg('vault', process.env.PC20_VAULT ? resolve(process.env.PC20_VAULT) : DEFAULT_VAULT);
const CONTENT = arg('content', resolve(ROOT, 'content'));
const check = process.argv.includes('--check');

async function vaultPresent() {
  try {
    await readdir(VAULT);
    return true;
  } catch {
    return false;
  }
}

function list(label, items) {
  if (!items.length) return;
  console.log(`${label} (${items.length}):`);
  for (const item of items) console.log(`  ${item}`);
}

async function main() {
  if (!(await vaultPresent())) {
    if (check) {
      console.log(`vault not mounted at ${VAULT} — skipping drift check.`);
      console.log('Building from committed content/, which is what Vercel does.');
      return;
    }
    console.error(`vault not found: ${VAULT}`);
    console.error('Pass --vault <path> or set PC20_VAULT.');
    process.exitCode = 1;
    return;
  }

  const result = await plan({ vault: VAULT, content: CONTENT });

  list('unpublished (publish: false)', result.unpublished);

  if (check) {
    if (result.inSync) {
      console.log('content/ is up to date with the vault.');
      return;
    }
    list('out of date', result.written);
    list('deleted in the vault', result.deleted);
    console.error('\ncontent/ is behind the vault. Run `npm run sync`.');
    process.exitCode = 1;
    return;
  }

  await applyPlan(result, { content: CONTENT });

  list('updated', result.written);
  list('removed', result.deleted);
  if (result.inSync) console.log('content/ was already up to date.');
  else console.log(`\nsynced ${result.written.length} file(s), removed ${result.deleted.length}.`);
}

await main();
