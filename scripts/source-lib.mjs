/**
 * Reading the sibling checkouts.
 *
 * Two generators now pull from repos next door — update-mentions.mjs and
 * update-timeline.mjs — and both need the same three things: a path that can be
 * overridden, a record of which commit it came from, and a refusal to quietly
 * write a half-empty file when a sibling is not checked out.
 *
 * The overridable path exists because of a bug next door:
 * pc20-timeline/scripts/build-episodes.mjs still defaults to
 * `../pc20-feed/pc20-archive.xml`, a directory that has not existed for a while,
 * and the only symptom is an ENOENT naming a path nobody recognises. So every
 * source here is printed before it is read, and a failure names the flag that
 * fixes it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';

const run = promisify(execFile);

export function flag(name) {
  return process.argv.includes(`--${name}`);
}

export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** `--flag`, then the env var, then a path relative to the repo root. */
export function sourcePath(root, name, env, fallback) {
  return resolve(arg(name) ?? process.env[env] ?? resolve(root, fallback));
}

/** A home-relative path, so a printed source is readable and not machine-specific. */
export function tilde(path) {
  const home = process.env.HOME;
  return home ? String(path).replace(home, '~') : String(path);
}

export function announce(sources) {
  console.log('reading:');
  const width = Math.max(...Object.keys(sources).map((id) => id.length)) + 2;
  for (const [id, target] of Object.entries(sources)) console.log(`  ${id.padEnd(width)}${tilde(target)}`);
  console.log('');
}

/** The commit and date a source came from, so a stale number reads as stale. */
export async function provenance(target) {
  const cwd = dirname(target);
  const git = async (args) => {
    try {
      const { stdout } = await run('git', args, { cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
  return {
    revision: await git(['rev-parse', '--short', 'HEAD']),
    updated: await git(['log', '-1', '--format=%cs', '--', target]),
  };
}

/**
 * What to do about a source that is not there.
 *
 * Fatal by default: overwriting a complete generated file with a partial one
 * strips sections off live pages with no signal anywhere. `--allow-missing`
 * says you meant it, and the absence is recorded so it shows in the diff.
 */
export function missing({ id, err, sources, flags }) {
  if (err.code !== 'ENOENT') throw err;
  const message = `${id}: not found at ${tilde(sources[id])} (override with ${flags[id]} or its env var)`;
  if (!flag('allow-missing')) throw new Error(`${message}\nPass --allow-missing to generate without it.`);
  console.warn(`  ! ${message}`);
  return null;
}
