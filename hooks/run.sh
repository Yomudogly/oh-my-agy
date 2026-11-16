#!/bin/sh
# Locate a Node.js >= 18 binary and run the oh-my-agy hook. Antigravity's hook shell may not
# inherit nvm/homebrew PATH entries, so probe common locations without external dirname/sort/cat.
# Override with OMAGY_NODE=/absolute/path/to/node.
_s0="$0"
while :; do
  case "$_s0" in
    *\\*) _s0="${_s0%%\\*}/${_s0#*\\}" ;;
    *) break ;;
  esac
done
case "$_s0" in
  */*) DIR="${_s0%/*}" ;;
  *) DIR="." ;;
esac
DIR=$(cd "${DIR:-.}" && pwd)
NODE=""
if [ -n "${OMAGY_NODE:-}" ]; then
  if [ -x "$OMAGY_NODE" ]; then NODE="$OMAGY_NODE"; else NODE=$(command -v "$OMAGY_NODE" 2>/dev/null || true); fi
else
  NODE=$(command -v node 2>/dev/null)
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
fi
if [ -z "$NODE" ]; then
  _omagy_host="${OMAGY_HOST:-}"
  _prev=""
  for _a in "$@"; do
    case "$_a" in
      --host=claude|--host=codex|--host=antigravity) _omagy_host="${_a#--host=}" ;;
    esac
    if [ "$_prev" = "--host" ]; then _omagy_host="$_a"; fi
    _prev="$_a"
  done
  case "${1:-}" in
    session-start|pre-invocation|user-prompt-submit|pre-tool-use|post-tool-use|subagent-start|subagent-stop|pre-compact|post-compact|stop|"")
      while IFS= read -r _omagy_line || [ -n "$_omagy_line" ]; do :; done
      if [ "${1:-}" = "stop" ] && [ "$_omagy_host" != "claude" ] && [ "$_omagy_host" != "codex" ]; then echo '{"decision":"stop"}'; else echo '{}'; fi
      exit 0
      ;;
    *)
      echo '{"ok":false,"error":"node_not_found"}'
      exit 2
      ;;
  esac
fi
exec "$NODE" "$DIR/omagy-hook.mjs" "$@"
