// Polyglot HostCodec, Desktop-session gating, and bundle drift checks (zero external deps).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALID_HOSTS = new Set(['claude', 'codex', 'antigravity']);
const CLAUDE_ONLY_TOOLS = new Set(['Read', 'View', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent']);
const CODEX_ONLY_TOOLS = new Set(['shell_command', 'exec_command', 'unified_exec']);
const TRANSCRIPT_TOOL_MAP = {
  read: 'read_file',
  view: 'view_file',
  write: 'write_file',
  notebookedit: 'write_file',
  edit: 'edit_file',
  multiedit: 'multiedit',
  bash: 'bash',
  shell_command: 'bash',
  exec_command: 'bash',
  shell: 'bash',
  unified_exec: 'bash',
  apply_patch: 'apply_patch',
};

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch { /* fail open: missing or invalid JSON */
    return null;
  }
}

function canonWsPath(ws) {
  const realpathFn = fs.realpathSync.native || fs.realpathSync;
  const normDrive = (s) => (process.platform === 'win32' ? String(s || '').replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`) : String(s || ''));
  const abs = normDrive(path.resolve(String(ws || process.cwd())));
  try { return normDrive(realpathFn(abs)); } catch { /* fail open: unresolved path */ return abs; }
}

/** Extract explicit `--host=<name>` or `--host <name>` from CLI args. */
export function parseHostFromArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i] || '');
    if (a.startsWith('--host=')) {
      const v = a.slice(7).trim().toLowerCase();
      if (VALID_HOSTS.has(v)) return v;
    } else if (a === '--host' && i + 1 < args.length) {
      const v = String(args[i + 1] || '').trim().toLowerCase();
      if (VALID_HOSTS.has(v)) return v;
    }
  }
  return '';
}

/** Detect active AI coding host (`claude` | `codex` | `antigravity`). */
export function detectHost(payload = {}, env = process.env, argv = process.argv.slice(2)) {
  const fromArg = parseHostFromArgs(argv);
  if (fromArg) return fromArg;

  const fromEnv = String(env?.OMAGY_HOST || '').trim().toLowerCase();
  if (VALID_HOSTS.has(fromEnv)) return fromEnv;

  const p = (payload && typeof payload === 'object') ? payload : {};
  const fromPayload = String(p.host || '').trim().toLowerCase();
  if (VALID_HOSTS.has(fromPayload)) return fromPayload;

  const toolName = String(p.tool_name || p.toolName || p.toolCall?.name || p.tool_call?.name || '');
  const bundleId = String(env?.__CFBundleIdentifier || '').trim();
  if (
    env?.CLAUDECODE
    || env?.CLAUDE_CODE_ENTRYPOINT
    || env?.CLAUDE_PLUGIN_ROOT
    || env?.CLAUDE_PROJECT_DIR
    || bundleId === 'com.anthropic.claudefordesktop'
    || p.client === 'claude-desktop'
    || p.permission_mode !== undefined
  ) {
    return 'claude';
  }

  if (
    env?.CODEX_HOME
    || env?.CODEX_CI
    || env?.CODEX_THREAD_ID
    || env?.CODEX_SANDBOX
    || env?.CODEX_DESKTOP
    || env?.CODEX_APP_DESKTOP
    || env?.CODEX_CLIENT
    || env?.CODEX_APP_TOOLS_PIPE_PATH
    || env?.CODEX_APP_RUNTIME_CLI_PATH
    || env?.CODEX_ELECTRON_RESOURCES_PATH
    || env?.CODEX_MCP_NODE_PATH
    || bundleId === 'com.openai.codex'
    || bundleId === 'com.openai.codex.cli'
    || bundleId === 'com.openai.chat'
    || p.client === 'codex-desktop'
    || p.thread_id !== undefined
    || p.turn_id !== undefined
    || p.codex_version !== undefined
  ) {
    return 'codex';
  }

  if (CLAUDE_ONLY_TOOLS.has(toolName)) return 'claude';
  if (CODEX_ONLY_TOOLS.has(toolName)) return 'codex';
  if (p.agent_id !== undefined || p.agent_type !== undefined) return 'claude';
  return 'antigravity';
}

const DESKTOP_ANCESTOR_CACHE = new Map();

function hasDesktopAppAncestor(host) {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false;
  const key = `${host}:${process.ppid}`;
  if (DESKTOP_ANCESTOR_CACHE.has(key)) return DESKTOP_ANCESTOR_CACHE.get(key);
  let found = false;
  let pid = process.ppid;
  for (let hop = 0; hop < 5 && Number.isInteger(pid) && pid > 1; hop += 1) {
    let line = '';
    try {
      line = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 250 }).trim();
    } catch { /* fail open: ps unavailable or ancestor exited */
      break;
    }
    const m = /^(\d+)\s+([\s\S]+)$/.exec(line);
    if (!m) break;
    const cmd = m[2];
    if (/Antigravity\.app|Visual Studio Code|Code Helper|Cursor\.app|Windsurf\.app/i.test(cmd)) {
      found = false;
      break;
    }
    if (host === 'codex' && /CodexCLI\.app|ChatGPT\.app|\/Codex\.app|Codex \(Aperitif\)/i.test(cmd)) {
      found = true;
      break;
    }
    if (host === 'claude' && /\/Claude\.app|claude-desktop/i.test(cmd)) {
      found = true;
      break;
    }
    const nextPid = Number(m[1]);
    if (!Number.isInteger(nextPid) || nextPid <= 1 || nextPid === pid) break;
    pid = nextPid;
  }
  DESKTOP_ANCESTOR_CACHE.set(key, found);
  return found;
}

/** Return true only for Claude Desktop App or Codex Desktop App sessions (never IDE/CLI/CI/Antigravity). */
export function isDesktopAppSession(host, payload = {}, env = process.env) {
  if (host !== 'claude' && host !== 'codex') return false;
  const e = env || {};
  const p = (payload && typeof payload === 'object') ? payload : {};

  if (e.OMAGY_DESKTOP_HUD === '0' || e.OMAGY_DESKTOP_HUD === 'false') return false;

  const bundleId = String(e.__CFBundleIdentifier || '').trim();
  if (
    e.CI
    || e.GITHUB_ACTIONS
    || e.CODEX_CI
    || e.VSCODE_PID
    || e.VSCODE_IPC_HOOK_CLI
    || e.CURSOR_TRACE_ID
    || e.CURSOR_AGENT
    || e.JETBRAINS_IDE
    || e.IDEA_INITIAL_DIRECTORY
    || bundleId.startsWith('com.google.antigravity')
    || String(e.TERM_PROGRAM || '').toLowerCase() === 'vscode'
    || e.CLAUDE_CODE_ENTRYPOINT === 'cli'
    || e.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts'
    || e.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode'
  ) {
    return false;
  }

  if (e.OMAGY_DESKTOP_HUD === '1' || e.OMAGY_DESKTOP_HUD === 'true') return true;

  if (host === 'claude') {
    if (
      e.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop'
      || bundleId === 'com.anthropic.claudefordesktop'
      || p.client === 'claude-desktop'
    ) return true;
    return env === process.env && !e.OMAGY_SELFTEST && hasDesktopAppAncestor('claude');
  }
  if (
    e.CODEX_DESKTOP === '1'
    || e.CODEX_APP_DESKTOP === '1'
    || e.CODEX_CLIENT === 'desktop'
    || Boolean(e.CODEX_APP_TOOLS_PIPE_PATH)
    || Boolean(e.CODEX_APP_RUNTIME_CLI_PATH)
    || Boolean(e.CODEX_ELECTRON_RESOURCES_PATH)
    || Boolean(e.CODEX_MCP_NODE_PATH)
    || bundleId === 'com.openai.codex'
    || bundleId === 'com.openai.codex.cli'
    || bundleId === 'com.openai.chat'
    || p.client === 'codex-desktop'
  ) {
    return true;
  }
  return env === process.env && !e.OMAGY_SELFTEST && hasDesktopAppAncestor('codex');
}

/** Compute deterministic loopback port: `daemon` in 47800..48799, `launch` in 48800..49799. */
export function computeDesktopHudPort(workspace = process.cwd(), opts = {}) {
  const canon = canonWsPath(workspace);
  const channel = opts?.channel === 'launch' ? 'launch' : 'daemon';
  const base = channel === 'launch' ? 48800 : 47800;
  const key = channel === 'launch' ? `${canon}:launch` : canon;
  const digest = crypto.createHash('sha256').update(key).digest();
  return base + (digest.readUInt16BE(0) % 1000);
}

/** Resolve UID-scoped isolated runtime directory (`OMAGY_RUNTIME_DIR` -> `XDG_RUNTIME_DIR/oh-my-agy` -> `tmpdir/oh-my-agy-<uid>`). */
export function defaultRuntimeDir(runtimeRoot = '') {
  if (runtimeRoot) return path.resolve(String(runtimeRoot));
  if (process.env.OMAGY_RUNTIME_DIR) return path.resolve(process.env.OMAGY_RUNTIME_DIR);
  if (process.env.XDG_RUNTIME_DIR) return path.join(path.resolve(process.env.XDG_RUNTIME_DIR), 'oh-my-agy');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return path.join(os.tmpdir(), `oh-my-agy-${uid}`);
}

/** Create (if missing) and verify a 0o700 non-symlink same-UID runtime directory. */
export function ensureSecureRuntimeDir(dirPath = defaultRuntimeDir()) {
  const resolved = path.resolve(String(dirPath || defaultRuntimeDir()));
  const existing = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error(`runtime_dir_symlink:${resolved}`);
    if (!existing.isDirectory()) throw new Error(`runtime_dir_not_directory:${resolved}`);
  } else {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`runtime_dir_symlink:${resolved}`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`runtime_dir_foreign_uid:${resolved}`);
  }
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    fs.chmodSync(resolved, 0o700);
  }
  return resolved;
}

/** Return isolated 0o600 daemon registry path under runtimeDir() (matching OMAGY_RUNTIME_DIR). */
export function desktopHudRegistryFile(workspace = process.cwd(), runtimeRoot = '', opts = {}) {
  const baseDir = defaultRuntimeDir(runtimeRoot);
  const hash = crypto.createHash('sha256').update(canonWsPath(workspace)).digest('hex').slice(0, 16);
  const prefix = opts?.channel === 'launch' ? 'hud-desktop-launch-' : 'hud-desktop-';
  return path.join(baseDir, `${prefix}${hash}.json`);
}

/** Resolve bundle root from env or logical argv[1] path (never import.meta.url across symlinks). */
export function resolveBundleRoot(argv1 = process.argv[1] || '', fallbackRoot = process.cwd()) {
  if (process.env.OMAGY_BUNDLE_DIR) return path.resolve(process.env.OMAGY_BUNDLE_DIR);
  if (argv1) return path.resolve(path.dirname(path.resolve(String(argv1))), '..');
  return path.resolve(fallbackRoot);
}

/** Resolve persistent plugin data directory (`PLUGIN_DATA` -> `~/.gemini/config/oh-my-agy`). */
export function defaultPluginDataDir(env = process.env) {
  const raw = String(env?.PLUGIN_DATA || '').trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), '.gemini', 'config', 'oh-my-agy');
}

/** Resolve plugin root (`OMAGY_PLUGIN_ROOT` -> `PLUGIN_ROOT` if `plugin.json` exists -> `selfRoot`). */
export function resolvePluginRoot(selfRoot = process.cwd(), env = process.env) {
  for (const raw of [env?.OMAGY_PLUGIN_ROOT, env?.PLUGIN_ROOT]) {
    const p = String(raw || '').trim();
    if (p && fs.existsSync(path.join(p, 'plugin.json'))) return path.resolve(p);
  }
  return path.resolve(String(selfRoot || process.cwd()));
}

const VALID_GUARD_SCOPES = new Set(['write', 'planning', 'all']);

/** Parse `--guard-scope=write|planning|all` or `--guard-scope write|planning|all` from CLI args (default `'all'`). */
export function parseGuardScope(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i] || '');
    if (a.startsWith('--guard-scope=')) {
      const v = a.slice(14).trim().toLowerCase();
      if (VALID_GUARD_SCOPES.has(v)) return v;
    } else if (a === '--guard-scope' && i + 1 < args.length) {
      const v = String(args[i + 1] || '').trim().toLowerCase();
      if (VALID_GUARD_SCOPES.has(v)) return v;
    }
  }
  return 'all';
}

/** Format an Antigravity `systemMessage` injectStep with optional concise `metadata.user_markdown`. */
export function formatSystemMessageStep(text, opts = {}) {
  const msg = String(text ?? '');
  const um = typeof opts?.userMarkdown === 'string' && opts.userMarkdown.trim() ? opts.userMarkdown.trim() : '';
  return {
    systemMessage: {
      systemMessage: msg,
      ...(um ? { metadata: { user_markdown: um } } : {}),
    },
  };
}

/** Compare installed host-bundle.json metadata against canonical plugin.json version. */
export function checkHostBundleDrift(canonicalRoot, opts = {}) {
  const bundleRoot = opts.bundleRoot || resolveBundleRoot(opts.argv1, opts.fallbackRoot || canonicalRoot);
  const bundleMeta = readJsonSafe(path.join(bundleRoot, 'host-bundle.json'));
  if (!bundleMeta || typeof bundleMeta !== 'object') return null;
  const resolvedCanonical = (
    opts.canonicalRoot
    || (canonicalRoot && canonWsPath(canonicalRoot) !== canonWsPath(bundleRoot) ? canonicalRoot : '')
    || process.env.OMAGY_PLUGIN_ROOT
    || (typeof bundleMeta.pluginRoot === 'string' && bundleMeta.pluginRoot ? bundleMeta.pluginRoot : '')
    || canonicalRoot
  );
  const canonicalPlugin = readJsonSafe(path.join(resolvedCanonical, 'plugin.json'));
  const canonVer = String(canonicalPlugin?.version || '').trim();
  const builtVer = String(bundleMeta.sourceVersion || '').trim();
  if (canonVer && builtVer && canonVer !== builtVer) {
    const h = bundleMeta.host || 'claude';
    return `[oh-my-agy] Host bundle drift detected (bundle built for v${builtVer}, canonical repo is v${canonVer}). Refresh with: sh hooks/run.sh host-setup ${h}`;
  }
  return null;
}

/** Parse a semver triplet such as "0.167.1" or "codex-cli 0.167.1". */
export function parseCodexVersion(raw) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(raw || ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] || 0) };
}

function cmpSemver(parsed, targetMaj, targetMin, targetPatch = 0) {
  if (!parsed) return 0;
  if (parsed.major !== targetMaj) return parsed.major - targetMaj;
  if (parsed.minor !== targetMin) return parsed.minor - targetMin;
  return parsed.patch - targetPatch;
}

/** Resolve Codex CLI version from env, payload, or host-bundle.json metadata (defaulting >= 0.167.0). */
export function resolveCodexVersion(payload = {}, env = process.env, bundleRoot = '') {
  const fromEnv = String(env?.OMAGY_CODEX_VERSION || '').trim();
  if (fromEnv) return fromEnv;
  const fromPayload = String(payload?.codex_version || payload?.codexVersion || '').trim();
  if (fromPayload) return fromPayload;
  if (bundleRoot) {
    const meta = readJsonSafe(path.join(bundleRoot, 'host-bundle.json'));
    if (meta?.codexVersion) return String(meta.codexVersion).trim();
  }
  return '0.167.0';
}

export function supportsCodexHardPreToolUse(versionRaw) {
  if (!versionRaw) return true;
  const parsed = parseCodexVersion(versionRaw);
  return parsed ? cmpSemver(parsed, 0, 163, 0) >= 0 : true;
}

export function supportsCodexAskPreToolUse(versionRaw) {
  if (!versionRaw) return true;
  const parsed = parseCodexVersion(versionRaw);
  return parsed ? cmpSemver(parsed, 0, 167, 0) >= 0 : true;
}

/** Canonicalize hook CLI event names across Antigravity, Claude Code, and Codex. */
export function normalizeLifecycleEvent(rawEvent) {
  const ev = String(rawEvent || '').trim().toLowerCase();
  if (ev === 'user-prompt-submit' || ev === 'userpromptsubmit') return 'pre-invocation';
  if (ev === 'sessionstart') return 'session-start';
  if (ev === 'pretooluse') return 'pre-tool-use';
  if (ev === 'posttooluse') return 'post-tool-use';
  if (ev === 'subagentstart') return 'subagent-start';
  if (ev === 'subagentstop') return 'subagent-stop';
  if (ev === 'precompact') return 'pre-compact';
  if (ev === 'postcompact') return 'post-compact';
  return ev;
}

function flattenCommandLine(cmd) {
  if (Array.isArray(cmd)) return cmd.map((part) => String(part ?? '')).join(' ').trim();
  return cmd === undefined || cmd === null ? '' : String(cmd);
}

function normalizeSingleToolCall(toolName, rawArgs) {
  const rawName = String(toolName || '').trim();
  const args = (rawArgs && typeof rawArgs === 'object') ? { ...rawArgs } : {};
  const low = rawName.toLowerCase();

  if (low === 'read' || low === 'view') {
    const file = args.Path ?? args.path ?? args.file_path ?? args.filePath;
    if (file !== undefined && args.Path === undefined) args.Path = file;
    return { name: low === 'view' ? 'view_file' : 'read_file', args };
  }
  if (low === 'write' || low === 'notebookedit') {
    const file = args.Path ?? args.path ?? args.file_path ?? args.notebook_path ?? args.filePath;
    if (file !== undefined && args.Path === undefined) args.Path = file;
    if (args.Content === undefined) args.Content = args.content ?? args.new_source ?? '';
    if (args.Overwrite === undefined && args.overwrite === undefined && args.Append !== true && args.append !== true) {
      args.Overwrite = true;
    }
    return { name: 'write_file', args };
  }
  if (low === 'edit') {
    const file = args.Path ?? args.path ?? args.file_path ?? args.filePath;
    if (file !== undefined && args.Path === undefined) args.Path = file;
    if (args.Target === undefined && args.old_string !== undefined) args.Target = args.old_string;
    if (args.Replacement === undefined && args.new_string !== undefined) args.Replacement = args.new_string;
    return { name: 'edit_file', args };
  }
  if (low === 'multiedit') {
    const file = args.Path ?? args.path ?? args.file_path ?? args.filePath;
    if (file !== undefined && args.Path === undefined) args.Path = file;
    return { name: 'multiedit', args };
  }
  if (low === 'bash' || low === 'shell_command' || low === 'exec_command' || low === 'shell' || low === 'unified_exec') {
    const cmdVal = args.command ?? args.cmd;
    if (args.CommandLine === undefined && cmdVal !== undefined) args.CommandLine = flattenCommandLine(cmdVal);
    return { name: 'bash', args };
  }
  if (low === 'apply_patch' || low === 'patch') {
    if (args.patch === undefined && typeof args.input === 'string') args.patch = args.input;
    return { name: 'apply_patch', args };
  }
  return { name: rawName, args };
}

/** Normalize incoming Claude Code / Codex / Antigravity hook payloads to canonical internal fields. */
export function normalizeLifecyclePayload(payload = {}, host = 'antigravity') {
  const src = (payload && typeof payload === 'object') ? payload : {};
  const out = { ...src };
  if (VALID_HOSTS.has(host) && !out._host) out._host = host;

  const conv = src.conversationId || src.conversation_id || src.session_id || src.sessionId || src.thread_id || src.threadId;
  if (conv && !out.conversationId) out.conversationId = conv;

  const existingRoots = src.workspacePaths || src.workspace_paths;
  if ((!Array.isArray(existingRoots) || !existingRoots.length) && typeof existingRoots !== 'string') {
    const uriList = src.workspaceUris || src.workspace_uris;
    const mappedUris = Array.isArray(uriList)
      ? uriList.map((u) => {
        const s = String(u || '').trim();
        if (!s) return '';
        if (s.startsWith('file://')) {
          try { return fileURLToPath(s); } catch { /* fail open: ignore malformed file URI */ return ''; }
        }
        return s;
      }).filter(Boolean)
      : [];
    if (mappedUris.length) {
      out.workspacePaths = mappedUris;
    } else {
      const cwdCand = src.cwd || src.project_dir || src.workspace || src.workspace_root;
      if (typeof cwdCand === 'string' && cwdCand.trim()) out.workspacePaths = [cwdCand.trim()];
    }
  }

  if (!out.transcriptPath && !out.transcript_path) {
    const tx = src.rollout_path || src.rolloutPath || src.logPath;
    if (typeof tx === 'string' && tx.trim()) out.transcriptPath = tx.trim();
  }

  if (src.agent_id || src.agentId || src.agent_type || src.agentType || /^subagent/i.test(String(src.hook_event_name || ''))) {
    out.isSubagent = true;
    if (!out.subagentType && (src.subagent_type || src.agent_type || src.agentType)) {
      out.subagentType = src.subagent_type || src.agent_type || src.agentType;
    }
  }

  if (out.lastUserInput === undefined && out.last_user_input === undefined && typeof src.user_prompt === 'string') {
    out.lastUserInput = src.user_prompt;
  }

  const rawToolName = src.toolCall?.name || src.tool_call?.name || src.tool_name || src.toolName || '';
  const rawArgs = src.toolCall?.args || src.toolCall?.arguments || src.tool_call?.args || src.tool_input || src.arguments || src.args;
  if (rawToolName) {
    const norm = normalizeSingleToolCall(rawToolName, rawArgs);
    out.toolCall = { ...(src.toolCall || src.tool_call || {}), name: norm.name, args: norm.args };
    out.toolName = norm.name;
  } else if (host !== 'antigravity' && src.toolCall) {
    const norm = normalizeSingleToolCall(src.toolCall.name, src.toolCall.args || src.toolCall.arguments);
    out.toolCall = { ...src.toolCall, name: norm.name, args: norm.args };
  }

  return out;
}

function textFromContentArray(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function canonicalTranscriptToolName(raw) {
  const low = String(raw || '').trim().toLowerCase();
  return TRANSCRIPT_TOOL_MAP[low] || String(raw || '').trim();
}

function safeParseObj(val) {
  if (val && typeof val === 'object') return val;
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); return (parsed && typeof parsed === 'object') ? parsed : { input: val }; } catch { /* fail open: non-json string falls back to raw input */ return { input: val }; }
  }
  return {};
}

const SYNTHETIC_USER_PREFIX_RE = /^\s*<(?:task-notification|system-reminder|teammate-message|command-name|local-command-caveat|local-command-stdout)\b/i;

/** Extract normalized message + tool call view from Antigravity, Claude, or Codex transcript records. */
export function extractHostTranscriptRecords(rawRecords) {
  const list = Array.isArray(rawRecords) ? rawRecords : [rawRecords];
  return list.map((rec) => {
    if (!rec || typeof rec !== 'object') return null;

    // Antigravity native record
    if (/USER_INPUT|PLANNER_RESPONSE/i.test(String(rec.type || '')) || rec.source === 'USER_EXPLICIT' || rec.source === 'MODEL') {
      const toolCalls = Array.isArray(rec.tool_calls)
        ? rec.tool_calls.map((tc) => ({ ...tc, name: canonicalTranscriptToolName(tc.name || tc.toolName) }))
        : [];
      return {
        isUser: /USER_INPUT/i.test(String(rec.type || '')) || rec.source === 'USER_EXPLICIT',
        isModel: /PLANNER_RESPONSE/i.test(String(rec.type || '')) || rec.source === 'MODEL',
        text: typeof rec.content === 'string' ? rec.content : textFromContentArray(rec.content),
        keyHint: `${rec.step_index ?? rec.stepIndex ?? ''}:${rec.created_at ?? rec.createdAt ?? ''}`,
        toolCalls,
        toolResults: [],
      };
    }

    // Codex rollout `response_item` or `event_msg`
    if (rec.type === 'response_item' && rec.payload && typeof rec.payload === 'object') {
      const pl = rec.payload;
      if (pl.type === 'function_call' || pl.type === 'custom_tool_call') {
        const name = canonicalTranscriptToolName(pl.name);
        const args = safeParseObj(pl.arguments ?? pl.input);
        const cmdVal = args.command ?? args.cmd;
        if (name === 'bash' && args.CommandLine === undefined && cmdVal !== undefined) args.CommandLine = flattenCommandLine(cmdVal);
        return {
          isUser: false,
          isModel: false,
          text: '',
          keyHint: `${pl.call_id || ''}:${rec.timestamp || ''}`,
          toolCalls: [{ id: pl.call_id || '', name, args, status: pl.status || 'DONE' }],
          toolResults: [],
        };
      }
      if (pl.type === 'function_call_output' || pl.type === 'custom_tool_call_output') {
        const outStr = typeof pl.output === 'string' ? pl.output : JSON.stringify(pl.output || '');
        const parsedOut = safeParseObj(pl.output);
        const rawCode = pl.exit_code ?? parsedOut?.metadata?.exit_code ?? extractExitCodeFromText(outStr);
        const hasCode = rawCode !== undefined && rawCode !== null && rawCode !== '' && Number.isFinite(Number(rawCode));
        const exitCode = hasCode ? Number(rawCode) : undefined;
        const outStatus = String(parsedOut?.status || pl.status || '').trim().toUpperCase();
        const isErr = (exitCode !== undefined && exitCode !== 0)
          || outStatus === 'ERROR'
          || outStatus === 'FAILED'
          || Boolean(parsedOut?.error)
          || parsedOut?.is_error === true
          || parsedOut?.isError === true
          || pl.is_error === true
          || pl.isError === true;
        return {
          isUser: false,
          isModel: false,
          text: '',
          keyHint: '',
          toolCalls: [],
          toolResults: [{ toolCallId: pl.call_id || '', output: outStr, status: isErr ? 'ERROR' : 'DONE', ...(exitCode !== undefined ? { exitCode } : {}) }],
        };
      }
      if (pl.type === 'message') {
        const text = textFromContentArray(pl.content);
        const isMeta = Boolean(rec.isMeta || rec.isCompactSummary || (pl.role === 'user' && SYNTHETIC_USER_PREFIX_RE.test(text)));
        return {
          isUser: pl.role === 'user' && !isMeta,
          isModel: pl.role === 'assistant' && !isMeta,
          ...(rec.isCompactSummary ? { isCompaction: true } : {}),
          text,
          keyHint: `${rec.timestamp || ''}`,
          toolCalls: [],
          toolResults: [],
        };
      }
    }
    if (rec.type === 'event_msg' && rec.payload && typeof rec.payload === 'object') {
      if (rec.payload.type === 'user_message') {
        return { isUser: true, isModel: false, text: String(rec.payload.message || ''), keyHint: `${rec.timestamp || ''}`, toolCalls: [], toolResults: [] };
      }
      if (rec.payload.type === 'agent_message') {
        return { isUser: false, isModel: true, text: String(rec.payload.message || ''), keyHint: `${rec.timestamp || ''}`, toolCalls: [], toolResults: [] };
      }
    }

    // Claude JSONL record (`type: 'user'|'assistant'` or `message: { role, content }`)
    const msg = (rec.message && typeof rec.message === 'object') ? rec.message : rec;
    const role = String(msg.role || rec.type || '').toLowerCase();
    const content = msg.content ?? rec.text;
    const blocks = Array.isArray(content) ? content : [];
    const toolCalls = [];
    const toolResults = [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const norm = normalizeSingleToolCall(b.name, b.input);
        toolCalls.push({ id: b.id || '', name: norm.name, args: norm.args, status: 'DONE' });
      } else if (b.type === 'tool_result') {
        const outStr = textFromContentArray(b.content) || String(b.content || '');
        const parsedCode = extractExitCodeFromText(outStr);
        const isErr = Boolean(b.is_error) || (parsedCode !== null && parsedCode !== 0);
        const exitCode = parsedCode !== null ? parsedCode : (b.is_error ? 1 : undefined);
        toolResults.push({ toolCallId: b.tool_use_id || '', output: outStr, status: isErr ? 'ERROR' : 'DONE', ...(exitCode !== undefined ? { exitCode } : {}) });
      }
    }
    const text = typeof content === 'string' ? content : textFromContentArray(blocks);
    const isMetaOrSystem = Boolean(rec.isMeta || rec.isCompactSummary || rec.type === 'system' || rec.subtype === 'compact_boundary');
    const isCompaction = Boolean(rec.isCompactSummary || rec.subtype === 'compact_boundary');
    const isSyntheticUserText = role === 'user' && SYNTHETIC_USER_PREFIX_RE.test(text);
    return {
      isUser: role === 'user' && !toolResults.length && !isMetaOrSystem && !isSyntheticUserText,
      isModel: role === 'assistant' && !isMetaOrSystem,
      ...(isCompaction ? { isCompaction: true } : {}),
      text,
      keyHint: `${rec.uuid || rec.id || rec.timestamp || ''}`,
      toolCalls,
      toolResults,
    };
  }).filter(Boolean);
}

/** Expand a parsed JSONL transcript line into Antigravity-compatible records for freshness checking. */
export function expandTranscriptRecordForFreshness(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
  const isClaudeBlocks = Array.isArray(o?.message?.content) || Array.isArray(o?.content);
  const isCodexItem = o.type === 'response_item';
  if (!isClaudeBlocks && !isCodexItem) return [o];
  const [nr] = extractHostTranscriptRecords([o]);
  if (!nr) return [];
  const out = [];
  if (nr.toolCalls.length) out.push({ ...o, tool_calls: nr.toolCalls });
  for (const tr of nr.toolResults) {
    out.push({ type: 'TOOL_RESULT', role: 'tool', tool_call_id: tr.toolCallId, status: tr.status, exitCode: tr.exitCode, output: tr.output });
  }
  return out;
}

const DEFAULT_TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const READ_TOOL_NAMES_RE = /^(?:read_file|view_file|read|view)$/i;
const READ_PATH_ARG_KEYS = ['Path', 'path', 'AbsolutePath', 'absolutePath', 'absolute_path', 'TargetFile', 'targetFile', 'target_file', 'filePath', 'file_path', 'file'];

function canonFilePath(p, depth = 0) {
  const normDrive = (s) => (process.platform === 'win32' ? String(s || '').replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`) : String(s || ''));
  const realpathFn = fs.realpathSync.native || fs.realpathSync;
  const abs = normDrive(path.resolve(String(p || '')));
  if (depth > 8) return abs;
  let cur = abs;
  const tail = [];
  for (let i = 0; i < 32; i += 1) {
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) {
        const linkTarget = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
        return canonFilePath(path.join(linkTarget, ...tail), depth + 1);
      }
      return normDrive(path.join(realpathFn(cur), ...tail));
    } catch { /* fail open: walk up to existing ancestor */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return abs;
}

function unwrapQuotedString(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    try { const parsed = JSON.parse(s); if (typeof parsed === 'string') return parsed.trim(); } catch { /* fail open: literal string */ }
  }
  return s;
}

/** Read a bounded tail slice of a JSONL transcript file (UTF-8 BOM stripped, optional leading partial line drop). */
export function readTranscriptTailSlice(p, maxBytes = DEFAULT_TRANSCRIPT_TAIL_BYTES, dropPartial = false) {
  if (!p || typeof p !== 'string') return { text: '', baseOffset: 0 };
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size <= 0) return { text: '', baseOffset: 0 };
      const start = Math.max(0, st.size - (maxBytes > 0 ? Math.floor(maxBytes) : DEFAULT_TRANSCRIPT_TAIL_BYTES));
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const rawStr = buf.toString('utf8');
      const bomBytes = start === 0 && rawStr.charCodeAt(0) === 0xFEFF ? 3 : 0;
      const txt = bomBytes ? rawStr.slice(1) : rawStr;
      const nl = dropPartial && start > 0 ? txt.indexOf('\n') : -1;
      if (nl >= 0 && nl < txt.length - 1) {
        return { text: txt.slice(nl + 1), baseOffset: start + bomBytes + Buffer.byteLength(txt.slice(0, nl + 1), 'utf8') };
      }
      return { text: txt, baseOffset: start + bomBytes };
    } finally { fs.closeSync(fd); }
  } catch { /* fail open: unreadable transcript */ return { text: '', baseOffset: 0 }; }
}

/** Read bounded tail text of a JSONL transcript file. */
export function readTranscriptTailText(p, maxBytes = DEFAULT_TRANSCRIPT_TAIL_BYTES, dropPartial = false) {
  return readTranscriptTailSlice(p, maxBytes, dropPartial).text;
}

/** Extract deduplicated, canonicalized recent read_file/view_file target paths (up to 200) from a transcript tail. */
export function extractTranscriptReadPaths(transcriptPath, roots = [], host = 'antigravity', tailBytes = 256 * 1024) {
  const { text: tail } = readTranscriptTailSlice(transcriptPath, tailBytes, true);
  if (!tail) return [];
  const rootList = (Array.isArray(roots) ? roots : (roots ? [roots] : []))
    .filter((r) => typeof r === 'string' && r.trim());
  const resolveReadTarget = (rawTarget) => {
    const t = unwrapQuotedString(rawTarget);
    if (!t) return '';
    if (path.isAbsolute(t)) return canonFilePath(t);
    const existing = rootList.map((r) => path.resolve(r, t)).find((cand) => {
      try { return fs.existsSync(cand); } catch { /* fail open: ignore inaccessible root */ return false; }
    });
    if (existing) return canonFilePath(existing);
    return canonFilePath(rootList[0] ? path.resolve(rootList[0], t) : t);
  };
  const recent = new Set();
  for (const rawLine of tail.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { /* fail open: ignore partial or malformed JSONL line */ continue; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const [nr] = extractHostTranscriptRecords([rec]);
    let calls = nr?.toolCalls?.length ? nr.toolCalls : [];
    if (!calls.length && Array.isArray(rec.tool_calls)) {
      calls = rec.tool_calls;
    } else if (!calls.length && (rec.name || rec.toolName) && (rec.arguments || rec.args || rec.input || /TOOL_CALL/i.test(String(rec.type || '')))) {
      calls = [rec];
    }
    for (const tc of calls) {
      if (!tc || typeof tc !== 'object') continue;
      if (String(tc.status || '').trim().toUpperCase() === 'ERROR') continue;
      const name = String(tc.name || tc.toolName || tc.function?.name || '').trim();
      if (!READ_TOOL_NAMES_RE.test(name)) continue;
      const args = safeParseObj(tc.args ?? tc.arguments ?? tc.input ?? tc.function?.arguments);
      for (const k of READ_PATH_ARG_KEYS) {
        if (typeof args[k] === 'string' && args[k].trim()) {
          const resolved = resolveReadTarget(args[k]);
          if (resolved) {
            if (recent.has(resolved)) recent.delete(resolved);
            recent.add(resolved);
          }
          break;
        }
      }
    }
  }
  const out = [...recent];
  return out.length > 200 ? out.slice(-200) : out;
}

/** Compact (< 3200 chars) Claude standing rules injected only when .claude/rules/oh-my-agy.md is absent. */
export function buildCompactClaudeContract() {
  return [
    '# oh-my-agy Operating Contract (Claude Adapter)',
    '- **Lanes**: `$autopilot` (hands-off delivery), `$deep-interview` (clarify ambiguity), `$ralplan` (consensus planning), `$ultragoal` (ledger-backed multi-goal execution), `$team` (coordinated Agent workers), `$code-review`, `$ultraqa`, `$analyze`. Activate `$name` by reading its `SKILL.md` first.',
    '- **Subagents**: Invoke via `Agent` with explicit role tier; never nest recursive orchestration inside worker roles (`disallowedTools: ["Agent"]`).',
    '- **Durable State (`.omagy/`)**: Write workflow state read-modify-write via `Write` with refreshed `updated_at`. Never alter `omagy-ignore-start .. omagy-ignore-end` protected blocks.',
    '- **Verification**: Run targeted tests/build/lint after edits before reporting completion.',
  ].join('\n');
}

export function hasClaudeRulesFile(roots = []) {
  const userClaudeRoot = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  const homeRule = path.join(userClaudeRoot, 'rules', 'oh-my-agy.md');
  if (fs.existsSync(homeRule)) return true;
  return (Array.isArray(roots) ? roots : []).some((r) => fs.existsSync(path.join(String(r), '.claude', 'rules', 'oh-my-agy.md')));
}

export function hasClaudeLaunchHud(workspace) {
  if (!workspace) return false;
  const cfg = readJsonSafe(path.join(String(workspace), '.claude', 'launch.json'));
  const arr = Array.isArray(cfg?.configurations) ? cfg.configurations : [];
  return arr.some((c) => c && c.name === 'oh-my-agy-hud');
}

function probeHudHealth(port, token, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/status', headers: token ? { 'X-Sidecar-Token': token } : {}, timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function extractExitCodeFromText(text) {
  const m = /(?:Exit\s+code:\s*|(?:Process|Command)\s+exited\s+with\s+code\s+)(-?\d+)/i.exec(String(text || ''));
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isFinite(num) ? num : null;
}

function readHudStartupResult(regFile) {
  try {
    const st = fs.lstatSync(regFile);
    if (!st.isFile()) return null;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null;
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) return null;
  } catch { /* fail open: missing or unreadable HUD registry file */
    return null;
  }
  const reg = readJsonSafe(regFile);
  return reg && Number.isInteger(reg.port) && reg.port > 0 ? reg : null;
}

/** Idempotently start/reuse loopback desktop HUD daemon (zero token leak in message, zero sidecars/hud/dispatch import). */
export async function ensureDesktopHudDaemon({ host, workspace = process.cwd(), pluginRoot, env = process.env, argv1 = process.argv[1] || '' } = {}) {
  const ws = canonWsPath(workspace);
  if (host === 'claude' && hasClaudeLaunchHud(ws) && env.OMAGY_DESKTOP_HUD !== '1') {
    const launchPort = computeDesktopHudPort(ws, { channel: 'launch' });
    return {
      started: false,
      reused: false,
      mode: 'launch-json',
      port: launchPort,
      url: `http://127.0.0.1:${launchPort}/`,
      message: `[oh-my-agy] Claude Desktop HUD configured via .claude/launch.json ("oh-my-agy-hud" on http://127.0.0.1:${launchPort}/). Open Preview -> oh-my-agy-hud.`,
    };
  }

  const regFile = desktopHudRegistryFile(ws, env?.OMAGY_RUNTIME_DIR || '');
  const existing = readHudStartupResult(regFile);
  if (existing && (await probeHudHealth(existing.port, existing.token))) {
    const url = `http://127.0.0.1:${existing.port}/`;
    return {
      started: false,
      reused: true,
      port: existing.port,
      url,
      registryFile: regFile,
      message: `[oh-my-agy] Desktop HUD Preview running at ${url}`,
    };
  }

  const bundleRoot = resolveBundleRoot(argv1, pluginRoot);
  const serverScript = [
    path.join(bundleRoot, 'sidecars', 'hud', 'main.mjs'),
    path.join(pluginRoot || bundleRoot, 'sidecars', 'hud', 'main.mjs'),
  ].find((p) => fs.existsSync(p));
  if (!serverScript) return { started: false, reused: false, port: 0, url: '', message: '' };

  const port = computeDesktopHudPort(ws, { channel: 'daemon' });
  const cp = spawn(process.execPath, [serverScript, 'desktop-serve', '--workspace', ws, '--host', host, '--port', String(port), '--registry', regFile], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, OMAGY_RUNTIME_DIR: path.dirname(regFile) },
  });
  cp.unref();

  let ready = null;
  for (let i = 0; i < 75; i += 1) {
    const reg = readHudStartupResult(regFile);
    if (reg && (await probeHudHealth(reg.port, reg.token, 1500))) {
      ready = reg;
      break;
    }
    await new Promise((r) => { setTimeout(r, 80); });
  }
  if (!ready) {
    try { if (cp.pid) process.kill(cp.pid, 'SIGTERM'); } catch { /* fail open: daemon already exited */ }
    try {
      const stale = readJsonSafe(regFile);
      if (stale && cp.pid && Number(stale.pid) === Number(cp.pid)) fs.unlinkSync(regFile);
    } catch { /* fail open: ignore missing or locked registry file */ }
    return {
      started: false,
      reused: false,
      port: 0,
      url: '',
      registryFile: regFile,
      error: 'hud_daemon_startup_timeout',
      message: '',
    };
  }
  const activePort = ready.port;
  const url = `http://127.0.0.1:${activePort}/`;
  return {
    started: true,
    reused: false,
    port: activePort,
    url,
    registryFile: regFile,
    message: `[oh-my-agy] Desktop HUD Preview ready at ${url}`,
  };
}

/** Serialize internal hook outcome onto exact Antigravity, Claude Code, or Codex stdout wire schema. */
export function serializeHookOutcome(rawEvent, rawResult = {}, host = 'antigravity', opts = {}) {
  const res = (rawResult && typeof rawResult === 'object') ? rawResult : {};
  if (host === 'antigravity') return res;

  const ev = String(rawEvent || '').trim().toLowerCase();
  if (ev === 'subagent-stop' || ev === 'subagentstop') {
    return host === 'claude' ? { continue: true, suppressOutput: true } : {};
  }
  if (ev === 'pre-compact' || ev === 'precompact') {
    return {};
  }

  if (ev === 'stop') {
    if (res.continue === false || (typeof res.stopReason === 'string' && res.stopReason.trim())) {
      const out = { continue: false, stopReason: String(res.stopReason || 'stopped').trim() };
      const msg = (typeof res.systemMessage === 'string' && res.systemMessage.trim())
        ? res.systemMessage.trim()
        : (typeof res.reason === 'string' && res.reason.trim() ? res.reason.trim() : '');
      if (msg) out.systemMessage = msg;
      return out;
    }
    if (res.decision === 'continue' && res.reason) {
      return { decision: 'block', reason: String(res.reason) };
    }
    return {};
  }

  if (ev === 'pre-tool-use' || ev === 'pretooluse') {
    if (res.decision === 'force_ask' || res.decision === 'deny' || res.decision === 'block') {
      const reason = String(res.reason || 'Blocked by oh-my-agy policy');
      if (host === 'claude') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: res.decision === 'force_ask' ? 'ask' : 'deny',
            permissionDecisionReason: reason,
          },
        };
      }
      const codexVer = opts.codexVersion || '';
      if (!supportsCodexHardPreToolUse(codexVer)) return { systemMessage: reason };
      const perm = (res.decision === 'force_ask' && supportsCodexAskPreToolUse(codexVer)) ? 'ask' : 'deny';
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: perm,
          permissionDecisionReason: reason,
        },
      };
    }
    return {};
  }

  const msgs = [];
  if (Array.isArray(res.injectSteps)) {
    for (const step of res.injectSteps) {
      const text = typeof step?.systemMessage?.systemMessage === 'string'
        ? step.systemMessage.systemMessage
        : (typeof step?.ephemeralMessage === 'string' ? step.ephemeralMessage : '');
      if (text.trim()) {
        msgs.push(text.trim());
      }
    }
  }
  if (Array.isArray(opts.extraMessages)) {
    for (const em of opts.extraMessages) {
      if (typeof em === 'string' && em.trim()) msgs.push(em.trim());
    }
  }
  if (!msgs.length) return {};

  let hookEventName = 'SessionStart';
  if (ev === 'user-prompt-submit' || ev === 'userpromptsubmit' || ev === 'pre-invocation') hookEventName = 'UserPromptSubmit';
  else if (ev === 'subagent-start' || ev === 'subagentstart') hookEventName = 'SubagentStart';
  else if (ev === 'post-tool-use' || ev === 'posttooluse') hookEventName = 'PostToolUse';
  else if (ev === 'post-compact' || ev === 'postcompact') hookEventName = 'PostCompact';

  let additionalContext = msgs.join('\n\n');
  if (additionalContext.length > 12_000) {
    additionalContext = `${additionalContext.slice(0, 11_950)}\n\n...[truncated for hook budget]`;
  }
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

// ---------- shared hot-path runtime utilities (zero external deps, acyclic leaf) ----------

const HOSTILE_GIT_ENV_KEYS = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
]);

/** Strip inherited git override env vars before spawning git, then overlay explicit caller overrides. */
export function cleanGitEnv(baseEnv = process.env, extra = null) {
  const out = {};
  if (baseEnv && typeof baseEnv === 'object') {
    for (const [k, v] of Object.entries(baseEnv)) {
      if (v === undefined) continue;
      if (HOSTILE_GIT_ENV_KEYS.has(k) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(k)) continue;
      out[k] = v;
    }
  }
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

const _winSleepArr = typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object'
  ? new Int32Array(new SharedArrayBuffer(4))
  : null;

function sleepSyncMs(ms) {
  if (_winSleepArr) {
    try { Atomics.wait(_winSleepArr, 0, 0, ms); return; } catch { /* fail open: fallback when Atomics.wait is blocked */ }
  }
  const until = Date.now() + ms;
  while (Date.now() < until) { /* fallback win32 retry delay */ }
}

/** Atomically rename tmpPath onto destPath with non-spinning Atomics.wait retries on win32 AV locks. */
export function renameSyncAtomic(tmpPath, destPath) {
  for (let i = 0; ; i += 1) {
    try { fs.renameSync(tmpPath, destPath); return; } catch (err) {
      if (process.platform === 'win32' && i < 10 && /^(EPERM|EBUSY|EACCES)$/.test(err?.code || '')) {
        sleepSyncMs(3);
        continue;
      }
      try { fs.unlinkSync(tmpPath); } catch { /* fail open: tmp cleanup */ }
      throw err;
    }
  }
}

let _atomicWriteSeq = 0;

/** Atomically write UTF-8 content preserving existing regular-file mode (default 0o600) and refusing symlinks. */
export function writeFileAtomicWithMode(destPath, content, { defaultMode = 0o600 } = {}) {
  let targetMode = defaultMode;
  try {
    const st = fs.lstatSync(destPath);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing_symlink_overwrite:${destPath}`);
    }
    if (st.isFile()) {
      targetMode = st.mode & 0o777;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  _atomicWriteSeq = (_atomicWriteSeq + 1) % 1000000;
  const tmp = `${destPath}.${process.pid}.${_atomicWriteSeq}.tmp`;
  let fd = -1;
  try {
    fd = fs.openSync(tmp, 'wx', targetMode);
    fs.writeFileSync(fd, String(content ?? ''), 'utf8');
    if (process.platform !== 'win32') {
      try { fs.fchmodSync(fd, targetMode); } catch { /* fail open: unsupported fs chmod */ }
    }
    fs.closeSync(fd);
    fd = -1;
    renameSyncAtomic(tmp, destPath);
  } catch (err) {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* fail open: ignore close error during cleanup */ } }
    try { fs.unlinkSync(tmp); } catch { /* fail open: tmp cleanup */ }
    throw err;
  }
}

/** Strip C0/C1/DEL/bidi format controls (keeping \n/\r/\t) and neutralize closing XML envelope tags. */
export function sanitizeUntrustedContext(text) {
  return String(text ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F]/g, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/<\/([A-Za-z][A-Za-z0-9_:-]*(?:\s[^>]*)?)>/g, '<\\$1>');
}

/** Parse POSIX, Win32 drive, UNC, and Win32 extended-length (\\?\, \\?\UNC\) prefixes into { root, parts, abs }. */
export function parseKernelPathPrefix(str) {
  const isWin = process.platform === 'win32';
  const normDrive = (s) => (isWin ? String(s || '').replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`) : String(s || ''));
  let norm = String(str || '').replace(/\\/g, '/');
  let fromUncPrefix = false;
  if (/^\/\/\?\/UNC\//i.test(norm)) {
    norm = `//${norm.slice(8)}`;
    fromUncPrefix = true;
  } else if (norm.startsWith('//?/')) {
    norm = norm.slice(4);
  }
  norm = normDrive(norm);
  if (fromUncPrefix || (isWin && norm.startsWith('//'))) {
    const unc = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(norm);
    if (unc) return { root: `${path.sep}${path.sep}${unc[1]}${path.sep}${unc[2]}${path.sep}`, parts: (unc[3] || '').split('/').filter(Boolean), abs: true };
  }
  const drv = /^([A-Za-z]:)(?:\/(.*))?$/.exec(norm);
  if (drv) return { root: `${drv[1]}${path.sep}`, parts: (drv[2] || '').split('/').filter(Boolean), abs: true };
  if (norm.startsWith('/')) return { root: path.sep, parts: norm.slice(1).split('/').filter(Boolean), abs: true };
  return { root: '', parts: norm.split('/').filter(Boolean), abs: false };
}

/** Walk raw path component-by-component following symlinks in kernel order (40-hop cap) without lexical .. collapse. */
export function walkKernelPath(rawPath, baseDir = process.cwd(), { maxHops = 40, watchRoots = [] } = {}) {
  const input = String(rawPath || '').trim();
  if (!input || input.includes('\0')) return { ok: false, error: 'invalid_path', path: '', leafPath: '', leafIsSymlink: false, sawWatchedSymlink: false };
  const isWin = process.platform === 'win32';
  const realpathNative = fs.realpathSync.native || fs.realpathSync;
  const normDrive = (s) => (isWin ? String(s || '').replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`) : String(s || ''));
  const cmpKey = (p) => (isWin ? normDrive(p).toLowerCase() : p);
  const canonWatches = watchRoots.map((w) => cmpKey(canonWsPath(w)));
  const isWatched = (p) => {
    const np = cmpKey(p);
    return canonWatches.some((w) => np === w || np.startsWith(w.endsWith(path.sep) ? w : `${w}${path.sep}`));
  };
  const joinParts = (root, parts) => (parts.length ? `${root}${parts.join(path.sep)}` : root);

  const parsed = parseKernelPathPrefix(input);
  let rootPrefix;
  let resolvedParts;
  let queue;
  if (parsed.abs) {
    rootPrefix = parsed.root;
    resolvedParts = [];
    queue = [...parsed.parts];
  } else {
    const baseParsed = parseKernelPathPrefix(canonWsPath(baseDir));
    rootPrefix = baseParsed.root;
    resolvedParts = [...baseParsed.parts];
    queue = [...parsed.parts];
  }

  let hops = 0;
  let sawWatchedSymlink = false;
  let leafPath = '';
  let leafIsSymlink = false;
  while (queue.length > 0) {
    const seg = queue.shift();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (resolvedParts.length > 0) resolvedParts.pop();
      continue;
    }
    const candidate = joinParts(rootPrefix, [...resolvedParts, seg]);
    const isFinalSeg = !leafPath && queue.every((q) => !q || q === '.');
    let st = null;
    try {
      st = fs.lstatSync(candidate);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        if (isFinalSeg) leafPath = normDrive(candidate);
        resolvedParts.push(seg);
        continue;
      }
      return { ok: false, error: err?.code || 'lstat_error', path: '', leafPath, leafIsSymlink, sawWatchedSymlink };
    }
    if (st.isSymbolicLink()) {
      if (isFinalSeg) {
        leafPath = normDrive(candidate);
        leafIsSymlink = true;
      }
      if (isWatched(candidate)) sawWatchedSymlink = true;
      hops += 1;
      if (hops > maxHops) return { ok: false, error: 'ELOOP', path: '', leafPath, leafIsSymlink, sawWatchedSymlink };
      let target;
      try { target = fs.readlinkSync(candidate); } catch { return { ok: false, error: 'readlink_error', path: '', leafPath, leafIsSymlink, sawWatchedSymlink }; }
      const tp = parseKernelPathPrefix(target);
      if (tp.abs) {
        rootPrefix = tp.root;
        resolvedParts = [];
        queue = [...tp.parts, ...queue];
      } else {
        queue = [...tp.parts, ...queue];
      }
    } else {
      if (isWin) {
        try {
          const realCand = normDrive(realpathNative(candidate));
          const rp = parseKernelPathPrefix(realCand);
          if (rp.abs) {
            rootPrefix = rp.root;
            resolvedParts = [...rp.parts];
            if (isFinalSeg) leafPath = realCand;
            continue;
          }
        } catch { /* fail open: keep walked segment when native realpath is unavailable */ }
      }
      if (isFinalSeg) leafPath = normDrive(candidate);
      resolvedParts.push(seg);
    }
  }
  const finalPath = normDrive(joinParts(rootPrefix, resolvedParts));
  return { ok: true, path: finalPath, leafPath: leafPath || finalPath, leafIsSymlink, sawWatchedSymlink, hops };
}

const KEY_SHAPE_NAME_RE = /^(?:[A-Za-z0-9_-]*(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|signing[_-]?key|webhook[_-]?secret|session[_-]?secret|password|passwd)|secret|token)$/i;
const PLACEHOLDER_VAL_RE = /^(?:\$|\{\{|\[REDACTED|<|process\.env\.|os\.environ|null\b|undefined\b|true\b|false\b|example\b|placeholder\b|your[_-]|changeme\b|dummy\b)/i;
const TRUNC_TOKEN_PFX_RE = /^(?:sk-(?:proj-|ant-[a-z0-9-]+-)?[A-Za-z0-9_-]{12,}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{16,}|hf_[A-Za-z0-9]{12,})/;
const JWT_FULL_RE = /^eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
const classifyRedactedLabel = (val) => {
  if (JWT_FULL_RE.test(val)) return '[REDACTED_JWT]';
  if (/^(?:sk-(?:proj-|ant-[a-z0-9-]+-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}|AIza[0-9A-Za-z_-]{35}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})$/.test(val)) return '[REDACTED_KEY]';
  if (/^(?:(?:gh[pousr]|github_pat|pypi)_[A-Za-z0-9_-]{16,}|(?:glpat|xox[baprs]|pypi)-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{20,}|npm_[0-9A-Za-z]{36})$/.test(val)) return '[REDACTED_TOKEN]';
  if (/^A(?:KIA|SIA)[0-9A-Z]{16}$/.test(val)) return '[REDACTED_AWS_KEY]';
  return '[REDACTED_SECRET]';
};

/** Bounded linear-pass key-shape redaction: assignment-before-prefix precedence, unquoted KEY=val, JSON keys, and truncated quotes. */
export function redactKeyShapeSecrets(text) {
  const s = String(text ?? '');
  if (!s) return '';
  const out = [];
  let i = 0;
  const n = s.length;
  const isKeyChar = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '-';

  while (i < n) {
    // Check quoted truncated known-prefix token previews at EOF/EOL
    if ((s[i] === '"' || s[i] === "'") && i + 12 < n && TRUNC_TOKEN_PFX_RE.test(s.slice(i + 1, Math.min(n, i + 64)))) {
      const q = s[i];
      let end = i + 1;
      let closed = false;
      while (end < n && s[end] !== '\n' && s[end] !== '\r') {
        if (q === '"' && s[end] === '\\' && end + 1 < n) { end += 2; continue; }
        if (s[end] === q) { closed = true; break; }
        end += 1;
      }
      if (!closed) {
        out.push(q, '[REDACTED_SECRET]');
        i = end;
        continue;
      }
    }

    if (isKeyChar(s[i]) && (i === 0 || !isKeyChar(s[i - 1]))) {
      let kEnd = i;
      while (kEnd < n && kEnd - i < 64 && isKeyChar(s[kEnd])) kEnd += 1;
      const key = s.slice(i, kEnd);
      if (KEY_SHAPE_NAME_RE.test(key)) {
        let p = kEnd;
        if (i > 0 && (s[i - 1] === '"' || s[i - 1] === "'") && p < n && s[p] === s[i - 1]) p += 1;
        while (p < n && (s[p] === ' ' || s[p] === '\t')) p += 1;
        if (p < n && (s[p] === '=' || s[p] === ':')) {
          p += 1;
          while (p < n && (s[p] === ' ' || s[p] === '\t')) p += 1;
          if (p < n && (s[p] === '"' || s[p] === "'")) {
            const q = s[p];
            let vEnd = p + 1;
            let closed = false;
            while (vEnd < n && s[vEnd] !== '\n' && s[vEnd] !== '\r') {
              if (q === '"' && s[vEnd] === '\\' && vEnd + 1 < n) { vEnd += 2; continue; }
              if (s[vEnd] === q) { closed = true; break; }
              vEnd += 1;
            }
            const val = s.slice(p + 1, vEnd);
            if (val.length >= 8 && !PLACEHOLDER_VAL_RE.test(val)) {
              out.push(s.slice(i, p + 1), classifyRedactedLabel(val), closed ? q : '');
              i = closed ? vEnd + 1 : vEnd;
              continue;
            }
          } else if (p < n && s[p] !== '\n' && s[p] !== '\r') {
            let vEnd = p;
            while (vEnd < n && !/[\s,;'"`()[\]{}<>]/.test(s[vEnd])) vEnd += 1;
            const val = s.slice(p, vEnd);
            const nextCh = vEnd < n ? s[vEnd] : '';
            const label = classifyRedactedLabel(val);
            const looksCallOrExpr = label === '[REDACTED_SECRET]' && (
              nextCh === '('
              || (!/^SG\./.test(val) && /^[A-Za-z_$][A-Za-z0-9_$]*(?:\??\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(val))
              || (val.length <= 48 && /^[A-Za-z_$][A-Za-z_$]*$/.test(val))
            );
            if (val.length >= 8 && !looksCallOrExpr && !PLACEHOLDER_VAL_RE.test(val)) {
              out.push(s.slice(i, p), label);
              i = vEnd;
              continue;
            }
          }
        }
      }
    }
    out.push(s[i]);
    i += 1;
  }
  return out.join('');
}

// ---------- durable workspace pause / resume state (.omagy/state/pause.json) ----------
export const PAUSE_FILENAME = 'pause.json';
const PAUSE_TERMINAL_PHASES = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);

export function isResumeIntentText(text) {
  return /^\s*(?:please\s+)?(?:continue|resume|keep\s+going)\b/i.test(String(text || '').trim());
}

export function isCancelIntentText(text) {
  return /^\s*[$/](?:oh-my-agy:)?cancel\b/i.test(String(text || '').trim());
}

function stripBomLocal(raw) {
  const s = String(raw ?? '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function verifyDirChainSafe(rootDir, segments, { createMissing = false } = {}) {
  const absRoot = path.resolve(String(rootDir || ''));
  let cur = absRoot;
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
      return { ok: false, error: `invalid_segment:${seg}`, path: '' };
    }
    cur = path.join(cur, seg);
    let st = null;
    try {
      st = fs.lstatSync(cur);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (!createMissing) return { ok: true, missing: true, path: cur };
        try {
          fs.mkdirSync(cur);
          st = fs.lstatSync(cur);
        } catch (mkErr) {
          return { ok: false, error: `mkdir_failed:${mkErr?.code || 'error'}`, path: cur };
        }
      } else {
        return { ok: false, error: `lstat_failed:${err?.code || 'error'}`, path: cur };
      }
    }
    if (st.isSymbolicLink()) return { ok: false, error: `symlink_blocked:${cur}`, path: cur };
    if (!st.isDirectory()) return { ok: false, error: `not_directory:${cur}`, path: cur };
  }
  return { ok: true, missing: false, path: cur };
}

function readRegularJsonSafe(filePath) {
  let st = null;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, missing: true, data: null };
    return { ok: false, error: `lstat_failed:${err?.code || 'error'}`, data: null };
  }
  if (st.isSymbolicLink()) return { ok: false, error: `symlink_blocked:${filePath}`, data: null };
  if (!st.isFile()) return { ok: false, error: `not_file:${filePath}`, data: null };
  try {
    const parsed = JSON.parse(stripBomLocal(fs.readFileSync(filePath, 'utf8')));
    return { ok: true, missing: false, data: (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null };
  } catch { /* fail open: ignore malformed JSON state file */
    return { ok: true, missing: false, data: null };
  }
}

function collectSafeModeFiles(absRoot, stateDir) {
  const files = [];
  const scanDir = (dirPath, relPrefix) => {
    let entries = [];
    try { entries = fs.readdirSync(dirPath); } catch { /* fail open: unreadable state dir */ return; }
    for (const name of entries) {
      const m = /^(.+)-state\.json$/.exec(name);
      if (!m) continue;
      const full = path.join(dirPath, name);
      let st = null;
      try { st = fs.lstatSync(full); } catch { /* fail open: transient state file */ continue; }
      if (st.isSymbolicLink() || !st.isFile()) continue;
      files.push({
        full,
        rel: `${relPrefix}/${name}`,
        modeFallback: m[1],
      });
    }
  };
  scanDir(stateDir, '.omagy/state');
  const sessionsCheck = verifyDirChainSafe(absRoot, ['.omagy', 'state', 'sessions'], { createMissing: false });
  if (sessionsCheck.ok && !sessionsCheck.missing) {
    let sessNames = [];
    try { sessNames = fs.readdirSync(sessionsCheck.path); } catch { /* fail open: unreadable sessions dir */ }
    for (const sess of sessNames) {
      const sCheck = verifyDirChainSafe(absRoot, ['.omagy', 'state', 'sessions', sess], { createMissing: false });
      if (!sCheck.ok || sCheck.missing) continue;
      scanDir(sCheck.path, `.omagy/state/sessions/${sess}`);
    }
  }
  return files;
}

function resolveContainedStateRelPath(absRoot, rawRel) {
  const norm = String(rawRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== '.omagy' || parts[1] !== 'state') return null;
  if (parts.some((p) => p === '.' || p === '..' || p.includes('\0'))) return null;
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1];
  if (!/^.+?-state\.json$/.test(fileName)) return null;
  const dirCheck = verifyDirChainSafe(absRoot, dirParts, { createMissing: false });
  if (!dirCheck.ok || dirCheck.missing) return null;
  return { full: path.join(dirCheck.path, fileName), rel: parts.join('/') };
}

/** Read workspace pause sentinel (.omagy/state/pause.json) across candidate roots with full-chain symlink safety. */
export function readPauseState(roots = []) {
  const list = Array.isArray(roots) ? roots : (roots ? [roots] : []);
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'string') continue;
    const absRoot = path.resolve(r);
    if (seen.has(absRoot)) continue;
    seen.add(absRoot);
    const dirCheck = verifyDirChainSafe(absRoot, ['.omagy', 'state'], { createMissing: false });
    if (!dirCheck.ok || dirCheck.missing) continue;
    const pauseFile = path.join(dirCheck.path, PAUSE_FILENAME);
    const res = readRegularJsonSafe(pauseFile);
    if (!res.ok || res.missing || !res.data || res.data.paused !== true) continue;
    return { paused: true, file: pauseFile, root: absRoot, data: res.data };
  }
  return { paused: false, file: '', root: '', data: null };
}

/** Atomically pause active non-terminal workflow mode files and write .omagy/state/pause.json. */
export function pauseWorkspaceExecution(rootDir, opts = {}) {
  if (!rootDir || typeof rootDir !== 'string') {
    return { ok: false, error: 'invalid_root', alreadyPaused: false, pauseFile: '', pausedAt: '', pausedModes: [] };
  }
  const absRoot = path.resolve(rootDir);
  let rootSt = null;
  try { rootSt = fs.statSync(absRoot); } catch { /* fail open: missing root checked below */ }
  if (!rootSt || !rootSt.isDirectory()) {
    return { ok: false, error: 'root_not_directory', alreadyPaused: false, pauseFile: '', pausedAt: '', pausedModes: [] };
  }
  const dirCheck = verifyDirChainSafe(absRoot, ['.omagy', 'state'], { createMissing: true });
  if (!dirCheck.ok) {
    return { ok: false, error: dirCheck.error, alreadyPaused: false, pauseFile: '', pausedAt: '', pausedModes: [] };
  }
  const stateDir = dirCheck.path;
  const pauseFile = path.join(stateDir, PAUSE_FILENAME);
  const existingRes = readRegularJsonSafe(pauseFile);
  if (!existingRes.ok) {
    return { ok: false, error: existingRes.error, alreadyPaused: false, pauseFile, pausedAt: '', pausedModes: [] };
  }
  const nowIso = String(opts.nowIso || new Date().toISOString());
  const existing = existingRes.data;
  const alreadyPaused = Boolean(existing && existing.paused === true);

  const mergedByFile = new Map();
  if (alreadyPaused && Array.isArray(existing.paused_modes)) {
    for (const entry of existing.paused_modes) {
      if (entry && typeof entry === 'object' && typeof entry.file === 'string' && entry.file) {
        mergedByFile.set(entry.file, {
          file: entry.file,
          mode: String(entry.mode || ''),
          previous_phase: String(entry.previous_phase || 'unknown'),
          previous_active: entry.previous_active !== false,
        });
      }
    }
  }

  for (const mf of collectSafeModeFiles(absRoot, stateDir)) {
    const mRes = readRegularJsonSafe(mf.full);
    if (!mRes.ok || mRes.missing || !mRes.data) continue;
    const d = mRes.data;
    const phase = String(d.current_phase || 'unknown');
    const isTerminal = PAUSE_TERMINAL_PHASES.has(phase.toLowerCase()) || (typeof d.completed_at === 'string' && d.completed_at.trim().length > 0);
    if (d.active === true && !isTerminal) {
      const next = {
        ...d,
        active: false,
        paused: true,
        paused_at: nowIso,
        paused_from_phase: phase,
      };
      writeFileAtomicWithMode(mf.full, `${JSON.stringify(next, null, 2)}\n`);
      mergedByFile.set(mf.rel, {
        file: mf.rel,
        mode: String(d.mode || mf.modeFallback),
        previous_phase: phase,
        previous_active: true,
      });
    } else if (d.paused === true && !isTerminal && !mergedByFile.has(mf.rel)) {
      mergedByFile.set(mf.rel, {
        file: mf.rel,
        mode: String(d.mode || mf.modeFallback),
        previous_phase: String(d.paused_from_phase || phase),
        previous_active: true,
      });
    }
  }

  const pausedModesList = [...mergedByFile.values()];
  const pausedAt = (alreadyPaused && typeof existing.paused_at === 'string' && existing.paused_at) ? existing.paused_at : nowIso;
  const payload = {
    version: 1,
    paused: true,
    paused_at: pausedAt,
    updated_at: nowIso,
    source: String(opts.source || 'hud'),
    reason: String(opts.reason || 'Paused via oh-my-agy HUD'),
    workspace: absRoot,
    paused_modes: pausedModesList,
  };
  writeFileAtomicWithMode(pauseFile, `${JSON.stringify(payload, null, 2)}\n`);
  return {
    ok: true,
    alreadyPaused,
    pauseFile,
    pausedAt,
    pausedModes: pausedModesList.map((m) => ({ file: m.file, mode: m.mode, previousPhase: m.previous_phase })),
  };
}

/** Atomically clear .omagy/state/pause.json and restore paused workflow mode files. */
export function resumeWorkspaceExecution(rootDir, opts = {}) {
  const nowIso = String(opts.nowIso || new Date().toISOString());
  if (!rootDir || typeof rootDir !== 'string') {
    return { ok: false, error: 'invalid_root', wasPaused: false, resumedAt: nowIso, resumedModes: [] };
  }
  const absRoot = path.resolve(rootDir);
  const dirCheck = verifyDirChainSafe(absRoot, ['.omagy', 'state'], { createMissing: false });
  if (!dirCheck.ok) {
    return { ok: false, error: dirCheck.error, wasPaused: false, resumedAt: nowIso, resumedModes: [] };
  }
  if (dirCheck.missing) {
    return { ok: true, wasPaused: false, resumedAt: nowIso, resumedModes: [] };
  }
  const stateDir = dirCheck.path;
  const pauseFile = path.join(stateDir, PAUSE_FILENAME);
  const existingRes = readRegularJsonSafe(pauseFile);
  if (!existingRes.ok) {
    return { ok: false, error: existingRes.error, wasPaused: false, resumedAt: nowIso, resumedModes: [] };
  }
  const existing = existingRes.data;
  let wasPaused = Boolean(existing && existing.paused === true);

  const candidates = new Map();
  if (existing && Array.isArray(existing.paused_modes)) {
    for (const entry of existing.paused_modes) {
      if (!entry || typeof entry.file !== 'string') continue;
      const safeTarget = resolveContainedStateRelPath(absRoot, entry.file);
      if (safeTarget) {
        candidates.set(safeTarget.full, {
          full: safeTarget.full,
          rel: safeTarget.rel,
          listed: true,
          modeFallback: String(entry.mode || ''),
        });
      }
    }
  }
  for (const mf of collectSafeModeFiles(absRoot, stateDir)) {
    if (!candidates.has(mf.full)) {
      candidates.set(mf.full, { full: mf.full, rel: mf.rel, listed: false, modeFallback: mf.modeFallback });
    }
  }

  const resumedModes = [];
  for (const cand of candidates.values()) {
    const mRes = readRegularJsonSafe(cand.full);
    if (!mRes.ok || mRes.missing || !mRes.data) continue;
    const d = mRes.data;
    const phase = String(d.current_phase || 'unknown');
    const isTerminal = PAUSE_TERMINAL_PHASES.has(phase.toLowerCase()) || (typeof d.completed_at === 'string' && d.completed_at.trim().length > 0);
    if (isTerminal) continue;
    if (d.paused === true || (cand.listed && d.active !== true)) {
      const next = { ...d };
      delete next.paused;
      delete next.paused_at;
      delete next.paused_from_phase;
      next.active = true;
      next.updated_at = nowIso;
      writeFileAtomicWithMode(cand.full, `${JSON.stringify(next, null, 2)}\n`);
      wasPaused = true;
      resumedModes.push({
        file: cand.rel,
        mode: String(next.mode || cand.modeFallback || ''),
        phase: String(next.current_phase || 'unknown'),
      });
    }
  }

  if (!existingRes.missing) {
    try { fs.unlinkSync(pauseFile); } catch (err) {
      if (err && err.code !== 'ENOENT') {
        return { ok: false, error: `unlink_failed:${err.code || 'error'}`, wasPaused, resumedAt: nowIso, resumedModes };
      }
    }
  }
  return { ok: true, wasPaused, resumedAt: nowIso, resumedModes };
}
