#!/usr/bin/env node
// oh-my-agy HUD Sidecar (UI Extension for Antigravity Auxiliary Pane).
// Read-only status polling (`GET /api/status`, zero-mutation invariant) + authenticated `agentapi`
// launcher (`POST /api/dispatch`) serving `sidecar://oh-my-agy/hud/` (`?view=overview|workflows|skills|subagents|wiki`).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeDiffCodeHealth,
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
    flags: ['--interactive', '--deliberate', '--hyperplan', '--advisory', '--light', '--interview', '--review'],
    quickStart: '/ralplan --deliberate "redesign the token refresh pipeline"',
    howToUse: 'Generates a PRD + test spec in .omagy/plans/ with sequential Architect then Critic consensus reviews, or scopes bounded features via --light, --interview, and --review.',
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
    howToUse: 'Coordinates up to 6 parallel executor (or specialist) subagents on a leader-owned DAG task board (.omagy/state/team/) with verified task-<id>.json evidence.',
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
    flags: ['--audit'],
    quickStart: '/analyze why the session middleware drops cookies on redirect',
    howToUse: 'Read-only cross-file repository analysis with 6-tier evidence ranking, competing hypothesis tracing, Intent-vs-Reality diffs, and --audit whole-repo quality/lean audits.',
  },
  ask: {
    category: 'Research & Analysis',
    flags: ['claude', 'gemini', 'codex', '--doubt'],
    quickStart: '/ask claude "review our event-sourcing schema for edge cases"',
    howToUse: 'Queries a locally installed external CLI advisor (Claude, Gemini, or Codex) via read-only stdin sandboxing (or adversarial --doubt review) and saves the response under .omagy/artifacts/.',
  },
  'code-review': {
    category: 'Review, QA & Cleanup',
    flags: ['--re-review', '--audit', '--ship'],
    quickStart: '/code-review the changes on my current branch',
    howToUse: 'Pre-assembles a git review package and dispatches independent code-reviewer and architect subagents for a deterministic APPROVE / REQUEST CHANGES / COMMENT verdict (plus --audit or --ship pre-PR gates).',
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
    flags: ['list', 'add', 'edit', 'remove', 'scan', 'test', 'eval'],
    quickStart: '/skill test deep-research',
    howToUse: 'Creates, validates, evaluates routing accuracy (eval), and pressure-tests Antigravity skills (RED -> GREEN -> REFACTOR behavioral subagent evaluation).',
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
  return stateRoot(rawRoot);
}

export function resolveSafeArtifactFile(workspaceRoot, relPath) {
  const cleanRel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('\0') || cleanRel.split('/').includes('..')) return null;
  if (!/^(?:[^/]+\/)*\.omagy\/artifacts\/(?:visual-ralph|loft|research|ideas)\//.test(cleanRel)) {
    return null;
  }
  const ext = path.extname(cleanRel).toLowerCase();
  if (!MIME_BY_EXT[ext]) return null;
  try {
    const rootReal = fs.realpathSync(resolveStateRoot(workspaceRoot));
    let cur = rootReal;
    for (const part of cleanRel.split('/')) {
      cur = path.join(cur, part);
      if (fs.lstatSync(cur).isSymbolicLink()) return null;
    }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const candidateReal = fs.realpathSync(cur);
    const omagyArtifactsSeg = `${path.sep}.omagy${path.sep}artifacts${path.sep}`;
    if (!candidateReal.startsWith(rootReal + path.sep) || !candidateReal.includes(omagyArtifactsSeg)) return null;
    return { filePath: candidateReal, mime: MIME_BY_EXT[ext] };
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

function getCachedCodeHealth(primaryRoot, nowMs = Date.now()) {
  const rootKey = path.resolve(primaryRoot);
  const gitSig = readGitMetadataSignature(rootKey);
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
  } catch { /* ignore */ }

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
          } catch { return null; }
        })
        .filter((r) => r && validIdRe.test(r.id))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (routingFiles.length) return routingFiles[0].id;
    }
  } catch { /* ignore */ }

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
        } catch { /* ignore */ }
      }
    }
    const sorted = records
      .filter((r) => validIdRe.test(r.owner))
      .sort((a, b) => b.updatedMs - a.updatedMs);
    if (sorted.length) return sorted[0].owner;
  } catch { /* ignore */ }

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
        } catch {
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
        } catch {
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
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: redactSecrets(String(err?.message || err || 'Failed to invoke agentapi')),
    };
  }
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
      } catch { return false; }
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
            } catch { return null; }
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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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
    interview = {
      scope: diRecord.scope || '.',
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
      scope: rpRecord.scope || '.',
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
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const plansDir = path.join(sc.root, '.omagy', 'plans');
    try {
      if (fs.existsSync(plansDir) && !fs.lstatSync(plansDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(plansDir)) {
          if (name.startsWith('hyperplan-distillation-') && name.endsWith('.md')) {
            const text = readTextSafe(path.join(plansDir, name));
            const survives = (text.match(/\bSURVIVES\b/g) || []).length;
            const weakened = (text.match(/\bWEAKENED\b/g) || []).length;
            const killed = (text.match(/\bKILLED\b/g) || []).length;
            reviews.hyperplan.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/plans/${name}`,
              survives,
              weakened,
              killed,
            });
          } else if (name.startsWith('ralplan-review-') && name.endsWith('.md') && !reviews.ralplan) {
            const text = readTextSafe(path.join(plansDir, name));
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
    } catch { /* ignore */ }

    const artifactsDir = path.join(sc.root, '.omagy', 'artifacts');
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
              scope: sc.scope,
              file: `${relPrefix}.omagy/artifacts/${name}`,
              architectStatus: archMatch ? archMatch[1].toUpperCase() : 'UNKNOWN',
              recommendation: recMatch ? recMatch[1].toUpperCase() : 'UNKNOWN',
              filesReviewed: filesMatch ? Number(filesMatch[1]) : 0,
              totalIssues: issuesMatch ? Number(issuesMatch[1]) : 0,
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 4b. Deep Research reports (.omagy/artifacts/research/*.md across scopes, including eval-integrity Verdict)
  const research = [];
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const researchDir = path.join(sc.root, '.omagy', 'artifacts', 'research');
    try {
      if (fs.existsSync(researchDir) && !fs.lstatSync(researchDir).isSymbolicLink()) {
        for (const name of fs.readdirSync(researchDir)) {
          if (!name.endsWith('.md')) continue;
          const fullPath = path.join(researchDir, name);
          const text = readTextSafe(fullPath, 64 * 1024);
          if (!text) continue;
          const titleMatch = /^#\s+([^\r\n]+)/m.exec(text);
          const lensMatch = /Lens(?:\(es\))?:\**\s*`?([a-zA-Z0-9_, /|-]+)`?/i.exec(text);
          const compMatch = /Overall\s+Composite[^\n|]*\|[^\n|]*\|\s*`?([0-9]+(?:\.[0-9]+)?)`?/i.exec(text);
          const evalMatch = /\*{0,2}Verdict:\s*(PASS|FAIL|INCONCLUSIVE)\*{0,2}/i.exec(text);
          research.push({
            scope: sc.scope,
            file: `${relPrefix}.omagy/artifacts/research/${name}`,
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
    } catch { /* ignore */ }
  }

  // 5. Benchmarks: Performance Goals & Autoresearch (across scopes, with eval-integrity Verdict)
  const benchmarks = { performanceGoals: [], autoresearch: [] };
  for (const sc of scopeEntries) {
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
    } catch { /* ignore */ }

    const specsDir = path.join(sc.root, '.omagy', 'specs');
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
          const evalMatch = /\*{0,2}Verdict:\s*(PASS|FAIL|INCONCLUSIVE)\*{0,2}/i.exec(reportText);
          const verifiedCount = (reportText.match(/\[VERIFIED\]/g) || []).length;
          const derivedCount = (reportText.match(/\[DERIVED\]/g) || []).length;
          const assumedCount = (reportText.match(/\[ASSUMED\]/g) || []).length;
          benchmarks.autoresearch.push({
            scope: sc.scope,
            slug,
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
    } catch { /* ignore */ }
  }

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
          try { st = fs.lstatSync(dir); } catch { continue; }
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
    } catch { /* ignore */ }
  }

  // 7. Loft Prototype Viewer (across scopes)
  const loft = [];
  for (const sc of scopeEntries) {
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const loftRoot = path.join(sc.root, '.omagy', 'artifacts', 'loft');
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
            scope: sc.scope,
            slug,
            relPath: `${relPrefix}.omagy/artifacts/loft/${slug}/index.html`,
            kind: hasLogicModule ? 'logic-fork' : 'ui-fork',
            updatedAt: new Date(st.mtimeMs).toISOString(),
            title: (/<title>([^<]+)<\/title>/i.exec(htmlText)?.[1] || slug).trim(),
          });
        }
      }
    } catch { /* ignore */ }
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
    skillEval: getCachedSkillEval(PLUGIN_ROOT),
  };

  // 9.5 Code Health & Technical Debt (5s + git-mtime cached symbol reuse, openCallers, shortcut: debt, and floorGuard)
  const codeHealth = getCachedCodeHealth(primaryRoot, nowMs);

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
    trackedScopes,
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
    codeHealth,
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
  <title>Oh My Agy</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--background, #0f1117);
      color: var(--foreground, #e5e7eb);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      overflow-x: hidden;
    }
    .card {
      background: var(--card, rgba(255,255,255,0.03));
      border: 1px solid var(--border, rgba(255,255,255,0.1));
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 10px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
      overflow-wrap: anywhere;
      word-break: break-word;
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
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
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
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      margin-top: 8px;
      padding: 8px;
      border-radius: 7px;
      background: rgba(0,0,0,0.28);
      border: 1px solid var(--border, rgba(255,255,255,0.09));
    }
    .cmd-input {
      width: 100%;
      box-sizing: border-box;
      background: rgba(255,255,255,0.04);
      color: var(--foreground, #e5e7eb);
      border: 1px solid var(--border, rgba(255,255,255,0.14));
      border-radius: 5px;
      padding: 6px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .cmd-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .action-btn {
      cursor: pointer;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      border: 1px solid var(--border, rgba(255,255,255,0.18));
      background: rgba(255,255,255,0.05);
      color: var(--foreground, #e5e7eb);
    }
    .action-btn-primary {
      border-color: rgba(96, 165, 250, 0.55);
      background: rgba(96, 165, 250, 0.16);
      color: var(--primary, #60a5fa);
    }
    .table-wrap {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
    }
    table.hud-table {
      width: 100%;
      max-width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 12px;
    }
    table.hud-table th,
    table.hud-table td {
      text-align: left;
      padding: 6px 6px;
      vertical-align: top;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    table.hud-table th {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--muted-foreground, #9ca3af);
      font-weight: 600;
    }
    table.hud-table tbody tr:last-child td { border-bottom: none; }
    table.hud-table .col-id { width: 44px; white-space: nowrap; }
    table.hud-table .col-main { width: auto; }
    table.hud-table .col-status { width: 96px; text-align: right; white-space: nowrap; }
    table.hud-table .col-mode { width: 32%; }
    table.hud-table .col-phase { width: 38%; }
    table.hud-table .col-scope { width: 30%; }
    table.hud-table .col-event { width: 38%; }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }
    .health-stat {
      padding: 8px 10px;
      border-radius: 7px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      min-width: 0;
    }
    .health-stat-label {
      font-size: 11px;
      color: var(--muted-foreground, #9ca3af);
      margin-bottom: 3px;
    }
    .health-stat-val {
      font-weight: 600;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .health-stat-sub {
      font-size: 11px;
      color: var(--muted-foreground, #9ca3af);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }
    .health-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--muted-foreground, #9ca3af);
      margin: 10px 0 6px 0;
    }
    .health-item {
      padding: 8px 10px;
      border-radius: 7px;
      background: rgba(255,255,255,0.025);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      margin-top: 6px;
      min-width: 0;
    }
    ul, li { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; margin: 0; }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
    <div>
      <div style="font-weight:600;font-size:14px;">Oh My Agy</div>
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
  </div>

  <div id="view-overview" class="view-pane"></div>
  <div id="view-workflows" class="view-pane" style="display:none;"></div>
  <div id="view-skills" class="view-pane" style="display:none;"></div>
  <div id="view-subagents" class="view-pane" style="display:none;"></div>
  <div id="view-wiki" class="view-pane" style="display:none;"></div>

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
    const editedPrompts = {};

    window.addEventListener('message', (event) => {
      if (event.source && event.source !== window.parent && event.source !== window) return;
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

    function getPromptValue(key, fallback) {
      return Object.prototype.hasOwnProperty.call(editedPrompts, key) ? editedPrompts[key] : fallback;
    }

    window.onPromptEdit = function(key, val) {
      if (key) editedPrompts[key] = String(val ?? '');
    };

    function flashButton(btn, label, ms = 1400) {
      if (!btn) return;
      const prev = btn.dataset.origLabel || btn.textContent;
      btn.dataset.origLabel = prev;
      btn.textContent = label;
      setTimeout(() => { btn.textContent = prev; }, ms);
    }

    window.copyFromInput = function(btn, inputId) {
      const el = document.getElementById(inputId);
      const text = el ? el.value : '';
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashButton(btn, 'Copied!')).catch(() => {});
      }
    };

    async function postDispatch(btn, body) {
      const prevLabel = btn ? (btn.dataset.origLabel || btn.textContent) : '';
      if (btn) {
        btn.dataset.origLabel = prevLabel;
        btn.disabled = true;
        btn.textContent = 'Sending...';
      }
      try {
        const q = new URLSearchParams();
        if (token) q.set('token', token);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['X-Sidecar-Token'] = token;
        const res = await fetch('/api/dispatch?' + q.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...body,
            workspace: latestData?.workspace || (workspaceUris[0] || ''),
            conversationId: latestData?.doctor?.latestRouting?.conversationId || '',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (btn) btn.disabled = false;
        if (!res.ok || !data.ok) {
          flashButton(btn, 'Error', 1800);
          return;
        }
        if (data.fallback) {
          flashButton(btn, 'Started New Chat!', 1800);
        } else if (data.modeUsed === 'active-chat' || data.modeUsed === 'subagent-active') {
          flashButton(btn, 'Sent to Chat!', 1600);
        } else {
          flashButton(btn, 'Launched Chat!', 1600);
        }
      } catch (e) {
        if (btn) btn.disabled = false;
        flashButton(btn, 'Failed', 1800);
      }
    }

    window.runFromInput = function(btn, inputId, mode) {
      const el = document.getElementById(inputId);
      const prompt = el ? el.value.trim() : '';
      if (!prompt) return;
      postDispatch(btn, { mode, prompt });
    };

    window.invokeSubagentFromInput = function(btn, inputId, agent, model, mode) {
      const el = document.getElementById(inputId);
      const prompt = el ? el.value.trim() : '';
      if (!prompt) return;
      postDispatch(btn, { mode, agent, model, prompt });
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
          <td class="col-mode"><code>\${esc(m.mode)}</code></td>
          <td class="col-phase">
            <span class="badge \${m.active && !m.stale ? 'badge-active' : ''}">\${esc(m.phase)}</span>
            <div class="muted" style="font-size:11px;margin-top:2px;">\${m.active ? (m.awaitingConfirmation ? 'WAITING CONFIRMATION' : (m.stale ? 'stale (>6h)' : 'active')) : 'inactive'}\${m.iteration != null ? \` &middot; #\${esc(m.iteration)}\` : ''}</div>
          </td>
          <td class="col-scope muted">\${esc(m.session)}</td>
        </tr>\`).join('');

      const qgRows = (data.qualityGates || []).map((g) => \`<li><code>\${esc(g.stage)}</code> &rarr; <code>\${esc(g.skill)}</code> (\${esc(g.mode)}, \${esc(g.model)})</li>\`).join('');

      // Consolidated Ultragoal Card
      let ugHtml = '';
      if (data.ultragoal) {
        const ug = data.ultragoal;
        const ugScope = ug.scope && ug.scope !== '.' ? \` <span class="badge">Scope: \${esc(ug.scope)}</span>\` : '';
        const pct = ug.counts.total > 0 ? Math.round((ug.counts.complete / ug.counts.total) * 100) : 0;
        const goalRows = (ug.goals || []).map((g) => \`
          <tr>
            <td class="col-id"><code>\${esc(g.id)}</code></td>
            <td class="col-main">
              <div>\${esc(g.title)}</div>
              <div class="muted" style="font-size:11px;margin-top:2px;">Rigor: <code>\${esc(g.rigor)}</code> &middot; Retries: \${g.productFailures}/3</div>
            </td>
            <td class="col-status"><span class="badge \${g.status === 'in_progress' ? 'badge-active' : ''}">\${esc(g.status)}</span></td>
          </tr>\`).join('');
        ugHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div style="font-weight:600;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;">Ultragoal: \${esc(ug.objective || 'Active Plan')}\${ugScope}</div>
              <span class="badge badge-active">\${ug.counts.complete}/\${ug.counts.total}</span>
            </div>
            <div class="bar-track" style="margin:8px 0;"><div class="bar-fill" style="width:\${pct}%;"></div></div>
            <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Goal</th><th class="col-status">Status</th></tr></thead><tbody>\${goalRows}</tbody></table></div>
          </div>\`;
      }

      // Consolidated Deep Interview Card
      let ivHtml = '';
      if (data.interview) {
        const iv = data.interview;
        const ivScope = iv.scope && iv.scope !== '.' ? \` <span class="badge">Scope: \${esc(iv.scope)}</span>\` : '';
        const ambPct = Math.round((iv.currentAmbiguity || 0) * 100);
        const threshPct = Math.round((iv.threshold || 0.2) * 100);
        ivHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
              <div style="font-weight:600;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;">Deep Interview: <code>\${esc(iv.slug || 'session')}</code>\${ivScope}</div>
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
          const tScope = t.scope && t.scope !== '.' ? \` <span class="badge">Scope: \${esc(t.scope)}</span>\` : '';
          const rows = (t.tasks || []).map((task) => \`
            <tr>
              <td class="col-id"><code>\${esc(task.id)}</code></td>
              <td class="col-main">
                <div>\${esc(task.title)}</div>
                <div class="muted" style="font-size:11px;margin-top:2px;">Role: <code>\${esc(task.role)}</code> &middot; Evidence: \${task.requiresCodeChange ? (task.hasEvidence ? 'verified' : 'pending') : 'n/a'}</div>
              </td>
              <td class="col-status"><span class="badge \${task.status === 'in_progress' ? 'badge-active' : ''}">\${esc(task.status)}</span></td>
            </tr>\`).join('');
          return \`
            <div class="card">
              <div style="font-weight:600;margin-bottom:4px;min-width:0;overflow-wrap:anywhere;">Team Board: <code>\${esc(t.team)}</code>\${tScope}</div>
              <div class="muted" style="margin-bottom:6px;min-width:0;overflow-wrap:anywhere;">\${esc(t.objective)}</div>
              <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Task</th><th class="col-status">Status</th></tr></thead><tbody>\${rows}</tbody></table></div>
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
        const resRows = resList.map((r) => \`<div style="margin-top:4px;"><span class="badge badge-active">Research \${r.compositeScore !== null ? r.compositeScore + '/100' : ''}</span>\${r.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(r.evalIntegrityVerdict)}</span>\` : ''} <strong>\${esc(r.title)}</strong> <span class="muted">(\${esc(r.lens)} &middot; V:\${r.claims.verified} D:\${r.claims.derived} A:\${r.claims.assumed}\${r.scope && r.scope !== '.' ? \` &middot; \${esc(r.scope)}\` : ''})</span></div>\`).join('');
        revResHtml = \`
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px;">Recent Reviews &amp; Deep Research</div>
            \${rpLine}
            \${crRows}
            \${resRows}
          </div>\`;
      }

      // Benchmarks (Performance Goals & Autoresearch) Card
      const perfList = data.benchmarks?.performanceGoals || [];
      const autoList = data.benchmarks?.autoresearch || [];
      let benchHtml = '';
      if (perfList.length || autoList.length) {
        const perfRows = perfList.map((p) => \`<div style="margin-bottom:4px;"><span class="badge \${p.status === 'active' ? 'badge-active' : ''}">Perf: \${esc(p.slug)}</span>\${p.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(p.evalIntegrityVerdict)}</span>\` : ''} <span class="muted">\${esc(p.objective)} (Checkpoints: \${(p.checkpoints || []).length})</span></div>\`).join('');
        const autoRows = autoList.map((a) => \`<div style="margin-top:4px;"><span class="badge \${a.passed ? 'badge-active' : ''}">Autoresearch: \${esc(a.slug)}</span> <span class="badge">\${esc(a.status)}</span>\${a.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(a.evalIntegrityVerdict)}</span>\` : ''} <span class="muted">(V:\${a.claims?.verified || 0} D:\${a.claims?.derived || 0} A:\${a.claims?.assumed || 0})</span></div>\`).join('');
        benchHtml = \`
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px;">Benchmarks &amp; Autoresearch</div>
            \${perfRows}
            \${autoRows}
          </div>\`;
      }

      // Visual Ralph & Loft Prototypes Card
      const vrList = data.visualRalph || [];
      const loftList = data.loft || [];
      let vrLoftHtml = '';
      if (vrList.length || loftList.length) {
        const vrRows = vrList.map((v) => \`<div style="margin-bottom:4px;"><span class="badge badge-active">Visual Ralph: \${esc(v.slug)}</span>\${v.verdict ? \` <span class="badge">\${esc(v.verdict.verdict)} (\${esc(v.verdict.score)})</span>\` : ''} <span class="muted">(\${(v.images || []).length} image(s))</span></div>\`).join('');
        const loftRows = loftList.map((l) => \`<div style="margin-top:4px;"><span class="badge">Loft (\${esc(l.kind)})</span> <strong>\${esc(l.title)}</strong> <code>\${esc(l.relPath)}</code></div>\`).join('');
        vrLoftHtml = \`
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px;">Visual Ralph &amp; Loft Prototypes</div>
            \${vrRows}
            \${loftRows}
          </div>\`;
      }

      // Code Health & Technical Debt Card
      const ch = data.codeHealth || { reused: [], created: [], reusedCount: 0, newCount: 0, reusePct: null, openCallers: [], debtTotal: 0, noTriggerCount: 0, debtItems: [] };
      const reusedSyms = Array.isArray(ch.reused) ? ch.reused : [];
      const createdSyms = Array.isArray(ch.created) ? ch.created : [];
      const hasDiffActivity = ch.reusedCount > 0 || ch.newCount > 0;
      const reuseVal = !hasDiffActivity
        ? 'Clean working tree'
        : (ch.reusePct !== null ? \`\${ch.reusePct}% reused\` : \`\${ch.reusedCount} reused &middot; \${ch.newCount} new\`);
      const reuseSub = !hasDiffActivity
        ? 'No uncommitted symbol changes'
        : \`\${ch.reusedCount} existing &middot; \${ch.newCount} new in git diff\`;
      const openCallersCount = (ch.openCallers || []).length;
      const openCallersVal = openCallersCount ? \`&#9888; \${openCallersCount} broken\` : '0 broken callers';
      const openCallersSub = openCallersCount ? 'Calls to removed functions' : 'No calls to deleted functions';
      const debtVal = \`\${ch.debtTotal} tracked\`;
      const debtSub = ch.debtTotal === 0
        ? 'No shortcut: comments'
        : (ch.noTriggerCount ? \`\${ch.noTriggerCount} missing upgrade condition\` : 'All have upgrade conditions');
      const fg = ch.floorGuard || { ok: true, exitCode: 0, deletedTests: 0, removedAssertions: 0, untrackedBlockers: 0, suppressions: 0, emptyCatches: 0, protectedBlocksModified: 0, total: 0 };
      const fgParts = [];
      if (fg.deletedTests) fgParts.push(\`\${fg.deletedTests} deleted test\${fg.deletedTests === 1 ? '' : 's'}\`);
      if (fg.removedAssertions) fgParts.push(\`\${fg.removedAssertions} removed assertion\${fg.removedAssertions === 1 ? '' : 's'}\`);
      if (fg.suppressions) fgParts.push(\`\${fg.suppressions} suppression\${fg.suppressions === 1 ? '' : 's'}\`);
      if (fg.emptyCatches) fgParts.push(\`\${fg.emptyCatches} empty catch\${fg.emptyCatches === 1 ? '' : 'es'}\`);
      if (fg.protectedBlocksModified) fgParts.push(\`\${fg.protectedBlocksModified} protected block\${fg.protectedBlocksModified === 1 ? '' : 's'}\`);
      if (fg.untrackedBlockers) fgParts.push(\`\${fg.untrackedBlockers} untracked\`);
      const floorGuardVal = fg.total > 0
        ? \`&#9888; \${fg.total} floor issue(s)\`
        : 'Clean';
      let floorGuardSub = '0 test deletions, suppressions, or empty catches';
      if (fg.total > 0) {
        floorGuardSub = fgParts.length ? fgParts.join(' &middot; ') : 'Anti-tampering floor violation in git diff';
      } else if (fg.exitCode === 2) {
        floorGuardSub = 'No git HEAD baseline';
      }

      const fmtSymList = (arr) => {
        const shown = arr.slice(0, 6).map((s) => \`<code>\${esc(s)}</code>\`).join(', ');
        return arr.length > 6 ? \`\${shown} <span class="muted">(+\${arr.length - 6} more)</span>\` : shown;
      };
      const diffBreakdownHtml = hasDiffActivity ? \`
        <div class="health-item" style="margin-top:0;margin-bottom:8px;font-size:12px;">
          \${reusedSyms.length ? \`<div><span class="muted">Reused in diff:</span> \${fmtSymList(reusedSyms)}</div>\` : ''}
          \${createdSyms.length ? \`<div style="\${reusedSyms.length ? 'margin-top:3px;' : ''}"><span class="muted">New in diff:</span> \${fmtSymList(createdSyms)}</div>\` : ''}
        </div>\` : '';

      const openCallersHtml = openCallersCount ? \`
        <div class="health-section-title">Orphaned Call Sites (Removed in Diff, Still Called)</div>
        \${(ch.openCallers || []).map((oc) => \`
          <div class="health-item">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
              <code>\${esc(oc.symbol)}()</code>
              <span class="badge badge-active">\${esc(oc.file)}:\${esc(oc.line)}</span>
            </div>
            \${oc.snippet ? \`<div class="muted" style="font-size:11px;margin-top:4px;"><code>\${esc(oc.snippet)}</code></div>\` : ''}
          </div>\`).join('')}\` : '';

      const debtItemsHtml = (ch.debtItems || []).length ? \`
        <div class="health-section-title">Documented Shortcuts (<code>shortcut:</code> &amp; <code>ceiling:</code> comments)</div>
        \${(ch.debtItems || []).map((it) => \`
          <div class="health-item">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
              <code>\${esc(it.file)}:\${esc(it.line)}</code>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <span class="badge">\${esc(it.marker || 'shortcut')}</span>
                \${it.noTrigger ? '<span class="badge">missing upgrade condition</span>' : ''}
              </div>
            </div>
            <div style="font-size:12px;"><span class="muted">Known limit:</span> \${esc(it.ceiling)}</div>
            <div style="font-size:11px;margin-top:2px;"><span class="muted">Upgrade when:</span> \${it.upgrade ? esc(it.upgrade) : '<span class="muted">Not specified (add comma + upgrade condition)</span>'}</div>
          </div>\`).join('')}\` : '<div class="muted" style="font-size:12px;margin-top:4px;">No <code>shortcut:</code> or <code>ceiling:</code> comments recorded in workspace.</div>';

      const codeHealthHtml = \`
        <div class="card">
          <div style="margin-bottom:10px;">
            <div style="font-weight:600;">Code Health &amp; Technical Debt</div>
            <div class="muted" style="font-size:11px;margin-top:2px;">Uncommitted git diff symbol reuse, orphaned call sites, floor-guard anti-tampering, and documented code shortcuts</div>
          </div>
          <div class="health-grid">
            <div class="health-stat">
              <div class="health-stat-label">Diff Function Reuse</div>
              <div class="health-stat-val">\${reuseVal}</div>
              <div class="health-stat-sub">\${reuseSub}</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Orphaned Call Sites</div>
              <div class="health-stat-val">\${openCallersVal}</div>
              <div class="health-stat-sub">\${openCallersSub}</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Documented Shortcuts</div>
              <div class="health-stat-val">\${debtVal}</div>
              <div class="health-stat-sub">\${debtSub}</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Floor Guard</div>
              <div class="health-stat-val">\${floorGuardVal}</div>
              <div class="health-stat-sub">\${floorGuardSub}</div>
            </div>
          </div>
          \${diffBreakdownHtml}
          \${openCallersHtml}
          \${debtItemsHtml}
        </div>\`;

      // Consolidated Doctor & Runtime Diagnostics Card (folded from Doctor tab)
      const doc = data.doctor || {};
      const se = doc.skillEval;
      const seLabel = se && se.ok ? \`PASS (\${esc(se.rank1Pct)}%)\` : 'FAIL';
      const errRows = (doc.hookErrors || []).map((e) => \`
        <tr>
          <td class="col-event">
            <div><code>\${esc(e.event)}</code></div>
            <div class="muted" style="font-size:11px;">\${esc(e.at)}</div>
          </td>
          <td class="col-main muted">\${esc(e.error)}</td>
        </tr>\`).join('');
      const doctorHtml = \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            <div style="font-weight:600;">Diagnostics &amp; Runtime Health</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <span class="badge \${se && se.ok ? 'badge-active' : ''}">Skill Eval: \${seLabel}</span>
              <span class="badge \${doc.qualityGatesOk ? 'badge-active' : ''}">Quality Gates: \${doc.qualityGatesOk ? 'OK' : 'INVALID'}</span>
              <span class="badge">Stale Modes: \${(doc.staleModes || []).length ? esc(doc.staleModes.join(', ')) : 'none'}</span>
            </div>
          </div>
          \${(doc.qualityGateErrors || []).length ? \`<ul style="margin:0 0 8px 0;padding-left:18px;">\${doc.qualityGateErrors.map((e) => \`<li>\${esc(e)}</li>\`).join('')}</ul>\` : ''}
          \${qgRows ? \`<div style="margin-bottom:8px;"><div class="muted" style="font-size:12px;margin-bottom:4px;">Configured Quality Gates:</div><ul style="margin:0;padding-left:18px;">\${qgRows}</ul></div>\` : ''}
          <div style="margin-bottom:8px;">
            <span class="muted">Latest PreInvocation Routing:</span>
            \${doc.latestRouting ? \` Conversation <code>\${esc(doc.latestRouting.conversationId)}</code> &middot; Skills: <code>\${esc((doc.latestRouting.skills || []).join(', ') || 'none')}</code>\` : ' <span class="muted">No .routing.json found yet.</span>'}
          </div>
          <div>
            <div class="muted" style="margin-bottom:4px;">Recent Hook Errors (.omagy/logs/hook-errors.jsonl):</div>
            \${errRows ? \`<div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-event">Event</th><th class="col-main">Error</th></tr></thead><tbody>\${errRows}</tbody></table></div>\` : '<div class="muted">Zero hook errors recorded.</div>'}
          </div>
        </div>\`;

      const counts = {
        skills: data.catalog?.skills?.length || 0,
        subagents: data.catalog?.subagents?.length || 0,
        workflows: data.catalog?.workflows?.length || 0,
      };

      const trackedScopesHtml = (data.trackedScopes || []).length
        ? \`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="muted" style="font-size:11px;">Tracked .omagy scopes:</span>\${(data.trackedScopes || []).map((sc) => \`<span class="badge \${sc.scope !== '.' ? 'badge-active' : ''}"><code>\${esc(sc.scope)}</code></span>\`).join('')}</div>\`
        : '';

      document.getElementById('view-overview').innerHTML = \`
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="min-width:0;flex:1 1 180px;">
            <div style="font-weight:600;margin-bottom:2px;">Workspace</div>
            <code>\${esc(data.workspace)}</code>
            \${trackedScopesHtml}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="badge" style="cursor:pointer;" onclick="setTab('workflows')">\${counts.workflows} Workflows</button>
            <button class="badge" style="cursor:pointer;" onclick="setTab('skills')">\${counts.skills} Skills</button>
            <button class="badge" style="cursor:pointer;" onclick="setTab('subagents')">\${counts.subagents} Subagents</button>
          </div>
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Workflow Modes</div>
          \${modesRows ? \`<div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-mode">Mode</th><th class="col-phase">Phase</th><th class="col-scope">Scope</th></tr></thead><tbody>\${modesRows}</tbody></table></div>\` : '<div class="muted">No active mode state files in .omagy/state/. Open the <strong>Workflows</strong>, <strong>Skills</strong>, or <strong>Subagents</strong> tab to edit and run commands directly.</div>'}
        </div>
        \${ugHtml}
        \${ivHtml}
        \${teamHtml}
        \${revResHtml}
        \${benchHtml}
        \${vrLoftHtml}
        \${codeHealthHtml}
        \${doctorHtml}
      \`;
    }

    function renderWorkflows(data) {
      const list = data.catalog?.workflows || [];
      document.getElementById('view-workflows').innerHTML = list.map((wf) => {
        const stagesHtml = (wf.stages || []).map((s, idx) => \`
          <span class="badge">\${idx + 1}. \${esc(s)}</span>\`).join('<span class="muted" style="align-self:center;">&rarr;</span>');
        const inputKey = 'wf:' + wf.id;
        const inputId = 'input-wf-' + wf.id;
        const val = getPromptValue(inputKey, wf.quickStart);
        return \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
              <div style="font-weight:600;">\${esc(wf.title)}</div>
              \${wf.active ? \`<span class="badge badge-active">ACTIVE (\${esc(wf.currentPhase)})</span>\` : \`<span class="badge">\${esc(wf.modeKey)}</span>\`}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">\${stagesHtml}</div>
            <div style="margin-bottom:6px;"><strong>When to use:</strong> <span class="muted">\${esc(wf.whenToUse)}</span></div>
            <div class="muted" style="font-size:12px;"><strong>State / Artifacts:</strong> <code>\${esc(wf.artifacts)}</code></div>
            <div class="cmd-box">
              <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" />
              <div class="cmd-actions">
                <button class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'active-chat')" title="Send into the active chat conversation (or start a new chat if none is active)">Run in Chat</button>
                <button class="action-btn" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'new-chat')" title="Start a new chat conversation with this command">New Chat</button>
                <button class="action-btn" data-input-id="\${esc(inputId)}" onclick="copyFromInput(this, this.dataset.inputId)" title="Copy command to clipboard">Copy</button>
              </div>
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
        const inputKey = 'skill:' + s.name;
        const inputId = 'input-skill-' + s.name;
        const val = getPromptValue(inputKey, s.quickStart);
        return \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <div>
                <code style="font-weight:600;font-size:13px;">/\${esc(s.name)}</code>
                <span class="muted" style="font-size:12px;margin-left:4px;">($\${esc(s.name)})</span>
              </div>
              <span class="badge">\${esc(s.category)}</span>
            </div>
            \${flagsHtml ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">\${flagsHtml}</div>\` : ''}
            <div style="margin-bottom:4px;">\${esc(s.howToUse)}</div>
            <div class="cmd-box">
              <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" />
              <div class="cmd-actions">
                <button class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'active-chat')" title="Send into the active chat conversation (or start a new chat if none is active)">Run in Chat</button>
                <button class="action-btn" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'new-chat')" title="Start a new chat conversation with this skill command">New Chat</button>
                <button class="action-btn" data-input-id="\${esc(inputId)}" onclick="copyFromInput(this, this.dataset.inputId)" title="Copy command to clipboard">Copy</button>
              </div>
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
      const cards = filtered.map((a) => {
        const inputKey = 'sa:' + a.name;
        const inputId = 'input-sa-' + a.name;
        const val = getPromptValue(inputKey, a.defaultPrompt || '');
        return \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <code style="font-weight:600;font-size:13px;">\${esc(a.name)}</code>
            <div style="display:flex;gap:4px;align-items:center;">
              <span class="badge">\${esc(a.lane)}</span>
              <span class="badge badge-active">Model: \${esc(a.modelTier)}</span>
            </div>
          </div>
          <div style="margin-bottom:4px;">\${esc(a.whenToUse)}</div>
          <div class="cmd-box">
            <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" placeholder="Task for \${esc(a.name)}..." />
            <div class="cmd-actions">
              <button class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" data-agent="\${esc(a.name)}" data-model="\${esc(a.cliModel || '')}" onclick="invokeSubagentFromInput(this, this.dataset.inputId, this.dataset.agent, this.dataset.model, 'subagent-active')" title="Send into the active chat so the leader agent calls invoke_subagent">Dispatch into Active Chat</button>
              <button class="action-btn" data-input-id="\${esc(inputId)}" data-agent="\${esc(a.name)}" data-model="\${esc(a.cliModel || '')}" onclick="invokeSubagentFromInput(this, this.dataset.inputId, this.dataset.agent, this.dataset.model, 'subagent-standalone')" title="Open a standalone specialist chat with --profile=\${esc(a.name)}">Launch Standalone Chat</button>
            </div>
          </div>
        </div>\`;
      }).join('');
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

    function isEditingInContainer(containerId) {
      const container = document.getElementById(containerId);
      const active = document.activeElement;
      return Boolean(container && active && container.contains(active) && active.tagName === 'INPUT');
    }

    function render(data) {
      document.getElementById('status-line').textContent = data.statusLine || '[OMA] No active modes';
      renderOverview(data);
      if (!isEditingInContainer('view-workflows')) renderWorkflows(data);
      if (!isEditingInContainer('view-skills')) renderSkills(data);
      if (!isEditingInContainer('view-subagents')) renderSubagents(data);
      renderWiki(data);
    }

    loadSnapshot();
    setInterval(loadSnapshot, 4000);
  </script>
</body>
</html>`;

function verifyHudToken(expected, provided) {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createHudServer(token, options = {}) {
  const envToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
  const expectedToken = token === undefined
    ? (envToken || crypto.randomBytes(24).toString('hex'))
    : String(token || '');
  const statusRequiresToken = options.statusRequiresToken ?? (token === undefined ? Boolean(envToken) : Boolean(expectedToken));
  return http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const rawHdrToken = req.headers['x-sidecar-token'];
    const provided = (typeof rawHdrToken === 'string' ? rawHdrToken : '') || reqUrl.searchParams.get('token') || '';
    const tokenValid = verifyHudToken(expectedToken, provided);
    const denyUnauthorized = () => {
      res.writeHead(401, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    };
    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(HUD_HTML);
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
      if (statusRequiresToken && !tokenValid) {
        denyUnauthorized();
        return;
      }
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
      const snap = buildHudSnapshot(workspaces);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap));
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
      const wsParam = reqUrl.searchParams.get('workspace') || process.env.OMAGY_WORKSPACE || process.cwd();
      const relParam = reqUrl.searchParams.get('rel') || '';
      const resolved = resolveSafeArtifactFile(uriToFsPath(wsParam) || wsParam, relParam);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Artifact not found or forbidden' }));
        return;
      }
      try {
        const buf = fs.readFileSync(resolved.filePath);
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
    const snap = buildHudSnapshot([wsFileUrl], baseNowMs);

    // Verify 5,000ms TTL memoization & .git/index mtime invalidation on codeHealth.floorGuard
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), `${origSrcIndex}\ntry { parseRows([]); } ${'ca' + 'tch'} {}\n`);
    const cachedSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 2000);
    const expiredSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 6000);
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), origSrcIndex);
    const bumpedGitMtime = new Date(Date.now() + 3000);
    fs.utimesSync(path.join(ws, '.git', 'index'), bumpedGitMtime, bumpedGitMtime);
    const gitInvalidatedSnap = buildHudSnapshot([wsFileUrl], baseNowMs + 7000);
    const floorCacheOk = snap.codeHealth?.floorGuard?.ok === true
      && snap.codeHealth?.floorGuard?.exitCode === 0
      && snap.codeHealth?.floorGuard?.total === 0
      && cachedSnap.codeHealth === snap.codeHealth
      && expiredSnap.codeHealth?.floorGuard?.ok === false
      && expiredSnap.codeHealth?.floorGuard?.emptyCatches === 1
      && expiredSnap.codeHealth?.floorGuard?.total === 1
      && gitInvalidatedSnap.codeHealth?.floorGuard?.ok === true
      && gitInvalidatedSnap.codeHealth?.floorGuard?.total === 0;

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
      && innerSnapOk;

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
