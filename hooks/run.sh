#!/bin/sh
# Locate a Node.js >= 18 binary and run the oh-my-agy hook. Antigravity's hook shell may not
# inherit nvm/homebrew PATH entries, so probe common locations. If Node is missing, fail open.
# Override with OMAGY_NODE=/absolute/path/to/node.
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
  cat >/dev/null
  if [ "$1" = "stop" ]; then echo '{"decision":"stop"}'; else echo '{}'; fi
  exit 0
fi
exec "$NODE" "$DIR/omagy-hook.mjs" "$@"
