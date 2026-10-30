#!/bin/bash
#
# The push at the end of auto-publish.sh. Prints one line for its log and exits 0
# only when the commit reached GitHub.
#
#   scripts/publish-push.sh      # run from the checkout, on the branch to push
#
# A merge on GitHub — a PR, a dependency bump — leaves this checkout behind, and a
# plain push is then refused as non-fast-forward on every run until someone looks.
# From 2026-10-23 to 2026-10-30 every publish committed and none reached the site,
# and the log said only "push failed": git's own reason went to /dev/null. So this
# puts the new commits on top of GitHub's first, and passes git's reason on.
#
# The rules that matter:
#   - a rebase that conflicts is abandoned at once; the commit stays local, exactly
#     as before this script existed
#   - a checkout with uncommitted changes is never rebased, so work in progress is
#     never touched
#   - a branch GitHub does not have yet is simply pushed
#   - the fetch and the push each run under a time limit: auto-publish.sh holds its
#     lock while this runs, so a stalled connection would otherwise stop every note
#     publishing (the reason refresh-episodes.sh lives outside the lock)

set -uo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
err=$(mktemp)
trap 'rm -f "$err"' EXIT

local_only="the commit is local, push it by hand"
LIMIT="${PC20_NETWORK_LIMIT:-120}"

# macOS has no timeout(1). perl's alarm survives exec, and SIGALRM ends the process
# with status 142. Same as refresh-episodes.sh.
limit() {
  perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$LIMIT" "$@"
}

limit git fetch -q origin 2>"$err"
status=$?
if [ "$status" = 142 ]; then
  echo "fetch timed out after ${LIMIT} s — ${local_only}"
  exit 1
elif [ "$status" != 0 ]; then
  echo "fetch failed — ${local_only}: $(tail -1 "$err")"
  exit 1
fi

rebased=""
if git rev-parse --verify -q "refs/remotes/origin/${branch}" >/dev/null \
  && ! git merge-base --is-ancestor "origin/${branch}" HEAD; then
  behind=$(git rev-list --count "HEAD..origin/${branch}")
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "behind origin/${branch} by ${behind} and the checkout has uncommitted changes — ${local_only}"
    exit 1
  fi
  if ! git rebase -q "origin/${branch}" >"$err" 2>&1; then
    git rebase --abort 2>/dev/null
    echo "behind origin/${branch} by ${behind} and the rebase hit a conflict — ${local_only}"
    exit 1
  fi
  rebased=" (after rebasing onto ${behind} new commit(s) from GitHub)"
fi

limit git push -q origin "$branch" 2>"$err"
status=$?
if [ "$status" = 0 ]; then
  echo "pushed to origin/${branch}${rebased}"
elif [ "$status" = 142 ]; then
  echo "push timed out after ${LIMIT} s — ${local_only}"
  exit 1
else
  reason=$(grep -m1 -E 'rejected|error|fatal' "$err" || tail -1 "$err")
  echo "push failed — ${local_only}: ${reason}"
  exit 1
fi
