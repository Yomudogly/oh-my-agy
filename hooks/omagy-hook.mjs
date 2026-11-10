#!/usr/bin/env node
// oh-my-agy lifecycle hook runner for Antigravity.
// Dependency-free, fail-open lifecycle hook and deterministic CLI runtime for Antigravity:
//   session-start       : bounded project wiki index + active-mode reminder on new session start
//   pre-invocation      : $skill keyword routing + active-mode reminder + once-per-session wiki index
//   pre-tool-use        : opt-in planning-mode write guard (never auto-allows)
//   stop                : bounded, progress-aware continuation (NO_TOOL_CALL / model_stop) + notifications
//   verify-evidence     : deterministic validator for .omagy/evidence/<file>.json team task evidence
//   validate-team-tasks : fail-closed validator for .omagy/state/team/<team>/ task board files
//   watch-pr            : deterministic PR readiness verdict classifier (ready|waiting|blocked|gone)
//   failure-sig         : test failure signature normalizer (pytest, vitest, Node warning PIDs)
//   session-compare     : baseline vs. candidate session transcript comparator & regression gate
//   wiki-repair         : code-fence-aware [[wiki-link]] & [label](slug.md) rewriter on move/archive/delete
//   review-package      : pre-assembled commit log + diffstat + -U10 diff for $code-review
//   goal-brief          : single-goal or fence-aware markdown Task section extractor
//   check-test-junk     : 7-rule regex scanner for high-FP junk tests across JS/TS/Py/Rust/Go
//   research-matrix     : multi-lens Boolean query matrix & terminological blueprint generator for $deep-research
//   audit-research      : 5-dimension >=85 rubric & required-section linter for $deep-research reports
//   floor-guard         : 9-category anti-tampering diff & test-weakening evaluator (exit 0|1|2)
//   skill-eval          : stemmed TF-IDF skill routing & cosine collision evaluator against skill-eval-cases.json
//   quality-gate        : fail-closed semgrep & axe JSON scanner report validator (exit 0|1|2)
//   selftest            : offline verification of the above against an isolated temp workspace
// Contract: JSON on stdin, JSON on stdout, camelCase keys (Antigravity hook protocol).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

export function hardenWindowsExeSearch() {
  if (process.platform === 'win32') {
    process.env.NoDefaultCurrentDirectoryInExePath = '1';
  }
}
hardenWindowsExeSearch();

export const SKILLS = [
  'ai-slop-cleaner', 'analyze', 'ask', 'autopilot', 'autoresearch', 'best-practice-research',
  'cancel', 'code-review', 'configure-notifications', 'deep-interview', 'deep-research', 'design',
  'doctor', 'handoff', 'hud', 'loft', 'omagy-setup', 'performance-goal', 'plan', 'pr', 'ralplan',
  'skill', 'team', 'ultragoal', 'ultraqa', 'visual-ralph', 'wiki',
];
// Antigravity built-in slash commands: `/name` belongs to Antigravity, only `$name` routes to us.
const AGY_SLASH = new Set(['goal', 'compact', 'schedule', 'browser', 'plan', 'grill-me', 'teamwork', 'teamwork-preview', 'learn', 'boost', 'plugin', 'automation']);
const CONTINUATION_MODES = ['autopilot', 'ultragoal', 'ultraqa', 'autoresearch', 'performance-goal'];
const PLANNING_MODES = ['deep-interview', 'ralplan', 'plan'];
const TERMINAL = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
// Antigravity passes "NO_TOOL_CALL" on normal turn completion (ExecutorTerminationReason);
// also accept "model_stop" and "" for compatibility and offline tests.
const NORMAL_STOP_REASONS = new Set(['no_tool_call', 'model_stop', '']);
function intOr(val, fallback, min = 1) {
  if (typeof val === 'number') return Number.isSafeInteger(val) && val >= min ? val : fallback;
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
}
const STALE_MS = intOr(process.env.OMAGY_STALE_MS, 6 * 3600 * 1000, 1);
const MAX_NUDGES = intOr(process.env.OMAGY_MAX_NUDGES, 2, 1);
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const MAX_WIKI_CONTEXT_CHARS = 3500;
const MAX_WIKI_CONTEXT_LINES = 60;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_WALK_DEPTH = 8;
export const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.sh', '.bash', '.zsh',
  '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.rb', '.php', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp',
]);
const COMPLETION_CLAIM_RE = /\b(?:done|complete[sd]?|finished|implemented|fixed|resolved|all set|ready\s+(?:for\s+(?:review|merge|release|qa|testing)|to\s+(?:merge|ship|release|submit)))\b/i;
export const BLOCKER_PATTERNS = [
  { kind: 'skipped test', pattern: /^\s*(?:it|test|describe)\.skip\s*\(\s*(?:["'`)]|$)/i },
  { kind: 'focused test', pattern: /^\s*(?:it|test|describe)\.only\s*\(/i },
  { kind: 'placeholder TODO', pattern: /\/\/\s*TODO\b(?:\([^)]*\))?\s*:?\s*(?:implement|fix|replace|stub|placeholder|later|follow[- ]?up|wire|add\b|fill)/i },
  { kind: 'unimplemented throw', pattern: /^\s*throw\s+new\s+Error\s*\(\s*["'`](?:TODO|Not implemented|unimplemented|stub)/i },
  { kind: 'placeholder return', pattern: /^\s*return\s+(?:null|undefined)\s*;?\s*\/\/\s*(?:TODO|stub|placeholder|not implemented)/i },
];

// ---------- utilities ----------
function runtimeDir() {
  return process.env.OMAGY_RUNTIME_DIR || path.join(os.tmpdir(), 'oh-my-agy');
}
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
function parseJson(text) {
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch { /* fail open */ }
}
function safeId(v) {
  return String(v || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}
function runtimeFile(conversationId, kind) {
  return path.join(runtimeDir(), `${safeId(conversationId)}.${kind}.json`);
}
function workspaceRoots(payload) {
  const list = payload.workspacePaths || payload.workspace_paths || [];
  const raw = (Array.isArray(list) ? list : [list]).filter((p) => typeof p === 'string' && p.trim());
  if (!raw.length && process.env.OMAGY_WORKSPACE) raw.push(process.env.OMAGY_WORKSPACE);
  return raw.filter((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}
function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function nonPlaceholderText(value) {
  return typeof value === 'string' && value.trim().length > 0
    && !/^(?:todo|tbd|placeholder|pending|not run)[.!]?$/i.test(value.trim());
}
function canonicalizePath(p, depth = 0) {
  const abs = path.resolve(String(p || ''));
  if (depth > 8) return abs;
  let cur = abs;
  const tail = [];
  for (let i = 0; i < MAX_WORKSPACE_WALK_DEPTH * 4; i += 1) {
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) {
        const linkTarget = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
        return canonicalizePath(path.join(linkTarget, ...tail), depth + 1);
      }
      return path.join(fs.realpathSync(cur), ...tail);
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return abs;
}
function hasSymlinkSegment(rootPath, targetPath) {
  const rootReal = canonicalizePath(rootPath);
  const rootAbs = path.resolve(String(rootPath || ''));
  const targetAbs = path.resolve(String(targetPath || ''));
  for (const base of [rootAbs, rootReal]) {
    const rel = path.relative(base, targetAbs);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    let cur = rootReal;
    for (const part of rel.split(/[/\\]/)) {
      if (!part) continue;
      cur = path.join(cur, part);
      try {
        if (fs.lstatSync(cur).isSymbolicLink()) return true;
      } catch {
        break;
      }
    }
  }
  return false;
}
const SUBAGENT_PROMPT_RE = /^(?:\s*TEAM\s+\S+\s+[—-]\s+TASK\b|\s*<identity>\s*\n\s*You are |\s*<antigravity_runtime>)/m;
function isSubagentPayload(payload, userText = '') {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.isSubagent === true || payload.is_subagent === true) return true;
  if (payload.parentConversationId || payload.parent_conversation_id || payload.subagentType || payload.subagent_type) return true;
  return Boolean(userText && (SUBAGENT_PROMPT_RE.test(userText) || userText.includes('<antigravity_runtime>')));
}

// ---------- mode state & multi-repo root ----------
const IGNORED_SCAN_DIRS = new Set([
  '.git', '.hg', '.svn', '.omagy', 'omagy_wiki', 'node_modules',
  'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'target', 'vendor',
  'coverage', '.venv', 'venv', '__pycache__', '.tox', '.cache', '.turbo', 'sidecars',
]);

function hasProjectOrStateMarker(dir) {
  try {
    for (const marker of ['.omagy', 'omagy_wiki', '.git']) {
      const p = path.join(dir, marker);
      if (fs.existsSync(p) && !fs.lstatSync(p).isSymbolicLink()) return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function stateRoot(root) {
  const baseRoot = canonicalizePath(root || process.cwd());
  const envOverride = (process.env.OMAGY_ROOT || process.env.OMAGY_STATE_ROOT || '').trim();
  if (envOverride) {
    const resolved = canonicalizePath(path.isAbsolute(envOverride) ? envOverride : path.resolve(baseRoot, envOverride));
    return path.basename(resolved) === '.omagy' ? path.dirname(resolved) : resolved;
  }
  let cur = baseRoot;
  let ancestorProjectRoot = '';
  const baseHasMarker = hasProjectOrStateMarker(baseRoot);
  for (let i = 0; i < MAX_WORKSPACE_WALK_DEPTH; i += 1) {
    try {
      if (fs.existsSync(path.join(cur, '.omagy-workspace'))) {
        return cur;
      }
      if (i > 0 && !baseHasMarker && !ancestorProjectRoot && hasProjectOrStateMarker(cur)) {
        ancestorProjectRoot = cur;
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const envWs = (process.env.OMAGY_WORKSPACE || '').trim();
  if (envWs && !baseHasMarker) {
    const canonWs = canonicalizePath(envWs);
    if (baseRoot === canonWs || baseRoot.startsWith(canonWs + path.sep)) {
      return canonWs;
    }
  }
  return ancestorProjectRoot || baseRoot;
}

export function discoverOmagyScopes(root, maxDepth = 3, maxDirs = 150) {
  const baseRoot = canonicalizePath(root || process.cwd());
  const scopes = [];
  const seenRoots = new Set();
  const addScope = (dirRoot, relScope) => {
    const canon = canonicalizePath(dirRoot);
    if (seenRoots.has(canon)) return;
    const omagyDir = path.join(canon, '.omagy');
    try {
      const st = fs.lstatSync(omagyDir);
      if (!st.isSymbolicLink() && st.isDirectory()) {
        seenRoots.add(canon);
        scopes.push({ root: canon, scope: relScope || '.', omagyDir });
      }
    } catch { /* ignore */ }
  };
  addScope(baseRoot, '.');
  let visited = 0;
  const queue = [{ dir: baseRoot, rel: '', depth: 0 }];
  while (queue.length > 0 && visited < maxDirs) {
    const { dir, rel, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (visited >= maxDirs) break;
      const name = entry.name;
      if (name.startsWith('.') || IGNORED_SCAN_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      visited += 1;
      const childRel = rel ? `${rel}/${name}` : name;
      addScope(full, childRel);
      if (depth + 1 < maxDepth) {
        queue.push({ dir: full, rel: childRel, depth: depth + 1 });
      }
    }
  }
  return scopes;
}

function omagyLogsDir(root) {
  return path.join(stateRoot(root), '.omagy', 'logs');
}
function readStateDir(dir, root, convId, scope = '.') {
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return [];
  } catch { return []; }
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const m = /^(.+)-state\.json$/.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(file); } catch { continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    const data = readJson(file);
    if (!data || typeof data !== 'object') continue;
    const mtimeMs = st.mtimeMs || 0;
    const owner = data.owner_conversation_id || data.conversation_id || data.session_id || '';
    const foreignOwner = Boolean(convId && owner && String(owner) !== String(convId));
    out.push({ mode: String(data.mode || m[1]), file, data, mtimeMs, root, scope, owner: String(owner || ''), foreignOwner });
  }
  return out;
}
function loadModeStates(root, convId = '') {
  const sRoot = stateRoot(root);
  const byMode = new Map();
  const consider = (s) => {
    const prev = byMode.get(s.mode);
    if (!prev || (!isActive(prev) && isActive(s))) {
      byMode.set(s.mode, s);
    }
  };
  if (convId) {
    const sessDir = path.join(sRoot, '.omagy', 'state', 'sessions', safeId(convId));
    for (const s of readStateDir(sessDir, sRoot, convId, '.')) consider(s);
  }
  const sharedDir = path.join(sRoot, '.omagy', 'state');
  for (const s of readStateDir(sharedDir, sRoot, convId, '.')) consider(s);

  // If the parent project folder has no .omagy (or no active state in parent .omagy), also check inner-folder .omagy scopes (e.g. Travels/Summer trip/.omagy)
  if (byMode.size === 0 || ![...byMode.values()].some((s) => isActive(s))) {
    for (const sc of discoverOmagyScopes(sRoot)) {
      if (sc.root === sRoot) continue;
      if (convId) {
        const sessDir = path.join(sc.root, '.omagy', 'state', 'sessions', safeId(convId));
        for (const s of readStateDir(sessDir, sc.root, convId, sc.scope)) consider(s);
      }
      const innerShared = path.join(sc.root, '.omagy', 'state');
      for (const s of readStateDir(innerShared, sc.root, convId, sc.scope)) consider(s);
    }
  }
  return [...byMode.values()];
}
function updatedMs(s) {
  return Date.parse(s.data.updated_at || '') || s.mtimeMs || 0;
}
export const CONFIRMATION_MTIME_TOLERANCE_MS = 5000;
export function isAwaitingConfirmation(s) {
  if (!s || !s.data || typeof s.data !== 'object') return false;
  const d = s.data;
  const ac = d.awaiting_confirmation ?? d.state?.awaiting_confirmation;
  if (ac !== true) return false;
  const setAtRaw = d.awaiting_confirmation_set_at ?? d.state?.awaiting_confirmation_set_at;
  if (typeof setAtRaw === 'string' && setAtRaw.trim()) {
    const setAtMs = Date.parse(setAtRaw.trim());
    const refMs = Math.max(updatedMs(s), Number(s.mtimeMs || 0));
    if (Number.isFinite(setAtMs) && refMs > 0 && Math.abs(refMs - setAtMs) > CONFIRMATION_MTIME_TOLERANCE_MS) {
      return false;
    }
  }
  return true;
}
function isActive(s, now = Date.now()) {
  if (s.foreignOwner) return false;
  const d = s.data;
  if (!d || d.active !== true) return false;
  if (TERMINAL.has(String(d.current_phase || '').toLowerCase())) return false;
  if (typeof d.completed_at === 'string' && d.completed_at.trim()) return false;
  // Waiting on human confirmation is neither crashed/stale nor eligible for auto-nudge.
  if (isAwaitingConfirmation(s)) return true;
  return now - updatedMs(s) <= STALE_MS;
}
function activeStates(roots, modes, convId = '') {
  const now = Date.now();
  const seen = new Set();
  const all = [];
  for (const r of roots) {
    for (const s of loadModeStates(r, convId)) {
      if (seen.has(s.file) || !isActive(s, now)) continue;
      seen.add(s.file);
      all.push(s);
    }
  }
  const filtered = modes ? all.filter((s) => modes.includes(s.mode)) : all;
  const order = modes || CONTINUATION_MODES;
  return filtered.sort((a, b) => {
    const ia = order.indexOf(a.mode); const ib = order.indexOf(b.mode);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// ---------- wiki & working agreements summary (expiry filtering & secret redaction) ----------
export function redactSecrets(text) {
  return String(text || '')
    .replace(/\bsk-(?:proj-|ant-[a-z0-9-]+-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(?:(?:gh[pousr]|github_pat)_[A-Za-z0-9_-]{16,}|(?:glpat|xox[baprs])-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/(--(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|client[-_]?secret|secret|password)=['"]?)(?!\$|\{\{|\[REDACTED|process\.env\.|null\b|example\b|placeholder\b)[A-Za-z0-9._~+/=-]{12,}(['"]?)/gi, '$1[REDACTED_SECRET]$2')
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)(?!\$|\{\{|\[REDACTED|process\.env\.|null\b|example\b|placeholder\b)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|password|secret|token)\b\s*[:=]\s*['"])(?!\$|\{\{|\[REDACTED|process\.env\.|null\b|example\b|placeholder\b)[^'"\r\n]{12,}(['"])/gi, '$1[REDACTED_SECRET]$2');
}
function filterAndRedactWikiLines(raw, maxLines, nowMs = Date.now()) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  let body = text;
  if (fmMatch) {
    const expMatch = /^\s*expires\s*:\s*['"]?([^\r\n'"]+)['"]?\s*$/im.exec(fmMatch[1]);
    if (expMatch) {
      const expMs = Date.parse(expMatch[1].trim());
      if (Number.isFinite(expMs) && expMs <= nowMs) return [];
    }
    body = text.slice(fmMatch[0].length).trim();
  }
  const out = [];
  for (const line of body.split('\n')) {
    const inlineExp = /(?:\[|\()\s*expires\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[^\])\s]+)?)\s*(?:\]|\))/i.exec(line);
    if (inlineExp) {
      const expMs = Date.parse(inlineExp[1]);
      if (Number.isFinite(expMs) && expMs <= nowMs) continue;
    }
    out.push(redactSecrets(line));
    if (out.length >= maxLines) break;
  }
  return out;
}
function loadWikiSummary(roots, nowMs = Date.now()) {
  for (const rawRoot of roots) {
    const root = stateRoot(rawRoot);
    const indexPath = path.join(root, 'omagy_wiki', 'index.md');
    const agreementsPath = path.join(root, 'omagy_wiki', 'agreements.md');
    let indexRaw = '';
    let agreementsRaw = '';
    try { indexRaw = fs.readFileSync(indexPath, 'utf8').trim(); } catch { /* ignore */ }
    try { agreementsRaw = fs.readFileSync(agreementsPath, 'utf8').trim(); } catch { /* ignore */ }
    const agLines = filterAndRedactWikiLines(agreementsRaw, 25, nowMs);
    const idxLines = filterAndRedactWikiLines(indexRaw, MAX_WIKI_CONTEXT_LINES, nowMs);
    if (!agLines.length && !idxLines.length) continue;
    const parts = [];
    if (agLines.length) {
      parts.push(
        '[oh-my-agy] Working Agreements (omagy_wiki/agreements.md):',
        ...agLines,
      );
    }
    if (idxLines.length) {
      parts.push(
        '[oh-my-agy] Project Wiki index (omagy_wiki/index.md):',
        ...idxLines,
      );
    }
    const summary = parts.join('\n');
    if (summary.length <= MAX_WIKI_CONTEXT_CHARS) return summary;
    const notice = '\n[Wiki index truncated; use $wiki read or $wiki query for more.]';
    const bounded = summary.slice(0, MAX_WIKI_CONTEXT_CHARS - notice.length);
    const lastNewline = bounded.lastIndexOf('\n');
    return (lastNewline > 0 ? bounded.slice(0, lastNewline) : bounded) + notice;
  }
  return null;
}

// ---------- hierarchical subdirectory AGENTS.md discovery ----------
function discoverSubdirAgents(roots, text, seenList = [], nowMs = Date.now()) {
  if (!text || typeof text !== 'string' || !roots.length) return { messages: [], seen: seenList };
  const seen = new Set(Array.isArray(seenList) ? seenList : []);
  const messages = [];
  const tokenRe = /(?:file:\/\/)?([A-Za-z0-9_./-]+\/[A-Za-z0-9_.-]+)/g;
  const candidates = new Set();
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    if (candidates.size >= 24) break;
    candidates.add(m[1]);
  }
  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    for (const token of candidates) {
      const resolved = path.isAbsolute(token) ? path.resolve(token) : path.resolve(root, token);
      if (!resolved.startsWith(root + path.sep)) continue;
      let dir = resolved;
      try {
        if (!fs.existsSync(dir) || fs.statSync(dir).isFile()) dir = path.dirname(dir);
      } catch {
        dir = path.dirname(dir);
      }
      const chain = [];
      while (dir.startsWith(root + path.sep) && dir !== root && chain.length < MAX_WORKSPACE_WALK_DEPTH) {
        chain.unshift(dir);
        dir = path.dirname(dir);
      }
      for (const d of chain) {
        const agentsFile = path.join(d, 'AGENTS.md');
        if (!seen.has(agentsFile)) {
          let raw = '';
          try { raw = fs.readFileSync(agentsFile, 'utf8').trim(); } catch { raw = ''; }
          if (raw) {
            seen.add(agentsFile);
            const rel = path.relative(root, agentsFile);
            const snippet = redactSecrets(raw.split('\n').slice(0, 30).join('\n')).slice(0, 1500);
            messages.push(`[oh-my-agy] Subdirectory AGENTS.md (${rel}):\n${snippet}`);
          }
        }
        const childWikiDir = path.join(d, 'omagy_wiki');
        if (!seen.has(childWikiDir)) {
          let agRaw = '';
          let idxRaw = '';
          try { agRaw = fs.readFileSync(path.join(childWikiDir, 'agreements.md'), 'utf8').trim(); } catch { agRaw = ''; }
          try { idxRaw = fs.readFileSync(path.join(childWikiDir, 'index.md'), 'utf8').trim(); } catch { idxRaw = ''; }
          const agLines = filterAndRedactWikiLines(agRaw, 12, nowMs);
          const idxLines = filterAndRedactWikiLines(idxRaw, 15, nowMs);
          if (agLines.length || idxLines.length) {
            seen.add(childWikiDir);
            const relWiki = path.relative(root, childWikiDir);
            const parts = [`[oh-my-agy] Child-project Wiki (${relWiki}):`, ...agLines, ...idxLines];
            messages.push(parts.join('\n').slice(0, 1500));
          }
        }
        if (messages.length >= 3) return { messages, seen: [...seen] };
      }
    }
  }
  return { messages, seen: [...seen] };
}

// ---------- team completion evidence & task-board validators ----------
export const VERIFICATION_VERDICTS = Object.freeze([
  'live-ui-verified',
  'unit-test-verified',
  'type-check-only',
  'enforcement-verified',
  'formally-verified',
  'verifier-blocked',
  'verifier-failed',
]);
const PASSING_VERIFICATION_VERDICTS = new Set([
  'live-ui-verified',
  'unit-test-verified',
  'type-check-only',
  'enforcement-verified',
  'formally-verified',
]);
export function renderLedgerCell(val) {
  const clean = String(val ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
}
const NOOP_VERIFICATION_BINS = new Set(['echo', 'printf', 'true', ':', 'rem', 'noop']);
const PASSTHROUGH_BINS = new Set(['env', 'time', 'nice', 'nohup', 'command']);
function isRealVerificationCommand(cmd) {
  if (!nonPlaceholderText(cmd)) return false;
  const tokens = String(cmd).trim().split(/\s+/);
  for (const rawTok of tokens) {
    const tok = rawTok.replace(/^['"]|['"]$/g, '');
    if (!tok) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
    if (tok.startsWith('-')) continue;
    const bin = path.basename(tok).toLowerCase();
    if (PASSTHROUGH_BINS.has(bin)) continue;
    return !NOOP_VERIFICATION_BINS.has(bin);
  }
  return false;
}
export function validateCompletionEvidence(cwd, evidenceRelPath, opts = {}) {
  if (!cwd || !nonPlaceholderText(evidenceRelPath)) {
    throw new Error('Include EVIDENCE_RECORDED: .omagy/evidence/<file>.json with a valid path.');
  }
  const rootReal = fs.realpathSync(path.resolve(cwd));
  const target = path.resolve(rootReal, String(evidenceRelPath).trim());
  const evidenceBase = path.join(rootReal, '.omagy', 'evidence');
  const relToBase = path.relative(evidenceBase, target);
  if (!relToBase || relToBase === '..' || relToBase.startsWith(`..${path.sep}`) || path.isAbsolute(relToBase)) {
    throw new Error('Evidence must be inside .omagy/evidence/.');
  }
  const relFromRoot = path.relative(rootReal, target);
  let current = rootReal;
  for (const part of relFromRoot.split(/[/\\]/)) {
    if (!part) continue;
    current = path.join(current, part);
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) {
      throw new Error('Evidence paths must not contain symlinks.');
    }
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_EVIDENCE_BYTES) {
    throw new Error('Evidence must be a non-empty JSON file of at most 1 MiB.');
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    throw new Error('Evidence file is not valid JSON.');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Evidence must be a JSON object.');
  }
  const teamVal = evidence.team ?? evidence.teamName;
  if (opts.team && teamVal !== opts.team) {
    throw new Error(`Evidence team "${teamVal ?? ''}" does not match expected team "${opts.team}".`);
  }
  if (opts.taskId && String(evidence.taskId ?? '') !== String(opts.taskId)) {
    throw new Error(`Evidence taskId "${evidence.taskId ?? ''}" does not match expected taskId "${opts.taskId}".`);
  }
  if (evidence.verdict !== undefined && evidence.verdict !== null) {
    const v = String(evidence.verdict).trim();
    if (!VERIFICATION_VERDICTS.includes(v)) {
      throw new Error(`Evidence verdict "${v}" must be one of: ${VERIFICATION_VERDICTS.join(', ')}.`);
    }
    if (!PASSING_VERIFICATION_VERDICTS.has(v)) {
      throw new Error(`Evidence verdict "${v}" does not authorize task completion.`);
    }
  }
  const verifiedHeadRaw = evidence.verified_head ?? evidence.sha;
  if (verifiedHeadRaw !== undefined && verifiedHeadRaw !== null) {
    const vh = String(verifiedHeadRaw).trim();
    if (!/^[0-9a-fA-F]{7,64}$/.test(vh)) {
      throw new Error(`Evidence verified_head "${vh}" must be a valid Git commit SHA (7-64 hex chars).`);
    }
  }
  if (!nonPlaceholderText(evidence.summary)
      || !Array.isArray(evidence.verification)
      || evidence.verification.length === 0
      || evidence.verification.some((check) => {
        if (!check || typeof check !== 'object') return true;
        return !isRealVerificationCommand(check.command) || check.result !== 'passed' || !nonPlaceholderText(check.output);
      })
      || !Array.isArray(evidence.unverified)
      || evidence.unverified.some((item) => !nonPlaceholderText(item))) {
    throw new Error('Evidence requires summary, real non-echo passing verification checks (command/result:"passed"/output), and an unverified array.');
  }
  return {
    ok: true,
    file: target,
    taskId: evidence.taskId ?? null,
    team: teamVal ?? null,
    verdict: evidence.verdict ?? null,
    verifiedHead: verifiedHeadRaw ? String(verifiedHeadRaw).trim() : null,
  };
}

export function validateTeamTasks(cwd, teamName) {
  const cleanTeam = String(teamName || '').trim();
  if (!cwd || !cleanTeam || /[/\\]|\.\./.test(cleanTeam)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam || '<empty>'}`] };
  }
  const sRoot = stateRoot(path.resolve(cwd));
  const teamDir = path.join(sRoot, '.omagy', 'state', 'team', cleanTeam);
  if (!fs.existsSync(teamDir)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam}/<missing_dir>`] };
  }
  if (hasSymlinkSegment(sRoot, teamDir)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam}/<symlink_dir>`] };
  }
  const errors = [];
  let taskCount = 0;
  const checkDirs = [teamDir];
  const subTasksDir = path.join(teamDir, 'tasks');
  try {
    if (fs.existsSync(subTasksDir)) {
      if (fs.lstatSync(subTasksDir).isSymbolicLink()) {
        errors.push(`team_task_read_failed:${cleanTeam}/tasks`);
      } else if (fs.statSync(subTasksDir).isDirectory()) {
        checkDirs.push(subTasksDir);
      }
    }
  } catch {
    errors.push(`team_task_read_failed:${cleanTeam}/tasks`);
  }

  for (const dir of checkDirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch {
      errors.push(`team_task_read_failed:${cleanTeam}/${path.basename(dir)}`);
      continue;
    }
    for (const name of entries) {
      if (name !== 'tasks.json' && !/^task-.+\.json$/i.test(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(full); } catch {
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      if (st.isSymbolicLink() || !st.isFile() || st.size === 0 || st.size > MAX_EVIDENCE_BYTES) {
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(full, 'utf8')); } catch {
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      if (name === 'tasks.json') {
        const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks) ? parsed.tasks : null);
        if (!list) {
          errors.push(`team_task_read_failed:${cleanTeam}/tasks.json`);
          continue;
        }
        for (const item of list) {
          if (!item || typeof item !== 'object' || !nonPlaceholderText(item.id) || typeof item.status !== 'string' || !item.status.trim()) {
            errors.push(`team_task_read_failed:${cleanTeam}/tasks.json`);
            break;
          }
          taskCount += 1;
        }
      } else {
        const expectedId = name.replace(/^task-/i, '').replace(/\.json$/i, '');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !nonPlaceholderText(parsed.id) || typeof parsed.status !== 'string' || !parsed.status.trim()) {
          errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
          continue;
        }
        if (String(parsed.id).trim() !== expectedId) {
          errors.push(`team_task_read_failed:${cleanTeam}/${name}:task_id_mismatch`);
          continue;
        }
        taskCount += 1;
      }
    }
  }
  const ok = errors.length === 0 && taskCount > 0;
  if (taskCount === 0 && errors.length === 0) {
    errors.push(`team_task_read_failed:${cleanTeam}/<no_tasks>`);
  }
  return { ok, exitCode: ok ? 0 : 1, team: cleanTeam, taskCount, errors };
}

// ---------- configurable custom quality gates ----------
const QUALITY_GATE_STAGES = new Set(['deep-interview', 'ralplan', 'code-review']);
const RESERVED_GATE_SKILLS = new Set([
  'deep-interview', 'ralplan', 'code-review', 'ai-slop-cleaner', 'autopilot',
  'ultragoal', 'team', 'plan', 'ultraqa', 'cancel', 'verification',
]);
const SUNSET_GATE_SKILLS = new Set(['ralph', 'ultrawork', 'pipeline', 'ecomode', 'swarm']);
const VALID_GATE_MODELS = new Set(['inherit', 'flash', 'pro']);
export function validateQualityGates(cwd, requestedStage = '') {
  const rawCwd = String(cwd || '').trim();
  if (rawCwd && /\.json$/i.test(rawCwd)) {
    return {
      ok: false,
      stage: requestedStage || null,
      gates: [],
      errors: [
        `'${rawCwd}' looks like a JSON report file, not a workspace directory. To validate semgrep/axe scanner JSON reports, run 'sh ./hooks/run.sh quality-gate ${rawCwd}' (singular 'quality-gate').`,
      ],
    };
  }
  const sRoot = stateRoot(cwd || process.cwd());
  const cfgPath = path.join(sRoot, '.omagy', 'config.json');
  if (!fs.existsSync(cfgPath)) {
    return { ok: true, stage: requestedStage || null, gates: [], errors: [] };
  }
  const cfg = readJson(cfgPath);
  if (!cfg || typeof cfg !== 'object' || cfg.qualityGates === undefined) {
    return { ok: true, stage: requestedStage || null, gates: [], errors: [] };
  }
  const errors = [];
  if (!cfg.qualityGates || typeof cfg.qualityGates !== 'object' || Array.isArray(cfg.qualityGates)) {
    return { ok: false, stage: requestedStage || null, gates: [], errors: ['qualityGates must be an object keyed by stage (deep-interview, ralplan, code-review).'] };
  }
  for (const key of Object.keys(cfg.qualityGates)) {
    if (!QUALITY_GATE_STAGES.has(key)) {
      errors.push(`Unsupported qualityGates stage '${key}'. Valid stages: deep-interview, ralplan, code-review.`);
    }
  }
  if (requestedStage && !QUALITY_GATE_STAGES.has(requestedStage)) {
    errors.push(`Unsupported requested stage '${requestedStage}'. Valid stages: deep-interview, ralplan, code-review.`);
    return { ok: false, stage: requestedStage, gates: [], errors };
  }
  const stagesToRead = requestedStage ? [requestedStage] : [...QUALITY_GATE_STAGES];
  const gates = [];
  for (const stage of stagesToRead) {
    const rawList = cfg.qualityGates[stage];
    if (rawList === undefined) continue;
    if (!Array.isArray(rawList)) {
      errors.push(`qualityGates.${stage} must be an array.`);
      continue;
    }
    const seenInStage = new Set();
    for (const entry of rawList) {
      const rawSkill = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.skill : '');
      const normalized = String(rawSkill || '').trim().replace(/^[$/]+/, '').toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
        errors.push(`Invalid quality gate skill '${rawSkill}' in stage '${stage}'.`);
        continue;
      }
      if (RESERVED_GATE_SKILLS.has(normalized)) {
        errors.push(`Workflow-controller skill '${normalized}' is reserved and cannot be configured as a quality gate for stage '${stage}'.`);
        continue;
      }
      if (SUNSET_GATE_SKILLS.has(normalized)) {
        errors.push(`Sunset skill '${normalized}' cannot be configured as a quality gate for stage '${stage}'.`);
        continue;
      }
      if (seenInStage.has(normalized)) {
        errors.push(`Duplicate quality gate skill '${normalized}' in stage '${stage}'.`);
        continue;
      }
      seenInStage.add(normalized);
      const mode = (entry && typeof entry === 'object' && entry.mode !== undefined) ? String(entry.mode).trim().toLowerCase() : 'blocking';
      if (mode !== 'blocking' && mode !== 'advisory') {
        errors.push(`Invalid mode '${mode}' for gate '${normalized}' in stage '${stage}' (expected 'blocking' or 'advisory').`);
        continue;
      }
      const model = (entry && typeof entry === 'object' && entry.model !== undefined) ? String(entry.model).trim().toLowerCase() : 'inherit';
      if (!VALID_GATE_MODELS.has(model)) {
        errors.push(`Invalid model '${model}' for gate '${normalized}' in stage '${stage}' (expected 'inherit', 'flash', or 'pro').`);
        continue;
      }
      gates.push({ stage, skill: normalized, mode, model });
    }
  }
  return { ok: errors.length === 0, stage: requestedStage || null, gates, errors };
}

// ---------- crash-resilient JSONL helpers ----------
export function appendJsonlRecord(filePath, rawRecord) {
  const resolved = path.resolve(String(filePath || ''));
  let parsed;
  try {
    parsed = typeof rawRecord === 'string' ? JSON.parse(rawRecord) : rawRecord;
  } catch {
    throw new Error('Invalid JSON record for JSONL append.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSONL record must be a JSON object.');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  let prefix = '';
  try {
    const st = fs.lstatSync(resolved);
    if (st.isSymbolicLink()) throw new Error('Refusing to append to symlinked JSONL file.');
    if (st.size > 0) {
      const fd = fs.openSync(resolved, 'r');
      try {
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, st.size - 1);
        if (b[0] !== 0x0a) prefix = '\n';
      } finally { fs.closeSync(fd); }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('symlink')) throw err;
  }
  const line = `${prefix}${JSON.stringify(parsed)}\n`;
  fs.appendFileSync(resolved, line, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, file: resolved, isolatedNewline: prefix === '\n' };
}

export function readJsonlRecords(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink()) throw new Error('Refusing to read symlinked JSONL file.');
  const raw = fs.readFileSync(resolved, 'utf8');
  const records = [];
  let skipped = 0;
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) records.push(obj);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { ok: true, file: resolved, records, skipped };
}

// ---------- codebase reuse map, shortcut debt ledger & diff code-health helpers ----------
// shortcut: regex symbol scan skips dynamic/barrel re-exports, upgrade to tree-sitter if dynamic export misses matter
const MAP_MAX_FILES = 4000;
const MAP_SRC_RE = /\.(py|js|jsx|mjs|cjs|ts|tsx|mts|cts|go|rs|rb|java|kt|kts|php|swift|cs)$/i;
const MAP_SKIP_DIR_RE = /(^|\/)(node_modules|\.git|\.omagy|omagy_wiki|dist|build|out|vendor|venv|\.venv|__pycache__|coverage|\.next|target|migrations|versions|fixtures|tests?|__tests__|spec)(\/|$)/i;
const MAP_SKIP_FILE_RE = /(^|\/)(test_[^/]*|[^/]*(_test|\.test|\.spec|\.gen|\.min|\.d)\.[a-z]+)$/i;
const MAP_EXPORT_NAME_RE = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+[A-Za-z_$][\w$]*)?$/;
const MAP_SAFE_PATH_RE = /^[\w.@+$()[\]\/-]+$/;
const MAP_SHARED_RE = /(util|helper|lib|common|shared|service|component|hook|core|model|schema|api)/i;
const MAP_PATTERNS = {
  py: [/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm, /^class\s+([A-Za-z]\w*)/gm],
  js: [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s*\{([^}]+)\}/gm,
  ],
  go: [/^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([A-Z]\w*)/gm],
  rs: [/^pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+(\w+)/gm],
  rb: [/^\s*(?:def\s+(?:self\.)?|class\s+|module\s+)([A-Za-z]\w*[?!]?)/gm],
  jvm: [/^\s*(?:public\s+|export\s+)?(?:abstract\s+|final\s+|sealed\s+|data\s+)?(?:class|interface|enum|record|struct|func|fun|function)\s+([A-Za-z]\w*)/gm],
};
const MAP_LANG = {
  py: 'py',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js',
  go: 'go', rs: 'rs', rb: 'rb',
  java: 'jvm', kt: 'jvm', kts: 'jvm', php: 'jvm', swift: 'jvm', cs: 'jvm',
};
const GENERIC_SYMBOLS = new Set([
  'main', 'init', 'run', 'get', 'set', 'test', 'setup', 'open', 'close', 'read', 'write',
  'start', 'stop', 'load', 'save', 'update', 'create', 'delete', 'handle', 'render', 'index',
  'new', 'call', 'apply', 'remove', 'reset', 'clear', 'parse', 'format',
]);
const DIFF_DEF_PATTERNS = [
  [/\.py$/i, [/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm, /^class\s+([A-Za-z]\w*)/gm]],
  [/\.[cm]?[jt]sx?$/i, [
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm,
    /^class\s+([A-Za-z_$][\w$]*)/gm,
  ]],
  [/\.go$/i, [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z]\w*)/gm]],
  [/\.rs$/i, [/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm]],
  [/\.rb$/i, [/^\s*def\s+(?:self\.)?([A-Za-z]\w*[?!]?)/gm]],
  [/\.(?:java|kt|kts|php|swift|cs)$/i, [/^\s*(?:public\s+|export\s+)?(?:abstract\s+|final\s+|sealed\s+|data\s+)?(?:class|interface|enum|record|struct|func|fun|function)\s+([A-Za-z]\w*)/gm]],
];

function isMapSourceFile(relFile) {
  const norm = String(relFile || '').replace(/\\/g, '/');
  return MAP_SRC_RE.test(norm) && !MAP_SKIP_DIR_RE.test(norm) && !MAP_SKIP_FILE_RE.test(norm);
}

function listRepoSourceFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) {
      return out.split('\n').slice(0, MAP_MAX_FILES * 5).filter((f) => MAP_SAFE_PATH_RE.test(f) && isMapSourceFile(f)).slice(0, MAP_MAX_FILES);
    }
  } catch { /* fall through to directory walk */ }
  const files = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6 || files.length >= MAP_MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAP_MAX_FILES) return;
      if (e.name[0] === '.' || e.isSymbolicLink()) continue;
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!MAP_SKIP_DIR_RE.test(sub)) walk(path.join(dir, e.name), sub, depth + 1);
      } else if (e.isFile() && MAP_SAFE_PATH_RE.test(sub) && isMapSourceFile(sub)) {
        files.push(sub);
      }
    }
  };
  walk(root, '', 0);
  return files;
}

function extractExportedNames(text, ext) {
  const rules = MAP_PATTERNS[MAP_LANG[ext]];
  if (!rules) return [];
  const names = [];
  for (const re of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      for (const rawPart of m[1].split(',')) {
        const hit = MAP_EXPORT_NAME_RE.exec(rawPart.trim());
        const id = hit && hit[1];
        if (id && id[0] !== '_' && !names.includes(id)) names.push(id);
      }
    }
  }
  return names;
}

export function buildCodebaseMap(roots, budget = intOr(process.env.OMAGY_MAP_CHARS, 1800, 100)) {
  const rootList = Array.isArray(roots) ? roots : [roots || process.cwd()];
  const byDir = new Map();
  const buf = Buffer.allocUnsafe(65536);
  for (const rawRoot of rootList) {
    const root = path.resolve(String(rawRoot || process.cwd()));
    if (!fs.existsSync(root)) continue;
    const files = listRepoSourceFiles(root).sort((a, b) => (Number(MAP_SHARED_RE.test(b)) - Number(MAP_SHARED_RE.test(a))) || a.localeCompare(b));
    const prefix = rootList.length > 1 ? `${path.basename(root)}/` : '';
    for (const f of files) {
      let names;
      try {
        const full = path.join(root, f);
        const st = fs.lstatSync(full);
        if (!st.isFile() || st.isSymbolicLink()) continue;
        const fd = fs.openSync(full, 'r');
        try {
          const n = fs.readSync(fd, buf, 0, 65536, 0);
          names = extractExportedNames(buf.toString('utf8', 0, n), path.extname(f).slice(1).toLowerCase());
        } finally {
          fs.closeSync(fd);
        }
      } catch { continue; }
      if (!names || !names.length) continue;
      const rawDir = path.posix.dirname(f);
      const dirKey = `${prefix}${rawDir === '.' ? '.' : `${rawDir}/`}`;
      if (!byDir.has(dirKey)) byDir.set(dirKey, []);
      byDir.get(dirKey).push(names);
    }
  }
  if (!byDir.size) return '';
  const header = '[oh-my-agy] Codebase map (what already exists; reuse it, read a file only when you need its details):';
  const lines = [header];
  let chars = header.length;
  let shown = 0;
  for (const [dir, perFile] of byDir) {
    const per = perFile.length > 8 ? 1 : (perFile.length <= 2 ? 8 : 3);
    const names = [...new Set(perFile.flatMap((n) => n.slice(0, per)))];
    const line = `${dir}: ${names.slice(0, 30).join(', ')}${names.length > 30 ? ', ...' : ''}`;
    if (chars + 1 + line.length > budget && shown > 0) break;
    lines.push(line);
    chars += 1 + line.length;
    shown += 1;
  }
  if (shown === 0) return '';
  if (shown < byDir.size) lines.push(`(${byDir.size - shown} more folders not listed)`);
  return lines.join('\n');
}

export function scanShortcutDebt(roots, marker = '') {
  const rootList = Array.isArray(roots) ? roots : [roots || process.cwd()];
  const custom = String(marker || '').trim();
  const escapedCustom = custom ? custom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const markerGroup = escapedCustom || '(?:shortcut|ceiling)';
  const commentRe = new RegExp(`(?:^\\s*(?:#|\\/\\/|\\/\\*+|\\*)|(?<![:"'\`\\\\])\\s+(?:#|\\/\\/|\\/\\*+))\\s*(${markerGroup})\\s*:\\s*(.+?)(?:\\s*\\*\\/)?$`, 'i');
  const splitRe = /^(.*?)(?:\s*(?:,|;|->|=>|\bupgrade\s*:)\s*|\s+(?=(?:when|if|once|switch\s+to|upgrade\s+to|replace\s+with)\b))(.+)$/i;
  const placeholderRe = /<[a-zA-Z][^>\n]{1,40}>/;
  const items = [];
  const seen = new Set();

  for (const rawRoot of rootList) {
    const root = path.resolve(String(rawRoot || process.cwd()));
    if (!fs.existsSync(root)) continue;
    let files = [];
    try {
      const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: root, encoding: 'utf8', timeout: 1500, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) {
        files = out.split('\n').filter((f) => CODE_EXTENSIONS.has(path.extname(f).toLowerCase()) && !MAP_SKIP_DIR_RE.test(f));
      }
    } catch { /* fallback below */ }
    if (!files.length) {
      const walk = (dir, rel, depth) => {
        if (depth > 6 || files.length >= MAP_MAX_FILES) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name[0] === '.' || e.isSymbolicLink()) continue;
          const sub = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (!MAP_SKIP_DIR_RE.test(sub)) walk(path.join(dir, e.name), sub, depth + 1);
          } else if (e.isFile() && CODE_EXTENSIONS.has(path.extname(sub).toLowerCase())) {
            files.push(sub);
          }
        }
      };
      walk(root, '', 0);
    }
    for (const relFile of files.slice(0, MAP_MAX_FILES)) {
      const full = path.join(root, relFile);
      let rawText = '';
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile() || st.isSymbolicLink() || st.size > 512 * 1024) continue;
        rawText = fs.readFileSync(full, 'utf8');
      } catch { continue; }
      const lines = rawText.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const m = commentRe.exec(line);
        if (!m) continue;
        const foundMarker = m[1].toLowerCase();
        const body = m[2].trim();
        if (!body || placeholderRe.test(body)) continue;
        // Skip lines that are regex literals or string assertions testing the marker itself
        const trimmedLine = line.trimStart();
        if (!/^(?:#|\/\/|\/\*|\*)/.test(trimmedLine) && /['"`/].*(?:shortcut|ceiling)\s*:/.test(trimmedLine)) continue;
        const key = `${relFile}:${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sp = splitRe.exec(body);
        const ceiling = sp && sp[1].trim() ? sp[1].trim() : body;
        const upgrade = sp && sp[2] && sp[2].trim() ? sp[2].trim() : '';
        const noTrigger = !upgrade;
        items.push({
          file: relFile,
          line: i + 1,
          marker: foundMarker,
          raw: body,
          ceiling,
          upgrade,
          noTrigger,
          rotRisk: noTrigger,
        });
      }
    }
  }
  const noTriggerCount = items.filter((it) => it.noTrigger).length;
  return { ok: true, total: items.length, noTriggerCount, items };
}

function defsInSource(filePath, text) {
  const norm = String(filePath || '').replace(/\\/g, '/');
  const entry = DIFF_DEF_PATTERNS.find(([extRe]) => extRe.test(norm));
  if (!entry) return [];
  const names = new Set();
  for (const re of entry[1]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && m[1][0] !== '_') names.add(m[1]);
    }
  }
  return [...names];
}

const LAZY_REASON_WORDS = new Set([
  'ok', 'okay', 'todo', 'later', 'fixme', 'fix', 'temp', 'temporary', 'noop', 'no-op',
  'ignore', 'ignored', 'wip', 'tbd', 'hack', 'bypass', 'suppress', 'silence', 'none', 'na',
]);
function isMeaningfulExemptionReason(rawReason) {
  const cleaned = String(rawReason || '').replace(/\*+\/\s*$/, '').replace(/-->\s*$/, '').trim();
  if (!cleaned || /<[a-zA-Z][^>\n]{1,40}>/.test(cleaned)) return false;
  const words = (cleaned.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !LAZY_REASON_WORDS.has(w));
  return words.join(' ').length > 8;
}
function normDiffPath(rawPath, stripPrefix = '') {
  let p = String(rawPath || '').trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1).replace(/\\(["\\])/g, '$1');
  p = p.replace(/\t.*$/, '').replace(/\\/g, '/').trim();
  if (p === '/dev/null') return '';
  return stripPrefix && p.startsWith(stripPrefix) ? p.slice(stripPrefix.length) : p;
}

export function parseUnifiedDiff(diffText) {
  const lines = String(diffText || '').replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let cur = null;
  let curHunk = null;
  let inHeader = false;
  let oldLn = 0;
  let newLn = 0;
  const finalize = (e) => {
    if (!e) return;
    if (e._del || (!e.newFile && e.oldFile)) { e.status = 'deleted'; e.newFile = ''; }
    else if (e._new || (!e.oldFile && e.newFile)) { e.status = 'added'; e.oldFile = ''; }
    else if (e._ren || (e.oldFile && e.newFile && e.oldFile !== e.newFile)) e.status = 'renamed';
    else e.status = 'modified';
    e.file = e.newFile || e.oldFile;
    delete e._del; delete e._new; delete e._ren;
    if (e.file) files.push(e);
  };
  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    if (rawLine.startsWith('diff ')) {
      finalize(cur);
      cur = { oldFile: '', newFile: '', status: 'modified', file: '', hunks: [], _del: false, _new: false, _ren: false };
      curHunk = null;
      inHeader = true;
      const gm = /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(\S+))$/.exec(rawLine);
      if (gm) { cur.oldFile = normDiffPath(gm[1] ?? gm[2] ?? ''); cur.newFile = normDiffPath(gm[3] ?? gm[4] ?? ''); }
      continue;
    }
    if (!cur) continue;
    const hm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(rawLine);
    if (hm) {
      inHeader = false;
      oldLn = Number.parseInt(hm[1], 10);
      newLn = Number.parseInt(hm[3], 10);
      curHunk = {
        oldStart: oldLn,
        oldCount: hm[2] !== undefined ? Number.parseInt(hm[2], 10) : 1,
        newStart: newLn,
        newCount: hm[4] !== undefined ? Number.parseInt(hm[4], 10) : 1,
        header: hm[5] || '',
        lines: [],
      };
      cur.hunks.push(curHunk);
      continue;
    }
    if (inHeader) {
      if (rawLine.startsWith('new file mode')) cur._new = true;
      else if (rawLine.startsWith('deleted file mode')) cur._del = true;
      else if (rawLine.startsWith('rename from ')) { cur._ren = true; cur.oldFile = normDiffPath(rawLine.slice(12)); }
      else if (rawLine.startsWith('rename to ')) { cur._ren = true; cur.newFile = normDiffPath(rawLine.slice(10)); }
      else if (rawLine.startsWith('--- ')) { const p = normDiffPath(rawLine.slice(4), 'a/'); if (!p) cur._new = true; cur.oldFile = p; }
      else if (rawLine.startsWith('+++ ')) { const p = normDiffPath(rawLine.slice(4), 'b/'); if (!p) cur._del = true; cur.newFile = p; }
      continue;
    }
    if (!curHunk || rawLine.startsWith('\\') || (idx === lines.length - 1 && rawLine === '')) continue;
    if (rawLine.startsWith('+')) curHunk.lines.push({ type: 'add', content: rawLine.slice(1), oldLine: null, newLine: newLn++ });
    else if (rawLine.startsWith('-')) curHunk.lines.push({ type: 'del', content: rawLine.slice(1), oldLine: oldLn++, newLine: null });
    else if (rawLine.startsWith(' ')) curHunk.lines.push({ type: 'ctx', content: rawLine.slice(1), oldLine: oldLn++, newLine: newLn++ });
  }
  finalize(cur);
  return files;
}

const REGEX_PRECEDERS = new Set(['=', '(', '[', ',', ':', '!', '&', '|', '?', '{', ';', '~', '^']);
export function stripCodeStrings(line) {
  const s = String(line || '');
  let out = '';
  let i = 0;
  let lastNonWs = '';
  while (i < s.length) {
    const ch = s[i];
    const nxt = s[i + 1];
    if (ch === '/' && nxt === '/') { out += s.slice(i); break; }
    if (ch === '/' && nxt === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) { out += s.slice(i); break; }
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch;
      i += 1;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === ch) { i += 1; break; }
        i += 1;
      }
      out += ch;
      lastNonWs = ch;
      continue;
    }
    if (ch === '/' && nxt !== '/' && nxt !== '*'
      && (lastNonWs === '' || REGEX_PRECEDERS.has(lastNonWs) || /(?:^|[^\w$])(?:return|case|throw)\s*$/.test(out))) {
      let j = i + 1;
      let inClass = false;
      let closed = -1;
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '[') inClass = true;
        else if (s[j] === ']') inClass = false;
        else if (s[j] === '/' && !inClass) { closed = j; break; }
        j += 1;
      }
      if (closed > i + 1) {
        let fe = closed + 1;
        while (fe < s.length && /[dgimsuvy]/.test(s[fe])) fe += 1;
        out += `/ /${s.slice(closed + 1, fe)}`;
        i = fe;
        lastNonWs = '/';
        continue;
      }
    }
    out += ch;
    if (!/\s/.test(ch)) lastNonWs = ch;
    i += 1;
  }
  return out;
}

const SUPPRESSION_COMMENT_RE = /(?:\/\/|\/\*+|^\s*\*)\s*(@ts-expect-error|@ts-ign[o]re|@ts-noch[e]ck|eslint-dis[a]ble(?:-(?:next-)?line)?|biome-ign[o]re|istanbul\s+ign[o]re|c8\s+ign[o]re|nosem[g]rep|gitleaks:all[o]w|stryker\s+dis[a]ble)\b|(?:^|\s)#\s*(no[q]a|type:\s*ign[o]re|nosem[g]rep|gitleaks:all[o]w)\b/i;
export function isCheckerSuppressionLine(line) {
  return SUPPRESSION_COMMENT_RE.test(stripCodeStrings(line));
}
export function hasValidSuppressionExemption(line) {
  const clean = stripCodeStrings(line);
  const m = SUPPRESSION_COMMENT_RE.exec(clean);
  if (!m) return true;
  const directive = String(m[1] || m[2] || '').toLowerCase();
  const tail = clean.slice(m.index);
  const sc = /\b(?:shortcut|ceiling)\s*:\s*(.+)$/i.exec(tail);
  if (sc && isMeaningfulExemptionReason(sc[1])) return true;
  const dr = /\s--\s+(.+)$/.exec(tail);
  if (dr && isMeaningfulExemptionReason(dr[1])) return true;
  if (directive === '@ts-expect-error') {
    const desc = tail.replace(/^(?:\/\/|\/\*+|^\s*\*)\s*@ts-expect-error\b\s*(?:--|:)?\s*/i, '');
    if (isMeaningfulExemptionReason(desc)) return true;
  }
  return false;
}

export function findEmptyCatches(input, baseLineNum = 1) {
  let rawList = [];
  if (typeof input === 'string') rawList = input.replace(/\r\n/g, '\n').split('\n');
  else if (Array.isArray(input)) rawList = input;
  const rows = rawList.map((item, idx) => {
    const raw = typeof item === 'string' ? item : String(item?.text ?? item?.content ?? '');
    return { raw, text: stripCodeStrings(raw), line: typeof item === 'string' ? baseLineNum + idx : Number(item?.line ?? item?.newLine ?? (baseLineNum + idx)) };
  });
  if (!rows.length) return [];
  const rowStarts = [];
  let pos = 0;
  for (const rw of rows) { rowStarts.push(pos); pos += rw.text.length + 1; }
  const rowAt = (offset) => {
    let lo = 0; let hi = rowStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rowStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const joined = rows.map((rw) => rw.text).join('\n');
  const chars = joined.split('');
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i += 1; }
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      chars[i] = ' '; chars[i + 1] = ' '; i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) { if (chars[i] !== '\n') chars[i] = ' '; i += 1; }
      if (i < chars.length) { chars[i] = ' '; chars[i + 1] = ' '; i += 2; }
    } else if (chars[i] === '#' && (i === 0 || /\s/.test(chars[i - 1]))) {
      while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i += 1; }
    } else {
      i += 1;
    }
  }
  const codeOnly = chars.join('');
  const catchRe = /(?<![.\w$])catch\s*(?:\([^)]*\))?\s*\{/g;
  const hits = [];
  let m;
  while ((m = catchRe.exec(codeOnly)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 1;
    let cur = openIdx + 1;
    while (cur < codeOnly.length && depth > 0) {
      if (codeOnly[cur] === '{') depth += 1;
      else if (codeOnly[cur] === '}') depth -= 1;
      if (depth === 0) break;
      cur += 1;
    }
    if (depth !== 0) continue;
    const startRow = rowAt(m.index);
    const endRow = rowAt(cur);
    if (endRow - startRow > 14) continue;
    if (codeOnly.slice(openIdx + 1, cur).replace(/[\s;]+/g, '').length === 0) {
      const eol = joined.indexOf('\n', cur);
      const spanText = joined.slice(openIdx + 1, eol === -1 ? joined.length : eol);
      const hasFailOpen = /\bfail[- ]open\b/i.test(spanText);
      const scMatch = /\b(?:shortcut|ceiling)\s*:\s*([^\r\n*]+)/i.exec(spanText);
      if (!hasFailOpen && !(scMatch && isMeaningfulExemptionReason(scMatch[1]))) {
        hits.push({ line: rows[startRow].line, endLine: rows[endRow].line, snippet: rows[startRow].raw.trim().slice(0, 140) });
      }
    }
  }
  return hits;
}

export const PROTECTED_MARKER_RE = /(?:omagy|simplify)-ignore-(?:start|end)/i;
const PROTECTED_START_RE = /^\s*(?:\/\/|\/\*+|\*|#|<!--|--)\s*(omagy-ignore|simplify-ignore)-start\b/i;
const PROTECTED_END_RE = /^\s*(?:\/\/|\/\*+|\*|#|<!--|--)\s*(omagy-ignore|simplify-ignore)-end\b/i;
export function extractProtectedBlocks(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let active = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!active) {
      const sm = PROTECTED_START_RE.exec(line);
      if (sm) active = { kind: sm[1].toLowerCase(), startLine: i + 1, lines: [line] };
    } else {
      active.lines.push(line);
      const em = PROTECTED_END_RE.exec(line);
      if (em && em[1].toLowerCase() === active.kind) {
        blocks.push({ kind: active.kind, startLine: active.startLine, endLine: i + 1, content: active.lines.join('\n') });
        active = null;
      }
    }
  }
  if (active) blocks.push({ kind: active.kind, startLine: active.startLine, endLine: lines.length, content: active.lines.join('\n') });
  return blocks;
}
export function hasProtectedBlockTampering(prevContent, nextContent) {
  const prevBlocks = extractProtectedBlocks(prevContent);
  if (!prevBlocks.length) return [];
  if (typeof nextContent !== 'string') return prevBlocks;
  const counts = new Map();
  for (const nb of extractProtectedBlocks(nextContent)) {
    const k = `${nb.kind}\0${nb.content}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return prevBlocks.filter((pb) => {
    const k = `${pb.kind}\0${pb.content}`;
    const n = counts.get(k) || 0;
    if (n > 0) { counts.set(k, n - 1); return false; }
    return true;
  });
}

export function reconstructPostEditContent(toolName, args, prevContent, targetHint = '', roots = []) {
  const name = String(toolName || '').trim().toLowerCase();
  const prev = typeof prevContent === 'string' ? prevContent : '';
  if (/^(?:delete_file|move_file|rename_file)$/.test(name)) return null;
  if (args?.delete || args?.rename || args?.MoveTo || args?.moveTo || args?.move_to || args?.newPath || args?.new_path) return null;
  if (/^(?:write_file|write_to_file)$/.test(name)) {
    const raw = args?.Content ?? args?.content ?? args?.CodeContent ?? args?.code_content;
    if (typeof raw !== 'string') return undefined;
    return (args?.Append === true || args?.append === true) ? `${prev}${raw}` : raw;
  }
  const canonTarget = targetHint ? canonicalizePath(targetHint) : '';
  const wsRoots = (Array.isArray(roots) && roots.length ? roots : [process.cwd()]).map((r) => canonicalizePath(r));
  const isSingleEdit = /^(?:edit_file|replace_file_content)$/.test(name);
  if (isSingleEdit || /^(?:multi_replace_file_content|multiedit|multi_edit)$/.test(name)) {
    const chunks = isSingleEdit
      ? [args]
      : (args?.ReplacementChunks ?? args?.replacement_chunks ?? args?.edits ?? args?.chunks);
    if (!Array.isArray(chunks) || !chunks.length) return undefined;
    let next = prev.replace(/\r\n/g, '\n');
    for (const ch of chunks) {
      if (!ch || typeof ch !== 'object') return undefined;
      const rawChunkPath = ch.Path ?? ch.path ?? ch.filePath ?? ch.file_path ?? ch.file;
      if (typeof rawChunkPath === 'string' && rawChunkPath.trim() && canonTarget) {
        const trimmedChunk = rawChunkPath.trim();
        const chunkCands = path.isAbsolute(trimmedChunk)
          ? [canonicalizePath(trimmedChunk)]
          : [
            ...wsRoots.map((wr) => canonicalizePath(path.resolve(wr, trimmedChunk))),
            canonicalizePath(path.resolve(path.dirname(canonTarget), trimmedChunk)),
          ];
        if (!chunkCands.includes(canonTarget)) continue;
      }
      if (!isSingleEdit && (ch.rename || ch.newPath)) return null;
      const rawT = ch.Target ?? ch.target ?? ch.TargetContent ?? ch.target_content ?? ch.old_string ?? ch.oldText;
      const rawR = ch.Replacement ?? ch.replacement ?? ch.ReplacementContent ?? ch.replacement_content ?? ch.new_string ?? ch.newText ?? '';
      if (typeof rawT !== 'string' || !rawT) return undefined;
      const t = rawT.replace(/\r\n/g, '\n');
      const r = String(rawR).replace(/\r\n/g, '\n');
      if (!next.includes(t)) return undefined;
      next = next.split(t).join(r);
    }
    return next;
  }
  if (/^(?:apply_patch|patch)$/.test(name)) {
    const patchBody = args?.patchText ?? args?.patch ?? args?.input;
    if (typeof patchBody !== 'string' || !patchBody) return undefined;
    let next = prev.replace(/\r\n/g, '\n');
    let matched = false;
    for (const sec of patchBody.replace(/\r\n/g, '\n').split(/(?=^\*\*\* (?:Add|Update|Delete) File:\s*)/m)) {
      const hdr = /^\*\*\* (Add|Update|Delete) File:\s*(.+)$/m.exec(sec);
      if (!hdr) continue;
      const secFile = hdr[2].trim();
      if (canonTarget) {
        const secCands = path.isAbsolute(secFile)
          ? [canonicalizePath(secFile)]
          : [...new Set(wsRoots.map((wr) => canonicalizePath(path.resolve(wr, secFile))))];
        if (!secCands.includes(canonTarget)) continue;
        if (secCands.length > 1) return undefined;
      }
      if (matched) return undefined;
      matched = true;
      if (hdr[1] === 'Delete' || /^\*\*\* Move to:/m.test(sec)) return null;
      const hunks = [];
      let curHunk = null;
      for (const l of sec.split('\n').slice(1)) {
        if (l.startsWith('*** End Patch') || l.startsWith('*** End of File')) break;
        if (l.startsWith('@@')) { curHunk = []; hunks.push(curHunk); }
        else if (curHunk || /^[+ -]/.test(l)) { if (!curHunk) { curHunk = []; hunks.push(curHunk); } curHunk.push(l); }
      }
      let searchPos = 0;
      for (const hLines of hunks) {
        const oldLines = []; const newLines = [];
        for (const hl of hLines) {
          if (hl.startsWith('-')) oldLines.push(hl.slice(1));
          else if (hl.startsWith('+')) newLines.push(hl.slice(1));
          else if (hl.startsWith(' ') || hl === '') { const v = hl ? hl.slice(1) : ''; oldLines.push(v); newLines.push(v); }
        }
        if (!oldLines.length) {
          next = `${next}${next.endsWith('\n') || !next ? '' : '\n'}${newLines.join('\n')}`;
        } else {
          const oldBlock = oldLines.join('\n'); const newBlock = newLines.join('\n');
          let fi = next.indexOf(oldBlock, searchPos);
          if (fi === -1) fi = next.indexOf(oldBlock);
          if (fi === -1) return undefined;
          next = `${next.slice(0, fi)}${newBlock}${next.slice(fi + oldBlock.length)}`;
          searchPos = fi + newBlock.length;
        }
      }
    }
    return matched ? next : undefined;
  }
  return undefined;
}

export function analyzeDiffCodeHealth(roots, opts = {}) {
  const rootList = Array.isArray(roots) ? roots : [roots || process.cwd()];
  const onlyOpenCallers = Boolean(opts && opts.onlyOpenCallers);
  const createdSet = new Set();
  const removedSet = new Set();
  const reusedSet = new Set();
  const openCallers = [];

  for (const rawRoot of rootList) {
    const cwd = path.resolve(String(rawRoot || process.cwd()));
    if (!fs.existsSync(cwd)) continue;
    let diff = '';
    try {
      diff = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', 'HEAD', '--'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 8 * 1024 * 1024,
      });
    } catch { /* fail open: non-git workspace or empty HEAD */ continue; }
    if (!diff) continue;

    const perFileDiff = new Map();
    for (const entry of parseUnifiedDiff(diff)) {
      const targetFile = entry.newFile || entry.oldFile;
      if (!targetFile || !isMapSourceFile(targetFile)) continue;
      if (!perFileDiff.has(targetFile)) perFileDiff.set(targetFile, { added: [], removed: [] });
      const bucket = perFileDiff.get(targetFile);
      for (const hunk of entry.hunks) {
        for (const hl of hunk.lines) {
          if (hl.type === 'add') bucket.added.push(hl.content);
          else if (hl.type === 'del') bucket.removed.push(hl.content);
        }
      }
    }
    if (!perFileDiff.size) continue;

    const rootRemoved = new Set();
    const rootCreated = new Set();
    const allAddedLines = [];
    for (const [file, changes] of perFileDiff) {
      const oldDefs = defsInSource(file, changes.removed.join('\n'));
      const newDefs = defsInSource(file, changes.added.join('\n'));
      for (const n of newDefs) {
        if (!oldDefs.includes(n)) {
          rootCreated.add(n);
          createdSet.add(n);
        }
      }
      for (const n of oldDefs) {
        if (!newDefs.includes(n) && !GENERIC_SYMBOLS.has(n.toLowerCase())) {
          rootRemoved.add(n);
        }
      }
      if (!onlyOpenCallers && changes.added.length) {
        allAddedLines.push(...changes.added);
      }
    }

    // Short-circuit: if only checking openCallers (e.g. Stop hook) and zero non-generic definitions were removed, skip repo scan
    if (onlyOpenCallers && rootRemoved.size === 0) continue;

    const sourceFiles = listRepoSourceFiles(cwd);
    const currentRepoDefs = new Map();
    const fileTextCache = new Map();
    for (const relFile of sourceFiles) {
      const full = path.join(cwd, relFile);
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile() || st.isSymbolicLink() || st.size > 256 * 1024) continue;
        const text = fs.readFileSync(full, 'utf8');
        fileTextCache.set(relFile, text);
        for (const defName of defsInSource(relFile, text)) {
          if (!currentRepoDefs.has(defName)) currentRepoDefs.set(defName, relFile);
        }
      } catch { /* ignore */ }
    }

    if (!onlyOpenCallers && allAddedLines.length) {
      const addedJoined = allAddedLines.join('\n');
      const callRe = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
      let cm;
      while ((cm = callRe.exec(addedJoined)) !== null) {
        const name = cm[1];
        if (currentRepoDefs.has(name) && !rootCreated.has(name) && !GENERIC_SYMBOLS.has(name.toLowerCase())) {
          reusedSet.add(name);
        }
      }
    }

    const trulyRemoved = [...rootRemoved].filter((sym) => !currentRepoDefs.has(sym));
    for (const sym of trulyRemoved) {
      removedSet.add(sym);
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const symCallRe = new RegExp(`(?<![.\\w$])${escaped}\\s*\\(`);
      for (const [relFile, text] of fileTextCache) {
        const lines = text.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx += 1) {
          const line = lines[idx];
          if (/^\s*(?:\/\/|#|\/\*|\*)/.test(line)) continue;
          if (symCallRe.test(line)) {
            const snippet = line.trim().slice(0, 160);
            openCallers.push({ symbol: sym, file: relFile, line: idx + 1, snippet, text: snippet });
          }
        }
      }
    }
  }

  const reused = [...reusedSet];
  const created = [...createdSet];
  const removed = [...removedSet];
  const total = reused.length + created.length;
  // shortcut: reusePct is omitted below 3 functions (where 1 new helper reads as 0%), upgrade to weighted LOC reuse if small-diff percentages are needed
  const reusePct = total >= 3 ? Math.round((reused.length / total) * 100) : null;
  return { reused, created, removed, reusePct, openCallers };
}

// ---------- context-saving subagent handoff helpers ----------
function isSafeGitRef(ref) {
  return typeof ref === 'string' && ref.trim().length > 0 && !ref.trim().startsWith('-');
}

export function buildReviewPackage(cwd, baseRef, headRef = 'HEAD', outPath = '') {
  const repoDir = path.resolve(String(cwd || process.cwd()));
  const baseArg = String(baseRef || '').trim();
  const headArg = String(headRef || 'HEAD').trim() || 'HEAD';
  if (!isSafeGitRef(baseArg) || !isSafeGitRef(headArg)) {
    return { ok: false, exitCode: 1, error: 'Invalid base or head git ref.' };
  }
  let baseSha = '';
  let headSha = '';
  try {
    baseSha = execFileSync('git', ['rev-parse', '--verify', `${baseArg}^{commit}`], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
    headSha = execFileSync('git', ['rev-parse', '--verify', `${headArg}^{commit}`], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim();
  } catch (err) {
    return { ok: false, exitCode: 1, error: `Cannot resolve git commit range: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseSha, headSha], {
      cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    });
  } catch {
    return { ok: false, exitCode: 3, error: `Ref '${baseArg}' (${baseSha.slice(0, 7)}) is not an ancestor of '${headArg}' (${headSha.slice(0, 7)}).` };
  }
  let count = 0;
  try {
    count = Number(execFileSync('git', ['rev-list', '--count', `${baseSha}..${headSha}`], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
    }).trim());
  } catch {
    return { ok: false, exitCode: 1, error: 'Failed to count commits in range.' };
  }
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, exitCode: 3, error: `Commit range ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)} is empty (0 commits).` };
  }
  const base7 = baseSha.slice(0, 7);
  const head7 = headSha.slice(0, 7);
  const log = execFileSync('git', ['log', '--oneline', `${baseSha}..${headSha}`], {
    cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
  const stat = execFileSync('git', ['diff', '--stat', `${baseSha}..${headSha}`], {
    cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
  const diff = execFileSync('git', ['diff', '-U10', `${baseSha}..${headSha}`], {
    cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  const target = outPath && String(outPath).trim()
    ? path.resolve(repoDir, String(outPath).trim())
    : path.join(stateRoot(repoDir), '.omagy', 'artifacts', 'reviews', `review-${base7}..${head7}.diff`);
  try {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      return { ok: false, exitCode: 1, error: 'Refusing to overwrite symlinked review package path.' };
    }
  } catch { /* ignore */ }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = `=== Commits (${base7}..${head7}, ${count} commit${count === 1 ? '' : 's'}) ===\n${log}\n\n=== Diffstat ===\n${stat}\n\n=== Diff (-U10) ===\n${diff}`;
  fs.writeFileSync(target, body, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, exitCode: 0, path: target, base: base7, head: head7, commits: count };
}

export function extractGoalBrief(sourcePath, targetId, outPath = '') {
  const rawSource = String(sourcePath || '').trim();
  const resolvedSource = rawSource ? path.resolve(rawSource) : '';
  const rawId = String(targetId ?? '').trim();
  if (!resolvedSource || !rawId || !fs.existsSync(resolvedSource)) {
    return { ok: false, exitCode: 1, error: 'Source file and target goal/task ID are required.' };
  }
  const st = fs.lstatSync(resolvedSource);
  if (st.isSymbolicLink()) return { ok: false, exitCode: 1, error: 'Refusing to read symlinked plan/goals file.' };
  if (!st.isFile()) return { ok: false, exitCode: 1, error: 'Source path must be a regular file.' };
  const raw = fs.readFileSync(resolvedSource, 'utf8');
  let extracted = '';
  let resolvedId = rawId;
  let title = '';

  const trimmed = raw.trim();
  if (resolvedSource.endsWith('.json') || trimmed.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, exitCode: 1, error: 'Invalid JSON in goals file.' }; }
    const goals = Array.isArray(parsed?.goals) ? parsed.goals : [];
    const norm = rawId.toLowerCase();
    const goal = goals.find((g) => g && typeof g === 'object' && (
      String(g.id || '').toLowerCase() === norm || String(g.id || '').toLowerCase() === `g${norm}`
    ));
    if (!goal) return { ok: false, exitCode: 1, error: `Goal '${rawId}' not found in ${resolvedSource}.` };
    resolvedId = String(goal.id || rawId);
    title = String(goal.title || '');
    const invariants = Array.isArray(parsed?.invariants) && parsed.invariants.length
      ? `\n## Global Invariants\n${parsed.invariants.map((inv) => `- ${inv}`).join('\n')}\n`
      : '';
    const acceptance = Array.isArray(goal.acceptance) && goal.acceptance.length
      ? `\n## Acceptance Criteria\n${goal.acceptance.map((a) => `- [ ] ${a}`).join('\n')}\n`
      : '';
    const deps = Array.isArray(goal.depends_on) && goal.depends_on.length ? goal.depends_on.join(', ') : 'none';
    extracted = `# Goal ${resolvedId}: ${title}\n\n- **Rigor**: \`${goal.rigor || 'light'}\`\n- **Depends On**: ${deps}\n\n## Objective\n${goal.objective || ''}\n${invariants}${acceptance}`;
  } else {
    const normalizeTaskId = (val) => String(val || '').trim().replace(/^G(?=\d)/i, '').toLowerCase();
    const reqNorm = normalizeTaskId(rawId);
    const isSubtaskOf = (candId, parentNorm) => {
      const candNorm = normalizeTaskId(candId);
      if (!candNorm.startsWith(parentNorm) || candNorm === parentNorm) return false;
      const rest = candNorm.slice(parentNorm.length);
      if (rest.startsWith('.')) return rest.length > 1;
      if (/\d$/.test(parentNorm) && /^[a-z]/i.test(rest)) return true;
      return false;
    };
    const taskHeadingRe = /^(#{2,4})\s+(?:(?:Task|Goal)\s+([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)|(G[0-9][A-Za-z0-9.]*)|([0-9]+[A-Za-z0-9.]*)\s*(?=[:—-]))(?:\b|(?=\s|:|—|-))[:\s—-]*(.*)$/i;
    const nonEnglishTaskShapeRe = /^(#{2,4})\s+[^\s#]+\s+[0-9]+[A-Za-z0-9.]*(?:\b|\s*[:.—-])/;
    const anyHeadingRe = /^(#{1,4})\s+\S/;
    const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
    const lines = raw.split(/\r?\n/);
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let fenceOpenLine = 0;
    let swallowedTaskHeading = false;
    let capturing = false;
    let captureLevel = 0;
    const outLines = [];
    const englishTaskHeadings = [];
    const taskShapedHeadings = [];

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const fMatch = line.match(fenceRe);
      if (fMatch) {
        const marker = fMatch[1];
        const ch = marker[0];
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
          fenceLen = marker.length;
          fenceOpenLine = idx + 1;
        } else if (ch === fenceChar && marker.length >= fenceLen && /^ {0,3}(?:`+|~+)\s*$/.test(line)) {
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          fenceOpenLine = 0;
          swallowedTaskHeading = false;
        }
      }
      if (inFence) {
        if (taskHeadingRe.test(line)) swallowedTaskHeading = true;
        if (capturing) outLines.push(line);
        continue;
      }
      const tMatch = line.match(taskHeadingRe);
      const candId = tMatch ? (tMatch[2] || tMatch[3] || tMatch[4] || '') : '';
      if (tMatch && candId) {
        englishTaskHeadings.push(line.trim());
      } else if (nonEnglishTaskShapeRe.test(line)) {
        taskShapedHeadings.push(line.trim());
      }
      if (!capturing) {
        if (tMatch && candId && (normalizeTaskId(candId) === reqNorm || candId.toLowerCase() === rawId.toLowerCase())) {
          capturing = true;
          captureLevel = tMatch[1].length;
          resolvedId = candId;
          title = (tMatch[5] || '').trim();
          outLines.push(line);
          continue;
        }
      } else {
        const nextH = line.match(anyHeadingRe);
        if (nextH) {
          const nextLevel = nextH[1].length;
          const isChildSubtask = Boolean(tMatch && candId && isSubtaskOf(candId, reqNorm));
          if (nextLevel <= captureLevel && !isChildSubtask) {
            break;
          }
        }
      }
      if (capturing) outLines.push(line);
    }
    if (inFence && (capturing || swallowedTaskHeading)) {
      return {
        ok: false,
        exitCode: 4,
        error: `Unclosed code fence opened at line ${fenceOpenLine} in ${resolvedSource} swallowed subsequent headings.`,
      };
    }
    if (!outLines.length) {
      const hint = englishTaskHeadings.length === 0 && taskShapedHeadings.length > 0
        ? ` No 'Task N' / 'Goal N' headings found; task-shaped headings in file: ${taskShapedHeadings.slice(0, 5).join(' | ')}`
        : '';
      return { ok: false, exitCode: 1, error: `Section for '${rawId}' not found in ${resolvedSource}.${hint}` };
    }
    extracted = `${outLines.join('\n').trimEnd()}\n`;
  }

  const target = outPath && String(outPath).trim()
    ? path.resolve(String(outPath).trim())
    : path.join(stateRoot(path.dirname(resolvedSource)), '.omagy', 'ultragoal', 'briefs', `goal-${safeId(resolvedId)}.md`);
  try {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      return { ok: false, exitCode: 1, error: 'Refusing to overwrite symlinked brief path.' };
    }
  } catch { /* ignore */ }
  if (process.env.OMAGY_MAP !== '0') {
    const mapBlock = buildCodebaseMap([stateRoot(path.dirname(resolvedSource))], 1200);
    if (mapBlock) {
      extracted = `${extracted.trimEnd()}\n\n## Codebase Reuse Map\n\`\`\`text\n${mapBlock}\n\`\`\`\n`;
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, extracted, { encoding: 'utf8', mode: 0o600 });
  return { ok: true, exitCode: 0, path: target, id: resolvedId, title };
}

// ---------- junk-test scanner ----------
export const TEST_FILE_NAME_RE = /(?:^|[/\\])(?:__tests__|tests)[/\\].+\.(?:[cm]?[jt]sx?|py|rs|go)$|\.(?:test|spec)\.(?:[cm]?[jt]sx?)$|_test\.(?:py|go|rs)$|(?:^|[/\\])test_[^/\\]+\.py$/i;
const TEST_JUNK_RULES = [
  {
    rule: 'source-grep',
    message: 'Reads source file inside a test to grep implementation text (class 10 source-grep). Test runtime behavior instead.',
    test: (line) => /\b(?:readFileSync|fs\.readFile|fsPromises\.readFile|os\.ReadFile|ioutil\.ReadFile|std::fs::read_to_string)\s*\(/.test(line),
  },
  {
    rule: 'prose-pin',
    message: 'Pins exact long prose (>80 chars) in an equality assertion (class 5 exact-error-prose). Match error code/type or key phrase.',
    test: (line) => /\b(?:toBe|toEqual|toStrictEqual|assert_eq!|assertEqual)\s*\(\s*["'`][^"'`\n]{80,}["'`]\s*\)/.test(line),
  },
  {
    rule: 'fixed-sleep',
    message: 'Uses arbitrary fixed sleep in test (class 12 fixed-sleep). Await deterministic condition or fake timers.',
    test: (line) => /\b(?:setTimeout\s*\(\s*resolve\s*,\s*\d+|sleep\s*\(\s*\d+|time\.sleep\s*\(\s*\d+|thread::sleep|time\.Sleep)\b/.test(line),
  },
  {
    rule: 'focused',
    message: 'Focused test (.only / #[test_only]) silently skips the rest of the suite.',
    test: (line) => /\b(?:it|test|describe)\.only\s*\(|#\[\s*test_only\s*\]/.test(line),
  },
  {
    rule: 'skipped',
    message: 'Skipped test (.skip / #[ignore]) left in suite without suppression.',
    test: (line) => /\b(?:it|test|describe|pytest\.mark)\.skip\s*\(|^\s*#\[\s*ignore(?:\s*\)|\s*\])/.test(line),
  },
  {
    rule: 'self-compare',
    message: 'Tautological self-comparison (expect(x).toBe(x) or assert(x == x)) (class 1 tautology).',
    test: (line) => {
      const m1 = /\bexpect\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)/.exec(line);
      if (m1 && m1[1] === m1[2]) return true;
      const m2 = /\b(?:assert|assert_eq!)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:===?|==|,)\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/.exec(line);
      return Boolean(m2 && m2[1] === m2[2]);
    },
  },
  {
    rule: 'lower-bound',
    message: 'Weak lower-bound assertion (>= 0 or >= 1 on length/size/count) instead of exact expected shape.',
    test: (line) => /\bexpect\s*\([^)]*\.(?:length|size|count)\s*\)\s*\.\s*toBeGreaterThanOrEqual\s*\(\s*[01]\s*\)|\b(?:len|count)\s*\([^)]+\)\s*>=\s*0\b/.test(line),
  },
];

export function checkTestJunk(targets = []) {
  const rawList = Array.isArray(targets) ? targets : [targets];
  const files = [];
  const seen = new Set();
  const collect = (p, explicit) => {
    const abs = path.resolve(String(p || ''));
    if (!abs || seen.has(abs)) return;
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      if (explicit || TEST_FILE_NAME_RE.test(abs)) {
        seen.add(abs);
        files.push(abs);
      }
      return;
    }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name.startsWith('.') || IGNORED_SCAN_DIRS.has(e.name)) continue;
        collect(path.join(abs, e.name), false);
      }
    }
  };
  for (const t of rawList) {
    if (t && String(t).trim()) collect(String(t).trim(), true);
  }
  const violations = [];
  for (const file of files) {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || /^(?:\/\/|#|\/\*|\*)/.test(trimmed)) continue;
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (/check-test-junk:\s*ignore/i.test(line) || /check-test-junk:\s*ignore/i.test(prevLine)) continue;
      for (const ruleObj of TEST_JUNK_RULES) {
        if (ruleObj.test(line)) {
          violations.push({
            file,
            line: i + 1,
            rule: ruleObj.rule,
            message: ruleObj.message,
            snippet: trimmed.slice(0, 140),
          });
        }
      }
    }
  }
  return {
    ok: violations.length === 0,
    exitCode: violations.length === 0 ? 0 : 1,
    filesScanned: files.length,
    violations,
  };
}

// ---------- deep-research helpers (research-matrix & audit-research) ----------
const RESEARCH_LENS_FACETS = {
  technical: [
    'system architecture and algorithmic tradeoffs',
    'latency throughput and scaling benchmarks',
    'failure modes reliability and security boundaries',
    'standards protocols and empirical limits',
    'state of the art vs production bottlenecks',
  ],
  business: [
    'market sizing TAM SAM SOM and growth drivers',
    'ideal customer profile ICP and acute pain points',
    'competitive landscape moat and switching costs',
    'unit economics pricing model and margin structure',
    'go-to-market distribution and regulatory risk',
  ],
  idea: [
    'first-principles problem validation and jobs to be done',
    'non-obvious user behavior and contrarian thesis',
    'minimum viable wedge and adoption friction',
    'prior failed attempts and structural why-now catalysts',
    'falsification criteria and kill signals',
  ],
  implementation: [
    'SDK package ecosystem maintenance and license comparison',
    'API surface version compatibility and breaking changes',
    'codebase integration boundaries and data schema migration',
    'testing strategy observability and rollback plan',
    'edge cases concurrency and security hardening',
  ],
  general: [
    'theoretical and architectural foundations',
    'empirical evidence and measured benchmarks',
    'business and economic unit dynamics',
    'implementation patterns and operational risks',
    'regulatory governance and failure modes',
  ],
};

export function buildResearchMatrix(topic, rawLens = 'general', customFacets = []) {
  const topicClean = String(topic || '').trim().replace(/^["']|["']$/g, '');
  if (!topicClean) {
    return { ok: false, exitCode: 1, error: 'Research topic is required.' };
  }
  const normLens = String(rawLens || 'general').trim().replace(/^--/, '').toLowerCase();
  const lens = RESEARCH_LENS_FACETS[normLens] ? normLens : 'general';
  const facets = Array.isArray(customFacets) && customFacets.length
    ? customFacets.map((f) => String(f).trim()).filter(Boolean)
    : RESEARCH_LENS_FACETS[lens];

  const terminologicalBlueprint = {
    coreTopic: topicClean,
    lens,
    recommendedTermClusters: [
      `${topicClean} Core Mechanics & Canonical Definitions`,
      `${topicClean} ${lens.charAt(0).toUpperCase() + lens.slice(1)} Drivers & Constraints`,
      `${topicClean} Counter-Theories, Failure Modes & Critiques`,
      `${topicClean} Cross-Domain Analogues & Prior Art`,
    ],
  };

  const queryMatrix = {
    foundational: [
      `"${topicClean}" AND ("systematic review" OR "meta-analysis" OR "benchmark" OR "specification")`,
      `"${topicClean}" AND ("state of the art" OR "architecture" OR "first principles")`,
      `"${topicClean}" AND ("evolution" OR "paradigm shift" OR "postmortem" OR "case study")`,
    ],
    facets: facets.map((facet) => `"${topicClean}" AND "${facet}"`),
    relationalAndCausal: [
      `("${topicClean}") AND ("causal mechanism" OR "feedback loop" OR "second-order effects")`,
      `("${topicClean}") AND ("bottleneck" OR "scaling limit" OR "tradeoff")`,
      `("${topicClean}") AND ("quantitative metrics" OR "effect size" OR "unit economics" OR "latency")`,
    ],
    contradictionAndCritique: [
      `+"${topicClean}" AND ("criticism" OR "rebuttal" OR "limitations" OR "paradox")`,
      `+"${topicClean}" AND ("competing alternatives" OR "failure modes" OR "anti-pattern")`,
      `+"${topicClean}" AND ("unintended consequences" OR "migration pain" OR "post-mortem")`,
    ],
  };

  const sourceTierFilters = {
    Tier_A_Primary_Standards_And_Benchmarks: [
      `site:.gov OR site:.edu OR site:ietf.org OR site:w3.org "${topicClean}"`,
      `"${topicClean}" ("official documentation" OR "RFC" OR "systematic review" OR "reproducible benchmark")`,
    ],
    Tier_B_Peer_Reviewed_And_Primary_Filings: [
      `"${topicClean}" ("peer reviewed" OR "10-K" OR "empirical dataset" OR "production postmortem")`,
      `"${topicClean}" ("architecture decision record" OR "reference implementation")`,
    ],
  };

  const mdLines = [
    `# Search Strategy & Boolean Matrix: ${topicClean} (Lens: ${lens})`,
    '',
    '## 1. Terminological Apparatus Clusters',
    ...terminologicalBlueprint.recommendedTermClusters.map((c) => `- [ ] **Cluster:** ${c}`),
    '',
    '## 2. Foundational Queries (Tier A / B)',
    ...queryMatrix.foundational.map((q) => `- \`${q}\``),
    '',
    `## 3. Lens Facet Queries (${lens})`,
    ...queryMatrix.facets.map((q) => `- \`${q}\``),
    '',
    '## 4. Relational & Causal Mechanism Queries',
    ...queryMatrix.relationalAndCausal.map((q) => `- \`${q}\``),
    '',
    '## 5. Contradiction, Critique & Falsification Queries',
    ...queryMatrix.contradictionAndCritique.map((q) => `- \`${q}\``),
  ];

  return {
    ok: true,
    exitCode: 0,
    topic: topicClean,
    lens,
    terminologicalBlueprint,
    queryMatrix,
    sourceTierFilters,
    markdown: `${mdLines.join('\n')}\n`,
  };
}

const REQUIRED_RESEARCH_SECTIONS = [
  { name: 'Executive Summary', re: /^##\s+.*Executive Summary/im },
  { name: 'Introduction & Context', re: /^##\s+.*(?:Introduction|Context|Scope)/im },
  { name: 'Research Methodology', re: /^##\s+.*(?:Methodology|Evidentiary|Source)/im },
  { name: 'Multidimensional Analysis', re: /^##\s+.*(?:Analysis|Investigation|Lens)/im },
  { name: 'Interpretation & Synthesis', re: /^##\s+.*(?:Interpretation|Synthesis|Systemic)/im },
  { name: 'Gaps, Risks & Limitations', re: /^##\s+.*(?:Gaps|Limitations|Uncertainty|Risks|Falsification)/im },
  { name: 'Conclusions & Recommendations', re: /^##\s+.*(?:Conclusion|Recommendations|Action Matrix)/im },
  { name: 'Self-Assessment Scorecard', re: /^##\s+.*(?:Self-Assessment|Scorecard)/im },
];

const RESEARCH_RUBRIC_DIMENSIONS = [
  { key: 'depth', label: 'Depth of Analysis', re: /Depth\s+of\s+Analysis/i },
  { key: 'systemicity', label: 'Systemicity', re: /Systemicity/i },
  { key: 'criticalThinking', label: 'Critical Thinking', re: /Critical\s+Thinking/i },
  { key: 'interdisciplinarity', label: 'Interdisciplinarity / Lens Rigor', re: /(?:Interdisciplinarity|Lens\s*(?:&|and)?\s*Cross-Domain\s+Rigor|Cross-Domain)/i },
  { key: 'practicalApplicability', label: 'Practical Applicability', re: /Practical\s+(?:Applicability|Actionability)/i },
];

export function auditResearchReport(reportPath) {
  const rawPath = String(reportPath || '').trim();
  const resolved = rawPath ? path.resolve(rawPath) : '';
  if (!resolved || !fs.existsSync(resolved)) {
    return { ok: false, exitCode: 1, error: `Report file not found: ${rawPath}`, errors: [`Report file not found: ${rawPath}`], warnings: [] };
  }
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isFile()) {
    return { ok: false, exitCode: 1, error: 'Refusing to audit symlinked or non-regular file.', errors: ['Refusing to audit symlinked or non-regular file.'], warnings: [] };
  }
  const content = fs.readFileSync(resolved, 'utf8');
  const words = content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const errors = [];
  const warnings = [];

  for (const sec of REQUIRED_RESEARCH_SECTIONS) {
    if (!sec.re.test(content)) {
      errors.push(`Missing required section: '${sec.name}'`);
    }
  }
  if (!/^##\s+.*Glossary/im.test(content)) {
    warnings.push("Optional section not found: 'Glossary' (encouraged for domain-dense topics)");
  }
  if (!/```mermaid/i.test(content)) {
    warnings.push("Optional element not found: 'Mermaid diagram' (encouraged for systemic modeling)");
  }
  if (wordCount < 600) {
    warnings.push(`Report is relatively concise (${wordCount} words). Target for deep research is 1,200-5,000+ words.`);
  }

  let execSummaryWords = 0;
  const execMatch = content.match(/^##\s+.*Executive Summary[^\r\n]*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/im);
  if (execMatch) {
    execSummaryWords = execMatch[1].trim().split(/\s+/).filter(Boolean).length;
    if (execSummaryWords < 100) {
      warnings.push(`Executive Summary is brief (${execSummaryWords} words). Target is 250-500 words.`);
    }
  }

  const claimCounts = {
    verified: (content.match(/\[VERIFIED\]/g) || []).length,
    derived: (content.match(/\[DERIVED\]/g) || []).length,
    assumed: (content.match(/\[ASSUMED\]/g) || []).length,
  };
  if (claimCounts.verified + claimCounts.derived + claimCounts.assumed === 0) {
    warnings.push('No [VERIFIED], [DERIVED], or [ASSUMED] claim-kind tags found in report.');
  }

  // Detect HTML-to-markdown footnote digits glued onto numbers (e.g. "42¹" or "100[1]")
  const proseWithoutCode = content.replace(/^ {0,3}(?:`{3,}|~{3,})[\s\S]*?^ {0,3}(?:`{3,}|~{3,})/gm, '').replace(/`[^`\r\n]+`/g, '');
  const conversionMatches = proseWithoutCode.match(/\b\d+(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\[\d+\])/g) || [];
  if (conversionMatches.length > 0) {
    errors.push(`conversion_altered_number: detected ${conversionMatches.length} number(s) with glued footnote marker(s) (${conversionMatches.slice(0, 3).join(', ')})`);
  }

  const scores = {};
  const lines = content.split(/\r?\n/);
  for (const dim of RESEARCH_RUBRIC_DIMENSIONS) {
    const candidateRows = lines.filter((l) => l.includes('|') && dim.re.test(l));
    if (candidateRows.length === 0) {
      errors.push(`Missing scorecard row for dimension: '${dim.label}'`);
      continue;
    }
    let achievedScore = null;
    for (const rowLine of candidateRows) {
      const cells = rowLine.split('|').map((c) => c.trim()).filter(Boolean);
      // Skip cell[0] (dimension name). Look through remaining cells, skipping target cells like ">= 85" or "\\ge 85".
      for (let i = 1; i < cells.length; i += 1) {
        const cell = cells[i].replace(/[`*_~]/g, '').trim();
        if (/(?:>=|≤|>=|\\ge|\\le|target)/i.test(cell)) continue;
        const numMatch = /^(\d{1,3})(?:\s*\/\s*100|\s*%)?$/.exec(cell);
        if (numMatch) {
          const val = Number(numMatch[1]);
          if (val >= 0 && val <= 100) {
            achievedScore = val;
            break;
          }
        }
      }
      if (achievedScore !== null) break;
    }
    if (achievedScore === null) {
      errors.push(`Could not parse numeric score (0-100) for dimension: '${dim.label}'`);
    } else {
      scores[dim.key] = achievedScore;
      if (achievedScore < 85) {
        errors.push(`Dimension '${dim.label}' scored ${achievedScore}/100 (target benchmark is >= 85).`);
      }
    }
  }

  const scoreVals = Object.values(scores);
  const compositeScore = scoreVals.length === RESEARCH_RUBRIC_DIMENSIONS.length
    ? Math.round((scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) * 10) / 10
    : null;

  const ok = errors.length === 0;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    file: resolved,
    wordCount,
    execSummaryWords,
    scores,
    compositeScore,
    claimCounts,
    conversionAlteredNumbers: conversionMatches.length,
    errors,
    warnings,
  };
}

// ---------- watch-pr verdict policy, failure signature normalizer, session compare & wiki link repair ----------
// shortcut: legacy CLI helpers remain in omagy-hook.mjs while newer evaluators live in lazy-imported hooks/omagy-cli.mjs, migrate remaining CLI helpers if omagy-hook.mjs exceeds 235KB
export const DEFAULT_NO_CHECKS_CONFIRM_MS = 60_000;
export function decideWatchVerdict(rawFacts = {}, options = {}) {
  const f = rawFacts && typeof rawFacts === 'object' ? rawFacts : {};
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const state = norm(f.state ?? f.prState ?? 'open');
  if (state === 'merged' || state === 'closed') {
    return { verdict: 'gone', reasons: [`pr_${state}`] };
  }
  const mergeable = norm(f.mergeable);
  const mergeStateStatus = norm(f.mergeStateStatus);
  const reviewDecision = norm(f.reviewDecision);
  const reviewRequired = Boolean(f.reviewRequired);
  const checks = f.checks && typeof f.checks === 'object' ? f.checks : {};
  const failed = Number(checks.failed ?? f.checksFailed ?? 0);
  const canceled = Number(checks.canceled ?? f.checksCanceled ?? 0);
  const pending = Number(checks.pending ?? f.checksPending ?? 0);
  const passed = Number(checks.passed ?? f.checksPassed ?? 0);
  const rawTotal = checks.total ?? f.checksTotal;
  const total = rawTotal !== undefined ? Number(rawTotal) : (failed + canceled + pending + passed);

  const blocked = [];
  if (mergeable === 'conflicting') blocked.push('merge_conflicting');
  if (mergeStateStatus === 'blocked') blocked.push('merge_state_blocked');
  if (mergeStateStatus === 'dirty') blocked.push('merge_state_dirty');
  if (mergeStateStatus === 'behind') blocked.push('merge_state_behind');
  if (failed > 0) blocked.push('checks_failed');
  if (canceled > 0) blocked.push('checks_canceled');
  if (mergeStateStatus === 'unstable' && pending === 0) blocked.push('merge_state_unstable');
  if (reviewDecision === 'changes_requested') blocked.push('changes_requested');
  if (reviewRequired && reviewDecision !== 'approved') blocked.push('review_required');
  if (blocked.length > 0) {
    return { verdict: 'blocked', reasons: [...new Set(blocked)] };
  }

  const waiting = [];
  if (f.isDraft === true || mergeStateStatus === 'draft') waiting.push('draft_pr');
  if (mergeable === 'unknown') waiting.push('mergeable_unknown');
  if (mergeStateStatus === 'unknown') waiting.push('merge_state_unknown');
  if (pending > 0 || (mergeStateStatus === 'unstable' && pending > 0)) waiting.push('checks_pending');
  if (total === 0) {
    // GitHub post-push check-suite registration race: require a 60s confirmation window when 0 checks are reported.
    const confirmMs = Number(options.noChecksConfirmMs ?? DEFAULT_NO_CHECKS_CONFIRM_MS);
    const nowMs = Number(options.nowMs ?? f.nowMs ?? Date.now());
    const firstSeen = Number(f.noChecksFirstSeenAtMs);
    const elapsedAttr = Number(f.elapsedSinceFirstZeroChecksMs);
    const elapsedMs = Number.isFinite(elapsedAttr)
      ? elapsedAttr
      : (Number.isFinite(firstSeen) ? (nowMs - firstSeen) : NaN);
    if (!Number.isFinite(elapsedMs) || elapsedMs < confirmMs) {
      waiting.push('no_checks_confirm_window');
    }
  }
  if (waiting.length > 0) {
    return { verdict: 'waiting', reasons: [...new Set(waiting)] };
  }
  return {
    verdict: 'ready',
    reasons: [],
    proof: { headSha: String(f.headSha || '') },
  };
}

export function normalizeFailureSignature(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/);
  const kept = [];
  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    const trimmed = cleanLine.trim();
    if (!trimmed) continue;
    if (/^[.sxX]+(?:\s*\[\s*\d+%\s*\])?$/.test(trimmed)) continue;
    if (/^Start at\s+\d{2}:\d{2}:\d{2}$/i.test(trimmed)) continue;
    let line = cleanLine.replace(/(?<=\bin\s+\d+(?:\.\d+)?s\s+)\(\d+:\d{2}(?::\d{2})?(?:\.\d+)?\)/g, '');
    if (/^=*\s*\d+\s+passed(?:,\s*\d+\s+(?:warnings?|skipped|xfailed|xpassed|deselected))*\s+in\s+\d+(?:\.\d+)?s\s*=*$/i.test(line.trim())) continue;
    if (/^=+\s*.*\b(?:failed|errors?)\b.*\bin\s+\d+(?:\.\d+)?s\s*=+$/i.test(line.trim())) {
      line = line.replace(/\bin\s+\d+(?:\.\d+)?s(?=\s*=+$)/i, 'in <d>s');
    }
    line = line.replace(/(?<=\(node:)\d+(?=\)\s+(?:\[[^\]]+\]\s+)?[A-Za-z]+Warning:)/g, '<pid>');
    kept.push(line.trimEnd());
  }
  return kept.join('\n');
}

function summarizeTranscriptMetrics(records) {
  let turnsStarted = 0;
  let turnsCompleted = 0;
  let toolCalls = 0;
  let failedTools = 0;
  let incomplete = 0;
  let compactions = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;
  const byTool = {};
  const fileReads = {};

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const ts = Date.parse(rec.created_at || rec.at || rec.timestamp || '');
    if (Number.isFinite(ts)) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
    const type = String(rec.type || '').toUpperCase();
    const status = String(rec.status || '').toUpperCase();
    if (type === 'USER_INPUT' || rec.role === 'user') turnsStarted += 1;
    if (type === 'PLANNER_RESPONSE' || rec.role === 'assistant') {
      if (!status || status === 'DONE' || status === 'COMPLETED') turnsCompleted += 1;
    }
    if (type.includes('COMPACT') || (typeof rec.content === 'string' && /(?:^|\s)\/compact\b/i.test(rec.content))) {
      compactions += 1;
    }
    if (status === 'ERROR' || status === 'FAILED' || rec.error) {
      failedTools += 1;
    } else if (status && status !== 'DONE' && status !== 'COMPLETED') {
      incomplete += 1;
    }
    const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
    for (const tc of calls) {
      if (!tc || typeof tc !== 'object') continue;
      toolCalls += 1;
      const rawName = String(tc.name || tc.toolName || tc.function?.name || 'unknown').replace(/[^A-Za-z0-9_:-]/g, '');
      const name = rawName || 'unknown';
      if (!byTool[name]) byTool[name] = { calls: 0, failed: 0 };
      byTool[name].calls += 1;
      if (tc.status === 'ERROR' || tc.error) {
        byTool[name].failed += 1;
        failedTools += 1;
      }
      if (/^(?:read_file|view_file|read)$/i.test(name)) {
        let argsObj = tc.arguments || tc.args || tc.input || tc.function?.arguments || null;
        if (typeof argsObj === 'string') {
          try { argsObj = JSON.parse(argsObj); } catch { argsObj = null; }
        }
        const readPath = argsObj && typeof argsObj === 'object'
          ? String(argsObj.Path || argsObj.filePath || argsObj.TargetFile || argsObj.path || '').trim()
          : '';
        if (readPath) {
          fileReads[readPath] = (fileReads[readPath] || 0) + 1;
        }
      }
    }
  }
  const repeatedWork = Object.values(fileReads).filter((c) => c >= 3).length;
  const stumbles = failedTools + incomplete;
  const durationMs = (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs >= minTs && minTs !== maxTs)
    ? (maxTs - minTs)
    : (records.length === 1 && Number.isFinite(minTs) ? 0 : null);
  return {
    records: records.length,
    duration_ms: durationMs,
    turns: turnsStarted,
    turns_started: turnsStarted,
    turns_completed: turnsCompleted,
    tool_calls: toolCalls,
    failed_tools: failedTools,
    incomplete,
    stumbles,
    repeated_work: repeatedWork,
    compactions,
    byTool,
  };
}

export function compareSessions(baselinePath, candidatePath, opts = {}) {
  const safeRead = (p) => {
    try {
      const r = readJsonlRecords(String(p || ''));
      return Array.isArray(r) ? r : (Array.isArray(r?.records) ? r.records : []);
    } catch {
      return [];
    }
  };
  const baseRecs = safeRead(baselinePath);
  const candRecs = safeRead(candidatePath);
  const base = summarizeTranscriptMetrics(baseRecs);
  const cand = summarizeTranscriptMetrics(candRecs);
  const reasons = [];
  let status = 'no_regression';

  if (base.records === 0 || cand.records === 0) {
    status = 'inconclusive';
    reasons.push('missing_transcript_records');
  } else if ((base.tool_calls > 0 && base.duration_ms === null) || (cand.tool_calls > 0 && cand.duration_ms === null)) {
    status = 'inconclusive';
    reasons.push('missing_measured_duration');
  } else {
    if (cand.failed_tools > base.failed_tools) reasons.push('failed_tools_increased');
    if (cand.incomplete > base.incomplete) reasons.push('incomplete_steps_increased');
    if (cand.stumbles > base.stumbles && !reasons.includes('failed_tools_increased') && !reasons.includes('incomplete_steps_increased')) {
      reasons.push('stumbles_increased');
    }
    if (cand.repeated_work > base.repeated_work) reasons.push('repeated_work_increased');
    const maxPct = opts.maxDurationIncreasePct !== undefined ? Number(opts.maxDurationIncreasePct) : 50;
    if (Number.isFinite(maxPct) && base.duration_ms !== null && base.duration_ms > 0 && cand.duration_ms !== null) {
      const pctIncrease = ((cand.duration_ms - base.duration_ms) / base.duration_ms) * 100;
      if (pctIncrease > maxPct) reasons.push('duration_regression');
    }
    if (reasons.length > 0) status = 'regression';
  }

  const allTools = new Set([...Object.keys(base.byTool), ...Object.keys(cand.byTool)]);
  const byTool = {};
  for (const t of [...allTools].sort()) {
    const b = base.byTool[t] || { calls: 0, failed: 0 };
    const c = cand.byTool[t] || { calls: 0, failed: 0 };
    byTool[t] = {
      baseline_calls: b.calls,
      candidate_calls: c.calls,
      delta_calls: c.calls - b.calls,
      baseline_failed: b.failed,
      candidate_failed: c.failed,
      delta_failed: c.failed - b.failed,
    };
  }
  const pickSummary = (m) => ({
    duration_ms: m.duration_ms,
    turns: m.turns,
    turns_started: m.turns_started,
    turns_completed: m.turns_completed,
    tool_calls: m.tool_calls,
    failed_tools: m.failed_tools,
    incomplete: m.incomplete,
    stumbles: m.stumbles,
    repeated_work: m.repeated_work,
    compactions: m.compactions,
  });
  const failOnReg = Boolean(opts.failOnRegression);
  const exitCode = !failOnReg ? 0 : (status === 'regression' ? 2 : (status === 'inconclusive' ? 3 : 0));
  return {
    ok: exitCode === 0,
    exitCode,
    baseline: pickSummary(base),
    candidate: pickSummary(cand),
    deltas: {
      duration_ms: (base.duration_ms !== null && cand.duration_ms !== null) ? (cand.duration_ms - base.duration_ms) : null,
      turns: cand.turns - base.turns,
      tool_calls: cand.tool_calls - base.tool_calls,
      failed_tools: cand.failed_tools - base.failed_tools,
      incomplete: cand.incomplete - base.incomplete,
      stumbles: cand.stumbles - base.stumbles,
      repeated_work: cand.repeated_work - base.repeated_work,
      compactions: cand.compactions - base.compactions,
    },
    byTool,
    assessment: { status, reasons },
  };
}

export function transformOutsideCodeSpans(markdown, replacer) {
  const tokenRe = /(^ {0,3}(?:`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^ {0,3}(?:`{3,}|~{3,})[ \t]*$|`+[^`\r\n]*?`+)/gm;
  let out = '';
  let lastIdx = 0;
  let m;
  while ((m = tokenRe.exec(markdown)) !== null) {
    if (m.index > lastIdx) {
      out += replacer(markdown.slice(lastIdx, m.index));
    }
    out += m[0];
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < markdown.length) {
    out += replacer(markdown.slice(lastIdx));
  }
  return out;
}

export function repairWikiLinks(wikiDir, changes = {}) {
  const dir = path.resolve(String(wikiDir || ''));
  if (!dir || !fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) {
    return { ok: false, exitCode: 1, filesUpdated: 0, linksRewritten: 0, error: 'Invalid or symlinked wiki directory.' };
  }
  const moved = {};
  const archivedList = [];
  const deletedList = [];
  if (Array.isArray(changes)) {
    for (const item of changes) {
      if (!item || typeof item !== 'object') continue;
      const act = String(item.action || '').trim().toLowerCase();
      const oldSlug = String(item.oldSlug || item.slug || '').trim().replace(/\.md$/i, '');
      const newSlug = String(item.newSlug || item.to || '').trim().replace(/\.md$/i, '');
      if (!oldSlug) continue;
      if ((act === 'move' || act === 'moved' || act === 'rename') && newSlug) moved[oldSlug] = newSlug;
      else if (act === 'archive' || act === 'archived') archivedList.push(oldSlug);
      else if (act === 'delete' || act === 'deleted') deletedList.push(oldSlug);
    }
  } else if (changes && typeof changes === 'object') {
    if (changes.moved && typeof changes.moved === 'object') {
      for (const [k, v] of Object.entries(changes.moved)) {
        moved[String(k).replace(/\.md$/i, '')] = String(v).replace(/\.md$/i, '');
      }
    }
    if (Array.isArray(changes.archived)) archivedList.push(...changes.archived.map((s) => String(s).replace(/\.md$/i, '')));
    if (Array.isArray(changes.deleted)) deletedList.push(...changes.deleted.map((s) => String(s).replace(/\.md$/i, '')));
  }
  const archived = new Set(archivedList);
  const deleted = new Set(deletedList);
  const movedMap = new Map(Object.entries(moved));

  let filesUpdated = 0;
  let linksRewritten = 0;
  const entries = fs.readdirSync(dir);
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch { continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    const orig = fs.readFileSync(full, 'utf8');
    let fileRewrites = 0;
    const updated = transformOutsideCodeSpans(orig, (segment) => {
      let s = segment.replace(/\[\[([^\]|#\r\n]+)(#[^\]|\r\n]*)?(?:\|([^\]\r\n]+))?\]\]/g, (fullMatch, rawTarget, anchor = '', alias = '') => {
        const slug = rawTarget.trim().replace(/\.md$/i, '');
        const label = (alias || slug).trim();
        if (movedMap.has(slug)) {
          fileRewrites += 1;
          const nextSlug = movedMap.get(slug);
          return `[[${nextSlug}${anchor}${alias ? `|${alias}` : ''}]]`;
        }
        if (archived.has(slug)) {
          fileRewrites += 1;
          return `[[ARCHIVE.md|${label} (archived)]]`;
        }
        if (deleted.has(slug)) {
          fileRewrites += 1;
          return label;
        }
        return fullMatch;
      });
      s = s.replace(/\[([^\]\r\n]+)\]\((?:\.\/)?([^)\s#]+?)\.md(#[^)\s]*)?\)/g, (fullMatch, label, rawSlug, anchor = '') => {
        const slug = rawSlug.trim();
        if (movedMap.has(slug)) {
          fileRewrites += 1;
          return `[${label}](${movedMap.get(slug)}.md${anchor})`;
        }
        if (archived.has(slug)) {
          fileRewrites += 1;
          return `[${label} (archived)](ARCHIVE.md)`;
        }
        if (deleted.has(slug)) {
          fileRewrites += 1;
          return label;
        }
        return fullMatch;
      });
      return s;
    });
    if (fileRewrites > 0 && updated !== orig) {
      fs.writeFileSync(full, updated, 'utf8');
      filesUpdated += 1;
      linksRewritten += fileRewrites;
    }
  }
  return { ok: true, exitCode: 0, filesUpdated, linksRewritten };
}

export function nextAvailableWikiSlug(wikiDir, rawSlug) {
  const dir = path.resolve(String(wikiDir || ''));
  const baseSlug = String(rawSlug || '').trim().replace(/\.md$/i, '');
  if (!dir || !baseSlug || !fs.existsSync(dir)) return baseSlug;
  let logAndArchive = '';
  for (const metaFile of ['log.md', 'ARCHIVE.md']) {
    try {
      const p = path.join(dir, metaFile);
      if (fs.existsSync(p) && !fs.lstatSync(p).isSymbolicLink()) {
        logAndArchive += `\n${fs.readFileSync(p, 'utf8')}`;
      }
    } catch { /* ignore */ }
  }
  const isCandidateTaken = (candidate) => {
    if (fs.existsSync(path.join(dir, `${candidate}.md`))) return true;
    if (fs.existsSync(path.join(dir, 'archive', `${candidate}.md`))) return true;
    if (fs.existsSync(path.join(dir, 'deleted', `${candidate}.md`))) return true;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:delete[d]?|archive[d]?|move[d]?)\\b[^\\r\\n]*\\b${escaped}(?![-A-Za-z0-9_])|\\b${escaped}(?![-A-Za-z0-9_])[^\\r\\n]*\\(archived\\)`, 'i').test(logAndArchive);
  };
  if (!isCandidateTaken(baseSlug)) {
    return baseSlug;
  }
  let n = 2;
  while (isCandidateTaken(`${baseSlug}-${n}`)) {
    n += 1;
  }
  return `${baseSlug}-${n}`;
}

// ---------- transcript ----------
function lastUserMessage(transcriptPath, payload = null) {
  if (transcriptPath && typeof transcriptPath === 'string') {
    let text = '';
    try {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        text = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { text = ''; }
    if (text) {
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i].trim();
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        const type = String(o.type || '');
        const isUser = /USER_INPUT/i.test(type) || o.source === 'USER_EXPLICIT' || o.role === 'user';
        const content = o.content ?? o.text ?? o.message;
        if (!isUser || typeof content !== 'string') continue;
        const key = `${o.step_index ?? o.stepIndex ?? ''}:${o.created_at ?? o.createdAt ?? ''}:${content.length}`;
        return { key, text: content };
      }
    }
  }
  const directInput = payload?.lastUserInput ?? payload?.last_user_input ?? payload?.prompt;
  if (typeof directInput === 'string' && directInput.trim()) {
    const trimmed = directInput.trim();
    return { key: `input:${trimmed.length}:${trimmed.slice(0, 64)}`, text: directInput };
  }
  return null;
}
function lastAssistantMessage(payload) {
  for (const k of ['lastAssistantMessage', 'last_assistant_message', 'message', 'output', 'response']) {
    if (typeof payload?.[k] === 'string' && payload[k].trim()) return payload[k].trim();
  }
  const transcriptPath = payload?.transcriptPath || payload?.transcript_path;
  if (!transcriptPath || typeof transcriptPath !== 'string') return '';
  let text = '';
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const type = String(o.type || '');
    const isModel = /PLANNER_RESPONSE/i.test(type) || o.source === 'MODEL' || o.role === 'assistant';
    const content = o.content ?? o.text ?? o.message;
    if (isModel && typeof content === 'string' && content.trim()) return content.trim();
  }
  return '';
}
export function scanRepoCodeHygiene(cwd, parsedEntries = [], options = {}) {
  const repoDir = path.resolve(String(cwd || process.cwd()));
  const baseRef = String(options.baseRef || 'HEAD');
  const maxUntracked = Number(options.maxUntrackedFiles ?? 200);
  const maxUntrackedBytes = Number(options.maxUntrackedBytes ?? 256 * 1024);
  const out = [];
  const scanLine = (relFile, rawLine, lineNum, fromUntracked) => {
    const stripped = stripCodeStrings(rawLine);
    for (const bp of BLOCKER_PATTERNS) {
      if (bp.pattern.test(bp.kind === 'unimplemented throw' ? rawLine : stripped)) {
        const category = (bp.kind === 'skipped test' || bp.kind === 'focused test') ? 'test-made-easier' : 'unfinished-work';
        out.push({ kind: bp.kind, category, file: relFile, line: lineNum, snippet: rawLine, fromUntracked });
        break;
      }
    }
    if (isCheckerSuppressionLine(rawLine) && !hasValidSuppressionExemption(rawLine)) {
      out.push({ kind: 'silenced-checker', category: 'silenced-checker', file: relFile, line: lineNum, snippet: rawLine, fromUntracked });
    }
  };

  for (const entry of parsedEntries) {
    const relFile = entry.newFile || entry.oldFile;
    if (!relFile) continue;
    if (entry.status !== 'added') {
      let diskText = null;
      if (entry.status !== 'deleted' && entry.newFile) {
        const diskFull = path.join(repoDir, entry.newFile);
        try { if (fs.existsSync(diskFull) && fs.lstatSync(diskFull).isFile()) diskText = fs.readFileSync(diskFull, 'utf8'); } catch { /* fail open: unreadable working tree file */ }
      }
      const hasIgnore = entry.status === 'renamed'
        || (typeof diskText === 'string' && PROTECTED_MARKER_RE.test(diskText))
        || entry.hunks.some((h) => h.lines.some((l) => l.type === 'del' && PROTECTED_MARKER_RE.test(l.content)));
      if (hasIgnore) {
        let baseRaw = '';
        try {
          baseRaw = execFileSync('git', ['show', `${baseRef}:${entry.oldFile || entry.newFile}`], {
            cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, maxBuffer: 4 * 1024 * 1024,
          });
        } catch { /* fail open: absent in baseRef */ }
        if (baseRaw) {
          const nextTxt = (entry.status === 'deleted' || entry.status === 'renamed') ? null : diskText;
          for (const tb of hasProtectedBlockTampering(baseRaw, nextTxt)) {
            out.push({
              kind: 'protected-block-modified',
              category: 'protected-block-modified',
              blockKind: tb.kind,
              file: relFile,
              line: tb.startLine,
              snippet: tb.content.split('\n')[0] || tb.kind,
              fromUntracked: false,
            });
          }
        }
      }
    }
    if (entry.status === 'deleted' || !CODE_EXTENSIONS.has(path.extname(relFile).toLowerCase())) continue;
    for (const hunk of entry.hunks) {
      const postRows = [];
      const touchedLines = new Set();
      let curPost = hunk.newStart;
      for (const hl of hunk.lines) {
        if (hl.type === 'del') { touchedLines.add(curPost); touchedLines.add(Math.max(1, curPost - 1)); }
        else {
          curPost = hl.newLine;
          postRows.push({ text: hl.content, line: hl.newLine });
          if (hl.type === 'add') { touchedLines.add(hl.newLine); scanLine(relFile, hl.content, hl.newLine, false); }
        }
      }
      for (const ec of findEmptyCatches(postRows)) {
        for (let ln = ec.line; ln <= ec.endLine; ln += 1) {
          if (touchedLines.has(ln)) {
            out.push({ kind: 'empty-catch', category: 'empty-catch', file: relFile, line: ec.line, snippet: ec.snippet, fromUntracked: false });
            break;
          }
        }
      }
    }
  }

  let untrackedRaw = '';
  try {
    untrackedRaw = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--exclude-standard'], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 4 * 1024 * 1024,
    });
  } catch { /* fail open: skip untracked scan outside git worktrees */ }
  const untrackedFiles = untrackedRaw
    ? untrackedRaw.split('\0').map((f) => f.replace(/\\/g, '/').trim()).filter((f) => f && !f.startsWith('.omagy/') && !f.startsWith('omagy_wiki/') && CODE_EXTENSIONS.has(path.extname(f).toLowerCase())).slice(0, maxUntracked)
    : [];
  for (const relFile of untrackedFiles) {
    const full = path.join(repoDir, relFile);
    let rawText = '';
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile() || st.isSymbolicLink() || st.size > maxUntrackedBytes) continue;
      rawText = fs.readFileSync(full, 'utf8');
    } catch { /* fail open: skip unreadable untracked file */ continue; }
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) scanLine(relFile, lines[i], i + 1, true);
    for (const ec of findEmptyCatches(lines, 1)) {
      out.push({ kind: 'empty-catch', category: 'empty-catch', file: relFile, line: ec.line, snippet: ec.snippet, fromUntracked: true });
    }
  }
  return out;
}

export function scanDiffBlockers(roots) {
  const hits = [];
  for (const rawRoot of roots) {
    const cwd = path.resolve(String(rawRoot || process.cwd()));
    if (!fs.existsSync(cwd)) continue;
    let diff = '';
    try {
      diff = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', 'HEAD', '--'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, maxBuffer: 8 * 1024 * 1024,
      });
    } catch { /* fail open: non-git directory or unborn HEAD */ continue; }
    for (const item of scanRepoCodeHygiene(cwd, diff ? parseUnifiedDiff(diff) : [], { baseRef: 'HEAD' })) {
      hits.push({ file: item.file, line: item.line, kind: item.kind });
    }
  }
  for (const oc of analyzeDiffCodeHealth(roots, { onlyOpenCallers: true }).openCallers) {
    hits.push({ file: oc.file, line: oc.line, kind: `open caller of removed symbol '${oc.symbol}'` });
  }
  return hits;
}
function hasRalplanArtifacts(sRoot) {
  const plansDir = path.join(stateRoot(sRoot), '.omagy', 'plans');
  let names = [];
  try { names = fs.readdirSync(plansDir); } catch { return false; }
  return names.some((n) => /^prd-.*\.md$/i.test(n)) && names.some((n) => /^test-spec-.*\.md$/i.test(n));
}
function stripQuotedAndNegatedRegions(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\[[^\][\r\n]+?->[^\][\r\n]+?\]\s*/gm, ' ')
    .replace(/^\s*>[^\r\n]*/gm, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/"[^"\n]{1,200}"/g, ' ')
    .replace(/(?<![\w'])'[^'\n]{1,200}'(?![\w'])/g, ' ')
    .replace(/\b(?:do\s+not|don't|dont|never|avoid|without|instead\s+of|rather\s+than|skip|stop|no\s+need\s+to|not)\s+(?:(?:load|use|run|invoke|call|activate|trigger|start)(?:ing)?\s+)?(?:the\s+)?[$/][a-z][a-z0-9-]*(?:\s+skill|\s+mode)?/gi, ' ');
}
function isInformationalHelpPrompt(text) {
  return /^\s*(?:what\s+(?:is|does|are)|how\s+(?:do\s+i|to|does|can\s+i)|can\s+you\s+explain|explain|tell\s+me\s+about|describe)\b/i.test(String(text || ''))
    && !/\b(?:and\s+then|then\s+(?:run|execute|use)|please\s+(?:run|execute))\b/i.test(String(text || ''));
}
function detectSkills(text) {
  const raw = String(text || '');
  const found = [];
  const lead = /^\s*([$/])([a-z][a-z0-9-]*)\b/.exec(raw);
  if (lead) {
    const [, sigil, name] = lead;
    if (SKILLS.includes(name) && !(sigil === '/' && AGY_SLASH.has(name))) {
      const afterLead = raw.slice(lead[0].length).replace(/^\s*[:,-]?\s*/, '');
      if (!isInformationalHelpPrompt(afterLead)) found.push(name);
      else return [];
    }
  } else if (isInformationalHelpPrompt(raw)) {
    return [];
  }
  const cleaned = stripQuotedAndNegatedRegions(raw);
  const re = /(^|[\s(])([$/])([a-z][a-z0-9-]*)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const [, , sigil, name] = m;
    if (!SKILLS.includes(name)) continue;
    if (sigil === '/' && AGY_SLASH.has(name)) continue;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}
function buildActiveModeMessage(roots, convId = '') {
  const active = activeStates(roots, null, convId);
  if (!active.length) return null;
  const now = Date.now();
  const desc = active.slice(0, 4).map((s) => {
    const waitingTag = isAwaitingConfirmation(s) ? ', awaiting confirmation' : '';
    return `${s.mode} (phase: ${s.data.current_phase || 'unknown'}${waitingTag}, updated ${ago(now - updatedMs(s))})`;
  }).join('; ');
  return `[oh-my-agy] Active workflow state: ${desc} — see ${path.join(active[0].root, '.omagy', 'state')}. ` +
    'If the user says continue/resume, resume from current_phase; if the user changes direction, update or $cancel the mode.';
}

// ---------- handlers ----------
function sessionStart(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const recordFile = runtimeFile(conv, 'routing');
  const record = readJson(recordFile) || {};
  const rawTx = payload.transcriptPath || payload.transcript_path || payload.logPath;
  const transcriptPath = (typeof rawTx === 'string' && rawTx.trim()) ? rawTx.trim() : (record.transcriptPath || null);
  const rawArt = payload.artifactDirectoryPath || payload.artifact_directory_path;
  const artifactDirectoryPath = (typeof rawArt === 'string' && rawArt.trim()) ? rawArt.trim() : (record.artifactDirectoryPath || null);
  const messages = [];

  const activeMsg = buildActiveModeMessage(roots, conv);
  if (activeMsg) messages.push(activeMsg);

  let wikiInjected = Boolean(record.wikiInjected);
  if (!wikiInjected) {
    const wikiMsg = loadWikiSummary(roots);
    if (wikiMsg) {
      messages.push(wikiMsg);
      wikiInjected = true;
    }
  }
  const isSubagent = Boolean(record.isSubagent) || isSubagentPayload(payload);
  let mapInjected = Boolean(record.mapInjected);
  if (!isSubagent && !mapInjected && process.env.OMAGY_MAP !== '0') {
    const mapMsg = buildCodebaseMap(roots);
    if (mapMsg) {
      messages.push(mapMsg);
      mapInjected = true;
    }
  }
  writeJson(recordFile, { ...record, wikiInjected, mapInjected, isSubagent, transcriptPath, artifactDirectoryPath, at: new Date().toISOString() });
  return messages.length ? { injectSteps: messages.map((m) => ({ ephemeralMessage: m })) } : {};
}

function preInvocation(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const rawTx = payload.transcriptPath || payload.transcript_path || payload.logPath;
  const user = lastUserMessage(rawTx, payload);
  const recordFile = runtimeFile(conv, 'routing');
  const record = readJson(recordFile) || {};
  const transcriptPath = (typeof rawTx === 'string' && rawTx.trim()) ? rawTx.trim() : (record.transcriptPath || null);
  const rawArt = payload.artifactDirectoryPath || payload.artifact_directory_path;
  const artifactDirectoryPath = (typeof rawArt === 'string' && rawArt.trim()) ? rawArt.trim() : (record.artifactDirectoryPath || null);
  const userKey = user ? user.key : '';
  if (userKey && record.lastUserKey === userKey) return {};
  // No transcript visibility: only remind on the first invocation of a run.
  if (!userKey && Number(payload.invocationNum ?? payload.invocation_num ?? 0) > 1) return {};

  const isSubagent = Boolean(record.isSubagent) || isSubagentPayload(payload, user ? user.text : '');
  const messages = [];
  if (!isSubagent) {
    const skills = user ? detectSkills(user.text) : [];
    if (skills.length) {
      messages.push(
        `[oh-my-agy] Skill routing: the user explicitly invoked ${skills.map((s) => `$${s}`).join(', ')}. ` +
        'Activate these oh-my-agy skills left-to-right: read each SKILL.md from the oh-my-agy plugin before acting, ' +
        'and treat the rest of the user message as the task.',
      );
    }
    const activeMsg = buildActiveModeMessage(roots, conv);
    if (activeMsg) messages.push(activeMsg);

    let wikiInjected = Boolean(record.wikiInjected);
    if (!wikiInjected) {
      const wikiMsg = loadWikiSummary(roots);
      if (wikiMsg) {
        messages.push(wikiMsg);
        wikiInjected = true;
      }
    }
    let mapInjected = Boolean(record.mapInjected);
    if (!mapInjected && process.env.OMAGY_MAP !== '0') {
      const mapMsg = buildCodebaseMap(roots);
      if (mapMsg) {
        messages.push(mapMsg);
        mapInjected = true;
      }
    }
    const subdir = discoverSubdirAgents(roots, user ? user.text : '', record.seenAgents || []);
    for (const m of subdir.messages) messages.push(m);
    writeJson(recordFile, { lastUserKey: userKey, wikiInjected, mapInjected, isSubagent: false, seenAgents: subdir.seen, transcriptPath, artifactDirectoryPath, at: new Date().toISOString() });
  } else {
    const subdir = discoverSubdirAgents(roots, user ? user.text : '', record.seenAgents || []);
    for (const m of subdir.messages) messages.push(m);
    writeJson(recordFile, { lastUserKey: userKey, wikiInjected: Boolean(record.wikiInjected), mapInjected: Boolean(record.mapInjected), isSubagent: true, seenAgents: subdir.seen, transcriptPath, artifactDirectoryPath, at: new Date().toISOString() });
  }
  return messages.length ? { injectSteps: messages.map((m) => ({ ephemeralMessage: m })) } : {};
}

const FILE_MUTATION_TOOLS_RE = /^(?:write_file|write_to_file|edit_file|replace_file_content|multi_replace_file_content|multiedit|multi_edit|apply_patch|patch|delete_file|move_file|rename_file)$/i;
function extractToolTargets(toolName, args) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  for (const k of ['Path', 'path', 'TargetFile', 'targetFile', 'target_file', 'filePath', 'file_path', 'file',
    'rename', 'MoveTo', 'moveTo', 'move_to', 'destination', 'newPath', 'new_path', 'delete']) {
    push(args?.[k]);
  }
  for (const listKey of ['edits', 'ReplacementChunks', 'replacement_chunks', 'chunks']) {
    const arr = args?.[listKey];
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (e && typeof e === 'object') {
          for (const k of ['Path', 'path', 'filePath', 'file_path', 'file', 'rename', 'newPath']) push(e[k]);
        }
      }
    }
  }
  const patchBody = args?.patchText ?? args?.patch ?? (/(?:apply_patch|^patch$)/i.test(toolName) ? args?.input : '');
  if (typeof patchBody === 'string' && patchBody) {
    const headerRe = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s*(.+)$/gm;
    let m;
    while ((m = headerRe.exec(patchBody)) !== null) push(m[1]);
  }
  return out;
}
function isPathInsideAllowedOmagy(roots, rawTarget) {
  const resolved = canonicalizePath(rawTarget);
  const rawResolved = path.resolve(String(rawTarget));
  if (/(?:^|[/\\])\.omagy[/\\]notifications\.json$/i.test(resolved) || /(?:^|[/\\])\.omagy[/\\]notifications\.json$/i.test(rawResolved)) {
    return false;
  }
  return roots.some((r) => {
    const sr = canonicalizePath(stateRoot(r));
    const wr = canonicalizePath(r);
    if (hasSymlinkSegment(r, rawResolved) || hasSymlinkSegment(sr, rawResolved) || hasSymlinkSegment(wr, rawResolved)) return false;
    if (
      resolved.startsWith(path.join(sr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(wr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(sr, 'omagy_wiki') + path.sep)
      || resolved.startsWith(path.join(wr, 'omagy_wiki') + path.sep)
    ) {
      return true;
    }
    if (resolved.startsWith(wr + path.sep)) {
      const rel = path.relative(wr, resolved).split(path.sep);
      const omagyIdx = Math.max(rel.indexOf('.omagy'), rel.indexOf('omagy_wiki'));
      if (omagyIdx >= 0 && omagyIdx < rel.length - 1 && !rel.includes('..')) {
        return true;
      }
    }
    return false;
  });
}
function preToolUse(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const call = payload.toolCall || payload.tool_call || {};
  const toolName = String(call.name || payload.toolName || payload.tool_name || '');
  const args = call.args || call.arguments || {};
  const targets = extractToolTargets(toolName, args);
  const seenFile = runtimeFile(conv, 'seen');
  const resolveTargetPath = (rawTarget) => {
    if (path.isAbsolute(rawTarget)) return canonicalizePath(rawTarget);
    const found = roots.map((r) => path.resolve(r, rawTarget)).find((p) => fs.existsSync(p));
    if (found) return canonicalizePath(found);
    return canonicalizePath(roots[0] ? path.resolve(roots[0], rawTarget) : rawTarget);
  };

  if (/^(?:read|view)_/i.test(toolName)) {
    if (!targets.length) return {};
    const resolved = resolveTargetPath(targets[0]);
    const seen = readJson(seenFile) || { readFiles: [] };
    const list = Array.isArray(seen.readFiles) ? seen.readFiles : [];
    if (!list.includes(resolved)) {
      writeJson(seenFile, { readFiles: [...list.slice(-199), resolved], at: new Date().toISOString() });
    }
    return {};
  }

  const planning = activeStates(roots, PLANNING_MODES, conv);
  const autopilotStates = activeStates(roots, ['autopilot'], conv);
  const autopilotPlanning = autopilotStates.find((s) => PLANNING_MODES.includes(String(s.data.current_phase || '').toLowerCase()));
  const ralplanGate = autopilotStates.find((s) => s.data.ralplan_gate === true && !hasRalplanArtifacts(s.root));
  const s = planning[0] || autopilotPlanning || ralplanGate;

  // Fail closed when an explicit file-mutation tool has no recognizable target argument during active planning.
  if (!targets.length) {
    if (s && FILE_MUTATION_TOOLS_RE.test(toolName)) {
      return {
        decision: 'force_ask',
        reason: `oh-my-agy: ${s.mode} planning guard could not verify a target path for ${toolName}. Approve only if you intend to write outside .omagy/.`,
      };
    }
    return {};
  }

  const isFullOverwrite = /^(?:write_file|write_to_file)$/i.test(toolName)
    && (args.Overwrite === true || args.overwrite === true)
    && args.Append !== true && args.append !== true;

  // Notifications, Working Agreements ([by:human]), and Protected-Block guards run across ALL mutation tools & targets
  // BEFORE the .omagy/ / omagy_wiki/ planning exemption check.
  if (FILE_MUTATION_TOOLS_RE.test(toolName)) {
    for (const rawTarget of targets) {
      const targetResolved = resolveTargetPath(rawTarget);
      if (/(?:^|[/\\])(?:\.omagy|oh-my-agy)[/\\]notifications\.json$/i.test(targetResolved)) {
        return {
          decision: 'force_ask',
          reason: `oh-my-agy: notifications-guard — ${toolName} on ${targetResolved} modifies outbound notification webhooks or command settings. Approve explicitly if intended.`,
        };
      }
      let prevText = null;
      try {
        const st = fs.lstatSync(targetResolved);
        if (st.isFile() && !st.isSymbolicLink() && st.size <= 1024 * 1024) {
          prevText = fs.readFileSync(targetResolved, 'utf8');
        }
      } catch { /* fail open: file does not exist yet on disk */ }
      if (prevText === null) continue;

      if (/(?:^|[/\\])omagy_wiki[/\\]agreements\.md$/i.test(targetResolved)) {
        const humanLines = prevText.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim())
          .filter((l) => /(?:\[by:\s*human\]|\(by:\s*human\)|\bby:\s*human\b)/i.test(l));
        if (humanLines.length > 0) {
          const postEdit = reconstructPostEditContent(toolName, args, prevText, targetResolved, roots);
          if (typeof postEdit !== 'string') {
            return {
              decision: 'force_ask',
              reason: `oh-my-agy: agreements-guard — ${toolName} on ${targetResolved} would delete, move, or unverifiedly mutate human-authored agreements (${humanLines[0].slice(0, 80)}). Preserve [by:human] entries or approve explicitly.`,
            };
          }
          const postCounts = new Map();
          for (const pl of postEdit.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim())) {
            postCounts.set(pl, (postCounts.get(pl) || 0) + 1);
          }
          for (const hl of humanLines) {
            const rem = postCounts.get(hl) || 0;
            if (rem <= 0) {
              return {
                decision: 'force_ask',
                reason: `oh-my-agy: agreements-guard — ${toolName} on ${targetResolved} would remove or alter a human-authored agreement (${hl.slice(0, 80)}). Preserve [by:human] entries or approve explicitly.`,
              };
            }
            postCounts.set(hl, rem - 1);
          }
        }
      }

      const existingProtected = extractProtectedBlocks(prevText);
      if (existingProtected.length > 0) {
        const postEdit = reconstructPostEditContent(toolName, args, prevText, targetResolved, roots);
        const tampered = hasProtectedBlockTampering(prevText, postEdit);
        if (tampered.length > 0) {
          return {
            decision: 'force_ask',
            reason: `oh-my-agy: protected-block-guard — ${toolName} on ${targetResolved} would alter, move, or delete a protected ${tampered[0].kind} block (lines ${tampered[0].startLine}-${tampered[0].endLine}). Preserve protected blocks intact or approve explicitly.`,
          };
        }
      }
    }
  }

  const outsideTarget = targets.find((t) => !isPathInsideAllowedOmagy(roots, t));
  if (!outsideTarget) return {};
  const resolved = resolveTargetPath(outsideTarget);

  if (s) {
    const reason = ralplanGate && s === ralplanGate
      ? `oh-my-agy: autopilot ralplan_gate is active without .omagy/plans/prd-*.md and test-spec-*.md. Writing ${resolved} outside .omagy/ requires completing ralplan artifacts first or user approval.`
      : `oh-my-agy: ${s.mode} is in planning phase (${s.data.current_phase || 'unknown'}). ` +
        `Writing ${resolved} is implementation work outside .omagy/. Approve only if you intend to leave planning; ` +
        'otherwise finish the planning handoff or run $cancel.';
    return { decision: 'force_ask', reason };
  }

  // Write-existing-file guard:
  // Escalates full-file Overwrite on a non-empty existing code file that has not been read in this session.
  if (isFullOverwrite && CODE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    let existsNonEmpty = false;
    try {
      const st = fs.statSync(resolved);
      existsNonEmpty = st.isFile() && st.size > 0;
    } catch { /* fail open: file does not exist */ existsNonEmpty = false; }
    if (existsNonEmpty) {
      const seen = readJson(seenFile) || { readFiles: [] };
      const readList = Array.isArray(seen.readFiles) ? seen.readFiles : [];
      if (!readList.includes(resolved)) {
        return {
          decision: 'force_ask',
          reason: `oh-my-agy: write-existing-file-guard — Overwriting existing source file ${resolved} without reading it first in this session. Read the file first or use edit_file to avoid accidental code deletion, or approve to overwrite.`,
        };
      }
    }
  }
  return {};
}

async function stop(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const rawReason = String(payload.terminationReason ?? payload.termination_reason ?? 'NO_TOOL_CALL').trim().toLowerCase();
  const isNormalStop = NORMAL_STOP_REASONS.has(rawReason);
  const allow = { decision: 'stop' };

  let decision = allow;
  if (isNormalStop && payload.fullyIdle !== false && !payload.error) {
    const routingRec = readJson(runtimeFile(conv, 'routing')) || {};
    const isSubagent = Boolean(routingRec.isSubagent) || isSubagentPayload(payload);
    const active = activeStates(roots, CONTINUATION_MODES, conv)
      .filter((s) => !isSubagent || (conv && s.owner === String(conv)))
      .filter((s) => !isAwaitingConfirmation(s));
    const nudgeFile = runtimeFile(conv, 'nudge');
    if (active.length) {
      const s = active[0];
      const sig = `${s.file}|${s.data.updated_at || ''}|${s.mtimeMs}`;
      const rec = readJson(nudgeFile) || {};
      const count = rec.sig === sig ? Number(rec.count || 0) + 1 : 1;
      if (count <= MAX_NUDGES) {
        writeJson(nudgeFile, { sig, count, at: new Date().toISOString() });
        const d = s.data;
        decision = {
          decision: 'continue',
          reason: `[oh-my-agy] ${s.mode} is still active (phase: ${d.current_phase || 'unknown'}` +
            `${d.iteration ? `, iteration ${d.iteration}` : ''}) per ${s.file}. Proceed without asking whether to continue from current_phase under the ` +
            `${s.mode} skill contract and refresh updated_at as you progress. A permission denial or a refusal by the user is final for what that call was meant to do: never reach that result with another tool, command, path, or host — mark that task/goal blocked and ask the user. If the work is verified complete, write the ` +
            'state terminal (active:false, current_phase:"complete", completed_at). If you need the user, write ' +
            'current_phase:"blocked" with active:false and ask. To abandon the workflow, run $cancel.' +
            (count === MAX_NUDGES ? ' (Final automatic nudge: without a state update the next stop is allowed.)' : ''),
        };
      } else {
        writeJson(nudgeFile, { sig, count, exhausted: true, at: new Date().toISOString() });
      }
    } else {
      try { fs.rmSync(nudgeFile, { force: true }); } catch { /* ignore */ }
      const msg = lastAssistantMessage(payload);
      const justCompleted = roots.flatMap((r) => loadModeStates(r, conv)).some(
        (s) => !s.foreignOwner && String(s.data.current_phase || '').toLowerCase() === 'complete' && Date.now() - updatedMs(s) < 60 * 1000,
      );
      if (justCompleted || (msg && COMPLETION_CLAIM_RE.test(msg))) {
        const blockers = scanDiffBlockers(roots);
        if (blockers.length) {
          const driftFile = runtimeFile(conv, 'drift');
          const sig = blockers.map((b) => `${b.file}:${b.line}:${b.kind}`).join('|');
          const prev = readJson(driftFile) || {};
          if (prev.sig !== sig) {
            writeJson(driftFile, { sig, at: new Date().toISOString() });
            const summary = blockers.slice(0, 4).map((b) => `${b.file}:${b.line} (${b.kind})`).join(', ');
            decision = {
              decision: 'continue',
              reason: `[oh-my-agy] Completion drift guard: git diff still contains unfinished blocker pattern(s): ${summary}. ` +
                'Resolve or remove skipped/focused tests, placeholder TODO/stub implementations, unexempted checker suppressions (or document `-- <reason>` / `shortcut: <ceiling>, <upgrade>`), bare empty catches (or document `/* fail open: <reason> */`), and unauthorized protected-block edits before claiming completion.',
            };
          }
        }
      }
    }
  }

  if (decision.decision !== 'continue') {
    await notify(payload, roots).catch(() => {});
  }
  return decision;
}

// ---------- notifications ----------
export function loadNotificationConfig(roots, globalConfigPath = '') {
  const gPath = globalConfigPath || path.join(os.homedir(), '.gemini', 'config', 'oh-my-agy', 'notifications.json');
  const rawGlobal = readJson(gPath);
  const globalCfg = (rawGlobal && typeof rawGlobal === 'object' && !Array.isArray(rawGlobal)) ? rawGlobal : {};
  const globalCommand = (globalCfg.command && typeof globalCfg.command === 'object' && !Array.isArray(globalCfg.command))
    ? { ...globalCfg.command }
    : null;
  let cfg = { ...globalCfg };
  let localDisabledCommand = false;
  for (const r of roots) {
    const local = readJson(path.join(r, '.omagy', 'notifications.json'));
    if (local && typeof local === 'object' && !Array.isArray(local)) {
      if (local.command && typeof local.command === 'object' && local.command.enabled === false) {
        localDisabledCommand = true;
      }
      const { command: _ignoredLocalCommand, ...safeLocal } = local;
      cfg = { ...cfg, ...safeLocal };
    }
  }
  if (globalCommand) {
    cfg.command = localDisabledCommand ? { ...globalCommand, enabled: false } : globalCommand;
  } else {
    delete cfg.command;
  }
  return cfg;
}
export function isSafeNotificationUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch { /* fail open: reject malformed notification URL */
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::' || /^0+(?::0+)*:0*1$/.test(host) || /^0+(?::0+)+$/.test(host)) return false;
    if (/^fe[89ab][0-9a-f]*:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host) || host.startsWith('::ffff:')) return false;
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}
function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}
async function post(url, body, headers = {}, method = 'POST') {
  if (typeof fetch !== 'function' || !isSafeNotificationUrl(url)) return;
  await fetch(url, {
    method,
    redirect: 'error',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
}
async function notify(payload, roots) {
  const cfg = loadNotificationConfig(roots);
  if (cfg.enabled !== true) return;
  const conv = payload.conversationId || 'unknown';
  const cooldown = intOr(process.env.OMAGY_IDLE_COOLDOWN_SECONDS, intOr(cfg.idleCooldownSeconds, 60, 0), 0) * 1000;
  const recFile = runtimeFile(conv, 'notify');
  const rec = readJson(recFile) || {};
  if (rec.at && Date.now() - Date.parse(rec.at) < cooldown) return;

  const project = roots[0] ? path.basename(roots[0]) : 'unknown';
  const blocked = roots.flatMap(loadModeStates).find((s) => String(s.data.current_phase || '') === 'blocked' && s.data.active === false
    && Date.now() - updatedMs(s) < 10 * 60 * 1000);
  const event = payload.error ? 'error' : blocked ? 'needs-input' : 'session-idle';
  const events = Array.isArray(cfg.events) && cfg.events.length ? cfg.events : ['session-idle', 'needs-input', 'error'];
  if (!events.includes(event)) return;
  const message = `oh-my-agy [${event}] Antigravity agent stopped in ${project}` +
    (blocked ? ` — ${blocked.mode} is blocked waiting for you` : '') +
    (payload.error ? ` — error: ${redactSecrets(String(payload.error)).slice(0, 200)}` : '') + ` (conversation ${String(conv).slice(0, 8)})`;

  const jobs = [];
  if (cfg.slack?.enabled && cfg.slack.webhookUrl) jobs.push(post(cfg.slack.webhookUrl, { text: message }));
  if (cfg.discord?.enabled && cfg.discord.webhookUrl) jobs.push(post(cfg.discord.webhookUrl, { content: message }));
  if (cfg.telegram?.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    jobs.push(post(`https://api.telegram.org/bot${cfg.telegram.botToken}/sendMessage`, { chat_id: cfg.telegram.chatId, text: message }));
  }
  if (cfg.webhook?.enabled && cfg.webhook.url) {
    jobs.push(post(cfg.webhook.url, { event, message, project, projectPath: roots[0] || '', conversationId: conv },
      cfg.webhook.headers || {}, cfg.webhook.method === 'PUT' ? 'PUT' : 'POST'));
  }
  if (cfg.command?.enabled && cfg.command.command) {
    const cmd = String(cfg.command.command)
      .replaceAll('{{event}}', shellQuote(event))
      .replaceAll('{{message}}', shellQuote(message))
      .replaceAll('{{projectPath}}', shellQuote(roots[0] || ''))
      .replaceAll('{{conversationId}}', shellQuote(conv));
    try { spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
  }
  if (!jobs.length && !cfg.command?.enabled) return;
  await Promise.allSettled(jobs);
  writeJson(recFile, { at: new Date().toISOString(), event });
}

// ---------- selftest ----------
async function selftest() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
  const defaultTmpRuntime = path.join(os.tmpdir(), 'oh-my-agy');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-selftest-'));
  const prevRuntimeDir = process.env.OMAGY_RUNTIME_DIR;
  process.env.OMAGY_RUNTIME_DIR = path.join(ws, 'runtime');
  const conv = `selftest-${Date.now()}`;
  const base = { conversationId: conv, workspacePaths: [ws] };
  const stateFile = path.join(ws, '.omagy', 'state', 'autopilot-state.json');
  const now = new Date().toISOString();

  try {
    check('node >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.versions.node);
    check('fetch available (notifications)', typeof fetch === 'function');
    check('stop allows with no state', (await stop({ ...base, terminationReason: 'NO_TOOL_CALL' })).decision === 'stop');

    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ralplan', iteration: 1, updated_at: now });
    const s1 = await stop({ ...base, terminationReason: 'NO_TOOL_CALL' });
    const s2 = await stop({ ...base, terminationReason: 'model_stop' });
    const s3 = await stop({ ...base, terminationReason: 'NO_TOOL_CALL' });
    check('stop nudges active autopilot on NO_TOOL_CALL', s1.decision === 'continue', s1.reason?.slice(0, 80));
    check('stop nudges at most MAX_NUDGES without progress', s2.decision === 'continue' && s3.decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ultragoal', iteration: 2, updated_at: new Date(Date.now() + 1000).toISOString() });
    check('progress resets nudge budget', (await stop({ ...base, terminationReason: 'NO_TOOL_CALL' })).decision === 'continue');
    check('non-normal stop reason is never blocked', (await stop({ ...base, terminationReason: 'MAX_INVOCATIONS' })).decision === 'stop');
    check('background work pending is never blocked', (await stop({ ...base, terminationReason: 'NO_TOOL_CALL', fullyIdle: false })).decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ralplan', updated_at: new Date(Date.now() - STALE_MS - 60000).toISOString() });
    check('stale state is ignored', (await stop({ ...base, terminationReason: 'NO_TOOL_CALL' })).decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: false, current_phase: 'complete', completed_at: now, updated_at: now });
    check('terminal state is ignored', (await stop({ ...base, terminationReason: 'NO_TOOL_CALL' })).decision === 'stop');

    // Wiki index + Working Agreements bounded injection + routing test
    const wikiDir = path.join(ws, 'omagy_wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const longWiki = Array.from({ length: 80 }, (_, i) => `- [[page-${i}]] — Page ${i} — architecture — ${'x'.repeat(60)}`).join('\n');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), longWiki);
    fs.writeFileSync(path.join(wikiDir, 'agreements.md'), '- [v2] Never overwrite existing files without reading them first.\n');

    // Subdirectory AGENTS.md discovery fixture
    const subPkg = path.join(ws, 'packages', 'core');
    fs.mkdirSync(subPkg, { recursive: true });
    fs.writeFileSync(path.join(subPkg, 'AGENTS.md'), '# Core Package Rules\nKeep core zero-dependency.\n');
    fs.writeFileSync(path.join(subPkg, 'index.ts'), 'export const ok = true;\n');

    const transcript = path.join(ws, 'transcript.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'please $autopilot then $code-review and $handoff on packages/core/index.ts, not /plan or $nonexistent' })}\n`);
    const p1 = preInvocation({ ...base, transcriptPath: transcript, invocationNum: 1 });
    const stepTexts = (p1.injectSteps || []).map((s) => s.ephemeralMessage || '');
    const routeMsg = stepTexts[0] || '';
    const wikiMsg = stepTexts.find((t) => t.includes('Project Wiki index')) || '';
    const subdirMsg = stepTexts.find((t) => t.includes('Subdirectory AGENTS.md')) || '';
    check('pre-invocation routes $skills in order (including $handoff)', routeMsg.includes('$autopilot, $code-review, $handoff') && !routeMsg.includes('$plan') && !routeMsg.includes('nonexistent'), routeMsg.slice(0, 100));
    check('pre-invocation injects working agreements + bounded wiki index (<=3500 chars)', wikiMsg.includes('Working Agreements') && wikiMsg.length <= MAX_WIKI_CONTEXT_CHARS && wikiMsg.includes('Wiki index truncated'), `len=${wikiMsg.length}`);
    check('pre-invocation discovers subdirectory AGENTS.md on touched path', subdirMsg.includes('packages/core/AGENTS.md') && subdirMsg.includes('Keep core zero-dependency'));
    check('pre-invocation injects once per user message', Object.keys(preInvocation({ ...base, transcriptPath: transcript, invocationNum: 2 })).length === 0);

    // Next user message should not re-inject wiki index or already-seen subdirectory AGENTS.md in the same session
    fs.appendFileSync(transcript, `${JSON.stringify({ step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'now $analyze packages/core/index.ts' })}\n`);
    const p2 = preInvocation({ ...base, transcriptPath: transcript, invocationNum: 3 });
    const p2Texts = (p2.injectSteps || []).map((s) => s.ephemeralMessage || '');
    check('wiki index and subdirectory AGENTS.md inject at most once per conversation', p2Texts.some((t) => t.includes('$analyze')) && !p2Texts.some((t) => t.includes('Project Wiki index')) && !p2Texts.some((t) => t.includes('Subdirectory AGENTS.md')));

    writeJson(path.join(ws, '.omagy', 'state', 'ralplan-state.json'), { mode: 'ralplan', active: true, current_phase: 'architect-review', updated_at: new Date().toISOString() });
    const g1 = preToolUse({ ...base, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(ws, 'src', 'index.ts') } } });
    const g1Path = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: path.join(ws, 'src', 'index.ts') } } });
    const g2 = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: path.join(ws, '.omagy', 'plans', 'prd.md') } } });
    check('planning guard escalates implementation writes (TargetFile & Path)', g1.decision === 'force_ask' && g1Path.decision === 'force_ask');
    check('planning guard ignores .omagy writes', !g2.decision);

    // Ralplan-first gate inside autopilot
    fs.rmSync(path.join(ws, '.omagy', 'state', 'ralplan-state.json'), { force: true });
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ultragoal', ralplan_gate: true, updated_at: new Date().toISOString() });
    const gRalplanMissing = preToolUse({ ...base, toolCall: { name: 'edit_file', args: { Path: path.join(ws, 'src', 'index.ts') } } });
    fs.mkdirSync(path.join(ws, '.omagy', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.omagy', 'plans', 'prd-demo.md'), '# PRD\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'plans', 'test-spec-demo.md'), '# Test Spec\n');
    const gRalplanPresent = preToolUse({ ...base, toolCall: { name: 'edit_file', args: { Path: path.join(ws, 'src', 'index.ts') } } });
    check('autopilot ralplan_gate blocks writes until prd + test-spec exist', gRalplanMissing.decision === 'force_ask' && !gRalplanPresent.decision);

    // Write-existing-file guard (unread full Overwrite vs read-then-overwrite)
    writeJson(stateFile, { mode: 'autopilot', active: false, current_phase: 'complete', completed_at: now, updated_at: now });
    const existingSrc = path.join(ws, 'src', 'existing.ts');
    fs.mkdirSync(path.dirname(existingSrc), { recursive: true });
    fs.writeFileSync(existingSrc, 'export const v = 1;\n');
    const gOverwriteUnread = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: existingSrc, Overwrite: true } } });
    preToolUse({ ...base, toolCall: { name: 'read_file', args: { Path: existingSrc } } });
    const gOverwriteAfterRead = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: existingSrc, Overwrite: true } } });
    check('write-existing-file-guard escalates unread Overwrite and allows after read_file', gOverwriteUnread.decision === 'force_ask' && !gOverwriteAfterRead.decision);

    // Foreign conversation owner isolation
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ultragoal', owner_conversation_id: 'other-conv', updated_at: new Date().toISOString() });
    const sForeign = await stop({ ...base, terminationReason: 'NO_TOOL_CALL' });
    check('foreign owner_conversation_id does not hijack stop hook', sForeign.decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: false, current_phase: 'complete', completed_at: now, updated_at: now });

    // Multi-repo .omagy-workspace parent root resolution
    const multiParent = path.join(ws, 'multi');
    const childRepo = path.join(multiParent, 'repo-a');
    fs.mkdirSync(childRepo, { recursive: true });
    fs.writeFileSync(path.join(multiParent, '.omagy-workspace'), '{}\n');
    writeJson(path.join(multiParent, '.omagy', 'state', 'ultragoal-state.json'), { mode: 'ultragoal', active: true, current_phase: 'executing', updated_at: new Date().toISOString() });
    const sMulti = await stop({ conversationId: `${conv}-multi`, workspacePaths: [childRepo], terminationReason: 'NO_TOOL_CALL' });
    fs.rmSync(multiParent, { recursive: true, force: true });
    check('.omagy-workspace anchors state across child repos', sMulti.decision === 'continue');

    const initTestGit = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'selftest@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Selftest'], { cwd: dir });
    };

    // Completion drift guard (git diff blocker scan)
    const gitRepo = path.join(ws, 'git-repo');
    try {
      initTestGit(gitRepo);
      fs.writeFileSync(path.join(gitRepo, 'app.test.js'), 'test("ok", () => {});\n');
      execFileSync('git', ['add', 'app.test.js'], { cwd: gitRepo });
      execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'], { cwd: gitRepo });
      fs.appendFileSync(path.join(gitRepo, 'app.test.js'), `${'test'}.skip("later", () => {});\n`);
      const driftPayload = { conversationId: `${conv}-drift`, workspacePaths: [gitRepo], terminationReason: 'NO_TOOL_CALL', lastAssistantMessage: 'All done and ready to merge.' };
      const d1 = await stop(driftPayload);
      const d2 = await stop(driftPayload);
      check('completion drift guard catches added test.skip once per diff', d1.decision === 'continue' && d2.decision === 'stop');
    } catch { /* fail open: skip git drift check if git unavailable */
      check('completion drift guard catches added test.skip once per diff', true, 'skipped (git unavailable)');
    }

    // Team completion evidence validator test
    const evRel = '.omagy/evidence/task-1.json';
    writeJson(path.join(ws, evRel), { team: 'alpha', taskId: '1', summary: 'Implemented CSV parser and unit tests', verification: [{ command: 'npm test', result: 'passed', output: '12 passing (45ms)' }], unverified: [] });
    let evOk = false;
    try { evOk = validateCompletionEvidence(ws, evRel, { team: 'alpha', taskId: '1' }).ok === true; } catch { /* fail open: evOk remains false */ }
    check('verify-evidence accepts valid team task evidence', evOk);

    const badRel = '.omagy/evidence/task-bad.json';
    writeJson(path.join(ws, badRel), { team: 'alpha', taskId: '1', summary: 'TODO', verification: [{ command: 'npm test', result: 'failed', output: '1 failing' }], unverified: [] });
    let badRejected = false;
    try { validateCompletionEvidence(ws, badRel, { team: 'alpha', taskId: '1' }); } catch { /* fail open: expected validation throw */ badRejected = true; }
    check('verify-evidence rejects placeholder or failing evidence', badRejected);

    const filteredRoots = workspaceRoots({ workspacePaths: [path.join(ws, 'does-not-exist'), ws] });
    check('workspaceRoots filters non-existent directories', filteredRoots.length === 1 && filteredRoots[0] === ws);

    // Subagent prompt & hook isolation
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ultragoal', updated_at: new Date().toISOString() });
    const subTranscript = path.join(ws, 'subagent-transcript.jsonl');
    fs.writeFileSync(subTranscript, `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'TEAM alpha — TASK 1: audit $autopilot and $cancel behavior' })}\n`);
    const subPre = preInvocation({ conversationId: `${conv}-sub`, workspacePaths: [ws], transcriptPath: subTranscript, invocationNum: 1 });
    const subPreTexts = (subPre.injectSteps || []).map((s) => s.ephemeralMessage || '');
    const subStop = await stop({ conversationId: `${conv}-sub`, workspacePaths: [ws], terminationReason: 'NO_TOOL_CALL' });
    check('subagent prompt suppresses quoted $skill routing and unowned parent stop nudges', !subPreTexts.some((t) => t.includes('Skill routing')) && subStop.decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: false, current_phase: 'complete', completed_at: now, updated_at: now });

    // Symlink state & planning-guard escape protection
    const symTargetState = path.join(ws, 'outside-state.json');
    writeJson(symTargetState, { mode: 'autopilot', active: true, current_phase: 'ultragoal', updated_at: new Date().toISOString() });
    const symStateLink = path.join(ws, '.omagy', 'state', 'symlinked-state.json');
    fs.symlinkSync(symTargetState, symStateLink, 'file');
    const sSym = await stop({ conversationId: `${conv}-sym`, workspacePaths: [ws], terminationReason: 'NO_TOOL_CALL' });
    fs.rmSync(symStateLink, { force: true });
    check('readStateDir ignores symlinked state files', sSym.decision === 'stop');

    writeJson(path.join(ws, '.omagy', 'state', 'plan-state.json'), { mode: 'plan', active: true, current_phase: 'drafting', updated_at: new Date().toISOString() });
    const symInsideOmagy = path.join(ws, '.omagy', 'plans', 'escape-link.ts');
    fs.symlinkSync(path.join(ws, 'src', 'secret.ts'), symInsideOmagy, 'file');
    const gSymEscape = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: symInsideOmagy } } });
    fs.rmSync(symInsideOmagy, { force: true });
    fs.rmSync(path.join(ws, '.omagy', 'state', 'plan-state.json'), { force: true });
    check('preToolUse refuses symlink inside .omagy/ escaping to source file during planning', gSymEscape.decision === 'force_ask');

    // Crash-resilient newline-isolated JSONL append & tolerant reader
    const ledgerPath = path.join(ws, '.omagy', 'ultragoal', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, '{"goal_id":"G1","event":"started"}\n{"goal_id":"G1","event":"torn');
    const appRes = appendJsonlRecord(ledgerPath, { goal_id: 'G1', event: 'checkpoint', status: 'complete' });
    const readRes = readJsonlRecords(ledgerPath);
    check('appendJsonlRecord isolates torn tail with newline and readJsonlRecords recovers valid entries', appRes.isolatedNewline === true && readRes.records.length === 2 && readRes.skipped === 1);

    // Whole-integer env/config parser
    check('intOr validates whole safe integers and falls back on empty/negative/float/Infinity/NaN',
      intOr('120', 60) === 120 && intOr('0', 60, 0) === 0 && ['0', '', '-5', '1.5', 'Infinity', '60s'].every((v, idx) => intOr(v, 60, idx === 0 ? 1 : 0) === 60));

    // OMAGY_ROOT / OMAGY_STATE_ROOT override & omagyLogsDir
    const customStateRoot = path.join(ws, 'custom-omagy-root');
    fs.mkdirSync(customStateRoot, { recursive: true });
    process.env.OMAGY_STATE_ROOT = path.join(customStateRoot, '.omagy');
    const resolvedLogs = omagyLogsDir(ws);
    delete process.env.OMAGY_STATE_ROOT;
    check('OMAGY_STATE_ROOT overrides stateRoot and omagyLogsDir', resolvedLogs === path.join(canonicalizePath(customStateRoot), '.omagy', 'logs'));

    // detectSkills quote/code/blockquote/URL/negated/help-question suppression
    const suppressedSkills = detectSkills('What does `$autopilot` or "$ralplan" do?\n> $team\n[a -> b] $ultragoal\ndo not use $ultraqa or https://example.com/$plan');
    const preservedLead = detectSkills('$ralplan: design the API using ```js\nconst s = "$team";\n``` and do not use $autopilot');
    const suppressedLeadHelp = detectSkills('$ralplan: how do I use this skill?');
    check('detectSkills suppresses quoted/code/negated/help mentions while preserving leading invocation',
      suppressedSkills.length === 0 && preservedLead.length === 1 && preservedLead[0] === 'ralplan' && suppressedLeadHelp.length === 0);

    // Child-project omagy_wiki discovery
    const childPkgWiki = path.join(ws, 'packages', 'billing', 'omagy_wiki');
    fs.mkdirSync(childPkgWiki, { recursive: true });
    fs.writeFileSync(path.join(childPkgWiki, 'agreements.md'), '- [by:human] All billing amounts use integer cents.\n');
    const childDisc = discoverSubdirAgents([ws], 'inspect packages/billing/src/charge.ts', []);
    check('discoverSubdirAgents surfaces child-project omagy_wiki once', childDisc.messages.some((m) => m.includes('Child-project Wiki') && m.includes('integer cents')));

    // Planning guard multi-target (rename / apply_patch) & fail-closed on missing target
    writeJson(path.join(ws, '.omagy', 'state', 'plan-state.json'), { mode: 'plan', active: true, current_phase: 'drafting', updated_at: new Date().toISOString() });
    const gRenameEscape = preToolUse({ ...base, toolCall: { name: 'edit_file', args: { Path: path.join(ws, '.omagy', 'plans', 'draft.md'), rename: path.join(ws, 'src', 'escaped.ts') } } });
    const gPatchEscape = preToolUse({ ...base, toolCall: { name: 'apply_patch', args: { patchText: `*** Update File: ${path.join(ws, 'src', 'index.ts')}\n@@\n` } } });
    const gMissingTarget = preToolUse({ ...base, toolCall: { name: 'write_file', args: {} } });
    fs.rmSync(path.join(ws, '.omagy', 'state', 'plan-state.json'), { force: true });
    check('planning guard catches rename/apply_patch escapes and fails closed on targetless write_file',
      gRenameEscape.decision === 'force_ask' && gPatchEscape.decision === 'force_ask' && gMissingTarget.decision === 'force_ask');

    // Working Agreements [by:human] overwrite protection
    const agFile = path.join(ws, 'omagy_wiki', 'agreements.md');
    fs.writeFileSync(agFile, '- [by:human] Never mutate production tables directly.\n');
    const gDropHuman = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: agFile, Overwrite: true, Content: '- [v2] Only automated rule.\n' } } });
    const gKeepHuman = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: agFile, Overwrite: true, Content: '- [by:human] Never mutate production tables directly.\n- [v2] Added rule.\n' } } });
    check('agreements-guard blocks Overwrite dropping [by:human] line and allows preserving it', gDropHuman.decision === 'force_ask' && !gKeepHuman.decision);

    // Stop continuation includes refusal-is-final rule
    check('stop continuation prompt includes refusal-is-final rule', typeof s1.reason === 'string' && s1.reason.includes('permission denial or a refusal by the user is final'));

    // Echo / printf / true no-op verification command guard
    const echoRel = '.omagy/evidence/task-echo.json';
    writeJson(path.join(ws, echoRel), { team: 'alpha', taskId: '1', summary: 'Implemented feature', verification: [{ command: 'echo "all tests passed"', result: 'passed', output: 'all tests passed' }], unverified: [] });
    let echoRejected = false;
    try { validateCompletionEvidence(ws, echoRel, { team: 'alpha', taskId: '1' }); } catch { /* fail open: expected validation throw */ echoRejected = true; }
    check('verify-evidence rejects echo/printf/true no-op verification commands', echoRejected && !isRealVerificationCommand('env FOO=1 echo ok') && isRealVerificationCommand('env NODE_ENV=test npm test'));

    // Time-boxed wiki/agreement expiry & standalone secret redaction
    const expWikiRoot = path.join(ws, 'exp-wiki-ws');
    const expWikiDir = path.join(expWikiRoot, 'omagy_wiki');
    fs.mkdirSync(expWikiDir, { recursive: true });
    fs.writeFileSync(path.join(expWikiDir, 'agreements.md'), '- [by:human] Keep active rule [expires: 2099-01-01] with token ghp_1234567890abcdefghij123456.\n- [by:agent] Old temporary freeze [expires: 2020-01-01].');
    fs.writeFileSync(path.join(expWikiDir, 'index.md'), '---\nexpires: 2020-01-01T00:00:00Z\n---\n- [[old-page]] — Expired index\n');
    const expSummary = loadWikiSummary([expWikiRoot]) || '';
    check('loadWikiSummary skips expired frontmatter/inline entries and redacts standalone secrets',
      expSummary.includes('Keep active rule') && expSummary.includes('[REDACTED_TOKEN]') && !expSummary.includes('ghp_1234567890abcdefghij123456') && !expSummary.includes('Old temporary freeze') && !expSummary.includes('Expired index'));

    // Child-project wiki expiry & secret redaction
    const childExpDir = path.join(expWikiRoot, 'packages', 'auth', 'omagy_wiki');
    fs.mkdirSync(childExpDir, { recursive: true });
    fs.writeFileSync(path.join(childExpDir, 'agreements.md'), '- Active auth rule sk-proj-1234567890abcdefghijklmnop\n- Expired auth rule (expires: 2021-05-01)\n');
    const childExpMsg = discoverSubdirAgents([expWikiRoot], 'check packages/auth/login.ts', []).messages[0] || '';
    check('discoverSubdirAgents skips expired child-wiki entries and redacts standalone secrets',
      childExpMsg.includes('[REDACTED_KEY]') && !childExpMsg.includes('sk-proj-1234567890') && !childExpMsg.includes('Expired auth rule'));

    // Configurable Custom Quality Gates validator
    const qgRoot = path.join(ws, 'qg-ws');
    fs.mkdirSync(path.join(qgRoot, '.omagy'), { recursive: true });
    const qgNoop = validateQualityGates(qgRoot, 'ralplan');
    writeJson(path.join(qgRoot, '.omagy', 'config.json'), { qualityGates: { ralplan: ['better-interface', { skill: '$security-audit', mode: 'advisory', model: 'pro' }] } });
    const qgValid = validateQualityGates(qgRoot, 'ralplan');
    check('validateQualityGates returns strict no-op when unconfigured and normalizes valid gates',
      qgNoop.ok === true && qgNoop.gates.length === 0 && qgValid.ok === true && qgValid.gates.length === 2
      && qgValid.gates[0].skill === 'better-interface' && qgValid.gates[0].mode === 'blocking'
      && qgValid.gates[1].skill === 'security-audit' && qgValid.gates[1].mode === 'advisory' && qgValid.gates[1].model === 'pro');

    writeJson(path.join(qgRoot, '.omagy', 'config.json'), { qualityGates: { ralplan: ['ralplan', 'ralph'], review: ['security-audit'] } });
    const qgInvalid = validateQualityGates(qgRoot);
    check('validateQualityGates rejects self-recursive controller skills, sunset skills, and legacy stage keys', qgInvalid.ok === false && qgInvalid.errors.length === 3);

    // Verify hooks.json PreToolUse matcher covers Antigravity 2.0 write/edit/patch/read tools
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const hooksCfg = readJson(path.join(pluginRoot, 'hooks.json')) || {};
    const matcherStr = hooksCfg['oh-my-agy-planning-guard']?.PreToolUse?.[0]?.matcher || '';
    const matcherRe = matcherStr ? new RegExp(`^(?:${matcherStr})$`) : null;
    check('hooks.json PreToolUse matcher covers write_file, edit_file, apply_patch, read_file, and legacy tools',
      Boolean(matcherRe && ['write_file', 'write_to_file', 'edit_file', 'replace_file_content', 'apply_patch', 'patch', 'read_file', 'view_file'].every((t) => matcherRe.test(t))));

    // Verify sidecars/hud/sidecar.json declares a single AUX_PANE web UI view (so Extensions menu shows one HUD item)
    const sidecarCfg = readJson(path.join(pluginRoot, 'sidecars', 'hud', 'sidecar.json')) || {};
    const auxViews = (sidecarCfg.ui_config?.views || []).filter((v) => v && v.entrypoint === 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');
    check('sidecars/hud/sidecar.json declares single AUX_PANE web UI view for sidecar://oh-my-agy/hud/',
      sidecarCfg.has_web_ui === true && auxViews.length === 1 && auxViews[0].path === '/', `views=${auxViews.length}`);

    // T1 & T2: buildReviewPackage valid commit range and empty/non-ancestor exitCode 3
    const revRoot = path.join(ws, 'rev-ws');
    let revValid = { ok: false }; let pkgBody = ''; let revEmpty = { ok: true }; let revNonAncestor = { ok: true }; let revErr = '';
    try {
      initTestGit(revRoot);
      fs.writeFileSync(path.join(revRoot, 'sample.txt'), 'line1\nline2\n', 'utf8');
      execFileSync('git', ['add', 'sample.txt'], { cwd: revRoot });
      execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat: initial commit'], { cwd: revRoot });
      const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: revRoot, encoding: 'utf8' }).trim();
      fs.writeFileSync(path.join(revRoot, 'sample.txt'), 'line1\nline2-updated\nline3\n', 'utf8');
      execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-am', 'fix: update sample'], { cwd: revRoot });
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: revRoot, encoding: 'utf8' }).trim();
      const pkgOutPath = path.join(revRoot, '.omagy', 'artifacts', 'reviews', 'pkg.md');
      revValid = buildReviewPackage(revRoot, baseSha, headSha, pkgOutPath);
      pkgBody = fs.existsSync(pkgOutPath) ? fs.readFileSync(pkgOutPath, 'utf8') : '';
      revEmpty = buildReviewPackage(revRoot, headSha, headSha, path.join(revRoot, 'empty.md'));
      revNonAncestor = buildReviewPackage(revRoot, headSha, baseSha, path.join(revRoot, 'nonanc.md'));
    } catch (e) { /* fail open: capture T1/T2 error */ revErr = e instanceof Error ? e.message : String(e); }
    check('buildReviewPackage writes commit log, diffstat, and -U10 diff for valid commit range',
      revValid.ok === true && revValid.exitCode === 0 && revValid.commits === 1
      && ['=== Commits (', '=== Diffstat ===', '=== Diff (-U10) ===', '+line2-updated'].every((s) => pkgBody.includes(s)), revErr);
    check('buildReviewPackage rejects 0-commit and non-ancestor ranges with exitCode 3',
      revEmpty.ok === false && revEmpty.exitCode === 3 && revNonAncestor.ok === false && revNonAncestor.exitCode === 3, revErr);

    // T3: extractGoalBrief on goals.json and fence-aware markdown plans
    const briefGoalsPath = path.join(ws, 'brief-goals.json');
    writeJson(briefGoalsPath, { objective: 'Test objective', invariants: ['Invariant A'], goals: [
      { id: 'G1', title: 'First Goal', objective: 'Do G1', rigor: 'light', acceptance: ['A1'] },
      { id: 'G2', title: 'Second Goal', objective: 'Do G2', rigor: 'heavy', depends_on: ['G1'], acceptance: ['A2'] },
    ] });
    const briefMdPath = path.join(ws, 'brief-plan.md');
    fs.writeFileSync(briefMdPath, '# Plan\n### Task 1: First Task\nExample inside fence:\n```markdown\n### Task 2: Fake Task Inside Fence\nDo not match this.\n```\nStill in Task 1.\n### Task 2: Real Second Task\n- File: `src/real.js`\n- Verify: `npm test`\n### Task 3: Third Task\nEnd.', 'utf8');
    const jsonBriefRes = extractGoalBrief(briefGoalsPath, 'G2', path.join(ws, 'out-g2.md'));
    const jsonBriefText = fs.existsSync(path.join(ws, 'out-g2.md')) ? fs.readFileSync(path.join(ws, 'out-g2.md'), 'utf8') : '';
    const mdBriefRes = extractGoalBrief(briefMdPath, '2', path.join(ws, 'out-t2.md'));
    const mdBriefText = fs.existsSync(path.join(ws, 'out-t2.md')) ? fs.readFileSync(path.join(ws, 'out-t2.md'), 'utf8') : '';
    check('extractGoalBrief extracts goals.json entries and fence-aware markdown Task sections',
      jsonBriefRes.ok === true && jsonBriefRes.exitCode === 0 && jsonBriefText.includes('Goal G2: Second Goal')
      && mdBriefRes.ok === true && mdBriefRes.exitCode === 0 && mdBriefText.startsWith('### Task 2: Real Second Task')
      && !mdBriefText.includes('Fake Task Inside Fence') && !mdBriefText.includes('### Task 3'));

    // T4: sessionStart and preInvocation persist transcriptPath & artifactDirectoryPath and route lastUserInput fallback
    sessionStart({ conversationId: conv, workspaceUris: [ws], transcriptPath: '/tmp/selftest-t1.jsonl', artifactDirectoryPath: '/tmp/selftest-artifacts' });
    const rtAfterStart = readJson(runtimeFile(conv, 'routing')) || {};
    preInvocation({ conversationId: conv, workspaceUris: [ws], lastUserInput: 'plain prompt without skills', transcript_path: '/tmp/selftest-t2.jsonl' });
    const rtAfterPlain = readJson(runtimeFile(conv, 'routing')) || {};
    const pDirectSkill = preInvocation({ conversationId: conv, workspaceUris: [ws], lastUserInput: '$plan update docs' });
    const rtAfterSkill = readJson(runtimeFile(conv, 'routing')) || {};
    const directSkillText = (pDirectSkill.injectSteps || []).map((s) => s.ephemeralMessage || '').join('\n');
    check('sessionStart and preInvocation persist transcriptPath/artifactDirectoryPath and route lastUserInput fallback',
      rtAfterStart.transcriptPath === '/tmp/selftest-t1.jsonl' && rtAfterStart.artifactDirectoryPath === '/tmp/selftest-artifacts'
      && rtAfterPlain.transcriptPath === '/tmp/selftest-t2.jsonl' && rtAfterSkill.transcriptPath === '/tmp/selftest-t2.jsonl'
      && rtAfterSkill.artifactDirectoryPath === '/tmp/selftest-artifacts' && directSkillText.includes('$plan'));

    // T5: plugin.json strict JSON, official 10-key Antigravity schema allowlist, <=160 char description, CHANGELOG version sync, and logo PNG dimensions
    let strictPkg = null;
    try { strictPkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')); } catch { /* fail open: strictPkg stays null */ }
    const ALLOWED_PLUGIN_KEYS = new Set(['name', 'description', 'logo', 'suggestedPrompts', 'displayName', 'version', 'author', 'homepage', 'repository', 'disabled']);
    const unknownPluginKeys = strictPkg ? Object.keys(strictPkg).filter((k) => !ALLOWED_PLUGIN_KEYS.has(k)) : ['invalid'];
    const promptsOk = Array.isArray(strictPkg?.suggestedPrompts) && strictPkg.suggestedPrompts.length >= 1 && strictPkg.suggestedPrompts.length <= 3
      && strictPkg.suggestedPrompts.every((p) => typeof p === 'string' && p.trim().length > 0);
    const topChangelogVer = (fs.readFileSync(path.join(pluginRoot, 'CHANGELOG.md'), 'utf8').match(/^##\s+([0-9]+\.[0-9]+\.[0-9]+)/m) || [])[1] || '';
    let logoBuf = Buffer.alloc(0);
    try { logoBuf = fs.readFileSync(path.join(pluginRoot, 'assets', 'logo.png')); } catch { /* fail open: logoBuf stays empty */ }
    const isPng = logoBuf.length >= 24 && logoBuf[0] === 0x89 && logoBuf[1] === 0x50 && logoBuf[2] === 0x4e && logoBuf[3] === 0x47 && logoBuf.toString('ascii', 12, 16) === 'IHDR';
    const logoWidth = isPng ? logoBuf.readUInt32BE(16) : 0;
    const logoHeight = isPng ? logoBuf.readUInt32BE(20) : 0;
    check('plugin.json is strict JSON matching official Antigravity schema (<=160 char description, version synced with CHANGELOG) and logo.png is square >=128px',
      Boolean(strictPkg && strictPkg.name === 'oh-my-agy' && unknownPluginKeys.length === 0 && promptsOk
        && typeof strictPkg.description === 'string' && strictPkg.description.length > 0 && strictPkg.description.length <= 160
        && strictPkg.version && strictPkg.version === topChangelogVer && isPng && logoWidth === logoHeight && logoWidth >= 128),
      `ver=${strictPkg?.version || 'none'} changelog=${topChangelogVer} descLen=${strictPkg?.description?.length || 0} unknownKeys=${unknownPluginKeys.join(',')} logo=${logoWidth}x${logoHeight}`);

    const { validateFrontmatterYaml, validateReferenceLinks, runColdSelftestChecks, runG1SelftestChecks } = await import('./omagy-cli.mjs');

    // T6: All 27 skills/*/SKILL.md match SKILLS bidirectionally, <20,000 bytes, valid YAML frontmatter without ->, zero empty subdirs/dev files, and valid relative .md#anchor links
    const skillsDir = path.join(pluginRoot, 'skills');
    let skillsParity = false;
    const skillIssues = [];
    let diskSkillCount = 0;
    try {
      const diskSkillDirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      diskSkillCount = diskSkillDirs.length;
      const expectedSkills = [...SKILLS].sort();
      skillsParity = diskSkillDirs.length === expectedSkills.length && diskSkillDirs.every((d, i) => d === expectedSkills[i]);
      const checkSkillSubdirs = (baseDir, relPrefix) => {
        for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
          const fullEnt = path.join(baseDir, ent.name);
          const relEnt = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
          if (ent.name === 'CREATION-LOG.md' || /^test-.*\.md$/i.test(ent.name)) {
            skillIssues.push(`${relEnt}:dev-file`);
          }
          if (ent.isDirectory()) {
            const subItems = fs.readdirSync(fullEnt);
            if (subItems.length === 0) skillIssues.push(`${relEnt}:empty-subdir`);
            else checkSkillSubdirs(fullEnt, relEnt);
          }
        }
      };
      for (const dirName of diskSkillDirs) {
        const skillDirFull = path.join(skillsDir, dirName);
        const skillFile = path.join(skillDirFull, 'SKILL.md');
        if (!fs.existsSync(skillFile)) { skillIssues.push(`${dirName}:missing`); continue; }
        const stat = fs.statSync(skillFile);
        if (stat.size >= 20000) skillIssues.push(`${dirName}:size=${stat.size}`);
        const raw = fs.readFileSync(skillFile, 'utf8');
        const fmRes = validateFrontmatterYaml(raw, ['name', 'description'], ['name', 'description']);
        if (!fmRes.ok) {
          skillIssues.push(`${dirName}:yaml=${fmRes.errors.join('|')}`);
          continue;
        }
        const fmName = fmRes.fields.name || '';
        const fmDesc = fmRes.fields.description || '';
        if (fmName !== dirName) skillIssues.push(`${dirName}:name=${fmName}`);
        if (!fmDesc || fmDesc.includes('->')) skillIssues.push(`${dirName}:sdo-arrow`);
        checkSkillSubdirs(skillDirFull, dirName);
      }
      const refLinkRes = validateReferenceLinks(skillsDir);
      if (!refLinkRes.ok) skillIssues.push(...refLinkRes.errors);
    } catch (e) {
      skillIssues.push(e instanceof Error ? e.message : String(e));
    }
    check('all 27 skills/*/SKILL.md match SKILLS, are <20KB, have valid SDO YAML frontmatter without ->, resolve relative .md#anchor links, and have no empty subdirs or dev files',
      skillsParity && skillIssues.length === 0,
      skillIssues.join(', ') || `count=${diskSkillCount}`);

    // T7: rules/AGENTS.md <24KB, omagy-hook.mjs <235KB (zero static omagy-cli import), omagy-cli.mjs <100KB, all 18 agents/*.md valid YAML frontmatter + <antigravity_runtime>, and zero personal path leaks
    const rulesPath = path.join(pluginRoot, 'rules', 'AGENTS.md');
    const hookSelfPath = path.join(pluginRoot, 'hooks', 'omagy-hook.mjs');
    const cliSelfPath = path.join(pluginRoot, 'hooks', 'omagy-cli.mjs');
    let rulesSize = Infinity;
    let hookByteSize = Infinity;
    let cliByteSize = Infinity;
    let zeroStaticCliImport = false;
    let agentCount = 0;
    const agentIssues = [];
    const pathLeaks = [];
    try {
      const rulesRaw = fs.readFileSync(rulesPath, 'utf8');
      rulesSize = Buffer.byteLength(rulesRaw, 'utf8');
      if (/^---\r?\n/.test(rulesRaw)) agentIssues.push('AGENTS.md:unexpected-frontmatter');
      const hookSelfRaw = fs.readFileSync(hookSelfPath, 'utf8');
      hookByteSize = Buffer.byteLength(hookSelfRaw, 'utf8');
      cliByteSize = fs.statSync(cliSelfPath).size;
      zeroStaticCliImport = !/^\s*import\s+(?!\()[^;\r\n]*['"]\.\/omagy-cli\.mjs['"]/m.test(hookSelfRaw);
      const agentsDir = path.join(pluginRoot, 'agents');
      const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
      agentCount = agentFiles.length;
      for (const af of agentFiles) {
        const raw = fs.readFileSync(path.join(agentsDir, af), 'utf8');
        const fmRes = validateFrontmatterYaml(raw, ['name', 'description'], ['name', 'description']);
        if (!fmRes.ok) agentIssues.push(`${af}:yaml=${fmRes.errors.join('|')}`);
        if (!raw.includes('<antigravity_runtime>')) agentIssues.push(`${af}:no-runtime-tag`);
      }
      const leakRe = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
      const scanMarkdownDir = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) scanMarkdownDir(full);
          else if (entry.isFile() && entry.name.endsWith('.md')) {
            const text = fs.readFileSync(full, 'utf8');
            if (leakRe.test(text)) pathLeaks.push(path.relative(pluginRoot, full));
          }
        }
      };
      scanMarkdownDir(path.join(pluginRoot, 'rules'));
      scanMarkdownDir(path.join(pluginRoot, 'skills'));
      scanMarkdownDir(path.join(pluginRoot, 'agents'));
    } catch (e) {
      agentIssues.push(e instanceof Error ? e.message : String(e));
    }
    check('rules/AGENTS.md <24KB, omagy-hook.mjs <235KB (zero static cli import), omagy-cli.mjs <100KB, all 18 agents/*.md valid, and zero personal path leaks',
      rulesSize < 24000
      && hookByteSize < 235000
      && cliByteSize < 100000
      && zeroStaticCliImport
      && agentCount === 18
      && agentIssues.length === 0
      && pathLeaks.length === 0,
      `rules=${rulesSize} hook=${hookByteSize} cli=${cliByteSize} staticFree=${zeroStaticCliImport} agents=${agentCount} issues=${agentIssues.join(';')} leaks=${pathLeaks.join(';')}`);

    // T8: hooks/run.sh and sidecars/hud/run.sh avoid external dirname and sort -V, fail-closed CLI vs fail-open lifecycle node_not_found, sameModulePath symlink invocation, and skill-eval defaultRoot isolation
    const hooksRunSh = fs.readFileSync(path.join(pluginRoot, 'hooks', 'run.sh'), 'utf8');
    const hudRunSh = fs.readFileSync(path.join(pluginRoot, 'sidecars', 'hud', 'run.sh'), 'utf8');
    let minimalPathOk = false;
    let runShFailModesOk = false;
    let symlinkMainOk = false;
    let userSkillsCwdEvalOk = false;
    try {
      const isWin = process.platform === 'win32';
      const shBin = isWin ? 'sh' : '/bin/sh';
      const runShPath = path.join(pluginRoot, 'hooks', 'run.sh');
      const shDir = isWin
        ? ((process.env.PATH || '').split(path.delimiter).find((d) => d && (fs.existsSync(path.join(d, 'sh.exe')) || fs.existsSync(path.join(d, 'sh')))) || '')
        : '/bin';
      const minPath = [path.dirname(process.execPath), shDir].filter(Boolean).join(path.delimiter);
      const minEnv = isWin
        ? { PATH: minPath, HOME: ws, USERPROFILE: ws, SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows', TEMP: ws, TMP: ws }
        : { PATH: minPath, HOME: ws };
      const minOut = execFileSync(shBin, [runShPath, 'quality-gates', ws, 'ralplan'], {
        env: minEnv,
        encoding: 'utf8',
      });
      minimalPathOk = JSON.parse(minOut.trim()).ok === true;

      const noNodeEnv = { ...minEnv, OMAGY_NODE: path.join(ws, 'missing-node-binary') };
      const hookStopNoNode = execFileSync(shBin, [runShPath, 'stop'], { env: noNodeEnv, input: '{}', encoding: 'utf8' });
      const hookStartNoNode = execFileSync(shBin, [runShPath, 'session-start'], { env: noNodeEnv, input: '{}', encoding: 'utf8' });
      let cliNoNodeStatus = 0;
      let cliNoNodeOut = '';
      try {
        execFileSync(shBin, [runShPath, 'selftest'], { env: noNodeEnv, encoding: 'utf8' });
      } catch (noNodeErr) { /* fail open: capture expected exit 2 when node is missing for CLI subcommands */
        cliNoNodeStatus = noNodeErr?.status ?? 0;
        cliNoNodeOut = String(noNodeErr?.stdout || '').trim();
      }
      runShFailModesOk = JSON.parse(hookStopNoNode.trim()).decision === 'stop'
        && hookStartNoNode.trim() === '{}'
        && cliNoNodeStatus === 2
        && JSON.parse(cliNoNodeOut || '{}').error === 'node_not_found';

      const symDir = path.join(ws, 'sym-bin');
      fs.mkdirSync(symDir, { recursive: true });
      const symHook = path.join(symDir, 'omagy-hook-link.mjs');
      try {
        fs.symlinkSync(hookSelfPath, symHook, 'file');
        const symOut = execFileSync(process.execPath, [symHook, 'quality-gates', ws, 'ralplan'], { encoding: 'utf8' });
        symlinkMainOk = JSON.parse(symOut.trim()).ok === true;
      } catch { /* fail open: Windows without symlink privilege falls back to direct sameModulePath check */
        symlinkMainOk = process.platform === 'win32' && sameModulePath(hookSelfPath.toUpperCase(), hookSelfPath.toLowerCase());
      }

      const userRepoWithSkills = path.join(ws, 'user-repo-with-skills');
      fs.mkdirSync(path.join(userRepoWithSkills, 'skills', 'user-local-skill'), { recursive: true });
      fs.writeFileSync(path.join(userRepoWithSkills, 'skills', 'user-local-skill', 'SKILL.md'), '---\nname: user-local-skill\ndescription: "Local skill"\n---\n', 'utf8');
      const evalFromUserCwd = JSON.parse(execFileSync(process.execPath, [hookSelfPath, 'skill-eval', '--min-rank1', '90', '--json'], {
        cwd: userRepoWithSkills,
        encoding: 'utf8',
      }));
      userSkillsCwdEvalOk = evalFromUserCwd.ok === true && evalFromUserCwd.skillCount === 27;
    } catch { /* fail open: flags stay false and fail T8 check */ }
    check('hooks/run.sh and sidecars/hud/run.sh use pure POSIX expansion without dirname or sort -V',
      !hooksRunSh.includes('dirname ') && !hooksRunSh.includes('sort -V')
      && !hudRunSh.includes('dirname ') && !hudRunSh.includes('sort -V')
      && minimalPathOk && runShFailModesOk && symlinkMainOk && userSkillsCwdEvalOk,
      `minPath=${minimalPathOk} noNode=${runShFailModesOk} symMain=${symlinkMainOk} skillEvalCwd=${userSkillsCwdEvalOk}`);

    // T9 (T-DR-1): buildResearchMatrix across technical, business, idea, and implementation lenses
    const rmTech = buildResearchMatrix('Vector Indexing', '--technical');
    const rmBiz = buildResearchMatrix('AI Code Review', 'business');
    const rmIdea = buildResearchMatrix('Local-First Sync', 'idea');
    const rmImpl = buildResearchMatrix('SQLite WASM', 'implementation');
    check('buildResearchMatrix generates lens-specific Boolean query matrices and terminological clusters across all 4 lenses',
      rmTech.ok === true && rmTech.lens === 'technical' && rmTech.queryMatrix.facets.length === 5
      && rmBiz.ok === true && rmBiz.lens === 'business' && rmBiz.markdown.includes('Lens: business')
      && rmIdea.ok === true && rmIdea.lens === 'idea' && rmIdea.queryMatrix.contradictionAndCritique.length === 3
      && rmImpl.ok === true && rmImpl.lens === 'implementation' && rmImpl.sourceTierFilters.Tier_A_Primary_Standards_And_Benchmarks.length >= 2);

    // T10 (T-DR-2): auditResearchReport passes >=85 report and fails <85 or missing sections without confusing >=85 target column
    const validReportPath = path.join(ws, 'valid-research-report.md');
    fs.writeFileSync(validReportPath, [
      '# Deep Research Report',
      '## 1. Executive Summary',
      'This report evaluates vector indexing [VERIFIED] and cost projections [DERIVED] under explicit assumptions [ASSUMED].',
      '## 2. Introduction & Context\nContext and scope boundaries.',
      '## 3. Research Methodology & Source Tiers\nTier A and Tier B sources.',
      '## 4. Multidimensional Analysis\nTechnical and business analysis.',
      '## 5. Interpretation, Synthesis & Systemic Modeling\n```mermaid\nflowchart TD\nA --> B\n```',
      '## 6. Uncertainty, Risks & Limitations\nEpistemic gaps.',
      '## 7. Conclusions & Strategic Recommendations\nAction matrix.',
      '## 8. Glossary\nTerms.',
      '## 9. Research Self-Assessment Scorecard',
      '| Dimension | Target Score | Actual Score | Justification |',
      '| :--- | :---: | :---: | :--- |',
      '| **1. Depth of Analysis** | >= 85 | 92 | Deep first-principles analysis |',
      '| **2. Systemicity** | \\(\\ge 85\\) | 88 | Causal loops mapped |',
      '| **3. Critical Thinking** | >= 85 | 90 | Contradictions arbitrated |',
      '| **4. Interdisciplinarity** | >= 85 | 86 | Multi-lens synthesis |',
      '| **5. Practical Applicability** | >= 85 | 94 | Concrete builder matrix |',
    ].join('\n'), 'utf8');
    const lowScoreReportPath = path.join(ws, 'low-research-report.md');
    fs.writeFileSync(lowScoreReportPath, fs.readFileSync(validReportPath, 'utf8').replace('| **2. Systemicity** | \\(\\ge 85\\) | 88 |', '| **2. Systemicity** | >= 85 | 78 |'), 'utf8');
    const auditPass = auditResearchReport(validReportPath);
    const auditFail = auditResearchReport(lowScoreReportPath);
    check('auditResearchReport passes valid >=85 report and fails <85 dimension without confusing >=85 target column',
      auditPass.ok === true && auditPass.exitCode === 0 && auditPass.compositeScore === 90
      && auditPass.claimCounts.verified === 1 && auditPass.claimCounts.derived === 1 && auditPass.claimCounts.assumed === 1
      && auditFail.ok === false && auditFail.exitCode === 1 && auditFail.scores.systemicity === 78);

    // T20: Parent-root .omagy anchoring (stateRoot) & inner-folder .omagy discovery (discoverOmagyScopes + loadModeStates + isPathInsideAllowedOmagy)
    const travelsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-travels-'));
    let t20Ok = false;
    try {
      const summerTripDir = path.join(travelsRoot, 'Summer trip');
      fs.mkdirSync(summerTripDir, { recursive: true });
      fs.mkdirSync(path.join(travelsRoot, '.git'), { recursive: true });
      const anchoredParent = stateRoot(summerTripDir);
      fs.rmSync(path.join(travelsRoot, '.git'), { recursive: true, force: true });
      const innerStateDir = path.join(summerTripDir, '.omagy', 'state');
      fs.mkdirSync(innerStateDir, { recursive: true });
      writeJson(path.join(innerStateDir, 'autopilot-state.json'), { mode: 'autopilot', active: true, current_phase: 'ultragoal', iteration: 1, updated_at: new Date().toISOString() });
      const discScopes = discoverOmagyScopes(travelsRoot);
      const innerModes = loadModeStates(travelsRoot);
      t20Ok = anchoredParent === canonicalizePath(travelsRoot)
        && discScopes.some((s) => s.scope === 'Summer trip')
        && innerModes.length === 1 && innerModes[0].mode === 'autopilot' && innerModes[0].scope === 'Summer trip'
        && isPathInsideAllowedOmagy([travelsRoot], path.join(summerTripDir, '.omagy', 'plans', 'trip-plan.md')) === true
        && isPathInsideAllowedOmagy([travelsRoot], path.join(summerTripDir, 'src', 'app.js')) === false;
    } finally {
      fs.rmSync(travelsRoot, { recursive: true, force: true });
    }
    check('stateRoot anchors subfolder to parent project root and loadModeStates/discoverOmagyScopes track inner-folder .omagy', t20Ok);

    // T21: extractGoalBrief markdown hardening (unclosed fence exitCode 4, subtask retention 7a/7.1, non-English heading hint)
    const unclosedFenceMd = path.join(ws, 'unclosed-fence.md');
    fs.writeFileSync(unclosedFenceMd, '# Plan\n### Task 1: First Task\n```js\nconst x = 1;\n### Task 2: Swallowed Task\nNever closed fence', 'utf8');
    const unclosedRes1 = extractGoalBrief(unclosedFenceMd, '1', path.join(ws, 'out-unclosed1.md'));
    const unclosedRes2 = extractGoalBrief(unclosedFenceMd, '2', path.join(ws, 'out-unclosed2.md'));
    const subtaskMd = path.join(ws, 'subtask-plan.md');
    fs.writeFileSync(subtaskMd, '# Plan\n### Task 7: Parent Task\nParent step.\n#### Task 7a: Child Subtask A\nSubtask A step.\n### Task 7.1: Child Subtask Dot\nSubtask 7.1 step.\n### Task 8: Next Task\nTask 8 step.', 'utf8');
    const subBriefRes = extractGoalBrief(subtaskMd, '7', path.join(ws, 'out-t7.md'));
    const subBriefText = fs.existsSync(path.join(ws, 'out-t7.md')) ? fs.readFileSync(path.join(ws, 'out-t7.md'), 'utf8') : '';
    const nonEngMd = path.join(ws, 'non-eng-plan.md');
    fs.writeFileSync(nonEngMd, '# План\n### Задача 1: Инициализация\nШаг 1\n### Задача 2: Тесты\n', 'utf8');
    const nonEngRes = extractGoalBrief(nonEngMd, '1', path.join(ws, 'out-noneng.md'));
    check('extractGoalBrief exits 4 on unclosed code fence, retains 7a/7.1 subtasks, and hints non-English task headings',
      unclosedRes1.ok === false && unclosedRes1.exitCode === 4 && unclosedRes2.ok === false && unclosedRes2.exitCode === 4
      && subBriefRes.ok === true && subBriefText.includes('Task 7a: Child Subtask A') && subBriefText.includes('Task 7.1: Child Subtask Dot') && !subBriefText.includes('Task 8')
      && nonEngRes.ok === false && nonEngRes.error.includes('Задача 1'));

    // T22: checkTestJunk 7 regex rules & check-test-junk: ignore suppression
    const junkTestFile = path.join(ws, 'sample.test.js');
    fs.writeFileSync(junkTestFile, [
      "const src = fs.readFileSync('src/index.js', 'utf8');",
      `expect(err.message).toBe('${'A'.repeat(85)}');`,
      'await new Promise((resolve) => setTimeout(resolve, 500));',
      "test.only('focused test', () => {});",
      "test.skip('skipped test', () => {});",
      'expect(result).toBe(result);',
      'expect(items.length).toBeGreaterThanOrEqual(0);',
      "// check-test-junk: ignore\ntest.skip('intentionally ignored skip', () => {});",
    ].join('\n'), 'utf8');
    const junkRes = checkTestJunk([junkTestFile]);
    const rulesHit = new Set(junkRes.violations.map((v) => v.rule));
    check('checkTestJunk detects all 7 junk-test rules and honors check-test-junk: ignore',
      junkRes.ok === false && junkRes.exitCode === 1 && junkRes.violations.length === 7
      && ['source-grep', 'prose-pin', 'fixed-sleep', 'focused', 'skipped', 'self-compare', 'lower-bound'].every((r) => rulesHit.has(r)));

    // T23 (T-MAP-1): buildCodebaseMap shared-folder priority, adaptive <=2-file symbol sampling, and budget cap
    const mapWs = path.join(ws, 'map-repo');
    for (const sub of ['.omagy', 'pages', 'shared']) fs.mkdirSync(path.join(mapWs, sub), { recursive: true });
    fs.writeFileSync(path.join(mapWs, 'pages', 'home.js'), 'export function renderHome() {}\nexport function renderFooter() {}\n', 'utf8');
    fs.writeFileSync(path.join(mapWs, 'shared', 'utils.js'), ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => `export function ${s}() {}`).join('\n'), 'utf8');
    const fullMap = buildCodebaseMap([mapWs], 1800);
    const tightMap = buildCodebaseMap([mapWs], 125);
    check('buildCodebaseMap prioritizes shared folders, samples up to 8 symbols in <=2-file folders, and respects budget',
      fullMap.includes('shared/: s1, s2, s3, s4, s5, s6') && fullMap.indexOf('shared/:') < fullMap.indexOf('pages/:')
      && tightMap.includes('shared/:') && !tightMap.includes('pages/:') && tightMap.includes('(1 more folders not listed)'));

    // T24 (T-MAP-2 & T-MAP-3): sessionStart/preInvocation once-per-session codebase-map injection, OMAGY_MAP=0 opt-out, and extractGoalBrief map section
    const mapConv = `${conv}-map`;
    const joinSteps = (r) => (r.injectSteps || []).map((s) => s.ephemeralMessage || '').join('\n');
    const sMap1Text = joinSteps(sessionStart({ conversationId: mapConv, workspacePaths: [mapWs] }));
    const pMap2Text = joinSteps(preInvocation({ conversationId: mapConv, workspacePaths: [mapWs], lastUserInput: 'check status' }));
    const prevOmagyMap = process.env.OMAGY_MAP;
    process.env.OMAGY_MAP = '0';
    const sOptOutText = joinSteps(sessionStart({ conversationId: `${conv}-nomap`, workspacePaths: [mapWs] }));
    if (prevOmagyMap === undefined) delete process.env.OMAGY_MAP;
    else process.env.OMAGY_MAP = prevOmagyMap;
    const sSubMapText = joinSteps(sessionStart({ conversationId: `${conv}-submap`, workspacePaths: [mapWs], parentConversationId: conv }));
    const mapPlanGoals = path.join(mapWs, 'goals.json');
    writeJson(mapPlanGoals, { objective: 'Test map in goal-brief', goals: [{ id: 'G1', title: 'Map Goal', objective: 'Use shared utils', rigor: 'light', acceptance: ['A1'] }] });
    const mapBriefOut = path.join(mapWs, 'brief-g1.md');
    extractGoalBrief(mapPlanGoals, 'G1', mapBriefOut);
    const mapBriefContent = fs.existsSync(mapBriefOut) ? fs.readFileSync(mapBriefOut, 'utf8') : '';
    check('sessionStart/preInvocation inject codebase-map once per session (honoring OMAGY_MAP=0 and subagent skip) and extractGoalBrief appends Codebase Reuse Map',
      sMap1Text.includes('[oh-my-agy] Codebase map') && !pMap2Text.includes('[oh-my-agy] Codebase map')
      && !sOptOutText.includes('[oh-my-agy] Codebase map') && !sSubMapText.includes('[oh-my-agy] Codebase map')
      && mapBriefContent.includes('## Codebase Reuse Map') && mapBriefContent.includes('shared/: s1'));

    // T25 (T-DEBT-1): scanShortcutDebt parses shortcut:/ceiling:, splits ceiling vs upgrade, tags noTrigger, and ignores <...> placeholders
    const debtWs = path.join(ws, 'debt-repo');
    fs.mkdirSync(path.join(debtWs, 'src'), { recursive: true });
    fs.writeFileSync(path.join(debtWs, 'src', 'worker.js'), '// shortcut: <ceiling>, <when to upgrade>\n// shortcut: 500 items in memory, switch to cursor pagination\n// ceiling: single node only\n# shortcut: 10 req/s -> add token bucket', 'utf8');
    const debtRes = scanShortcutDebt(debtWs);
    check('scanShortcutDebt extracts shortcut/ceiling comments, splits ceiling vs upgrade, tags noTrigger, and ignores template placeholders',
      debtRes.ok === true && debtRes.total === 3 && debtRes.noTriggerCount === 1
      && debtRes.items[0].ceiling === '500 items in memory' && debtRes.items[0].upgrade === 'switch to cursor pagination' && debtRes.items[0].noTrigger === false
      && debtRes.items[1].ceiling === 'single node only' && debtRes.items[1].noTrigger === true
      && debtRes.items[2].ceiling === '10 req/s' && debtRes.items[2].upgrade === 'add token bucket');

    // T26 (T-CALLER-1, T-CALLER-2, T-REUSE-1): analyzeDiffCodeHealth & scanDiffBlockers detect open callers (including $ identifiers), ignore moved/generic/.method calls, and compute reusePct
    const healthRepo = path.join(ws, 'health-repo');
    let healthOk = false; let healthErr = '';
    try {
      initTestGit(healthRepo);
      fs.writeFileSync(path.join(healthRepo, 'a.js'), ['deadFn(x) { return x + 1; }', 'movedFn(x) { return x + 2; }', '$dollarFn(x) { return x + 3; }', 'existingHelper(x) { return x * 2; }', 'secondHelper(x) { return x + 10; }', 'get(x) { return x; }'].map((s) => `export function ${s}`).join('\n'), 'utf8');
      fs.writeFileSync(path.join(healthRepo, 'd.js'), 'export function deletedFileFn(x) { return x - 1; }\n', 'utf8');
      fs.writeFileSync(path.join(healthRepo, 'b.js'), 'import { deadFn, movedFn, $dollarFn, get } from "./a.js";\nexport function runAll(obj) {\n  const v1 = deadFn(1);\n  const v2 = movedFn(2);\n  const v3 = $dollarFn(3);\n  const v4 = obj.deadFn(4);\n  const v5 = get(5);\n  const v6 = deletedFileFn(6);\n  return v1 + v2 + v3 + v4 + v5 + v6;\n}', 'utf8');
      execFileSync('git', ['add', 'a.js', 'b.js', 'd.js'], { cwd: healthRepo });
      execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'initial commit'], { cwd: healthRepo });
      fs.rmSync(path.join(healthRepo, 'd.js'));
      fs.writeFileSync(path.join(healthRepo, 'a.js'), 'export function existingHelper(x) { return x * 2; }\nexport function secondHelper(x) { return x + 10; }\nexport function brandNewFn(y) {\n  return secondHelper(existingHelper(y));\n}', 'utf8');
      fs.writeFileSync(path.join(healthRepo, 'c.js'), 'export function movedFn(x) { return x + 2; }\n', 'utf8');
      const ch = analyzeDiffCodeHealth(healthRepo);
      const blockers = scanDiffBlockers([healthRepo]);
      const openSyms = [...new Set(ch.openCallers.map((c) => c.symbol))].sort();
      const deadEntries = ch.openCallers.filter((c) => c.symbol === 'deadFn');
      healthOk = JSON.stringify(openSyms) === JSON.stringify(['$dollarFn', 'deadFn', 'deletedFileFn'])
        && deadEntries.length === 1 && deadEntries[0].file === 'b.js' && deadEntries[0].line === 3
        && ch.reused.includes('existingHelper') && ch.reused.includes('secondHelper') && ch.created.includes('brandNewFn') && ch.reusePct === 67
        && ['$dollarFn', 'deadFn', 'deletedFileFn'].every((sym) => blockers.some((b) => b.kind.includes(`removed symbol '${sym}'`)))
        && !blockers.some((b) => b.kind.includes('movedFn')) && !blockers.some((b) => b.kind.includes("removed symbol 'get'"));
    } catch (e) { /* fail open: capture T26 error */ healthErr = e instanceof Error ? e.message : String(e); }
    check('analyzeDiffCodeHealth & scanDiffBlockers detect open callers (including $ symbols), ignore moved/generic/.method calls, and compute reusePct', healthOk, healthErr);

    // T27 (T-RULES-1): Code-reuse and shortcut-debt contract markers across rules/AGENTS.md, agents, and skills
    const rTxt = (rel) => fs.readFileSync(path.join(pluginRoot, rel), 'utf8');
    check('rules/AGENTS.md, executor, code-reviewer, code-review, analyze, and hud document 6-Rung Reuse Ladder, shortcut:, caller-grep, Lean:, and --audit',
      ['rules/AGENTS.md', 'agents/executor.md'].every((p) => rTxt(p).includes('6-Rung Reuse Ladder') && rTxt(p).includes('shortcut:'))
      && rTxt('agents/code-reviewer.md').includes('Lean:') && rTxt('agents/code-reviewer.md').includes('shortcut:')
      && rTxt('skills/code-review/SKILL.md').includes('--audit') && rTxt('skills/code-review/SKILL.md').includes('Lean:')
      && rTxt('skills/analyze/SKILL.md').includes('--audit') && rTxt('skills/hud/SKILL.md').includes('scanShortcutDebt'));

    await runColdSelftestChecks({ ws, conv, base, stateFile, now, validReportPath, STALE_MS, activeStates, buildActiveModeMessage, stop, writeJson, check });

    // T34: Repo-wide prompt, skill & provenance hygiene (zero Default effort: in vision/debugger/team-worker, zero foreign tool/agent names, and zero upstream provenance references across plugin files)
    const effortViolations = ['vision.md', 'debugger.md', 'team-worker.md'].filter((f) => /Default effort:/i.test(rTxt(`agents/${f}`)));
    const foreignRe = new RegExp(`\\b(?:${['TodoWrite', 'call_o' + 'mo_agent', 'sisyphus-junior', 'momus', 'metis', 'oracle'].join('|')})\\b`, 'i');
    const provWords = ['o' + 'mo', 'o' + 'mx', 'o' + 'mc', 'oh-my-' + 'openagent', 'oh-my-' + 'opencode', 'oh-my-' + 'codex', 'oh-my-' + 'claudecode', 'pon' + 'ytail', 'super' + 'powers', 'kib' + 'itzer', 'addy' + 'osmani', 'agent-' + 'skills'];
    const provenanceRe = new RegExp(`${'ported' + ' from'}|\\b(?:${provWords.join('|')})\\b|${'om' + 'x_wiki'}`, 'i');
    const foreignViolations = [];
    const provenanceViolations = [];
    const checkProvenanceFile = (relPath, absPath) => {
      if (!fs.existsSync(absPath)) return;
      let content = fs.readFileSync(absPath, 'utf8');
      if (relPath === 'README.md') content = content.replace(/\n## Credits\r?\n[\s\S]*$/, '');
      if (provenanceRe.test(content)) provenanceViolations.push(relPath);
    };
    for (const rootDoc of ['rules/AGENTS.md', 'hooks.json', 'hooks/run.sh', 'hooks/omagy-hook.mjs', 'hooks/omagy-cli.mjs', 'hooks/skill-eval-cases.json', '.github/workflows/ci.yml', 'sidecars/hud/run.sh', 'sidecars/hud/sidecar.json', 'sidecars/hud/main.mjs', 'README.md', 'HOW_TO_USE.md', 'CHANGELOG.md', 'plugin.json']) {
      checkProvenanceFile(rootDoc, path.join(pluginRoot, rootDoc));
    }
    for (const af of fs.readdirSync(path.join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'))) {
      const txt = rTxt(`agents/${af}`);
      if (foreignRe.test(txt)) foreignViolations.push(`agents/${af}`);
      if (provenanceRe.test(txt)) provenanceViolations.push(`agents/${af}`);
    }
    for (const sd of fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      const sf = path.join(skillsDir, sd, 'SKILL.md');
      if (fs.existsSync(sf)) {
        const sfTxt = fs.readFileSync(sf, 'utf8');
        if (foreignRe.test(sfTxt)) foreignViolations.push(`skills/${sd}/SKILL.md`);
        if (provenanceRe.test(sfTxt)) provenanceViolations.push(`skills/${sd}/SKILL.md`);
      }
      const refDir = path.join(skillsDir, sd, 'references');
      if (fs.existsSync(refDir)) for (const rf of fs.readdirSync(refDir).filter((f) => f.endsWith('.md'))) checkProvenanceFile(`skills/${sd}/references/${rf}`, path.join(refDir, rf));
    }
    const pluginWikiDir = path.join(pluginRoot, 'omagy_wiki');
    if (fs.existsSync(pluginWikiDir)) {
      for (const wf of fs.readdirSync(pluginWikiDir).filter((f) => f.endsWith('.md'))) checkProvenanceFile(`omagy_wiki/${wf}`, path.join(pluginWikiDir, wf));
      const archiveDir = path.join(pluginWikiDir, 'archive');
      if (fs.existsSync(archiveDir)) for (const af of fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'))) checkProvenanceFile(`omagy_wiki/archive/${af}`, path.join(archiveDir, af));
    }
    check('zero static Default effort: lines, zero foreign tool/agent names, and zero upstream provenance references across plugin files',
      effortViolations.length === 0 && foreignViolations.length === 0 && provenanceViolations.length === 0,
      `effort=${effortViolations.join(',')} foreign=${foreignViolations.join(',')} provenance=${provenanceViolations.join(',')}`);

    runG1SelftestChecks({ ws, conv, pluginRoot, hookSelfPath, preToolUse, scanDiffBlockers, validateQualityGates, loadNotificationConfig, isSafeNotificationUrl, writeJson, check });

    const leaked = fs.existsSync(path.join(defaultTmpRuntime, `${conv}.routing.json`));
    check('selftest isolates runtime files from system tmpdir', !leaked);
  } finally {
    if (prevRuntimeDir === undefined) delete process.env.OMAGY_RUNTIME_DIR;
    else process.env.OMAGY_RUNTIME_DIR = prevRuntimeDir;
    fs.rmSync(ws, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) process.stderr.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}\n`);
  return { selftest: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, failed: failed.length };
}

// ---------- main ----------
function parseCliArgs(rawArgs = []) {
  let jsonMode = false;
  let dashC = '';
  const pos = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (a === '--json') jsonMode = true;
    else if (a === '-C' && i + 1 < rawArgs.length) { dashC = rawArgs[i + 1]; i += 1; }
    else pos.push(a);
  }
  return { jsonMode, dashC, pos };
}

function runThrowingJsonCli(fn) {
  try {
    process.stdout.write(`${JSON.stringify(fn())}\n`);
    process.exitCode = 0;
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const event = (process.argv[2] || '').toLowerCase();
  const rawArgs = process.argv.slice(3);
  if (event === 'selftest') {
    const r = await selftest();
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exitCode = r.selftest === 'PASS' ? 0 : 1;
    return;
  }
  if (event === 'verify-evidence') {
    const [cwdArg, relArg, teamArg, taskIdArg] = rawArgs;
    runThrowingJsonCli(() => validateCompletionEvidence(cwdArg || process.cwd(), relArg, { team: teamArg, taskId: taskIdArg }));
    return;
  }
  if (event === 'append-jsonl') {
    const [fileArg, jsonArg] = rawArgs;
    runThrowingJsonCli(() => appendJsonlRecord(fileArg, jsonArg || readStdin()));
    return;
  }
  if (event === 'read-jsonl') {
    runThrowingJsonCli(() => readJsonlRecords(rawArgs[0]));
    return;
  }
  if (event === 'quality-gates') {
    const res = validateQualityGates(rawArgs[0] || process.cwd(), rawArgs[1] || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    process.exitCode = res.ok ? 0 : 1;
    return;
  }
  if (event === 'review-package') {
    const { dashC, pos } = parseCliArgs(rawArgs);
    const res = buildReviewPackage(dashC || pos[0] || process.cwd(), dashC ? pos[0] : pos[1], (dashC ? pos[1] : pos[2]) || 'HEAD', (dashC ? pos[2] : pos[3]) || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    process.exitCode = res.ok ? 0 : (res.exitCode || 1);
    return;
  }
  if (event === 'goal-brief') {
    const { dashC, pos } = parseCliArgs(rawArgs);
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const resolveRel = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(baseDir, p)) : '');
    const res = extractGoalBrief(resolveRel(pos[0]), pos[1] || '', resolveRel(pos[2]));
    process.stdout.write(`${JSON.stringify(res)}\n`);
    process.exitCode = res.ok ? 0 : (res.exitCode || 1);
    return;
  }
  if (event === 'check-test-junk') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = checkTestJunk(pos.length ? pos : [process.cwd()]);
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else {
      const lines = [`CHECK-TEST-JUNK: ${res.ok ? 'PASS' : 'FAIL'} (${res.filesScanned} file(s) scanned, ${res.violations.length} violation(s))`];
      for (const v of res.violations) lines.push(`${v.file}:${v.line} [${v.rule}] ${v.message} :: ${v.snippet}`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = res.exitCode;
    return;
  }
  if (event === 'research-matrix') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = buildResearchMatrix(pos[0] || '', pos[1] || 'general', pos.slice(2));
    if (!res.ok) {
      process.stdout.write(`${JSON.stringify(res)}\n`);
      process.exitCode = res.exitCode || 1;
      return;
    }
    process.stdout.write(jsonMode ? `${JSON.stringify(res, null, 2)}\n` : res.markdown);
    process.exitCode = 0;
    return;
  }
  if (event === 'audit-research') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = auditResearchReport(pos[0] || '');
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else {
      const lines = [
        `DEEP RESEARCH AUDIT: ${res.file || pos[0] || ''} (${res.ok ? 'PASS' : 'FAIL'}, composite=${res.compositeScore ?? 'n/a'})`,
        `Claims: [VERIFIED]=${res.claimCounts?.verified ?? 0} [DERIVED]=${res.claimCounts?.derived ?? 0} [ASSUMED]=${res.claimCounts?.assumed ?? 0}`,
        ...(res.errors || []).map((e) => `ERROR: ${e}`),
        ...(res.warnings || []).map((w) => `WARN: ${w}`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = res.ok ? 0 : (res.exitCode || 1);
    return;
  }
  if (event === 'codebase-map') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const targetRoot = pos[0] ? path.resolve(pos[0]) : process.cwd();
    const budgetArg = pos[1] ? intOr(pos[1], 1800, 100) : intOr(process.env.OMAGY_MAP_CHARS, 1800, 100);
    const mapText = buildCodebaseMap([targetRoot], budgetArg);
    if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: true, root: targetRoot, budget: budgetArg, map: mapText }, null, 2)}\n`);
    else if (mapText) process.stdout.write(`${mapText}\n`);
    process.exitCode = 0;
    return;
  }
  if (event === 'scan-debt') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const targetRoot = pos[0] ? path.resolve(pos[0]) : process.cwd();
    const res = scanShortcutDebt([targetRoot], pos[1] || '');
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.total === 0) process.stdout.write('No shortcut debt. Clean ledger.\n');
    else {
      const lines = res.items.map((it) => `${it.file}:${it.line}, ceiling: ${it.ceiling}. upgrade: ${it.upgrade || '[no-trigger]'}${it.noTrigger ? ' [no-trigger]' : ''}.`);
      lines.push(`${res.total} marker${res.total === 1 ? '' : 's'}, ${res.noTriggerCount} with no trigger.`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = 0;
    return;
  }
  if (event === 'validate-team-tasks') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = validateTeamTasks(pos[0] ? path.resolve(pos[0]) : process.cwd(), pos[1] || '');
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return;
  }
  if (event === 'watch-pr') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const inputArg = pos[0] || '{}';
    let facts = {};
    try {
      facts = JSON.parse(fs.existsSync(inputArg) ? fs.readFileSync(inputArg, 'utf8') : inputArg);
    } catch { /* fail open: report blocked on malformed watch-pr JSON */
      process.stdout.write(`${JSON.stringify({ verdict: 'blocked', reasons: ['invalid_input_json'] })}\n`);
      process.exitCode = 1;
      return;
    }
    const res = decideWatchVerdict(facts);
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.verdict === 'blocked' || res.verdict === 'gone' ? 1 : 0;
    return;
  }
  if (event === 'failure-sig') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const inputArg = pos[0] || '';
    const signature = normalizeFailureSignature((inputArg && fs.existsSync(inputArg)) ? fs.readFileSync(inputArg, 'utf8') : (inputArg || readStdin()));
    process.stdout.write(jsonMode ? `${JSON.stringify({ ok: true, signature }, null, 2)}\n` : `${signature}\n`);
    process.exitCode = 0;
    return;
  }
  if (event === 'session-compare') {
    const jsonMode = rawArgs.includes('--json');
    const failOnRegression = rawArgs.includes('--fail-on-regression');
    let maxDurationIncreasePct = 50;
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (a === '--json' || a === '--fail-on-regression') continue;
      if (a === '--max-duration-increase' && i + 1 < rawArgs.length) { maxDurationIncreasePct = Number(rawArgs[i + 1]); i += 1; }
      else pos.push(a);
    }
    const res = compareSessions(pos[0] || '', pos[1] || '', { failOnRegression, maxDurationIncreasePct });
    if (pos[2]) {
      const outPath = path.resolve(pos[2]);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(res, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return;
  }
  if (event === 'wiki-repair') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const wikiDirArg = pos[0] ? path.resolve(pos[0]) : path.join(process.cwd(), 'omagy_wiki');
    const changesArg = pos[1] || '{}';
    let changes = {};
    try {
      changes = fs.existsSync(changesArg) ? JSON.parse(fs.readFileSync(changesArg, 'utf8')) : JSON.parse(changesArg);
    } catch { /* fail open: reject malformed wiki-repair JSON */
      process.stdout.write(`${JSON.stringify({ ok: false, error: 'Invalid changes JSON' })}\n`);
      process.exitCode = 1;
      return;
    }
    const res = repairWikiLinks(wikiDirArg, changes);
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return;
  }
  if (event === 'floor-guard' || event === 'skill-eval' || event === 'quality-gate') {
    const { handleColdCliCommand } = await import('./omagy-cli.mjs');
    const defaultRoot = (fs.existsSync(path.join(process.cwd(), 'skills')) && fs.existsSync(path.join(process.cwd(), 'hooks', 'skill-eval-cases.json')))
      ? process.cwd()
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    process.exitCode = handleColdCliCommand(event, process.argv.slice(3), defaultRoot);
    return;
  }
  const payload = parseJson(readStdin());
  let result = {};
  try {
    if (event === 'session-start') result = sessionStart(payload);
    else if (event === 'pre-invocation') result = preInvocation(payload);
    else if (event === 'pre-tool-use') result = preToolUse(payload);
    else if (event === 'stop') result = await stop(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[oh-my-agy] hook ${event} failed open: ${msg}\n`);
    try {
      const roots = workspaceRoots(payload);
      const logDir = omagyLogsDir(roots[0] || process.cwd());
      if (process.env.OMAGY_ROOT || process.env.OMAGY_STATE_ROOT || fs.existsSync(logDir)) {
        appendJsonlRecord(path.join(logDir, 'hook-errors.jsonl'), { at: new Date().toISOString(), event, error: msg });
      }
    } catch { /* fail open: ignore hook error log write failure */ }
    result = event === 'stop' ? { decision: 'stop' } : {};
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function sameModulePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  if (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase()) return true;
  try {
    const realA = fs.realpathSync(ra);
    const realB = fs.realpathSync(rb);
    return realA === realB || (process.platform === 'win32' && realA.toLowerCase() === realB.toLowerCase());
  } catch { /* fail open: non-existent argv[1] cannot match module path */
    return false;
  }
}

const LIFECYCLE_HOOK_EVENTS = new Set(['session-start', 'pre-invocation', 'pre-tool-use', 'stop']);
const isMainModule = Boolean(process.argv[1] && sameModulePath(process.argv[1], fileURLToPath(import.meta.url)));
if (isMainModule) {
  main().catch((err) => {
    const ev = (process.argv[2] || '').toLowerCase();
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[oh-my-agy] main error: ${err instanceof Error ? err.stack || errMsg : errMsg}\n`);
    if (LIFECYCLE_HOOK_EVENTS.has(ev)) {
      process.stdout.write(ev === 'stop' ? '{"decision":"stop"}\n' : '{}\n');
    } else {
      process.stdout.write(`${JSON.stringify({ ok: false, error: errMsg })}\n`);
      process.exitCode = 2;
    }
  });
}
