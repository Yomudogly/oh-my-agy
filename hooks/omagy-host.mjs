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
      if (step && typeof step.ephemeralMessage === 'string' && step.ephemeralMessage.trim()) {
        msgs.push(step.ephemeralMessage.trim());
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
