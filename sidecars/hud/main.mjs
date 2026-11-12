#!/usr/bin/env node
// oh-my-agy HUD Sidecar (UI Extension for Antigravity Auxiliary Pane).
// Read-only status polling (`GET /api/status`, zero-mutation invariant) + authenticated `agentapi`
// launcher (`POST /api/dispatch`) serving `sidecar://oh-my-agy/hud/` (`?view=overview|workflows|skills|subagents|wiki`).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import {
  analyzeDiffCodeHealth,
  checkVerificationFreshness,
  discoverOmagyScopes,
  hardenWindowsExeSearch,
  isAwaitingConfirmation,
  redactSecrets,
  readJsonlRecords,
  scanShortcutDebt,
  stateRoot,
  stripUtf8Bom,
  validateQualityGates,
} from '../../hooks/omagy-hook.mjs';
import {
  evaluateSkillRouting,
  runFloorGuard,
} from '../../hooks/omagy-cli.mjs';
import {
  HUD_HTML,
  buildSkillCommandWithFlags,
  buildSubagentInvokeSnippet,
  buildWikiMindMapGraph,
  formatAgreementCard,
  formatScopeLabel,
  formatWorkspaceName,
  highlightMatch,
  parseWorkflowStageLabel,
  prepareLoftSrcdoc,
  projectMindMapPoint,
  renderHudHtml,
  renderSafeMarkdown,
  resolveWorkflowStageState,
  selectCurrentMode,
} from './ui.mjs';

export {
  HUD_HTML,
  buildSkillCommandWithFlags,
  buildSubagentInvokeSnippet,
  buildWikiMindMapGraph,
  formatAgreementCard,
  formatScopeLabel,
  formatWorkspaceName,
  highlightMatch,
  parseWorkflowStageLabel,
  prepareLoftSrcdoc,
  projectMindMapPoint,
  renderHudHtml,
  renderSafeMarkdown,
  resolveWorkflowStageState,
  selectCurrentMode,
};

hardenWindowsExeSearch();

const BIND_HOST = '127.0.0.1';
const STALE_MS = 6 * 3600 * 1000;
const TEAM_COMPLETED_WINDOW_MS = 20 * 60 * 1000;
const CODE_HEALTH_TTL_MS = 5000;
const MAX_CODE_HEALTH_CACHE_ENTRIES = 32;
const MAX_DISPATCH_BODY_BYTES = 16 * 1024;
const TERMINAL = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
const WIKI_CATEGORIES = new Set(['architecture', 'decision', 'pattern', 'debugging', 'environment', 'session-log', 'reference', 'convention']);
const ALLOWED_DISPATCH_MODES = new Set(['active-chat', 'new-chat', 'subagent-active', 'subagent-standalone']);
const ALLOWED_CLI_MODELS = new Set(['flash_lite', 'flash', 'pro']);
export const ALLOWED_VIEWS = ['overview', 'workflows', 'skills', 'subagents', 'wiki'];
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_MODULE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ui.mjs');
let liveUiMtimeMs = 0;
let liveHudHtml = HUD_HTML;
try {
  liveUiMtimeMs = fs.statSync(UI_MODULE_PATH).mtimeMs;
} catch { /* fail open: fallback to static HUD_HTML */ }

async function getLiveHudHtml() {
  try {
    const st = fs.statSync(UI_MODULE_PATH);
    if (st.mtimeMs !== liveUiMtimeMs) {
      const freshMod = await import(`${pathToFileURL(UI_MODULE_PATH).href}?t=${st.mtimeMs}`);
      if (typeof freshMod.HUD_HTML === 'string' && freshMod.HUD_HTML.length > 0) {
        liveHudHtml = freshMod.HUD_HTML;
        liveUiMtimeMs = st.mtimeMs;
      }
    }
  } catch { /* fail open: serve last valid HUD_HTML if ui.mjs is mid-write */ }
  return liveHudHtml;
}

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
  '.md': 'text/plain; charset=utf-8',
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
    flags: ['--quick', '--standard', '--deep', '--autoresearch', '--ideate'],
    quickStart: '/deep-interview I want to add role-based access control to this app',
    howToUse: 'Runs Socratic clarification rounds via ask_question until ambiguity is <= 20% and writes an execution-ready spec to .omagy/specs/ (or divergent ideation artifacts to .omagy/artifacts/ideas/ with --ideate).',
  },
  ralplan: {
    category: 'Orchestration & Planning',
    flags: ['--interactive', '--deliberate', '--hyperplan', '--advisory', '--light', '--interview', '--review', '--migrate'],
    quickStart: '/ralplan --deliberate "redesign the token refresh pipeline"',
    howToUse: 'Generates a PRD + test spec in .omagy/plans/ with sequential Architect then Critic consensus reviews, or scopes bounded features and brownfield migrations via --light, --interview, --review, and --migrate.',
  },
  ultragoal: {
    category: 'Execution & Teams',
    flags: ['create-goals', 'complete-goals'],
    quickStart: '/ultragoal execute the approved plan in .omagy/plans/',
    howToUse: 'Decomposes specs/plans into .omagy/ultragoal/goals.json and executes them sequentially with ledger.jsonl audit receipts and light/heavy verification.',
  },
  team: {
    category: 'Execution & Teams',
    flags: ['--amend', '--arena'],
    quickStart: '/team execute the approved plan across parallel backend and frontend workers',
    howToUse: 'Coordinates up to 6 parallel executor (or specialist) subagents on a leader-owned DAG task board (.omagy/state/team/) with verified task-<id>.json evidence, live DAG amendments (--amend), and candidate bake-offs (--arena).',
  },
  'performance-goal': {
    category: 'Execution & Teams',
    flags: [],
    quickStart: '/performance-goal reduce cold-start latency by 25% using npm run bench',
    howToUse: 'Evaluator-gated optimization loop that records baseline and small reversible patch checkpoints under .omagy/goals/performance/.',
  },
  'deep-research': {
    category: 'Research & Analysis',
    flags: ['--technical', '--business', '--idea', '--implementation', '--quick', '--loop'],
    quickStart: '/deep-research --technical "HNSW vs DiskANN vector indexing tradeoffs at 50M vectors"',
    howToUse: 'Runs a 5-phase investigation into .omagy/artifacts/research/, fast official-docs lookups (--quick), or validator-gated research loops (--loop) using .omagy/state/autoresearch-state.json.',
  },
  analyze: {
    category: 'Research & Analysis',
    flags: ['--deep', '--audit', '--blast-radius', '--statechart'],
    quickStart: '/analyze why the session middleware drops cookies on redirect',
    howToUse: 'Read-only cross-file repository analysis with 6-tier evidence ranking, competing hypothesis tracing (--deep), blast-radius impact (--blast-radius), Mermaid statecharts (--statechart), and whole-repo lean audits (--audit).',
  },
  ask: {
    category: 'Research & Analysis',
    flags: ['claude', 'gemini', 'codex', '--doubt'],
    quickStart: '/ask claude "review our event-sourcing schema for edge cases"',
    howToUse: 'Queries a locally installed external CLI advisor (Claude, Gemini, or Codex) via read-only stdin sandboxing (or adversarial --doubt review) and saves the response under .omagy/artifacts/.',
  },
  'code-review': {
    category: 'Review, QA & Cleanup',
    flags: ['--re-review', '--audit', '--ship', '--security'],
    quickStart: '/code-review the changes on my current branch',
    howToUse: 'Pre-assembles a git review package and dispatches independent code-reviewer and architect subagents for a deterministic APPROVE / REQUEST CHANGES / COMMENT verdict (plus --audit, --ship, or --security STRIDE/OWASP gates).',
  },
  ultraqa: {
    category: 'Review, QA & Cleanup',
    flags: ['--tests', '--build', '--lint', '--typecheck', '--interactive', '--custom'],
    quickStart: '/ultraqa --tests --interactive "checkout flow"',
    howToUse: 'Runs up to 5 cycles of 9-class adversarial QA (boundary inputs, concurrency, idempotency, failure injection) with automated diagnosis and fixes.',
  },
  'ai-slop-cleaner': {
    category: 'Review, QA & Cleanup',
    flags: ['--review'],
    quickStart: '/ai-slop-cleaner clean up src/services/',
    howToUse: 'Locks behavior with regression tests first, runs check-test-junk and R/F/C/D test hygiene checks, and removes dead code and duplicate wrappers in bounded passes.',
  },
  pr: {
    category: 'Review, QA & Cleanup',
    flags: ['--watch', '--ship'],
    quickStart: '/pr draft a pull request body for this branch',
    howToUse: 'Assembles a review-ready PR description from the .omagy/ paper trail, runs pre-ship readiness gates (--ship), and triages/watches open PRs (--watch) across CI, review threads, and merge state.',
  },
  'visual-ralph': {
    category: 'Design & Prototyping',
    flags: ['--design'],
    quickStart: '/visual-ralph match the hero section to reference.png',
    howToUse: 'Iterative frontend implementation loop driven by vision subagent verdicts and pixel/overlay comparison under .omagy/artifacts/visual-ralph/, or DESIGN.md governance (--design).',
  },
  loft: {
    category: 'Design & Prototyping',
    flags: ['--arena'],
    quickStart: '/loft prototype 3 layout variants for the timeline switcher',
    howToUse: 'Builds a throwaway prototype under .omagy/artifacts/loft/<slug>/index.html to settle a UI or pure-logic fork (or runs an isolated candidate bake-off via --arena) before production coding.',
  },
  wiki: {
    category: 'Knowledge, Control & Setup',
    flags: ['add', 'query', 'read', 'lint', 'delete'],
    quickStart: '/wiki query architecture',
    howToUse: 'Manages persistent repo knowledge in omagy_wiki/ (architecture, decisions, debugging notes, and [by:human] working agreements).',
  },
  hud: {
    category: 'Knowledge, Control & Setup',
    flags: ['--preset=minimal', '--preset=focused', '--preset=full', '--handoff'],
    quickStart: '/hud --preset=full',
    howToUse: 'Renders a read-only chat status table of active .omagy/ modes, Ultragoal progress, and team boards, or writes a session continuation packet to .omagy/artifacts/handoff-latest.md (--handoff).',
  },
  cancel: {
    category: 'Knowledge, Control & Setup',
    flags: ['--force'],
    quickStart: '/cancel autopilot',
    howToUse: 'Cleanly terminates active workflow modes, preserves unmerged subagent worktrees, and marks state files cancelled.',
  },
  doctor: {
    category: 'Knowledge, Control & Setup',
    flags: ['--setup', '--notifications', '--init-deep', '--session', '--session-compare', '--session-scan', '--export'],
    quickStart: '/doctor',
    howToUse: 'Audits plugin manifests, SDO skill compliance, hook selftests, and stale states; manages setup/AGENTS.md (--setup, --init-deep), stop/idle notifications in .omagy/notifications.json (--notifications), and session forensics (--session, --session-compare, --session-scan).',
  },
  skill: {
    category: 'Knowledge, Control & Setup',
    flags: ['list', 'init', 'add', 'edit', 'remove', 'scan', 'sync', 'validate', 'test', 'eval', 'extract'],
    quickStart: '/skill test deep-research',
    howToUse: 'Creates, validates, extracts reusable skills (extract), evaluates routing accuracy (eval), and pressure-tests Antigravity skills (RED -> GREEN -> REFACTOR behavioral subagent evaluation).',
  },
};

const SUBAGENT_GUIDE_META = {
  explore: {
    lane: 'Discovery & Research',
    modelTier: 'flash | inherit',
    defaultPrompt: 'Map the key files, symbols, and call paths for the current feature',
    whenToUse: 'Fast, read-only repo lookup: locate files, symbols, call graphs, and existing dependency usage before planning or editing.',
  },
  researcher: {
    lane: 'Discovery & Research',
    modelTier: 'inherit',
    defaultPrompt: 'Fetch official documentation, version constraints, and dependency tradeoffs for the target API or package',
    whenToUse: 'External official documentation, upstream API signatures, release notes, RFCs, package/SDK adoption & migration comparison, and Tier A-C evidence for /deep-research and /deep-research --quick.',
  },
  planner: {
    lane: 'Planning & Architecture',
    modelTier: 'inherit',
    defaultPrompt: 'Surface hidden requirements and draft a right-sized PRD and test spec in .omagy/plans/',
    whenToUse: 'Requirements/assumption analysis (Capability Map DAG, Always/Ask/Never boundaries, Must/Should/Might tiers) and right-sized implementation plans (prd-<slug>.md and test-spec-<slug>.md).',
  },
  architect: {
    lane: 'Planning & Architecture',
    modelTier: 'pro | inherit',
    defaultPrompt: 'Review architectural boundaries, steelman tradeoffs, and ADR reversibility of recent changes',
    whenToUse: 'Read-only architectural review, steelman antithesis, Demolition/ADR tests, and CLEAR / WATCH / BLOCK rulings in /ralplan and /code-review.',
  },
  critic: {
    lane: 'Planning & Architecture',
    modelTier: 'pro | inherit',
    defaultPrompt: 'Audit the active plan in .omagy/plans/ against quality, edge-case, and testability criteria',
    whenToUse: 'Sequential quality gate after Architect in /ralplan: issues APPROVE / ITERATE / REJECT against principles, edge cases, and testability.',
  },
  executor: {
    lane: 'Execution & Debugging',
    modelTier: 'flash | inherit | pro',
    defaultPrompt: 'Implement the next bounded task slice and run its verification command',
    whenToUse: 'Autonomous implementation worker for bounded goal/task slices, post-edit code simplification (Chesterton\'s Fence, Rule of 500), and /team DAG tasks writing .omagy/evidence/task-<id>.json.',
  },
  debugger: {
    lane: 'Execution & Debugging',
    modelTier: 'inherit',
    defaultPrompt: 'Isolate the root cause of the failing test or runtime regression',
    whenToUse: 'Root-cause isolation, stack-trace backward tracing, find-polluter test bisection, and 4-layer defense-in-depth bug fixes.',
  },
  tracer: {
    lane: 'Execution & Debugging',
    modelTier: 'pro | inherit',
    defaultPrompt: 'Form competing hypotheses and rank evidence to trace the causal chain of this issue',
    whenToUse: 'Competing-hypothesis causal tracing with 6-tier evidence ranking, disconfirmation probes, and discriminating next-step experiments.',
  },
  'test-engineer': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    defaultPrompt: 'Design high-signal unit and integration tests covering edge cases and failure modes',
    whenToUse: 'Design and harden unit/integration/e2e tests using the 4-question authoring gate, R/F/C/D marks, 15 junk-test classes (check-test-junk), and 2x2 mutation proof.',
  },
  verifier: {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    defaultPrompt: 'Run independent fresh verification commands to confirm completion claims',
    whenToUse: 'Independent completion gate (AdversarialVerify) running fresh commands and Red-Green revert checks to confirm or reject a DoneClaim.',
  },
  'code-reviewer': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    defaultPrompt: 'Perform a severity-rated code review of the current branch diff with file:line evidence',
    whenToUse: 'Severity-rated review of a pre-assembled review-package diff with file:line evidence, Spec-Silence checks, and scoped --re-review.',
  },
  'security-reviewer': {
    lane: 'Review & Verification',
    modelTier: 'pro | inherit',
    defaultPrompt: 'Audit recent changes for OWASP Top 10, injection, auth, secret exposure, and path traversal risks',
    whenToUse: 'OWASP Top 10, auth/session boundaries, injection, path traversal, and secret exposure audit on security-sensitive changes.',
  },
  designer: {
    lane: 'Design & Visual',
    modelTier: 'inherit',
    defaultPrompt: 'Audit UI layout, typography, color contrast, and responsive reflow against DESIGN.md',
    whenToUse: 'UI/UX design system authoring (DESIGN.md) and polished frontend implementation enforcing the Impeccable Craft Floor and 320px reflow.',
  },
  vision: {
    lane: 'Design & Visual',
    modelTier: 'inherit',
    defaultPrompt: 'Compare the current UI screenshot against the visual reference target and score differences',
    whenToUse: 'Visual/media analysis of screenshots, mockups, and live renders, issuing scored Visual Ralph verdicts and pixel-diff fix lists.',
  },
};

export function normalizeCliModel(modelTier) {
  const raw = String(modelTier || '').trim().toLowerCase();
  if (!raw || raw === 'inherit' || raw.includes('flash | inherit | pro')) return '';
  const first = raw.split('|')[0].trim();
  return ALLOWED_CLI_MODELS.has(first) ? first : '';
}

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
    title: 'Multi-Agent Consensus Planning (/ralplan & --light)',
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
    stages: ['DAG Task Board (tasks.json)', 'Wave Dispatch (Workspace: share)', 'Executor Evidence (task-<id>.json)', 'Leader Verify & Merge'],
    whenToUse: 'When an approved plan has 2-6 independent module slices that can be implemented in parallel by executor or specialist subagents.',
    quickStart: '/team run parallel executor lanes on the approved plan',
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

export function readJsonSafe(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, 'utf8')));
  } catch { /* fail open: unreadable or malformed JSON */
    return null;
  }
}

function readTextSafe(filePath, maxBytes = 64 * 1024) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return '';
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
  } catch { /* fail open: unreadable or missing text file */
    return '';
  }
}

function uriToFsPath(uriOrPath) {
  const raw = String(uriOrPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file://')) {
    try { return fileURLToPath(raw); } catch { /* fail open: malformed file URI */ return ''; }
  }
  return path.isAbsolute(raw) ? raw : '';
}

function resolveStateRoot(rawRoot) {
  return stateRoot(rawRoot);
}

export function resolveSafeArtifactFile(workspaceRoot, relPath) {
  if (typeof relPath !== 'string') return null;
  const raw = relPath;
  if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    return null;
  }
  const rawParts = raw.split('/');
  if (rawParts.some((p) => !p || p === '.' || p === '..')) return null;

  const expanded = /^(?:visual-ralph|loft|research|ideas)\//.test(raw)
    ? `.omagy/artifacts/${raw}`
    : raw;

  let scopePrefix = '.';
  let omagySubpath = expanded;
  if (!expanded.startsWith('.omagy/')) {
    const markerIdx = expanded.indexOf('/.omagy/');
    if (markerIdx <= 0) return null;
    scopePrefix = expanded.slice(0, markerIdx);
    omagySubpath = expanded.slice(markerIdx + 1);
  }

  const ext = path.extname(omagySubpath).toLowerCase();
  let mime = '';
  let redact = false;

  if (ext === '.html') {
    if (!/^\.omagy\/artifacts\/loft\/[^/]+\/(?:variant-[a-c]\/)?index\.html$/.test(omagySubpath)) {
      return null;
    }
    mime = 'text/html; charset=utf-8';
    redact = false;
  } else if (/^\.omagy\/artifacts\/loft\/[^/]+\/(?:[^/]+\/)*[^/]+\.(?:js|mjs|css)$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = false;
  } else if (/^\.omagy\/artifacts\/(?:visual-ralph|loft)\/(?:[^/]+\/)*[^/]+\.(?:png|jpe?g|webp|svg)$/i.test(omagySubpath)) {
    mime = MIME_BY_EXT[ext] || '';
    redact = false;
  } else if (/^\.omagy\/artifacts\/(?:visual-ralph|loft|research|ideas)\/(?:[^/]+\/)*[^/]+\.(?:md|txt|json)$/i.test(omagySubpath)) {
    if (ext === '.json') {
      mime = 'application/json; charset=utf-8';
      redact = false;
    } else {
      mime = 'text/plain; charset=utf-8';
      redact = true;
    }
  } else if (/^\.omagy\/artifacts\/[^/]+\.(?:md|txt)$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/plans\/[^/]+\.md$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/specs\/(?:[^/]+\.md|autoresearch-[^/]+\/report\.md)$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else {
    return null;
  }
  if (!mime) return null;

  try {
    const rootReal = fs.realpathSync(resolveStateRoot(workspaceRoot));
    const matchedScope = discoverOmagyScopes(rootReal, 3, 150).find((s) => s.scope === scopePrefix);
    if (!matchedScope) return null;

    const fullParts = scopePrefix === '.'
      ? omagySubpath.split('/')
      : [...scopePrefix.split('/'), ...omagySubpath.split('/')];
    let cur = rootReal;
    for (const part of fullParts) {
      cur = path.join(cur, part);
      if (fs.lstatSync(cur).isSymbolicLink()) return null;
    }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink() || !st.isFile()) return null;

    const candidateReal = fs.realpathSync(cur);
    const scopeOmagyReal = fs.realpathSync(matchedScope.omagyDir);
    const allowedSubroots = [
      path.join(scopeOmagyReal, 'artifacts') + path.sep,
      path.join(scopeOmagyReal, 'plans') + path.sep,
      path.join(scopeOmagyReal, 'specs') + path.sep,
    ];
    if (!candidateReal.startsWith(rootReal + path.sep) || !allowedSubroots.some((sub) => candidateReal.startsWith(sub))) {
      return null;
    }
    return { filePath: candidateReal, mime, redact };
  } catch { /* fail open: deny artifact resolution when path is missing or unreadable */
    return null;
  }
}

const codeHealthCache = new Map();
let skillEvalCache = { key: '', value: null };

function statMtimeToken(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch { /* fail open: optional metadata file may not exist yet */
    return 'missing';
  }
}

function readGitMetadataSignature(rootDir) {
  const dotGit = path.join(rootDir, '.git');
  let gitDir = dotGit;
  try {
    const st = fs.statSync(dotGit);
    if (st.isFile()) {
      const raw = fs.readFileSync(dotGit, 'utf8');
      const m = /^gitdir:\s*(.+)$/im.exec(raw);
      if (m) gitDir = path.resolve(rootDir, m[1].trim());
    } else if (!st.isDirectory()) {
      return 'nogit';
    }
  } catch { /* fail open: workspace may not be a git worktree */
    return 'nogit';
  }
  const indexSig = statMtimeToken(path.join(gitDir, 'index'));
  const headPath = path.join(gitDir, 'HEAD');
  const headSig = statMtimeToken(headPath);
  let refSig = '';
  try {
    const headRaw = fs.readFileSync(headPath, 'utf8').trim();
    if (headRaw.startsWith('ref:')) {
      const refRel = headRaw.slice(4).trim();
      let commonGitDir = gitDir;
      const commondirFile = path.join(gitDir, 'commondir');
      if (fs.existsSync(commondirFile)) {
        const cdRel = fs.readFileSync(commondirFile, 'utf8').trim();
        if (cdRel) commonGitDir = path.resolve(gitDir, cdRel);
      }
      refSig = statMtimeToken(path.join(commonGitDir, refRel));
    }
  } catch { /* fail open: detached or unborn HEAD ref */ }
  return `${indexSig}|${headSig}|${refSig}`;
}

function readLatestRouting(runtimeDir = process.env.OMAGY_RUNTIME_DIR || path.join(os.tmpdir(), 'oh-my-agy')) {
  try {
    if (!fs.existsSync(runtimeDir) || fs.lstatSync(runtimeDir).isSymbolicLink()) return null;
    const routingFiles = fs.readdirSync(runtimeDir)
      .filter((f) => f.endsWith('.routing.json'))
      .map((f) => {
        const p = path.join(runtimeDir, f);
        try {
          const st = fs.lstatSync(p);
          return st.isFile() && !st.isSymbolicLink() ? { file: f, path: p, mtimeMs: st.mtimeMs } : null;
        } catch { /* fail open: skip unreadable routing entry */ return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (!routingFiles.length) return null;
    const data = readJsonSafe(routingFiles[0].path);
    if (!data) return null;
    return {
      conversationId: routingFiles[0].file.replace(/\.routing\.json$/, ''),
      at: String(data.at || new Date(routingFiles[0].mtimeMs).toISOString()),
      skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
      transcriptPath: String(data.transcriptPath || ''),
    };
  } catch { /* fail open: runtime directory unavailable */
    return null;
  }
}

export function getCachedCodeHealth(primaryRoot, nowMs = Date.now(), transcriptPath = null) {
  const rootKey = path.resolve(primaryRoot);
  const txPath = typeof transcriptPath === 'string' ? transcriptPath.trim() : (readLatestRouting()?.transcriptPath || '');
  const txSig = txPath ? `${txPath}:${statMtimeToken(txPath)}` : 'notx';
  const gitSig = `${readGitMetadataSignature(rootKey)}|${txSig}`;
  const cached = codeHealthCache.get(rootKey);
  if (
    cached
    && cached.gitSig === gitSig
    && nowMs >= cached.computedAtMs
    && (nowMs - cached.computedAtMs) < CODE_HEALTH_TTL_MS
  ) {
    return cached.value;
  }

  const diffHealth = analyzeDiffCodeHealth([rootKey]);
  const debtScan = scanShortcutDebt([rootKey]);
  const fgRes = runFloorGuard(rootKey, '');
  const freshness = checkVerificationFreshness(txPath);
  const fgSummary = fgRes?.summary || {};
  const floorGuard = {
    ok: Boolean(fgRes?.ok),
    exitCode: Number(fgRes?.exitCode ?? 2),
    deletedTests: Number(fgSummary.deletedTests || 0),
    removedAssertions: Number(fgSummary.removedAssertions || 0),
    untrackedBlockers: Number(fgSummary.untrackedBlockers || 0),
    suppressions: Number(fgSummary.silencedCheckers || 0),
    emptyCatches: Number(fgSummary.emptyCatches || 0),
    protectedBlocksModified: Number(fgSummary.protectedBlocksModified || 0),
    total: Number(fgSummary.total || 0),
  };

  const reusedList = Array.isArray(diffHealth.reused) ? diffHealth.reused.map(String) : [];
  const createdList = Array.isArray(diffHealth.created) ? diffHealth.created.map(String) : [];
  const value = {
    reused: reusedList,
    created: createdList,
    reusedCount: reusedList.length,
    newCount: createdList.length,
    reusePct: diffHealth.reusePct ?? null,
    openCallers: (diffHealth.openCallers || []).slice(0, 10).map((oc) => ({
      symbol: String(oc.symbol || ''),
      file: String(oc.file || ''),
      line: Number(oc.line || 0),
      snippet: redactSecrets(String(oc.snippet || oc.text || '')),
    })),
    debtTotal: Number(debtScan.total || 0),
    noTriggerCount: Number(debtScan.noTriggerCount || 0),
    debtItems: (debtScan.items || []).slice(0, 10).map((it) => ({
      file: String(it.file || ''),
      line: Number(it.line || 0),
      marker: String(it.marker || 'shortcut'),
      ceiling: redactSecrets(String(it.ceiling || '')),
      upgrade: redactSecrets(String(it.upgrade || '')),
      noTrigger: Boolean(it.noTrigger),
    })),
    floorGuard,
    verificationFreshness: freshness.status,
    lastVerifyCmd: redactSecrets(String(freshness.lastVerifyCmd || '')),
    lastEditedTarget: redactSecrets(String(freshness.lastEditedTarget || '')),
  };

  if (codeHealthCache.size >= MAX_CODE_HEALTH_CACHE_ENTRIES && !codeHealthCache.has(rootKey)) {
    const oldestKey = codeHealthCache.keys().next().value;
    if (oldestKey !== undefined) codeHealthCache.delete(oldestKey);
  }
  codeHealthCache.set(rootKey, { gitSig, computedAtMs: nowMs, value });
  return value;
}

function buildSkillEvalSignature(pluginRoot) {
  const rootDir = path.resolve(pluginRoot);
  const casesPath = path.join(rootDir, 'hooks', 'skill-eval-cases.json');
  const skillsDir = path.join(rootDir, 'skills');
  const parts = [rootDir, statMtimeToken(casesPath), statMtimeToken(skillsDir)];
  try {
    if (fs.existsSync(skillsDir) && !fs.lstatSync(skillsDir).isSymbolicLink()) {
      const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const dirName of dirs) {
        parts.push(`${dirName}:${statMtimeToken(path.join(skillsDir, dirName, 'SKILL.md'))}`);
      }
    }
  } catch { /* fail open: unreadable skills directory falls back to base signature */ }
  return parts.join('|');
}

function getCachedSkillEval(pluginRoot = PLUGIN_ROOT) {
  const sig = buildSkillEvalSignature(pluginRoot);
  if (skillEvalCache.value && skillEvalCache.key === sig) {
    return skillEvalCache.value;
  }
  const evalRes = evaluateSkillRouting(pluginRoot, { minRank1: 95 });
  const value = {
    ok: Boolean(evalRes.ok),
    rank1Pct: Number(evalRes.rank1Pct || 0),
    minRank1: Number(evalRes.minRank1 ?? 95),
    collisionErrors: evalRes.collisionErrors.length,
    negativeSurvivalPct: Number(evalRes.negativeSurvivalPct || 0),
  };
  skillEvalCache = { key: sig, value };
  return value;
}

function readModeFilesInDir(dir, sessionLabel = 'shared', scopeLabel = '.') {
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return [];
  } catch { /* fail open: missing state directory */ return []; }
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* fail open: unreadable state directory */ return []; }
  const out = [];
  for (const name of names) {
    const m = /^(.+)-state\.json$/.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(file); } catch { /* fail open: transient state file removal */ continue; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    const data = readJsonSafe(file);
    if (!data || typeof data !== 'object') continue;
    const updatedMs = Date.parse(data.updated_at || '') || st.mtimeMs || 0;
    const phase = String(data.current_phase || 'unknown');
    const isTerminal = TERMINAL.has(phase.toLowerCase()) || Boolean(data.completed_at);
    const awaitingConfirmation = isAwaitingConfirmation({ data, mtimeMs: st.mtimeMs });
    const isStale = Boolean(data.active === true && !isTerminal && !awaitingConfirmation && Date.now() - updatedMs > STALE_MS);
    out.push({
      mode: String(data.mode || m[1]),
      active: data.active === true && !isTerminal,
      phase,
      iteration: data.iteration ?? null,
      updatedAt: data.updated_at || new Date(st.mtimeMs).toISOString(),
      updatedMs,
      stale: isStale,
      awaitingConfirmation,
      session: sessionLabel,
      scope: scopeLabel,
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
  let currentListKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^[ \t]+/.test(line)) {
      const lm = /^  -\s*(.*)$/.exec(line);
      if (lm && currentListKey) {
        const item = lm[1].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
        if (item) {
          if (!Array.isArray(meta[currentListKey])) meta[currentListKey] = [];
          meta[currentListKey].push(item);
        }
      }
      continue;
    }
    const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      currentListKey = null;
      continue;
    }
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (!val || val.startsWith('#')) {
      currentListKey = key;
      meta[key] = '';
    } else if (val.startsWith('[') && val.endsWith(']')) {
      currentListKey = null;
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else if (val === 'true' || val === 'false') {
      currentListKey = null;
      meta[key] = val === 'true';
    } else {
      currentListKey = null;
      if (val.startsWith('"') && val.endsWith('"')) {
        meta[key] = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      } else if (val.startsWith("'") && val.endsWith("'")) {
        meta[key] = val.slice(1, -1).replace(/''/g, "'");
      } else {
        meta[key] = val.replace(/\s+#.*$/, '').trim();
      }
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
  } catch { /* fail open: skills catalog scan failed */ }

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
        const modelTier = guide.modelTier || 'inherit';
        subagents.push({
          name,
          lane: guide.lane || 'Execution & Debugging',
          modelTier,
          cliModel: normalizeCliModel(modelTier),
          defaultPrompt: guide.defaultPrompt || `Run a ${name} review on the current workspace`,
          description: rawDesc,
          whenToUse: guide.whenToUse || rawDesc,
        });
      }
    }
  } catch { /* fail open: agents catalog scan failed */ }

  const activeByMode = new Map();
  for (const m of activeModes) {
    if (m && m.active && !m.stale) {
      activeByMode.set(m.mode, m.phase);
    }
  }

  const workflows = WORKFLOW_BLUEPRINTS.map((wf) => {
    const altPhase = wf.modeKey === 'ralplan'
      ? activeByMode.get('plan')
      : (wf.modeKey === 'deep-research' ? activeByMode.get('autoresearch') : null);
    return {
      ...wf,
      active: activeByMode.has(wf.modeKey) || Boolean(altPhase),
      currentPhase: activeByMode.get(wf.modeKey) || altPhase || null,
    };
  });

  return { skills, subagents, workflows };
}

export function resolveActiveConversationId(workspaceRoot = process.cwd(), explicitId = '') {
  const validIdRe = /^[a-zA-Z0-9_-]{6,80}$/;
  const trimmedExplicit = String(explicitId || '').trim();
  if (validIdRe.test(trimmedExplicit)) return trimmedExplicit;

  const runtimeDir = process.env.OMAGY_RUNTIME_DIR || path.join(os.tmpdir(), 'oh-my-agy');
  try {
    if (fs.existsSync(runtimeDir) && !fs.lstatSync(runtimeDir).isSymbolicLink()) {
      const routingFiles = fs.readdirSync(runtimeDir)
        .filter((f) => f.endsWith('.routing.json'))
        .map((f) => {
          const p = path.join(runtimeDir, f);
          try {
            const st = fs.lstatSync(p);
            return st.isFile() && !st.isSymbolicLink() ? { id: f.replace(/\.routing\.json$/, ''), mtimeMs: st.mtimeMs } : null;
          } catch { /* fail open: skip unreadable routing file */ return null; }
        })
        .filter((r) => r && validIdRe.test(r.id))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (routingFiles.length) return routingFiles[0].id;
    }
  } catch { /* fail open: runtime directory unavailable */ }

  try {
    const stateRoot = resolveStateRoot(uriToFsPath(workspaceRoot) || workspaceRoot || process.cwd());
    const stateDir = path.join(stateRoot, '.omagy', 'state');
    const records = [...readModeFilesInDir(stateDir, 'shared')];
    const sessionsDir = path.join(stateDir, 'sessions');
    if (fs.existsSync(sessionsDir) && !fs.lstatSync(sessionsDir).isSymbolicLink()) {
      for (const name of fs.readdirSync(sessionsDir)) {
        const p = path.join(sessionsDir, name);
        try {
          const st = fs.lstatSync(p);
          if (st.isDirectory() && !st.isSymbolicLink()) {
            records.push(...readModeFilesInDir(p, name.slice(0, 12)));
          }
        } catch { /* fail open: skip unreadable session directory */ }
      }
    }
    const sorted = records
      .filter((r) => validIdRe.test(r.owner))
      .sort((a, b) => b.updatedMs - a.updatedMs);
    if (sorted.length) return sorted[0].owner;
  } catch { /* fail open: state directory unavailable */ }

  return '';
}

function resolveAgentApiBinary() {
  if (process.env.OMAGY_AGENTAPI_BIN) {
    return { bin: process.env.OMAGY_AGENTAPI_BIN, prefixArgs: [] };
  }
  const homeBin = path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agentapi');
  if (fs.existsSync(homeBin)) {
    return { bin: homeBin, prefixArgs: [] };
  }
  const appLs = '/Applications/Antigravity.app/Contents/Resources/bin/language_server';
  if (fs.existsSync(appLs)) {
    return { bin: appLs, prefixArgs: ['agentapi'] };
  }
  return { bin: 'agentapi', prefixArgs: [] };
}

function makeDispatchTitle(prefix, prompt) {
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  return `[${prefix}] ${clean}`;
}

export function dispatchHudAction(payload = {}, options = {}) {
  const mode = String(payload?.mode || '').trim();
  if (!ALLOWED_DISPATCH_MODES.has(mode)) {
    return { ok: false, status: 400, error: `Invalid dispatch mode: ${mode || '(empty)'}` };
  }

  const rawPrompt = String(payload?.prompt || '').trim();
  if (!rawPrompt || rawPrompt.length > 4000) {
    return { ok: false, status: 400, error: 'Prompt must be between 1 and 4000 characters' };
  }

  const pluginRoot = options.pluginRoot || PLUGIN_ROOT;
  const workspaceRoot = options.workspaceRoot || payload?.workspace || process.env.OMAGY_WORKSPACE || process.cwd();
  const catalog = buildPluginCatalog(pluginRoot);

  let agentName = '';
  let cliModel = '';
  if (mode === 'subagent-active' || mode === 'subagent-standalone') {
    agentName = String(payload?.agent || '').trim();
    const subagentMeta = catalog.subagents.find((a) => a.name === agentName);
    if (!agentName || !/^[a-z0-9-]+$/.test(agentName) || !subagentMeta) {
      return { ok: false, status: 400, error: `Unknown subagent: ${agentName || '(empty)'}` };
    }
    const requestedModel = String(payload?.model || '').trim();
    if (requestedModel && requestedModel !== 'inherit' && !ALLOWED_CLI_MODELS.has(requestedModel)) {
      return { ok: false, status: 400, error: `Invalid model tier: ${requestedModel}` };
    }
    cliModel = requestedModel ? normalizeCliModel(requestedModel) : subagentMeta.cliModel;
  }

  const { bin, prefixArgs } = resolveAgentApiBinary();
  const runner = typeof options.runner === 'function'
    ? options.runner
    : (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });

  const invokeAgentApi = (subArgs) => {
    const fullArgs = [...prefixArgs, ...subArgs];
    const out = runner(bin, fullArgs);
    return { command: bin, args: subArgs, output: String(out || '').trim() };
  };

  try {
    if (mode === 'new-chat') {
      const title = makeDispatchTitle('HUD', rawPrompt);
      const res = invokeAgentApi(['new-conversation', `--title=${title}`, '--', rawPrompt]);
      return { ok: true, status: 200, modeUsed: 'new-chat', fallback: false, ...res };
    }

    if (mode === 'active-chat') {
      const convId = resolveActiveConversationId(workspaceRoot, payload?.conversationId);
      const title = makeDispatchTitle('HUD', rawPrompt);
      if (convId) {
        try {
          const res = invokeAgentApi(['send-message', `--title=${title}`, '--', convId, rawPrompt]);
          return { ok: true, status: 200, modeUsed: 'active-chat', conversationId: convId, fallback: false, ...res };
        } catch { /* fail open: fall through to new-conversation when active conversation is closed */
          // Fall through to new-conversation if send-message fails on a closed/stale conversation.
        }
      }
      const res = invokeAgentApi(['new-conversation', `--title=${title}`, '--', rawPrompt]);
      return { ok: true, status: 200, modeUsed: 'new-chat', fallback: true, ...res };
    }

    if (mode === 'subagent-active') {
      const modelLabel = cliModel || 'inherit';
      const delegationPrompt = `Use invoke_subagent with TypeName="${agentName}" and Model="${modelLabel}" to complete this task: ${rawPrompt}`;
      const title = makeDispatchTitle(agentName, rawPrompt);
      const convId = resolveActiveConversationId(workspaceRoot, payload?.conversationId);
      if (convId) {
        try {
          const res = invokeAgentApi(['send-message', `--title=${title}`, '--', convId, delegationPrompt]);
          return {
            ok: true,
            status: 200,
            modeUsed: 'subagent-active',
            conversationId: convId,
            agent: agentName,
            model: modelLabel,
            fallback: false,
            ...res,
          };
        } catch { /* fail open: fall through to standalone specialist chat when active conversation is unreachable */
          // Fall through to standalone specialist conversation if active conversation is unreachable.
        }
      }
      const stArgs = ['new-conversation', `--profile=${agentName}`];
      if (cliModel) stArgs.push(`--model=${cliModel}`);
      stArgs.push(`--title=${title}`, '--', rawPrompt);
      const res = invokeAgentApi(stArgs);
      return {
        ok: true,
        status: 200,
        modeUsed: 'subagent-standalone',
        agent: agentName,
        model: modelLabel,
        fallback: true,
        ...res,
      };
    }

    // mode === 'subagent-standalone'
    const title = makeDispatchTitle(agentName, rawPrompt);
    const stArgs = ['new-conversation', `--profile=${agentName}`];
    if (cliModel) stArgs.push(`--model=${cliModel}`);
    stArgs.push(`--title=${title}`, '--', rawPrompt);
    const res = invokeAgentApi(stArgs);
    return {
      ok: true,
      status: 200,
      modeUsed: 'subagent-standalone',
      agent: agentName,
      model: cliModel || 'inherit',
      fallback: false,
      ...res,
    };
  } catch (err) { /* fail open: return 500 JSON when agentapi execution throws */
    return {
      ok: false,
      status: 500,
      error: redactSecrets(String(err?.message || err || 'Failed to invoke agentapi')),
    };
  }
}

function canonicalizeForDigest(value, isRoot = false) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeForDigest(item, false)).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => (!isRoot || (k !== 'at' && k !== 'digest')) && value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeForDigest(value[k], false)}`).join(',')}}`;
}

export function computeSnapshotDigest(snapshot) {
  const payload = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return crypto.createHash('sha256').update(canonicalizeForDigest(payload, true), 'utf8').digest('hex');
}

function extractMarkdownTitle(text, fallbackName) {
  const m = /^#\s+([^\r\n]+)/m.exec(String(text || ''));
  return redactSecrets((m ? m[1] : fallbackName).trim());
}

function resolveWorkspaceRoots(rawWorkspaces = [], fallbackWorkspaceRoot = '') {
  const candidates = [];
  for (const w of rawWorkspaces) {
    const p = uriToFsPath(w) || (typeof w === 'string' && path.isAbsolute(w.trim()) ? w.trim() : '');
    if (p && fs.existsSync(p) && !candidates.includes(p)) candidates.push(p);
  }
  if (!candidates.length && fallbackWorkspaceRoot) {
    const fb = uriToFsPath(fallbackWorkspaceRoot) || fallbackWorkspaceRoot;
    if (fb && fs.existsSync(fb)) candidates.push(fb);
  }
  if (!candidates.length && process.env.OMAGY_WORKSPACE && fs.existsSync(process.env.OMAGY_WORKSPACE)) {
    candidates.push(process.env.OMAGY_WORKSPACE);
  }
  if (!candidates.length && fs.existsSync(process.cwd())) {
    candidates.push(process.cwd());
  }
  const roots = [...new Set(candidates.map(resolveStateRoot))];
  const primaryRoot = roots[0] || process.cwd();
  return { roots, primaryRoot };
}

export function buildHudSnapshot(rawWorkspaces = [], nowMs = Date.now()) {
  const { roots, primaryRoot } = resolveWorkspaceRoots(rawWorkspaces);
  const scopeEntries = [];
  const seenScopeRoots = new Set();
  const pushScopeEntry = (rootDir, scopeRel) => {
    const abs = path.resolve(rootDir);
    if (seenScopeRoots.has(abs)) return;
    seenScopeRoots.add(abs);
    scopeEntries.push({ root: abs, scope: scopeRel || '.' });
  };
  pushScopeEntry(primaryRoot, '.');
  for (const root of roots) {
    pushScopeEntry(root, '.');
    for (const sc of discoverOmagyScopes(root, 3, 150)) {
      pushScopeEntry(sc.root, sc.scope);
    }
  }
  const trackedScopes = scopeEntries
    .filter((sc) => {
      try {
        const p = path.join(sc.root, '.omagy');
        return fs.existsSync(p) && !fs.lstatSync(p).isSymbolicLink();
      } catch { /* fail open: skip inaccessible .omagy directory */ return false; }
    })
    .map((sc) => ({
      scope: sc.scope,
      path: sc.root,
      hasState: fs.existsSync(path.join(sc.root, '.omagy', 'state')),
    }));

  const allModeRecords = [];
  const seenModeKeys = new Set();

  for (const sc of scopeEntries) {
    const scopePrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const stateDir = path.join(sc.root, '.omagy', 'state');
    for (const m of readModeFilesInDir(stateDir, `${scopePrefix}shared`, sc.scope)) {
      const k = `${sc.root}:shared:${m.mode}`;
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
            } catch { /* fail open: skip unreadable session entry */ return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 5);
        for (const sess of sessEntries) {
          for (const m of readModeFilesInDir(sess.path, `${scopePrefix}${sess.name.slice(0, 12)}`, sc.scope)) {
            const k = `${sc.root}:${sess.name}:${m.mode}`;
            if (!seenModeKeys.has(k)) { seenModeKeys.add(k); allModeRecords.push(m); }
          }
        }
      }
    } catch { /* fail open: sessions directory unavailable */ }
  }

  const modes = allModeRecords.map(({ raw: _raw, ...rest }) => rest);

  // 1. Ultragoal summary (across primaryRoot and discovered inner scopes)
  let ultragoal = null;
  for (const sc of scopeEntries) {
    const goalsPath = path.join(sc.root, '.omagy', 'ultragoal', 'goals.json');
    const goalsData = readJsonSafe(goalsPath);
    if (!goalsData || !Array.isArray(goalsData.goals)) continue;
    const ledgerPath = path.join(sc.root, '.omagy', 'ultragoal', 'ledger.jsonl');
    let recentLedger = [];
    try {
      if (fs.existsSync(ledgerPath)) {
        recentLedger = readJsonlRecords(ledgerPath).records.slice(-5).reverse();
      }
    } catch { /* fail open: malformed or missing ledger.jsonl */ recentLedger = []; }
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
    const candidateUg = {
      scope: sc.scope,
      objective: String(goalsData.objective || ''),
      updatedAt: String(goalsData.updated_at || ''),
      counts,
      goals,
      recentLedger,
    };
    if (!ultragoal || (ultragoal.counts.inProgress === 0 && candidateUg.counts.inProgress > 0)) {
      ultragoal = candidateUg;
    }
  }

  // 2. Team boards summary (including 20-minute completed window across all scopes)
  const teams = [];
  for (const sc of scopeEntries) {
    const teamRoot = path.join(sc.root, '.omagy', 'state', 'team');
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
            scope: sc.scope,
            objective: String(board.objective || ''),
            updatedAt: String(board.updated_at || ''),
            tasks: tasks.map((t) => ({
              id: String(t.id || ''),
              title: String(t.title || ''),
              role: String(t.role || 'executor'),
              model: String(t.model || 'inherit'),
              status: String(t.status || 'pending'),
              dependsOn: Array.isArray(t.depends_on) ? t.depends_on : [],
              requiresCodeChange: Boolean(t.requires_code_change),
              hasEvidence: fs.existsSync(path.join(sc.root, '.omagy', 'evidence', `task-${t.id}.json`)),
            })),
          });
        }
      }
    } catch { /* fail open: team state directory unavailable */ }
  }

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
    const diScope = diRecord.scope || '.';
    const diScopeEntry = scopeEntries.find((s) => s.scope === diScope) || scopeEntries[0];
    const diPrefix = diScope !== '.' ? `${diScope}/` : '';
    const slug = String(st.slug || '');
    const explicitSpecPath = String(
      st.spec_path
      || diRecord.raw?.state?.handoff_artifacts?.deep_interview?.spec_path
      || diRecord.raw?.handoff_artifacts?.deep_interview?.spec_path
      || ''
    ).trim().replace(/^\/+/, '');
    let specFile = null;
    const specCandidates = [];
    if (explicitSpecPath) specCandidates.push(diScope !== '.' && !explicitSpecPath.startsWith(`${diScope}/`) ? `${diPrefix}${explicitSpecPath}` : explicitSpecPath);
    if (slug) specCandidates.push(`${diPrefix}.omagy/specs/deep-interview-${slug}.md`);
    for (const cand of specCandidates) {
      if (resolveSafeArtifactFile(diScopeEntry?.root && diScope === '.' ? diScopeEntry.root : primaryRoot, cand)) {
        specFile = cand;
        break;
      }
    }
    interview = {
      scope: diScope,
      slug,
      specFile,
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
        ambiguity: typeof r.ambiguity === 'number'
          ? r.ambiguity
          : (typeof r.ambiguity_after === 'number' ? r.ambiguity_after : null),
      })),
    };
  }

  // 4. Ralplan / Hyperplan Consensus, Code Review Gate Board & Drawer Artifact Inventory
  const reviews = { ralplan: null, hyperplan: [], codeReviews: [] };
  const artifacts = { plans: [], specs: [], handoffs: [], ideas: [], asks: [] };
  const rpRecord = allModeRecords.find((m) => m.mode === 'ralplan')
    || allModeRecords.find((m) => m.mode === 'autopilot' && (m.raw?.state?.ralplan || m.raw?.state?.handoff_artifacts?.ralplan || m.raw?.handoff_artifacts?.ralplan));
  if (rpRecord) {
    const ho = rpRecord.raw?.state?.handoff_artifacts?.ralplan || rpRecord.raw?.handoff_artifacts?.ralplan || rpRecord.raw?.state?.ralplan || rpRecord.raw?.state || {};
    reviews.ralplan = {
      scope: rpRecord.scope || '.',
      active: rpRecord.active,
      phase: rpRecord.phase,
      iteration: rpRecord.iteration ?? 1,
      architectVerdict: String(ho.ralplan_architect_review?.verdict || ho.architect_verdict || ho.ralplan_execution_handoff?.architect_status || 'pending'),
      criticVerdict: String(ho.ralplan_critic_review?.verdict || ho.critic_verdict || ho.ralplan_execution_handoff?.critic_verdict || 'pending'),
      consensusComplete: Boolean(ho.ralplan_consensus_gate?.complete ?? ho.consensus_complete ?? ho.ralplan_execution_handoff?.authorized ?? false),
      executionAuthorized: Boolean(ho.ralplan_execution_handoff?.authorized ?? ho.execution_authorized ?? false),
      planningArtifacts: Array.isArray(ho.planning_artifacts) ? ho.planning_artifacts.map(String) : [],
    };
  }
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const plansDir = path.join(sc.root, '.omagy', 'plans');
    try {
      if (fs.existsSync(plansDir) && !fs.lstatSync(plansDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(plansDir).sort()) {
          if (!name.endsWith('.md')) continue;
          const fullPlanPath = path.join(plansDir, name);
          let pst;
          try { pst = fs.lstatSync(fullPlanPath); } catch { /* fail open: skip transient plan file */ continue; }
          if (pst.isSymbolicLink() || !pst.isFile()) continue;
          const text = readTextSafe(fullPlanPath);
          const planUpdatedAt = new Date(pst.mtimeMs).toISOString();
          artifacts.plans.push({
            scope: sc.scope,
            file: `${relPrefix}.omagy/plans/${name}`,
            title: extractMarkdownTitle(text, name),
            updatedAt: planUpdatedAt,
          });
          if (name.startsWith('hyperplan-distillation-')) {
            const survives = (text.match(/\bSURVIVES\b/g) || []).length;
            const weakened = (text.match(/\bWEAKENED\b/g) || []).length;
            const killed = (text.match(/\bKILLED\b/g) || []).length;
            reviews.hyperplan.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/plans/${name}`,
              updatedAt: planUpdatedAt,
              survives,
              weakened,
              killed,
            });
          } else if (name.startsWith('ralplan-review-') && !reviews.ralplan) {
            const archMatch = /architect[^\n:]*:\s*`?(APPROVE|CLEAR|WATCH|BLOCK|ITERATE|REJECT)`?/i.exec(text);
            const critMatch = /critic[^\n:]*:\s*`?(APPROVE|ITERATE|REJECT)`?/i.exec(text);
            reviews.ralplan = {
              scope: sc.scope,
              active: false,
              phase: 'complete',
              iteration: 1,
              architectVerdict: archMatch ? archMatch[1].toUpperCase() : 'recorded',
              criticVerdict: critMatch ? critMatch[1].toUpperCase() : 'recorded',
              consensusComplete: Boolean(critMatch && critMatch[1].toUpperCase() === 'APPROVE'),
              executionAuthorized: false,
              planningArtifacts: [`${relPrefix}.omagy/plans/${name}`],
            };
          }
        }
      }
    } catch { /* fail open: plans directory unavailable */ }

    const specsInventoryDir = path.join(sc.root, '.omagy', 'specs');
    try {
      if (fs.existsSync(specsInventoryDir) && !fs.lstatSync(specsInventoryDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(specsInventoryDir).sort()) {
          if (!name.endsWith('.md')) continue;
          const fullSpecPath = path.join(specsInventoryDir, name);
          let sst;
          try { sst = fs.lstatSync(fullSpecPath); } catch { /* fail open: skip transient spec file */ continue; }
          if (sst.isSymbolicLink() || !sst.isFile()) continue;
          const text = readTextSafe(fullSpecPath, 32 * 1024);
          artifacts.specs.push({
            scope: sc.scope,
            file: `${relPrefix}.omagy/specs/${name}`,
            title: extractMarkdownTitle(text, name),
            updatedAt: new Date(sst.mtimeMs).toISOString(),
          });
        }
      }
    } catch { /* fail open: specs directory unavailable */ }

    const artifactsDir = path.join(sc.root, '.omagy', 'artifacts');
    try {
      if (fs.existsSync(artifactsDir) && !fs.lstatSync(artifactsDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(artifactsDir).sort()) {
          if (!name.endsWith('.md')) continue;
          const fullArtPath = path.join(artifactsDir, name);
          let ast;
          try { ast = fs.lstatSync(fullArtPath); } catch { /* fail open: skip transient artifact file */ continue; }
          if (ast.isSymbolicLink() || !ast.isFile()) continue;
          const text = readTextSafe(fullArtPath);
          const artUpdatedAt = new Date(ast.mtimeMs).toISOString();
          if (name.startsWith('code-review-')) {
            const archMatch = /Architectural Status:\s*(CLEAR|WATCH|BLOCK)/i.exec(text);
            const recMatch = /RECOMMENDATION:\s*(APPROVE|REQUEST CHANGES|COMMENT)/i.exec(text);
            const filesMatch = /Files Reviewed:\s*([0-9]+)/i.exec(text);
            const issuesMatch = /Total Issues:\s*([0-9]+)/i.exec(text);
            reviews.codeReviews.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/artifacts/${name}`,
              updatedAt: artUpdatedAt,
              architectStatus: archMatch ? archMatch[1].toUpperCase() : 'UNKNOWN',
              recommendation: recMatch ? recMatch[1].toUpperCase() : 'UNKNOWN',
              filesReviewed: filesMatch ? Number(filesMatch[1]) : 0,
              totalIssues: issuesMatch ? Number(issuesMatch[1]) : 0,
            });
          } else if (name.startsWith('handoff-') || name === 'handoff.md') {
            artifacts.handoffs.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/artifacts/${name}`,
              title: extractMarkdownTitle(text, name),
              updatedAt: artUpdatedAt,
            });
          } else if (name.startsWith('ask-')) {
            artifacts.asks.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/artifacts/${name}`,
              title: extractMarkdownTitle(text, name),
              updatedAt: artUpdatedAt,
            });
          }
        }
      }
    } catch { /* fail open: artifacts directory unavailable */ }

    const ideasDir = path.join(sc.root, '.omagy', 'artifacts', 'ideas');
    try {
      if (fs.existsSync(ideasDir) && !fs.lstatSync(ideasDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(ideasDir).sort()) {
          if (!name.endsWith('.md')) continue;
          const fullIdeaPath = path.join(ideasDir, name);
          let ist;
          try { ist = fs.lstatSync(fullIdeaPath); } catch { /* fail open: skip transient idea file */ continue; }
          if (ist.isSymbolicLink() || !ist.isFile()) continue;
          const text = readTextSafe(fullIdeaPath, 32 * 1024);
          artifacts.ideas.push({
            scope: sc.scope,
            file: `${relPrefix}.omagy/artifacts/ideas/${name}`,
            title: extractMarkdownTitle(text, name),
            updatedAt: new Date(ist.mtimeMs).toISOString(),
          });
        }
      }
    } catch { /* fail open: ideas directory unavailable */ }
  }

  // 4b. Deep Research reports (.omagy/artifacts/research/*.md across scopes, including eval-integrity Verdict)
  const research = [];
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const researchDir = path.join(sc.root, '.omagy', 'artifacts', 'research');
    try {
      if (fs.existsSync(researchDir) && !fs.lstatSync(researchDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(researchDir).sort()) {
          if (!name.endsWith('.md')) continue;
          const fullPath = path.join(researchDir, name);
          let rst;
          try { rst = fs.lstatSync(fullPath); } catch { /* fail open: skip transient research file */ continue; }
          if (rst.isSymbolicLink() || !rst.isFile()) continue;
          const text = readTextSafe(fullPath, 64 * 1024);
          if (!text) continue;
          const titleMatch = /^#\s+([^\r\n]+)/m.exec(text);
          const lensMatch = /Lens(?:\(es\))?:\**\s*`?([a-zA-Z0-9_, /|-]+)`?/i.exec(text);
          const compMatch = /Overall\s+Composite[^\n|]*\|[^\n|]*\|\s*`?([0-9]+(?:\.[0-9]+)?)`?/i.exec(text);
          const evalMatch = /\*{0,2}Verdict:\s*(PASS|FAIL|INCONCLUSIVE)\*{0,2}/i.exec(text);
          research.push({
            scope: sc.scope,
            file: `${relPrefix}.omagy/artifacts/research/${name}`,
            updatedAt: new Date(rst.mtimeMs).toISOString(),
            title: redactSecrets((titleMatch ? titleMatch[1] : name).trim()),
            lens: (lensMatch ? lensMatch[1] : 'multi-lens').trim(),
            compositeScore: compMatch ? Number(compMatch[1]) : null,
            evalIntegrityVerdict: evalMatch ? evalMatch[1].toUpperCase() : null,
            claims: {
              verified: (text.match(/\[VERIFIED\]/g) || []).length,
              derived: (text.match(/\[DERIVED\]/g) || []).length,
              assumed: (text.match(/\[ASSUMED\]/g) || []).length,
            },
          });
        }
      }
    } catch { /* fail open: research directory unavailable */ }
  }

  // 5. Benchmarks: Performance Goals & Autoresearch (across scopes, with eval-integrity Verdict)
  const benchmarks = { performanceGoals: [], autoresearch: [] };
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const perfRoot = path.join(sc.root, '.omagy', 'goals', 'performance');
    try {
      if (fs.existsSync(perfRoot) && !fs.lstatSync(perfRoot).isSymbolicLink()) {
        for (const slug of fs.readdirSync(perfRoot)) {
          const dir = path.join(perfRoot, slug);
          const stData = readJsonSafe(path.join(dir, 'state.json'));
          if (!stData || typeof stData !== 'object') continue;
          const cpFile = path.join(dir, 'checkpoints.jsonl');
          const checkpoints = fs.existsSync(cpFile) ? readJsonlRecords(cpFile).records.slice(-10) : [];
          const summaryText = readTextSafe(path.join(dir, 'summary.md'), 16 * 1024);
          const evalMatch = /\*{0,2}Verdict:\s*(PASS|FAIL|INCONCLUSIVE)\*{0,2}/i.exec(summaryText);
          benchmarks.performanceGoals.push({
            scope: sc.scope,
            slug: String(stData.slug || slug),
            objective: String(stData.objective || ''),
            evaluatorCommand: String(stData.evaluator_command || ''),
            evaluatorContract: String(stData.evaluator_contract || ''),
            evalIntegrityVerdict: stData.eval_integrity_verdict
              ? String(stData.eval_integrity_verdict).toUpperCase()
              : (evalMatch ? evalMatch[1].toUpperCase() : null),
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
    } catch { /* fail open: performance goals directory unavailable */ }

    const specsDir = path.join(sc.root, '.omagy', 'specs');
    try {
      if (fs.existsSync(specsDir) && !fs.lstatSync(specsDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(specsDir)) {
          if (!name.startsWith('autoresearch-')) continue;
          const dir = path.join(specsDir, name);
          let st;
          try { st = fs.lstatSync(dir); } catch { /* fail open: skip unreadable autoresearch directory */ continue; }
          if (!st.isDirectory() || st.isSymbolicLink()) continue;
          const slug = name.slice('autoresearch-'.length);
          const resultData = readJsonSafe(path.join(dir, 'result.json')) || {};
          const completionData = readJsonSafe(path.join(dir, 'completion.json')) || {};
          const reportPath = path.join(dir, 'report.md');
          let hasReport = false;
          let reportMtimeMs = st.mtimeMs;
          try {
            const rst = fs.lstatSync(reportPath);
            hasReport = rst.isFile() && !rst.isSymbolicLink();
            if (hasReport) reportMtimeMs = rst.mtimeMs;
          } catch { /* fail open: optional autoresearch report.md */ }
          const reportText = hasReport ? readTextSafe(reportPath) : '';
          const reportRelFile = hasReport ? `${relPrefix}.omagy/specs/${name}/report.md` : null;
          if (reportRelFile) {
            artifacts.specs.push({
              scope: sc.scope,
              file: reportRelFile,
              title: extractMarkdownTitle(reportText, `${name}/report.md`),
              updatedAt: new Date(reportMtimeMs).toISOString(),
            });
          }
          const evalMatch = /\*{0,2}Verdict:\s*(PASS|FAIL|INCONCLUSIVE)\*{0,2}/i.exec(reportText);
          const verifiedCount = (reportText.match(/\[VERIFIED\]/g) || []).length;
          const derivedCount = (reportText.match(/\[DERIVED\]/g) || []).length;
          const assumedCount = (reportText.match(/\[ASSUMED\]/g) || []).length;
          benchmarks.autoresearch.push({
            scope: sc.scope,
            slug,
            reportFile: reportRelFile,
            launchReady: Boolean(resultData.launchReady ?? false),
            passed: Boolean(completionData.passed || completionData.architect_review?.verdict === 'approved'),
            status: String(completionData.status || completionData.architect_review?.verdict || (resultData.launchReady ? 'running' : 'draft')),
            evalIntegrityVerdict: completionData.eval_integrity_verdict
              ? String(completionData.eval_integrity_verdict).toUpperCase()
              : (evalMatch ? evalMatch[1].toUpperCase() : null),
            claims: { verified: verifiedCount, derived: derivedCount, assumed: assumedCount },
          });
        }
      }
    } catch { /* fail open: autoresearch specs scan unavailable */ }
  }

  const sortByNewestFile = (arr) => arr.sort((a, b) => {
    const diff = (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0);
    return diff !== 0 ? diff : String(b.file || '').localeCompare(String(a.file || ''));
  });
  sortByNewestFile(reviews.hyperplan);
  sortByNewestFile(reviews.codeReviews);
  sortByNewestFile(research);
  sortByNewestFile(artifacts.plans);
  sortByNewestFile(artifacts.specs);
  sortByNewestFile(artifacts.handoffs);
  sortByNewestFile(artifacts.ideas);
  sortByNewestFile(artifacts.asks);

  // 6. Visual Ralph Diff & Verdict Inspector (across scopes)
  const visualRalph = [];
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const vrRoot = path.join(sc.root, '.omagy', 'artifacts', 'visual-ralph');
    try {
      if (fs.existsSync(vrRoot) && !fs.lstatSync(vrRoot).isSymbolicLink()) {
        for (const slug of fs.readdirSync(vrRoot)) {
          const dir = path.join(vrRoot, slug);
          let st;
          try { st = fs.lstatSync(dir); } catch { /* fail open: skip unreadable visual-ralph entry */ continue; }
          if (!st.isDirectory() || st.isSymbolicLink()) continue;
          const files = fs.readdirSync(dir);
          const images = files
            .filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f))
            .map((f) => ({ name: f, relPath: `${relPrefix}.omagy/artifacts/visual-ralph/${slug}/${f}` }));
          const verdictFile = files.find((f) => f === 'verdict.json' || f.endsWith('-verdict.json'));
          const verdictData = verdictFile ? readJsonSafe(path.join(dir, verdictFile)) : null;
          if (images.length || verdictData) {
            visualRalph.push({
              scope: sc.scope,
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
    } catch { /* fail open: visual-ralph directory unavailable */ }
  }

  // 7. Loft Prototype Viewer (across scopes, including arena variants and local assets)
  const loft = [];
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const loftRoot = path.join(sc.root, '.omagy', 'artifacts', 'loft');
    try {
      if (fs.existsSync(loftRoot) && !fs.lstatSync(loftRoot).isSymbolicLink()) {
        for (const slug of fs.readdirSync(loftRoot).sort()) {
          const dir = path.join(loftRoot, slug);
          let dirSt;
          try { dirSt = fs.lstatSync(dir); } catch { /* fail open: skip unreadable loft slug */ continue; }
          if (!dirSt.isDirectory() || dirSt.isSymbolicLink()) continue;

          const variants = [];
          for (const vName of ['variant-a', 'variant-b', 'variant-c']) {
            const vIdx = path.join(dir, vName, 'index.html');
            try {
              const vDirSt = fs.lstatSync(path.join(dir, vName));
              const vIdxSt = fs.lstatSync(vIdx);
              if (vDirSt.isDirectory() && !vDirSt.isSymbolicLink() && vIdxSt.isFile() && !vIdxSt.isSymbolicLink()) {
                variants.push(`${vName}/index.html`);
              }
            } catch { /* fail open: optional arena variant absent */ }
          }

          const indexFile = path.join(dir, 'index.html');
          let indexSt = null;
          try {
            const st = fs.lstatSync(indexFile);
            if (!st.isSymbolicLink() && st.isFile()) indexSt = st;
          } catch { /* fail open: optional root index.html absent when arena variants exist */ }
          if (!indexSt && !variants.length) continue;

          const localAssets = [];
          const collectLocalAssets = (subDir, subRelPrefix) => {
            let entries = [];
            try { entries = fs.readdirSync(subDir, { withFileTypes: true }); } catch { /* fail open: skip unreadable loft asset subdir */ return; }
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
              const full = path.join(subDir, entry.name);
              let est;
              try { est = fs.lstatSync(full); } catch { /* fail open: skip transient loft file */ continue; }
              if (est.isSymbolicLink()) continue;
              if (est.isFile() && /\.(?:js|mjs|css)$/i.test(entry.name)) {
                localAssets.push(`./${subRelPrefix}${entry.name}`);
              } else if (est.isDirectory() && !subRelPrefix) {
                collectLocalAssets(full, `${entry.name}/`);
              }
            }
          };
          collectLocalAssets(dir, '');

          let arenaVerdictFile = null;
          const verdictMdPath = path.join(dir, 'arena-verdict.md');
          try {
            const vst = fs.lstatSync(verdictMdPath);
            if (vst.isFile() && !vst.isSymbolicLink()) {
              arenaVerdictFile = `${relPrefix}.omagy/artifacts/loft/${slug}/arena-verdict.md`;
            }
          } catch { /* fail open: optional arena-verdict.md absent */ }

          const primaryHtmlFile = indexSt ? indexFile : path.join(dir, variants[0]);
          const primaryHtmlRel = indexSt ? 'index.html' : variants[0];
          const primaryMtimeMs = indexSt ? indexSt.mtimeMs : dirSt.mtimeMs;
          const htmlText = readTextSafe(primaryHtmlFile, 32 * 1024);
          const hasLogicModule = localAssets.some((a) => /\/logic\.m?js$/i.test(a));
          loft.push({
            scope: sc.scope,
            slug,
            relPath: `${relPrefix}.omagy/artifacts/loft/${slug}/${primaryHtmlRel}`,
            kind: hasLogicModule ? 'logic-fork' : 'ui-fork',
            updatedAt: new Date(primaryMtimeMs).toISOString(),
            title: (/<title>([^<]+)<\/title>/i.exec(htmlText)?.[1] || slug).trim(),
            variants,
            localAssets,
            arenaVerdictFile,
          });
        }
      }
    } catch { /* fail open: loft directory unavailable */ }
  }

  // 8. Wiki, Working Agreements & Read-Only Lint Explorer
  const wiki = {
    agreements: [],
    pages: [],
    entries: [],
    lint: { missingFrontmatter: [], unknownCategories: [], danglingLinks: [], orphanPages: [], expiredPages: [] },
  };
  const wikiDir = path.join(primaryRoot, 'omagy_wiki');
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
  } catch { /* fail open: agreements.md unavailable */ }
  try {
    if (fs.existsSync(idxPath) && !fs.lstatSync(idxPath).isSymbolicLink()) {
      const lines = fs.readFileSync(idxPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));
      wiki.pages = lines.slice(0, 40).map((l) => redactSecrets(l));
      for (const l of lines) {
        const m = /\[\[([a-zA-Z0-9_-]+)\]\]/.exec(l);
        if (m) indexedSlugs.add(m[1]);
      }
    }
  } catch { /* fail open: index.md unavailable */ }
  try {
    if (fs.existsSync(wikiDir) && !fs.lstatSync(wikiDir).isSymbolicLink()) {
      const mdFiles = fs.readdirSync(wikiDir).filter((f) => f.endsWith('.md') && !['index.md', 'agreements.md', 'log.md'].includes(f));
      const allSlugs = new Set(mdFiles.map((f) => f.slice(0, -3)));
      const inboundLinks = new Set();
      for (const f of mdFiles.slice(0, 50)) {
        const slug = f.slice(0, -3);
        const raw = readTextSafe(path.join(wikiDir, f), 32 * 1024);
        const { meta, body } = parseFrontmatter(raw);
        if (!meta || !meta.title || !meta.category) {
          wiki.lint.missingFrontmatter.push(slug);
        } else if (!WIKI_CATEGORIES.has(String(meta.category).toLowerCase())) {
          wiki.lint.unknownCategories.push(`${slug} (${meta.category})`);
        }
        const expiresStr = meta?.expires ? String(meta.expires) : '';
        const expired = Boolean(expiresStr && Date.parse(expiresStr) <= nowMs);
        if (expired) wiki.lint.expiredPages.push(slug);
        const bodyWithoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
        const links = [...bodyWithoutCode.matchAll(/\[\[([a-zA-Z0-9_-]+)(?:\|[^\]\n]+)?\]\]/g)].map((m) => m[1]);
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
          body: redactSecrets(body.trim().slice(0, 16384)),
        });
      }
      for (const slug of allSlugs) {
        if (!indexedSlugs.has(slug) && !inboundLinks.has(slug)) {
          wiki.lint.orphanPages.push(slug);
        }
      }
    }
  } catch { /* fail open: omagy_wiki directory scan failed */ }

  // 9. Quality gates & Doctor / Hook Diagnostics
  const qg = validateQualityGates(primaryRoot);
  const runtimeDir = process.env.OMAGY_RUNTIME_DIR || path.join(os.tmpdir(), 'oh-my-agy');
  const latestRouting = readLatestRouting(runtimeDir);

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
    skillEval: getCachedSkillEval(PLUGIN_ROOT),
  };

  // 9.5 Code Health & Technical Debt (5s + git/transcript-mtime cached symbol reuse, openCallers, shortcut: debt, floorGuard, and verificationFreshness)
  const codeHealth = getCachedCodeHealth(primaryRoot, nowMs, latestRouting?.transcriptPath || '');

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

  const snapshotPayload = {
    at: new Date(nowMs).toISOString(),
    workspace: primaryRoot,
    trackedScopes,
    statusLine,
    allowedViews: ALLOWED_VIEWS,
    modes,
    ultragoal,
    teams,
    interview,
    reviews,
    artifacts,
    research,
    benchmarks,
    visualRalph,
    loft,
    codeHealth,
    wiki,
    qualityGates: qg.gates,
    doctor,
    catalog,
  };
  return {
    ...snapshotPayload,
    digest: computeSnapshotDigest(snapshotPayload),
  };
}


function verifyHudToken(expected, provided) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseWorkspacesQuery(reqUrl, fallbackWorkspaceRoot = '') {
  let workspaces = [];
  const rawWs = reqUrl.searchParams.get('workspaces');
  if (rawWs) {
    try {
      const parsed = JSON.parse(rawWs);
      if (Array.isArray(parsed)) workspaces = parsed;
    } catch { /* fail open: accept comma-separated workspace fallback */
      workspaces = rawWs.split(',').filter(Boolean);
    }
  }
  if (!workspaces.length && fallbackWorkspaceRoot) {
    workspaces = [fallbackWorkspaceRoot];
  }
  return workspaces;
}

export function createHudServer(token, options = {}) {
  const envToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
  const expectedToken = token === undefined
    ? (envToken || crypto.randomBytes(24).toString('hex'))
    : String(token || '');
  const statusRequiresToken = options.statusRequiresToken ?? (token === undefined ? Boolean(envToken) : Boolean(expectedToken));
  const debounceMs = Math.max(10, Number(options.debounceMs ?? 150));
  const sseHeartbeatMs = Math.max(25, Number(options.sseHeartbeatMs ?? 25000));
  const forceFlatWatch = Boolean(options.forceFlatWatch);
  const activeSseCleanups = new Set();

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const rawSidecarHdr = req.headers['x-sidecar-token'];
    const rawOmagyHdr = req.headers['x-omagy-token'];
    const provided = (typeof rawSidecarHdr === 'string' && rawSidecarHdr)
      || (typeof rawOmagyHdr === 'string' && rawOmagyHdr)
      || reqUrl.searchParams.get('token')
      || '';
    const tokenValid = verifyHudToken(expectedToken, provided);
    const denyUnauthorized = () => {
      res.writeHead(401, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    };
    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      getLiveHudHtml().then((htmlBody) => {
        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        }
        res.end(htmlBody);
      });
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
      if (statusRequiresToken && !tokenValid) {
        denyUnauthorized();
        return;
      }
      const workspaces = parseWorkspacesQuery(reqUrl, options.workspaceRoot || '');
      const snap = buildHudSnapshot(workspaces);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/events') {
      if (statusRequiresToken && !tokenValid) {
        denyUnauthorized();
        return;
      }
      const workspaces = parseWorkspacesQuery(reqUrl, options.workspaceRoot || '');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      let closed = false;
      let lastSentDigest = '';
      let debounceTimer = null;
      const watcherMap = new Map();

      const sendSnapshotFrame = (force = false) => {
        if (closed) return;
        try {
          const snap = buildHudSnapshot(workspaces);
          if (!force && snap.digest === lastSentDigest) return;
          lastSentDigest = snap.digest;
          res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
        } catch { /* fail open: transient snapshot read race during file write */ }
      };

      const addFlatWatch = (dirPath, onTrigger) => {
        const key = `flat:${dirPath}`;
        if (closed || watcherMap.has(key)) return;
        try {
          const st = fs.lstatSync(dirPath);
          if (st.isSymbolicLink() || !st.isDirectory()) return;
          const w = fs.watch(dirPath, { persistent: false }, onTrigger);
          w.on('error', () => { /* fail open: ignore transient flat watcher error */ });
          watcherMap.set(key, w);
        } catch { /* fail open: directory removed or unwatchable */ }
      };

      const addSubtreeWatch = (dirPath, maxFlatDepth, onTrigger) => {
        try {
          const st = fs.lstatSync(dirPath);
          if (st.isSymbolicLink() || !st.isDirectory()) return false;
        } catch { /* fail open: target directory does not exist yet */
          return false;
        }
        if (!forceFlatWatch) {
          const recKey = `rec:${dirPath}`;
          if (watcherMap.has(recKey)) return true;
          try {
            const w = fs.watch(dirPath, { recursive: true, persistent: false }, onTrigger);
            w.on('error', () => { /* fail open: ignore transient recursive watcher error */ });
            watcherMap.set(recKey, w);
            return true;
          } catch { /* fail open: recursive fs.watch unsupported on platform; fall back to flat directory watches */ }
        }
        const walkFlat = (curDir, depth) => {
          addFlatWatch(curDir, onTrigger);
          if (depth >= maxFlatDepth) return;
          let entries = [];
          try { entries = fs.readdirSync(curDir, { withFileTypes: true }); } catch { /* fail open: skip unreadable subdir */ return; }
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const childPath = path.join(curDir, entry.name);
            try {
              if (fs.lstatSync(childPath).isSymbolicLink()) continue;
            } catch { /* fail open: transient child dir */ continue; }
            walkFlat(childPath, depth + 1);
          }
        };
        walkFlat(dirPath, 0);
        return true;
      };

      const schedulePush = () => {
        if (closed) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          if (closed) return;
          syncWatchers();
          sendSnapshotFrame(false);
        }, debounceMs);
        if (typeof debounceTimer.unref === 'function') debounceTimer.unref();
      };

      function syncWatchers() {
        if (closed) return;
        const { roots, primaryRoot } = resolveWorkspaceRoots(workspaces, options.workspaceRoot || '');
        const scopeRoots = new Set([path.resolve(primaryRoot)]);
        for (const r of roots) {
          scopeRoots.add(path.resolve(r));
          for (const sc of discoverOmagyScopes(r, 3, 150)) {
            scopeRoots.add(path.resolve(sc.root));
          }
        }
        for (const sr of scopeRoots) {
          const hasOmagy = addSubtreeWatch(path.join(sr, '.omagy'), 3, schedulePush);
          if (!hasOmagy) addFlatWatch(sr, schedulePush);
        }
        const hasWiki = addSubtreeWatch(path.join(primaryRoot, 'omagy_wiki'), 2, schedulePush);
        if (!hasWiki) addFlatWatch(primaryRoot, schedulePush);
      }

      syncWatchers();
      sendSnapshotFrame(true);

      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          res.write(`: keepalive ${Date.now()}\n\n`);
        } catch { /* fail open: socket closing during keepalive */ }
      }, sseHeartbeatMs);
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

      const cleanupClient = () => {
        if (closed) return;
        closed = true;
        activeSseCleanups.delete(cleanupClient);
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        clearInterval(heartbeatTimer);
        for (const w of watcherMap.values()) {
          try { w.close(); } catch { /* fail open: watcher already closed */ }
        }
        watcherMap.clear();
        try {
          if (!res.writableEnded) res.end();
        } catch { /* fail open: response already ended */ }
      };

      activeSseCleanups.add(cleanupClient);
      req.on('close', cleanupClient);
      req.on('error', cleanupClient);
      res.on('close', cleanupClient);
      res.on('error', cleanupClient);
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/dispatch') {
      if (!expectedToken || !tokenValid) {
        denyUnauthorized();
        return;
      }
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!ct.includes('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }));
        return;
      }
      const chunks = [];
      let totalBytes = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_DISPATCH_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        let payload = {};
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch { /* fail open: reject malformed JSON request body */
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
          return;
        }
        const result = dispatchHudAction(payload, options);
        res.writeHead(result.status || (result.ok ? 200 : 400), { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      });
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/artifact') {
      if (!expectedToken || !tokenValid) {
        denyUnauthorized();
        return;
      }
      const wsParam = reqUrl.searchParams.get('workspace') || options.workspaceRoot || process.env.OMAGY_WORKSPACE || process.cwd();
      const relParam = reqUrl.searchParams.get('rel') || '';
      const resolved = resolveSafeArtifactFile(uriToFsPath(wsParam) || wsParam, relParam);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Artifact not found or forbidden' }));
        return;
      }
      try {
        let buf = fs.readFileSync(resolved.filePath);
        if (resolved.redact) {
          buf = Buffer.from(redactSecrets(buf.toString('utf8')), 'utf8');
        }
        const csp = resolved.mime.startsWith('text/html')
          ? "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; img-src data:"
          : "sandbox; default-src 'none'; style-src 'unsafe-inline'";
        res.writeHead(200, {
          'Content-Type': resolved.mime,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': csp,
        });
        res.end(buf);
      } catch { /* fail open: return 500 JSON when artifact file read fails */
        res.writeHead(500, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Failed to read artifact' }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.on('close', () => {
    for (const cleanup of [...activeSseCleanups]) {
      cleanup();
    }
  });
  server.getActiveSseClientCount = () => activeSseCleanups.size;
  return server;
}

function snapshotTreeDigest(rootDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* fail open: skip unreadable dir during digest */ return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.push(`${path.relative(rootDir, full).replace(/\\/g, '/')}:${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(rootDir);
  return out.join('\n');
}

async function runSelftest() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-selftest-'));
  const rtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-rt-'));
  const origRuntimeDir = process.env.OMAGY_RUNTIME_DIR;
  process.env.OMAGY_RUNTIME_DIR = rtDir;
  try {
    fs.mkdirSync(path.join(ws, '.omagy', 'state'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'ultragoal'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'plans'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'goals', 'performance', 'startup'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'specs', 'autoresearch-cache'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'visual-ralph', 'hero'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'loft', 'nav-fork'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'research'), { recursive: true });
    fs.mkdirSync(path.join(ws, '.omagy', 'artifacts', 'ideas'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'omagy_wiki'), { recursive: true });

    fs.writeFileSync(path.join(ws, '.omagy', 'state', 'autopilot-state.json'), `\uFEFF${JSON.stringify({
      mode: 'autopilot', active: true, current_phase: 'ultragoal', iteration: 2, owner_conversation_id: 'conv-owner-1234', updated_at: new Date().toISOString(),
    })}`);
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
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'ideas', 'demo-idea.md'), '# Demo Idea\n- Divergent candidate 1\n');
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
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    const origSrcIndex = [
      'export function parseRows(rows) { return rows; }',
      '// shortcut: 500 rows max with token ghp_1234567890abcdefghij123456, upgrade to streaming parser',
    ].join('\n');
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), origSrcIndex);

    execFileSync('git', ['init', '-q'], { cwd: ws, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'hud-selftest@example.com'], { cwd: ws, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'HUD Selftest'], { cwd: ws, stdio: 'ignore' });
    execFileSync('git', ['add', 'src/index.js'], { cwd: ws, stdio: 'ignore' });
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'init'], { cwd: ws, stdio: 'ignore' });

    const wsFileUrl = pathToFileURL(ws).href;
    const baseNowMs = Date.now();
    const hudTxPath = path.join(rtDir, 'transcript.jsonl');
    fs.writeFileSync(hudTxPath, [
      JSON.stringify({ step_index: 0, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'run_command', args: { CommandLine: '"sh hooks/run.sh selftest"' } }] }),
      JSON.stringify({ step_index: 1, type: 'GENERIC', status: 'DONE', content: 'Command exited with code 0.' }),
    ].join('\n') + '\n', 'utf8');
    fs.writeFileSync(path.join(rtDir, 'conv-owner-1234.routing.json'), JSON.stringify({
      at: new Date(baseNowMs).toISOString(),
      skills: ['autopilot'],
      transcriptPath: hudTxPath,
    }));
    const snap = buildHudSnapshot([wsFileUrl], baseNowMs);

    // Verify 5,000ms TTL memoization & .git/index + transcript mtime:size invalidation on codeHealth
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), `${origSrcIndex}\ntry { parseRows([]); } ${'ca' + 'tch'} {}\n`);
    const cachedSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 2000);
    const expiredSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 6000);
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), origSrcIndex);
    const bumpedGitMtime = new Date(Date.now() + 3000);
    fs.utimesSync(path.join(ws, '.git', 'index'), bumpedGitMtime, bumpedGitMtime);
    const gitInvalidatedSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 7000);
    fs.appendFileSync(hudTxPath, `${JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'write_file', args: { Path: '"src/index.js"' } }] })}\n`, 'utf8');
    const txInvalidatedSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 7500);
    const floorCacheOk = snap.codeHealth?.floorGuard?.ok === true
      && snap.codeHealth?.floorGuard?.exitCode === 0
      && snap.codeHealth?.floorGuard?.total === 0
      && snap.doctor?.latestRouting?.transcriptPath === hudTxPath
      && snap.codeHealth?.verificationFreshness === 'pass'
      && cachedSnap.codeHealth === snap.codeHealth
      && expiredSnap.codeHealth?.floorGuard?.ok === false
      && expiredSnap.codeHealth?.floorGuard?.emptyCatches === 1
      && expiredSnap.codeHealth?.floorGuard?.total === 1
      && gitInvalidatedSnap.codeHealth?.floorGuard?.ok === true
      && gitInvalidatedSnap.codeHealth?.floorGuard?.total === 0
      && gitInvalidatedSnap.codeHealth?.verificationFreshness === 'pass'
      && txInvalidatedSnap.codeHealth !== gitInvalidatedSnap.codeHealth
      && txInvalidatedSnap.codeHealth?.verificationFreshness === 'stale'
      && txInvalidatedSnap.codeHealth?.lastEditedTarget === 'src/index.js';

    const validArtifact = resolveSafeArtifactFile(ws, '.omagy/artifacts/loft/nav-fork/index.html');
    const validIdeaArtifact = resolveSafeArtifactFile(ws, '.omagy/artifacts/ideas/demo-idea.md');
    const blockedTraversal = resolveSafeArtifactFile(ws, '.omagy/artifacts/loft/../../state/autopilot-state.json');
    const blockedIdeaTraversal = resolveSafeArtifactFile(ws, '.omagy/artifacts/ideas/../../state/autopilot-state.json');
    const blockedRootTraversal = resolveSafeArtifactFile(ws, '../../state/autopilot-state.json');
    const deepInterviewSkill = snap.catalog?.skills?.find((s) => s.name === 'deep-interview');
    const deepResearchSkill = snap.catalog?.skills?.find((s) => s.name === 'deep-research');
    const analyzeSkill = snap.catalog?.skills?.find((s) => s.name === 'analyze');
    const askSkill = snap.catalog?.skills?.find((s) => s.name === 'ask');
    const codeReviewSkill = snap.catalog?.skills?.find((s) => s.name === 'code-review');
    const prSkill = snap.catalog?.skills?.find((s) => s.name === 'pr');
    const doctorSkill = snap.catalog?.skills?.find((s) => s.name === 'doctor');
    const skillSkill = snap.catalog?.skills?.find((s) => s.name === 'skill');
    const autopilotWf = snap.catalog?.workflows?.find((w) => w.id === 'autopilot');
    const architectAgent = snap.catalog?.subagents?.find((a) => a.name === 'architect');

    // H3-H7: Test dispatchHudAction across all 4 modes, fallback, and security rejections
    const calls = [];
    const mockRunner = (_bin, args) => {
      calls.push(args);
      return 'dispatched-ok';
    };
    const dActive = dispatchHudAction(
      { mode: 'active-chat', prompt: '/autopilot ship feature', conversationId: 'conv-explicit-9999' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-empty-'));
    const prevRuntimeDir = process.env.OMAGY_RUNTIME_DIR;
    process.env.OMAGY_RUNTIME_DIR = path.join(emptyWs, 'no-runtime');
    const dFallback = dispatchHudAction(
      { mode: 'active-chat', prompt: '/deep-research --technical "vector index"' },
      { workspaceRoot: emptyWs, runner: mockRunner }
    );
    if (prevRuntimeDir === undefined) delete process.env.OMAGY_RUNTIME_DIR;
    else process.env.OMAGY_RUNTIME_DIR = prevRuntimeDir;
    fs.rmSync(emptyWs, { recursive: true, force: true });

    const dSubActive = dispatchHudAction(
      { mode: 'subagent-active', agent: 'architect', prompt: 'Review boundaries', conversationId: 'conv-explicit-9999' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dSubStandalone = dispatchHudAction(
      { mode: 'subagent-standalone', agent: 'architect', prompt: 'Review boundaries' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dBadAgent = dispatchHudAction(
      { mode: 'subagent-standalone', agent: 'evil;rm', prompt: 'test' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dBadMode = dispatchHudAction(
      { mode: 'eval-shell', prompt: 'test' },
      { workspaceRoot: ws, runner: mockRunner }
    );

    // H8: HTTP server POST /api/dispatch, GET /api/artifact CSP/nosniff/token, and GET /api/status zero-mutation test
    const srv = createHudServer('test-secret-token', { workspaceRoot: ws, runner: mockRunner });
    const emptyTokenSrv = createHudServer('', { workspaceRoot: ws, runner: mockRunner });
    const prevUiToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
    delete process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
    const defaultTokenSrv = createHudServer(undefined, { workspaceRoot: ws, runner: mockRunner });
    if (prevUiToken === undefined) delete process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
    else process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN = prevUiToken;

    const invokeHttp = (method, url, headers, bodyObj, targetSrv = srv) => new Promise((resolve) => {
      const reqListeners = {};
      const req = {
        method,
        url,
        headers,
        on(ev, fn) { reqListeners[ev] = fn; return this; },
        destroy() {},
      };
      let status = 200;
      let resHeaders = {};
      const res = {
        writeHead(code, hdrs) { status = code; resHeaders = hdrs || {}; },
        end(payload) {
          const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');
          let json = {};
          try { json = JSON.parse(text || '{}'); } catch { /* fail open: response body may be plain text or binary artifact */ }
          resolve({ status, headers: resHeaders, text, json });
        },
      };
      targetSrv.emit('request', req, res);
      if (reqListeners.data && bodyObj !== undefined) {
        reqListeners.data(Buffer.from(typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj), 'utf8'));
      }
      if (reqListeners.end) reqListeners.end();
    });

    const unauthRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'new-chat', prompt: '/hud' });
    const emptyTokDispatchRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'new-chat', prompt: '/hud' }, emptyTokenSrv);
    const defaultTokStatusRes = await invokeHttp('GET', `/api/status?workspaces=${encodeURIComponent(JSON.stringify([wsFileUrl]))}`, {}, undefined, defaultTokenSrv);
    const defaultTokArtifactRes = await invokeHttp('GET', `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/ideas/demo-idea.md')}`, {}, undefined, defaultTokenSrv);
    const defaultTokDispatchRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'new-chat', prompt: '/hud' }, defaultTokenSrv);
    const badCtRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'text/plain', 'x-sidecar-token': 'test-secret-token' }, { mode: 'new-chat', prompt: '/hud' });
    const authRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json', 'x-sidecar-token': 'test-secret-token' }, { mode: 'new-chat', prompt: '/hud' });
    const authJson = authRes.json;

    const unauthArtifactRes = await invokeHttp(
      'GET',
      `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/ideas/demo-idea.md')}`,
      {},
    );
    const loftHttpRes = await invokeHttp(
      'GET',
      `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/loft/nav-fork/index.html')}`,
      { 'x-sidecar-token': 'test-secret-token' },
    );
    const ideaHttpRes = await invokeHttp(
      'GET',
      `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/ideas/demo-idea.md')}`,
      { 'x-sidecar-token': 'test-secret-token' },
    );
    const beforeStatusDigest = snapshotTreeDigest(ws);
    const statusHttpRes = await invokeHttp(
      'GET',
      `/api/status?workspaces=${encodeURIComponent(JSON.stringify([wsFileUrl]))}`,
      { 'x-sidecar-token': 'test-secret-token' },
    );
    const afterStatusDigest = snapshotTreeDigest(ws);

    // H9: Inner-folder .omagy tracking when parent project ("Travels") has no root .omagy and child ("Travels/Summer trip/.omagy") does
    const travelsWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-travels-'));
    let innerSnapOk = false;
    try {
      const summerTrip = path.join(travelsWs, 'Summer trip');
      fs.mkdirSync(path.join(summerTrip, '.omagy', 'state'), { recursive: true });
      fs.mkdirSync(path.join(summerTrip, '.omagy', 'ultragoal'), { recursive: true });
      fs.mkdirSync(path.join(summerTrip, '.omagy', 'artifacts', 'research'), { recursive: true });
      fs.mkdirSync(path.join(summerTrip, '.omagy', 'artifacts', 'loft', 'trip-ui'), { recursive: true });
      fs.writeFileSync(path.join(summerTrip, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
        mode: 'autopilot', active: true, current_phase: 'ultragoal', iteration: 1, updated_at: new Date().toISOString(),
      }));
      fs.writeFileSync(path.join(summerTrip, '.omagy', 'ultragoal', 'goals.json'), JSON.stringify({
        objective: 'Plan Summer trip itinerary',
        goals: [{ id: 'G1', title: 'Book flights', rigor: 'light', status: 'in_progress', depends_on: [], product_failures: 0 }],
      }));
      fs.writeFileSync(path.join(summerTrip, '.omagy', 'artifacts', 'research', 'flights.md'), [
        '# Flight Route Analysis',
        '- **Lens**: `implementation`',
        'Claim 1 [VERIFIED]',
        '**Verdict: PASS**',
      ].join('\n'));
      fs.writeFileSync(path.join(summerTrip, '.omagy', 'artifacts', 'loft', 'trip-ui', 'index.html'), '<!DOCTYPE html><title>Trip UI</title><body>Trip</body>');
      const tSnap = buildHudSnapshot([pathToFileURL(travelsWs).href]);
      const innerArtifact = resolveSafeArtifactFile(travelsWs, 'Summer trip/.omagy/artifacts/loft/trip-ui/index.html');
      const innerBlocked = resolveSafeArtifactFile(travelsWs, 'Summer trip/.omagy/artifacts/loft/../../../state/autopilot-state.json');
      innerSnapOk = Array.isArray(tSnap.trackedScopes) && tSnap.trackedScopes.some((sc) => sc.scope === 'Summer trip')
        && tSnap.modes.length === 1 && tSnap.modes[0].scope === 'Summer trip' && tSnap.modes[0].session === 'Summer trip/shared'
        && tSnap.ultragoal?.scope === 'Summer trip' && tSnap.ultragoal?.counts?.inProgress === 1
        && tSnap.research?.length === 1 && tSnap.research[0].scope === 'Summer trip' && tSnap.research[0].evalIntegrityVerdict === 'PASS'
        && tSnap.loft?.length === 1 && tSnap.loft[0].relPath === 'Summer trip/.omagy/artifacts/loft/trip-ui/index.html'
        && Boolean(innerArtifact && innerArtifact.mime.includes('text/html'))
        && innerBlocked === null;
    } finally {
      fs.rmSync(travelsWs, { recursive: true, force: true });
    }

    // H13: SSE GET /api/events auth (401 vs 200 standalone, X-Sidecar-Token / X-Omagy-Token / ?token=),
    // debounced .omagy + omagy_wiki live push, duplicate-digest suppression, flat/pre-.omagy watch fallback,
    // socket/server cleanup (getActiveSseClientCount() === 0), and zero-mutation guarantee.
    const sseWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-sse-'));
    const preOmagyWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-pre-'));
    let h13Ok = false;
    try {
      fs.mkdirSync(path.join(sseWs, '.omagy', 'state'), { recursive: true });
      fs.mkdirSync(path.join(sseWs, 'omagy_wiki'), { recursive: true });
      const initialApJson = JSON.stringify({
        mode: 'autopilot', active: true, current_phase: 'ralplan', iteration: 1, updated_at: new Date(baseNowMs - 60000).toISOString(),
      });
      fs.writeFileSync(path.join(sseWs, '.omagy', 'state', 'autopilot-state.json'), initialApJson);
      fs.writeFileSync(path.join(sseWs, 'omagy_wiki', 'index.md'), '- [[intro]] — Intro\n');
      fs.writeFileSync(path.join(sseWs, 'omagy_wiki', 'intro.md'), '---\ntitle: Intro\ncategory: architecture\ntags: [core]\n---\nInitial body.\n');

      const sseSrv = createHudServer('sse-tok', { workspaceRoot: sseWs, debounceMs: 35, sseHeartbeatMs: 70 });
      const savedUiTok = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
      delete process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
      const sseDefaultSrv = createHudServer(undefined, { workspaceRoot: sseWs, debounceMs: 35, sseHeartbeatMs: 200 });
      if (savedUiTok === undefined) delete process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN;
      else process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN = savedUiTok;
      const sseFlatPreSrv = createHudServer('sse-tok', { workspaceRoot: preOmagyWs, debounceMs: 35, sseHeartbeatMs: 200, forceFlatWatch: true });

      const openSseClient = (urlPath, headers = {}, targetSrv = sseSrv) => {
        const frames = [];
        let keepalives = 0;
        let buffer = '';
        let status = 0;
        let resHeaders = {};
        const frameWaiters = [];
        let keepaliveWaiter = null;
        const notifyWaiters = () => {
          for (let i = frameWaiters.length - 1; i >= 0; i -= 1) {
            if (frames.length >= frameWaiters[i].count) {
              const w = frameWaiters.splice(i, 1)[0];
              clearTimeout(w.timer);
              w.resolve(frames[w.count - 1]);
            }
          }
          if (keepaliveWaiter && keepalives > 0) {
            const kw = keepaliveWaiter;
            keepaliveWaiter = null;
            clearTimeout(kw.timer);
            kw.resolve(keepalives);
          }
        };
        const parseChunk = (payload) => {
          if (payload === undefined || payload === null) return;
          buffer += Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
          let sepIdx = buffer.indexOf('\n\n');
          while (sepIdx !== -1) {
            const rawBlock = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            if (rawBlock.startsWith(': keepalive')) {
              keepalives += 1;
            } else if (rawBlock.includes('event: snapshot')) {
              const dataLine = rawBlock.split('\n').find((l) => l.startsWith('data: '));
              if (dataLine) {
                try {
                  frames.push(JSON.parse(dataLine.slice(6)));
                } catch { /* fail open: ignore malformed frame in test parser */ }
              }
            }
            sepIdx = buffer.indexOf('\n\n');
          }
          notifyWaiters();
        };
        const normHeaders = {};
        for (const [hk, hv] of Object.entries(headers || {})) {
          normHeaders[hk.toLowerCase()] = hv;
        }
        const req = Object.assign(new EventEmitter(), {
          method: 'GET',
          url: urlPath,
          headers: normHeaders,
          destroy() {
            this.emit('close');
          },
        });
        const res = Object.assign(new EventEmitter(), {
          writableEnded: false,
          writeHead(code, hdrs) {
            status = code;
            resHeaders = {};
            for (const [hk, hv] of Object.entries(hdrs || {})) {
              resHeaders[hk.toLowerCase()] = hv;
            }
          },
          flushHeaders() {},
          write(chunk) {
            parseChunk(chunk);
            return true;
          },
          end(chunk) {
            if (chunk !== undefined) parseChunk(chunk);
            this.writableEnded = true;
            this.emit('close');
          },
        });
        targetSrv.emit('request', req, res);
        return {
          status,
          headers: resHeaders,
          frames,
          waitForFrame(count) {
            if (frames.length >= count) return Promise.resolve(frames[count - 1]);
            return new Promise((resFrame, rejFrame) => {
              const timer = setTimeout(() => rejFrame(new Error(`Timed out waiting for SSE frame ${count}`)), 1800);
              frameWaiters.push({ count, timer, resolve: resFrame });
            });
          },
          waitForKeepalive() {
            if (keepalives > 0) return Promise.resolve(keepalives);
            return new Promise((resKa, rejKa) => {
              const timer = setTimeout(() => rejKa(new Error('Timed out waiting for SSE keepalive')), 1800);
              keepaliveWaiter = { timer, resolve: resKa };
            });
          },
          closeAndWait() {
            req.destroy();
            return new Promise((resClose, rejClose) => {
              const deadline = Date.now() + 1500;
              const check = () => {
                if (targetSrv.getActiveSseClientCount() === 0) {
                  resClose(true);
                  return;
                }
                if (Date.now() > deadline) {
                  rejClose(new Error('SSE client count did not reach 0'));
                  return;
                }
                setTimeout(check, 10);
              };
              check();
            });
          },
        };
      };

      try {
        const unauthSse = await invokeHttp('GET', '/api/events', {}, undefined, sseSrv);
        const badTokSse = await invokeHttp('GET', '/api/events?token=wrong', {}, undefined, sseSrv);

        const defClient = openSseClient('/api/events', {}, sseDefaultSrv);
        const defFrame1 = await defClient.waitForFrame(1);
        await defClient.closeAndWait();

        const beforeSseRoDigest = snapshotTreeDigest(sseWs);
        const omagyHdrClient = openSseClient('/api/events', { 'X-Omagy-Token': 'sse-tok' }, sseSrv);
        const omagyFrame1 = await omagyHdrClient.waitForFrame(1);
        const kaCount = await omagyHdrClient.waitForKeepalive();
        await omagyHdrClient.closeAndWait();
        const afterSseRoDigest = snapshotTreeDigest(sseWs);

        const sseWsUrl = pathToFileURL(sseWs).href;
        const liveClient = openSseClient(
          `/api/events?token=sse-tok&workspaces=${encodeURIComponent(JSON.stringify([sseWsUrl]))}`,
          { 'X-Sidecar-Token': 'sse-tok' },
          sseSrv,
        );
        const frame1 = await liveClient.waitForFrame(1);
        const activeWhileConnected = sseSrv.getActiveSseClientCount();
        // Rewrite identical JSON first (unchanged digest must not emit a duplicate snapshot frame), then mutate phase.
        fs.writeFileSync(path.join(sseWs, '.omagy', 'state', 'autopilot-state.json'), initialApJson);
        fs.writeFileSync(path.join(sseWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
          mode: 'autopilot', active: true, current_phase: 'code-review', iteration: 2, updated_at: new Date(baseNowMs - 30000).toISOString(),
        }));
        const frame2 = await liveClient.waitForFrame(2);
        fs.writeFileSync(path.join(sseWs, 'omagy_wiki', 'live-note.md'), '---\ntitle: Live Note\ncategory: pattern\ntags: [sse]\n---\nLive wiki push.\n');
        const frame3 = await liveClient.waitForFrame(3);
        await liveClient.closeAndWait();

        // Flat-watcher fallback + pre-.omagy creation watch
        const flatClient = openSseClient('/api/events', { 'X-Sidecar-Token': 'sse-tok' }, sseFlatPreSrv);
        const preFrame1 = await flatClient.waitForFrame(1);
        fs.mkdirSync(path.join(preOmagyWs, '.omagy', 'state'), { recursive: true });
        fs.writeFileSync(path.join(preOmagyWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
          mode: 'autopilot', active: true, current_phase: 'planning', iteration: 1, updated_at: new Date(baseNowMs - 20000).toISOString(),
        }));
        const preFrame2 = await flatClient.waitForFrame(2);
        fs.writeFileSync(path.join(preOmagyWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
          mode: 'autopilot', active: true, current_phase: 'executing', iteration: 2, updated_at: new Date(baseNowMs - 10000).toISOString(),
        }));
        const preFrame3 = await flatClient.waitForFrame(3);
        await flatClient.closeAndWait();

        // Server close event cleanup check
        const srvCloseClient = openSseClient('/api/events', { 'X-Sidecar-Token': 'sse-tok' }, sseSrv);
        await srvCloseClient.waitForFrame(1);
        const activeBeforeSrvClose = sseSrv.getActiveSseClientCount();
        sseSrv.emit('close');
        const activeAfterSrvClose = sseSrv.getActiveSseClientCount();

        h13Ok = unauthSse.status === 401
          && badTokSse.status === 401
          && defClient.status === 200
          && String(defClient.headers['content-type'] || '').includes('text/event-stream')
          && Boolean(defFrame1 && typeof defFrame1.digest === 'string' && defFrame1.digest.length === 64)
          && omagyHdrClient.status === 200
          && Boolean(omagyFrame1 && omagyFrame1.statusLine.includes('autopilot:ralplan'))
          && kaCount >= 1
          && beforeSseRoDigest === afterSseRoDigest
          && activeWhileConnected === 1
          && frame1.digest !== frame2.digest
          && frame2.statusLine.includes('autopilot:code-review')
          && frame2.digest !== frame3.digest
          && frame3.wiki.entries.some((e) => e.slug === 'live-note')
          && activeBeforeSrvClose === 1
          && activeAfterSrvClose === 0
          && sseSrv.getActiveSseClientCount() === 0
          && sseDefaultSrv.getActiveSseClientCount() === 0
          && preFrame1.modes.length === 0
          && preFrame2.modes.length === 1 && preFrame2.modes[0].phase === 'planning'
          && preFrame3.modes.length === 1 && preFrame3.modes[0].phase === 'executing'
          && sseFlatPreSrv.getActiveSseClientCount() === 0;
      } finally {
        sseSrv.emit('close');
        sseDefaultSrv.emit('close');
        sseFlatPreSrv.emit('close');
      }
    } finally {
      fs.rmSync(sseWs, { recursive: true, force: true });
      fs.rmSync(preOmagyWs, { recursive: true, force: true });
    }

    // H14 & H15: Expanded redacted /api/artifact containment, hostile probes, and enriched snapshot Drawer inventory
    const artWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-art-'));
    let h14Ok = false;
    let h15Ok = false;
    try {
      const secretTokSample = 'ghp_1234567890abcdefghij123456';
      fs.mkdirSync(path.join(artWs, '.omagy', 'state'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'plans'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'specs', 'autoresearch-bench'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'artifacts', 'visual-ralph', 'card'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'variant-a'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'artifacts', 'research'), { recursive: true });
      fs.mkdirSync(path.join(artWs, '.omagy', 'artifacts', 'ideas'), { recursive: true });
      fs.mkdirSync(path.join(artWs, 'packages', 'web', '.omagy', 'plans'), { recursive: true });
      fs.mkdirSync(path.join(artWs, 'omagy_wiki'), { recursive: true });
      fs.mkdirSync(path.join(artWs, 'outside'), { recursive: true });
      fs.writeFileSync(path.join(artWs, 'outside', 'secret.md'), 'outside file\n');

      fs.writeFileSync(path.join(artWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
        mode: 'autopilot',
        active: true,
        current_phase: 'ultragoal',
        updated_at: new Date(baseNowMs - 10000).toISOString(),
        state: {
          deep_interview: {
            slug: 'demo',
            profile: 'standard',
            type: 'brownfield',
            current_ambiguity: 0.05,
            threshold: 0.2,
            rounds: [{ round: 1, target: 'scope', label: '[from-user]', question: 'Q?', answer: 'A', ambiguity_after: 0.05 }],
          },
        },
      }));
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'visual-ralph', 'card', 'notes.md'), `# Visual Notes\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'plans', 'prd-demo.md'), `# Demo PRD\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'specs', 'deep-interview-demo.md'), `# Demo Spec\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'specs', 'autoresearch-bench', 'result.json'), JSON.stringify({ launchReady: true }));
      fs.writeFileSync(path.join(artWs, '.omagy', 'specs', 'autoresearch-bench', 'report.md'), `# Autoresearch Report\nClaim [VERIFIED] ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'handoff-latest.md'), `# Session Handoff\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'ask-claude-demo.md'), `# Advisor Reply\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'ideas', 'idea-one.md'), `# Idea One\nToken ${secretTokSample}\n`);
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'index.html'), '<!DOCTYPE html><title>Demo Loft</title><script type="module" src="./logic.mjs"></script>');
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'variant-a', 'index.html'), '<!DOCTYPE html><title>Variant A</title><body>A</body>');
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'logic.mjs'), 'export const answer = 42;\n');
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'arena-verdict.md'), `# Arena Verdict\nWinner: variant-a (${secretTokSample})\n`);
      fs.writeFileSync(path.join(artWs, 'packages', 'web', '.omagy', 'plans', 'inner.md'), `# Inner Web Plan\nToken ${secretTokSample}\n`);
      // Disallowed .html files inside otherwise-allowed directories + symlink escape
      fs.writeFileSync(path.join(artWs, '.omagy', 'plans', 'evil.html'), '<script>alert(1)</script>');
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'research', 'evil.html'), '<script>alert(1)</script>');
      fs.writeFileSync(path.join(artWs, '.omagy', 'artifacts', 'loft', 'demo', 'evil.html'), '<script>alert(1)</script>');
      fs.symlinkSync(path.join(artWs, 'outside', 'secret.md'), path.join(artWs, '.omagy', 'plans', 'symlink-outside.md'));
      // 4,500-char Wiki body fixture for H15
      fs.writeFileSync(path.join(artWs, 'omagy_wiki', 'index.md'), '- [[deep-page]] — Deep Page — reference — hud\n');
      fs.writeFileSync(
        path.join(artWs, 'omagy_wiki', 'deep-page.md'),
        `---\ntitle: Deep Page\ncategory: reference\ntags: [hud]\n---\nSee [[target-slug]].\n\n${'W'.repeat(4500)}\n`,
      );

      const artSrv = createHudServer('art-secret', { workspaceRoot: artWs, runner: mockRunner });
      const artWsUrl = pathToFileURL(artWs).href;
      const getArt = (rel, hdrs = { 'x-omagy-token': 'art-secret' }) => invokeHttp(
        'GET',
        `/api/artifact?workspace=${encodeURIComponent(artWsUrl)}&rel=${encodeURIComponent(rel)}`,
        hdrs,
        undefined,
        artSrv,
      );

      // Compute digest excluding symlink entry by checking file-only snapshotTreeDigest
      const beforeArtDigest = snapshotTreeDigest(artWs);
      const rShort = await getArt('visual-ralph/card/notes.md');
      const rPlan = await getArt('.omagy/plans/prd-demo.md');
      const rSpec = await getArt('.omagy/specs/deep-interview-demo.md');
      const rAutoRep = await getArt('.omagy/specs/autoresearch-bench/report.md');
      const rHandoff = await getArt('.omagy/artifacts/handoff-latest.md');
      const rAsk = await getArt('.omagy/artifacts/ask-claude-demo.md');
      const rVariantA = await getArt('.omagy/artifacts/loft/demo/variant-a/index.html');
      const rLogicMjs = await getArt('.omagy/artifacts/loft/demo/logic.mjs');
      const rVerdictMd = await getArt('.omagy/artifacts/loft/demo/arena-verdict.md');
      const rInnerPlan = await getArt('packages/web/.omagy/plans/inner.md');

      const hostileProbes = [
        '/etc/passwd',
        '/.omagy/plans/prd-demo.md',
        '../../etc/passwd',
        'visual-ralph/../../plugin.json',
        '..\\..\\plugin.json',
        '.omagy\\plans\\prd-demo.md',
        'C:\\Windows\\win.ini',
        '.omagy/plans/symlink-outside.md',
        '.omagy/plans/evil.html',
        '.omagy/artifacts/research/evil.html',
        '.omagy/artifacts/loft/demo/evil.html',
        '.omagy/state/autopilot-state.json',
      ];
      let allHostileBlocked = true;
      for (const badRel of hostileProbes) {
        const directRes = resolveSafeArtifactFile(artWs, badRel);
        const httpRes = await getArt(badRel);
        if (directRes !== null || httpRes.status !== 404) {
          allHostileBlocked = false;
          break;
        }
      }
      const encodedDotsRes = await invokeHttp(
        'GET',
        `/api/artifact?workspace=${encodeURIComponent(artWsUrl)}&rel=visual-ralph/%2e%2e/%2e%2e/outside/secret.md`,
        { 'x-sidecar-token': 'art-secret' },
        undefined,
        artSrv,
      );
      const afterArtDigest = snapshotTreeDigest(artWs);

      const mdResponses = [rShort, rPlan, rSpec, rAutoRep, rHandoff, rAsk, rVerdictMd, rInnerPlan];
      const allMdRedactedAndSafe = mdResponses.every((r) => (
        r.status === 200
        && r.headers['Content-Type'] === 'text/plain; charset=utf-8'
        && r.headers['X-Content-Type-Options'] === 'nosniff'
        && r.headers['Content-Security-Policy'] === "sandbox; default-src 'none'; style-src 'unsafe-inline'"
        && r.text.includes('[REDACTED_TOKEN]')
        && !r.text.includes(secretTokSample)
      ));

      h14Ok = allMdRedactedAndSafe
        && rVariantA.status === 200
        && rVariantA.headers['Content-Type'] === 'text/html; charset=utf-8'
        && rVariantA.headers['Content-Security-Policy'] === "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; img-src data:"
        && rLogicMjs.status === 200
        && rLogicMjs.headers['Content-Type'] === 'text/plain; charset=utf-8'
        && rLogicMjs.headers['X-Content-Type-Options'] === 'nosniff'
        && rLogicMjs.text.includes('export const answer = 42;')
        && allHostileBlocked
        && encodedDotsRes.status === 404
        && beforeArtDigest === afterArtDigest;

      const artSnap1 = buildHudSnapshot([artWsUrl], baseNowMs);
      const artSnap2 = buildHudSnapshot([artWsUrl], baseNowMs + 100);
      const artSkillEntry = artSnap1.catalog?.skills?.find((s) => s.name === 'skill');
      h15Ok = typeof artSnap1.digest === 'string'
        && /^[0-9a-f]{64}$/.test(artSnap1.digest)
        && computeSnapshotDigest(artSnap1) === artSnap1.digest
        && artSnap1.digest === artSnap2.digest
        && Boolean(artSkillEntry && artSkillEntry.flags.includes('init') && artSkillEntry.flags.includes('validate'))
        && artSnap1.wiki?.entries?.length === 1
        && artSnap1.wiki.entries[0].body.length > 4000
        && artSnap1.wiki.entries[0].body.length <= 16384
        && artSnap1.artifacts?.plans?.some((p) => p.file === '.omagy/plans/prd-demo.md')
        && artSnap1.artifacts?.plans?.some((p) => p.file === 'packages/web/.omagy/plans/inner.md')
        && artSnap1.artifacts?.specs?.some((s) => s.file === '.omagy/specs/deep-interview-demo.md')
        && artSnap1.artifacts?.specs?.some((s) => s.file === '.omagy/specs/autoresearch-bench/report.md')
        && artSnap1.artifacts?.handoffs?.some((h) => h.file === '.omagy/artifacts/handoff-latest.md' && Boolean(h.updatedAt))
        && artSnap1.artifacts?.ideas?.some((i) => i.file === '.omagy/artifacts/ideas/idea-one.md')
        && artSnap1.artifacts?.asks?.some((a) => a.file === '.omagy/artifacts/ask-claude-demo.md')
        && artSnap1.interview?.specFile === '.omagy/specs/deep-interview-demo.md'
        && artSnap1.interview?.rounds?.[0]?.ambiguity === 0.05
        && artSnap1.benchmarks?.autoresearch?.[0]?.reportFile === '.omagy/specs/autoresearch-bench/report.md'
        && artSnap1.loft?.length === 1
        && artSnap1.loft[0].variants.includes('variant-a/index.html')
        && artSnap1.loft[0].localAssets.includes('./logic.mjs')
        && artSnap1.loft[0].arenaVerdictFile === '.omagy/artifacts/loft/demo/arena-verdict.md';
    } finally {
      fs.rmSync(artWs, { recursive: true, force: true });
    }

    // H16: Slide-Over Drawer (#artifact-drawer), vm.Script inline syntax check, 3-mode Visual Ralph comparator, Loft srcdoc local-asset/module/theme inlining [W-1], & null-source guard
    const inlineScriptMatch = /<script>([\s\S]*?)<\/script>/i.exec(HUD_HTML);
    let inlineScriptSyntaxOk = false;
    if (inlineScriptMatch) {
      try {
        new vm.Script(inlineScriptMatch[1], { filename: 'hud-inline.js' });
        inlineScriptSyntaxOk = true;
      } catch { /* fail open: syntax error surfaced via inlineScriptSyntaxOk === false */ }
    }
    const sampleLoftHtml = [
      '<!DOCTYPE html><html><head><title>Arena</title>',
      '<link rel="stylesheet" href="https://cdn.example.invalid/evil.css">',
      '<link rel=stylesheet href=https://cdn.example.invalid/unquoted.css>',
      '<link rel="stylesheet" href="./styles.css">',
      '<script src="https://cdn.example.invalid/evil.js"></script>',
      '<script src=https://cdn.example.invalid/unquoted.js></script>',
      '<script src="  //cdn.example.invalid/proto.js "></script>',
      '</head><body><script type=module src=./app.mjs></script></body></html>',
    ].join('\n');
    const preparedLoft = prepareLoftSrcdoc(
      sampleLoftHtml,
      'variant-a/index.html',
      {
        './styles.css': '.card { color: var(--hud-primary); }',
        './variant-a/styles.css': '.box { border: 1px solid var(--hud-border); } /* </style><script>evil()</script> */',
        './variant-a/app.mjs': "import { computeScore } from '../logic.mjs';\nglobalThis.__loftAnswer = computeScore(21);\n",
        './logic.mjs': 'export function computeScore(x) { return x * 2; }\n',
      },
      '--hud-primary: #60a5fa; --hud-border: #334155;',
    );
    const inlinedModuleMatch = /<script type="module" data-inlined-asset="\.\/variant-a\/app\.mjs">\n([\s\S]*?)\n<\/script>/.exec(preparedLoft);
    let bundledLoftAnswer = null;
    if (inlinedModuleMatch) {
      try {
        delete globalThis.__loftAnswer;
        new Function(inlinedModuleMatch[1])();
        bundledLoftAnswer = globalThis.__loftAnswer;
        delete globalThis.__loftAnswer;
      } catch { /* fail open: bundled module eval check failed */ }
    }
    const h16Ok = inlineScriptSyntaxOk
      && HUD_HTML.includes('id="artifact-drawer"')
      && HUD_HTML.includes('id="artifact-drawer-backdrop"')
      && HUD_HTML.includes('role="dialog"')
      && HUD_HTML.includes('aria-modal="true"')
      && HUD_HTML.includes("event.key === 'Escape'")
      && HUD_HTML.includes('side-by-side')
      && HUD_HTML.includes('split-slider')
      && HUD_HTML.includes('onion-skin')
      && HUD_HTML.includes('type="range" min="0" max="100"')
      && HUD_HTML.includes('sandbox="allow-scripts" referrerpolicy="no-referrer"')
      && HUD_HTML.includes('frame.srcdoc = prepared')
      && HUD_HTML.includes('selectLoftEntry')
      && HUD_HTML.includes('showLoftArenaVerdict')
      && !/allow-same-origin/i.test(HUD_HTML)
      && !/<iframe\b[^>]*\bsrc\s*=/i.test(HUD_HTML)
      && !/<iframe\b[^>]*token=/i.test(HUD_HTML)
      && HUD_HTML.includes('if (!event.source || (event.source !== window.parent && event.source !== window)) return;')
      && !preparedLoft.includes('cdn.example.invalid')
      && preparedLoft.includes('data-inlined-asset="./variant-a/styles.css"')
      && preparedLoft.includes('<\\/style><script>evil()')
      && preparedLoft.includes("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:")
      && preparedLoft.includes('id="omagy-hud-theme-vars"')
      && preparedLoft.includes('--hud-primary: #60a5fa;')
      && !/\bimport\s+\{\s*computeScore\s*\}/.test(preparedLoft)
      && bundledLoftAnswer === 42;

    // H17: Digest-diffed live SSE reactivity, workspace-change reconnect, 15s poll fallback, stateful DOM & Wiki focus preservation, & surfaced telemetry
    const h17Ok = HUD_HTML.includes("new EventSource('/api/events?'")
      && HUD_HTML.includes('connectEventStream()')
      && HUD_HTML.includes('activeEventSource.close()')
      && !HUD_HTML.includes('setInterval(loadSnapshot, 4000)')
      && HUD_HTML.includes('setInterval(loadSnapshot, 15000)')
      && HUD_HTML.includes('data.digest === lastSnapshotDigest')
      && HUD_HTML.includes('function captureUiState()')
      && HUD_HTML.includes('function restoreUiState(state)')
      && HUD_HTML.includes('function renderWikiContentOnly(data)')
      && HUD_HTML.includes('id="wiki-explorer-results"')
      && HUD_HTML.indexOf('id="artifact-drawer"') > HUD_HTML.indexOf('id="view-wiki"')
      && HUD_HTML.includes('data-hud-key="ug-ledger"')
      && HUD_HTML.includes('Recent Ledger Events')
      && HUD_HTML.includes('data-hud-key="iv-rounds"')
      && HUD_HTML.includes('Open Spec')
      && HUD_HTML.includes('Open Distillation')
      && HUD_HTML.includes('data-hud-key="ov-artifacts"')
      && HUD_HTML.includes('Checkpoints (')
      && HUD_HTML.includes('/hud --handoff')
      && HUD_HTML.includes('Cancel Mode');

    // H18: .toString()-shared composer helpers, XSS-safe Markdown Wiki explorer, customization://oh-my-agy, light/dark CSS tokens, & >=12px floor
    const cmdAddFlags = buildSkillCommandWithFlags('/ralplan', ['--light', '--interactive']);
    const cmdSwapFlags = buildSkillCommandWithFlags('/ralplan --light Scope HUD', ['--deliberate'], ['--light', '--deliberate']);
    const cmdSubcmd = buildSkillCommandWithFlags('/skill list', ['validate'], ['list', 'init', 'validate']);
    const saSnippetPro = buildSubagentInvokeSnippet('executor', 'pro', 'Implement G4');
    const saSnippetInherit = buildSubagentInvokeSnippet('explore', 'inherit', 'Map exports');
    const hostileMd = [
      '# Architecture Note',
      '',
      'Cross-link to [[target-slug]] and [[overview-doc|Overview Doc]] with [Settings](customization://oh-my-agy) and [Bad](javascript:alert(1)).',
      '',
      '<img src=x onerror=alert(1)><script>evil()</script>',
      '',
      '```js',
      'const literal = "[[inside-fence]]";',
      '```',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| `[[inside-code]]` | **bold** |',
    ].join('\n');
    const renderedMd = renderSafeMarkdown(hostileMd);
    const h18Ok = cmdAddFlags === '/ralplan --light --interactive'
      && cmdSwapFlags === '/ralplan --deliberate Scope HUD'
      && cmdSubcmd === '/skill validate'
      && saSnippetPro.includes('invoke_subagent(')
      && saSnippetPro.includes('TypeName: "executor"')
      && saSnippetPro.includes('Model: "pro"')
      && saSnippetInherit.includes('Model: "inherit"')
      && HUD_HTML.includes(buildSkillCommandWithFlags.toString())
      && HUD_HTML.includes(buildSubagentInvokeSnippet.toString())
      && HUD_HTML.includes(renderSafeMarkdown.toString())
      && renderedMd.includes('<h1 class="md-h1">Architecture Note</h1>')
      && renderedMd.includes('data-wiki-slug="target-slug"')
      && renderedMd.includes('onclick="navigateToWikiSlug(this.dataset.wikiSlug)"')
      && !/onclick="[^"]*\$\{/.test(HUD_HTML)
      && renderedMd.includes('data-wiki-slug="overview-doc"')
      && !renderedMd.includes('data-wiki-slug="inside-fence"')
      && !renderedMd.includes('data-wiki-slug="inside-code"')
      && renderedMd.includes('href="customization://oh-my-agy"')
      && !renderedMd.includes('href="javascript:')
      && renderedMd.includes('&lt;img src=x onerror=alert(1)&gt;')
      && !/<img\b/i.test(renderedMd)
      && !/<script\b/i.test(renderedMd)
      && renderedMd.includes('<table class="hud-table md-table">')
      && HUD_HTML.includes('customization://oh-my-agy')
      && !HUD_HTML.includes('plugin://')
      && HUD_HTML.includes('@media (prefers-color-scheme: light)')
      && HUD_HTML.includes('var(--background,')
      && HUD_HTML.includes('var(--foreground,')
      && !/https?:\/\//i.test(HUD_HTML)
      && !/font-size\s*:\s*(?:[0-9]|1[01])(?:\.[0-9]+)?px\b/i.test(HUD_HTML);

    // H19: Guard against opaque Antigravity --accent collision on blue pills/badges/buttons across all 5 tabs
    const h19Ok = !/var\(--accent\b/.test(HUD_HTML)
      && !HUD_HTML.includes('--hud-accent')
      && HUD_HTML.includes('--hud-primary-tint')
      && HUD_HTML.includes('--hud-primary-ink')
      && HUD_HTML.includes('color-mix(in srgb,')
      && HUD_HTML.includes('id="refresh-btn" type="button" class="action-btn"')
      && HUD_HTML.includes('class="tab-bar"')
      && HUD_HTML.includes('-webkit-appearance: none;')
      && HUD_HTML.includes('.chip-btn code,');

    // H20: Workbench UX polish — clean header, folder/scope labels, single current mode, 5-item ledger, wide un-crushed Markdown + YAML frontmatter, 2-tab Reviews/Research, 10-item collapsible artifacts, collapsible boxed Working Agreements, & no Wiki search input
    const frontmatterMd = [
      '---',
      'title: Deep Interview Spec',
      'slug: hud-polish',
      'profile: standard',
      '---',
      '',
      '# Spec Heading',
      '',
      '1. First item',
      '- Top bullet',
      '  - Nested bullet',
      '2. Second item',
      '',
      '| Flag | Rule |',
      '| --- | --- |',
      '| `--a|--b` | A \\| B |',
    ].join('\n');
    const renderedFmMd = renderSafeMarkdown(frontmatterMd);
    const modePickLive = selectCurrentMode([
      { mode: 'ultragoal', active: true, stale: false, phase: 'executing', updatedMs: 200 },
      { mode: 'autopilot', active: true, stale: false, phase: 'ultragoal', updatedMs: 100 },
    ]);
    const modePickIdle = selectCurrentMode([
      { mode: 'ultragoal', active: false, stale: false, phase: 'complete', updatedMs: 100 },
      { mode: 'autopilot', active: false, stale: false, phase: 'complete', updatedMs: 300 },
    ]);
    const agCardHtml = formatAgreementCard({
      text: '- [v1] [by:human] Keep `hooks/` dependency-free — 2026-11-02',
      author: 'human',
      expired: false,
    }, 0);
    const h20Ok = !HUD_HTML.includes('1-5 &middot; / &middot; Esc')
      && !HUD_HTML.includes('id="wiki-search-input"')
      && !HUD_HTML.includes('Tracked .omagy scopes:')
      && HUD_HTML.includes('function formatWorkspaceName(')
      && HUD_HTML.includes('function formatScopeLabel(')
      && HUD_HTML.includes('function selectCurrentMode(')
      && HUD_HTML.includes('setOverviewReviewTab')
      && HUD_HTML.includes('data-hud-key="wiki-agreements"')
      && HUD_HTML.includes('agreement-box')
      && HUD_HTML.includes('ledger-item')
      && HUD_HTML.includes('table-layout: auto')
      && HUD_HTML.includes('width: min(100vw, 780px)')
      && formatWorkspaceName('/opt/projects/oh-my-agy/') === 'oh-my-agy'
      && formatScopeLabel('.') === 'workspace'
      && formatScopeLabel('packages/web-ui') === 'web-ui'
      && modePickLive.current?.mode === 'autopilot'
      && modePickIdle.current === null
      && modePickIdle.lastCompleted?.mode === 'autopilot'
      && agCardHtml.includes('v1')
      && agCardHtml.includes('<code class="md-inline-code">hooks/</code>')
      && agCardHtml.includes('2026-11-02')
      && !agCardHtml.includes('[by:human]')
      && renderedFmMd.includes('class="md-frontmatter"')
      && renderedFmMd.includes('hud-polish')
      && !renderedFmMd.includes('<hr class="md-hr" />')
      && renderedFmMd.includes('class="md-subitem"')
      && renderedFmMd.includes('<td><code class="md-inline-code">--a|--b</code></td><td>A | B</td>')
      && renderedFmMd.includes('<ol class="md-list" start="2">');

    // H21: Animated Workflow Step Pipeline & Interactive 3D Wiki Mind-Map Graph/Projection
    const wfParsedRalplan = parseWorkflowStageLabel('$ralplan (Planner -> Architect -> Critic)');
    const wfParsedPlain = parseWorkflowStageLabel('$deep-interview');
    const apStages = ['$deep-interview', '$ralplan', '$ultragoal', '$code-review'];
    const wfStateIdle = resolveWorkflowStageState(apStages, 'ultragoal', false);
    const wfStateMid = resolveWorkflowStageState(apStages, 'ultragoal', true);
    const wfStateEnd = resolveWorkflowStageState(apStages, 'code-review', true);
    const mmSampleEntries = [
      { slug: 'arch', title: 'Architecture', category: 'architecture', tags: ['core'], links: ['hud', 'hooks', 'arch', 'missing-page'] },
      { slug: 'hud', title: 'HUD Sidecar', category: 'architecture', tags: ['ui'], links: ['arch', 'tests'] },
      { slug: 'hooks', title: 'Hooks Runtime', category: 'reference', tags: ['cli'], links: ['tests'] },
      { slug: 'tests', title: 'Selftest Suite', category: 'pattern', tags: ['qa'], links: [] },
    ];
    const mmGraphAll = buildWikiMindMapGraph(mmSampleEntries, 'All');
    const mmGraphRepeat = buildWikiMindMapGraph(mmSampleEntries, 'All');
    const mmGraphArch = buildWikiMindMapGraph(mmSampleEntries, 'architecture');
    const archHudEdge = mmGraphAll.edges.find((e) => (e.source === 'arch' && e.target === 'hud') || (e.source === 'hud' && e.target === 'arch'));
    const projFront = projectMindMapPoint({ x: 0, y: 0, z: -0.8 }, 0, 0, 1, 400, 280);
    const projBack = projectMindMapPoint({ x: 0, y: 0, z: 0.8 }, 0, 0, 1, 400, 280);
    const h21Ok = wfParsedRalplan.title === '$ralplan'
      && wfParsedRalplan.sub === 'Planner \u00b7 Architect \u00b7 Critic'
      && wfParsedPlain.title === '$deep-interview'
      && wfParsedPlain.sub === ''
      && wfStateIdle.activeIndex === -1
      && JSON.stringify(wfStateIdle.states) === JSON.stringify(['idle', 'idle', 'idle', 'idle'])
      && JSON.stringify(wfStateIdle.arrowStates) === JSON.stringify(['idle', 'idle', 'idle'])
      && wfStateMid.activeIndex === 2
      && JSON.stringify(wfStateMid.states) === JSON.stringify(['done', 'done', 'current', 'upcoming'])
      && JSON.stringify(wfStateMid.arrowStates) === JSON.stringify(['done', 'done', 'active'])
      && wfStateEnd.activeIndex === 3
      && JSON.stringify(wfStateEnd.states) === JSON.stringify(['done', 'done', 'done', 'current'])
      && JSON.stringify(wfStateEnd.arrowStates) === JSON.stringify(['done', 'done', 'active'])
      && mmGraphAll.nodes.length === 4
      && mmGraphAll.edges.length === 4
      && Boolean(archHudEdge && archHudEdge.bidirectional === true)
      && JSON.stringify(mmGraphAll.nodes) === JSON.stringify(mmGraphRepeat.nodes)
      && mmGraphArch.nodes.filter((n) => n.inFilter).length === 2
      && mmGraphArch.nodes.filter((n) => !n.inFilter).length === 2
      && projFront.sx === 200
      && projFront.sy === 140
      && projFront.persp > projBack.persp
      && projFront.z < projBack.z
      && HUD_HTML.includes(parseWorkflowStageLabel.toString())
      && HUD_HTML.includes(resolveWorkflowStageState.toString())
      && HUD_HTML.includes(buildWikiMindMapGraph.toString())
      && HUD_HTML.includes(projectMindMapPoint.toString())
      && HUD_HTML.includes('class="wf-pipeline"')
      && /\.wf-pipeline\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s.test(HUD_HTML)
      && HUD_HTML.includes('data-wf-pipeline=')
      && HUD_HTML.includes('class="wf-arrow-svg"')
      && HUD_HTML.includes('id="wiki-mindmap-canvas"')
      && HUD_HTML.includes('class="wiki-mode-switch"')
      && HUD_HTML.includes('id="wiki-list-wrap"')
      && HUD_HTML.includes("if (wikiViewMode === 'list')")
      && HUD_HTML.includes('setWikiViewMode(this.dataset.wikiMode)');

    // H22: Hallmark tactile motion, sliding tab pills, asymmetric drawer/button physics, GPU scaleX bars, delayed skeleton, & search highlight
    const h22Ok = HUD_HTML.includes('--ease-out:')
      && HUD_HTML.includes('--ease-in:')
      && HUD_HTML.includes('--ease-in-out:')
      && HUD_HTML.includes('--dur-press:')
      && HUD_HTML.includes('--dur-micro:')
      && HUD_HTML.includes('--dur-short:')
      && HUD_HTML.includes('--dur-long:')
      && HUD_HTML.includes('--hud-scrim:')
      && HUD_HTML.includes('--hud-shadow-drawer:')
      && !/transition:\s*width\b/i.test(HUD_HTML)
      && HUD_HTML.includes('scaleX(var(--bar-scale, 0))')
      && HUD_HTML.includes('class="tab-pill-indicator"')
      && HUD_HTML.includes('function syncSlidingTabPill(')
      && HUD_HTML.includes('data-sliding-tabs="main"')
      && HUD_HTML.includes('data-sliding-tabs="ov-rev"')
      && HUD_HTML.includes('data-sliding-tabs="skill-cat"')
      && HUD_HTML.includes('data-sliding-tabs="sa-lane"')
      && HUD_HTML.includes('data-sliding-tabs="wiki-mode"')
      && HUD_HTML.includes("classList.add('pane-enter')")
      && HUD_HTML.includes(':active:not(:disabled)')
      && HUD_HTML.includes('function setButtonFeedback(')
      && HUD_HTML.includes('class="btn-check-path"')
      && HUD_HTML.includes('id="hud-main-shell"')
      && HUD_HTML.includes('function setMainShellInert(')
      && HUD_HTML.includes("classList.add('is-closing')")
      && HUD_HTML.includes('class="md-skeleton"')
      && renderedMd.includes('onclick="copyMdCodeBlock(this)"')
      && HUD_HTML.includes('window.copyMdCodeBlock =')
      && HUD_HTML.includes('id="wiki-doc-pane"')
      && HUD_HTML.includes('wiki-path-flash')
      && HUD_HTML.includes('details.animate(')
      && HUD_HTML.includes(highlightMatch.toString())
      && highlightMatch('<img onerror=1> Deep-Research', 'deep') === '&lt;img onerror=1&gt; <mark class="hud-mark">Deep</mark>-Research'
      && HUD_HTML.includes('class="hud-mark"')
      && HUD_HTML.includes('id="skills-match-count"')
      && HUD_HTML.includes('id="subagents-match-count"');

    const fg = snap.codeHealth?.floorGuard;
    const se = snap.doctor?.skillEval;
    const ok = JSON.stringify(snap.allowedViews) === JSON.stringify(['overview', 'workflows', 'skills', 'subagents', 'wiki'])
      && !HUD_HTML.includes('data-view="doctor"')
      && HUD_HTML.includes('Diagnostics &amp; Runtime Health')
      && HUD_HTML.includes('Code Health &amp; Technical Debt')
      && HUD_HTML.includes('Floor Guard')
      && HUD_HTML.includes('Skill Eval:')
      && HUD_HTML.includes('Benchmarks &amp; Autoresearch')
      && HUD_HTML.includes('Visual Ralph &amp; Loft Prototypes')
      && HUD_HTML.includes('class="cmd-actions"')
      && HUD_HTML.includes('table-layout: fixed')
      && HUD_HTML.includes('class="hud-table"')
      && !HUD_HTML.includes('copySubagentFromInput')
      && snap.statusLine.includes('autopilot:ultragoal')
      && snap.statusLine.includes('ultragoal:1/1')
      && snap.catalog?.skills?.length === 20
      && Boolean(deepInterviewSkill && deepInterviewSkill.flags.includes('--ideate'))
      && Boolean(deepResearchSkill && deepResearchSkill.flags.includes('--technical') && deepResearchSkill.flags.includes('--quick') && deepResearchSkill.flags.includes('--loop') && deepResearchSkill.quickStart.includes('/deep-research'))
      && Boolean(analyzeSkill && analyzeSkill.flags.includes('--audit'))
      && Boolean(askSkill && askSkill.flags.includes('--doubt'))
      && Boolean(codeReviewSkill && codeReviewSkill.flags.includes('--audit') && codeReviewSkill.flags.includes('--ship'))
      && Boolean(prSkill && prSkill.flags.includes('--watch') && prSkill.flags.includes('--ship'))
      && Boolean(doctorSkill && doctorSkill.flags.includes('--setup') && doctorSkill.flags.includes('--notifications') && doctorSkill.flags.includes('--session-compare'))
      && Boolean(skillSkill && skillSkill.flags.includes('eval'))
      && snap.modes.every((m) => typeof m.awaitingConfirmation === 'boolean')
      && HUD_HTML.includes('WAITING CONFIRMATION')
      && snap.codeHealth?.debtTotal === 1
      && snap.codeHealth?.debtItems?.[0]?.ceiling.includes('[REDACTED_TOKEN]')
      && snap.codeHealth?.debtItems?.[0]?.upgrade === 'upgrade to streaming parser'
      && Boolean(fg && typeof fg.deletedTests === 'number' && typeof fg.removedAssertions === 'number' && typeof fg.untrackedBlockers === 'number' && typeof fg.suppressions === 'number' && typeof fg.emptyCatches === 'number' && typeof fg.protectedBlocksModified === 'number' && typeof fg.total === 'number')
      && floorCacheOk
      && Boolean(se && se.ok === true && se.rank1Pct >= 95 && se.minRank1 === 95 && se.collisionErrors === 0 && se.negativeSurvivalPct === 100)
      && snap.catalog?.subagents?.length === 14
      && snap.catalog.subagents.every((a) => Boolean(a.defaultPrompt))
      && Boolean(architectAgent && architectAgent.cliModel === 'pro')
      && snap.catalog?.workflows?.length >= 6
      && Boolean(autopilotWf && autopilotWf.active === true && autopilotWf.currentPhase === 'ultragoal')
      && Boolean(dActive.ok && dActive.modeUsed === 'active-chat' && !dActive.fallback && dActive.args.includes('send-message') && dActive.args.includes('--'))
      && Boolean(dFallback.ok && dFallback.modeUsed === 'new-chat' && dFallback.fallback === true && dFallback.args.includes('new-conversation'))
      && Boolean(dSubActive.ok && dSubActive.modeUsed === 'subagent-active' && dSubActive.args.some((x) => x.includes('invoke_subagent')))
      && Boolean(dSubStandalone.ok && dSubStandalone.modeUsed === 'subagent-standalone' && dSubStandalone.args.includes('--profile=architect') && dSubStandalone.args.includes('--model=pro'))
      && Boolean(!dBadAgent.ok && dBadAgent.status === 400)
      && Boolean(!dBadMode.ok && dBadMode.status === 400)
      && unauthRes.status === 401
      && emptyTokDispatchRes.status === 401
      && defaultTokStatusRes.status === 200
      && defaultTokArtifactRes.status === 401
      && defaultTokDispatchRes.status === 401
      && unauthArtifactRes.status === 401
      && badCtRes.status === 415
      && authRes.status === 200
      && authJson.ok === true
      && loftHttpRes.status === 200
      && loftHttpRes.headers['Content-Security-Policy'] === "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; img-src data:"
      && ideaHttpRes.status === 200
      && ideaHttpRes.headers['Content-Type'] === 'text/plain; charset=utf-8'
      && ideaHttpRes.headers['X-Content-Type-Options'] === 'nosniff'
      && ideaHttpRes.headers['Content-Security-Policy'] === "sandbox; default-src 'none'; style-src 'unsafe-inline'"
      && HUD_HTML.includes('event.source !== window.parent')
      && statusHttpRes.status === 200
      && beforeStatusDigest === afterStatusDigest
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
      && Boolean(validIdeaArtifact && validIdeaArtifact.mime === 'text/plain; charset=utf-8')
      && blockedTraversal === null
      && blockedIdeaTraversal === null
      && blockedRootTraversal === null
      && innerSnapOk
      && h13Ok
      && h14Ok
      && h15Ok
      && h16Ok
      && h17Ok
      && h18Ok
      && h19Ok
      && h20Ok
      && h21Ok
      && h22Ok;

    process.stdout.write(`${JSON.stringify({
      selftest: ok ? 'PASS' : 'FAIL',
      views: snap.allowedViews.length,
      skills: snap.catalog?.skills?.length || 0,
      subagents: snap.catalog?.subagents?.length || 0,
      workflows: snap.catalog?.workflows?.length || 0,
      dispatchChecks: calls.length,
      statusLine: snap.statusLine,
    })}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (origRuntimeDir === undefined) delete process.env.OMAGY_RUNTIME_DIR;
    else process.env.OMAGY_RUNTIME_DIR = origRuntimeDir;
    fs.rmSync(rtDir, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

function sameModulePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  if (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase()) return true;
  try {
    return fs.realpathSync(ra) === fs.realpathSync(rb);
  } catch { /* fail open: non-existent argv[1] cannot match module path */
    return false;
  }
}

const isMainModule = Boolean(process.argv[1] && sameModulePath(process.argv[1], fileURLToPath(import.meta.url)));
if (isMainModule) {
  const modeArg = (process.argv[2] || '').toLowerCase();
  if (modeArg === 'selftest' || modeArg === '--selftest') {
    runSelftest();
  } else {
    const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 0);
    const envToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
    const server = createHudServer(envToken || crypto.randomBytes(24).toString('hex'), {
      statusRequiresToken: Boolean(envToken),
    });
    server.listen(port, BIND_HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      process.stdout.write(`[oh-my-agy/hud] listening on http://${BIND_HOST}:${actualPort}\n`);
    });
  }
}
