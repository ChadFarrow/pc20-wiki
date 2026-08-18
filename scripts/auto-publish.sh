#!/bin/bash
#
# Publishes vault edits without being asked.
#
# Run by launchd: on changes under the vault, and on a timer as a backstop —
# kqueue reports directory entries appearing and disappearing, which catches
# most saves but is not a promise that every in-place edit fires an event.
# The timer costs a few hundred milliseconds when nothing has changed.
#
#   scripts/auto-publish.sh            # debounce, then publish if anything moved
#   scripts/auto-publish.sh --now      # skip the debounce
#
# The rules that matter:
#   - the vault is only ever read, and so are the sibling checkouts
#   - a build that fails validation publishes nothing and says so
#   - a sibling that is not checked out is skipped, not guessed at: the
#     committed data/ stands and the publish carries on
#   - no remote configured is fine; it commits and stops there

set -uo pipefail

# launchd starts jobs with a minimal PATH, and the pre-commit hook this triggers
# calls node by name.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE=/usr/local/bin/node
VAULT="${PC20_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/PC 2.0 hivemind}"
LOCK="/tmp/pc20-wiki-auto-publish.lock"
DEBOUNCE=45

cd "$REPO" || exit 1

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*"
}

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"PC 2.0 Wiki\"" >/dev/null 2>&1 || true
}

# One publish at a time. mkdir is atomic, so two launchd triggers racing each
# other end with one of them quietly stepping aside.
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

[ -d "$VAULT" ] || exit 0

# Let a burst of saves settle rather than publishing every keystroke Obsidian
# happens to flush to disk.
if [ "${1:-}" != "--now" ]; then
  sleep "$DEBOUNCE"
fi

# Three things can have moved: the vault, a sibling checkout the generators read,
# or a previous run that synced but never got as far as committing — a build that
# failed, a machine that slept. Checking only the first would strand the others.
vault_moved=0
"$NODE" scripts/sync.mjs --check >/dev/null 2>&1 || vault_moved=1

if [ "$vault_moved" = 1 ]; then
  log "vault changed — syncing"
  if ! "$NODE" scripts/sync.mjs; then
    log "sync failed"
    notify "Sync failed — see the log."
    exit 1
  fi
fi

# Regenerate before building, because the build reads what these write.
#
# This job used to sync, build and push without ever running the generators, so
# an alias added in Obsidian changed nothing until somebody remembered to run
# them by hand — and the only symptom was a section quietly citing the wrong
# episodes. Both take about a fifth of a second and both are deterministic, so a
# run with nothing to do writes nothing and commits nothing.
#
# A generator that cannot read its sources — no sibling checkout on this machine
# — is logged and skipped. It never writes a partial file (source-lib.mjs is
# fatal on a missing source by design), so the committed data stands and the
# publish carries on.
regenerate() {
  name="$1"
  shift
  if ! "$NODE" "$@" > "/tmp/pc20-wiki-$name.log" 2>&1; then
    # The Error: line, not the last line — the last line of a node stack trace
    # is its version number, which tells the reader nothing about what is wrong.
    reason=$(sed -n 's/^Error: //p' "/tmp/pc20-wiki-$name.log" | head -1)
    log "$name not regenerated: ${reason:-see /tmp/pc20-wiki-$name.log}"
  fi
}

regenerate mentions scripts/update-mentions.mjs
regenerate timeline scripts/update-timeline.mjs

# Nothing git can see means the vault change was to a file that is not published
# (a template, a daily note, a note marked publish: false) and no source moved.
if [ -z "$(git status --porcelain content/ data/)" ]; then
  [ "$vault_moved" = 1 ] && log "nothing publishable changed"
  exit 0
fi

# Not --strict. A note nothing links to yet, or a note that is still three
# sentences long, is what every note looks like the moment it is written —
# blocking publication on that would mean the automation fights the writing.
# Errors still stop everything; warnings are printed and published anyway.
if ! "$NODE" scripts/build.mjs > /tmp/pc20-wiki-build.log 2>&1; then
  log "build failed — publishing nothing"
  tail -20 /tmp/pc20-wiki-build.log | while read -r line; do log "  $line"; done
  notify "Build failed. The note has a problem; nothing was published."
  exit 1
fi

notes=$(git status --porcelain content/ | wc -l | tr -d ' ')
data=$(git status --porcelain data/ | wc -l | tr -d ' ')
git add content/ data/

# "Sync 0 note(s) from the vault" is what a run triggered by a sibling repo would
# otherwise say, and it would be a lie in the log everyone reads first.
if [ "$notes" -gt 0 ] && [ "$data" -gt 0 ]; then
  message="Sync ${notes} note(s) from the vault and refresh the episode data"
elif [ "$notes" -gt 0 ]; then
  message="Sync ${notes} note(s) from the vault"
else
  message="Refresh the episode data"
fi

git commit -q -m "$message" || {
  log "nothing to commit"
  exit 0
}
log "committed $((notes + data)) file(s): ${message}"

if git remote | grep -q .; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  if git push -q origin "$branch" 2>/dev/null; then
    log "pushed to origin/${branch}"
  else
    log "push failed — the commit is local, push it by hand"
    notify "Committed, but the push failed."
  fi
else
  log "no remote configured — commit is local"
fi
