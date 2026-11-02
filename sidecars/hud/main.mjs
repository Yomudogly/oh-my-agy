#!/usr/bin/env node
// oh-my-agy HUD Sidecar (UI Extension for Antigravity Auxiliary Pane).
// Strictly read-only status, workflow, skill & subagent hub (OMX #3963 zero-mutation invariant) serving
// `sidecar://oh-my-agy/hud/` (`?view=overview|workflows|skills|subagents|wiki|doctor`).

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
export const ALLOWED_VIEWS = ['overview', 'workflows', 'skills', 'subagents', 'wiki', 'doctor'];
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const SKILL_GUIDE_META = {
  autopilot: {
    category: 'Orchestration & Planning',
    flags: [],
    quickStart: '/autopilot build a CLI that validates and converts CSV files to JSON',
    howToUse: 'Runs the full supervised chain ($deep-interview -> $ralplan -> $ultragoal) with durable state under .omagy/state/autopilot-state.json.',
  },
  'deep-interview': {
    category: 'Orchestration & Planning',
    flags: ['--quick', '--standard', '--deep', '--autoresearch'],
    quickStart: '/deep-interview I want to add role-based access control to this app',
    howToUse: 'Runs Socratic clarification rounds via ask_question until ambiguity is <= 20% and writes an execution-ready spec to .omagy/specs/.',
  },
  ralplan: {
    category: 'Orchestration & Planning',
    flags: ['--interactive', '--deliberate', '--hyperplan', '--advisory'],
    quickStart: '/ralplan --deliberate "redesign the token refresh pipeline"',
    howToUse: 'Generates a PRD + test spec in .omagy/plans/ and runs sequential Architect then Critic subagent consensus reviews.',
  },
  plan: {
    category: 'Orchestration & Planning',
    flags: ['--interview', '--direct', '--review'],
    quickStart: '$plan --direct "refactor the webhook retry queue"',
    howToUse: 'Explore-first lightweight planning for bounded features when a full Socratic deep-interview is not needed.',
  },
  ultragoal: {
    category: 'Execution & Teams',
    flags: ['create-goals', 'complete-goals'],
    quickStart: '/ultragoal execute the approved plan in .omagy/plans/',
    howToUse: 'Decomposes specs/plans into .omagy/ultragoal/goals.json and executes them sequentially with ledger.jsonl audit receipts and light/heavy verification.',
  },
  team: {
    category: 'Execution & Teams',
    flags: [],
    quickStart: '/team execute the approved plan across parallel backend and frontend workers',
    howToUse: 'Coordinates up to 6 parallel team-worker subagents on a leader-owned DAG task board (.omagy/state/team/) with verified task-<id>.json evidence.',
  },
  'performance-goal': {
    category: 'Execution & Teams',
    flags: [],
    quickStart: '/performance-goal reduce cold-start latency by 25% using npm run bench',
    howToUse: 'Evaluator-gated optimization loop that records baseline and small reversible patch checkpoints under .omagy/goals/performance/.',
  },
  autoresearch: {
    category: 'Execution & Teams',
    flags: [],
    quickStart: '/autoresearch run the mission in .omagy/specs/autoresearch-cache/',
    howToUse: 'Validator-gated research loop that continues until a validator script or architect review passes.',
  },
  'deep-research': {
    category: 'Research & Analysis',
    flags: ['--technical', '--business', '--idea', '--implementation'],
    quickStart: '/deep-research --technical "HNSW vs DiskANN vector indexing tradeoffs at 50M vectors"',
    howToUse: 'Runs a 5-phase investigation (Boolean query matrix, parallel subagents, Tier A-E sources with [VERIFIED]/[DERIVED]/[ASSUMED] tags, and >=85 scorecard audit) into .omagy/artifacts/research/.',
  },
  analyze: {
    category: 'Research & Analysis',
    flags: [],
    quickStart: '/analyze why the session middleware drops cookies on redirect',
    howToUse: 'Read-only cross-file repository analysis with 6-tier evidence ranking, competing hypothesis tracing, and Intent-vs-Reality diffs.',
  },
  'best-practice-research': {
    category: 'Research & Analysis',
    flags: [],
    quickStart: '/best-practice-research current Next.js App Router caching and revalidation rules',
    howToUse: 'Fast, read-only official-documentation and upstream version check for an already-chosen technology.',
  },
  ask: {
    category: 'Research & Analysis',
    flags: ['claude', 'gemini', 'codex'],
    quickStart: '/ask claude "review our event-sourcing schema for edge cases"',
    howToUse: 'Queries a locally installed external CLI advisor (Claude, Gemini, or Codex) and saves the response under .omagy/artifacts/.',
  },
  'code-review': {
    category: 'Review, QA & Cleanup',
    flags: ['--re-review'],
    quickStart: '/code-review the changes on my current branch',
    howToUse: 'Pre-assembles a git review package and dispatches independent code-reviewer and architect subagents for a deterministic APPROVE / REQUEST CHANGES / COMMENT verdict.',
  },
  ultraqa: {
    category: 'Review, QA & Cleanup',
    flags: ['--tests', '--build', '--lint', '--typecheck', '--interactive', '--custom'],
    quickStart: '/ultraqa --tests --interactive "checkout flow"',
    howToUse: 'Runs up to 5 cycles of 9-class adversarial QA (boundary inputs, concurrency, idempotency, failure injection) with automated diagnosis and fixes.',
  },
  'ai-slop-cleaner': {
    category: 'Review, QA & Cleanup',
    flags: [],
    quickStart: '/ai-slop-cleaner clean up src/services/',
    howToUse: 'Locks behavior with regression tests first, then removes dead code, duplicate wrappers, and unnecessary abstractions in bounded passes.',
  },
  pr: {
    category: 'Review, QA & Cleanup',
    flags: [],
    quickStart: '/pr draft a pull request body for this branch',
    howToUse: 'Assembles a review-ready PR description from the .omagy/ paper trail (summary, verification receipts, rulings, and ADR reversibility).',
  },
  design: {
    category: 'Design & Prototyping',
    flags: [],
    quickStart: '/design create DESIGN.md for our developer dashboard',
    howToUse: 'Creates or refreshes repo-local DESIGN.md with typography, color tokens, layout scroll-owner rules, and the Impeccable Craft Floor.',
  },
  'visual-ralph': {
    category: 'Design & Prototyping',
    flags: [],
    quickStart: '/visual-ralph match the hero section to reference.png',
    howToUse: 'Iterative frontend implementation loop driven by vision subagent verdicts and pixel/overlay comparison under .omagy/artifacts/visual-ralph/.',
  },
  loft: {
    category: 'Design & Prototyping',
    flags: [],
    quickStart: '/loft prototype 3 layout variants for the timeline switcher',
    howToUse: 'Builds a throwaway prototype under .omagy/artifacts/loft/<slug>/index.html to settle a UI or pure-logic fork before production coding.',
  },
  wiki: {
    category: 'Knowledge, Control & Setup',
    flags: ['add', 'query', 'read', 'lint', 'delete'],
    quickStart: '/wiki query architecture',
    howToUse: 'Manages persistent repo knowledge in omagy_wiki/ (architecture, decisions, debugging notes, and [by:human] working agreements).',
  },
  handoff: {
    category: 'Knowledge, Control & Setup',
    flags: [],
    quickStart: '/handoff save session context before /compact',
    howToUse: 'Writes a self-contained continuation packet to .omagy/artifacts/handoff-latest.md with state pointers, verified work, and a copy-paste resume prompt.',
  },
  hud: {
    category: 'Knowledge, Control & Setup',
    flags: ['--preset=minimal', '--preset=focused', '--preset=full'],
    quickStart: '/hud --preset=full',
    howToUse: 'Renders a read-only chat status table of active .omagy/ modes, Ultragoal progress, and team boards, plus a link to this Aux Pane HUD.',
  },
  cancel: {
    category: 'Knowledge, Control & Setup',
    flags: ['--force', '--all'],
    quickStart: '/cancel autopilot',
    howToUse: 'Cleanly terminates active workflow modes, preserves unmerged subagent worktrees, and marks state files cancelled.',
  },
  doctor: {
    category: 'Knowledge, Control & Setup',
    flags: ['--session', '--export'],
    quickStart: '/doctor',
    howToUse: 'Audits plugin manifests, SDO skill compliance, hook selftests, stale states, and 7-dimension session transcript forensics (--session).',
  },
  skill: {
    category: 'Knowledge, Control & Setup',
    flags: ['list', 'add', 'edit', 'remove', 'scan', 'test'],
    quickStart: '/skill test deep-research',
    howToUse: 'Creates, validates, and pressure-tests Antigravity skills (RED -> GREEN -> REFACTOR behavioral subagent evaluation).',
  },
  'omagy-setup': {
    category: 'Knowledge, Control & Setup',
    flags: [],
    quickStart: '/omagy-setup',
    howToUse: 'Installs or updates oh-my-agy in user or workspace scope, configures .gitignore, and migrates legacy .omx artifacts.',
  },
  'configure-notifications': {
    category: 'Knowledge, Control & Setup',
    flags: [],
    quickStart: '/configure-notifications setup macOS notification on stop',
    howToUse: 'Configures stop/idle webhook or local command notifications in .omagy/config.json.',
  },
};

const SUBAGENT_GUIDE_META = {
  explore: {
    lane: 'Discovery & Research',
    modelTier: 'flash | inherit',
    whenToUse: 'Fast, read-only repo lookup: locate files, symbols, call graphs, and existing dependency usage before planning or editing.',
  },
  researcher: {
    lane: 'Discovery & Research',
    modelTier: 'inherit',
    whenToUse: 'External official documentation, upstream API signatures, release notes, RFCs, and Tier A-C evidence for /deep-research and /best-practice-research.',
  },
  'dependency-expert': {
    lane: 'Discovery & Research',
    modelTier: 'inherit',
    whenToUse: 'Evaluate whether/which package or SDK to adopt, upgrade, replace, or migrate (maintenance, bundle size, license, security).',
  },
  analyst: {
    lane: 'Discovery & Research',
    modelTier: 'inherit',
    whenToUse: 'Surface hidden requirements, product/business edge cases, unstated assumptions, and lateral alternatives before planning.',
  },
  planner: {
    lane: 'Planning & Architecture',
    modelTier: 'inherit',
    whenToUse: 'Author right-sized, evidence-backed implementation plans (prd-<slug>.md and test-spec-<slug>.md) with explicit task interfaces.',
  },
  architect: {
    lane: 'Planning & Architecture',
    modelTier: 'pro | inherit',
    whenToUse: 'Read-only architectural review, steelman antithesis, Demolition/ADR tests, and CLEAR / WATCH / BLOCK rulings in /ralplan and /code-review.',
  },
  critic: {
    lane: 'Planning & Architecture',
    modelTier: 'pro | inherit',
    whenToUse: 'Sequential quality gate after Architect in /ralplan: issues APPROVE / ITERATE / REJECT against principles, edge cases, and testability.',
  },
  executor: {
    lane: 'Execution & Debugging',
    modelTier: 'inherit',
    whenToUse: 'Autonomous implementation worker for bounded goal/task slices with explicit owned files, acceptance criteria, and verification commands.',
  },
  'team-worker': {
    lane: 'Execution & Debugging',
    modelTier: 'flash | inherit | pro',
    whenToUse: 'Dispatched by the /team leader on a shared git worktree/workspace to complete a DAG task and write .omagy/evidence/task-<id>.json.',
  },
  debugger: {
    lane: 'Execution & Debugging',
    modelTier: 'inherit',
    whenToUse: 'Root-cause isolation, stack-trace backward tracing, find-polluter test bisection, and 4-layer defense-in-depth bug fixes.',
  },
  tracer: {
    lane: 'Execution & Debugging',
    modelTier: 'pro | inherit',
    whenToUse: 'Competing-hypothesis causal tracing with 6-tier evidence ranking, disconfirmation probes, and discriminating next-step experiments.',
  },
  'code-simplifier': {
    lane: 'Execution & Debugging',
    modelTier: 'inherit',
    whenToUse: 'Post-modification cleanup pass to simplify control flow, remove dead wrappers, and tighten naming without changing behavior.',
  },
  'test-engineer': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    whenToUse: 'Design and harden unit/integration/e2e tests using Name-the-Break, Exercise-the-Real-Thing, mutation checks, and condition-based waiting.',
  },
  verifier: {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    whenToUse: 'Independent completion gate (AdversarialVerify) running fresh commands and Red-Green revert checks to confirm or reject a DoneClaim.',
  },
  'code-reviewer': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    whenToUse: 'Severity-rated review of a pre-assembled review-package diff with file:line evidence, Spec-Silence checks, and scoped --re-review.',
  },
  'security-reviewer': {
    lane: 'Review & Verification',
    modelTier: 'pro | inherit',
    whenToUse: 'OWASP Top 10, auth/session boundaries, injection, path traversal, and secret exposure audit on security-sensitive changes.',
  },
  designer: {
    lane: 'Design & Visual',
    modelTier: 'inherit',
    whenToUse: 'UI/UX design system authoring (DESIGN.md) and polished frontend implementation enforcing the Impeccable Craft Floor and 320px reflow.',
  },
  vision: {
    lane: 'Design & Visual',
    modelTier: 'inherit',
    whenToUse: 'Visual/media analysis of screenshots, mockups, and live renders, issuing scored Visual Ralph verdicts and pixel-diff fix lists.',
  },
};

const WORKFLOW_BLUEPRINTS = [
  {
    id: 'autopilot',
    title: 'Supervised End-to-End Delivery (/autopilot)',
    modeKey: 'autopilot',
    stages: ['$deep-interview', '$ralplan (Planner -> Architect -> Critic)', '$ultragoal (Execute -> Verify)', '$code-review'],
    whenToUse: 'When starting from an idea, feature request, or issue and you want full requirements clarification, consensus planning, durable goal execution, and final review in one recoverable run.',
    quickStart: '/autopilot build a CLI that converts CSV files to JSON with schema validation',
    artifacts: '.omagy/state/autopilot-state.json, .omagy/specs/, .omagy/plans/, .omagy/ultragoal/',
  },
  {
    id: 'deep-interview',
    title: 'Socratic Requirements Clarification (/deep-interview)',
    modeKey: 'deep-interview',
    stages: ['Preflight Context', 'One-Question Rounds (ask_question)', 'Pressure Pass & Builder Check', 'Spec (.omagy/specs/)'],
    whenToUse: 'When scope, non-goals, or decision boundaries are ambiguous and you want quantitative ambiguity gating (<= 20%) before writing code.',
    quickStart: '/deep-interview I want to redesign our notification system',
    artifacts: '.omagy/context/, .omagy/interviews/, .omagy/specs/deep-interview-<slug>.md',
  },
  {
    id: 'ralplan',
    title: 'Multi-Agent Consensus Planning (/ralplan & $plan)',
    modeKey: 'ralplan',
    stages: ['Optional --hyperplan (5 Personas)', 'Planner (PRD + Test Spec)', 'Architect Review (Steelman + ADR)', 'Critic Gate (APPROVE / ITERATE)'],
    whenToUse: 'When architecture, cross-module interfaces, or silent edge cases need independent Architect and Critic review before implementation begins.',
    quickStart: '/ralplan --deliberate "migrate session storage to Redis"',
    artifacts: '.omagy/plans/prd-<slug>.md, .omagy/plans/test-spec-<slug>.md, .omagy/plans/ralplan-review-<slug>.md',
  },
  {
    id: 'ultragoal',
    title: 'Durable Multi-Goal Execution (/ultragoal)',
    modeKey: 'ultragoal',
    stages: ['Decompose goals.json', 'Extract Goal Brief', 'Execute Slice', 'Verify (Light / Heavy Verifier)', 'Append ledger.jsonl', 'Final Review Gate'],
    whenToUse: 'When executing a multi-step spec or plan that needs crash-resilient progress tracking, rigor tiering, and verification receipts.',
    quickStart: '/ultragoal complete-goals',
    artifacts: '.omagy/ultragoal/brief.md, .omagy/ultragoal/goals.json, .omagy/ultragoal/ledger.jsonl',
  },
  {
    id: 'team',
    title: 'Coordinated Parallel Subagent Team (/team)',
    modeKey: 'team',
    stages: ['DAG Task Board (tasks.json)', 'Wave Dispatch (Workspace: share)', 'Worker Evidence (task-<id>.json)', 'Leader Verify & Merge'],
    whenToUse: 'When an approved plan has 2-6 independent module slices that can be implemented in parallel by specialized subagents.',
    quickStart: '/team run parallel workers on the approved plan',
    artifacts: '.omagy/state/team/<slug>/tasks.json, .omagy/evidence/task-<id>.json',
  },
  {
    id: 'deep-research',
    title: 'Multi-Lens Deep Research (/deep-research)',
    modeKey: 'deep-research',
    stages: ['Lens & Terminological Scope', 'Boolean Query Matrix (research-matrix)', 'Parallel Subagent Harvest (Tier A-E)', 'Synthesis & Mermaid Modeling', '>=85 Scorecard Audit (audit-research)'],
    whenToUse: 'When investigating technical architecture tradeoffs, business/market landscapes, product/idea validation, or pre-implementation SDK/codebase choices.',
    quickStart: '/deep-research --technical "SQLite WAL concurrency limits vs Postgres for multi-tenant SaaS"',
    artifacts: '.omagy/artifacts/research/deep-research-<slug>-<UTC>.md',
  },
  {
    id: 'review-qa',
    title: 'Dual-Lane Code Review & Adversarial QA (/code-review & /ultraqa)',
    modeKey: 'ultraqa',
    stages: ['Pre-Assemble Review Package', 'Independent Code-Reviewer + Architect', '9-Class Adversarial QA Matrix', 'Deterministic Verdict'],
    whenToUse: 'Before merging a branch (/code-review) or when stress-testing runnable behavior against boundary, concurrency, and failure-injection scenarios (/ultraqa).',
    quickStart: '/code-review the changes on my current branch',
    artifacts: '.omagy/artifacts/reviews/, .omagy/artifacts/code-review-<slug>.md',
  },
  {
    id: 'solo',
    title: 'Solo Direct Lane (Default)',
    modeKey: 'solo',
    stages: ['Explore & Understand', 'Execute Minimal Diff', 'Verify (Tests / Lint / Typecheck)', 'Report Evidence'],
    whenToUse: 'Default lane when requirements and file targets are already clear and bounded — no state ceremony required.',
    quickStart: 'Fix the off-by-one pagination bug in src/api/users.ts and run the unit tests',
    artifacts: 'Direct repository changes + verification command output',
  },
];

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
  if (!cleanRel.startsWith('.omagy/artifacts/visual-ralph/')
      && !cleanRel.startsWith('.omagy/artifacts/loft/')
      && !cleanRel.startsWith('.omagy/artifacts/research/')) {
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

export function buildPluginCatalog(pluginRoot = PLUGIN_ROOT, activeModes = []) {
  const skills = [];
  const skillsDir = path.join(pluginRoot, 'skills');
  try {
    if (fs.existsSync(skillsDir) && !fs.lstatSync(skillsDir).isSymbolicLink()) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const dirName of dirs) {
        const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
        const raw = readTextSafe(skillFile, 24 * 1024);
        if (!raw) continue;
        const { meta } = parseFrontmatter(raw);
        const name = String(meta?.name || dirName).trim();
        const rawDesc = String(meta?.description || '').replace(/^\[oh-my-agy\]\s*/i, '').trim();
        const guide = SKILL_GUIDE_META[name] || {};
        skills.push({
          name,
          category: guide.category || 'Knowledge, Control & Setup',
          description: rawDesc,
          howToUse: guide.howToUse || rawDesc,
          quickStart: guide.quickStart || `/${name}`,
          flags: Array.isArray(guide.flags) ? guide.flags : [],
        });
      }
    }
  } catch { /* ignore */ }

  const subagents = [];
  const agentsDir = path.join(pluginRoot, 'agents');
  try {
    if (fs.existsSync(agentsDir) && !fs.lstatSync(agentsDir).isSymbolicLink()) {
      const files = fs.readdirSync(agentsDir)
        .filter((f) => f.endsWith('.md'))
        .sort();
      for (const file of files) {
        const raw = readTextSafe(path.join(agentsDir, file), 24 * 1024);
        if (!raw) continue;
        const { meta } = parseFrontmatter(raw);
        const name = String(meta?.name || file.slice(0, -3)).trim();
        const rawDesc = String(meta?.description || '').trim();
        const guide = SUBAGENT_GUIDE_META[name] || {};
        subagents.push({
          name,
          lane: guide.lane || 'Execution & Debugging',
          modelTier: guide.modelTier || 'inherit',
          description: rawDesc,
          whenToUse: guide.whenToUse || rawDesc,
        });
      }
    }
  } catch { /* ignore */ }

  const activeByMode = new Map();
  for (const m of activeModes) {
    if (m && m.active && !m.stale) {
      activeByMode.set(m.mode, m.phase);
    }
  }

  const workflows = WORKFLOW_BLUEPRINTS.map((wf) => ({
    ...wf,
    active: activeByMode.has(wf.modeKey),
    currentPhase: activeByMode.get(wf.modeKey) || null,
  }));

  return { skills, subagents, workflows };
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
    || allModeRecords.find((m) => m.mode === 'autopilot' && (m.raw?.state?.ralplan || m.raw?.state?.handoff_artifacts?.ralplan || m.raw?.handoff_artifacts?.ralplan));
  if (rpRecord) {
    const ho = rpRecord.raw?.state?.handoff_artifacts?.ralplan || rpRecord.raw?.handoff_artifacts?.ralplan || rpRecord.raw?.state?.ralplan || rpRecord.raw?.state || {};
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

  // 4b. Deep Research reports (.omagy/artifacts/research/*.md)
  const research = [];
  const researchDir = path.join(primaryRoot, '.omagy', 'artifacts', 'research');
  try {
    if (fs.existsSync(researchDir) && !fs.lstatSync(researchDir).isSymbolicLink()) {
      for (const name of fs.readdirSync(researchDir)) {
        if (!name.endsWith('.md')) continue;
        const fullPath = path.join(researchDir, name);
        const text = readTextSafe(fullPath, 32 * 1024);
        if (!text) continue;
        const titleMatch = /^#\s+([^\r\n]+)/m.exec(text);
        const lensMatch = /Lens(?:\(es\))?:\**\s*`?([a-zA-Z0-9_, /|-]+)`?/i.exec(text);
        const compMatch = /Overall\s+Composite[^\n|]*\|[^\n|]*\|\s*`?([0-9]+(?:\.[0-9]+)?)`?/i.exec(text);
        research.push({
          file: `.omagy/artifacts/research/${name}`,
          title: redactSecrets((titleMatch ? titleMatch[1] : name).trim()),
          lens: (lensMatch ? lensMatch[1] : 'multi-lens').trim(),
          compositeScore: compMatch ? Number(compMatch[1]) : null,
          claims: {
            verified: (text.match(/\[VERIFIED\]/g) || []).length,
            derived: (text.match(/\[DERIVED\]/g) || []).length,
            assumed: (text.match(/\[ASSUMED\]/g) || []).length,
          },
        });
      }
    }
  } catch { /* ignore */ }

  // 5. Benchmarks: Performance Goals & Autoresearch (retained in snapshot for compatibility)
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

  // 6. Visual Ralph Diff & Verdict Inspector (retained in snapshot for compatibility)
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

  // 7. Loft Prototype Viewer (retained in snapshot for compatibility)
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
    const indexedSlugs = new Set();
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

  // 10. Auto-discovered Plugin Catalog (Skills, Subagents, Workflows)
  const catalog = buildPluginCatalog(PLUGIN_ROOT, modes);

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
    allowedViews: ALLOWED_VIEWS,
    modes,
    ultragoal,
    teams,
    interview,
    reviews,
    research,
    benchmarks,
    visualRalph,
    loft,
    wiki,
    qualityGates: qg.gates,
    doctor,
    catalog,
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
      padding: 14px;
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
      margin-bottom: 10px;
    }
    .muted { color: var(--muted-foreground, #9ca3af); }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
      border: 1px solid var(--border, rgba(255,255,255,0.15));
      background: rgba(255,255,255,0.03);
    }
    .badge-active {
      border-color: rgba(96, 165, 250, 0.5);
      color: var(--primary, #60a5fa);
      background: rgba(96, 165, 250, 0.12);
    }
    .tab-btn {
      padding: 5px 10px;
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
    .search-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(255,255,255,0.16));
      background: rgba(0,0,0,0.2);
      color: var(--foreground, #e5e7eb);
      font-size: 12px;
      margin-bottom: 8px;
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
    .cmd-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 8px;
      padding: 6px 9px;
      border-radius: 7px;
      background: rgba(0,0,0,0.28);
      border: 1px solid var(--border, rgba(255,255,255,0.09));
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
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
    <button class="tab-btn" data-view="workflows">Workflows</button>
    <button class="tab-btn" data-view="skills">Skills</button>
    <button class="tab-btn" data-view="subagents">Subagents</button>
    <button class="tab-btn" data-view="wiki">Wiki</button>
    <button class="tab-btn" data-view="doctor">Doctor</button>
  </div>

  <div id="view-overview" class="view-pane"></div>
  <div id="view-workflows" class="view-pane" style="display:none;"></div>
  <div id="view-skills" class="view-pane" style="display:none;"></div>
  <div id="view-subagents" class="view-pane" style="display:none;"></div>
  <div id="view-wiki" class="view-pane" style="display:none;"></div>
  <div id="view-doctor" class="view-pane" style="display:none;"></div>

  <script>
    const ALLOWED = ${JSON.stringify(ALLOWED_VIEWS)};
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    let activeView = ALLOWED.includes(params.get('view')) ? params.get('view') : 'overview';
    let selectedWikiSlug = params.get('slug') || '';
    let skillSearch = '';
    let skillCategory = 'All';
    let subagentLane = 'All';
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
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    window.copyQuickStart = function(btn, text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          const prev = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = prev; }, 1200);
        }).catch(() => {});
      }
    };

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

    window.setSkillCategory = function(cat) {
      skillCategory = cat;
      if (latestData) renderSkills(latestData);
    };

    window.onSkillSearchInput = function(val) {
      skillSearch = String(val || '');
      if (latestData) renderSkillsListOnly(latestData);
    };

    window.setSubagentLane = function(lane) {
      subagentLane = lane;
      if (latestData) renderSubagents(latestData);
    };

    function renderOverview(data) {
      const modesRows = (data.modes || []).map((m) => \`
        <tr>
          <td><code>\${esc(m.mode)}</code></td>
          <td><span class="badge \${m.active && !m.stale ? 'badge-active' : ''}">\${esc(m.phase)}</span></td>
          <td>\${m.active ? (m.stale ? 'stale (>6h)' : 'active') : 'inactive'}</td>
          <td>\${esc(m.iteration ?? '-')}</td>
          <td class="muted">\${esc(m.session)}</td>
        </tr>\`).join('');

      const qgRows = (data.qualityGates || []).map((g) => \`<li><code>\${esc(g.stage)}</code> &rarr; <code>\${esc(g.skill)}</code> (\${esc(g.mode)}, \${esc(g.model)})</li>\`).join('');

      // Consolidated Ultragoal Card
      let ugHtml = '';
      if (data.ultragoal) {
        const ug = data.ultragoal;
        const pct = ug.counts.total > 0 ? Math.round((ug.counts.complete / ug.counts.total) * 100) : 0;
        const goalRows = (ug.goals || []).map((g) => \`
          <tr>
            <td><code>\${esc(g.id)}</code></td>
            <td>\${esc(g.title)}</td>
            <td><span class="badge">\${esc(g.rigor)}</span></td>
            <td><span class="badge \${g.status === 'in_progress' ? 'badge-active' : ''}">\${esc(g.status)}</span></td>
            <td>\${g.productFailures}/3</td>
          </tr>\`).join('');
        ugHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div style="font-weight:600;">Ultragoal: \${esc(ug.objective || 'Active Plan')}</div>
              <span class="badge badge-active">\${ug.counts.complete}/\${ug.counts.total}</span>
            </div>
            <div class="bar-track" style="margin:8px 0;"><div class="bar-fill" style="width:\${pct}%;"></div></div>
            <table><thead><tr><th>ID</th><th>Goal</th><th>Rigor</th><th>Status</th><th>Retries</th></tr></thead><tbody>\${goalRows}</tbody></table>
          </div>\`;
      }

      // Consolidated Deep Interview Card
      let ivHtml = '';
      if (data.interview) {
        const iv = data.interview;
        const ambPct = Math.round((iv.currentAmbiguity || 0) * 100);
        const threshPct = Math.round((iv.threshold || 0.2) * 100);
        ivHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="font-weight:600;">Deep Interview: <code>\${esc(iv.slug || 'session')}</code></div>
              <span class="badge">\${esc(iv.profile)} (\${ambPct}% ambiguity &le; \${threshPct}%)</span>
            </div>
            <div class="bar-track" style="margin-top:8px;"><div class="bar-fill" style="width:\${Math.max(0, Math.min(100, 100 - ambPct))}%;"></div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
              <span class="badge">Non-goals: \${iv.readinessGates?.nonGoals ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Decision Boundaries: \${iv.readinessGates?.decisionBoundaries ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Pressure Pass: \${iv.readinessGates?.pressurePass ? 'PASS' : 'PENDING'}</span>
            </div>
          </div>\`;
      }

      // Consolidated Team Card
      let teamHtml = '';
      if (data.teams && data.teams.length) {
        teamHtml = data.teams.map((t) => {
          const rows = (t.tasks || []).map((task) => \`
            <tr>
              <td><code>\${esc(task.id)}</code></td>
              <td>\${esc(task.title)}</td>
              <td><code>\${esc(task.role)}</code></td>
              <td><span class="badge">\${esc(task.status)}</span></td>
              <td>\${task.requiresCodeChange ? (task.hasEvidence ? 'verified' : 'pending') : 'n/a'}</td>
            </tr>\`).join('');
          return \`
            <div class="card">
              <div style="font-weight:600;margin-bottom:4px;">Team Board: <code>\${esc(t.team)}</code></div>
              <div class="muted" style="margin-bottom:6px;">\${esc(t.objective)}</div>
              <table><thead><tr><th>ID</th><th>Task</th><th>Role</th><th>Status</th><th>Evidence</th></tr></thead><tbody>\${rows}</tbody></table>
            </div>\`;
        }).join('');
      }

      // Consolidated Reviews & Deep Research Card
      const rp = data.reviews?.ralplan;
      const crList = data.reviews?.codeReviews || [];
      const resList = data.research || [];
      let revResHtml = '';
      if (rp || crList.length || resList.length) {
        const rpLine = rp ? \`<div style="margin-bottom:6px;"><span class="badge">Ralplan Iter \${esc(rp.iteration)}</span> Architect: <strong>\${esc(rp.architectVerdict)}</strong> &middot; Critic: <strong>\${esc(rp.criticVerdict)}</strong> &middot; Consensus: <strong>\${rp.consensusComplete ? 'COMPLETE' : 'PENDING'}</strong></div>\` : '';
        const crRows = crList.map((c) => \`<div><span class="badge">\${esc(c.recommendation)}</span> <code>\${esc(c.file)}</code> (Architect: \${esc(c.architectStatus)}, \${c.filesReviewed} files)</div>\`).join('');
        const resRows = resList.map((r) => \`<div style="margin-top:4px;"><span class="badge badge-active">Research \${r.compositeScore !== null ? r.compositeScore + '/100' : ''}</span> <strong>\${esc(r.title)}</strong> <span class="muted">(\${esc(r.lens)} &middot; V:\${r.claims.verified} D:\${r.claims.derived} A:\${r.claims.assumed})</span></div>\`).join('');
        revResHtml = \`
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px;">Recent Reviews &amp; Deep Research</div>
            \${rpLine}
            \${crRows}
            \${resRows}
          </div>\`;
      }

      const counts = {
        skills: data.catalog?.skills?.length || 0,
        subagents: data.catalog?.subagents?.length || 0,
        workflows: data.catalog?.workflows?.length || 0,
      };

      document.getElementById('view-overview').innerHTML = \`
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;margin-bottom:2px;">Workspace</div>
            <code>\${esc(data.workspace)}</code>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="badge" style="cursor:pointer;" onclick="setTab('workflows')">\${counts.workflows} Workflows</button>
            <button class="badge" style="cursor:pointer;" onclick="setTab('skills')">\${counts.skills} Skills</button>
            <button class="badge" style="cursor:pointer;" onclick="setTab('subagents')">\${counts.subagents} Subagents</button>
          </div>
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Workflow Modes</div>
          \${modesRows ? \`<table><thead><tr><th>Mode</th><th>Phase</th><th>State</th><th>Iter</th><th>Scope</th></tr></thead><tbody>\${modesRows}</tbody></table>\` : '<div class="muted">No active mode state files in .omagy/state/. Open the <strong>Workflows</strong> or <strong>Skills</strong> tab for quick-start commands.</div>'}
        </div>
        \${ugHtml}
        \${ivHtml}
        \${teamHtml}
        \${revResHtml}
        \${qgRows ? \`<div class="card"><div style="font-weight:600;margin-bottom:6px;">Configured Quality Gates</div><ul style="margin:0;padding-left:18px;">\${qgRows}</ul></div>\` : ''}
      \`;
    }

    function renderWorkflows(data) {
      const list = data.catalog?.workflows || [];
      document.getElementById('view-workflows').innerHTML = list.map((wf) => {
        const stagesHtml = (wf.stages || []).map((s, idx) => \`
          <span class="badge">\${idx + 1}. \${esc(s)}</span>\`).join('<span class="muted" style="align-self:center;">&rarr;</span>');
        return \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
              <div style="font-weight:600;">\${esc(wf.title)}</div>
              \${wf.active ? \`<span class="badge badge-active">ACTIVE (\${esc(wf.currentPhase)})</span>\` : \`<span class="badge">\${esc(wf.modeKey)}</span>\`}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">\${stagesHtml}</div>
            <div style="margin-bottom:6px;"><strong>When to use:</strong> <span class="muted">\${esc(wf.whenToUse)}</span></div>
            <div class="muted" style="font-size:11.5px;"><strong>State / Artifacts:</strong> <code>\${esc(wf.artifacts)}</code></div>
            <div class="cmd-box">
              <span>\${esc(wf.quickStart)}</span>
              <button class="badge" style="cursor:pointer;" data-cmd="\${esc(wf.quickStart)}" onclick="copyQuickStart(this, this.dataset.cmd)">Copy</button>
            </div>
          </div>\`;
      }).join('');
    }

    function renderSkillsListOnly(data) {
      const allSkills = data.catalog?.skills || [];
      const q = skillSearch.trim().toLowerCase();
      const filtered = allSkills.filter((s) => {
        if (skillCategory !== 'All' && s.category !== skillCategory) return false;
        if (!q) return true;
        return s.name.toLowerCase().includes(q)
          || s.category.toLowerCase().includes(q)
          || s.howToUse.toLowerCase().includes(q)
          || s.quickStart.toLowerCase().includes(q)
          || (s.flags || []).some((f) => f.toLowerCase().includes(q));
      });
      const container = document.getElementById('skills-cards-container');
      if (!container) return;
      if (!filtered.length) {
        container.innerHTML = '<div class="card muted">No skills match the current filter.</div>';
        return;
      }
      container.innerHTML = filtered.map((s) => {
        const flagsHtml = (s.flags || []).map((f) => \`<span class="badge"><code>\${esc(f)}</code></span>\`).join(' ');
        return \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <div>
                <code style="font-weight:600;font-size:13px;">/\${esc(s.name)}</code>
                <span class="muted" style="font-size:11.5px;margin-left:4px;">($\${esc(s.name)})</span>
              </div>
              <span class="badge">\${esc(s.category)}</span>
            </div>
            \${flagsHtml ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">\${flagsHtml}</div>\` : ''}
            <div style="margin-bottom:4px;">\${esc(s.howToUse)}</div>
            <div class="cmd-box">
              <span>\${esc(s.quickStart)}</span>
              <button class="badge" style="cursor:pointer;" data-cmd="\${esc(s.quickStart)}" onclick="copyQuickStart(this, this.dataset.cmd)">Copy</button>
            </div>
          </div>\`;
      }).join('');
    }

    function renderSkills(data) {
      const allSkills = data.catalog?.skills || [];
      const categories = ['All', ...new Set(allSkills.map((s) => s.category))];
      const catBtns = categories.map((c) => \`
        <button class="tab-btn \${skillCategory === c ? 'active' : ''}" onclick="setSkillCategory('\${esc(c)}')">\${esc(c)}</button>\`).join('');
      document.getElementById('view-skills').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:6px;">Skills Catalog (\${allSkills.length} skills)</div>
          <input type="text" class="search-input" placeholder="Search skills by name, flag, or use case (e.g. deep-research, review, team)..." value="\${esc(skillSearch)}" oninput="onSkillSearchInput(this.value)" />
          <div style="display:flex;gap:4px;flex-wrap:wrap;">\${catBtns}</div>
        </div>
        <div id="skills-cards-container"></div>
      \`;
      renderSkillsListOnly(data);
    }

    function renderSubagents(data) {
      const allSubagents = data.catalog?.subagents || [];
      const lanes = ['All', ...new Set(allSubagents.map((a) => a.lane))];
      const laneBtns = lanes.map((l) => \`
        <button class="tab-btn \${subagentLane === l ? 'active' : ''}" onclick="setSubagentLane('\${esc(l)}')">\${esc(l)}</button>\`).join('');
      const filtered = allSubagents.filter((a) => subagentLane === 'All' || a.lane === subagentLane);
      const cards = filtered.map((a) => \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <code style="font-weight:600;font-size:13px;">\${esc(a.name)}</code>
            <div style="display:flex;gap:4px;align-items:center;">
              <span class="badge">\${esc(a.lane)}</span>
              <span class="badge badge-active">Model: \${esc(a.modelTier)}</span>
            </div>
          </div>
          <div style="margin-bottom:4px;">\${esc(a.whenToUse)}</div>
          <div class="muted" style="font-size:11.5px;">Invoke via <code>invoke_subagent(TypeName: "\${esc(a.name)}")</code></div>
        </div>\`).join('');
      document.getElementById('view-subagents').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:4px;">Role Subagents (\${allSubagents.length} specialists)</div>
          <div class="muted" style="margin-bottom:8px;">Work-shape model routing: <code>flash</code> for quick/mechanical lookups, <code>inherit</code> for cohesive implementation/research, and <code>pro</code> for architecture, critique, causal tracing, and security review.</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">\${laneBtns}</div>
        </div>
        \${cards}
      \`;
    }

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

    function renderDoctor(data) {
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

    function render(data) {
      document.getElementById('status-line').textContent = data.statusLine || '[OMA] No active modes';
      renderOverview(data);
      renderWorkflows(data);
      renderSkills(data);
      renderSubagents(data);
      renderWiki(data);
      renderDoctor(data);
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
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'research'), { recursive: true });
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
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'research', 'deep-research-vector.md'), [
      '# Vector Indexing Tradeoffs: A Multi-Lens Deep Investigation',
      '- **Lens(es)**: `technical`',
      'Claim 1 [VERIFIED] and Claim 2 [DERIVED] with token ghp_1234567890abcdefghij123456.',
      '| **Overall Composite** | >= 85 | 91.2 | Audited |',
    ].join('\n'));
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
    const deepResearchSkill = snap.catalog?.skills?.find((s) => s.name === 'deep-research');
    const autopilotWf = snap.catalog?.workflows?.find((w) => w.id === 'autopilot');

    const ok = JSON.stringify(snap.allowedViews) === JSON.stringify(['overview', 'workflows', 'skills', 'subagents', 'wiki', 'doctor'])
      && snap.statusLine.includes('autopilot:ultragoal')
      && snap.statusLine.includes('ultragoal:1/1')
      && snap.catalog?.skills?.length === 27
      && Boolean(deepResearchSkill && deepResearchSkill.flags.includes('--technical') && deepResearchSkill.quickStart.includes('/deep-research'))
      && snap.catalog?.subagents?.length === 18
      && snap.catalog?.workflows?.length >= 6
      && Boolean(autopilotWf && autopilotWf.active === true && autopilotWf.currentPhase === 'ultragoal')
      && snap.research?.length === 1
      && snap.research[0].compositeScore === 91.2
      && snap.research[0].claims.verified === 1
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

    process.stdout.write(`${JSON.stringify({
      selftest: ok ? 'PASS' : 'FAIL',
      views: snap.allowedViews.length,
      skills: snap.catalog?.skills?.length || 0,
      subagents: snap.catalog?.subagents?.length || 0,
      workflows: snap.catalog?.workflows?.length || 0,
      statusLine: snap.statusLine,
    })}\n`);
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
