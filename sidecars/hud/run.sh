#!/bin/sh
# Locate a Node.js >= 18 binary and run the oh-my-agy HUD sidecar.
# Antigravity's sidecar runner may not inherit nvm/homebrew PATH entries on macOS/Linux/Windows.
case "$0" in
  */*) DIR="${0%/*}" ;;
  *) DIR="." ;;
esac
DIR=$(cd "${DIR:-.}" && pwd)
NODE="${OMAGY_NODE:-}"
if [ -z "$NODE" ]; then
  NODE=$(command -v node 2>/dev/null)
fi
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
    "$HOME"/.volta/bin/node "$HOME"/.local/share/fnm/aliases/default/bin/node \
    "${PROGRAMFILES:-/nonexistent}/nodejs/node.exe" \
    "${LOCALAPPDATA:-/nonexistent}/Programs/nodejs/node.exe"; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  for nvm_cand in "$HOME"/.nvm/versions/node/v*/bin/node; do
    if [ -x "$nvm_cand" ]; then NODE="$nvm_cand"; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "[oh-my-agy/hud] Node.js >= 18 not found; exiting." >&2
  exit 1
fi
exec "$NODE" "$DIR/main.mjs" "$@"
