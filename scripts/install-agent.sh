#!/bin/bash
#
# Generates and loads the launchd agents:
#
#   com.chadfarrow.pc20-wiki-sync      publishes vault edits (auto-publish.sh)
#   com.chadfarrow.pc20-wiki-episodes  brings new episodes in (refresh-episodes.sh)
#
#   ./scripts/install-agent.sh              # install and load both
#   ./scripts/install-agent.sh --check      # print what would be written, change nothing
#
# The plists are generated rather than committed because they have to name absolute
# paths — this repo is public, and publishing someone's home directory layout
# buys nothing.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${PC20_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/PC 2.0 hivemind}"
LABELS=(com.chadfarrow.pc20-wiki-sync com.chadfarrow.pc20-wiki-episodes)

render() {
  sed -e "s|__REPO__|$REPO|g" -e "s|__VAULT__|$VAULT|g" -e "s|__HOME__|$HOME|g" "$REPO/launchd/$1.plist.template"
}

target() {
  echo "$HOME/Library/LaunchAgents/$1.plist"
}

if [ "${1:-}" = "--check" ]; then
  status=0
  for label in "${LABELS[@]}"; do
    if [ -f "$(target "$label")" ] && render "$label" | diff -q - "$(target "$label")" >/dev/null; then
      echo "$label: installed agent matches the template."
    elif [ -f "$(target "$label")" ]; then
      echo "$label: installed agent differs from the template:"
      render "$label" | diff - "$(target "$label")" || true
      status=1
    else
      echo "$label: not installed. Run ./scripts/install-agent.sh"
      status=1
    fi
  done
  exit $status
fi

[ -d "$VAULT" ] || echo "warning: vault not found at $VAULT — the publish agent will no-op until it is"

mkdir -p "$HOME/Library/LaunchAgents"
for label in "${LABELS[@]}"; do
  render "$label" > "$(target "$label")"
  launchctl unload "$(target "$label")" 2>/dev/null || true
  launchctl load "$(target "$label")"
  echo "installed and loaded $label"
done

echo "  repo:  $REPO"
echo "  vault: $VAULT"
echo "  logs:  $HOME/Library/Logs/pc20-wiki-sync.log, $HOME/Library/Logs/pc20-wiki-episodes.log"
