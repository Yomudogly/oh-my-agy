#!/usr/bin/env node
// oh-my-agy HUD Sidecar (UI Extension for Antigravity Auxiliary Pane).
// Strictly read-only status & artifact board (OMX #3963 zero-mutation invariant) serving
// `sidecar://oh-my-agy/hud/` (`?view=overview|ultragoal|team|interview|reviews|benchmarks|visual-ralph|loft|wiki|doctor`).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets, readJsonlRecords, validateQualityGates } from '../../hooks/omagy-hook.mjs';

const BIND_HOST = '127.0.0.1';
const STALE_MS = 6 * 3600 * 1000;
const TEAM_COMPLETED_WINDOW_MS = 20 * 60 * 1000;
const TERMINAL = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
const WIKI_CATEGORIES = new Set(['architecture', 'decision', 'pattern', 'debugging', 'environment', 'session-log', 'reference', 'convention']);
const ALLOWED_VIEWS = ['overview', 'ultragoal', 'team', 'interview', 'reviews', 'benchmarks', 'visual-ralph', 'loft', 'wiki', 'doctor'];

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function readJsonSafe(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextSafe(filePath, maxBytes = 64 * 1024) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return '';
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
  } catch {
    return '';
  }
}

function uriToFsPath(uriOrPath) {
  const raw = String(uriOrPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file://')) {
    try { return fileURLToPath(raw); } catch { return ''; }
  }
  return path.isAbsolute(raw) ? raw : '';
}

function resolveStateRoot(rawRoot) {
  let cur = path.resolve(rawRoot);
  for (let i = 0; i < 8; i += 1) {
    try {
      if (fs.existsSync(path.join(cur, '.omagy-workspace')) || fs.existsSync(path.join(cur, '.omc-workspace'))) {
        return cur;
      }
    } catch { /* ignore */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(rawRoot);
}

export function resolveSafeArtifactFile(workspaceRoot, relPath) {
  const cleanRel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('\0') || cleanRel.split('/').includes('..')) return null;
  if (!cleanRel.startsWith('.omagy/artifacts/visual-ralph/') && !cleanRel.startsWith('.omagy/artifacts/loft/')) {
    return null;
  }
  const ext = path.extname(cleanRel).toLowerCase();
  if (!MIME_BY_EXT[ext]) return null;
  try {
    const rootReal = fs.realpathSync(resolveStateRoot(workspaceRoot));
    const allowedBase = path.join(rootReal, '.omagy', 'artifacts');
    const candidate = path.resolve(rootReal, cleanRel);
    const st = fs.lstatSync(candidate);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const candidateReal = fs.realpathSync(candidate);
    if (!candidateReal.startsWith(allowedBase + path.sep)) return null;
    return { filePath: candidateReal, mime: MIME_BY_EXT[ext] };
  } catch {
    return null;
  }
}

function readModeFilesInDir(dir, sessionLabel = 'shared') {
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
    const data = readJsonSafe(file);
    if (!data || typeof data !== 'object') continue;
    const updatedMs = Date.parse(data.updated_at || '') || st.mtimeMs || 0;
    const phase = String(data.current_phase || 'unknown');
    const isTerminal = TERMINAL.has(phase.toLowerCase()) || Boolean(data.completed_at);
    const isStale = Boolean(data.active === true && !isTerminal && Date.now() - updatedMs > STALE_MS);
    out.push({
      mode: String(data.mode || m[1]),
      active: data.active === true && !isTerminal,
      phase,
      iteration: data.iteration ?? null,
      updatedAt: data.updated_at || new Date(st.mtimeMs).toISOString(),
      updatedMs,
      stale: isStale,
      session: sessionLabel,
      owner: String(data.owner_conversation_id || data.conversation_id || ''),
      raw: data,
    });
  }
  return out;
}

function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { meta: null, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: m[2] };
}

export function buildHudSnapshot(rawWorkspaces = [], nowMs = Date.now()) {
  const candidates = [];
  for (const w of rawWorkspaces) {
    const p = uriToFsPath(w);
    if (p && fs.existsSync(p) && !candidates.includes(p)) candidates.push(p);
  }
  if (!candidates.length && process.env.OMAGY_WORKSPACE && fs.existsSync(process.env.OMAGY_WORKSPACE)) {
    candidates.push(process.env.OMAGY_WORKSPACE);
  }
  if (!candidates.length && fs.existsSync(process.cwd())) {
    candidates.push(process.cwd());
  }

  const roots = [...new Set(candidates.map(resolveStateRoot))];
  const primaryRoot = roots[0] || process.cwd();
  const allModeRecords = [];
  const seenModeKeys = new Set();

  for (const root of roots) {
    const stateDir = path.join(root, '.omagy', 'state');
    for (const m of readModeFilesInDir(stateDir, 'shared')) {
      const k = `${root}:shared:${m.mode}`;
      if (!seenModeKeys.has(k)) { seenModeKeys.add(k); allModeRecords.push(m); }
    }
    const sessionsDir = path.join(stateDir, 'sessions');
    try {
      if (fs.existsSync(sessionsDir) && !fs.lstatSync(sessionsDir).isSymbolicLink()) {
        const sessEntries = fs.readdirSync(sessionsDir)
          .map((name) => {
            const p = path.join(sessionsDir, name);
            try {
              const st = fs.lstatSync(p);
              return st.isDirectory() && !st.isSymbolicLink() ? { name, path: p, mtimeMs: st.mtimeMs } : null;
            } catch { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 5);
        for (const sess of sessEntries) {
          for (const m of readModeFilesInDir(sess.path, sess.name.slice(0, 12))) {
            const k = `${root}:${sess.name}:${m.mode}`;
            if (!seenModeKeys.has(k)) { seenModeKeys.add(k); allModeRecords.push(m); }
          }
        }
      }
    } catch { /* ignore */ }
  }

  const modes = allModeRecords.map(({ raw: _raw, ...rest }) => rest);

  // 1. Ultragoal summary
  let ultragoal = null;
  const goalsPath = path.join(primaryRoot, '.omagy', 'ultragoal', 'goals.json');
  const goalsData = readJsonSafe(goalsPath);
  if (goalsData && Array.isArray(goalsData.goals)) {
    const ledgerPath = path.join(primaryRoot, '.omagy', 'ultragoal', 'ledger.jsonl');
    let recentLedger = [];
    try {
      if (fs.existsSync(ledgerPath)) {
        recentLedger = readJsonlRecords(ledgerPath).records.slice(-8).reverse();
      }
    } catch { recentLedger = []; }
    const goals = goalsData.goals.map((g) => ({
      id: String(g.id || ''),
      title: String(g.title || g.objective || ''),
      rigor: String(g.rigor || 'light'),
      status: String(g.status || 'pending'),
      dependsOn: Array.isArray(g.depends_on) ? g.depends_on : [],
      productFailures: Number(g.product_failures || 0),
    }));
    const counts = { total: goals.length, complete: 0, inProgress: 0, pending: 0, blocked: 0, failed: 0 };
    for (const g of goals) {
      if (g.status === 'complete' || g.status === 'completed') counts.complete += 1;
      else if (g.status === 'in_progress') counts.inProgress += 1;
      else if (g.status === 'blocked') counts.blocked += 1;
      else if (g.status === 'failed') counts.failed += 1;
      else counts.pending += 1;
    }
    ultragoal = {
      objective: String(goalsData.objective || ''),
      updatedAt: String(goalsData.updated_at || ''),
      counts,
      goals,
      recentLedger,
    };
  }

  // 2. Team boards summary (including 20-minute completed window per OMC #4661/#4662)
  const teams = [];
  const teamRoot = path.join(primaryRoot, '.omagy', 'state', 'team');
  try {
    if (fs.existsSync(teamRoot) && !fs.lstatSync(teamRoot).isSymbolicLink()) {
      for (const slug of fs.readdirSync(teamRoot)) {
        const dir = path.join(teamRoot, slug);
        const tasksFile = path.join(dir, 'tasks.json');
        const manifestFile = path.join(dir, 'manifest.json');
        const board = readJsonSafe(tasksFile) || readJsonSafe(manifestFile);
        if (!board || typeof board !== 'object') continue;
        const tasks = Array.isArray(board.tasks) ? board.tasks : [];
        const updatedMs = Date.parse(board.updated_at || '') || 0;
        const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed' || t.status === 'complete');
        if (allDone && updatedMs > 0 && nowMs - updatedMs > TEAM_COMPLETED_WINDOW_MS) continue;
        teams.push({
          team: String(board.team || slug),
          objective: String(board.objective || ''),
          updatedAt: String(board.updated_at || ''),
          tasks: tasks.map((t) => ({
            id: String(t.id || ''),
            title: String(t.title || ''),
            role: String(t.role || 'team-worker'),
            model: String(t.model || 'inherit'),
            status: String(t.status || 'pending'),
            dependsOn: Array.isArray(t.depends_on) ? t.depends_on : [],
            requiresCodeChange: Boolean(t.requires_code_change),
            hasEvidence: fs.existsSync(path.join(primaryRoot, '.omagy', 'evidence', `task-${t.id}.json`)),
          })),
        });
      }
    }
  } catch { /* ignore */ }

  // 3. Deep Interview Ambiguity & Readiness Radar
  let interview = null;
  const diRecord = allModeRecords.find((m) => m.mode === 'deep-interview')
    || allModeRecords.find((m) => m.mode === 'autopilot' && m.raw?.state?.deep_interview);
  if (diRecord) {
    const st = diRecord.mode === 'deep-interview' ? (diRecord.raw?.state || {}) : (diRecord.raw?.state?.deep_interview || {});
    const roundsRaw = Array.isArray(st.rounds) ? st.rounds : [];
    const latestRound = roundsRaw.length ? roundsRaw[roundsRaw.length - 1] : null;
    const dimensions = latestRound?.scores || st.scores || st.dimensions || {};
    const gatesRaw = st.readiness_gates || {};
    interview = {
      slug: String(st.slug || ''),
      profile: String(st.profile || 'standard'),
      type: String(st.type || 'brownfield'),
      active: diRecord.active,
      phase: diRecord.phase,
      currentAmbiguity: typeof st.current_ambiguity === 'number' ? st.current_ambiguity : 1.0,
      threshold: typeof st.threshold === 'number' ? st.threshold : 0.2,
      maxRounds: Number(st.max_rounds || 12),
      currentStage: String(st.current_stage || 'intent-first'),
      currentFocus: String(st.current_focus || 'intent'),
      challengeModesUsed: Array.isArray(st.challenge_modes_used) ? st.challenge_modes_used.map(String) : [],
      dimensions,
      readinessGates: {
        nonGoals: Boolean(gatesRaw.non_goals ?? gatesRaw.nonGoals ?? false),
        decisionBoundaries: Boolean(gatesRaw.decision_boundaries ?? gatesRaw.decisionBoundaries ?? false),
        pressurePass: Boolean(gatesRaw.pressure_pass ?? gatesRaw.pressurePass ?? false),
        closureAudit: Boolean(gatesRaw.closure_audit ?? gatesRaw.closureAudit ?? false),
      },
      rounds: roundsRaw.slice(-10).map((r, idx) => ({
        round: Number(r.round || idx + 1),
        target: String(r.target || r.dimension || ''),
        label: String(r.label || '[from-user]'),
        question: redactSecrets(String(r.question || '')),
        answer: redactSecrets(String(r.answer || '')),
        ambiguity: typeof r.ambiguity === 'number' ? r.ambiguity : null,
      })),
    };
  }

  // 4. Ralplan / Hyperplan Consensus & Code Review Gate Board
  const reviews = { ralplan: null, hyperplan: [], codeReviews: [] };
  const rpRecord = allModeRecords.find((m) => m.mode === 'ralplan')
    || allModeRecords.find((m) => m.mode === 'autopilot' && (m.raw?.state?.ralplan || m.raw?.handoff_artifacts?.ralplan));
  if (rpRecord) {
    const ho = rpRecord.raw?.handoff_artifacts?.ralplan || rpRecord.raw?.state?.ralplan || rpRecord.raw?.state || {};
    reviews.ralplan = {
      active: rpRecord.active,
      phase: rpRecord.phase,
      iteration: rpRecord.iteration ?? 1,
      architectVerdict: String(ho.ralplan_architect_review?.verdict || ho.architect_verdict || 'pending'),
      criticVerdict: String(ho.ralplan_critic_review?.verdict || ho.critic_verdict || 'pending'),
      consensusComplete: Boolean(ho.ralplan_consensus_gate?.complete ?? ho.consensus_complete ?? false),
      executionAuthorized: Boolean(ho.ralplan_execution_handoff?.authorized ?? ho.execution_authorized ?? false),
      planningArtifacts: Array.isArray(ho.planning_artifacts) ? ho.planning_artifacts.map(String) : [],
    };
  }
  const plansDir = path.join(primaryRoot, '.omagy', 'plans');
  try {
    if (fs.existsSync(plansDir) && !fs.lstatSync(plansDir).isSymbolicLink()) {
      for (const name of fs.readdirSync(plansDir)) {
        if (name.startsWith('hyperplan-distillation-') && name.endsWith('.md')) {
          const text = readTextSafe(path.join(plansDir, name));
          const survives = (text.match(/\bSURVIVES\b/g) || []).length;
          const weakened = (text.match(/\bWEAKENED\b/g) || []).length;
          const killed = (text.match(/\bKILLED\b/g) || []).length;
          reviews.hyperplan.push({
            file: `.omagy/plans/${name}`,
            survives,
            weakened,
            killed,
          });
        } else if (name.startsWith('ralplan-review-') && name.endsWith('.md') && !reviews.ralplan) {
          const text = readTextSafe(path.join(plansDir, name));
          const archMatch = /architect[^\n:]*:\s*(APPROVE|CLEAR|WATCH|BLOCK|ITERATE|REJECT)/i.exec(text);
          const critMatch = /critic[^\n:]*:\s*(APPROVE|ITERATE|REJECT)/i.exec(text);
          reviews.ralplan = {
            active: false,
            phase: 'complete',
            iteration: 1,
            architectVerdict: archMatch ? archMatch[1].toUpperCase() : 'recorded',
            criticVerdict: critMatch ? critMatch[1].toUpperCase() : 'recorded',
            consensusComplete: Boolean(critMatch && critMatch[1].toUpperCase() === 'APPROVE'),
            executionAuthorized: false,
            planningArtifacts: [`.omagy/plans/${name}`],
          };
        }
      }
    }
  } catch { /* ignore */ }

  const artifactsDir = path.join(primaryRoot, '.omagy', 'artifacts');
  try {
    if (fs.existsSync(artifactsDir) && !fs.lstatSync(artifactsDir).isSymbolicLink()) {
      for (const name of fs.readdirSync(artifactsDir)) {
        if (name.startsWith('code-review-') && name.endsWith('.md')) {
          const text = readTextSafe(path.join(artifactsDir, name));
          const archMatch = /Architectural Status:\s*(CLEAR|WATCH|BLOCK)/i.exec(text);
          const recMatch = /RECOMMENDATION:\s*(APPROVE|REQUEST CHANGES|COMMENT)/i.exec(text);
          const filesMatch = /Files Reviewed:\s*([0-9]+)/i.exec(text);
          const issuesMatch = /Total Issues:\s*([0-9]+)/i.exec(text);
          reviews.codeReviews.push({
            file: `.omagy/artifacts/${name}`,
            architectStatus: archMatch ? archMatch[1].toUpperCase() : 'UNKNOWN',
            recommendation: recMatch ? recMatch[1].toUpperCase() : 'UNKNOWN',
            filesReviewed: filesMatch ? Number(filesMatch[1]) : 0,
            totalIssues: issuesMatch ? Number(issuesMatch[1]) : 0,
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 5. Benchmarks: Performance Goals & Autoresearch
  const benchmarks = { performanceGoals: [], autoresearch: [] };
  const perfRoot = path.join(primaryRoot, '.omagy', 'goals', 'performance');
  try {
    if (fs.existsSync(perfRoot) && !fs.lstatSync(perfRoot).isSymbolicLink()) {
      for (const slug of fs.readdirSync(perfRoot)) {
        const dir = path.join(perfRoot, slug);
        const stData = readJsonSafe(path.join(dir, 'state.json'));
        if (!stData || typeof stData !== 'object') continue;
        const cpFile = path.join(dir, 'checkpoints.jsonl');
        const checkpoints = fs.existsSync(cpFile) ? readJsonlRecords(cpFile).records.slice(-10) : [];
        benchmarks.performanceGoals.push({
          slug: String(stData.slug || slug),
          objective: String(stData.objective || ''),
          evaluatorCommand: String(stData.evaluator_command || ''),
          evaluatorContract: String(stData.evaluator_contract || ''),
          status: String(stData.status || 'active'),
          baseline: stData.baseline ?? null,
          lastValidation: stData.lastValidation ?? null,
          checkpoints: checkpoints.map((c) => ({
            at: String(c.at || ''),
            status: String(c.status || 'unknown'),
            patch: redactSecrets(String(c.patch || '')),
            evidence: redactSecrets(String(c.evidence || '')),
          })),
        });
      }
    }
  } catch { /* ignore */ }

  const specsDir = path.join(primaryRoot, '.omagy', 'specs');
  try {
    if (fs.existsSync(specsDir) && !fs.lstatSync(specsDir).isSymbolicLink()) {
      for (const name of fs.readdirSync(specsDir)) {
        if (!name.startsWith('autoresearch-')) continue;
        const dir = path.join(specsDir, name);
        let st;
        try { st = fs.lstatSync(dir); } catch { continue; }
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        const slug = name.slice('autoresearch-'.length);
        const resultData = readJsonSafe(path.join(dir, 'result.json')) || {};
        const completionData = readJsonSafe(path.join(dir, 'completion.json')) || {};
        const reportText = readTextSafe(path.join(dir, 'report.md'));
        const verifiedCount = (reportText.match(/\[VERIFIED\]/g) || []).length;
        const derivedCount = (reportText.match(/\[DERIVED\]/g) || []).length;
        const assumedCount = (reportText.match(/\[ASSUMED\]/g) || []).length;
        benchmarks.autoresearch.push({
          slug,
          launchReady: Boolean(resultData.launchReady ?? false),
          passed: Boolean(completionData.passed || completionData.architect_review?.verdict === 'approved'),
          status: String(completionData.status || completionData.architect_review?.verdict || (resultData.launchReady ? 'running' : 'draft')),
          claims: { verified: verifiedCount, derived: derivedCount, assumed: assumedCount },
        });
      }
    }
  } catch { /* ignore */ }

  // 6. Visual Ralph Diff & Verdict Inspector
  const visualRalph = [];
  const vrRoot = path.join(primaryRoot, '.omagy', 'artifacts', 'visual-ralph');
  try {
    if (fs.existsSync(vrRoot) && !fs.lstatSync(vrRoot).isSymbolicLink()) {
      for (const slug of fs.readdirSync(vrRoot)) {
        const dir = path.join(vrRoot, slug);
        let st;
        try { st = fs.lstatSync(dir); } catch { continue; }
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        const files = fs.readdirSync(dir);
        const images = files
          .filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f))
          .map((f) => ({ name: f, relPath: `.omagy/artifacts/visual-ralph/${slug}/${f}` }));
        const verdictFile = files.find((f) => f === 'verdict.json' || f.endsWith('-verdict.json'));
        const verdictData = verdictFile ? readJsonSafe(path.join(dir, verdictFile)) : null;
        if (images.length || verdictData) {
          visualRalph.push({
            slug,
            images,
            verdict: verdictData ? {
              score: Number(verdictData.score ?? 0),
              verdict: String(verdictData.verdict || 'unknown'),
              categoryMatch: Boolean(verdictData.category_match ?? true),
              differences: Array.isArray(verdictData.differences) ? verdictData.differences.map(String) : [],
              suggestions: Array.isArray(verdictData.suggestions) ? verdictData.suggestions.map(String) : [],
            } : null,
          });
        }
      }
    }
  } catch { /* ignore */ }

  // 7. Loft Prototype Viewer
  const loft = [];
  const loftRoot = path.join(primaryRoot, '.omagy', 'artifacts', 'loft');
  try {
    if (fs.existsSync(loftRoot) && !fs.lstatSync(loftRoot).isSymbolicLink()) {
      for (const slug of fs.readdirSync(loftRoot)) {
        const dir = path.join(loftRoot, slug);
        const indexFile = path.join(dir, 'index.html');
        let st;
        try { st = fs.lstatSync(indexFile); } catch { continue; }
        if (st.isSymbolicLink() || !st.isFile()) continue;
        const htmlText = readTextSafe(indexFile, 32 * 1024);
        const hasLogicModule = fs.existsSync(path.join(dir, 'logic.mjs')) || fs.existsSync(path.join(dir, 'logic.js'));
        loft.push({
          slug,
          relPath: `.omagy/artifacts/loft/${slug}/index.html`,
          kind: hasLogicModule ? 'logic-fork' : 'ui-fork',
          updatedAt: new Date(st.mtimeMs).toISOString(),
          title: (/<title>([^<]+)<\/title>/i.exec(htmlText)?.[1] || slug).trim(),
        });
      }
    }
  } catch { /* ignore */ }

  // 8. Wiki, Working Agreements & Read-Only Lint Explorer
  const wiki = {
    agreements: [],
    pages: [],
    entries: [],
    lint: { missingFrontmatter: [], unknownCategories: [], danglingLinks: [], orphanPages: [], expiredPages: [] },
  };
  for (const dirName of ['omagy_wiki', 'omx_wiki']) {
    const wikiDir = path.join(primaryRoot, dirName);
    const agPath = path.join(wikiDir, 'agreements.md');
    const idxPath = path.join(wikiDir, 'index.md');
    let indexedSlugs = new Set();
    try {
      if (fs.existsSync(agPath) && !fs.lstatSync(agPath).isSymbolicLink()) {
        const lines = fs.readFileSync(agPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));
        wiki.agreements = lines.slice(0, 30).map((l) => {
          const expMatch = /(?:\[|\()\s*expires\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[^\])\s]+)?)\s*(?:\]|\))/i.exec(l);
          const expired = Boolean(expMatch && Date.parse(expMatch[1]) <= nowMs);
          const author = /(?:\[by:\s*human\]|\(by:\s*human\))/i.test(l) ? 'human' : 'agent';
          return { text: redactSecrets(l), author, expired };
        });
      }
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(idxPath) && !fs.lstatSync(idxPath).isSymbolicLink()) {
        const lines = fs.readFileSync(idxPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));
        wiki.pages = lines.slice(0, 40).map((l) => redactSecrets(l));
        for (const l of lines) {
          const m = /\[\[([a-zA-Z0-9_-]+)\]\]/.exec(l);
          if (m) indexedSlugs.add(m[1]);
        }
      }
    } catch { /* ignore */ }
    try {
      if (fs.existsSync(wikiDir) && !fs.lstatSync(wikiDir).isSymbolicLink()) {
        const mdFiles = fs.readdirSync(wikiDir).filter((f) => f.endsWith('.md') && !['index.md', 'agreements.md', 'log.md'].includes(f));
        const allSlugs = new Set(mdFiles.map((f) => f.slice(0, -3)));
        const inboundLinks = new Set();
        for (const f of mdFiles.slice(0, 50)) {
          const slug = f.slice(0, -3);
          const raw = readTextSafe(path.join(wikiDir, f), 16 * 1024);
          const { meta, body } = parseFrontmatter(raw);
          if (!meta || !meta.title || !meta.category) {
            wiki.lint.missingFrontmatter.push(slug);
          } else if (!WIKI_CATEGORIES.has(String(meta.category).toLowerCase())) {
            wiki.lint.unknownCategories.push(`${slug} (${meta.category})`);
          }
          const expiresStr = meta?.expires ? String(meta.expires) : '';
          const expired = Boolean(expiresStr && Date.parse(expiresStr) <= nowMs);
          if (expired) wiki.lint.expiredPages.push(slug);
          const links = [...raw.matchAll(/\[\[([a-zA-Z0-9_-]+)\]\]/g)].map((m) => m[1]);
          for (const target of links) {
            inboundLinks.add(target);
            if (!allSlugs.has(target)) wiki.lint.danglingLinks.push(`${slug} -> [[${target}]]`);
          }
          wiki.entries.push({
            slug,
            title: redactSecrets(String(meta?.title || slug)),
            category: String(meta?.category || 'uncategorized'),
            tags: Array.isArray(meta?.tags) ? meta.tags.map(String) : [],
            expires: expiresStr,
            expired,
            links: [...new Set(links)],
            body: redactSecrets(body.trim().slice(0, 2500)),
          });
        }
        for (const slug of allSlugs) {
          if (!indexedSlugs.has(slug) && !inboundLinks.has(slug)) {
            wiki.lint.orphanPages.push(slug);
          }
        }
      }
    } catch { /* ignore */ }
    if (wiki.agreements.length || wiki.pages.length || wiki.entries.length) break;
  }

  // 9. Quality gates & Doctor / Hook Diagnostics
  const qg = validateQualityGates(primaryRoot);
  const runtimeDir = process.env.OMAGY_RUNTIME_DIR || path.join(os.tmpdir(), 'oh-my-agy');
  let latestRouting = null;
  try {
    if (fs.existsSync(runtimeDir) && !fs.lstatSync(runtimeDir).isSymbolicLink()) {
      const routingFiles = fs.readdirSync(runtimeDir)
        .filter((f) => f.endsWith('.routing.json'))
        .map((f) => {
          const p = path.join(runtimeDir, f);
          try {
            const st = fs.lstatSync(p);
            return st.isFile() && !st.isSymbolicLink() ? { file: f, path: p, mtimeMs: st.mtimeMs } : null;
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (routingFiles.length) {
        const data = readJsonSafe(routingFiles[0].path);
        if (data) {
          latestRouting = {
            conversationId: routingFiles[0].file.replace(/\.routing\.json$/, ''),
            at: String(data.at || new Date(routingFiles[0].mtimeMs).toISOString()),
            skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
          };
        }
      }
    }
  } catch { /* ignore */ }

  const hookErrorsFile = path.join(primaryRoot, '.omagy', 'logs', 'hook-errors.jsonl');
  const hookErrors = fs.existsSync(hookErrorsFile)
    ? readJsonlRecords(hookErrorsFile).records.slice(-10).reverse().map((e) => ({
        at: String(e.at || ''),
        event: String(e.event || ''),
        error: redactSecrets(String(e.error || '')),
      }))
    : [];

  const doctor = {
    qualityGatesOk: Boolean(qg.ok),
    qualityGateErrors: Array.isArray(qg.errors) ? qg.errors.map(String) : [],
    staleModes: modes.filter((m) => m.stale).map((m) => m.mode),
    latestRouting,
    hookErrors,
  };

  // Minimal statusline string
  const activeModes = modes.filter((m) => m.active && !m.stale);
  const minimalParts = activeModes.map((m) => `${m.mode}:${m.phase}`);
  if (ultragoal) minimalParts.push(`ultragoal:${ultragoal.counts.complete}/${ultragoal.counts.total}`);
  for (const t of teams) {
    const done = t.tasks.filter((x) => x.status === 'completed' || x.status === 'complete').length;
    minimalParts.push(`team:${t.team} ${done}/${t.tasks.length}`);
  }
  const statusLine = minimalParts.length ? `[OMA] ${minimalParts.join(' | ')}` : '[OMA] No active modes';

  return {
    at: new Date(nowMs).toISOString(),
    workspace: primaryRoot,
    statusLine,
    modes,
    ultragoal,
    teams,
    interview,
    reviews,
    benchmarks,
    visualRalph,
    loft,
    wiki,
    qualityGates: qg.gates,
    doctor,
  };
}

const HUD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>oh-my-agy HUD</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 16px;
      background: var(--background, #0f1117);
      color: var(--foreground, #e5e7eb);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .card {
      background: var(--card, rgba(255,255,255,0.03));
      border: 1px solid var(--border, rgba(255,255,255,0.1));
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .muted { color: var(--muted-foreground, #9ca3af); }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--border, rgba(255,255,255,0.14));
    }
    .tab-btn {
      padding: 5px 9px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted-foreground, #9ca3af);
    }
    .tab-btn.active {
      background: var(--card, rgba(255,255,255,0.08));
      color: var(--foreground, #fff);
      border-color: var(--border, rgba(255,255,255,0.18));
    }
    .bar-track {
      width: 100%;
      height: 8px;
      background: rgba(128,128,128,0.2);
      border-radius: 9999px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--primary, #60a5fa);
      border-radius: 9999px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08)); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; margin: 0; }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
    <div>
      <div style="font-weight:600;font-size:14px;">oh-my-agy HUD</div>
      <div id="status-line" class="muted" style="font-size:12px;font-family:ui-monospace,monospace;">[OMA] Loading...</div>
    </div>
    <button id="refresh-btn" class="tab-btn active" title="Refresh status">Refresh</button>
  </div>

  <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;" role="tablist">
    <button class="tab-btn active" data-view="overview">Overview</button>
    <button class="tab-btn" data-view="ultragoal">Ultragoal</button>
    <button class="tab-btn" data-view="team">Team DAG</button>
    <button class="tab-btn" data-view="interview">Interview</button>
    <button class="tab-btn" data-view="reviews">Reviews</button>
    <button class="tab-btn" data-view="benchmarks">Benchmarks</button>
    <button class="tab-btn" data-view="visual-ralph">Visual Ralph</button>
    <button class="tab-btn" data-view="loft">Loft</button>
    <button class="tab-btn" data-view="wiki">Wiki</button>
    <button class="tab-btn" data-view="doctor">Doctor</button>
  </div>

  <div id="view-overview" class="view-pane"></div>
  <div id="view-ultragoal" class="view-pane" style="display:none;"></div>
  <div id="view-team" class="view-pane" style="display:none;"></div>
  <div id="view-interview" class="view-pane" style="display:none;"></div>
  <div id="view-reviews" class="view-pane" style="display:none;"></div>
  <div id="view-benchmarks" class="view-pane" style="display:none;"></div>
  <div id="view-visual-ralph" class="view-pane" style="display:none;"></div>
  <div id="view-loft" class="view-pane" style="display:none;"></div>
  <div id="view-wiki" class="view-pane" style="display:none;"></div>
  <div id="view-doctor" class="view-pane" style="display:none;"></div>

  <script>
    const ALLOWED = ${JSON.stringify(ALLOWED_VIEWS)};
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    let activeView = params.get('view') || 'overview';
    let selectedWikiSlug = params.get('slug') || '';
    let selectedLoftSlug = params.get('slug') || '';
    let vrOpacity = 50;
    let workspaceUris = [];
    let latestData = null;

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'theme-change' && event.data.payload?.cssVariables) {
        for (const [k, v] of Object.entries(event.data.payload.cssVariables)) {
          document.documentElement.style.setProperty(k, v);
        }
      } else if (event.data?.type === 'workspace-change' && Array.isArray(event.data.payload?.workspaceUris)) {
        workspaceUris = event.data.payload.workspaceUris;
        loadSnapshot();
      }
    });

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function artifactUrl(relPath, workspace) {
      const q = new URLSearchParams();
      q.set('rel', relPath);
      if (workspace) q.set('workspace', workspace);
      if (token) q.set('token', token);
      return '/api/artifact?' + q.toString();
    }

    function setTab(view) {
      activeView = ALLOWED.includes(view) ? view : 'overview';
      document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === activeView);
      });
      ALLOWED.forEach((v) => {
        const el = document.getElementById('view-' + v);
        if (el) el.style.display = v === activeView ? 'block' : 'none';
      });
    }

    document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.view));
    });
    document.getElementById('refresh-btn').addEventListener('click', () => loadSnapshot());
    setTab(activeView);

    async function loadSnapshot() {
      try {
        const q = new URLSearchParams();
        if (token) q.set('token', token);
        if (workspaceUris.length) q.set('workspaces', JSON.stringify(workspaceUris));
        const res = await fetch('/api/status?' + q.toString(), {
          headers: token ? { 'X-Sidecar-Token': token } : {}
        });
        if (!res.ok) return;
        latestData = await res.json();
        render(latestData);
      } catch (e) {
        console.error(e);
      }
    }

    window.selectWikiSlug = function(slug) {
      selectedWikiSlug = slug;
      if (latestData) renderWiki(latestData);
    };

    window.selectLoftSlug = function(slug) {
      selectedLoftSlug = slug;
      if (latestData) renderLoft(latestData);
    };

    window.updateVrOpacity = function(val) {
      vrOpacity = Number(val);
      const overlay = document.getElementById('vr-overlay-img');
      const label = document.getElementById('vr-opacity-label');
      if (overlay) overlay.style.opacity = String(vrOpacity / 100);
      if (label) label.textContent = vrOpacity + '%';
    };

    function renderWiki(data) {
      const agItems = (data.wiki?.agreements || []).map((a) => \`
        <li style="margin-bottom:6px;\${a.expired ? 'opacity:0.5;text-decoration:line-through;' : ''}">
          <span class="badge">\${esc(a.author)}</span> \${esc(a.text)}
        </li>\`).join('');
      const entries = data.wiki?.entries || [];
      const activeEntry = entries.find((e) => e.slug === selectedWikiSlug) || entries[0] || null;
      const entryBtns = entries.map((e) => \`
        <button class="tab-btn \${activeEntry && activeEntry.slug === e.slug ? 'active' : ''}" onclick="selectWikiSlug('\${esc(e.slug)}')">
          \${esc(e.slug)} <span class="muted">(\${esc(e.category)})</span>
        </button>\`).join('');
      const lint = data.wiki?.lint || {};
      const lintIssues = [
        ...(lint.missingFrontmatter || []).map((s) => \`Missing frontmatter: <code>\${esc(s)}</code>\`),
        ...(lint.unknownCategories || []).map((s) => \`Unknown category: <code>\${esc(s)}</code>\`),
        ...(lint.danglingLinks || []).map((s) => \`Dangling link: <code>\${esc(s)}</code>\`),
        ...(lint.orphanPages || []).map((s) => \`Orphan page: <code>\${esc(s)}</code>\`),
        ...(lint.expiredPages || []).map((s) => \`Expired page: <code>\${esc(s)}</code>\`),
      ];
      document.getElementById('view-wiki').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Working Agreements (omagy_wiki/agreements.md)</div>
          \${agItems ? \`<ul style="margin:0;padding-left:18px;">\${agItems}</ul>\` : '<div class="muted">No working agreements recorded yet.</div>'}
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Wiki Explorer (\${entries.length} pages)</div>
          \${entryBtns ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">\${entryBtns}</div>\` : '<div class="muted">No wiki pages found under omagy_wiki/.</div>'}
          \${activeEntry ? \`
            <div style="border-top:1px solid var(--border,rgba(255,255,255,0.1));padding-top:8px;">
              <div style="font-weight:600;">\${esc(activeEntry.title)} <span class="badge">\${esc(activeEntry.category)}</span></div>
              \${activeEntry.tags?.length ? \`<div class="muted" style="margin:4px 0;">Tags: \${activeEntry.tags.map(esc).join(', ')}</div>\` : ''}
              <pre style="margin-top:8px;">\${esc(activeEntry.body)}</pre>
            </div>\` : ''}
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:6px;">Read-Only Wiki Lint</div>
          \${lintIssues.length ? \`<ul style="margin:0;padding-left:18px;">\${lintIssues.map((i) => \`<li>\${i}</li>\`).join('')}</ul>\` : '<div class="muted">All wiki pages pass frontmatter, link, and index checks.</div>'}
        </div>
      \`;
    }

    function renderLoft(data) {
      const items = data.loft || [];
      if (!items.length) {
        document.getElementById('view-loft').innerHTML = '<div class="card muted">No .omagy/artifacts/loft/&lt;slug&gt;/index.html prototypes found in this workspace.</div>';
        return;
      }
      const current = items.find((i) => i.slug === selectedLoftSlug) || items[0];
      const btns = items.map((i) => \`
        <button class="tab-btn \${current.slug === i.slug ? 'active' : ''}" onclick="selectLoftSlug('\${esc(i.slug)}')">
          \${esc(i.slug)} <span class="badge">\${esc(i.kind)}</span>
        </button>\`).join('');
      const src = artifactUrl(current.relPath, data.workspace);
      document.getElementById('view-loft').innerHTML = \`
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
            <div style="font-weight:600;">Loft Prototypes (.omagy/artifacts/loft/)</div>
            <a href="\${esc(src)}" target="_blank" rel="noreferrer" class="badge">Open in Tab</a>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">\${btns}</div>
          <iframe src="\${esc(src)}" style="width:100%;height:520px;border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:8px;background:var(--background,#0f1117);" sandbox="allow-scripts"></iframe>
        </div>
      \`;
    }

    function render(data) {
      document.getElementById('status-line').textContent = data.statusLine || '[OMA] No active modes';

      // 1. Overview
      const modesRows = (data.modes || []).map((m) => \`
        <tr>
          <td><code>\${esc(m.mode)}</code></td>
          <td><span class="badge">\${esc(m.phase)}</span></td>
          <td>\${m.active ? (m.stale ? 'stale (>6h)' : 'active') : 'inactive'}</td>
          <td>\${esc(m.iteration ?? '-')}</td>
          <td class="muted">\${esc(m.session)}</td>
        </tr>\`).join('');
      const qgRows = (data.qualityGates || []).map((g) => \`<li><code>\${esc(g.stage)}</code> &rarr; <code>\${esc(g.skill)}</code> (\${esc(g.mode)}, \${esc(g.model)})</li>\`).join('');
      document.getElementById('view-overview').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:6px;">Workspace</div>
          <code>\${esc(data.workspace)}</code>
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Workflow Modes</div>
          \${modesRows ? \`<table><thead><tr><th>Mode</th><th>Phase</th><th>State</th><th>Iter</th><th>Scope</th></tr></thead><tbody>\${modesRows}</tbody></table>\` : '<div class="muted">No active or recent mode state files in .omagy/state/.</div>'}
        </div>
        \${qgRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:6px;">Configured Quality Gates</div><ul style="margin:0;padding-left:18px;">\${qgRows}</ul></div>\` : ''}
      \`;

      // 2. Ultragoal
      if (!data.ultragoal) {
        document.getElementById('view-ultragoal').innerHTML = '<div class="card muted">No .omagy/ultragoal/goals.json found in this workspace.</div>';
      } else {
        const ug = data.ultragoal;
        const goalRows = (ug.goals || []).map((g) => \`
          <tr>
            <td><code>\${esc(g.id)}</code></td>
            <td>\${esc(g.title)}</td>
            <td><span class="badge">\${esc(g.rigor)}</span></td>
            <td><span class="badge">\${esc(g.status)}</span></td>
            <td>\${g.productFailures}/3</td>
          </tr>\`).join('');
        const ledgerRows = (ug.recentLedger || []).map((l) => \`
          <tr>
            <td><code>\${esc(l.goal_id || '-')}</code></td>
            <td>\${esc(l.event || '-')}</td>
            <td>\${esc(l.status || '-')}</td>
            <td class="muted">\${esc((l.evidence || l.note || '').slice(0, 80))}</td>
          </tr>\`).join('');
        document.getElementById('view-ultragoal').innerHTML = \`
          <div class="card">
            <div style="font-weight:600;">\${esc(ug.objective || 'Ultragoal Plan')}</div>
            <div class="muted" style="margin-top:4px;">Progress: \${ug.counts.complete}/\${ug.counts.total} complete &middot; \${ug.counts.inProgress} in progress &middot; \${ug.counts.blocked} blocked</div>
          </div>
          <div class="card">
            <div style="font-weight:600;margin-bottom:8px;">Goals</div>
            <table><thead><tr><th>ID</th><th>Title</th><th>Rigor</th><th>Status</th><th>Retries</th></tr></thead><tbody>\${goalRows}</tbody></table>
          </div>
          \${ledgerRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:8px;">Recent Ledger Events</div><table><thead><tr><th>Goal</th><th>Event</th><th>Status</th><th>Evidence / Note</th></tr></thead><tbody>\${ledgerRows}</tbody></table></div>\` : ''}
        \`;
      }

      // 3. Team DAG
      if (!data.teams || !data.teams.length) {
        document.getElementById('view-team').innerHTML = '<div class="card muted">No active team boards under .omagy/state/team/.</div>';
      } else {
        document.getElementById('view-team').innerHTML = data.teams.map((t) => {
          const rows = (t.tasks || []).map((task) => \`
            <tr>
              <td><code>\${esc(task.id)}</code></td>
              <td>\${esc(task.title)}</td>
              <td><code>\${esc(task.role)}</code> (\${esc(task.model)})</td>
              <td><span class="badge">\${esc(task.status)}</span></td>
              <td>\${task.requiresCodeChange ? (task.hasEvidence ? 'verified' : 'pending') : 'n/a'}</td>
            </tr>\`).join('');
          return \`
            <div class="card">
              <div style="font-weight:600;margin-bottom:4px;">Team: <code>\${esc(t.team)}</code></div>
              <div class="muted" style="margin-bottom:8px;">\${esc(t.objective)}</div>
              <table><thead><tr><th>ID</th><th>Task</th><th>Role</th><th>Status</th><th>Evidence</th></tr></thead><tbody>\${rows}</tbody></table>
            </div>\`;
        }).join('');
      }

      // 4. Deep Interview Ambiguity & Readiness Radar
      if (!data.interview) {
        document.getElementById('view-interview').innerHTML = '<div class="card muted">No active or recent .omagy/state/deep-interview-state.json found.</div>';
      } else {
        const iv = data.interview;
        const ambPct = Math.round((iv.currentAmbiguity || 0) * 100);
        const threshPct = Math.round((iv.threshold || 0.2) * 100);
        const dimRows = Object.entries(iv.dimensions || {}).map(([k, v]) => {
          const scorePct = Math.round(Number(v || 0) * 100);
          return \`
            <div style="margin-bottom:6px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;"><span><code>\${esc(k)}</code></span><span>\${scorePct}%</span></div>
              <div class="bar-track"><div class="bar-fill" style="width:\${ Math.max(0, Math.min(100, scorePct)) }%;"></div></div>
            </div>\`;
        }).join('');
        const roundRows = (iv.rounds || []).map((r) => \`
          <tr>
            <td>#\${r.round}</td>
            <td><code>\${esc(r.target)}</code></td>
            <td><span class="badge">\${esc(r.label)}</span></td>
            <td>\${esc(r.question.slice(0, 90))}</td>
            <td class="muted">\${esc(r.answer.slice(0, 90))}</td>
          </tr>\`).join('');
        document.getElementById('view-interview').innerHTML = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:600;">Deep Interview: <code>\${esc(iv.slug || 'active')}</code></div>
              <span class="badge">\${esc(iv.profile)} (\${esc(iv.type)})</span>
            </div>
            <div class="muted" style="margin-top:4px;">Ambiguity: <strong>\${ambPct}%</strong> (Threshold &le; \${threshPct}%) &middot; Stage: <code>\${esc(iv.currentStage)}</code> &middot; Focus: <code>\${esc(iv.currentFocus)}</code></div>
            <div class="bar-track" style="margin-top:8px;"><div class="bar-fill" style="width:\${Math.max(0, Math.min(100, 100 - ambPct))}%;"></div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
              <span class="badge">Non-goals: \${iv.readinessGates?.nonGoals ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Decision Boundaries: \${iv.readinessGates?.decisionBoundaries ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Pressure Pass: \${iv.readinessGates?.pressurePass ? 'PASS' : 'PENDING'}</span>
            </div>
          </div>
          \${dimRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:8px;">Clarity Dimensions</div>\${dimRows}</div>\` : ''}
          \${roundRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:8px;">Round Provenance Ledger</div><table><thead><tr><th>Rd</th><th>Target</th><th>Label</th><th>Question</th><th>Answer</th></tr></thead><tbody>\${roundRows}</tbody></table></div>\` : ''}
        \`;
      }

      // 5. Ralplan / Hyperplan Consensus & Code Review Gate Board
      const rp = data.reviews?.ralplan;
      const hpList = data.reviews?.hyperplan || [];
      const crList = data.reviews?.codeReviews || [];
      if (!rp && !hpList.length && !crList.length) {
        document.getElementById('view-reviews').innerHTML = '<div class="card muted">No Ralplan, Hyperplan, or Code Review artifacts found under .omagy/plans/ or .omagy/artifacts/.</div>';
      } else {
        const hpRows = hpList.map((h) => \`
          <tr>
            <td><code>\${esc(h.file)}</code></td>
            <td><span class="badge">SURVIVES: \${h.survives}</span></td>
            <td><span class="badge">WEAKENED: \${h.weakened}</span></td>
            <td><span class="badge">KILLED: \${h.killed}</span></td>
          </tr>\`).join('');
        const crRows = crList.map((c) => \`
          <tr>
            <td><code>\${esc(c.file)}</code></td>
            <td><span class="badge">\${esc(c.architectStatus)}</span></td>
            <td><span class="badge">\${esc(c.recommendation)}</span></td>
            <td>\${c.filesReviewed} files / \${c.totalIssues} issues</td>
          </tr>\`).join('');
        document.getElementById('view-reviews').innerHTML = \`
          \${rp ? \`
            <div class="card">
              <div style="font-weight:600;margin-bottom:6px;">Ralplan Consensus Gate (Iter \${esc(rp.iteration)})</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <span class="badge">Phase: \${esc(rp.phase)}</span>
                <span class="badge">Architect: \${esc(rp.architectVerdict)}</span>
                <span class="badge">Critic: \${esc(rp.criticVerdict)}</span>
                <span class="badge">Consensus: \${rp.consensusComplete ? 'COMPLETE' : 'PENDING'}</span>
                <span class="badge">Handoff: \${rp.executionAuthorized ? 'AUTHORIZED' : 'LOCKED'}</span>
              </div>
            </div>\` : ''}
          \${hpRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:8px;">Hyperplan 5-Persona Distillation</div><table><thead><tr><th>Artifact</th><th>Survives</th><th>Weakened</th><th>Killed</th></tr></thead><tbody>\${hpRows}</tbody></table></div>\` : ''}
          \${crRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:8px;">Code Review Reports</div><table><thead><tr><th>Report</th><th>Architect</th><th>Verdict</th><th>Scope</th></tr></thead><tbody>\${crRows}</tbody></table></div>\` : ''}
        \`;
      }

      // 6. Benchmarks: Performance Goals & Autoresearch
      const pgList = data.benchmarks?.performanceGoals || [];
      const arList = data.benchmarks?.autoresearch || [];
      if (!pgList.length && !arList.length) {
        document.getElementById('view-benchmarks').innerHTML = '<div class="card muted">No .omagy/goals/performance/ or .omagy/specs/autoresearch-*/ runs found.</div>';
      } else {
        const pgCards = pgList.map((pg) => {
          const cpRows = (pg.checkpoints || []).map((c) => \`
            <tr>
              <td><span class="badge">\${esc(c.status)}</span></td>
              <td>\${esc(c.patch)}</td>
              <td class="muted">\${esc(c.evidence)}</td>
            </tr>\`).join('');
          return \`
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-weight:600;">Performance Goal: <code>\${esc(pg.slug)}</code></div>
                <span class="badge">\${esc(pg.status)}</span>
              </div>
              <div class="muted" style="margin:4px 0;">\${esc(pg.objective)} &middot; Evaluator: <code>\${esc(pg.evaluatorCommand)}</code></div>
              \${cpRows ? \`<table><thead><tr><th>Status</th><th>Patch</th><th>Evidence</th></tr></thead><tbody>\${cpRows}</tbody></table>\` : '<div class="muted">No checkpoints recorded yet.</div>'}
            </div>\`;
        }).join('');
        const arCards = arList.map((ar) => \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:600;">Autoresearch: <code>\${esc(ar.slug)}</code></div>
              <span class="badge">\${esc(ar.status)}</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
              <span class="badge">Launch Ready: \${ar.launchReady ? 'YES' : 'NO'}</span>
              <span class="badge">[VERIFIED]: \${ar.claims.verified}</span>
              <span class="badge">[DERIVED]: \${ar.claims.derived}</span>
              <span class="badge">[ASSUMED]: \${ar.claims.assumed}</span>
            </div>
          </div>\`).join('');
        document.getElementById('view-benchmarks').innerHTML = pgCards + arCards;
      }

      // 7. Visual Ralph Diff & Verdict Inspector
      const vrList = data.visualRalph || [];
      if (!vrList.length) {
        document.getElementById('view-visual-ralph').innerHTML = '<div class="card muted">No .omagy/artifacts/visual-ralph/&lt;slug&gt;/ reference or verdict artifacts found.</div>';
      } else {
        document.getElementById('view-visual-ralph').innerHTML = vrList.map((vr) => {
          const refImg = vr.images.find((i) => /reference/i.test(i.name)) || vr.images[0];
          const curImg = vr.images.find((i) => /current|after/i.test(i.name)) || vr.images[1] || refImg;
          const refUrl = refImg ? artifactUrl(refImg.relPath, data.workspace) : '';
          const curUrl = curImg ? artifactUrl(curImg.relPath, data.workspace) : '';
          const diffs = (vr.verdict?.differences || []).map((d) => \`<li>\${esc(d)}</li>\`).join('');
          return \`
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:600;">Visual Ralph: <code>\${esc(vr.slug)}</code></div>
                \${vr.verdict ? \`<span class="badge">Score: \${vr.verdict.score}/100 (\${esc(vr.verdict.verdict)})</span>\` : '<span class="badge">No verdict JSON</span>'}
              </div>
              \${refUrl && curUrl ? \`
                <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px;font-size:12px;">
                  <span>Overlay Opacity (<span id="vr-opacity-label">\${vrOpacity}%</span>):</span>
                  <input type="range" min="0" max="100" value="\${vrOpacity}" oninput="updateVrOpacity(this.value)" style="flex:1;" />
                </div>
                <div style="position:relative;width:100%;min-height:180px;border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:8px;overflow:hidden;">
                  <img src="\${esc(refUrl)}" alt="Reference" style="display:block;width:100%;height:auto;" />
                  <img id="vr-overlay-img" src="\${esc(curUrl)}" alt="Current" style="position:absolute;inset:0;width:100%;height:auto;opacity:\${vrOpacity / 100};pointer-events:none;" />
                </div>\` : ''}
              \${diffs ? \`<div style="margin-top:8px;"><div style="font-weight:600;margin-bottom:4px;">Vision Differences</div><ul style="margin:0;padding-left:18px;">\${diffs}</ul></div>\` : ''}
            </div>\`;
        }).join('');
      }

      // 8. Loft Prototype Viewer
      renderLoft(data);

      // 9. Wiki & Agreements Explorer
      renderWiki(data);

      // 10. Doctor & Hook Diagnostics
      const doc = data.doctor || {};
      const errRows = (doc.hookErrors || []).map((e) => \`
        <tr>
          <td><code>\${esc(e.at)}</code></td>
          <td><code>\${esc(e.event)}</code></td>
          <td class="muted">\${esc(e.error)}</td>
        </tr>\`).join('');
      document.getElementById('view-doctor').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Runtime &amp; Quality Gate Health</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <span class="badge">Quality Gates: \${doc.qualityGatesOk ? 'OK' : 'INVALID'}</span>
            <span class="badge">Stale Modes: \${(doc.staleModes || []).length ? esc(doc.staleModes.join(', ')) : 'none'}</span>
          </div>
          \${(doc.qualityGateErrors || []).length ? \`<ul style="margin-top:8px;padding-left:18px;">\${doc.qualityGateErrors.map((e) => \`<li>\${esc(e)}</li>\`).join('')}</ul>\` : ''}
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:6px;">Latest PreInvocation Routing</div>
          \${doc.latestRouting ? \`<div>Conversation: <code>\${esc(doc.latestRouting.conversationId)}</code> &middot; At: <code>\${esc(doc.latestRouting.at)}</code> &middot; Skills: <code>\${esc((doc.latestRouting.skills || []).join(', ') || 'none')}</code></div>\` : '<div class="muted">No .routing.json found in runtime tmpdir yet.</div>'}
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Recent Hook Errors (.omagy/logs/hook-errors.jsonl)</div>
          \${errRows ? \`<table><thead><tr><th>Time</th><th>Event</th><th>Error</th></tr></thead><tbody>\${errRows}</tbody></table>\` : '<div class="muted">Zero hook errors recorded.</div>'}
        </div>
      \`;
    }

    loadSnapshot();
    setInterval(loadSnapshot, 4000);
  </script>
</body>
</html>`;

export function createHudServer(token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '') {
  return http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (token && reqUrl.pathname.startsWith('/api/')) {
      const provided = req.headers['x-sidecar-token'] || reqUrl.searchParams.get('token');
      if (provided !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }
    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HUD_HTML);
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
      let workspaces = [];
      const rawWs = reqUrl.searchParams.get('workspaces');
      if (rawWs) {
        try {
          const parsed = JSON.parse(rawWs);
          if (Array.isArray(parsed)) workspaces = parsed;
        } catch {
          workspaces = rawWs.split(',').filter(Boolean);
        }
      }
      const snap = buildHudSnapshot(workspaces);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snap));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/artifact') {
      const wsParam = reqUrl.searchParams.get('workspace') || process.env.OMAGY_WORKSPACE || process.cwd();
      const relParam = reqUrl.searchParams.get('rel') || '';
      const resolved = resolveSafeArtifactFile(uriToFsPath(wsParam) || wsParam, relParam);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Artifact not found or forbidden' }));
        return;
      }
      try {
        const buf = fs.readFileSync(resolved.filePath);
        res.writeHead(200, { 'Content-Type': resolved.mime, 'Cache-Control': 'no-store' });
        res.end(buf);
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to read artifact' }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
}

async function runSelftest() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-selftest-'));
  try {
    fs.mkdirSync(path.join(ws, '.omagy', 'state'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'ultragoal'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'plans'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'goals', 'performance', 'startup'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'specs', 'autoresearch-cache'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'visual-ralph', 'hero'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'loft', 'nav-fork'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'omagy_wiki'), { recursive: true });

    fs.writeFileSync(path.join(ws, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
      mode: 'autopilot', active: true, current_phase: 'ultragoal', iteration: 2, updated_at: new Date().toISOString(),
    }));
    fs.writeFileSync(path.join(ws, '.omagy', 'state', 'deep-interview-state.json'), JSON.stringify({
      mode: 'deep-interview',
      active: true,
      current_phase: 'interview',
      updated_at: new Date().toISOString(),
      state: {
        slug: 'auth-flow',
        profile: 'standard',
        type: 'brownfield',
        current_ambiguity: 0.18,
        threshold: 0.2,
        rounds: [{ round: 1, target: 'intent', label: '[from-user]', question: 'Why?', answer: 'SSO token ghp_1234567890abcdefghij123456', scores: { intent: 0.9 } }],
        readiness_gates: { non_goals: true, decision_boundaries: true, pressure_pass: true },
      },
    }));
    fs.writeFileSync(path.join(ws, '.omagy', 'plans', 'hyperplan-distillation-auth.md'), '# Hyperplan\n- Option A: SURVIVES\n- Option B: KILLED\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'code-review-auth-1.md'), 'CODE REVIEW REPORT\nFiles Reviewed: 3\nTotal Issues: 0\nArchitectural Status: CLEAR\nRECOMMENDATION: APPROVE\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'goals', 'performance', 'startup', 'state.json'), JSON.stringify({
      slug: 'startup', objective: 'Cut cold start by 20%', evaluator_command: 'npm run bench', status: 'complete',
    }));
    fs.writeFileSync(path.join(ws, '.omagy', 'goals', 'performance', 'startup', 'checkpoints.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), status: 'pass', patch: 'lazy import', evidence: '120ms -> 90ms' })}\n`);
    fs.writeFileSync(path.join(ws, '.omagy', 'specs', 'autoresearch-cache', 'result.json'), JSON.stringify({ launchReady: true }));
    fs.writeFileSync(path.join(ws, '.omagy', 'specs', 'autoresearch-cache', 'report.md'), 'Claim 1 [VERIFIED]\nClaim 2 [DERIVED]\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'visual-ralph', 'hero', 'reference.png'), 'PNG');
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'visual-ralph', 'hero', 'verdict.json'), JSON.stringify({ score: 94, verdict: 'match', differences: [] }));
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'loft', 'nav-fork', 'index.html'), '<!DOCTYPE html><title>Nav Fork</title><body>Loft</body>');
    fs.writeFileSync(path.join(ws, '.omagy', 'ultragoal', 'goals.json'), JSON.stringify({
      objective: 'Ship HUD sidecar',
      goals: [{ id: 'G1', title: 'Add sidecar.json', rigor: 'light', status: 'complete', depends_on: [], product_failures: 0 }],
    }));
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'agreements.md'), '- [by:human] Keep HUD strictly read-only with token ghp_1234567890abcdefghij123456.\n');
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'index.md'), '- [[arch]] — Architecture — architecture — core\n');
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'arch.md'), '---\ntitle: Architecture\ncategory: architecture\ntags: [core]\n---\nSee [[missing-page]].\n');

    const snap = buildHudSnapshot([`file://${ws}`]);
    const validArtifact = resolveSafeArtifactFile(ws, '.omagy/artifacts/loft/nav-fork/index.html');
    const blockedTraversal = resolveSafeArtifactFile(ws, '.omagy/artifacts/loft/../../state/autopilot-state.json');

    const ok = snap.statusLine.includes('autopilot:ultragoal')
      && snap.statusLine.includes('ultragoal:1/1')
      && snap.interview?.slug === 'auth-flow'
      && snap.interview?.rounds?.[0]?.answer.includes('[REDACTED_TOKEN]')
      && snap.reviews?.hyperplan?.[0]?.survives === 1
      && snap.reviews?.codeReviews?.[0]?.recommendation === 'APPROVE'
      && snap.benchmarks?.performanceGoals?.[0]?.checkpoints?.length === 1
      && snap.benchmarks?.autoresearch?.[0]?.claims?.verified === 1
      && snap.visualRalph?.[0]?.verdict?.score === 94
      && snap.loft?.[0]?.slug === 'nav-fork'
      && snap.wiki.agreements.length === 1
      && snap.wiki.agreements[0].author === 'human'
      && snap.wiki.agreements[0].text.includes('[REDACTED_TOKEN]')
      && snap.wiki.entries.length === 1
      && snap.wiki.lint.danglingLinks.includes('arch -> [[missing-page]]')
      && Boolean(validArtifact && validArtifact.mime.includes('text/html'))
      && blockedTraversal === null;

    process.stdout.write(`${JSON.stringify({ selftest: ok ? 'PASS' : 'FAIL', statusLine: snap.statusLine })}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

const isMainModule = Boolean(process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)));
if (isMainModule) {
  const modeArg = (process.argv[2] || '').toLowerCase();
  if (modeArg === 'selftest' || modeArg === '--selftest') {
    runSelftest();
  } else {
    const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 0);
    const server = createHudServer();
    server.listen(port, BIND_HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      process.stdout.write(`[oh-my-agy/hud] listening on http://${BIND_HOST}:${actualPort}\n`);
    });
  }
}
