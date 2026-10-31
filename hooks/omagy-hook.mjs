#!/usr/bin/env node
// oh-my-agy lifecycle hook runner for Antigravity (tracks OMX v0.21.43, OMC v5.7.22, OMO v5.1.52).
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

// ---------- mode state & multi-repo root (ported from OMC worktree-paths / state-root + OMX 0.21.31-36 symlink & OMX_ROOT guard) ----------
function stateRoot(root) {
  const baseRoot = canonicalizePath(root || process.cwd());
  const envOverride = (process.env.OMAGY_ROOT || process.env.OMAGY_STATE_ROOT || '').trim();
  if (envOverride) {
    const resolved = canonicalizePath(path.isAbsolute(envOverride) ? envOverride : path.resolve(baseRoot, envOverride));
    return path.basename(resolved) === '.omagy' ? path.dirname(resolved) : resolved;
  }
  let cur = baseRoot;
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
  return baseRoot;
}
function omagyLogsDir(root) {
  return path.join(stateRoot(root), '.omagy', 'logs');
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

// ---------- wiki & working agreements summary (ported from OMX 0.21.18 + OmO v5.1.52 expiry & secret redaction) ----------
export function redactSecrets(text) {
  return String(text || '')
    .replace(/\bsk-(?:proj-|ant-[a-z0-9-]+-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(?:gh[pousr]|github_pat|glpat|xox[baprs])_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
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
    for (const dirName of ['omagy_wiki', 'omx_wiki']) {
      const indexPath = path.join(root, dirName, 'index.md');
      const agreementsPath = path.join(root, dirName, 'agreements.md');
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
          `[oh-my-agy] Working Agreements (${dirName}/agreements.md):`,
          ...agLines,
        );
      }
      if (idxLines.length) {
        parts.push(
          `[oh-my-agy] Project Wiki index (${dirName}/index.md):`,
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
  }
  return null;
}

// ---------- hierarchical subdirectory AGENTS.md discovery (ported from OmO directory-agents-injector) ----------
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
        for (const wikiDirName of ['omagy_wiki', 'omx_wiki']) {
          const childWikiDir = path.join(d, wikiDirName);
          if (seen.has(childWikiDir)) continue;
          let agRaw = '';
          let idxRaw = '';
          try { agRaw = fs.readFileSync(path.join(childWikiDir, 'agreements.md'), 'utf8').trim(); } catch { agRaw = ''; }
          try { idxRaw = fs.readFileSync(path.join(childWikiDir, 'index.md'), 'utf8').trim(); } catch { idxRaw = ''; }
          const agLines = filterAndRedactWikiLines(agRaw, 12, nowMs);
          const idxLines = filterAndRedactWikiLines(idxRaw, 15, nowMs);
          if (!agLines.length && !idxLines.length) continue;
          seen.add(childWikiDir);
          const relWiki = path.relative(root, childWikiDir);
          const parts = [`[oh-my-agy] Child-project Wiki (${relWiki}):`, ...agLines, ...idxLines];
          messages.push(parts.join('\n').slice(0, 1500));
        }
        if (messages.length >= 3) return { messages, seen: [...seen] };
      }
    }
  }
  return { messages, seen: [...seen] };
}

// ---------- team completion evidence validator (ported from OMX 0.21.18 + OMO v5.1.52 #11542 echo-argv receipt guard) ----------
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
  return { ok: true, file: target, taskId: evidence.taskId ?? null, team: teamVal ?? null };
}

// ---------- configurable custom quality gates (ported from OMX v0.21.41 #3956 & OMC v5.7.22 #4670/#4671) ----------
const QUALITY_GATE_STAGES = new Set(['deep-interview', 'ralplan', 'code-review']);
const RESERVED_GATE_SKILLS = new Set([
  'deep-interview', 'ralplan', 'code-review', 'ai-slop-cleaner', 'autopilot',
  'ultragoal', 'team', 'plan', 'ultraqa', 'cancel', 'verification',
]);
const SUNSET_GATE_SKILLS = new Set(['ralph', 'ultrawork', 'pipeline', 'ecomode', 'swarm']);
const VALID_GATE_MODELS = new Set(['inherit', 'flash', 'pro']);
export function validateQualityGates(cwd, requestedStage = '') {
  const sRoot = stateRoot(cwd || process.cwd());
  const cfgPath = fs.existsSync(path.join(sRoot, '.omagy', 'config.json'))
    ? path.join(sRoot, '.omagy', 'config.json')
    : path.join(sRoot, '.omx-config.json');
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

const FILE_MUTATION_TOOLS_RE = /^(?:write_file|write_to_file|edit_file|replace_file_content|multi_replace_file_content|multiedit|multi_edit|apply_patch|delete_file|move_file|rename_file)$/i;
function extractToolTargets(toolName, args) {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  for (const k of ['Path', 'path', 'TargetFile', 'targetFile', 'target_file', 'filePath', 'file_path', 'file',
    'rename', 'MoveTo', 'moveTo', 'move_to', 'destination', 'newPath', 'new_path', 'delete']) {
    push(args?.[k]);
  }
  if (Array.isArray(args?.edits)) {
    for (const e of args.edits) {
      if (e && typeof e === 'object') {
        for (const k of ['Path', 'path', 'filePath', 'file_path', 'file', 'rename', 'newPath']) push(e[k]);
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
  return roots.some((r) => {
    const sr = canonicalizePath(stateRoot(r));
    const wr = canonicalizePath(r);
    if (hasSymlinkSegment(r, rawResolved) || hasSymlinkSegment(sr, rawResolved) || hasSymlinkSegment(wr, rawResolved)) return false;
    return resolved.startsWith(path.join(sr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(wr, '.omagy') + path.sep)
      || resolved.startsWith(path.join(sr, 'omagy_wiki') + path.sep)
      || resolved.startsWith(path.join(wr, 'omagy_wiki') + path.sep);
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

  if (/^(?:read|view)_/i.test(toolName)) {
    if (!targets.length) return {};
    const resolved = canonicalizePath(targets[0]);
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

  // Fail closed when an explicit file-mutation tool has no recognizable target argument during active planning (OMO v5.1.49 #11369).
  if (!targets.length) {
    if (s && FILE_MUTATION_TOOLS_RE.test(toolName)) {
      return {
        decision: 'force_ask',
        reason: `oh-my-agy: ${s.mode} planning guard could not verify a target path for ${toolName}. Approve only if you intend to write outside .omagy/.`,
      };
    }
    return {};
  }

  const primaryResolved = canonicalizePath(targets[0]);

  // Working Agreements human-entry protection (OMO v5.1.45-49 #11112):
  // Escalates full Overwrite on omagy_wiki/agreements.md if it would drop existing [by:human] / (by: human) entries.
  const isFullOverwrite = /^(?:write_file|write_to_file)$/i.test(toolName)
    && (args.Overwrite === true || args.overwrite === true)
    && args.Append !== true && args.append !== true;
  const newContent = typeof (args.Content ?? args.content) === 'string' ? (args.Content ?? args.content) : null;
  if (isFullOverwrite && newContent !== null && /(?:^|[/\\])(?:omagy_wiki|omx_wiki)[/\\]agreements\.md$/i.test(primaryResolved)) {
    try {
      const prevRaw = fs.readFileSync(primaryResolved, 'utf8');
      const humanLines = prevRaw.split('\n').map((l) => l.trim()).filter((l) => /(?:\[by:\s*human\]|\(by:\s*human\)|\bby:\s*human\b)/i.test(l));
      const dropped = humanLines.find((hl) => !newContent.includes(hl));
      if (dropped) {
        return {
          decision: 'force_ask',
          reason: `oh-my-agy: agreements-guard — Overwriting ${primaryResolved} would remove or alter a human-authored agreement (${dropped.slice(0, 80)}). Preserve [by:human] entries or approve explicitly.`,
        };
      }
    } catch { /* ignore if file does not exist yet */ }
  }

  const outsideTarget = targets.find((t) => !isPathInsideAllowedOmagy(roots, t));
  if (!outsideTarget) return {};
  const resolved = canonicalizePath(outsideTarget);

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

    // Whole-integer env/config parser (OMC v5.7.15 #4599/#4600 parity)
    check('intOr validates whole safe integers and falls back on empty/negative/float/Infinity/NaN',
      intOr('120', 60) === 120 && intOr('0', 60, 0) === 0 && intOr('0', 60, 1) === 60
      && intOr('', 60, 0) === 60 && intOr('-5', 60, 0) === 60 && intOr('1.5', 60, 0) === 60
      && intOr('Infinity', 60, 0) === 60 && intOr('60s', 60, 0) === 60);

    // OMAGY_ROOT / OMAGY_STATE_ROOT override & omagyLogsDir (OMX v0.21.36 #3909 parity)
    const customStateRoot = path.join(ws, 'custom-omagy-root');
    fs.mkdirSync(customStateRoot, { recursive: true });
    process.env.OMAGY_STATE_ROOT = path.join(customStateRoot, '.omagy');
    const resolvedLogs = omagyLogsDir(ws);
    delete process.env.OMAGY_STATE_ROOT;
    check('OMAGY_STATE_ROOT overrides stateRoot and omagyLogsDir', resolvedLogs === path.join(canonicalizePath(customStateRoot), '.omagy', 'logs'));

    // detectSkills quote/code/blockquote/URL/negated/help-question suppression (OMC v5.7.13 & OMO v5.1.45 parity)
    const suppressedSkills = detectSkills('What does `$autopilot` or "$ralplan" do?\n> $team\n[a -> b] $ultragoal\ndo not use $ultraqa or https://example.com/$plan');
    const preservedLead = detectSkills('$ralplan: design the API using ```js\nconst s = "$team";\n``` and do not use $autopilot');
    const suppressedLeadHelp = detectSkills('$ralplan: how do I use this skill?');
    check('detectSkills suppresses quoted/code/negated/help mentions while preserving leading invocation',
      suppressedSkills.length === 0 && preservedLead.length === 1 && preservedLead[0] === 'ralplan' && suppressedLeadHelp.length === 0);

    // Child-project omagy_wiki discovery (OMO v5.1.45-47 #10921/#11165 parity)
    const childPkgWiki = path.join(ws, 'packages', 'billing', 'omagy_wiki');
    fs.mkdirSync(childPkgWiki, { recursive: true });
    fs.writeFileSync(path.join(childPkgWiki, 'agreements.md'), '- [by:human] All billing amounts use integer cents.\n');
    const childDisc = discoverSubdirAgents([ws], 'inspect packages/billing/src/charge.ts', []);
    check('discoverSubdirAgents surfaces child-project omagy_wiki once',
      childDisc.messages.some((m) => m.includes('Child-project Wiki') && m.includes('integer cents')));

    // Planning guard multi-target (rename / apply_patch) & fail-closed on missing target (OMO v5.1.49 #11369 parity)
    writeJson(path.join(ws, '.omagy', 'state', 'plan-state.json'), { mode: 'plan', active: true, current_phase: 'drafting', updated_at: new Date().toISOString() });
    const gRenameEscape = preToolUse({
      ...base,
      toolCall: { name: 'edit_file', args: { Path: path.join(ws, '.omagy', 'plans', 'draft.md'), rename: path.join(ws, 'src', 'escaped.ts') } },
    });
    const gPatchEscape = preToolUse({
      ...base,
      toolCall: { name: 'apply_patch', args: { patchText: `*** Update File: ${path.join(ws, 'src', 'index.ts')}\n@@\n` } },
    });
    const gMissingTarget = preToolUse({
      ...base,
      toolCall: { name: 'write_file', args: {} },
    });
    fs.rmSync(path.join(ws, '.omagy', 'state', 'plan-state.json'), { force: true });
    check('planning guard catches rename/apply_patch escapes and fails closed on targetless write_file',
      gRenameEscape.decision === 'force_ask' && gPatchEscape.decision === 'force_ask' && gMissingTarget.decision === 'force_ask');

    // Working Agreements [by:human] overwrite protection (OMO v5.1.45-49 #11112 parity)
    const agFile = path.join(ws, 'omagy_wiki', 'agreements.md');
    fs.writeFileSync(agFile, '- [by:human] Never mutate production tables directly.\n');
    const gDropHuman = preToolUse({
      ...base,
      toolCall: { name: 'write_file', args: { Path: agFile, Overwrite: true, Content: '- [v2] Only automated rule.\n' } },
    });
    const gKeepHuman = preToolUse({
      ...base,
      toolCall: { name: 'write_file', args: { Path: agFile, Overwrite: true, Content: '- [by:human] Never mutate production tables directly.\n- [v2] Added rule.\n' } },
    });
    check('agreements-guard blocks Overwrite dropping [by:human] line and allows preserving it',
      gDropHuman.decision === 'force_ask' && !gKeepHuman.decision);

    // Stop continuation includes refusal-is-final rule (OMO v5.1.49 #11371 parity)
    check('stop continuation prompt includes refusal-is-final rule',
      typeof s1.reason === 'string' && s1.reason.includes('permission denial or a refusal by the user is final'));

    // Echo / printf / true no-op verification command guard (OMO v5.1.52 #11542 parity)
    const echoRel = '.omagy/evidence/task-echo.json';
    writeJson(path.join(ws, echoRel), {
      team: 'alpha',
      taskId: '1',
      summary: 'Implemented feature',
      verification: [{ command: 'echo "all tests passed"', result: 'passed', output: 'all tests passed' }],
      unverified: [],
    });
    let echoRejected = false;
    try {
      validateCompletionEvidence(ws, echoRel, { team: 'alpha', taskId: '1' });
    } catch { echoRejected = true; }
    check('verify-evidence rejects echo/printf/true no-op verification commands', echoRejected && !isRealVerificationCommand('env FOO=1 echo ok') && isRealVerificationCommand('env NODE_ENV=test npm test'));

    // Time-boxed wiki/agreement expiry & standalone secret redaction (OMO v5.1.52 #11458 & #11556 parity)
    const expWikiRoot = path.join(ws, 'exp-wiki-ws');
    const expWikiDir = path.join(expWikiRoot, 'omagy_wiki');
    fs.mkdirSync(expWikiDir, { recursive: true });
    fs.writeFileSync(path.join(expWikiDir, 'agreements.md'), [
      '- [by:human] Keep active rule [expires: 2099-01-01] with token ghp_1234567890abcdefghij123456.',
      '- [by:agent] Old temporary freeze [expires: 2020-01-01].',
    ].join('\n'));
    fs.writeFileSync(path.join(expWikiDir, 'index.md'), '---\nexpires: 2020-01-01T00:00:00Z\n---\n- [[old-page]] — Expired index\n');
    const expSummary = loadWikiSummary([expWikiRoot]) || '';
    check('loadWikiSummary skips expired frontmatter/inline entries and redacts standalone secrets',
      expSummary.includes('Keep active rule')
      && expSummary.includes('[REDACTED_TOKEN]')
      && !expSummary.includes('ghp_1234567890abcdefghij123456')
      && !expSummary.includes('Old temporary freeze')
      && !expSummary.includes('Expired index'));

    // Child-project wiki expiry & secret redaction
    const childExpDir = path.join(expWikiRoot, 'packages', 'auth', 'omagy_wiki');
    fs.mkdirSync(childExpDir, { recursive: true });
    fs.writeFileSync(path.join(childExpDir, 'agreements.md'), '- Active auth rule sk-proj-1234567890abcdefghijklmnop\n- Expired auth rule (expires: 2021-05-01)\n');
    const childExpRes = discoverSubdirAgents([expWikiRoot], 'check packages/auth/login.ts', []);
    const childExpMsg = childExpRes.messages[0] || '';
    check('discoverSubdirAgents skips expired child-wiki entries and redacts standalone secrets',
      childExpMsg.includes('[REDACTED_KEY]') && !childExpMsg.includes('sk-proj-1234567890') && !childExpMsg.includes('Expired auth rule'));

    // Configurable Custom Quality Gates validator (OMX v0.21.41 #3956 & OMC v5.7.22 #4670/#4671 parity)
    const qgRoot = path.join(ws, 'qg-ws');
    fs.mkdirSync(path.join(qgRoot, '.omagy'), { recursive: true });
    const qgNoop = validateQualityGates(qgRoot, 'ralplan');
    writeJson(path.join(qgRoot, '.omagy', 'config.json'), {
      qualityGates: {
        ralplan: ['better-interface', { skill: '$security-audit', mode: 'advisory', model: 'pro' }],
      },
    });
    const qgValid = validateQualityGates(qgRoot, 'ralplan');
    check('validateQualityGates returns strict no-op when unconfigured and normalizes valid gates',
      qgNoop.ok === true && qgNoop.gates.length === 0
      && qgValid.ok === true && qgValid.gates.length === 2
      && qgValid.gates[0].skill === 'better-interface' && qgValid.gates[0].mode === 'blocking'
      && qgValid.gates[1].skill === 'security-audit' && qgValid.gates[1].mode === 'advisory' && qgValid.gates[1].model === 'pro');

    writeJson(path.join(qgRoot, '.omagy', 'config.json'), {
      qualityGates: {
        ralplan: ['ralplan', 'ralph'],
        review: ['security-audit'],
      },
    });
    const qgInvalid = validateQualityGates(qgRoot);
    check('validateQualityGates rejects self-recursive controller skills, sunset skills, and legacy stage keys',
      qgInvalid.ok === false && qgInvalid.errors.length === 3);

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
  if (event === 'quality-gates') {
    const [, , , cwdArg, stageArg] = process.argv;
    const res = validateQualityGates(cwdArg || process.cwd(), stageArg || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    process.exitCode = res.ok ? 0 : 1;
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
    } catch { /* fail open */ }
    result = event === 'stop' ? { decision: 'stop' } : {};
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(() => {
  process.stdout.write('{}\n');
});
