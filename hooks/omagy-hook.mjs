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
import { spawn } from 'node:child_process';

const SKILLS = [
  'ai-slop-cleaner', 'analyze', 'ask', 'autopilot', 'autoresearch', 'best-practice-research',
  'cancel', 'code-review', 'configure-notifications', 'deep-interview', 'design', 'doctor', 'hud',
  'omagy-setup', 'performance-goal', 'plan', 'ralplan', 'skill', 'team', 'ultragoal', 'ultraqa',
  'visual-ralph', 'wiki',
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

// ---------- mode state ----------
function loadModeStates(root) {
  const dir = path.join(root, '.omagy', 'state');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const m = /^(.+)-state\.json$/.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    const data = readJson(file);
    if (!data || typeof data !== 'object') continue;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    out.push({ mode: String(data.mode || m[1]), file, data, mtimeMs, root });
  }
  return out;
}
function updatedMs(s) {
  return Date.parse(s.data.updated_at || '') || s.mtimeMs || 0;
}
function isActive(s, now = Date.now()) {
  const d = s.data;
  if (!d || d.active !== true) return false;
  if (TERMINAL.has(String(d.current_phase || '').toLowerCase())) return false;
  if (typeof d.completed_at === 'string' && d.completed_at.trim()) return false;
  return now - updatedMs(s) <= STALE_MS;
}
function activeStates(roots, modes) {
  const now = Date.now();
  const all = roots.flatMap(loadModeStates).filter((s) => isActive(s, now));
  const filtered = modes ? all.filter((s) => modes.includes(s.mode)) : all;
  const order = modes || CONTINUATION_MODES;
  return filtered.sort((a, b) => {
    const ia = order.indexOf(a.mode); const ib = order.indexOf(b.mode);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// ---------- wiki summary (ported from OMX 0.21.18 wiki/lifecycle.js) ----------
function loadWikiSummary(roots) {
  for (const root of roots) {
    for (const dirName of ['omagy_wiki', 'omx_wiki']) {
      const indexPath = path.join(root, dirName, 'index.md');
      let raw = '';
      try { raw = fs.readFileSync(indexPath, 'utf8').trim(); } catch { continue; }
      if (!raw) continue;
      const lines = raw.split('\n').slice(0, MAX_WIKI_CONTEXT_LINES);
      const summary = [
        `[oh-my-agy] Project Wiki index (${dirName}/index.md):`,
        ...lines,
      ].join('\n');
      if (summary.length <= MAX_WIKI_CONTEXT_CHARS) return summary;
      const notice = '\n[Wiki index truncated; use $wiki read or $wiki query for more.]';
      const bounded = summary.slice(0, MAX_WIKI_CONTEXT_CHARS - notice.length);
      const lastNewline = bounded.lastIndexOf('\n');
      return (lastNewline > 0 ? bounded.slice(0, lastNewline) : bounded) + notice;
    }
  }
  return null;
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
function buildActiveModeMessage(roots) {
  const active = activeStates(roots, null);
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

  const activeMsg = buildActiveModeMessage(roots);
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

  const messages = [];
  const skills = user ? detectSkills(user.text) : [];
  if (skills.length) {
    messages.push(
      `[oh-my-agy] Skill routing: the user explicitly invoked ${skills.map((s) => `$${s}`).join(', ')}. ` +
      'Activate these oh-my-agy skills left-to-right: read each SKILL.md from the oh-my-agy plugin before acting, ' +
      'and treat the rest of the user message as the task.',
    );
  }
  const activeMsg = buildActiveModeMessage(roots);
  if (activeMsg) messages.push(activeMsg);

  let wikiInjected = Boolean(record.wikiInjected);
  if (!wikiInjected) {
    const wikiMsg = loadWikiSummary(roots);
    if (wikiMsg) {
      messages.push(wikiMsg);
      wikiInjected = true;
    }
  }
  writeJson(recordFile, { lastUserKey: userKey, wikiInjected, at: new Date().toISOString() });
  return messages.length ? { injectSteps: messages.map((m) => ({ ephemeralMessage: m })) } : {};
}

function preToolUse(payload) {
  const roots = workspaceRoots(payload);
  const call = payload.toolCall || payload.tool_call || {};
  const args = call.args || call.arguments || {};
  const target = args.TargetFile || args.targetFile || args.target_file || '';
  const planning = activeStates(roots, PLANNING_MODES);
  if (!planning.length || !target) return {};
  const resolved = path.resolve(String(target));
  const insideOmagy = roots.some((r) => resolved.startsWith(path.join(path.resolve(r), '.omagy') + path.sep));
  if (insideOmagy) return {};
  const s = planning[0];
  return {
    decision: 'force_ask',
    reason: `oh-my-agy: ${s.mode} is a planning mode (phase: ${s.data.current_phase || 'unknown'}). ` +
      `Writing ${resolved} is implementation work outside .omagy/. Approve only if you intend to leave planning; ` +
      'otherwise finish the planning handoff or run $cancel.',
  };
}

async function stop(payload) {
  const roots = workspaceRoots(payload);
  const conv = payload.conversationId || payload.conversation_id;
  const rawReason = String(payload.terminationReason ?? payload.termination_reason ?? 'NO_TOOL_CALL').trim().toLowerCase();
  const isNormalStop = NORMAL_STOP_REASONS.has(rawReason);
  const allow = { decision: 'stop' };

  let decision = allow;
  if (isNormalStop && payload.fullyIdle !== false && !payload.error) {
    const active = activeStates(roots, CONTINUATION_MODES);
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

    // Wiki index bounded injection + routing test
    const wikiDir = path.join(ws, 'omagy_wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const longWiki = Array.from({ length: 80 }, (_, i) => `- [[page-${i}]] — Page ${i} — architecture — ${'x'.repeat(60)}`).join('\n');
    fs.writeFileSync(path.join(wikiDir, 'index.md'), longWiki);

    const transcript = path.join(ws, 'transcript.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'please $autopilot then $code-review, not /plan or $nonexistent' })}\n`);
    const p1 = preInvocation({ ...base, transcriptPath: transcript, invocationNum: 1 });
    const stepTexts = (p1.injectSteps || []).map((s) => s.ephemeralMessage || '');
    const routeMsg = stepTexts[0] || '';
    const wikiMsg = stepTexts.find((t) => t.includes('Project Wiki index')) || '';
    check('pre-invocation routes $skills in order', routeMsg.includes('$autopilot, $code-review') && !routeMsg.includes('$plan') && !routeMsg.includes('nonexistent'), routeMsg.slice(0, 100));
    check('pre-invocation injects bounded wiki index (<=3500 chars)', wikiMsg.length > 0 && wikiMsg.length <= MAX_WIKI_CONTEXT_CHARS && wikiMsg.includes('Wiki index truncated'), `len=${wikiMsg.length}`);
    check('pre-invocation injects once per user message', Object.keys(preInvocation({ ...base, transcriptPath: transcript, invocationNum: 2 })).length === 0);

    // Next user message should not re-inject wiki index in the same session
    fs.appendFileSync(transcript, `${JSON.stringify({ step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'now $analyze this' })}\n`);
    const p2 = preInvocation({ ...base, transcriptPath: transcript, invocationNum: 3 });
    const p2Texts = (p2.injectSteps || []).map((s) => s.ephemeralMessage || '');
    check('wiki index injects at most once per conversation', p2Texts.some((t) => t.includes('$analyze')) && !p2Texts.some((t) => t.includes('Project Wiki index')));

    writeJson(path.join(ws, '.omagy', 'state', 'ralplan-state.json'), { mode: 'ralplan', active: true, current_phase: 'architect-review', updated_at: new Date().toISOString() });
    const g1 = preToolUse({ ...base, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(ws, 'src', 'index.ts') } } });
    const g2 = preToolUse({ ...base, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(ws, '.omagy', 'plans', 'prd.md') } } });
    check('planning guard escalates implementation writes', g1.decision === 'force_ask');
    check('planning guard ignores .omagy writes', !g2.decision);

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
