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
node_ge_18() {
  [ -n "${1:-}" ] && [ -x "$1" ] || return 1
  case "$("$1" -v 2>/dev/null)" in
    v1[89].*|v[2-9][0-9].*|v[1-9][0-9][0-9].*) return 0 ;;
    *) return 1 ;;
  esac
}
NODE=""
if [ -n "${OMAGY_NODE:-}" ]; then
  _cand="$OMAGY_NODE"
  if [ ! -x "$_cand" ]; then _cand=$(command -v "$OMAGY_NODE" 2>/dev/null || true); fi
  if node_ge_18 "$_cand"; then NODE="$_cand"; fi
else
  if [ "${OMAGY_SKIP_SYSTEM_NODE:-0}" != "1" ]; then
    _cand=$(command -v node 2>/dev/null || true)
    if node_ge_18 "$_cand"; then NODE="$_cand"; fi
    if [ -z "$NODE" ]; then
      for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
        "${PROGRAMFILES:-/nonexistent}/nodejs/node.exe" \
        "${LOCALAPPDATA:-/nonexistent}/Programs/nodejs/node.exe"; do
        if node_ge_18 "$c"; then NODE="$c"; break; fi
      done
    fi
  fi
  if [ -z "$NODE" ]; then
    for c in \
      "$HOME"/.volta/bin/node \
      "$HOME"/.local/share/fnm/aliases/default/bin/node \
      "$HOME"/.fnm/aliases/default/bin/node \
      "$HOME"/.local/share/mise/shims/node \
      "$HOME"/.asdf/shims/node \
      "$HOME"/.nodenv/shims/node; do
      if node_ge_18 "$c"; then NODE="$c"; break; fi
    done
  fi
  if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
    _best_maj=-1
    _best_min=-1
    _best_pat=-1
    for nvm_cand in "$HOME"/.nvm/versions/node/v*/bin/node; do
      [ -x "$nvm_cand" ] || continue
      _ver="${nvm_cand%/bin/node}"
      _ver="${_ver##*/v}"
      case "$_ver" in
        *.*.*) _maj="${_ver%%.*}"; _rest="${_ver#*.}"; _min="${_rest%%.*}"; _pat="${_rest#*.}" ;;
        *.*) _maj="${_ver%%.*}"; _min="${_ver#*.}"; _pat=0 ;;
        *) continue ;;
      esac
      _pat="${_pat%%[!0-9]*}"
      case "$_maj:$_min:$_pat" in
        *[!0-9:]*|*::*|:*|*:) continue ;;
      esac
      [ "$_maj" -ge 18 ] 2>/dev/null || continue
      if [ "$_maj" -gt "$_best_maj" ] \
        || { [ "$_maj" -eq "$_best_maj" ] && [ "$_min" -gt "$_best_min" ]; } \
        || { [ "$_maj" -eq "$_best_maj" ] && [ "$_min" -eq "$_best_min" ] && [ "$_pat" -gt "$_best_pat" ]; }; then
        if node_ge_18 "$nvm_cand"; then
          NODE="$nvm_cand"
          _best_maj="$_maj"
          _best_min="$_min"
          _best_pat="$_pat"
        fi
      fi
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
      if [ "${1:-}" = "stop" ] && [ "$_omagy_host" != "claude" ] && [ "$_omagy_host" != "codex" ]; then
        echo '{"decision":"stop"}'
      elif [ "${1:-}" = "pre-tool-use" ] && [ "$_omagy_host" != "claude" ] && [ "$_omagy_host" != "codex" ]; then
        echo '{"decision":"ask"}'
      else
        echo '{}'
      fi
      exit 0
      ;;
    *)
      echo '{"ok":false,"error":"node_not_found"}'
      exit 2
      ;;
  esac
fi
exec "$NODE" "$DIR/omagy-hook.mjs" "$@"
