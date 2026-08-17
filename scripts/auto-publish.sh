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
#   - the vault is only ever read
#   - a build that fails validation publishes nothing and says so
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

# Two ways there is work to do: the vault moved ahead of content/, or a previous
# run synced but never got as far as committing — a build that failed, a machine
# that slept. Checking only the first would strand that change forever.
if "$NODE" scripts/sync.mjs --check >/dev/null 2>&1 && [ -z "$(git status --porcelain content/)" ]; then
  exit 0
fi

log "vault changed — syncing"
if ! "$NODE" scripts/sync.mjs; then
  log "sync failed"
  notify "Sync failed — see the log."
  exit 1
fi

# Nothing git can see means the change was to a file that is not published
# (a template, a daily note, a note marked publish: false).
if [ -z "$(git status --porcelain content/)" ]; then
  log "nothing publishable changed"
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

changed=$(git status --porcelain content/ | wc -l | tr -d ' ')
git add content/
git commit -q -m "Sync ${changed} note(s) from the vault" || {
  log "nothing to commit"
  exit 0
}
log "committed ${changed} file(s)"

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
