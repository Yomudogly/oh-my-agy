#!/bin/sh
# Locate a Node.js >= 18 binary and run the oh-my-agy HUD sidecar.
# Antigravity's sidecar runner may not inherit nvm/homebrew PATH entries on macOS.
DIR=$(cd "$(dirname "$0")" && pwd)
NODE="${OMAGY_NODE:-}"
if [ -z "$NODE" ]; then
  NODE=$(command -v node 2>/dev/null)
fi
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.volta/bin/node "$HOME"/.local/share/fnm/aliases/default/bin/node; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_LATEST=$(ls -1d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -n 1)
  if [ -n "$NVM_LATEST" ] && [ -x "$NVM_LATEST" ]; then
    NODE="$NVM_LATEST"
  fi
fi
if [ -z "$NODE" ]; then
  echo "[oh-my-agy/hud] Node.js >= 18 not found; exiting." >&2
  exit 1
fi
exec "$NODE" "$DIR/main.mjs" "$@"
