/**
 * publish-push.sh is the last step of auto-publish.sh. From 2026-10-23 to 2026-10-30
 * every publish committed and none reached the site: a PR merged on GitHub left the
 * checkout behind, and a plain push is refused for as long as that lasts. These
 * tests run the script against a throwaway bare remote standing in for GitHub, with
 * a second clone playing the part of the PR that lands there first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/publish-push.sh', import.meta.url).pathname;
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();

async function commit(dir, file, text, message) {
  await writeFile(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
}

// remote.git is GitHub, checkout/ is this Mac, other/ is a PR merged on GitHub.
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'pc20-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  const checkout = join(root, 'checkout');
  const other = join(root, 'other');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, checkout);
  git(checkout, 'checkout', '-q', '-b', 'main');
  await commit(checkout, 'package.json', '{ "engines": ">=20" }\n', 'Start');
  await commit(checkout, 'data.json', '{ "episodes": 1 }\n', 'First data');
  git(checkout, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'clone', '-q', remote, other);
  return { remote, checkout, other };
}

const run = (dir) => {
  const r = spawnSync('bash', [SCRIPT], { cwd: dir, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const remoteMain = (remote) => git(remote, 'rev-parse', 'main');
const exists = (p) => access(p).then(() => true, () => false);

test('a commit with nothing new on GitHub is pushed', async (t) => {
  const { remote, checkout } = await setup(t);
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');

  const r = run(checkout);

  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, 'pushed to origin/main');
  assert.equal(remoteMain(remote), git(checkout, 'rev-parse', 'HEAD'));
});

test('a commit made while GitHub moved on is rebased onto it and pushed', async (t) => {
  const { remote, checkout, other } = await setup(t);
  await commit(other, 'package.json', '{ "engines": "^24.22.1" }\n', 'Require patched Node.js 24 (#5)');
  git(other, 'push', '-q', 'origin', 'main');
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');

  const r = run(checkout);

  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^pushed to origin\/main \(after rebasing onto 1 new commit\(s\) from GitHub\)$/);
  assert.equal(remoteMain(remote), git(checkout, 'rev-parse', 'HEAD'));
  assert.deepEqual(git(remote, 'log', '--format=%s', 'main').split('\n'),
    ['Refresh the episode data', 'Require patched Node.js 24 (#5)', 'First data', 'Start']);
  assert.equal(await readFile(join(checkout, 'package.json'), 'utf8'), '{ "engines": "^24.22.1" }\n');
});

test('a rebase that conflicts is abandoned and the commit stays local', async (t) => {
  const { remote, checkout, other } = await setup(t);
  await commit(other, 'data.json', '{ "episodes": 99 }\n', 'Hand edit on GitHub');
  git(other, 'push', '-q', 'origin', 'main');
  const before = remoteMain(remote);
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');
  const local = git(checkout, 'rev-parse', 'HEAD');

  const r = run(checkout);

  assert.equal(r.code, 1);
  assert.match(r.out, /rebase hit a conflict — the commit is local, push it by hand/);
  assert.equal(remoteMain(remote), before);
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), local);
  assert.equal(await exists(join(checkout, '.git', 'rebase-merge')), false);
  assert.equal(await exists(join(checkout, '.git', 'rebase-apply')), false);
  assert.equal(git(checkout, 'status', '--porcelain'), '');
});

test('uncommitted work in the checkout is never rebased under it', async (t) => {
  const { remote, checkout, other } = await setup(t);
  await commit(other, 'package.json', '{ "engines": "^24.22.1" }\n', 'Require patched Node.js 24 (#5)');
  git(other, 'push', '-q', 'origin', 'main');
  const before = remoteMain(remote);
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');
  await writeFile(join(checkout, 'package.json'), '{ "engines": ">=20", "wip": true }\n');

  const r = run(checkout);

  assert.equal(r.code, 1);
  assert.match(r.out, /uncommitted changes — the commit is local, push it by hand/);
  assert.equal(remoteMain(remote), before);
  assert.equal(await readFile(join(checkout, 'package.json'), 'utf8'), '{ "engines": ">=20", "wip": true }\n');
});

test('a branch GitHub does not have yet is pushed as before', async (t) => {
  const { remote, checkout } = await setup(t);
  git(checkout, 'checkout', '-q', '-b', 'drafts');
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');

  const r = run(checkout);

  assert.equal(r.code, 0, r.out);
  assert.equal(r.out, 'pushed to origin/drafts');
  assert.equal(git(remote, 'rev-parse', 'drafts'), git(checkout, 'rev-parse', 'HEAD'));
});

test('a GitHub that stalls is given up on, so the publish lock is not held for ever', async (t) => {
  const { checkout } = await setup(t);
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');
  // An ssh remote whose "ssh" never answers stands in for a hung connection. git
  // appends the host and command to GIT_SSH_COMMAND; the # keeps sleep from seeing them.
  git(checkout, 'remote', 'set-url', 'origin', 'ssh://stalled.invalid/repo.git');
  const started = Date.now();

  const r = spawnSync('bash', [SCRIPT], { cwd: checkout, encoding: 'utf8',
    env: { ...ENV, GIT_SSH_COMMAND: 'sleep 20 #', PC20_NETWORK_LIMIT: '1' } });

  assert.equal(r.status, 1);
  assert.match(r.stdout.trim(), /^fetch timed out after 1 s — the commit is local, push it by hand$/);
  assert.ok(Date.now() - started < 10_000, 'the script waited for the stalled fetch');
});

test('a push GitHub refuses says why', async (t) => {
  const { checkout } = await setup(t);
  await commit(checkout, 'data.json', '{ "episodes": 2 }\n', 'Refresh the episode data');
  git(checkout, 'remote', 'set-url', '--push', 'origin', join(checkout, 'no-such-remote.git'));

  const r = run(checkout);

  assert.equal(r.code, 1);
  assert.match(r.out, /^push failed — the commit is local, push it by hand: .+/);
});
