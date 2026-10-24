#!/usr/bin/env node
// oh-my-agy lifecycle hook runner for Antigravity (tracks oh-my-codex 0.21.33).
// Replaces oh-my-codex's codex-native-hook.mjs (which delegated to the `omx` CLI) with a
// dependency-free, fail-open implementation of the parts that map onto Antigravity hooks:
//   session-start   : bounded project wiki index + active-mode reminder on new session start
//   pre-invocation  : $skill keyword routing + active-mode reminder + once-per-session wiki index
//   pre-tool-use    : opt-in planning-mode write guard (never auto-allows)
//   stop            : bounded, progress-aware continuation (NO_TOOL_CALL / model_stop) + notifications
//   verify-evidence : deterministic validator for .omagy/evidence/<file>.json team task evidence
//   selftest        : offline verification of the above against an isolated temp workspace
// Contract: JSON on stdin, JSON on stdout, camelCase keys (Antigravity hook protocol).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const SKILLS = [
  'ai-slop-cleaner', 'analyze', 'ask', 'autopilot', 'autoresearch', 'best-practice-research',
  'cancel', 'code-review', 'configure-notifications', 'deep-interview', 'design', 'doctor', 'handoff',
  'hud', 'loft', 'omagy-setup', 'performance-goal', 'plan', 'pr', 'ralplan', 'skill', 'team',
  'ultragoal', 'ultraqa', 'visual-ralph', 'wiki',
];
// Antigravity built-in slash commands: `/name` belongs to Antigravity, only `$name` routes to us.
const AGY_SLASH = new Set(['goal', 'schedule', 'browser', 'plan', 'grill-me', 'teamwork-preview', 'learn', 'boost']);
const CONTINUATION_MODES = ['autopilot', 'ultragoal', 'ultraqa', 'autoresearch', 'performance-goal'];
const PLANNING_MODES = ['deep-interview', 'ralplan', 'plan'];
const TERMINAL = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
// Antigravity passes "NO_TOOL_CALL" on normal turn completion (ExecutorTerminationReason);
// also accept "model_stop" and "" for compatibility and offline tests.
const NORMAL_STOP_REASONS = new Set(['no_tool_call', 'model_stop', '']);
const STALE_MS = Number(process.env.OMAGY_STALE_MS) || 6 * 3600 * 1000;
const MAX_NUDGES = Number(process.env.OMAGY_MAX_NUDGES) || 2;
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const MAX_WIKI_CONTEXT_CHARS = 3500;
const MAX_WIKI_CONTEXT_LINES = 60;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_WALK_DEPTH = 8;
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.sh', '.bash', '.zsh',
  '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.rb', '.php', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp',
]);
const COMPLETION_CLAIM_RE = /\b(?:done|complete[sd]?|finished|implemented|fixed|resolved|all set|ready\s+(?:for\s+(?:review|merge|release|qa|testing)|to\s+(?:merge|ship|release|submit)))\b/i;
const BLOCKER_PATTERNS = [
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

// ---------- mode state & multi-repo root (ported from OMC worktree-paths / state-root + OMX 0.21.31-32 symlink guard) ----------
function stateRoot(root) {
  let cur = canonicalizePath(root);
  for (let i = 0; i < MAX_WORKSPACE_WALK_DEPTH; i += 1) {
    try {
      if (fs.existsSync(path.join(cur, '.omagy-workspace')) || fs.existsSync(path.join(cur, '.omc-workspace'))) {
        return cur;
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return canonicalizePath(root);
}
function readStateDir(dir, root, convId) {
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
    out.push({ mode: String(data.mode || m[1]), file, data, mtimeMs, root, owner: String(owner || ''), foreignOwner });
  }
  return out;
}
function loadModeStates(root, convId = '') {
  const sRoot = stateRoot(root);
  const byMode = new Map();
  if (convId) {
    const sessDir = path.join(sRoot, '.omagy', 'state', 'sessions', safeId(convId));
    for (const s of readStateDir(sessDir, sRoot, convId)) byMode.set(s.mode, s);
  }
  const sharedDir = path.join(sRoot, '.omagy', 'state');
  for (const s of readStateDir(sharedDir, sRoot, convId)) {
    if (!byMode.has(s.mode)) byMode.set(s.mode, s);
  }
  return [...byMode.values()];
}
function updatedMs(s) {
  return Date.parse(s.data.updated_at || '') || s.mtimeMs || 0;
}
function isActive(s, now = Date.now()) {
  if (s.foreignOwner) return false;
  const d = s.data;
  if (!d || d.active !== true) return false;
  if (TERMINAL.has(String(d.current_phase || '').toLowerCase())) return false;
  if (typeof d.completed_at === 'string' && d.completed_at.trim()) return false;
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

// ---------- wiki & working agreements summary (ported from OMX 0.21.18 + OmO working-agreement ledger) ----------
function loadWikiSummary(roots) {
  for (const rawRoot of roots) {
    const root = stateRoot(rawRoot);
    for (const dirName of ['omagy_wiki', 'omx_wiki']) {
      const indexPath = path.join(root, dirName, 'index.md');
      const agreementsPath = path.join(root, dirName, 'agreements.md');
      let indexRaw = '';
      let agreementsRaw = '';
      try { indexRaw = fs.readFileSync(indexPath, 'utf8').trim(); } catch { /* ignore */ }
      try { agreementsRaw = fs.readFileSync(agreementsPath, 'utf8').trim(); } catch { /* ignore */ }
      if (!indexRaw && !agreementsRaw) continue;
      const parts = [];
      if (agreementsRaw) {
        parts.push(
          `[oh-my-agy] Working Agreements (${dirName}/agreements.md):`,
          ...agreementsRaw.split('\n').slice(0, 25),
        );
      }
      if (indexRaw) {
        parts.push(
          `[oh-my-agy] Project Wiki index (${dirName}/index.md):`,
          ...indexRaw.split('\n').slice(0, MAX_WIKI_CONTEXT_LINES),
        );
      }
      const summary = parts.join('\n');
      if (summary.length <= MAX_WIKI_CONTEXT_CHARS) return summary;
      const notice = '\n[Wiki index truncated; use $wiki read or $wiki query for more.]';
      const bounded = summary.slice(0, MAX_WIKI_CONTEXT_CHARS - notice.length);
      const lastNewline = bounded.lastIndexOf('\n');
      return (lastNewline > 0 ? bounded.slice(0, lastNewline) : bounded) + notice;
    }
  }
  return null;
}

// ---------- hierarchical subdirectory AGENTS.md discovery (ported from OmO directory-agents-injector) ----------
function discoverSubdirAgents(roots, text, seenList = []) {
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
        if (seen.has(agentsFile)) continue;
        let raw = '';
        try { raw = fs.readFileSync(agentsFile, 'utf8').trim(); } catch { continue; }
        if (!raw) continue;
        seen.add(agentsFile);
        const rel = path.relative(root, agentsFile);
        const snippet = raw.split('\n').slice(0, 30).join('\n').slice(0, 1500);
        messages.push(`[oh-my-agy] Subdirectory AGENTS.md (${rel}):\n${snippet}`);
        if (messages.length >= 2) return { messages, seen: [...seen] };
      }
    }
  }
  return { messages, seen: [...seen] };
}

// ---------- team completion evidence validator (ported from OMX 0.21.18) ----------
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
  if (!nonPlaceholderText(evidence.summary)
      || !Array.isArray(evidence.verification)
      || evidence.verification.length === 0
      || evidence.verification.some((check) => {
        if (!check || typeof check !== 'object') return true;
        return !nonPlaceholderText(check.command) || check.result !== 'passed' || !nonPlaceholderText(check.output);
      })
      || !Array.isArray(evidence.unverified)
      || evidence.unverified.some((item) => !nonPlaceholderText(item))) {
    throw new Error('Evidence requires summary, passing verification checks (command/result:"passed"/output), and an unverified array.');
  }
  return { ok: true, file: target, taskId: evidence.taskId ?? null, team: teamVal ?? null };
}

// ---------- crash-resilient JSONL helpers (ported from OMX 0.21.33 PR #3893) ----------
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

// ---------- transcript ----------
function lastUserMessage(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
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
  } catch { return null; }
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
function scanDiffBlockers(roots) {
  const hits = [];
  for (const cwd of roots) {
    let diff = '';
    try {
      diff = execFileSync('git', ['diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', 'HEAD', '--'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500,
      });
    } catch { continue; }
    if (!diff) continue;
    let curFile = '';
    let newLine = 0;
    for (const rawLine of diff.split('\n')) {
      if (rawLine.startsWith('+++ b/')) {
        curFile = rawLine.slice(6).trim();
        newLine = 0;
        continue;
      }
      if (!curFile || !CODE_EXTENSIONS.has(path.extname(curFile).toLowerCase())) continue;
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
      if (hunk) {
        newLine = Number.parseInt(hunk[1], 10);
        continue;
      }
      if (rawLine.startsWith('+++') || rawLine.startsWith('---') || newLine === 0) continue;
      if (rawLine.startsWith('+')) {
        const added = rawLine.slice(1);
        for (const bp of BLOCKER_PATTERNS) {
          if (bp.pattern.test(added)) {
            hits.push({ file: curFile, line: newLine, kind: bp.kind });
            break;
          }
        }
        newLine += 1;
      } else if (!rawLine.startsWith('-')) {
        newLine += 1;
      }
    }
  }
  return hits;
}
function hasRalplanArtifacts(sRoot) {
  const plansDir = path.join(stateRoot(sRoot), '.omagy', 'plans');
  let names = [];
  try { names = fs.readdirSync(plansDir); } catch { return false; }
  return names.some((n) => /^prd-.*\.md$/i.test(n)) && names.some((n) => /^test-spec-.*\.md$/i.test(n));
}
function detectSkills(text) {
  const found = [];
  const re = /(^|[\s(>"'`])([$/])([a-z][a-z0-9-]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
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
  const desc = active.slice(0, 4).map((s) => `${s.mode} (phase: ${s.data.current_phase || 'unknown'}, updated ${ago(now - updatedMs(s))})`).join('; ');
  return `[oh-my-agy] Active workflow state: ${desc} — see ${path.join(active[0].root, '.omagy', 'state')}. ` +
    'If the user says continue/resume, resume from current_phase; if the user changes direction, update or $cancel the mode.';
}

// ---------- handlers ----------
function sessionStart(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const recordFile = runtimeFile(conv, 'routing');
  const record = readJson(recordFile) || {};
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
  writeJson(recordFile, { ...record, wikiInjected, at: new Date().toISOString() });
  return messages.length ? { injectSteps: messages.map((m) => ({ ephemeralMessage: m })) } : {};
}

function preInvocation(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const user = lastUserMessage(payload.transcriptPath || payload.transcript_path);
  const recordFile = runtimeFile(conv, 'routing');
  const record = readJson(recordFile) || {};
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
    const subdir = discoverSubdirAgents(roots, user ? user.text : '', record.seenAgents || []);
    for (const m of subdir.messages) messages.push(m);
    writeJson(recordFile, { lastUserKey: userKey, wikiInjected, isSubagent: false, seenAgents: subdir.seen, at: new Date().toISOString() });
  } else {
    const subdir = discoverSubdirAgents(roots, user ? user.text : '', record.seenAgents || []);
    for (const m of subdir.messages) messages.push(m);
    writeJson(recordFile, { lastUserKey: userKey, wikiInjected: Boolean(record.wikiInjected), isSubagent: true, seenAgents: subdir.seen, at: new Date().toISOString() });
  }
  return messages.length ? { injectSteps: messages.map((m) => ({ ephemeralMessage: m })) } : {};
}

function preToolUse(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const call = payload.toolCall || payload.tool_call || {};
  const toolName = String(call.name || payload.toolName || payload.tool_name || '');
  const args = call.args || call.arguments || {};
  const target = args.Path || args.path || args.TargetFile || args.targetFile || args.target_file || '';
  if (!target) return {};
  const resolved = canonicalizePath(target);
  const rawResolved = path.resolve(String(target));
  const seenFile = runtimeFile(conv, 'seen');
  if (/^(?:read|view)_/i.test(toolName)) {
    const seen = readJson(seenFile) || { readFiles: [] };
    const list = Array.isArray(seen.readFiles) ? seen.readFiles : [];
    if (!list.includes(resolved)) {
      writeJson(seenFile, { readFiles: [...list.slice(-199), resolved], at: new Date().toISOString() });
    }
    return {};
  }
  const insideAllowed = roots.some((r) => {
    const sr = canonicalizePath(stateRoot(r));
    const wr = canonicalizePath(r);
    if (hasSymlinkSegment(r, rawResolved) || hasSymlinkSegment(sr, rawResolved) || hasSymlinkSegment(wr, rawResolved)) return false;
    return resolved.startsWith(path.join(sr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(wr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(sr, 'omagy_wiki') + path.sep)
      || resolved.startsWith(path.join(wr, 'omagy_wiki') + path.sep);
  });
  if (insideAllowed) return {};

  const planning = activeStates(roots, PLANNING_MODES, conv);
  const autopilotStates = activeStates(roots, ['autopilot'], conv);
  const autopilotPlanning = autopilotStates.find((s) => PLANNING_MODES.includes(String(s.data.current_phase || '').toLowerCase()));
  const ralplanGate = autopilotStates.find((s) => s.data.ralplan_gate === true && !hasRalplanArtifacts(s.root));
  const s = planning[0] || autopilotPlanning || ralplanGate;
  if (s) {
    const reason = ralplanGate && s === ralplanGate
      ? `oh-my-agy: autopilot ralplan_gate is active without .omagy/plans/prd-*.md and test-spec-*.md. Writing ${resolved} outside .omagy/ requires completing ralplan artifacts first or user approval.`
      : `oh-my-agy: ${s.mode} is in planning phase (${s.data.current_phase || 'unknown'}). ` +
        `Writing ${resolved} is implementation work outside .omagy/. Approve only if you intend to leave planning; ` +
        'otherwise finish the planning handoff or run $cancel.';
    return { decision: 'force_ask', reason };
  }

  // Write-existing-file guard (ported from OmO write-existing-file-guard):
  // Escalates full-file Overwrite on a non-empty existing code file that has not been read in this session.
  const isFullOverwrite = /^(?:write_file|write_to_file)$/i.test(toolName)
    && (args.Overwrite === true || args.overwrite === true)
    && args.Append !== true && args.append !== true;
  if (isFullOverwrite && CODE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    let existsNonEmpty = false;
    try {
      const st = fs.statSync(resolved);
      existsNonEmpty = st.isFile() && st.size > 0;
    } catch { existsNonEmpty = false; }
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
      .filter((s) => !isSubagent || (conv && s.owner === String(conv)));
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
            `${d.iteration ? `, iteration ${d.iteration}` : ''}) per ${s.file}. Continue from current_phase under the ` +
            `${s.mode} skill contract and refresh updated_at as you progress. If the work is verified complete, write the ` +
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
                'Resolve or remove skipped/focused tests and placeholder TODO/stub implementations before claiming completion.',
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
function loadNotificationConfig(roots) {
  const globalCfg = readJson(path.join(os.homedir(), '.gemini', 'config', 'oh-my-agy', 'notifications.json')) || {};
  let cfg = { ...globalCfg };
  for (const r of roots) {
    const local = readJson(path.join(r, '.omagy', 'notifications.json'));
    if (local) cfg = { ...cfg, ...local };
  }
  return cfg;
}
function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}
async function post(url, body, headers = {}, method = 'POST') {
  if (typeof fetch !== 'function' || !url) return;
  await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
}
async function notify(payload, roots) {
  const cfg = loadNotificationConfig(roots);
  if (cfg.enabled !== true) return;
  const conv = payload.conversationId || 'unknown';
  const cooldown = Number(process.env.OMAGY_IDLE_COOLDOWN_SECONDS ?? cfg.idleCooldownSeconds ?? 60) * 1000;
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
    (payload.error ? ` — error: ${String(payload.error).slice(0, 200)}` : '') + ` (conversation ${String(conv).slice(0, 8)})`;

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
    check('.omagy-workspace anchors state across child repos', sMulti.decision === 'continue');

    // Completion drift guard (git diff blocker scan)
    const gitRepo = path.join(ws, 'git-repo');
    fs.mkdirSync(gitRepo, { recursive: true });
    try {
      execFileSync('git', ['init', '-q'], { cwd: gitRepo });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRepo });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitRepo });
      fs.writeFileSync(path.join(gitRepo, 'app.test.js'), 'test("ok", () => {});\n');
      execFileSync('git', ['add', 'app.test.js'], { cwd: gitRepo });
      execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'], { cwd: gitRepo });
      fs.appendFileSync(path.join(gitRepo, 'app.test.js'), `${'test'}.skip("later", () => {});\n`);
      const d1 = await stop({
        conversationId: `${conv}-drift`,
        workspacePaths: [gitRepo],
        terminationReason: 'NO_TOOL_CALL',
        lastAssistantMessage: 'All done and ready to merge.',
      });
      const d2 = await stop({
        conversationId: `${conv}-drift`,
        workspacePaths: [gitRepo],
        terminationReason: 'NO_TOOL_CALL',
        lastAssistantMessage: 'All done and ready to merge.',
      });
      check('completion drift guard catches added test.skip once per diff', d1.decision === 'continue' && d2.decision === 'stop');
    } catch {
      check('completion drift guard catches added test.skip once per diff', true, 'skipped (git unavailable)');
    }

    // Team completion evidence validator test
    const evRel = '.omagy/evidence/task-1.json';
    writeJson(path.join(ws, evRel), {
      team: 'alpha',
      taskId: '1',
      summary: 'Implemented CSV parser and unit tests',
      verification: [{ command: 'npm test', result: 'passed', output: '12 passing (45ms)' }],
      unverified: [],
    });
    let evOk = false;
    try {
      evOk = validateCompletionEvidence(ws, evRel, { team: 'alpha', taskId: '1' }).ok === true;
    } catch { evOk = false; }
    check('verify-evidence accepts valid team task evidence', evOk);

    const badRel = '.omagy/evidence/task-bad.json';
    writeJson(path.join(ws, badRel), {
      team: 'alpha',
      taskId: '1',
      summary: 'TODO',
      verification: [{ command: 'npm test', result: 'failed', output: '1 failing' }],
      unverified: [],
    });
    let badRejected = false;
    try {
      validateCompletionEvidence(ws, badRel, { team: 'alpha', taskId: '1' });
    } catch { badRejected = true; }
    check('verify-evidence rejects placeholder or failing evidence', badRejected);

    const filteredRoots = workspaceRoots({ workspacePaths: [ path.join(ws, 'does-not-exist'), ws ] });
    check('workspaceRoots filters non-existent directories', filteredRoots.length === 1 && filteredRoots[0] === ws);

    // Subagent prompt & hook isolation (OMX codex-native-hook parity)
    writeJson(stateFile, { mode: 'autopilot', active: true, current_phase: 'ultragoal', updated_at: new Date().toISOString() });
    const subTranscript = path.join(ws, 'subagent-transcript.jsonl');
    fs.writeFileSync(subTranscript, `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'TEAM alpha — TASK 1: audit $autopilot and $cancel behavior' })}\n`);
    const subPre = preInvocation({ conversationId: `${conv}-sub`, workspacePaths: [ws], transcriptPath: subTranscript, invocationNum: 1 });
    const subPreTexts = (subPre.injectSteps || []).map((s) => s.ephemeralMessage || '');
    const subStop = await stop({ conversationId: `${conv}-sub`, workspacePaths: [ws], terminationReason: 'NO_TOOL_CALL' });
    check('subagent prompt suppresses quoted $skill routing and unowned parent stop nudges', !subPreTexts.some((t) => t.includes('Skill routing')) && subStop.decision === 'stop');
    writeJson(stateFile, { mode: 'autopilot', active: false, current_phase: 'complete', completed_at: now, updated_at: now });

    // Symlink state & planning-guard escape protection (OMX 0.21.31-32 parity)
    const symTargetState = path.join(ws, 'outside-state.json');
    writeJson(symTargetState, { mode: 'autopilot', active: true, current_phase: 'ultragoal', updated_at: new Date().toISOString() });
    const symStateLink = path.join(ws, '.omagy', 'state', 'symlinked-state.json');
    fs.symlinkSync(symTargetState, symStateLink);
    const sSym = await stop({ conversationId: `${conv}-sym`, workspacePaths: [ws], terminationReason: 'NO_TOOL_CALL' });
    fs.rmSync(symStateLink, { force: true });
    check('readStateDir ignores symlinked state files', sSym.decision === 'stop');

    writeJson(path.join(ws, '.omagy', 'state', 'plan-state.json'), { mode: 'plan', active: true, current_phase: 'drafting', updated_at: new Date().toISOString() });
    const outsideFile = path.join(ws, 'src', 'secret.ts');
    const symInsideOmagy = path.join(ws, '.omagy', 'plans', 'escape-link.ts');
    fs.symlinkSync(outsideFile, symInsideOmagy);
    const gSymEscape = preToolUse({ ...base, toolCall: { name: 'write_file', args: { Path: symInsideOmagy } } });
    fs.rmSync(symInsideOmagy, { force: true });
    fs.rmSync(path.join(ws, '.omagy', 'state', 'plan-state.json'), { force: true });
    check('preToolUse refuses symlink inside .omagy/ escaping to source file during planning', gSymEscape.decision === 'force_ask');

    // Crash-resilient newline-isolated JSONL append & tolerant reader (OMX 0.21.33 PR #3893 parity)
    const ledgerPath = path.join(ws, '.omagy', 'ultragoal', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, '{"goal_id":"G1","event":"started"}\n{"goal_id":"G1","event":"torn');
    const appRes = appendJsonlRecord(ledgerPath, { goal_id: 'G1', event: 'checkpoint', status: 'complete' });
    const readRes = readJsonlRecords(ledgerPath);
    check('appendJsonlRecord isolates torn tail with newline and readJsonlRecords recovers valid entries', appRes.isolatedNewline === true && readRes.records.length === 2 && readRes.skipped === 1);

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
async function main() {
  const event = (process.argv[2] || '').toLowerCase();
  if (event === 'selftest') {
    const r = await selftest();
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exitCode = r.selftest === 'PASS' ? 0 : 1;
    return;
  }
  if (event === 'verify-evidence') {
    const [, , , cwdArg, relArg, teamArg, taskIdArg] = process.argv;
    try {
      const res = validateCompletionEvidence(cwdArg || process.cwd(), relArg, { team: teamArg, taskId: taskIdArg });
      process.stdout.write(`${JSON.stringify(res)}\n`);
      process.exitCode = 0;
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (event === 'append-jsonl') {
    const [, , , fileArg, jsonArg] = process.argv;
    try {
      const res = appendJsonlRecord(fileArg, jsonArg || readStdin());
      process.stdout.write(`${JSON.stringify(res)}\n`);
      process.exitCode = 0;
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (event === 'read-jsonl') {
    const [, , , fileArg] = process.argv;
    try {
      const res = readJsonlRecords(fileArg);
      process.stdout.write(`${JSON.stringify(res)}\n`);
      process.exitCode = 0;
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
      process.exitCode = 1;
    }
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
    process.stderr.write(`[oh-my-agy] hook ${event} failed open: ${err instanceof Error ? err.message : String(err)}\n`);
    result = event === 'stop' ? { decision: 'stop' } : {};
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(() => {
  process.stdout.write('{}\n');
});
