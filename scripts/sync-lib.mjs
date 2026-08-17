/**
 * Mirroring the Obsidian vault into content/.
 *
 * The vault is the source of truth and lives in iCloud, where Chad edits it by
 * hand. Nothing here ever opens a vault file for writing: every path into the
 * vault is a read, and every write lands under content/. That is the whole
 * safety property, so it is worth stating plainly rather than leaving it to be
 * inferred from the code.
 *
 * The second property is that this mirrors rather than copies. A note deleted
 * in the vault has to disappear from the site; a copy-only sync would publish
 * it forever.
 */

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { load } from 'js-yaml';

/**
 * What gets published, as an allowlist.
 *
 * The vault is personal and the site is public, so the filter is written the
 * safe way round: anything not named here stays private. `templates/` is
 * scaffolding, `daily/` is a journal, and `README - Setup.md` documents Chad's
 * own Obsidian configuration.
 */
export function shouldPublish(relPath) {
  const segments = relPath.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return false;

  if (relPath === 'Home.md') return true;
  if (segments[0] === 'notes' && relPath.endsWith('.md')) return true;
  if (segments[0] === 'attachments' && segments.length > 1) return true;
  return false;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * A note can opt out of publication with `publish: false`. Malformed
 * frontmatter is not this script's problem to report — the build validates
 * that — so an unparseable header simply does not count as an opt-out.
 */
export function isOptedOut(source) {
  const match = source.match(FRONTMATTER);
  if (!match) return false;
  try {
    const data = load(match[1]);
    return Boolean(data && typeof data === 'object' && data.publish === false);
  } catch {
    return false;
  }
}

async function walk(dir, prefix = '') {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return found;
    throw err;
  }
  for (const entry of entries) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) found.push(...(await walk(join(dir, entry.name), rel)));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

async function exists(path) {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Works out what would change, without changing it.
 *
 * Comparison is on contents rather than timestamps: iCloud rewrites mtimes when
 * it syncs a file down, so timestamps report drift that is not there.
 */
export async function plan({ vault, content }) {
  if (!(await exists(vault))) {
    throw new Error(`vault not found: ${vault}`);
  }

  const unpublished = [];
  const desired = new Map();

  for (const rel of await walk(vault)) {
    if (!shouldPublish(rel)) continue;
    const body = await readFile(join(vault, rel));
    if (rel.endsWith('.md') && isOptedOut(body.toString('utf8'))) {
      unpublished.push(rel);
      continue;
    }
    desired.set(rel, body);
  }

  const existing = new Map();
  for (const rel of await walk(content)) {
    existing.set(rel, await readFile(join(content, rel)));
  }

  const written = [];
  for (const [rel, body] of desired) {
    const current = existing.get(rel);
    if (!current || !current.equals(body)) written.push(rel);
  }

  const deleted = [...existing.keys()].filter((rel) => !desired.has(rel));

  return {
    desired,
    written: written.sort(),
    deleted: deleted.sort(),
    unpublished: unpublished.sort(),
    inSync: written.length === 0 && deleted.length === 0,
  };
}

/** Applies a plan. The only writes in this module happen here, under content/. */
export async function applyPlan(result, { content }) {
  for (const rel of result.written) {
    const target = join(content, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, result.desired.get(rel));
  }
  for (const rel of result.deleted) {
    await rm(join(content, rel), { force: true });
  }
  return result;
}

export async function sync({ vault, content }) {
  return applyPlan(await plan({ vault, content }), { content });
}
