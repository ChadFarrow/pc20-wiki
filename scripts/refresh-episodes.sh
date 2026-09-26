#!/bin/bash
#
# Brings a new episode into the wiki's inputs, without being asked.
#
# Run by launchd every 6 hours (launchd/com.chadfarrow.pc20-wiki-episodes.plist.template):
#
#   1. pc20-timeline: rebuild data/episodes.json from the live feed, and commit it
#      when an episode was added or changed.
#   2. here: fill captions/ from the show's server.
#
# It does not build or publish. auto-publish.sh runs every generator on every run
# (at most 15 minutes apart) and publishes whatever moved, so a new episode reaches
# the mentions and the transcript search on its next pass.
#
# Kept apart from auto-publish.sh on purpose. This job talks to two remote servers,
# and either can stall. auto-publish holds a lock while it runs, so a stall inside it
# would stop notes publishing too. Here a stall costs only this job, and every step
# has a time limit.
#
# It does not touch the NAS. The share at /Volumes/pc20-archive is the owner's
# personal backup, kept by pc20-archive/sync-nas.mjs; the wiki takes everything
# from the internet, so the backup's state never reaches the public site.
#
#   scripts/refresh-episodes.sh

set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMELINE="${PC20_TIMELINE:-$REPO/../pc20-timeline}"
NODE=/usr/local/bin/node

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $*"
}

# macOS has no timeout(1). perl's alarm survives exec, and SIGALRM ends the process.
limit() {
  local seconds="$1"
  shift
  perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$seconds" "$@"
}

# ---- 1. the episode list ----------------------------------------------------

if [ -d "$TIMELINE/.git" ]; then
  cd "$TIMELINE" || exit 1
  if limit 180 "$NODE" scripts/build-episodes.mjs > /tmp/pc20-refresh-episodes.log 2>&1; then
    # build-episodes stamps `generated` on every run, so the file always differs.
    # Only a changed line other than that stamp is news.
    if git diff -U0 -- data/episodes.json | grep '^[-+] ' | grep -qv '"generated"'; then
      newest=$("$NODE" -p 'require("./data/episodes.json").episodes.at(-1).number')
      branch=$(git rev-parse --abbrev-ref HEAD)
      # Pushing would also publish any commit of the author's that is not pushed
      # yet. Only push when this commit is the only thing ahead of origin.
      ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo unknown)
      git commit -q -m "Refresh the episode data to E${newest}" -- data/episodes.json
      log "pc20-timeline: episode list now reaches E${newest}"
      if [ "$branch" = main ] && [ "$ahead" = 0 ]; then
        git push -q origin main 2>/dev/null && log "pc20-timeline: pushed" || log "pc20-timeline: push failed — the commit is local"
      else
        log "pc20-timeline: committed, not pushed (on $branch, $ahead other commit(s) ahead of origin)"
      fi
    else
      git checkout -q -- data/episodes.json
    fi
  else
    # A failed or timed-out build has written nothing (it writes last), but make sure.
    git checkout -q -- data/episodes.json 2>/dev/null
    log "episode list not refreshed: $(tail -1 /tmp/pc20-refresh-episodes.log)"
  fi
else
  log "no pc20-timeline checkout at $TIMELINE — episode list not refreshed"
fi

# ---- 2. the caption cache ---------------------------------------------------

cd "$REPO" || exit 1

before=$(ls captions 2>/dev/null | wc -l | tr -d ' ')
if limit 900 "$NODE" scripts/fetch-captions.mjs > /tmp/pc20-refresh-captions.log 2>&1; then
  after=$(ls captions | wc -l | tr -d ' ')
  summary=$(grep -E '^[0-9]+ file\(s\) in' /tmp/pc20-refresh-captions.log | head -1)
  [ "$after" != "$before" ] && log "captions: ${summary}"
  # A stub that became a transcript changes no count, so name it separately.
  healed=$(sed -n 's/^retried [0-9]* stub(s): \([1-9][0-9]*\) now have a transcript.*/\1/p' /tmp/pc20-refresh-captions.log)
  [ -n "$healed" ] && log "captions: ${healed} stub(s) now have a transcript"
else
  log "captions not refreshed: $(tail -1 /tmp/pc20-refresh-captions.log)"
  exit 1
fi
exit 0
