#!/bin/bash
#
# Generates and loads the launchd agent that publishes vault edits.
#
#   ./scripts/install-agent.sh              # install and load
#   ./scripts/install-agent.sh --check      # print what would be written, change nothing
#
# The plist is generated rather than committed because it has to name absolute
# paths — this repo is public, and publishing someone's home directory layout
# buys nothing.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${PC20_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/PC 2.0 hivemind}"
LABEL="com.chadfarrow.pc20-wiki-sync"
TEMPLATE="$REPO/launchd/$LABEL.plist.template"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

render() {
  sed -e "s|__REPO__|$REPO|g" -e "s|__VAULT__|$VAULT|g" -e "s|__HOME__|$HOME|g" "$TEMPLATE"
}

if [ "${1:-}" = "--check" ]; then
  if [ -f "$TARGET" ] && render | diff -q - "$TARGET" >/dev/null; then
    echo "installed agent matches the template."
  elif [ -f "$TARGET" ]; then
    echo "installed agent differs from the template:"
    render | diff - "$TARGET" || true
    exit 1
  else
    echo "not installed. Run ./scripts/install-agent.sh"
    exit 1
  fi
  exit 0
fi

[ -d "$VAULT" ] || echo "warning: vault not found at $VAULT — the agent will no-op until it is"

mkdir -p "$HOME/Library/LaunchAgents"
render > "$TARGET"

launchctl unload "$TARGET" 2>/dev/null || true
launchctl load "$TARGET"

echo "installed and loaded $LABEL"
echo "  repo:  $REPO"
echo "  vault: $VAULT"
echo "  log:   $HOME/Library/Logs/pc20-wiki-sync.log"
