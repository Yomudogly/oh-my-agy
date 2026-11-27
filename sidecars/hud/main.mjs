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
  canonicalizePath,
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
  queryWikiPages,
  runFloorGuard,
  scanSessionTranscripts,
  validateDesignMd,
} from '../../hooks/omagy-cli.mjs';
import {
  HUD_HTML,
  buildBacklinksIndex,
  buildCommandPaletteItems,
  buildSkillCommandWithFlags,
  buildSubagentInvokeSnippet,
  buildTaskDagWaves,
  buildWikiMindMapGraph,
  extractMarkdownToc,
  fenceUntrustedContext,
  formatAgreementCard,
  formatScopeLabel,
  formatWorkspaceName,
  getFreshRoutingHint,
  highlightMatch,
  parseWorkflowStageLabel,
  prepareLoftSrcdoc,
  projectMindMapPoint,
  renderHudHtml,
  renderSafeMarkdown,
  resolveWorkflowStageState,
  resolveWorkspaceControlState,
  selectCurrentMode,
} from './ui.mjs';
import {
  copyToSystemClipboard,
  dispatchDesktopHostAction,
  inferRoutingRecordHost,
  isRoutingHostCompatible,
  normalizeHostPromptSigil,
  resolveAntigravityBrainDir,
  routingMatchesWorkspaces,
  verifyAntigravityTargetConversation,
} from './dispatch.mjs';
import {
  cleanGitEnv,
  computeDesktopHudPort,
  defaultPluginDataDir,
  defaultRuntimeDir,
  desktopHudRegistryFile,
  pauseWorkspaceExecution,
  readPauseState,
  resolvePluginRoot,
  resumeWorkspaceExecution,
} from '../../hooks/omagy-host.mjs';

const ALLOWED_HUD_HOSTS = new Set(['antigravity', 'claude', 'codex']);
const LOOPBACK_HOST_HEADER_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;

/** Normalize an explicit HUD host identifier, defaulting to 'antigravity'. */
export function normalizeExplicitHudHost(rawHost) {
  const host = String(rawHost || '').trim().toLowerCase();
  return ALLOWED_HUD_HOSTS.has(host) ? host : 'antigravity';
}

export {
  HUD_HTML,
  buildBacklinksIndex,
  buildCommandPaletteItems,
  buildSkillCommandWithFlags,
  buildSubagentInvokeSnippet,
  buildTaskDagWaves,
  buildWikiMindMapGraph,
  extractMarkdownToc,
  fenceUntrustedContext,
  formatAgreementCard,
  formatScopeLabel,
  formatWorkspaceName,
  getFreshRoutingHint,
  highlightMatch,
  parseWorkflowStageLabel,
  prepareLoftSrcdoc,
  projectMindMapPoint,
  renderHudHtml,
  renderSafeMarkdown,
  resolveWorkflowStageState,
  resolveWorkspaceControlState,
  selectCurrentMode,
};

hardenWindowsExeSearch();

export const BIND_HOST = '127.0.0.1';
const STALE_MS = 6 * 3600 * 1000;
const TEAM_COMPLETED_WINDOW_MS = 20 * 60 * 1000;
const CODE_HEALTH_TTL_MS = 5000;
const WORKTREE_TTL_MS = 5000;
const MAX_CODE_HEALTH_CACHE_ENTRIES = 32;
const MAX_DISPATCH_BODY_BYTES = 16 * 1024;
const TERMINAL = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
const WIKI_CATEGORIES = new Set(['architecture', 'decision', 'pattern', 'debugging', 'environment', 'session-log', 'reference', 'convention']);
const ALLOWED_DISPATCH_MODES = new Set(['active-chat', 'new-chat', 'subagent-active', 'subagent-standalone']);
const ALLOWED_CLI_MODELS = new Set(['flash_lite', 'flash', 'pro']);
export const ALLOWED_VIEWS = ['overview', 'workflows', 'skills', 'subagents', 'wiki'];
const SELF_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export function resolveCanonicalPluginRoot(selfRoot, env = process.env) {
  const resolvedSelf = path.resolve(String(selfRoot || process.cwd()));
  const sentinel = path.join(resolvedSelf, '__omagy_env_miss__');
  const envResolved = resolvePluginRoot(sentinel, env);
  if (envResolved !== sentinel) return envResolved;
  const metaPath = path.join(resolvedSelf, 'host-bundle.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(stripUtf8Bom(fs.readFileSync(metaPath, 'utf8')));
      if (meta?.pluginRoot && fs.existsSync(path.join(meta.pluginRoot, 'plugin.json'))) {
        return path.resolve(meta.pluginRoot);
      }
    } catch { /* fail open: ignore unreadable host-bundle.json */ }
  }
  return resolvedSelf;
}
export const PLUGIN_ROOT = resolveCanonicalPluginRoot(SELF_PLUGIN_ROOT);
const SIDECAR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const UI_MODULE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ui.mjs');
const CLIENT_MODULE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'client.mjs');
let liveUiMtimeMs = 0;
let liveClientMtimeMs = 0;
let liveHudHtml = HUD_HTML;
try {
  liveUiMtimeMs = fs.statSync(UI_MODULE_PATH).mtimeMs;
  liveClientMtimeMs = fs.statSync(CLIENT_MODULE_PATH).mtimeMs;
} catch { /* fail open: fallback to static HUD_HTML */ }

async function getLiveHudHtml() {
  try {
    const uiSt = fs.statSync(UI_MODULE_PATH);
    const clientSt = fs.statSync(CLIENT_MODULE_PATH);
    if (uiSt.mtimeMs !== liveUiMtimeMs || clientSt.mtimeMs !== liveClientMtimeMs) {
      const freshClient = await import(`${pathToFileURL(CLIENT_MODULE_PATH).href}?t=${clientSt.mtimeMs}`);
      const freshUi = await import(`${pathToFileURL(UI_MODULE_PATH).href}?t=${uiSt.mtimeMs}`);
      const clientRenderer = typeof freshClient.renderHudClientScript === 'function' ? freshClient.renderHudClientScript : undefined;
      const freshHtml = typeof freshUi.renderHudHtml === 'function' ? freshUi.renderHudHtml(clientRenderer) : freshUi.HUD_HTML;
      if (typeof freshHtml === 'string' && freshHtml.length > 0) {
        liveHudHtml = freshHtml;
        liveUiMtimeMs = uiSt.mtimeMs;
        liveClientMtimeMs = clientSt.mtimeMs;
      }
    }
  } catch { /* fail open: serve last valid HUD_HTML if ui.mjs or client.mjs is mid-write */ }
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
  modernize: {
    category: 'Execution & Teams',
    flags: ['--plan', '--dry-run', '--wave'],
    quickStart: '/modernize --plan "upgrade React 18 to 19 and ESLint 9 flat config"',
    howToUse: 'Phased codebase, dependency, framework, and runtime modernization using behavior-lock baselines, dep-license-diff / coverage-map pre-flight, codemod waves, Expand-Migrate-Contract seams, and rollback checkpoints.',
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
  'threat-model': {
    category: 'Review, QA & Cleanup',
    flags: [],
    quickStart: '/threat-model map trust boundaries and MCP supply-chain risks in this repo',
    howToUse: 'Structured STRIDE and OWASP Agentic/LLM threat modeling with trust-boundary data-flow diagrams, likelihood-impact scoring, mcp-audit/dep-license-diff probes, and file:line mitigations.',
  },
  release: {
    category: 'Review, QA & Cleanup',
    flags: [],
    quickStart: '/release prepare v0.8.0 changelog, manifest sync, and dry-run packaging',
    howToUse: 'End-to-end release engineering workflow covering pre-release quality/license/docs-drift gates, SemVer classification, CHANGELOG sync, dry-run packaging validation, and human-confirmed tag/publish steps.',
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
    modelTier: 'inherit',
    defaultPrompt: 'Review architectural boundaries, steelman tradeoffs, and ADR reversibility of recent changes',
    whenToUse: 'Read-only architectural review, steelman antithesis, Demolition/ADR tests, and CLEAR / WATCH / BLOCK rulings in /ralplan and /code-review.',
  },
  critic: {
    lane: 'Planning & Architecture',
    modelTier: 'inherit',
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
    modelTier: 'inherit',
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
    modelTier: 'inherit',
    defaultPrompt: 'Audit recent changes for OWASP Top 10, injection, auth, secret exposure, and path traversal risks',
    whenToUse: 'OWASP Top 10, auth/session boundaries, injection, path traversal, and secret exposure audit on security-sensitive changes.',
  },
  'supply-chain-auditor': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    defaultPrompt: 'Audit dependency licenses, lockfile provenance, .mcp.json servers, skills, and GitHub Actions SHA pinning',
    whenToUse: 'Read-only dependency, SPDX license (dep-license-diff), MCP config (mcp-audit), skill Trojan (skill-validate), and CI action-pinning audit.',
  },
  'runtime-qa': {
    lane: 'Review & Verification',
    modelTier: 'inherit',
    defaultPrompt: 'Run black-box edge-case probes, timeout resilience checks, and coverage-map gap sweeps on recent changes',
    whenToUse: 'Read-only black-box CLI/process/API edge-case probing, coverage-map gap targeting, zero-assertion test audits, and reproducible failure recipes.',
  },
  'devops-engineer': {
    lane: 'Execution & Debugging',
    modelTier: 'inherit',
    defaultPrompt: 'Harden CI workflows, container runtime alignment, and dry-run release packaging',
    whenToUse: 'CI/CD pipelines, Dockerfiles, Node/runtime alignment, dry-run packaging checks, and canary/rollback automation for /release and /modernize.',
  },
  'doc-steward': {
    lane: 'Execution & Debugging',
    modelTier: 'flash | inherit',
    defaultPrompt: 'Run docs-drift and wiki-lint to synchronize CLI flags, .env.example keys, and wiki cross-links',
    whenToUse: 'Docs-drift remediation, wiki-lint cross-link hygiene (0 isolatedPages), README/CLI flag synchronization, and key-only .env.example alignment.',
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
  {
    id: 'modernize',
    title: 'Phased Modernization & Upgrade Lane (/modernize)',
    modeKey: 'modernize',
    stages: ['Coverage & License Baseline', 'Codemod Waves (--wave)', 'Expand-Migrate-Contract Seams', 'Verify & Rollback Gate'],
    whenToUse: 'When upgrading frameworks, SDKs, language runtimes, or legacy modules across Antigravity, Claude Code, and OpenAI Codex with behavior-lock regression baselines.',
    quickStart: '/modernize --plan "upgrade TypeScript and ESLint flat config safely"',
    artifacts: 'Targeted codemod waves + regression test baselines + rollback checkpoints',
  },
  {
    id: 'threat-model',
    title: 'Security & Agentic Threat Modeling (/threat-model)',
    modeKey: 'threat-model',
    stages: ['Map Trust Boundaries', 'STRIDE + OWASP LLM01-LLM10', 'MCP & License Audits', 'Mitigation Playbook'],
    whenToUse: 'When evaluating auth boundaries, MCP servers, dependency supply chains, or agent tool permissions across all 3 hosts before shipping.',
    quickStart: '/threat-model evaluate auth boundaries, .mcp.json servers, and skill inputs',
    artifacts: 'Trust-boundary DFD, scored risk table, and file:line mitigation checklist',
  },
  {
    id: 'release',
    title: 'Release Readiness & Sync Workflow (/release)',
    modeKey: 'release',
    stages: ['Pre-Release Audit Gates', 'SemVer & Manifest Sync', 'Dry-Run Packaging', 'Human-Gated Tag & Rollout'],
    whenToUse: 'When preparing a versioned release across CHANGELOG, manifests, docs-drift, and CI packaging with explicit human confirmation before publishing.',
    quickStart: '/release prepare version bump, changelog sync, and dry-run packaging checks',
    artifacts: 'Synced plugin manifest/CHANGELOG, dry-run validation receipt, and rollback playbook',
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
  } else if (/^\.omagy\/plans\/ralplan-(?:review|receipt)-[^/]+\.json$/i.test(omagySubpath)) {
    mime = 'application/json; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/specs\/(?:[^/]+\.md|autoresearch-[^/]+\/report\.md)$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/evidence\/(?:task|goal)-[A-Za-z0-9._-]+\.json$/i.test(omagySubpath)) {
    mime = 'application/json; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/ultragoal\/(?:brief|notepad)\.md$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else if (/^\.omagy\/goals\/performance\/[^/]+\/summary\.md$/i.test(omagySubpath)) {
    mime = 'text/plain; charset=utf-8';
    redact = true;
  } else {
    return null;
  }
  if (!mime) return null;

  try {
    const rootReal = canonicalizePath(resolveStateRoot(workspaceRoot));
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

    const candidateReal = canonicalizePath(cur);
    const scopeOmagyReal = canonicalizePath(matchedScope.omagyDir);
    const allowedSubroots = [
      path.join(scopeOmagyReal, 'artifacts') + path.sep,
      path.join(scopeOmagyReal, 'plans') + path.sep,
      path.join(scopeOmagyReal, 'specs') + path.sep,
      path.join(scopeOmagyReal, 'evidence') + path.sep,
      path.join(scopeOmagyReal, 'ultragoal') + path.sep,
      path.join(scopeOmagyReal, 'goals', 'performance') + path.sep,
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
const worktreeCache = new Map();
const designSystemCache = new Map();
const forensicsCache = new Map();
let skillEvalCache = { key: '', value: null };

function setBoundedCache(map, key, entry) {
  if (map.size >= MAX_CODE_HEALTH_CACHE_ENTRIES && !map.has(key)) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, entry);
}

function statMtimeToken(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch { /* fail open: optional metadata file may not exist yet */
    return 'missing';
  }
}

function scrubWorktreePath(wtPath) {
  const raw = String(wtPath || '').trim();
  if (!raw) return '';
  let home = '';
  try { home = os.homedir(); } catch { /* fail open: no homedir */ }
  let scrubbed = raw;
  if (home && scrubbed.startsWith(home)) {
    scrubbed = '~' + scrubbed.slice(home.length);
  }
  scrubbed = scrubbed.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
  return redactSecrets(scrubbed);
}

export function collectGitWorktrees(primaryRoot) {
  const realpath = fs.realpathSync.native || fs.realpathSync;
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: primaryRoot,
      env: cleanGitEnv(process.env),
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let canonRoot = '';
    try { canonRoot = realpath(primaryRoot); } catch { /* fail open: unresolved root */ }
    const entries = [];
    let cur = null;
    const flush = () => {
      if (!cur || !cur.rawPath) return;
      let isCurrent = false;
      try {
        isCurrent = Boolean(canonRoot && realpath(cur.rawPath) === canonRoot);
      } catch { /* fail open: removed worktree dir */ }
      entries.push({
        label: formatWorkspaceName(cur.rawPath) || 'worktree',
        path: scrubWorktreePath(cur.rawPath),
        head: cur.head ? cur.head.slice(0, 12) : '',
        branch: redactSecrets(cur.branch || (cur.detached ? '(detached)' : (cur.bare ? '(bare)' : ''))),
        isCurrent,
        detached: Boolean(cur.detached),
        bare: Boolean(cur.bare),
        ...(cur.prunable ? { prunable: redactSecrets(cur.prunable) } : {}),
      });
      cur = null;
    };
    for (const rawLine of String(out || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) { flush(); continue; }
      if (line.startsWith('worktree ')) {
        flush();
        cur = { rawPath: line.slice(9).trim(), head: '', branch: '', detached: false, bare: false, prunable: '' };
      } else if (cur) {
        if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim();
        else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
        else if (line === 'detached') cur.detached = true;
        else if (line === 'bare') cur.bare = true;
        else if (line.startsWith('prunable')) cur.prunable = line.slice(8).trim() || 'prunable';
      }
    }
    flush();
    return entries;
  } catch { /* fail open: workspace may not be a git worktree */
    return [];
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

export function getCachedWorktrees(primaryRoot, nowMs = Date.now()) {
  const rootKey = path.resolve(primaryRoot);
  const gitSig = readGitMetadataSignature(rootKey);
  if (gitSig === 'nogit') return [];
  const cached = worktreeCache.get(rootKey);
  if (
    cached
    && cached.gitSig === gitSig
    && nowMs >= cached.computedAtMs
    && (nowMs - cached.computedAtMs) < WORKTREE_TTL_MS
  ) {
    return cached.value;
  }
  const value = collectGitWorktrees(rootKey);
  setBoundedCache(worktreeCache, rootKey, { gitSig, computedAtMs: nowMs, value });
  return value;
}

function listSecureRoutingEntries(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const dirSt = fs.lstatSync(dirPath);
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) return [];
  if (typeof process.getuid === 'function' && dirSt.uid !== process.getuid()) return [];
  return fs.readdirSync(dirPath)
    .filter((f) => f.endsWith('.routing.json'))
    .map((f) => {
      const p = path.join(dirPath, f);
      try {
        const st = fs.lstatSync(p);
        const uidOk = typeof process.getuid !== 'function' || st.uid === process.getuid();
        return st.isFile() && !st.isSymbolicLink() && uidOk
          ? { file: f, id: f.replace(/\.routing\.json$/, ''), path: p, mtimeMs: st.mtimeMs }
          : null;
      } catch { /* fail open: skip unreadable routing entry */ return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveLegacyRoutingDirIfEligible(explicitOpt, primaryTargetDir) {
  if (process.env.OMAGY_RUNTIME_DIR || explicitOpt) return '';
  if (primaryTargetDir !== path.resolve(defaultRuntimeDir())) return '';
  const legacyDir = path.resolve(path.join(os.tmpdir(), 'oh-my-agy'));
  return legacyDir !== primaryTargetDir ? legacyDir : '';
}

function readLatestRoutingInDir(dirPath, filterOpts = {}) {
  try {
    const expectedHost = String(filterOpts?.host || 'antigravity').trim().toLowerCase() || 'antigravity';
    const targetRoots = Array.isArray(filterOpts?.roots) ? filterOpts.roots : (filterOpts?.roots ? [filterOpts.roots] : []);
    const brainDir = expectedHost === 'antigravity' ? resolveAntigravityBrainDir(filterOpts?.brainDir) : '';
    const routingFiles = listSecureRoutingEntries(dirPath);
    if (!routingFiles.length) return null;
    let unscopedFallback = null;
    for (const rf of routingFiles) {
      const data = readJsonSafe(rf.path);
      if (!data) continue;
      if (data.isSubagent === true) continue;
      const conversationId = rf.id;
      if (!isRoutingHostCompatible(data, expectedHost, conversationId, brainDir)) continue;
      const workspaces = Array.isArray(data.workspaces) ? data.workspaces.map(String).filter(Boolean) : [];
      const wsMatch = routingMatchesWorkspaces(workspaces, targetRoots);
      if (wsMatch === 'mismatch') continue;
      const record = {
        conversationId,
        host: inferRoutingRecordHost(data),
        at: String(data.at || new Date(rf.mtimeMs).toISOString()),
        skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
        workspaces,
        transcriptPath: String(data.transcriptPath || ''),
      };
      if (wsMatch === 'match') return record;
      if (!unscopedFallback) unscopedFallback = record;
    }
    return unscopedFallback;
  } catch { /* fail open: runtime directory unavailable */
    return null;
  }
}

export function readLatestRouting(runtimeDir = defaultRuntimeDir(), filterOpts = {}) {
  const explicitOpt = filterOpts?.runtimeDir ? String(filterOpts.runtimeDir) : '';
  const targetDir = path.resolve(String(explicitOpt || runtimeDir || defaultRuntimeDir()));
  const primary = readLatestRoutingInDir(targetDir, filterOpts);
  if (primary) return primary;
  const legacyDir = resolveLegacyRoutingDirIfEligible(filterOpts?.runtimeDir, targetDir);
  if (legacyDir) return readLatestRoutingInDir(legacyDir, filterOpts);
  return null;
}

export function getCachedCodeHealth(primaryRoot, nowMs = Date.now(), transcriptPath = null) {
  const rootKey = path.resolve(primaryRoot);
  const txPath = typeof transcriptPath === 'string' ? transcriptPath.trim() : (readLatestRouting(undefined, { roots: [rootKey] })?.transcriptPath || '');
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

  setBoundedCache(codeHealthCache, rootKey, { gitSig, computedAtMs: nowMs, value });
  return value;
}

function findDesignMdPath(rootKey) {
  const candidates = [
    path.join(rootKey, 'DESIGN.md'),
    path.join(rootKey, '.omagy', 'DESIGN.md'),
  ];
  for (const p of candidates) {
    try {
      const st = fs.lstatSync(p);
      if (!st.isSymbolicLink() && st.isFile()) return p;
    } catch { /* fail open: candidate DESIGN.md absent */ }
  }
  return '';
}

function getCachedDesignSystem(primaryRoot) {
  const rootKey = path.resolve(primaryRoot);
  const designPath = findDesignMdPath(rootKey);
  if (!designPath) {
    return {
      exists: false,
      file: '',
      ok: true,
      categoriesFound: [],
      sectionsFound: [],
      tokenCount: 0,
      contrastChecks: [],
      unresolvedRefs: [],
      errors: [],
      warnings: [],
    };
  }
  const sig = `${designPath}:${statMtimeToken(designPath)}`;
  const cached = designSystemCache.get(rootKey);
  if (cached && cached.sig === sig) {
    return cached.value;
  }
  let value = {
    exists: true,
    file: path.relative(rootKey, designPath).replace(/\\/g, '/'),
    ok: false,
    categoriesFound: [],
    sectionsFound: [],
    tokenCount: 0,
    contrastChecks: [],
    unresolvedRefs: [],
    errors: ['Design validation unavailable'],
    warnings: [],
  };
  try {
    const res = validateDesignMd(designPath);
    value = {
      exists: true,
      file: path.relative(rootKey, designPath).replace(/\\/g, '/'),
      ok: Boolean(res.ok),
      categoriesFound: Array.isArray(res.categoriesFound) ? res.categoriesFound.map(String) : [],
      sectionsFound: Array.isArray(res.sectionsFound) ? res.sectionsFound.map(String) : [],
      tokenCount: Number(res.tokenCount || 0),
      contrastChecks: Array.isArray(res.contrastChecks)
        ? res.contrastChecks.slice(0, 16).map((c) => ({
            pair: String(c.pair || ''),
            fg: String(c.fg || ''),
            bg: String(c.bg || ''),
            ratio: Number(c.ratio || 0),
            minRequired: Number(c.minRequired || 4.5),
            pass: Boolean(c.pass),
          }))
        : [],
      unresolvedRefs: Array.isArray(res.unresolvedRefs) ? res.unresolvedRefs.slice(0, 16).map((u) => redactSecrets(String(u))) : [],
      errors: Array.isArray(res.errors) ? res.errors.slice(0, 10).map((e) => redactSecrets(String(e))) : [],
      warnings: Array.isArray(res.warnings) ? res.warnings.slice(0, 10).map((w) => redactSecrets(String(w))) : [],
    };
  } catch { /* fail open: DESIGN.md validation failed */ }
  setBoundedCache(designSystemCache, rootKey, { sig, value });
  return value;
}

function getCachedForensics(primaryRoot, transcriptPath = '') {
  const rootKey = path.resolve(primaryRoot);
  let targetPath = '';
  let childSig = '';
  const logsDir = path.join(rootKey, '.omagy', 'logs');
  try {
    const st = fs.lstatSync(logsDir);
    if (!st.isSymbolicLink() && st.isDirectory()) {
      const logFiles = fs.readdirSync(logsDir)
        .filter((n) => n.endsWith('.jsonl') && n !== 'ledger.jsonl' && n !== 'hook-errors.jsonl')
        .sort();
      if (logFiles.length) {
        targetPath = logsDir;
        childSig = logFiles.map((n) => `${n}:${statMtimeToken(path.join(logsDir, n))}`).join(',');
      }
    }
  } catch { /* fail open: .omagy/logs unavailable */ }
  const txCandidate = typeof transcriptPath === 'string' ? transcriptPath.trim() : '';
  if (!targetPath && txCandidate) {
    try {
      const st = fs.lstatSync(txCandidate);
      if (!st.isSymbolicLink() && st.isFile()) targetPath = path.resolve(txCandidate);
    } catch { /* fail open: transcript path missing */ }
  }
  if (!targetPath) {
    return {
      available: false,
      filesScanned: 0,
      totalSteps: 0,
      compactions: 0,
      orphanToolCalls: 0,
      failedToolCalls: 0,
      topFailureClusters: [],
    };
  }
  const sig = `${targetPath}:${statMtimeToken(targetPath)}:${childSig}`;
  const cached = forensicsCache.get(rootKey);
  if (cached && cached.sig === sig) {
    return cached.value;
  }
  let value = {
    available: false,
    filesScanned: 0,
    totalSteps: 0,
    compactions: 0,
    orphanToolCalls: 0,
    failedToolCalls: 0,
    topFailureClusters: [],
  };
  try {
    const res = scanSessionTranscripts(targetPath);
    value = {
      available: Boolean(res?.ok && Number(res.filesScanned || 0) > 0),
      filesScanned: Number(res?.filesScanned || 0),
      totalSteps: Number(res?.totalSteps || 0),
      compactions: Number(res?.compactions || 0),
      orphanToolCalls: Number(res?.orphanToolCalls || 0),
      failedToolCalls: Number(res?.failedToolCalls || 0),
      topFailureClusters: Array.isArray(res?.topFailureClusters)
        ? res.topFailureClusters.slice(0, 6).map((c) => ({
            tool: String(c.tool || 'unknown'),
            signature: redactSecrets(String(c.signature || '')),
            count: Number(c.count || 0),
          }))
        : [],
    };
  } catch { /* fail open: session transcript scan failed */ }
  setBoundedCache(forensicsCache, rootKey, { sig, value });
  return value;
}

export function readNotificationBooleans(primaryRoot) {
  const rootKey = path.resolve(primaryRoot);
  const globalNotif = readJsonSafe(path.join(defaultPluginDataDir(), 'notifications.json')) || {};
  const notifData = readJsonSafe(path.join(rootKey, '.omagy', 'notifications.json')) || {};
  const cfgData = readJsonSafe(path.join(rootKey, '.omagy', 'config.json')) || {};
  const cfgNotif = (cfgData && typeof cfgData.notifications === 'object' && cfgData.notifications) ? cfgData.notifications : {};
  const isEnabled = (channel) => {
    const localVal = notifData[channel];
    const cfgVal = cfgNotif[channel];
    const globalVal = globalNotif[channel];
    if (localVal === false || localVal?.enabled === false) return false;
    if (localVal === true || localVal?.enabled === true) return true;
    if (cfgVal === true || cfgVal?.enabled === true) return true;
    return Boolean(globalVal === true || globalVal?.enabled === true);
  };
  return {
    slack: isEnabled('slack'),
    discord: isEnabled('discord'),
    telegram: isEnabled('telegram'),
    webhook: isEnabled('webhook'),
    command: isEnabled('command'),
  };
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
    const isPaused = Boolean(data.paused === true && !isTerminal);
    const awaitingConfirmation = isAwaitingConfirmation({ data, mtimeMs: st.mtimeMs });
    const isStale = Boolean(data.active === true && !isTerminal && !awaitingConfirmation && !isPaused && Date.now() - updatedMs > STALE_MS);
    out.push({
      mode: String(data.mode || m[1]),
      active: data.active === true && !isTerminal && !isPaused,
      paused: isPaused,
      pausedAt: isPaused ? String(data.paused_at || '') : '',
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

function readAllScopeModes(stateDir, scopeLabel = '.', maxSessions = 0) {
  const scopePrefix = scopeLabel && scopeLabel !== '.' ? `${scopeLabel}/` : '';
  const out = [...readModeFilesInDir(stateDir, `${scopePrefix}shared`, scopeLabel)];
  const sessionsDir = path.join(stateDir, 'sessions');
  try {
    if (fs.existsSync(sessionsDir) && !fs.lstatSync(sessionsDir).isSymbolicLink()) {
      let entries = fs.readdirSync(sessionsDir).map((name) => {
        const p = path.join(sessionsDir, name);
        try {
          const st = fs.lstatSync(p);
          return st.isDirectory() && !st.isSymbolicLink() ? { name, path: p, mtimeMs: st.mtimeMs } : null;
        } catch { /* fail open: skip unreadable session entry */ return null; }
      }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (maxSessions > 0) entries = entries.slice(0, maxSessions);
      for (const sess of entries) {
        out.push(...readModeFilesInDir(sess.path, `${scopePrefix}${sess.name.slice(0, 12)}`, scopeLabel));
      }
    }
  } catch { /* fail open: sessions directory unavailable */ }
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
        const skillDir = path.join(skillsDir, dirName);
        if (fs.lstatSync(skillDir).isSymbolicLink()) continue;
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile) || fs.lstatSync(skillFile).isSymbolicLink()) continue;
        const raw = readTextSafe(skillFile, 24 * 1024);
        if (!raw) continue;
        const { meta } = parseFrontmatter(raw);
        const name = String(meta?.name || dirName).trim();
        const rawDesc = String(meta?.description || '').replace(/^\[oh-my-agy\]\s*/i, '').trim();
        const guide = SKILL_GUIDE_META[name] || {};
        let references = [];
        try {
          const refsDir = path.join(skillDir, 'references');
          if (fs.existsSync(refsDir) && !fs.lstatSync(refsDir).isSymbolicLink() && fs.statSync(refsDir).isDirectory()) {
            references = fs.readdirSync(refsDir)
              .filter((f) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.md$/.test(f))
              .filter((f) => {
                const rf = path.join(refsDir, f);
                return !fs.lstatSync(rf).isSymbolicLink() && fs.statSync(rf).isFile();
              })
              .sort()
              .map((f) => `references/${f}`);
          }
        } catch { /* fail open: optional references scan failed */ }
        skills.push({
          name,
          dir: dirName,
          file: `skills/${dirName}/SKILL.md`,
          references,
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

export function resolveSafeSkillDoc(pluginRoot = PLUGIN_ROOT, skillKey = '', refRel = '') {
  try {
    const cleanSkill = String(skillKey || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(cleanSkill)) return null;

    const cleanRef = String(refRel || '').trim().replace(/^\.\//, '');
    let targetSubRel = 'SKILL.md';
    if (cleanRef && cleanRef !== 'SKILL.md') {
      if (!/^references\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.md$/.test(cleanRef)) return null;
      targetSubRel = cleanRef;
    }

    const skillsDir = path.join(pluginRoot, 'skills');
    if (!fs.existsSync(skillsDir) || fs.lstatSync(skillsDir).isSymbolicLink() || !fs.statSync(skillsDir).isDirectory()) {
      return null;
    }
    const skillsRootReal = canonicalizePath(skillsDir);

    let skillDir = path.join(skillsDir, cleanSkill);
    const isValidSkillDir = (dirCandidate) => (
      fs.existsSync(dirCandidate)
      && !fs.lstatSync(dirCandidate).isSymbolicLink()
      && fs.statSync(dirCandidate).isDirectory()
    );
    if (!isValidSkillDir(skillDir)) {
      skillDir = '';
      const subDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const dName of subDirs) {
        const probeDir = path.join(skillsDir, dName);
        if (!isValidSkillDir(probeDir)) continue;
        const probeSkillMd = path.join(probeDir, 'SKILL.md');
        if (!fs.existsSync(probeSkillMd) || fs.lstatSync(probeSkillMd).isSymbolicLink()) continue;
        const raw = readTextSafe(probeSkillMd, 8 * 1024);
        if (!raw) continue;
        const { meta } = parseFrontmatter(raw);
        if (String(meta?.name || '').trim() === cleanSkill) {
          skillDir = probeDir;
          break;
        }
      }
      if (!skillDir) return null;
    }

    if (targetSubRel.startsWith('references/')) {
      const refsDir = path.join(skillDir, 'references');
      if (!fs.existsSync(refsDir) || fs.lstatSync(refsDir).isSymbolicLink() || !fs.statSync(refsDir).isDirectory()) {
        return null;
      }
    }

    const candidate = path.join(skillDir, targetSubRel);
    if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink() || !fs.statSync(candidate).isFile()) {
      return null;
    }

    const candidateReal = canonicalizePath(candidate);
    if (!candidateReal.startsWith(`${skillsRootReal}${path.sep}`)) return null;

    const skillDirName = path.basename(skillDir);
    return {
      filePath: candidateReal,
      skillDirName,
      relPath: `skills/${skillDirName}/${targetSubRel}`,
      mime: 'text/plain; charset=utf-8',
    };
  } catch { /* fail open: invalid or unreadable skill doc path */
    return null;
  }
}

/**
 * Resolve ordered active conversation candidates filtered by host, workspace, and Antigravity brain dir.
 */
export function resolveActiveConversationCandidates(workspaceRoot = process.cwd(), explicitId = '', options = {}) {
  const validIdRe = /^[a-zA-Z0-9_-]{6,80}$/;
  const host = String(options?.host || 'antigravity').trim().toLowerCase() || 'antigravity';
  const runtimeDir = options?.runtimeDir || defaultRuntimeDir();
  const effectiveBrainDir = host === 'antigravity' ? resolveAntigravityBrainDir(options?.brainDir) : '';
  const targetRoots = Array.isArray(options?.workspaceRoots) && options.workspaceRoots.length
    ? options.workspaceRoots
    : (() => {
      const p = uriToFsPath(workspaceRoot) || String(workspaceRoot || '').trim();
      return p ? [p] : [];
    })();

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (rawId) => {
    const id = String(rawId || '').trim();
    if (!id || !validIdRe.test(id) || seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };

  pushCandidate(explicitId);

  try {
    const targetRtDir = path.resolve(String(runtimeDir || defaultRuntimeDir()));
    const scanDir = (dirPath) => {
      const routingFiles = listSecureRoutingEntries(dirPath).filter((r) => validIdRe.test(r.id));
      const matched = [];
      const unscoped = [];
      for (const rf of routingFiles) {
        const data = readJsonSafe(rf.path);
        if (!data || data.isSubagent === true) continue;
        if (!isRoutingHostCompatible(data, host, rf.id, effectiveBrainDir)) continue;
        const workspaces = Array.isArray(data.workspaces) ? data.workspaces.map(String).filter(Boolean) : [];
        const wsMatch = routingMatchesWorkspaces(workspaces, targetRoots);
        if (wsMatch === 'mismatch') continue;
        if (wsMatch === 'match') matched.push(rf.id);
        else unscoped.push(rf.id);
      }
      return [...matched, ...unscoped];
    };
    const primaryHits = scanDir(targetRtDir);
    if (primaryHits.length > 0) {
      for (const id of primaryHits) pushCandidate(id);
    } else {
      const legacyDir = resolveLegacyRoutingDirIfEligible(options?.runtimeDir, targetRtDir);
      if (legacyDir) {
        for (const id of scanDir(legacyDir)) pushCandidate(id);
      }
    }
  } catch { /* fail open: runtime directory unavailable */ }

  try {
    const stateRoot = resolveStateRoot(uriToFsPath(workspaceRoot) || workspaceRoot || process.cwd());
    const records = readAllScopeModes(path.join(stateRoot, '.omagy', 'state'), '.');
    const sorted = records
      .filter((r) => validIdRe.test(r.owner))
      .sort((a, b) => b.updatedMs - a.updatedMs);
    for (const r of sorted) {
      if (effectiveBrainDir) {
        try {
          const st = fs.lstatSync(path.join(effectiveBrainDir, r.owner));
          if (!st.isDirectory() || st.isSymbolicLink()) continue;
        } catch { /* fail open: skip state owner absent from antigravity brain directory */
          continue;
        }
      }
      pushCandidate(r.owner);
    }
  } catch { /* fail open: state directory unavailable */ }

  if (effectiveBrainDir) {
    try {
      const brainEntries = fs.readdirSync(effectiveBrainDir)
        .filter((name) => name && !name.startsWith('.') && !name.startsWith('tempmedia') && validIdRe.test(name))
        .map((name) => {
          const dirPath = path.join(effectiveBrainDir, name);
          try {
            const st = fs.lstatSync(dirPath);
            if (!st.isDirectory() || st.isSymbolicLink()) return null;
            let sortMs = st.mtimeMs;
            try {
              const txStat = fs.lstatSync(path.join(dirPath, '.system_generated', 'logs', 'transcript.jsonl'));
              if (txStat.isFile() && !txStat.isSymbolicLink()) sortMs = txStat.mtimeMs;
            } catch { /* fail open: fallback to brain directory mtime when transcript is absent */ }
            return { id: name, mtimeMs: sortMs };
          } catch { /* fail open: skip unreadable brain directory entry */
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 8);
      for (const entry of brainEntries) pushCandidate(entry.id);
    } catch { /* fail open: antigravity brain directory scan unavailable */ }
  }

  return candidates;
}

export function resolveActiveConversationId(workspaceRoot = process.cwd(), explicitId = '', options = {}) {
  return resolveActiveConversationCandidates(workspaceRoot, explicitId, options)[0] || '';
}

function resolveAgentApiBinary() {
  if (process.env.OMAGY_AGENTAPI_BIN) {
    return { bin: process.env.OMAGY_AGENTAPI_BIN, prefixArgs: [] };
  }
  const envExe = String(process.env.ANTIGRAVITY_AGENTAPI_EXE || '').trim();
  if (envExe && fs.existsSync(envExe)) {
    return { bin: envExe, prefixArgs: ['agentapi'] };
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

function validateDispatchRequest(payload = {}, options = {}) {
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

  return { ok: true, mode, rawPrompt, pluginRoot, workspaceRoot, agentName, cliModel };
}

export function dispatchHudAction(payload = {}, options = {}) {
  const reqCheck = validateDispatchRequest(payload, options);
  if (!reqCheck.ok) return reqCheck;
  const { mode, rawPrompt, workspaceRoot, agentName, cliModel } = reqCheck;
  if (mode === 'new-chat' || mode === 'subagent-standalone') {
    return { ok: false, status: 400, error: `Unsupported Antigravity dispatch mode: ${mode}` };
  }

  const handoffToClipboard = (promptText, extra = {}) => {
    const clip = copyToSystemClipboard(promptText, options);
    return {
      ok: true,
      status: 200,
      modeUsed: 'clipboard-handoff',
      requestedMode: mode,
      fallback: true,
      clipboardPrompt: promptText,
      clipboardText: promptText,
      copiedToClipboard: Boolean(clip.copied),
      clipboardCopied: Boolean(clip.copied),
      clipboardMethod: clip.method,
      ...extra,
    };
  };

  const { bin, prefixArgs } = resolveAgentApiBinary();
  const runner = typeof options.runner === 'function'
    ? options.runner
    : (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

  const invokeAgentApi = (subArgs) => {
    const fullArgs = [...prefixArgs, ...subArgs];
    const out = runner(bin, fullArgs);
    return { command: bin, args: subArgs, output: String(out || '').trim() };
  };

  try {
    const explicitConvId = String(payload?.conversationId || '').trim();
    const resolveTargetConv = () => {
      const targetWs = uriToFsPath(workspaceRoot) || String(workspaceRoot || '').trim();
      const candidates = resolveActiveConversationCandidates(workspaceRoot, explicitConvId, {
        host: 'antigravity',
        workspaceRoots: targetWs ? [targetWs] : [],
      });
      return verifyAntigravityTargetConversation({
        candidates,
        explicitId: explicitConvId,
        workspaceRoots: targetWs ? [targetWs] : [],
        invoke: (args) => invokeAgentApi(args),
      });
    };

    if (mode === 'active-chat') {
      const convId = resolveTargetConv();
      const title = makeDispatchTitle('HUD', rawPrompt);
      if (convId) {
        try {
          const res = invokeAgentApi(['send-message', `--title=${title}`, '--', convId, rawPrompt]);
          return { ok: true, status: 200, modeUsed: 'active-chat', conversationId: convId, fallback: false, ...res };
        } catch { /* fail open: fall through to clipboard handoff when active conversation is closed */
          // Fall through to clipboard handoff if send-message fails on a closed/stale conversation.
        }
      }
      return handoffToClipboard(rawPrompt);
    }

    // mode === 'subagent-active'
    const modelLabel = cliModel || 'inherit';
    const delegationPrompt = `Use invoke_subagent with TypeName="${agentName}" and Model="${modelLabel}" to complete this task: ${rawPrompt}`;
    const title = makeDispatchTitle(agentName, rawPrompt);
    const convId = resolveTargetConv();
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
      } catch { /* fail open: fall through to clipboard handoff when active conversation is unreachable */
        // Fall through to clipboard handoff if active conversation is unreachable.
      }
    }
    return handoffToClipboard(delegationPrompt, { agent: agentName, model: modelLabel });
  } catch (err) { /* fail open: return 500 JSON when agentapi execution throws */
    return {
      ok: false,
      status: 500,
      error: redactSecrets(String(err?.message || err || 'Failed to invoke agentapi')),
    };
  }
}

/** Dispatch validated HUD actions across Antigravity (sync) or Claude/Codex Desktop transports. */
export async function dispatchHudActionAsync(payload = {}, options = {}) {
  const rawOptHost = String(options.host || '').trim().toLowerCase();
  const host = ALLOWED_HUD_HOSTS.has(rawOptHost) ? rawOptHost : normalizeExplicitHudHost(payload?.host);
  if (host === 'antigravity') {
    return dispatchHudAction(payload, options);
  }
  const reqCheck = validateDispatchRequest(payload, options);
  if (!reqCheck.ok) return reqCheck;
  const normPrompt = normalizeHostPromptSigil(reqCheck.rawPrompt, host, options.skillSlugs ? new Set(options.skillSlugs) : undefined);
  const effectivePrompt = reqCheck.mode === 'subagent-active'
    ? `Use ${reqCheck.agentName} subagent (${reqCheck.cliModel || 'inherit'}) to complete this task: ${normPrompt}`
    : normPrompt;
  return dispatchDesktopHostAction(
    {
      host,
      mode: reqCheck.mode,
      rawPrompt: normPrompt,
      workspaceRoot: reqCheck.workspaceRoot,
      agentName: reqCheck.agentName,
      cliModel: reqCheck.cliModel,
      effectivePrompt,
    },
    payload,
    options,
  );
}

/** Execute authenticated HUD workflow pause/resume control on server-vetted workspace/scope roots. */
export async function handleWorkflowControl(payload = {}, options = {}) {
  const action = String(payload?.action || '').trim().toLowerCase();
  if (action !== 'pause' && action !== 'resume') {
    return { ok: false, status: 400, error: `Invalid workflow control action: ${action || '(empty)'}` };
  }
  const rawVetted = Array.isArray(options.vettedRoots) && options.vettedRoots.length
    ? options.vettedRoots
    : (options.workspaceRoot ? [options.workspaceRoot] : []);
  const vettedBases = [];
  const seenBases = new Set();
  for (const r of rawVetted) {
    const fsPath = uriToFsPath(r) || String(r || '').trim();
    if (!fsPath) continue;
    const abs = path.resolve(fsPath);
    const canon = canonicalizePath(abs);
    if (!seenBases.has(canon)) {
      seenBases.add(canon);
      vettedBases.push({ abs, canon });
    }
  }
  if (!vettedBases.length) {
    return { ok: false, status: 400, error: 'no_vetted_workspace' };
  }

  let selectedBase = vettedBases[0];
  const rawWs = String(payload?.workspace || '').trim();
  if (rawWs) {
    const wsFs = uriToFsPath(rawWs) || rawWs;
    const wsCanon = canonicalizePath(path.resolve(wsFs));
    let matched = vettedBases.find((b) => b.canon === wsCanon);
    if (!matched) {
      for (const b of vettedBases) {
        const scHit = discoverOmagyScopes(b.abs, 3, 150).find((sc) => canonicalizePath(sc.root) === wsCanon);
        if (scHit) { matched = { abs: path.resolve(scHit.root), canon: wsCanon }; break; }
      }
    }
    if (!matched) return { ok: false, status: 403, error: 'forbidden_workspace' };
    selectedBase = matched;
  }

  const rawScope = String(payload?.scope || '').trim().replace(/\\/g, '/');
  let targetRoots = [selectedBase.abs];
  if (rawScope && rawScope !== '.') {
    if (rawScope === 'all') {
      const childScopes = discoverOmagyScopes(selectedBase.abs, 3, 150);
      const extras = [];
      for (const sc of childScopes) {
        const scRoot = path.resolve(sc.root);
        if (canonicalizePath(scRoot) === selectedBase.canon) continue;
        const scModes = readAllScopeModes(path.join(scRoot, '.omagy', 'state'), sc.scope);
        if (action === 'pause') {
          if (scModes.some((m) => m.active && !m.stale)) extras.push(scRoot);
        } else if (readPauseState([scRoot]).paused || scModes.some((m) => m.paused)) {
          extras.push(scRoot);
        }
      }
      targetRoots = [selectedBase.abs, ...extras];
    } else {
      if (path.isAbsolute(rawScope) || rawScope.includes('\0') || rawScope.split('/').some((s) => s === '..')) {
        return { ok: false, status: 400, error: 'invalid_scope' };
      }
      const normScope = rawScope.replace(/^\/+|\/+$/g, '');
      const scMatch = discoverOmagyScopes(selectedBase.abs, 3, 150).find((sc) => String(sc.scope || '').replace(/\\/g, '/') === normScope);
      if (!scMatch) return { ok: false, status: 403, error: 'forbidden_scope' };
      targetRoots = [path.resolve(scMatch.root)];
    }
  }

  if (action === 'pause') {
    const pausedModes = [];
    let pausedAt = '';
    let alreadyPaused = true;
    for (const r of targetRoots) {
      const res = pauseWorkspaceExecution(r, { source: 'hud', reason: payload?.reason || 'Paused via oh-my-agy HUD' });
      if (!res.ok) return { ok: false, status: 400, error: res.error || 'pause_failed' };
      if (!pausedAt && res.pausedAt) pausedAt = res.pausedAt;
      if (!res.alreadyPaused) alreadyPaused = false;
      pausedModes.push(...(res.pausedModes || []));
    }
    return { ok: true, status: 200, action: 'pause', alreadyPaused, pausedAt, pausedModes };
  }

  const resumedModes = [];
  let wasPaused = false;
  let resumedAt = '';
  for (const r of targetRoots) {
    const res = resumeWorkspaceExecution(r, { source: 'hud' });
    if (!res.ok) return { ok: false, status: 400, error: res.error || 'resume_failed' };
    if (res.wasPaused) wasPaused = true;
    if (!resumedAt && res.resumedAt) resumedAt = res.resumedAt;
    resumedModes.push(...(res.resumedModes || []));
  }
  let dispatch = null;
  if (payload?.dispatchResume !== false) {
    dispatch = await dispatchHudActionAsync(
      {
        mode: 'active-chat',
        prompt: 'continue',
        workspace: targetRoots[0],
        conversationId: payload?.conversationId,
      },
      { ...options, workspaceRoot: targetRoots[0] },
    );
  }
  return {
    ok: true,
    status: 200,
    action: 'resume',
    wasPaused,
    resumedAt,
    resumedModes,
    dispatch,
    ...(dispatch && dispatch.modeUsed === 'clipboard-handoff' ? {
      modeUsed: dispatch.modeUsed,
      clipboardPrompt: dispatch.clipboardPrompt,
      copiedToClipboard: dispatch.copiedToClipboard,
    } : {}),
  };
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

export function resolveWorkspaceRoots(rawWorkspaces = [], fallbackWorkspaceRoot = '', preferredRoot = '') {
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
  if (!candidates.length && path.resolve(process.cwd()) === SIDECAR_DIR) {
    const latestWs = readLatestRouting()?.workspaces || [];
    for (const w of latestWs) {
      if (typeof w === 'string' && path.isAbsolute(w) && fs.existsSync(w)) candidates.push(w);
    }
  }
  if (!candidates.length && fs.existsSync(process.cwd())) {
    candidates.push(process.cwd());
  }
  const roots = [...new Set(candidates.map(resolveStateRoot))];
  let primaryRoot = roots[0] || process.cwd();
  const rawPref = typeof preferredRoot === 'string' ? preferredRoot.trim() : '';
  if (!rawPref && roots.length > 1 && !fs.existsSync(path.join(primaryRoot, '.omagy'))) {
    primaryRoot = roots.find((r) => fs.existsSync(path.join(r, '.omagy', 'state')))
      || roots.find((r) => fs.existsSync(path.join(r, '.omagy')))
      || primaryRoot;
  }
  if (rawPref) {
    const prefFs = uriToFsPath(rawPref) || (path.isAbsolute(rawPref) ? rawPref : '');
    if (prefFs) {
      const prefReal = canonicalizePath(prefFs);
      const matched = roots.find((r) => r === prefFs || canonicalizePath(r) === prefReal);
      if (matched) primaryRoot = matched;
    }
  }
  return { roots, primaryRoot };
}

export function buildHudSnapshot(rawWorkspaces = [], nowMs = Date.now(), preferredRoot = '', extraOpts = {}) {
  const { roots, primaryRoot } = resolveWorkspaceRoots(rawWorkspaces, '', preferredRoot);
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
    const stateDir = path.join(sc.root, '.omagy', 'state');
    for (const m of readAllScopeModes(stateDir, sc.scope, 5)) {
      const k = `${sc.root}:${m.session}:${m.mode}`;
      if (!seenModeKeys.has(k)) { seenModeKeys.add(k); allModeRecords.push(m); }
    }
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
    const relPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
    const briefPath = fs.existsSync(path.join(sc.root, '.omagy', 'ultragoal', 'brief.md')) ? `${relPrefix}.omagy/ultragoal/brief.md` : '';
    const notepadPath = fs.existsSync(path.join(sc.root, '.omagy', 'ultragoal', 'notepad.md')) ? `${relPrefix}.omagy/ultragoal/notepad.md` : '';
    const goals = goalsData.goals.map((g) => {
      const gid = String(g.id || '');
      const evFile = gid && fs.existsSync(path.join(sc.root, '.omagy', 'evidence', `goal-${gid}.json`))
        ? `${relPrefix}.omagy/evidence/goal-${gid}.json`
        : '';
      return {
        id: gid,
        title: String(g.title || g.objective || ''),
        rigor: String(g.rigor || 'light'),
        status: String(g.status || 'pending'),
        dependsOn: Array.isArray(g.depends_on) ? g.depends_on : [],
        productFailures: Number(g.product_failures || 0),
        evidencePath: evFile,
      };
    });
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
      briefPath,
      notepadPath,
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
          const dirSt = fs.lstatSync(dir, { throwIfNoEntry: false });
          if (!dirSt || dirSt.isSymbolicLink() || !dirSt.isDirectory()) continue;
          const tasksFile = path.join(dir, 'tasks.json');
          const manifestFile = path.join(dir, 'manifest.json');
          const tasksSt = fs.lstatSync(tasksFile, { throwIfNoEntry: false });
          const manifestSt = fs.lstatSync(manifestFile, { throwIfNoEntry: false });
          const safeTasksFile = tasksSt && tasksSt.isFile() && !tasksSt.isSymbolicLink() ? tasksFile : '';
          const safeManifestFile = manifestSt && manifestSt.isFile() && !manifestSt.isSymbolicLink() ? manifestFile : '';
          const board = (safeTasksFile ? readJsonSafe(safeTasksFile) : null) || (safeManifestFile ? readJsonSafe(safeManifestFile) : null);
          if (!board || typeof board !== 'object') continue;
          const tasks = Array.isArray(board.tasks) ? board.tasks : [];
          const updatedMs = Date.parse(board.updated_at || '') || 0;
          const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'completed' || t.status === 'complete');
          if (allDone && updatedMs > 0 && nowMs - updatedMs > TEAM_COMPLETED_WINDOW_MS) continue;
          const teamPrefix = sc.scope && sc.scope !== '.' ? `${sc.scope}/` : '';
          teams.push({
            team: String(board.team || slug),
            scope: sc.scope,
            objective: String(board.objective || ''),
            updatedAt: String(board.updated_at || ''),
            tasks: tasks.map((t) => {
              const evExists = fs.existsSync(path.join(sc.root, '.omagy', 'evidence', `task-${t.id}.json`));
              return {
                id: String(t.id || ''),
                title: String(t.title || ''),
                role: String(t.role || 'executor'),
                model: String(t.model || 'inherit'),
                status: String(t.status || 'pending'),
                dependsOn: Array.isArray(t.depends_on) ? t.depends_on : (Array.isArray(t.dependsOn) ? t.dependsOn : []),
                requiresCodeChange: Boolean(t.requires_code_change),
                hasEvidence: evExists,
                evidencePath: evExists ? `${teamPrefix}.omagy/evidence/task-${t.id}.json` : '',
              };
            }),
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
  const isRalplanReviewArtifact = (p) => /(?:^|\/)(?:ralplan-(?:review|receipt)-|hyperplan-distillation-)[^/]+$/i.test(String(p || ''));
  const inferRalplanSlug = (p) => {
    const base = String(p || '').split('/').pop() || '';
    const m = /^(?:prd|test-spec|ralplan-review|ralplan-receipt)-(.+)\.(?:md|json)$/i.exec(base);
    return m ? m[1] : '';
  };
  let activeRalplanSlug = '';
  const rpRecord = allModeRecords.find((m) => m.mode === 'ralplan')
    || allModeRecords.find((m) => m.mode === 'autopilot' && (m.raw?.state?.ralplan || m.raw?.state?.handoff_artifacts?.ralplan || m.raw?.handoff_artifacts?.ralplan));
  if (rpRecord) {
    const rpSub = (rpRecord.raw?.state?.ralplan && typeof rpRecord.raw.state.ralplan === 'object') ? rpRecord.raw.state.ralplan : {};
    const hoRaw = rpRecord.raw?.state?.handoff_artifacts?.ralplan || rpRecord.raw?.handoff_artifacts?.ralplan;
    const ho = (hoRaw && typeof hoRaw === 'object') ? hoRaw : (Object.keys(rpSub).length ? rpSub : (rpRecord.raw?.state || {}));
    const rpScope = rpRecord.scope || '.';
    const rpPrefix = rpScope !== '.' ? `${rpScope}/` : '';
    const rpRoot = scopeEntries.find((sc) => sc.scope === rpScope)?.root || primaryRoot;
    const toCleanRel = (p) => {
      const s = String(p || '').trim();
      if (!s) return '';
      if (path.isAbsolute(s) && rpRoot) {
        const rel = path.relative(rpRoot, s).replace(/\\/g, '/');
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
      }
      return s.replace(/^\/+/, '');
    };
    const toScopedRel = (p) => {
      const clean = toCleanRel(p);
      return clean && rpPrefix && !clean.startsWith(rpPrefix) && clean.startsWith('.omagy/') ? `${rpPrefix}${clean}` : clean;
    };
    const stripScope = (p) => (rpPrefix && p.startsWith(rpPrefix) ? p.slice(rpPrefix.length) : p);
    const rcPath = toCleanRel(ho.receipt_path || rpSub.receipt_path || '');
    const safeRc = rcPath ? resolveSafeArtifactFile(rpRoot, stripScope(rcPath)) : null;
    const rcJson = (safeRc && safeRc.filePath.endsWith('.json')) ? (readJsonSafe(safeRc.filePath) || {}) : {};
    activeRalplanSlug = String(
      rpSub.slug || ho.slug || rcJson.slug || rpRecord.raw?.state?.slug
      || inferRalplanSlug(ho.prd_path || rpSub.prd_path || ho.review_path || rpSub.review_path || ho.review_log_path || rpSub.review_log_path || rcPath)
      || '',
    ).trim();
    const combinedArts = [...new Set([
      ...(Array.isArray(ho.planning_artifacts) ? ho.planning_artifacts : []),
      ...(Array.isArray(rpSub.planning_artifacts) ? rpSub.planning_artifacts : []),
      ...(Array.isArray(rcJson.planning_artifacts) ? rcJson.planning_artifacts : []),
      ho.prd_path, rpSub.prd_path, rcJson.prd_path,
      ho.test_spec_path, rpSub.test_spec_path, rcJson.test_spec_path,
      ho.review_path, rpSub.review_path, rcJson.review_path,
      ho.review_log_path, rpSub.review_log_path, rcJson.review_log_path,
      rcPath,
    ].map(toScopedRel).filter(Boolean))];
    const reviewArts = [...new Set([
      ho.review_path, rpSub.review_path, rcJson.review_path,
      ho.review_log_path, rpSub.review_log_path, rcJson.review_log_path,
      rcPath,
      ...combinedArts.filter(isRalplanReviewArtifact),
    ].map(toScopedRel).filter(Boolean))];
    const revMdRel = toCleanRel(ho.review_path || rpSub.review_path || rcJson.review_path || ho.review_log_path || rpSub.review_log_path || '');
    const safeRevMd = (revMdRel && revMdRel.endsWith('.md')) ? resolveSafeArtifactFile(rpRoot, stripScope(revMdRel)) : null;
    const revMdText = safeRevMd ? readTextSafe(safeRevMd.filePath) : '';
    const revArch = revMdText ? (/architect[^\n:]*:\s*`?(APPROVE|CLEAR|WATCH|BLOCK|ITERATE|REJECT)`?/i.exec(revMdText)?.[1] || '') : '';
    const revCrit = revMdText ? (/critic[^\n:]*:\s*`?(APPROVE|ITERATE|REJECT)`?/i.exec(revMdText)?.[1] || '') : '';
    const archVerdict = String(
      ho.ralplan_architect_review?.verdict || rpSub.ralplan_architect_review?.verdict
      || ho.architect_verdict || rpSub.architect_verdict || rcJson.architect_verdict
      || ho.ralplan_execution_handoff?.architect_status || rpSub.architect_status || rcJson.architect_status
      || (revArch ? revArch.toUpperCase() : '')
      || ho.verdict || rpSub.verdict || rcJson.verdict
      || 'pending',
    );
    const critVerdict = String(
      ho.ralplan_critic_review?.verdict || rpSub.ralplan_critic_review?.verdict
      || ho.critic_verdict || rpSub.critic_verdict || rcJson.critic_verdict
      || ho.ralplan_execution_handoff?.critic_verdict || rpSub.critic_status || rcJson.critic_status
      || (revCrit ? revCrit.toUpperCase() : '')
      || ho.verdict || rpSub.verdict || rcJson.verdict
      || 'pending',
    );
    const consensusDone = Boolean(
      ho.ralplan_consensus_gate?.complete ?? rpSub.ralplan_consensus_gate?.complete
      ?? ho.consensus_complete ?? rpSub.consensus_complete ?? rcJson.consensus_complete
      ?? ho.ralplan_execution_handoff?.authorized
      ?? (critVerdict.toUpperCase() === 'APPROVE'),
    );
    const execAuth = Boolean(
      ho.ralplan_execution_handoff?.authorized
      ?? ho.execution_authorized ?? rpSub.execution_authorized ?? rcJson.execution_authorized
      ?? consensusDone,
    );
    const rpPhaseRaw = String(rpRecord.phase || '');
    const inPlanPhase = ['ralplan', 'ralplan_gate', 'plan', 'planning'].includes(rpPhaseRaw.toLowerCase());
    reviews.ralplan = {
      scope: rpScope,
      active: rpRecord.mode === 'autopilot' ? (rpRecord.active && inPlanPhase) : rpRecord.active,
      phase: (rpRecord.mode === 'autopilot' && !inPlanPhase && consensusDone) ? 'complete' : rpRecord.phase,
      iteration: Number(rpSub.iteration ?? (ho !== rpRecord.raw?.state ? ho.iteration : undefined) ?? rcJson.iteration ?? rpRecord.iteration ?? 1),
      architectVerdict: archVerdict,
      criticVerdict: critVerdict,
      consensusComplete: consensusDone,
      executionAuthorized: execAuth,
      planningArtifacts: combinedArts,
      reviewArtifacts: reviewArts,
    };
  }
  const ralplanReviewCandidates = [];
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
          } else if (name.startsWith('ralplan-review-')) {
            const relFile = `${relPrefix}.omagy/plans/${name}`;
            const archMatch = /architect[^\n:]*:\s*`?(APPROVE|CLEAR|WATCH|BLOCK|ITERATE|REJECT)`?/i.exec(text);
            const critMatch = /critic[^\n:]*:\s*`?(APPROVE|ITERATE|REJECT)`?/i.exec(text);
            ralplanReviewCandidates.push({
              scope: sc.scope,
              relFile,
              slug: name.slice('ralplan-review-'.length, -3),
              mtimeMs: pst.mtimeMs,
              archVerdict: archMatch ? archMatch[1].toUpperCase() : '',
              critVerdict: critMatch ? critMatch[1].toUpperCase() : '',
            });
          } else {
            artifacts.plans.push({
              scope: sc.scope,
              file: `${relPrefix}.omagy/plans/${name}`,
              title: extractMarkdownTitle(text, name),
              updatedAt: planUpdatedAt,
            });
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
  if (ralplanReviewCandidates.length) {
    ralplanReviewCandidates.sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.relFile.localeCompare(a.relFile));
    if (!reviews.ralplan) {
      const latestRev = ralplanReviewCandidates[0];
      reviews.ralplan = {
        scope: latestRev.scope,
        active: false,
        phase: 'complete',
        iteration: 1,
        architectVerdict: latestRev.archVerdict || 'recorded',
        criticVerdict: latestRev.critVerdict || 'recorded',
        consensusComplete: latestRev.critVerdict === 'APPROVE',
        executionAuthorized: false,
        planningArtifacts: [latestRev.relFile],
        reviewArtifacts: [latestRev.relFile],
      };
    } else {
      const matchingRevs = ralplanReviewCandidates.filter((c) => (
        (c.scope || '.') === (reviews.ralplan.scope || '.')
        && (
          reviews.ralplan.planningArtifacts.includes(c.relFile)
          || reviews.ralplan.reviewArtifacts.includes(c.relFile)
          || (activeRalplanSlug && c.slug === activeRalplanSlug)
        )
      ));
      for (const mr of matchingRevs) {
        if (!reviews.ralplan.planningArtifacts.includes(mr.relFile)) {
          reviews.ralplan.planningArtifacts.push(mr.relFile);
        }
        if (!reviews.ralplan.reviewArtifacts.includes(mr.relFile)) {
          reviews.ralplan.reviewArtifacts.push(mr.relFile);
        }
        if (reviews.ralplan.architectVerdict === 'pending' && mr.archVerdict) {
          reviews.ralplan.architectVerdict = mr.archVerdict;
        }
        if (reviews.ralplan.criticVerdict === 'pending' && mr.critVerdict) {
          reviews.ralplan.criticVerdict = mr.critVerdict;
          if (reviews.ralplan.criticVerdict === 'APPROVE') reviews.ralplan.consensusComplete = true;
        }
      }
    }
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
          const summaryFile = path.join(dir, 'summary.md');
          const summaryText = readTextSafe(summaryFile, 16 * 1024);
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
            summaryPath: summaryText ? `${relPrefix}.omagy/goals/performance/${slug}/summary.md` : '',
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

  const wikiLog = [];
  const wikiLogPath = path.join(wikiDir, 'log.md');
  try {
    if (fs.existsSync(wikiLogPath) && !fs.lstatSync(wikiLogPath).isSymbolicLink()) {
      const logLines = readTextSafe(wikiLogPath, 32 * 1024)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-'));
      for (const rawLine of logLines.slice(-12).reverse()) {
        const clean = redactSecrets(rawLine.replace(/^-\s*/, '').trim());
        const dm = /\b(20\d{2}-\d{2}-\d{2}(?:T[^\s)\]]+)?)\b/.exec(clean);
        const sm = /\[\[([a-zA-Z0-9_-]+)(?:\|[^\]]+)?\]\]/.exec(clean);
        wikiLog.push({
          date: dm ? dm[1] : '',
          slug: sm ? sm[1] : '',
          summary: clean.slice(0, 220),
        });
      }
    }
  } catch { /* fail open: omagy_wiki/log.md unavailable */ }

  // 9. Quality gates & Doctor / Hook Diagnostics
  const qg = validateQualityGates(primaryRoot);
  const runtimeDir = defaultRuntimeDir();
  const latestRouting = readLatestRouting(runtimeDir, { host: normalizeExplicitHudHost(extraOpts?.host), roots });

  const hookErrorsFile = path.join(primaryRoot, '.omagy', 'logs', 'hook-errors.jsonl');
  let hookErrors = [];
  try {
    const errSt = fs.lstatSync(hookErrorsFile, { throwIfNoEntry: false });
    if (errSt && errSt.isFile() && !errSt.isSymbolicLink()) {
      hookErrors = readJsonlRecords(hookErrorsFile, { maxTailBytes: 65536 }).records.slice(-10).reverse().map((e) => ({
        at: String(e.at || ''),
        event: String(e.event || ''),
        error: redactSecrets(String(e.error || '')),
      }));
    }
  } catch { /* fail open: skip unreadable or symlinked hook-errors log */ }

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

  // 9.6 Design System Governance, Session Forensics, & Notification Channel Booleans
  const designSystem = getCachedDesignSystem(primaryRoot);
  const forensics = getCachedForensics(primaryRoot, latestRouting?.transcriptPath || '');
  const notifications = readNotificationBooleans(primaryRoot);

  // 9.7 Git Worktree Inventory (cached 5s / git-metadata keyed, scrubbed, fail-open [])
  const worktrees = getCachedWorktrees(primaryRoot, nowMs);

  // 10. Auto-discovered Plugin Catalog (Skills, Subagents, Workflows)
  const catalog = buildPluginCatalog(PLUGIN_ROOT, modes);

  // 10.5 Durable workspace pause state across primary and inner scopes
  const pauseStatesByScope = {};
  const absPrimaryRoot = path.resolve(primaryRoot);
  let primaryPauseState = { paused: false, pausedAt: '', source: '', reason: '', pausedModes: [], scope: '.' };
  let firstPausedScopeState = null;
  for (const sc of scopeEntries) {
    const pInfo = readPauseState([sc.root]);
    const pModes = pInfo.paused && Array.isArray(pInfo.data?.paused_modes)
      ? pInfo.data.paused_modes.map((pm) => ({ file: String(pm.file || ''), mode: String(pm.mode || ''), previousPhase: String(pm.previous_phase || 'unknown') }))
      : [];
    const entry = {
      paused: Boolean(pInfo.paused),
      pausedAt: pInfo.paused ? String(pInfo.data?.paused_at || '') : '',
      source: pInfo.paused ? String(pInfo.data?.source || 'hud') : '',
      reason: pInfo.paused ? String(pInfo.data?.reason || '') : '',
      pausedModes: pModes,
      scope: sc.scope,
    };
    if (!pauseStatesByScope[sc.scope] || (!pauseStatesByScope[sc.scope].paused && entry.paused)) {
      pauseStatesByScope[sc.scope] = entry;
    }
    if (sc.root === absPrimaryRoot) primaryPauseState = entry;
    if (entry.paused && !firstPausedScopeState) firstPausedScopeState = entry;
  }
  const pauseState = primaryPauseState.paused ? primaryPauseState : (firstPausedScopeState || primaryPauseState);

  // Minimal statusline string
  const activeModes = modes.filter((m) => m.active && !m.stale);
  const pausedModesList = modes.filter((m) => m.paused);
  const anyPaused = Boolean(pauseState.paused || pausedModesList.length);
  const minimalParts = (anyPaused ? pausedModesList : activeModes).map((m) => `${m.mode}:${m.phase}`);
  if (!anyPaused && ultragoal) minimalParts.push(`ultragoal:${ultragoal.counts.complete}/${ultragoal.counts.total}`);
  if (!anyPaused) {
    for (const t of teams) {
      const done = t.tasks.filter((x) => x.status === 'completed' || x.status === 'complete').length;
      minimalParts.push(`team:${t.team} ${done}/${t.tasks.length}`);
    }
  }
  const statusLine = anyPaused
    ? (minimalParts.length ? `[OMA] PAUSED | ${minimalParts.join(' | ')}` : '[OMA] PAUSED')
    : (minimalParts.length ? `[OMA] ${minimalParts.join(' | ')}` : '[OMA] No active modes');

  const snapshotPayload = {
    at: new Date(nowMs).toISOString(),
    workspace: primaryRoot,
    activeRoot: primaryRoot,
    workspaces: roots,
    trackedScopes,
    statusLine,
    pauseState,
    pauseStatesByScope,
    allowedViews: ALLOWED_VIEWS,
    host: normalizeExplicitHudHost(extraOpts?.host),
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
    designSystem,
    forensics,
    notifications,
    worktrees,
    wiki,
    wikiLog,
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

function parseCookieHeader(rawCookie) {
  const map = new Map();
  for (const part of String(rawCookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) map.set(k, v);
  }
  return map;
}

const NON_BROWSER_UA_RE = /^(?:curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|node|undici|axios|libwww|httpie|fetch|ruby|java|php)\b/i;

function isBrowserNavigationRequest(req) {
  const headers = req?.headers || {};
  const accept = String(headers.accept || '').toLowerCase();
  const ua = String(headers['user-agent'] || '').trim();
  const secSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  const secMode = String(headers['sec-fetch-mode'] || '').toLowerCase();
  const secDest = String(headers['sec-fetch-dest'] || '').toLowerCase();
  if (!accept.includes('text/html')) return false;
  if (!ua || NON_BROWSER_UA_RE.test(ua)) return false;
  if (!/(?:mozilla\/|applewebkit\/|chrome\/|safari\/|firefox\/|electron\/|codex|claude)/i.test(ua)) return false;
  if (secSite !== 'none' && secSite !== 'same-origin') return false;
  if (secMode !== 'navigate' || secDest !== 'document') return false;
  return true;
}

function hasHostileFetchMetadata(req) {
  const headers = req?.headers || {};
  const secSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  const secDest = String(headers['sec-fetch-dest'] || '').toLowerCase();
  if (secSite && secSite !== 'none' && secSite !== 'same-origin') return true;
  if (secDest && (secDest === 'iframe' || secDest === 'frame' || secDest === 'object' || secDest === 'embed')) return true;
  return false;
}

function verifySameUidLoopbackPeer(req, options = {}) {
  if (typeof options.sameUidVerifier === 'function') return Boolean(options.sameUidVerifier(req));
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') return true;
  const rPort = Number(req?.socket?.remotePort || 0);
  const lPort = Number(req?.socket?.localPort || 0);
  if (!rPort || !lPort) return false;
  const rHex = rPort.toString(16).toUpperCase().padStart(4, '0');
  const lHex = lPort.toString(16).toUpperCase().padStart(4, '0');
  const myUid = process.getuid();
  const loopbackHexIps = new Set(['0100007F', '00000000000000000000000001000000', '0000000000000000FFFF00000100007F']);
  const activeStates = new Set(['01', '04', '05', '08']);
  let procReadable = false;
  for (const procPath of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let raw = '';
    try {
      raw = fs.readFileSync(procPath, 'utf8');
      procReadable = true;
    } catch { /* fail open: procfs unavailable */ continue; }
    const lines = raw.split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 8 || !activeStates.has(String(cols[3] || '').toUpperCase())) continue;
      const [locIpRaw, locPRaw] = String(cols[1] || '').split(':');
      const [remIpRaw, remPRaw] = String(cols[2] || '').split(':');
      if (
        String(locPRaw || '').toUpperCase() === rHex
        && String(remPRaw || '').toUpperCase() === lHex
        && loopbackHexIps.has(String(locIpRaw || '').toUpperCase())
        && loopbackHexIps.has(String(remIpRaw || '').toUpperCase())
      ) {
        return Number(cols[7]) === myUid;
      }
    }
  }
  return !procReadable;
}

function isPathInsideBase(candidate, baseRoot) {
  if (!candidate || !baseRoot) return false;
  const realCand = canonicalizePath(candidate);
  const realBase = canonicalizePath(baseRoot);
  return realCand === realBase || realCand.startsWith(realBase + path.sep);
}

function clampDesktopWorkspaces(workspaces, pinnedRoot, activeRoot = '') {
  if (!pinnedRoot) return { workspaces, activeRoot };
  const kept = (Array.isArray(workspaces) ? workspaces : []).filter((w) => {
    const p = uriToFsPath(w) || (typeof w === 'string' && path.isAbsolute(w.trim()) ? w.trim() : '');
    return p && isPathInsideBase(p, pinnedRoot);
  });
  const clampedActive = activeRoot && isPathInsideBase(uriToFsPath(activeRoot) || activeRoot, pinnedRoot) ? activeRoot : '';
  return { workspaces: kept.length ? kept : [pinnedRoot], activeRoot: clampedActive };
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
  const hudHost = normalizeExplicitHudHost(options.host);
  const desktopServe = Boolean(options.desktopServe);
  const pinnedWorkspaceRoot = desktopServe && options.workspaceRoot ? path.resolve(options.workspaceRoot) : '';
  const debounceMs = Math.max(10, Number(options.debounceMs ?? 150));
  const sseHeartbeatMs = Math.max(25, Number(options.sseHeartbeatMs ?? 25000));
  const maxSseClients = Math.max(1, Number(options.maxSseClients ?? 2));
  const forceFlatWatch = Boolean(options.forceFlatWatch);
  const activeSseCleanups = new Set();
  const seenWorkspaceRoots = new Set();
  const recordSeenWorkspaces = (list) => {
    if (pinnedWorkspaceRoot || options.workspaceRoot) return;
    for (const w of Array.isArray(list) ? list : []) {
      const p = uriToFsPath(w) || String(w || '').trim();
      if (!p) continue;
      const abs = path.resolve(p);
      if (seenWorkspaceRoots.has(abs)) continue;
      if (seenWorkspaceRoots.size >= 32) {
        const oldest = seenWorkspaceRoots.values().next().value;
        if (oldest) seenWorkspaceRoots.delete(oldest);
      }
      seenWorkspaceRoots.add(abs);
    }
  };
  const sessionSecret = crypto.randomBytes(32);
  let activeDispatches = 0;
  const dispatchTimestamps = [];
  let cachedSkillSlugs = Array.isArray(options.skillSlugs) ? options.skillSlugs : null;
  const getSkillSlugs = () => {
    if (!cachedSkillSlugs) {
      cachedSkillSlugs = buildPluginCatalog(options.pluginRoot || PLUGIN_ROOT).skills.map((s) => s.name);
    }
    return cachedSkillSlugs;
  };

  const mintSessionCookie = () => {
    const ts = String(Date.now());
    const nonce = crypto.randomBytes(16).toString('hex');
    const sig = crypto.createHmac('sha256', sessionSecret).update(`${ts}.${nonce}`).digest('hex');
    return `omagy_hud_sess=${ts}.${nonce}.${sig}; HttpOnly; SameSite=Strict; Path=/`;
  };

  const verifySessionCookie = (req) => {
    const raw = parseCookieHeader(req.headers.cookie).get('omagy_hud_sess');
    if (!raw) return false;
    const parts = raw.split('.');
    if (parts.length !== 3) return false;
    const [ts, nonce, sig] = parts;
    const issuedAt = Number(ts);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 12 * 3600 * 1000 || issuedAt > Date.now() + 60_000) {
      return false;
    }
    if (!/^[a-f0-9]{32}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(sig)) return false;
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(`${ts}.${nonce}`).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer((req, res) => {
    let reqUrl;
    try {
      reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    } catch { /* fail open: reject malformed request URL cleanly without crashing server */
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: false, error: 'bad_request_url' }));
      return;
    }
    if (typeof options.onActivity === 'function') {
      try { options.onActivity(); } catch { /* fail open: ignore activity callback error */ }
    }
    const hdrHost = String(req.headers.host || '').trim();
    if (desktopServe) {
      if (!hdrHost || !LOOPBACK_HOST_HEADER_RE.test(hdrHost)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden_host' }));
        return;
      }
      if (!verifySameUidLoopbackPeer(req, options)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden_peer_uid' }));
        return;
      }
    }
    const rawSidecarHdr = req.headers['x-sidecar-token'];
    const rawOmagyHdr = req.headers['x-omagy-token'];
    const rawAuthHdr = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : '';
    const headerProvided = (typeof rawSidecarHdr === 'string' && rawSidecarHdr)
      || (typeof rawOmagyHdr === 'string' && rawOmagyHdr)
      || rawAuthHdr
      || '';
    const queryToken = reqUrl.searchParams.get('token') || '';
    const headerTokenValid = verifyHudToken(expectedToken, headerProvided);
    const tokenValid = headerTokenValid || (!desktopServe && verifyHudToken(expectedToken, queryToken));
    const cookieValid = desktopServe && verifySessionCookie(req);
    const denyUnauthorized = () => {
      res.writeHead(401, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    };
    const denyForbidden = (reason) => {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: false, error: reason }));
    };
    if (req.method === 'GET' && reqUrl.pathname === '/preload.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end('/* sidecar preload stub */\n');
      return;
    }
    if (req.method === 'GET' && (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html')) {
      if (desktopServe && hasHostileFetchMetadata(req)) {
        denyForbidden('forbidden_fetch_metadata');
        return;
      }
      const allowMint = desktopServe && expectedToken && isBrowserNavigationRequest(req);
      const serveRootHtml = (baseHtml) => {
        const htmlOut = hudHost && hudHost !== 'antigravity'
          ? String(baseHtml || '').replace('<html lang="en">', `<html lang="en" data-host="${hudHost}">`)
          : baseHtml;
        if (!res.headersSent) {
          const hdrs = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
          if (allowMint) hdrs['Set-Cookie'] = mintSessionCookie();
          res.writeHead(200, hdrs);
        }
        res.end(htmlOut);
      };
      getLiveHudHtml()
        .then(serveRootHtml)
        .catch(() => { /* fail open: fall back to last valid cached HUD HTML */
          serveRootHtml(liveHudHtml);
        });
      return;
    }
    const rawActiveRootParam = (reqUrl.searchParams.get('activeRoot') || '').trim();
    const resolveScopedWorkspaces = () => {
      const parsed = parseWorkspacesQuery(reqUrl, options.workspaceRoot || '');
      return clampDesktopWorkspaces(parsed, pinnedWorkspaceRoot, rawActiveRootParam);
    };
    const isGetAuthorized = () => (!statusRequiresToken || tokenValid || cookieValid);
    if (req.method === 'GET' && reqUrl.pathname === '/api/status') {
      if (!isGetAuthorized()) {
        denyUnauthorized();
        return;
      }
      const { workspaces, activeRoot } = resolveScopedWorkspaces();
      const snap = buildHudSnapshot(workspaces, Date.now(), activeRoot, { host: hudHost });
      recordSeenWorkspaces([...workspaces, ...(snap.workspaces || []), snap.workspace]);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snap));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/events') {
      if (!isGetAuthorized()) {
        denyUnauthorized();
        return;
      }
      while (activeSseCleanups.size >= maxSseClients) {
        const oldestCleanup = activeSseCleanups.values().next().value;
        if (!oldestCleanup) break;
        const prevSize = activeSseCleanups.size;
        try { oldestCleanup(); } catch { /* fail open: ignore evicted SSE client cleanup error */ activeSseCleanups.delete(oldestCleanup); }
        if (activeSseCleanups.size >= prevSize) activeSseCleanups.delete(oldestCleanup);
      }
      const { workspaces, activeRoot } = resolveScopedWorkspaces();
      const resolvedForSeen = resolveWorkspaceRoots(workspaces, options.workspaceRoot || '', activeRoot);
      recordSeenWorkspaces([...workspaces, ...(resolvedForSeen.roots || []), resolvedForSeen.primaryRoot]);
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
          if (typeof options.onActivity === 'function') options.onActivity();
          const snap = buildHudSnapshot(workspaces, Date.now(), activeRoot, { host: hudHost });
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
        const { roots, primaryRoot } = resolveWorkspaceRoots(workspaces, options.workspaceRoot || '', activeRoot);
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
        addFlatWatch(defaultRuntimeDir(), schedulePush);
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
    const handleAuthenticatedJsonPost = (onPayload) => {
      if (desktopServe) {
        const originHdr = String(req.headers.origin || '').trim().toLowerCase();
        const secSiteHdr = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
        if (originHdr && originHdr !== `http://${hdrHost.toLowerCase()}`) {
          denyForbidden('forbidden_origin');
          return;
        }
        if (secSiteHdr && secSiteHdr !== 'same-origin' && secSiteHdr !== 'none') {
          denyForbidden('forbidden_fetch_site');
          return;
        }
        const sameOriginProof = originHdr === `http://${hdrHost.toLowerCase()}` || secSiteHdr === 'same-origin';
        if (!expectedToken || !(headerTokenValid || (cookieValid && sameOriginProof))) {
          denyUnauthorized();
          return;
        }
      } else if (!expectedToken || !(headerTokenValid || verifyHudToken(expectedToken, queryToken))) {
        denyUnauthorized();
        return;
      }
      const now = Date.now();
      while (dispatchTimestamps.length && now - dispatchTimestamps[0] > 10_000) dispatchTimestamps.shift();
      if (activeDispatches >= 4 || dispatchTimestamps.length >= 20) {
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '2' });
        res.end(JSON.stringify({ ok: false, error: 'rate_limit_exceeded' }));
        return;
      }
      const ct = String(req.headers['content-type'] || '').toLowerCase();
      if (!ct.includes('application/json')) {
        res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }));
        return;
      }
      dispatchTimestamps.push(now);
      activeDispatches += 1;
      let dispatchReleased = false;
      const releaseDispatch = () => {
        if (!dispatchReleased) {
          dispatchReleased = true;
          activeDispatches = Math.max(0, activeDispatches - 1);
        }
      };
      const chunks = [];
      let totalBytes = 0;
      let aborted = false;
      req.on('close', releaseDispatch);
      req.on('error', releaseDispatch);
      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_DISPATCH_BODY_BYTES) {
          aborted = true;
          releaseDispatch();
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (aborted) return;
        try {
          let payload = {};
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch { /* fail open: reject malformed JSON request body */
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
            return;
          }
          let result;
          try {
            result = await onPayload(payload);
          } catch (err) { /* fail open: return 500 JSON when async handler rejects */
            result = { ok: false, status: 500, error: redactSecrets(String(err?.message || err || 'Request failed')) };
          }
          if (!res.headersSent) {
            res.writeHead(result.status || (result.ok ? 200 : 400), { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
          }
        } finally {
          releaseDispatch();
        }
      });
    };
    if (req.method === 'POST' && reqUrl.pathname === '/api/dispatch') {
      handleAuthenticatedJsonPost((payload) => dispatchHudActionAsync(payload, {
        ...options,
        host: hudHost,
        ...(pinnedWorkspaceRoot ? { workspaceRoot: pinnedWorkspaceRoot } : {}),
        allowPayloadWsUrl: desktopServe ? false : Boolean(options.allowPayloadWsUrl),
        skillSlugs: getSkillSlugs(),
      }));
      return;
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/workflow-control') {
      const envWs = process.env.OMAGY_WORKSPACE ? [path.resolve(uriToFsPath(process.env.OMAGY_WORKSPACE) || process.env.OMAGY_WORKSPACE)] : [];
      const vettedRoots = pinnedWorkspaceRoot
        ? [pinnedWorkspaceRoot]
        : (options.workspaceRoot
            ? [path.resolve(uriToFsPath(options.workspaceRoot) || options.workspaceRoot)]
            : (seenWorkspaceRoots.size > 0
                ? [...seenWorkspaceRoots, ...envWs]
                : [...resolveScopedWorkspaces().workspaces, ...envWs]));
      handleAuthenticatedJsonPost((payload) => handleWorkflowControl(payload, {
        ...options,
        host: hudHost,
        vettedRoots,
        allowPayloadWsUrl: desktopServe ? false : Boolean(options.allowPayloadWsUrl),
        skillSlugs: getSkillSlugs(),
      }));
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/wiki-search') {
      if (!expectedToken || !(tokenValid || cookieValid)) {
        denyUnauthorized();
        return;
      }
      const { workspaces, activeRoot } = resolveScopedWorkspaces();
      const { primaryRoot } = resolveWorkspaceRoots(workspaces, options.workspaceRoot || '', activeRoot);
      const q = (reqUrl.searchParams.get('q') || '').trim().slice(0, 160);
      if (!q) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, query: '', results: [] }));
        return;
      }
      try {
        const wikiDir = path.join(primaryRoot, 'omagy_wiki');
        const wikiSt = fs.existsSync(wikiDir) ? fs.lstatSync(wikiDir) : null;
        const idxPath = path.join(wikiDir, 'index.md');
        const idxSafe = !fs.existsSync(idxPath) || !fs.lstatSync(idxPath).isSymbolicLink();
        const searchOut = (wikiSt && !wikiSt.isSymbolicLink() && wikiSt.isDirectory() && idxSafe)
          ? queryWikiPages(wikiDir, q)
          : { results: [] };
        const results = (Array.isArray(searchOut?.results) ? searchOut.results : []).map((r) => ({
          slug: String(r.slug || ''),
          file: String(r.file || ''),
          title: redactSecrets(String(r.title || r.slug || '')),
          tags: Array.isArray(r.tags) ? r.tags.map((t) => redactSecrets(String(t))) : [],
          score: Number(r.score || 0),
          snippet: redactSecrets(String(r.snippet || '')),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, query: q, results }));
      } catch { /* fail open: return empty wiki search results on read error */
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, query: q, results: [] }));
      }
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/skill-doc') {
      if (!expectedToken || !(tokenValid || cookieValid)) {
        denyUnauthorized();
        return;
      }
      const catalogRoot = options.pluginRoot || PLUGIN_ROOT;
      const skillParam = reqUrl.searchParams.get('skill') || '';
      const refParam = reqUrl.searchParams.get('ref') || '';
      const resolved = resolveSafeSkillDoc(catalogRoot, skillParam, refParam);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Skill document not found or forbidden' }));
        return;
      }
      try {
        const safeText = redactSecrets(fs.readFileSync(resolved.filePath, 'utf8'));
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end(safeText);
      } catch { /* fail open: return 500 JSON when skill markdown read fails */
        res.writeHead(500, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Failed to read skill document' }));
      }
      return;
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/artifact') {
      if (!expectedToken || !(tokenValid || cookieValid)) {
        denyUnauthorized();
        return;
      }
      const fallbackWs = options.workspaceRoot || process.env.OMAGY_WORKSPACE || process.cwd();
      const rawWsParam = reqUrl.searchParams.get('workspace') || '';
      const wsParam = (!pinnedWorkspaceRoot || (rawWsParam && isPathInsideBase(uriToFsPath(rawWsParam) || rawWsParam, pinnedWorkspaceRoot))) ? rawWsParam : '';
      const { workspaces: vettedWsList, activeRoot } = resolveScopedWorkspaces();
      const { roots: artRoots, primaryRoot: artPrimary } = resolveWorkspaceRoots(wsParam ? [wsParam, ...vettedWsList] : vettedWsList, fallbackWs, activeRoot);
      const relParam = reqUrl.searchParams.get('rel') || '';
      let resolved = resolveSafeArtifactFile(artPrimary, relParam);
      if (!resolved && !pinnedWorkspaceRoot) {
        for (const altRoot of artRoots) {
          if (altRoot === artPrimary) continue;
          resolved = resolveSafeArtifactFile(altRoot, relParam);
          if (resolved) break;
        }
      }
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

  server.on('clientError', (err, socket) => {
    if (err?.code === 'ECONNRESET' || !socket || socket.destroyed || !socket.writable) return;
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n{"ok":false,"error":"bad_request"}\n');
    } catch { /* fail open: ignore socket write error on malformed client request */ }
  });

  server.closeAllSseClients = () => {
    for (const cleanup of [...activeSseCleanups]) {
      cleanup();
    }
  };
  server.on('close', server.closeAllSseClients);
  server.getActiveSseClientCount = () => activeSseCleanups.size;
  return server;
}

function sameModulePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  if (process.platform === 'win32' && ra.toLowerCase() === rb.toLowerCase()) return true;
  try {
    return canonicalizePath(ra) === canonicalizePath(rb);
  } catch { /* fail open: non-existent argv[1] cannot match module path */
    return false;
  }
}

function writePrivateRegistryFile(regPath, record) {
  const dir = path.dirname(regPath);
  try {
    const dst = fs.lstatSync(dir);
    if (dst.isSymbolicLink() || !dst.isDirectory()) throw new Error('insecure_registry_dir');
    if (typeof process.getuid === 'function' && dst.uid !== process.getuid()) throw new Error('registry_dir_wrong_uid');
  } catch (err) { /* fail open: directory absent before mkdir */
    if (err && err.code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* fail open: ignore dir chmod on restrictive fs */ }
  try {
    const rSt = fs.lstatSync(regPath);
    if (rSt.isSymbolicLink() || !rSt.isFile()) throw new Error('registry_file_symlink_disallowed');
    if (typeof process.getuid === 'function' && rSt.uid !== process.getuid()) throw new Error('registry_file_wrong_uid');
  } catch (err) { /* fail open: registry file does not exist yet */
    if (err && err.code !== 'ENOENT') throw err;
  }
  const tmpPath = `${regPath}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(tmpPath, 0o600); } catch { /* fail open: ignore tmp chmod on restrictive fs */ }
  fs.renameSync(tmpPath, regPath);
  try { fs.chmodSync(regPath, 0o600); } catch { /* fail open: ignore registry chmod on restrictive fs */ }
}

function removeOwnRegistryFile(regPath, ownerPid) {
  if (!regPath) return;
  try {
    const st = fs.lstatSync(regPath);
    if (!st.isFile()) return;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return;
    const cur = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    if (cur && Number(cur.pid) === Number(ownerPid)) fs.unlinkSync(regPath);
  } catch { /* fail open: ignore missing or rotated registry file */ }
}

export function parseDesktopServeArgs(argv = []) {
  const out = { workspace: '', host: 'antigravity', port: NaN, registry: '', token: '', idleTimeoutMs: NaN };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '');
    const next = () => (i + 1 < argv.length ? String(argv[++i]) : '');
    if (a === '--workspace') out.workspace = next();
    else if (a.startsWith('--workspace=')) out.workspace = a.slice('--workspace='.length);
    else if (a === '--host') out.host = next();
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a === '--port') out.port = Number(next());
    else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    else if (a === '--registry') out.registry = next();
    else if (a.startsWith('--registry=')) out.registry = a.slice('--registry='.length);
    else if (a === '--token') out.token = next();
    else if (a.startsWith('--token=')) out.token = a.slice('--token='.length);
    else if (a === '--idle-timeout-ms') out.idleTimeoutMs = Number(next());
    else if (a.startsWith('--idle-timeout-ms=')) out.idleTimeoutMs = Number(a.slice('--idle-timeout-ms='.length));
  }
  return out;
}

/** Start the loopback Desktop HUD HTTP/SSE server and write its 0o600 private registry. */
export async function startDesktopHudServer(opts = {}) {
  const workspaceRoot = path.resolve(opts.workspace || opts.workspaceRoot || process.env.OMAGY_WORKSPACE || process.cwd());
  const hudHost = normalizeExplicitHudHost(opts.host);
  const token = String(opts.token || process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '').trim() || crypto.randomBytes(24).toString('hex');
  const envPort = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
  const requestedPort = Number.isInteger(opts.port) && opts.port >= 0 && opts.port <= 65535
    ? opts.port
    : (Number.isInteger(envPort) && envPort >= 0 && envPort <= 65535 ? envPort : computeDesktopHudPort(workspaceRoot, { channel: 'daemon' }));
  const registryPath = opts.registry === false
    ? ''
    : path.resolve(opts.registry || desktopHudRegistryFile(workspaceRoot, opts.runtimeRoot || process.env.OMAGY_RUNTIME_DIR || ''));
  const rawIdle = Number(opts.idleTimeoutMs ?? process.env.OMAGY_HUD_IDLE_TIMEOUT_MS ?? 2 * 60 * 60 * 1000);
  const idleTimeoutMs = Number.isFinite(rawIdle) && rawIdle >= 0 ? rawIdle : 2 * 60 * 60 * 1000;

  let lastActivityAt = Date.now();
  const server = createHudServer(token, {
    ...opts,
    workspaceRoot,
    host: hudHost,
    desktopServe: true,
    statusRequiresToken: true,
    onActivity: () => { lastActivityAt = Date.now(); },
  });

  const listenOnPort = (port) => new Promise((resolve, reject) => {
    const onErr = (err) => {
      server.off('listening', onOk);
      reject(err);
    };
    const onOk = () => {
      server.off('error', onErr);
      resolve();
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(port, BIND_HOST);
  });

  try {
    await listenOnPort(requestedPort);
  } catch (err) { /* fail open: fall back to ephemeral loopback port only on EADDRINUSE when allowed */
    if (err?.code === 'EADDRINUSE' && requestedPort > 0 && registryPath && opts.allowEphemeralFallback !== false) {
      await listenOnPort(0);
    } else {
      throw err;
    }
  }

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
  const url = `http://${BIND_HOST}:${actualPort}/`;
  const registryRecord = {
    pid: process.pid,
    host: hudHost,
    port: actualPort,
    token,
    workspace: workspaceRoot,
    url,
    startedAt: new Date().toISOString(),
  };
  if (registryPath) {
    writePrivateRegistryFile(registryPath, registryRecord);
  }

  let idleTimer = null;
  if (idleTimeoutMs > 0) {
    const pollMs = Math.min(Math.max(25, Math.floor(idleTimeoutMs / 2)), 30000);
    idleTimer = setInterval(() => {
      if (server.getActiveSseClientCount() > 0) {
        lastActivityAt = Date.now();
        return;
      }
      if (Date.now() - lastActivityAt >= idleTimeoutMs) {
        clearInterval(idleTimer);
        idleTimer = null;
        if (typeof opts.onIdleTimeout === 'function') opts.onIdleTimeout({ port: actualPort, registryPath });
        removeOwnRegistryFile(registryPath, process.pid);
        if (typeof server.closeAllSseClients === 'function') server.closeAllSseClients();
        server.close();
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }
    }, pollMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  server.on('close', () => {
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    removeOwnRegistryFile(registryPath, process.pid);
  });

  return { server, port: actualPort, host: hudHost, token, workspace: workspaceRoot, url, registryPath };
}

const isMainModule = Boolean(process.argv[1] && sameModulePath(process.argv[1], fileURLToPath(import.meta.url)));
if (isMainModule) {
  const modeArg = (process.argv[2] || '').toLowerCase();
  if (modeArg === 'selftest' || modeArg === '--selftest') {
    (async () => {
      const { runSelftest } = await import('./selftest.mjs');
      await runSelftest();
    })().catch((err) => { /* fail open: report selftest failure cleanly */
      process.stderr.write(`[oh-my-agy/hud] selftest failed: ${err?.message || err}\n`);
      process.exitCode = 1;
    });
  } else if (modeArg === 'desktop-ensure') {
    const cliOpts = parseDesktopServeArgs(process.argv.slice(3));
    const targetHost = (cliOpts.host === 'claude' || cliOpts.host === 'codex') ? cliOpts.host : 'codex';
    const ws = cliOpts.workspace || process.cwd();
    import('../../hooks/omagy-host.mjs')
      .then(({ ensureDesktopHudDaemon }) => ensureDesktopHudDaemon({
        host: targetHost,
        workspace: ws,
        pluginRoot: PLUGIN_ROOT,
        env: { ...process.env, OMAGY_DESKTOP_HUD: '1' },
        argv1: process.argv[1],
      }))
      .then((res) => {
        const ok = Boolean(res?.port && res?.url && !res?.error);
        process.stdout.write(`${JSON.stringify({
          ok,
          host: targetHost,
          workspace: path.resolve(ws),
          port: res?.port || 0,
          url: res?.url || '',
          started: Boolean(res?.started),
          reused: Boolean(res?.reused),
          ...(res?.error ? { error: res.error } : {}),
        })}\n`);
        if (!ok) process.exitCode = 1;
      })
      .catch((err) => { /* fail open: report desktop-ensure error cleanly */
        process.stdout.write(`${JSON.stringify({ ok: false, host: targetHost, error: err?.message || String(err) })}\n`);
        process.exitCode = 1;
      });
  } else if (modeArg === 'desktop-serve') {
    const cliOpts = parseDesktopServeArgs(process.argv.slice(3));
    startDesktopHudServer({
      workspace: cliOpts.workspace || undefined,
      host: cliOpts.host,
      port: Number.isInteger(cliOpts.port) ? cliOpts.port : undefined,
      registry: cliOpts.registry || undefined,
      token: cliOpts.token || undefined,
      idleTimeoutMs: Number.isFinite(cliOpts.idleTimeoutMs) ? cliOpts.idleTimeoutMs : undefined,
      allowEphemeralFallback: Boolean(cliOpts.registry),
    }).then((srv) => {
      let shuttingDown = false;
      const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        removeOwnRegistryFile(srv.registryPath, process.pid);
        if (typeof srv.server.closeAllSseClients === 'function') srv.server.closeAllSseClients();
        srv.server.close(() => { process.exit(0); });
        if (typeof srv.server.closeAllConnections === 'function') srv.server.closeAllConnections();
        const forceExitTimer = setTimeout(() => { process.exit(0); }, 500);
        if (typeof forceExitTimer.unref === 'function') forceExitTimer.unref();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      process.stdout.write(`[oh-my-agy/hud] desktop-serve (${srv.host}) listening on ${srv.url}\n`);
    }).catch((err) => { /* fail open: report desktop-serve bind failure cleanly on stderr */
      process.stderr.write(`[oh-my-agy/hud] desktop-serve failed: ${err?.message || err}\n`);
      process.exit(1);
    });
  } else {
    const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 0);
    const envToken = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
    const server = createHudServer(envToken || crypto.randomBytes(24).toString('hex'), {
      statusRequiresToken: Boolean(envToken),
    });
    let shuttingDown = false;
    let parentWatch = null;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (parentWatch) {
        clearInterval(parentWatch);
        parentWatch = null;
      }
      try { server.closeAllSseClients?.(); } catch { /* fail open: ignore SSE teardown error */ }
      try {
        server.close(() => process.exit(0));
        server.closeAllConnections?.();
      } catch { /* fail open: ignore HTTP server close error */ }
      const forceExit = setTimeout(() => process.exit(0), 500);
      if (typeof forceExit.unref === 'function') forceExit.unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    const initialPpid = process.ppid;
    if (initialPpid > 1) {
      parentWatch = setInterval(() => {
        if (process.ppid === 1) shutdown();
      }, 15000);
      if (typeof parentWatch.unref === 'function') parentWatch.unref();
    }
    server.listen(port, BIND_HOST, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      process.stdout.write(`[oh-my-agy/hud] listening on http://${BIND_HOST}:${actualPort}\n`);
    });
  }
}
