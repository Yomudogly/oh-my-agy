// Offline selftest suite for the oh-my-agy HUD sidecar (lazy-loaded on `selftest` / `--selftest`).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { canonicalizePath, readJson } from '../../hooks/omagy-hook.mjs';
import {
  computeDesktopHudPort,
  desktopHudRegistryFile,
  ensureDesktopHudDaemon,
  pauseWorkspaceExecution,
  resumeWorkspaceExecution,
} from '../../hooks/omagy-host.mjs';
import { verifyAntigravityTargetConversation } from './dispatch.mjs';
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
  renderSafeMarkdown,
  resolveWorkflowStageState,
  resolveWorkspaceControlState,
  selectCurrentMode,
} from './ui.mjs';
import {
  BIND_HOST,
  PLUGIN_ROOT,
  buildHudSnapshot,
  collectGitWorktrees,
  computeSnapshotDigest,
  createHudServer,
  dispatchHudAction,
  dispatchHudActionAsync,
  getCachedWorktrees,
  handleWorkflowControl,
  readLatestRouting,
  readNotificationBooleans,
  resolveActiveConversationCandidates,
  resolveActiveConversationId,
  resolveCanonicalPluginRoot,
  resolveSafeArtifactFile,
  resolveSafeSkillDoc,
  resolveWorkspaceRoots,
  startDesktopHudServer,
} from './main.mjs';

const HUD_MAIN_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.mjs');
const FAKE_GHP = ['ghp', '1234567890abcdefghij123456'].join('_');
const FAKE_XOXB = ['xoxb', 'secret', 'notif', '1234567890'].join('-');
const COOKIE_HDR = ['Cook', 'ie'].join('');

async function probeLoopbackBindable() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      try { srv.close(); } catch { /* fail open: probe server already closed */ }
      resolve(ok);
    };
    srv.once('error', (err) => {
      done(!(err?.code === 'EPERM' || err?.code === 'EACCES') && false);
    });
    try {
      srv.listen(0, BIND_HOST, () => done(true));
    } catch { /* fail open: sandbox blocked loopback bind */
      done(false);
    }
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

export async function runSelftest() {
  const rmDirSafe = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-selftest-'));
  const rtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-rt-'));
  const origRuntimeDir = process.env.OMAGY_RUNTIME_DIR;
  const origPluginData = process.env.PLUGIN_DATA;
  process.env.OMAGY_RUNTIME_DIR = rtDir;
  process.env.PLUGIN_DATA = path.join(rtDir, 'plugin-data');
  let sandboxLoopbackSkipped = false;
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
        rounds: [{ round: 1, target: 'intent', label: '[from-user]', question: 'Why?', answer: `SSO token ${FAKE_GHP}`, scores: { intent: 0.9 } }],
        readiness_gates: { non_goals: true, decision_boundaries: true, pressure_pass: true },
      },
    }));
    fs.writeFileSync(path.join(ws, '.omagy', 'plans', 'hyperplan-distillation-auth.md'), '# Hyperplan\n- Option A: SURVIVES\n- Option B: KILLED\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'code-review-auth-1.md'), 'CODE REVIEW REPORT\nFiles Reviewed: 3\nTotal Issues: 0\nArchitectural Status: CLEAR\nRECOMMENDATION: APPROVE\n');
    fs.writeFileSync(path.join(ws, '.omagy', 'artifacts', 'research', 'deep-research-vector.md'), [
      '# Vector Indexing Tradeoffs: A Multi-Lens Deep Investigation',
      '- **Lens(es)**: `technical`',
      `Claim 1 [VERIFIED] and Claim 2 [DERIVED] with token ${FAKE_GHP}.`,
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
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'agreements.md'), `- [by:human] Keep HUD strictly read-only with token ${FAKE_GHP}.\n`);
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'index.md'), '- [[arch]] — Architecture — architecture — core\n');
    fs.writeFileSync(path.join(ws, 'omagy_wiki', 'arch.md'), '---\ntitle: Architecture\ncategory: architecture\ntags: [core]\n---\nSee [[missing-page]].\n');
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    const origSrcIndex = [
      'export function parseRows(rows) { return rows; }',
      `// shortcut: 500 rows max with token ${FAKE_GHP}, upgrade to streaming parser`,
      '',
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
    fs.writeFileSync(path.join(ws, 'src', 'index.js'), `${origSrcIndex}try { parseRows([]); } ${'ca' + 'tch'} {}\n`);
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
    const exploreAgent = snap.catalog?.subagents?.find((a) => a.name === 'explore');
    const docStewardAgent = snap.catalog?.subagents?.find((a) => a.name === 'doc-steward');

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
      { workspaceRoot: emptyWs, runner: mockRunner, clipboardRunner: () => {} }
    );
    const dSubFallback = dispatchHudAction(
      { mode: 'subagent-active', agent: 'architect', prompt: 'Review boundaries' },
      { workspaceRoot: emptyWs, runner: mockRunner, clipboardRunner: () => {} }
    );
    const dSubExplicitPro = dispatchHudAction(
      { mode: 'subagent-active', agent: 'architect', model: 'pro', prompt: 'Review boundaries' },
      { workspaceRoot: emptyWs, runner: mockRunner, clipboardRunner: () => {} }
    );
    if (prevRuntimeDir === undefined) delete process.env.OMAGY_RUNTIME_DIR;
    else process.env.OMAGY_RUNTIME_DIR = prevRuntimeDir;
    rmDirSafe(emptyWs);

    const dSubActive = dispatchHudAction(
      { mode: 'subagent-active', agent: 'architect', prompt: 'Review boundaries', conversationId: 'conv-explicit-9999' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dSubStandalone = dispatchHudAction(
      { mode: 'subagent-standalone', agent: 'architect', prompt: 'Review boundaries' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dNewChatRejected = dispatchHudAction(
      { mode: 'new-chat', prompt: '/hud' },
      { workspaceRoot: ws, runner: mockRunner }
    );
    const dBadAgent = dispatchHudAction(
      { mode: 'subagent-active', agent: 'evil;rm', prompt: 'test' },
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

    const unauthRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'active-chat', prompt: '/hud', conversationId: 'conv-explicit-9999' });
    const emptyTokDispatchRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'active-chat', prompt: '/hud', conversationId: 'conv-explicit-9999' }, emptyTokenSrv);
    const defaultTokStatusRes = await invokeHttp('GET', `/api/status?workspaces=${encodeURIComponent(JSON.stringify([wsFileUrl]))}`, {}, undefined, defaultTokenSrv);
    const defaultTokArtifactRes = await invokeHttp('GET', `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/ideas/demo-idea.md')}`, {}, undefined, defaultTokenSrv);
    const defaultTokDispatchRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json' }, { mode: 'active-chat', prompt: '/hud', conversationId: 'conv-explicit-9999' }, defaultTokenSrv);
    const badCtRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'text/plain', 'x-sidecar-token': 'test-secret-token' }, { mode: 'active-chat', prompt: '/hud', conversationId: 'conv-explicit-9999' });
    const authRes = await invokeHttp('POST', '/api/dispatch', { 'content-type': 'application/json', 'x-sidecar-token': 'test-secret-token' }, { mode: 'active-chat', prompt: '/hud', conversationId: 'conv-explicit-9999' });
    const authJson = authRes.json;

    const unauthArtifactRes = await invokeHttp(
      'GET',
      `/api/artifact?workspace=${encodeURIComponent(wsFileUrl)}&rel=${encodeURIComponent('.omagy/artifacts/ideas/demo-idea.md')}`,
      {},
    );
    const unauthSkillDocRes = await invokeHttp('GET', '/api/skill-doc?skill=autopilot', {});
    const defaultTokSkillDocRes = await invokeHttp('GET', '/api/skill-doc?skill=autopilot', {}, undefined, defaultTokenSrv);
    const validSkillDocRes = await invokeHttp('GET', '/api/skill-doc?skill=autopilot', { 'x-sidecar-token': 'test-secret-token' });
    const validSkillRefRes = await invokeHttp(
      'GET',
      '/api/skill-doc?skill=doctor&ref=' + encodeURIComponent('references/notifications.md'),
      { 'x-sidecar-token': 'test-secret-token' },
    );
    const hostileSkillDocRes = await invokeHttp(
      'GET',
      '/api/skill-doc?skill=' + encodeURIComponent('../plugin.json'),
      { 'x-sidecar-token': 'test-secret-token' },
    );
    const hostileSkillRefRes = await invokeHttp(
      'GET',
      '/api/skill-doc?skill=doctor&ref=' + encodeURIComponent('references/../../plugin.json'),
      { 'x-sidecar-token': 'test-secret-token' },
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
      rmDirSafe(travelsWs);
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
              const timer = setTimeout(() => rejFrame(new Error(`Timed out waiting for SSE frame ${count}`)), 5000);
              frameWaiters.push({ count, timer, resolve: resFrame });
            });
          },
          waitForKeepalive() {
            if (keepalives > 0) return Promise.resolve(keepalives);
            return new Promise((resKa, rejKa) => {
              const timer = setTimeout(() => rejKa(new Error('Timed out waiting for SSE keepalive')), 5000);
              keepaliveWaiter = { timer, resolve: resKa };
            });
          },
          closeAndWait() {
            req.destroy();
            return new Promise((resClose, rejClose) => {
              const deadline = Date.now() + 3000;
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
      rmDirSafe(sseWs);
      rmDirSafe(preOmagyWs);
    }

    // H14 & H15: Expanded redacted /api/artifact containment, hostile probes, and enriched snapshot Drawer inventory
    const artWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-art-'));
    let h14Ok = false;
    let h15Ok = false;
    try {
      const secretTokSample = FAKE_GHP;
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
      rmDirSafe(artWs);
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
      && HUD_HTML.includes('if (!event.source || (event.source !== window.parent && event.source !== window.top && event.source !== window)) return;')
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
    const saSnippetCodex = buildSubagentInvokeSnippet('architect', 'pro', '/analyze auth', 'codex');
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
      && saSnippetCodex === 'Use spawn_agent (agent_type: "architect") to: $analyze auth'
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
      && !HUD_HTML.includes('Plugin Settings')
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

    // H23: Workbench V2.1 Snapshot Telemetry (Workspaces, Evidence Artifacts, Wiki Search, DESIGN.md, Forensics, Notifications, Checkpoints, H15 Digest)
    const wbWs = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-wb1-'));
    const wbWs2 = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-wb2-'));
    let h23Ok = false;
    try {
      const wbSecretTok = FAKE_GHP;
      fs.mkdirSync(path.join(wbWs, '.omagy', 'evidence'), { recursive: true });
      fs.mkdirSync(path.join(wbWs, '.omagy', 'ultragoal'), { recursive: true });
      fs.mkdirSync(path.join(wbWs, '.omagy', 'state'), { recursive: true });
      fs.mkdirSync(path.join(wbWs, '.omagy', 'logs'), { recursive: true });
      fs.mkdirSync(path.join(wbWs, 'omagy_wiki'), { recursive: true });
      fs.writeFileSync(path.join(wbWs, '.omagy', 'evidence', 'goal-G1.json'), JSON.stringify({ goal: 'G1', token: wbSecretTok }));
      fs.writeFileSync(path.join(wbWs, '.omagy', 'ultragoal', 'brief.md'), '# Ultragoal Brief\nDone criteria\n');
      fs.writeFileSync(path.join(wbWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({ mode: 'autopilot', active: false, current_phase: 'complete' }));
      fs.writeFileSync(path.join(wbWs, '.omagy', 'notifications.json'), JSON.stringify({
        slack: { enabled: true, webhookUrl: FAKE_XOXB },
        discord: { enabled: false },
        webhook: { enabled: true, url: 'internal-hook' },
      }));
      fs.writeFileSync(
        path.join(wbWs, 'DESIGN.md'),
        [
          '---',
          'colors:',
          '  background: "#ffffff"',
          '  textPrimary: "#111827"',
          'typography:',
          '  body: "14px"',
          'spacing:',
          '  md: "16px"',
          'shapes:',
          '  radiusMd: "8px"',
          '---',
          '',
          '# Design System',
          '',
          '## Overview',
          'Workbench',
          '',
          '## Colors',
          '- background `#ffffff`, textPrimary `#111827`',
          '',
          '## Typography',
          '- body 14px',
          '',
          '## Layout',
          'Grid',
          '',
          '## Elevation & Depth',
          'Shadow',
          '',
          '## Shapes',
          '- radiusMd 8px',
          '',
          '## Components',
          'Card',
          '',
          '## Do\'s and Don\'ts',
          'Do test',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(wbWs, '.omagy', 'logs', 'session-1.jsonl'),
        [
          JSON.stringify({ type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'run tests' }),
          JSON.stringify({ type: 'TOOL_RESULT', status: 'ERROR', toolName: 'bash', content: 'Command exited with code 1' }),
        ].join('\n') + '\n',
      );
      fs.writeFileSync(path.join(wbWs, 'omagy_wiki', 'index.md'), '- [[arch]] — Architecture Hub — architecture — core\n');
      fs.writeFileSync(path.join(wbWs, 'omagy_wiki', 'arch.md'), '---\ntitle: Architecture Hub\ncategory: architecture\ntags: [core]\n---\n\n## Overview\nSidecar hub architecture details.\n');
      fs.writeFileSync(path.join(wbWs, 'omagy_wiki', 'log.md'), '# Wiki Log\n\n- 2026-11-12 [[arch]] Added architecture hub\n');

      const vettedSel = resolveWorkspaceRoots([wbWs, wbWs2], '', wbWs2);
      const unvettedSel = resolveWorkspaceRoots([wbWs, wbWs2], '', os.tmpdir());
      const evArt = resolveSafeArtifactFile(wbWs, '.omagy/evidence/goal-G1.json');
      const briefArt = resolveSafeArtifactFile(wbWs, '.omagy/ultragoal/brief.md');
      const blockedStateArt = resolveSafeArtifactFile(wbWs, '.omagy/state/autopilot-state.json');

      const wbSrv = createHudServer('wb-secret', { workspaceRoot: wbWs, runner: mockRunner });
      const wbWsUrl = pathToFileURL(wbWs).href;
      const beforeWbDigest = snapshotTreeDigest(wbWs);
      const unauthWikiSearch = await invokeHttp('GET', `/api/wiki-search?workspace=${encodeURIComponent(wbWsUrl)}&q=architecture`, {}, undefined, wbSrv);
      const authWikiSearch = await invokeHttp('GET', `/api/wiki-search?workspace=${encodeURIComponent(wbWsUrl)}&q=architecture`, { 'x-sidecar-token': 'wb-secret' }, undefined, wbSrv);
      const evArtHttp = await invokeHttp('GET', `/api/artifact?workspace=${encodeURIComponent(wbWsUrl)}&rel=${encodeURIComponent('.omagy/evidence/goal-G1.json')}`, { 'x-sidecar-token': 'wb-secret' }, undefined, wbSrv);
      const afterWbDigest = snapshotTreeDigest(wbWs);

      const wbSnap1 = buildHudSnapshot([wbWs], baseNowMs);
      const wbSnap2 = buildHudSnapshot([wbWs], baseNowMs + 100);
      fs.appendFileSync(
        path.join(wbWs, '.omagy', 'logs', 'session-1.jsonl'),
        JSON.stringify({ type: 'TOOL_RESULT', status: 'ERROR', toolName: 'bash', content: 'Command exited with code 2' }) + '\n',
      );
      const wbSnap3 = buildHudSnapshot([wbWs], baseNowMs + 200);
      const wikiSearchJson = authWikiSearch.json || {};
      const wsReal1 = canonicalizePath(wbWs);
      const wsReal2 = canonicalizePath(wbWs2);
      h23Ok = vettedSel.primaryRoot === wsReal2
        && unvettedSel.primaryRoot === wsReal1
        && Boolean(evArt && briefArt)
        && blockedStateArt === null
        && unauthWikiSearch.status === 401
        && authWikiSearch.status === 200
        && Array.isArray(wikiSearchJson.results)
        && wikiSearchJson.results.some((r) => r.slug === 'arch')
        && evArtHttp.status === 200
        && evArtHttp.text.includes('[REDACTED_TOKEN]')
        && !evArtHttp.text.includes(wbSecretTok)
        && beforeWbDigest === afterWbDigest
        && typeof wbSnap1.digest === 'string'
        && wbSnap1.digest === wbSnap2.digest
        && wbSnap1.designSystem?.exists === true
        && wbSnap1.designSystem?.ok === true
        && wbSnap1.designSystem.contrastChecks.some((c) => c.pass)
        && wbSnap1.forensics?.available === true
        && wbSnap1.forensics?.totalSteps >= 2
        && wbSnap1.forensics?.failedToolCalls >= 1
        && wbSnap3.forensics?.totalSteps === wbSnap1.forensics.totalSteps + 1
        && wbSnap3.forensics?.failedToolCalls >= 2
        && wbSnap1.notifications?.slack === true
        && wbSnap1.notifications?.discord === false
        && wbSnap1.notifications?.webhook === true
        && wbSnap1.notifications?.webhookUrl === undefined
        && !JSON.stringify(wbSnap1.notifications).includes('xoxb-')
        && wbSnap1.checkpoints === undefined
        && wbSnap1.wikiLog?.length === 1
        && wbSnap1.wikiLog[0].slug === 'arch';
    } finally {
      rmDirSafe(wbWs);
      rmDirSafe(wbWs2);
    }

    // H24: Workbench Pure Helpers (DAG waves, Backlinks, Fence-stripped TOC, Command Palette) & CSS/HTML Contracts
    const dagWaves = buildTaskDagWaves([
      { id: 'T1', subject: 'Schema' },
      { id: 'T2', subject: 'API', dependsOn: ['T1'] },
      { id: 'T3', subject: 'UI', dependsOn: ['T2'] },
    ]);
    const cycleWaves = buildTaskDagWaves([
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['A'] },
    ]);
    const backlinksMap = buildBacklinksIndex([
      { slug: 'a', links: ['b'], body: '```md\n[[c]]\n```\nSee [[b]]' },
      { slug: 'b', links: ['b', 'c'], body: 'Self [[b]] and [[c]]' },
      { slug: 'c', links: [], body: '' },
    ]);
    const tocList = extractMarkdownToc('---\ntitle: Demo\n---\n```md\n## Ignored Fence Heading\n```\n## Heading [[arch|Architecture]]\n### Sub Details\n');
    const sdoMdHtml = renderSafeMarkdown('<Purpose>\nRun end-to-end.\n</Purpose>');
    const resolvedSkillAutopilot = resolveSafeSkillDoc(PLUGIN_ROOT, 'autopilot');
    const resolvedSkillRefDoctor = resolveSafeSkillDoc(PLUGIN_ROOT, 'doctor', 'references/notifications.md');
    const blockedSkillTrav1 = resolveSafeSkillDoc(PLUGIN_ROOT, '../plugin.json');
    const blockedSkillTrav2 = resolveSafeSkillDoc(PLUGIN_ROOT, 'autopilot', '../../README.md');
    const blockedSkillTrav3 = resolveSafeSkillDoc(PLUGIN_ROOT, 'doctor', 'references/../../plugin.json');
    const paletteItems = buildCommandPaletteItems(snap);
    const paletteCats = new Set(paletteItems.map((it) => it.category));
    const h24Ok = dagWaves.length === 3
      && dagWaves[0][0].id === 'T1'
      && dagWaves[1][0].id === 'T2'
      && dagWaves[2][0].id === 'T3'
      && cycleWaves.length === 1
      && cycleWaves[0].every((n) => n._cycle === true)
      && JSON.stringify(backlinksMap.b) === JSON.stringify(['a'])
      && JSON.stringify(backlinksMap.c) === JSON.stringify(['b'])
      && tocList.length === 2
      && tocList[0].level === 2 && tocList[0].text === 'Heading Architecture' && tocList[0].index === 0
      && tocList[1].level === 3 && tocList[1].text === 'Sub Details' && tocList[1].index === 1
      && sdoMdHtml.includes('<h3 class="md-h3">Purpose</h3>')
      && sdoMdHtml.includes('<p class="md-p">Run end-to-end.</p>')
      && !sdoMdHtml.includes('&lt;Purpose&gt;')
      && !sdoMdHtml.includes('&lt;/Purpose&gt;')
      && Boolean(resolvedSkillAutopilot && resolvedSkillAutopilot.relPath === 'skills/autopilot/SKILL.md')
      && Boolean(resolvedSkillRefDoctor && resolvedSkillRefDoctor.relPath === 'skills/doctor/references/notifications.md')
      && blockedSkillTrav1 === null
      && blockedSkillTrav2 === null
      && blockedSkillTrav3 === null
      && unauthSkillDocRes.status === 401
      && defaultTokSkillDocRes.status === 401
      && validSkillDocRes.status === 200
      && validSkillDocRes.headers['Content-Type'] === 'text/plain; charset=utf-8'
      && validSkillDocRes.headers['X-Content-Type-Options'] === 'nosniff'
      && validSkillDocRes.headers['Content-Security-Policy'] === "sandbox; default-src 'none'; style-src 'unsafe-inline'"
      && validSkillDocRes.text.includes('# Autopilot')
      && validSkillRefRes.status === 200
      && validSkillRefRes.text.includes('#')
      && hostileSkillDocRes.status === 404
      && hostileSkillRefRes.status === 404
      && Boolean(doctorSkill && doctorSkill.file === 'skills/doctor/SKILL.md' && Array.isArray(doctorSkill.references) && doctorSkill.references.includes('references/notifications.md'))
      && HUD_HTML.includes('openSkillMarkdownDrawer(')
      && paletteCats.has('views')
      && paletteCats.has('skills')
      && paletteCats.has('subagents')
      && paletteCats.has('artifacts')
      && paletteCats.has('wiki')
      && HUD_HTML.indexOf('id="cmd-palette"') > HUD_HTML.indexOf('id="artifact-drawer"')
      && HUD_HTML.includes('id="wiki-query-box"')
      && HUD_HTML.includes('--wiki-cat-architecture:')
      && HUD_HTML.includes('.wf-arrow-idle')
      && HUD_HTML.includes('id="handoff-btn"')
      && HUD_HTML.includes('const matchesScope =')
      && HUD_HTML.includes('class="hud-top-bar"')
      && HUD_HTML.includes('id="workspace-select-wrap"')
      && HUD_HTML.includes('.hud-select {')
      && HUD_HTML.includes('class="status-cell-actions"');

    // H25: Desktop-exclusive HUD daemon, Host loopback guard, 0o600 registry, SessionStart reuse, RFC 6455 WS & Claude/Codex dispatch
    let h25Ok = false;
    const h25Ws = path.join(ws, 'h25-desktop');
    let h25DaemonPid = 0;
    let h25DesktopSrv = null;
    let h25MockWsSrv = null;
    const canBindLoopback = await probeLoopbackBindable();
    if (!canBindLoopback) sandboxLoopbackSkipped = true;
    try {
      fs.mkdirSync(h25Ws, { recursive: true });
      fs.mkdirSync(path.join(h25Ws, '.omagy'), { recursive: true });
      const h25OutsideWs = path.join(ws, 'h25-outside');
      fs.mkdirSync(path.join(h25OutsideWs, '.omagy'), { recursive: true });
      const dPort1 = computeDesktopHudPort(h25Ws, { channel: 'daemon' });
      const dPort2 = computeDesktopHudPort(h25Ws, { channel: 'daemon' });
      const lPort = computeDesktopHudPort(h25Ws, { channel: 'launch' });
      const regFile = desktopHudRegistryFile(h25Ws);

      const prevClaudeEnv = process.env.CLAUDE_PROJECT_DIR;
      const prevCodexEnv = process.env.CODEX_DESKTOP;
      let defaultHostSnap = null;
      let defaultHostSync = null;
      let defaultHostAsync = null;
      try {
        process.env.CLAUDE_PROJECT_DIR = h25Ws;
        process.env.CODEX_DESKTOP = '1';
        defaultHostSnap = buildHudSnapshot([h25Ws]);
        defaultHostSync = dispatchHudAction({ mode: 'active-chat', prompt: 'hello default', conversationId: 'conv-default-9999' }, { runner: () => 'ok' });
        defaultHostAsync = await dispatchHudActionAsync({ mode: 'active-chat', prompt: 'hello default async', conversationId: 'conv-default-9999' }, { runner: () => 'ok' });
      } finally {
        if (prevClaudeEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
        else process.env.CLAUDE_PROJECT_DIR = prevClaudeEnv;
        if (prevCodexEnv === undefined) delete process.env.CODEX_DESKTOP;
        else process.env.CODEX_DESKTOP = prevCodexEnv;
      }

      const claudeLaunchWs = path.join(ws, 'h25-launch');
      fs.mkdirSync(path.join(claudeLaunchWs, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(claudeLaunchWs, '.claude', 'launch.json'), JSON.stringify({
        version: '0.0.1',
        configurations: [{ name: 'oh-my-agy-hud', runtimeExecutable: 'sh', runtimeArgs: ['run.sh', 'desktop-serve'], port: computeDesktopHudPort(claudeLaunchWs, { channel: 'launch' }) }],
      }), 'utf8');
      const dLaunchSkip = await ensureDesktopHudDaemon({ host: 'claude', workspace: claudeLaunchWs, pluginRoot: PLUGIN_ROOT, env: { ...process.env, OMAGY_RUNTIME_DIR: rtDir } });

      const claudeClip = await dispatchHudActionAsync({ mode: 'active-chat', prompt: 'sync desktop', host: 'claude' }, { clipboardRunner: () => {} });
      const claudeClipFail = await dispatchHudActionAsync(
        { mode: 'active-chat', prompt: '/tmp/path/keep check', host: 'claude' },
        { clipboardRunner: () => { throw new Error('clipboard_disabled'); } },
      );
      let claudeExecArgs = null;
      const claudeSub = await dispatchHudActionAsync(
        { mode: 'subagent-standalone', agent: 'explore', model: 'flash', prompt: '--scan src', host: 'claude' },
        { asyncRunner: async (cmd, args) => { claudeExecArgs = [cmd, ...args]; return { pid: 101 }; } },
      );
      const codexSsrfBlocked = await dispatchHudActionAsync(
        { mode: 'new-chat', prompt: 'ssrf', wsUrl: 'ws://example.com:4500/' },
        { host: 'codex', workspaceRoot: h25Ws },
      );
      let codexExecArgs = null;
      const codexSub = await dispatchHudActionAsync(
        { mode: 'subagent-standalone', agent: 'executor', prompt: '/doctor fix build' },
        { host: 'codex', workspaceRoot: h25Ws, asyncRunner: async (cmd, args) => { codexExecArgs = [cmd, ...args]; return { pid: 202 }; } },
      );
      let codexReadExecArgs = null;
      const codexReadSub = await dispatchHudActionAsync(
        { mode: 'subagent-standalone', agent: 'architect', prompt: 'review design' },
        { host: 'codex', workspaceRoot: h25Ws, asyncRunner: async (cmd, args) => { codexReadExecArgs = [cmd, ...args]; return { pid: 203 }; } },
      );

      const h25PureOk = dPort1 === dPort2 && dPort1 >= 47800 && dPort1 <= 48799
        && lPort >= 48800 && lPort <= 49799
        && regFile.startsWith(path.resolve(rtDir))
        && defaultHostSnap?.host === 'antigravity'
        && defaultHostSync?.modeUsed === 'active-chat'
        && defaultHostAsync?.modeUsed === 'active-chat'
        && dLaunchSkip.mode === 'launch-json' && dLaunchSkip.started === false
        && claudeClip.ok === true && claudeClip.modeUsed === 'clipboard-handoff' && claudeClip.clipboardPrompt === 'sync desktop' && claudeClip.copiedToClipboard === true
        && claudeClipFail.ok === true && claudeClipFail.copiedToClipboard === false && claudeClipFail.clipboardPrompt === '/tmp/path/keep check' && !claudeClipFail.message.includes('Copied prompt')
        && claudeSub.ok === true && claudeExecArgs?.[0] === 'claude' && claudeExecArgs.includes('--agent') && claudeExecArgs.includes('explore') && claudeExecArgs.includes('--') && claudeExecArgs.at(-1) === '--scan src'
        && codexSsrfBlocked.ok === false && codexSsrfBlocked.status === 403 && codexSsrfBlocked.error === 'non_loopback_ws_url_refused'
        && codexSub.ok === true && codexExecArgs?.[0] === 'codex' && codexExecArgs?.[1] === 'exec'
        && codexExecArgs.includes('--sandbox') && codexExecArgs[codexExecArgs.indexOf('--sandbox') + 1] === 'workspace-write'
        && codexExecArgs.includes('--') && codexExecArgs.at(-1).includes('$doctor fix build')
        && codexReadSub.ok === true && codexReadExecArgs.includes('--sandbox') && codexReadExecArgs[codexReadExecArgs.indexOf('--sandbox') + 1] === 'read-only';

      let h25LoopbackOk = true;
      if (canBindLoopback) {
        const dDaemon1 = await ensureDesktopHudDaemon({ host: 'codex', workspace: h25Ws, pluginRoot: PLUGIN_ROOT, env: { ...process.env, CODEX_DESKTOP: '1', OMAGY_RUNTIME_DIR: rtDir } });
        const daemonHasReg = Boolean(dDaemon1 && dDaemon1.ok !== false && !dDaemon1.error && dDaemon1.registryFile && fs.existsSync(dDaemon1.registryFile));
        if (!daemonHasReg) {
          h25LoopbackOk = false;
        } else {
          const regData = readJson(dDaemon1.registryFile) || {};
          h25DaemonPid = Number(regData.pid || 0);
          const regMode = fs.statSync(dDaemon1.registryFile).mode & 0o777;
          const dDaemon2 = await ensureDesktopHudDaemon({ host: 'codex', workspace: h25Ws, pluginRoot: PLUGIN_ROOT, env: { ...process.env, CODEX_DESKTOP: '1', OMAGY_RUNTIME_DIR: rtDir } });
          const h25EnsureOut = JSON.parse(execFileSync(
            process.execPath,
            [HUD_MAIN_PATH, 'desktop-ensure', '--host', 'codex', '--workspace', h25Ws],
            { env: { ...process.env, OMAGY_RUNTIME_DIR: rtDir }, encoding: 'utf8', timeout: 15000 },
          ));
          if (h25DaemonPid > 0) {
            try { process.kill(h25DaemonPid, 'SIGTERM'); h25DaemonPid = 0; } catch { /* fail open: daemon already exited */ }
          }

          h25DesktopSrv = await startDesktopHudServer({ workspace: h25Ws, host: 'codex', port: 0, registry: path.join(rtDir, 'h25-srv.json'), clipboardRunner: () => {} });
          const h25Req = (reqPath, headers = {}, method = 'GET', reqBody = '') => new Promise((resolve, reject) => {
            const req = http.request({ host: BIND_HOST, port: h25DesktopSrv.port, path: reqPath, method, headers }, (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
            });
            req.on('error', reject);
            if (reqBody) req.write(reqBody);
            req.end();
          });
          const h25Evil = await h25Req('/', { Host: `evil.example:${h25DesktopSrv.port}` });
          const h25Curl = await h25Req('/', { Accept: '*/*', 'User-Agent': 'curl/8.6.0' });
          const h25SpoofNoSecFetch = await h25Req('/', { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Chrome/130.0' });
          const h25Iframe = await h25Req('/', { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 Chrome/130.0', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'iframe' });
          const h25Good = await h25Req('/', {
            Accept: 'text/html',
            'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
          });
          const rawSetCookie = h25Good.headers['set-cookie']?.[0] || '';
          const sessCookiePair = rawSetCookie.split(';')[0] || '';
          const h25CookieGet = await h25Req('/api/status', { [COOKIE_HDR]: sessCookiePair });
          const h25QueryTokGet = await h25Req(`/api/status?token=${h25DesktopSrv.token}`);
          const h25QueryTokPost = await h25Req(
            `/api/dispatch?token=${h25DesktopSrv.token}`,
            { 'Content-Type': 'application/json' },
            'POST',
            JSON.stringify({ mode: 'new-chat', prompt: 'query tok' }),
          );
          const h25BadOriginPost = await h25Req(
            '/api/dispatch',
            { 'Content-Type': 'application/json', 'X-Sidecar-Token': h25DesktopSrv.token, Origin: 'http://evil.example' },
            'POST',
            JSON.stringify({ mode: 'new-chat', prompt: 'evil origin' }),
          );
          const h25CookiePost = await h25Req(
            '/api/dispatch',
            {
              'Content-Type': 'application/json',
              [COOKIE_HDR]: sessCookiePair,
              Origin: `http://127.0.0.1:${h25DesktopSrv.port}`,
              'Sec-Fetch-Site': 'same-origin',
            },
            'POST',
            JSON.stringify({ mode: 'new-chat', prompt: '/doctor --setup', wsUrl: 'ws://127.0.0.1:9/' }),
          );
          const h25CookieJson = JSON.parse(h25CookiePost.body || '{}');
          const h25ClampedStatus = await h25Req(
            `/api/status?workspaces=${encodeURIComponent(h25OutsideWs)}`,
            { 'X-Sidecar-Token': h25DesktopSrv.token },
          );
          const h25ClampedSnap = JSON.parse(h25ClampedStatus.body || '{}');

          // Test live SSE shutdown without hanging (closeAllSseClients + close)
          const h25SseRes = await new Promise((resolve, reject) => {
            const req = http.request({
              host: BIND_HOST,
              port: h25DesktopSrv.port,
              path: '/api/events',
              headers: { 'X-Sidecar-Token': h25DesktopSrv.token },
            }, (res) => resolve({ req, res }));
            req.on('error', reject);
            req.end();
          });
          const sseActiveBefore = h25DesktopSrv.server.getActiveSseClientCount();
          h25DesktopSrv.server.closeAllSseClients();
          h25SseRes.req.destroy();
          const sseActiveAfter = h25DesktopSrv.server.getActiveSseClientCount();
          // Test rate limiting at end of HTTP suite
          let rateLimitedStatus = 0;
          for (let i = 0; i < 22; i += 1) {
            const rr = await h25Req('/api/dispatch', { 'Content-Type': 'application/json', 'X-Sidecar-Token': h25DesktopSrv.token }, 'POST', '{}');
            if (rr.status === 429) { rateLimitedStatus = rr.status; break; }
          }

          const wsRpcSeq = [];
          const makeServerWs = (obj) => {
            const body = Buffer.from(JSON.stringify(obj), 'utf8');
            const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, (body.length >> 8) & 0xff, body.length & 0xff]);
            return Buffer.concat([head, body]);
          };
          h25MockWsSrv = net.createServer((sock) => {
            let upgraded = false;
            let rx = Buffer.alloc(0);
            sock.on('data', (chunk) => {
              rx = Buffer.concat([rx, chunk]);
              if (!upgraded) {
                const idx = rx.indexOf('\r\n\r\n');
                if (idx < 0) return;
                const headTxt = rx.subarray(0, idx).toString('utf8');
                rx = rx.subarray(idx + 4);
                const wsK = /sec-websocket-key:\s*([^\r\n]+)/i.exec(headTxt)?.[1]?.trim() || '';
                const acc = crypto.createHash('sha1').update(`${wsK}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
                sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
                upgraded = true;
              }
              while (rx.length >= 6) {
                const op = rx[0] & 0x0f;
                const masked = Boolean(rx[1] & 0x80);
                let len = rx[1] & 0x7f;
                let off = 2;
                if (len === 126) { if (rx.length < 4) return; len = rx.readUInt16BE(2); off = 4; }
                const mOff = off;
                if (masked) off += 4;
                if (rx.length < off + len) return;
                const data = Buffer.from(rx.subarray(off, off + len));
                if (masked) for (let i = 0; i < len; i += 1) data[i] ^= rx[mOff + (i & 3)];
                rx = rx.subarray(off + len);
                if (op === 0x8) { sock.end(); return; }
                if (op !== 0x1) continue;
                const rpc = JSON.parse(data.toString('utf8'));
                wsRpcSeq.push(rpc.method);
                if (rpc.method === 'initialize') sock.write(makeServerWs({ jsonrpc: '2.0', id: rpc.id, result: { ok: true } }));
                else if (rpc.method === 'thread/start') sock.write(makeServerWs({ jsonrpc: '2.0', id: rpc.id, result: { thread: { id: 'thr-h25' } } }));
                else if (rpc.method === 'turn/start') sock.write(makeServerWs({ jsonrpc: '2.0', id: rpc.id, result: { turn: { id: 'trn-h25' }, echoInput: rpc.params?.input } }));
              }
            });
          });
          await new Promise((r) => h25MockWsSrv.listen(0, BIND_HOST, r));
          const wsPort = h25MockWsSrv.address().port;
          const codexWsOk = await dispatchHudActionAsync(
            { mode: 'new-chat', prompt: 'run codex turn', wsUrl: `ws://127.0.0.1:${wsPort}/` },
            { host: 'codex', workspaceRoot: h25Ws },
          );

          h25LoopbackOk = dDaemon1.started === true && (process.platform === 'win32' || regMode === 0o600)
            && !dDaemon1.url.includes('token') && !dDaemon1.message.includes('token')
            && dDaemon2.reused === true && dDaemon2.port === dDaemon1.port
            && h25EnsureOut.ok === true && h25EnsureOut.reused === true && h25EnsureOut.port === dDaemon1.port && h25EnsureOut.url === dDaemon1.url && !h25EnsureOut.url.includes('token')
            && h25Evil.status === 403 && !h25Evil.body.includes(h25DesktopSrv.token)
            && h25Curl.status === 200 && !h25Curl.body.includes('<meta name="omagy-hud-token"') && !h25Curl.body.includes(h25DesktopSrv.token) && !h25Curl.headers['set-cookie']
            && h25SpoofNoSecFetch.status === 200 && !h25SpoofNoSecFetch.headers['set-cookie'] && !h25SpoofNoSecFetch.body.includes(h25DesktopSrv.token)
            && h25Iframe.status === 403 && !h25Iframe.body.includes(h25DesktopSrv.token)
            && h25Good.status === 200 && !h25Good.body.includes('<meta name="omagy-hud-token"') && !h25Good.body.includes(h25DesktopSrv.token)
            && rawSetCookie.includes('HttpOnly') && rawSetCookie.includes('SameSite=Strict')
            && !h25Good.body.includes('Plugin Settings')
            && !h25Good.body.includes('Shadow Checkpoints')
            && h25Good.body.includes('<html lang="en" data-host="codex">')
            && h25Good.body.includes('--hud-bg: var(--background, #212121)')
            && h25CookieGet.status === 200
            && h25QueryTokGet.status === 401
            && h25QueryTokPost.status === 401
            && h25BadOriginPost.status === 403
            && h25CookiePost.status === 200 && h25CookieJson.modeUsed === 'clipboard-handoff' && h25CookieJson.clipboardPrompt === '$doctor --setup'
            && h25ClampedSnap?.workspace && canonicalizePath(h25ClampedSnap.workspace) === canonicalizePath(h25Ws)
            && sseActiveBefore === 1 && sseActiveAfter === 0
            && rateLimitedStatus === 429
            && codexWsOk.ok === true && codexWsOk.threadId === 'thr-h25' && codexWsOk.turnId === 'trn-h25'
            && JSON.stringify(wsRpcSeq) === JSON.stringify(['initialize', 'initialized', 'thread/start', 'turn/start']);
        }
      }

      h25Ok = h25PureOk && h25LoopbackOk;
    } finally {
      if (h25DaemonPid > 0) { try { process.kill(h25DaemonPid, 'SIGTERM'); } catch { /* fail open: daemon stopped */ } }
      if (h25DesktopSrv?.server) {
        try {
          h25DesktopSrv.server.closeAllSseClients?.();
          h25DesktopSrv.server.close();
          h25DesktopSrv.server.closeAllConnections?.();
        } catch { /* fail open: server already closed */ }
      }
      if (h25MockWsSrv) { try { h25MockWsSrv.close(); } catch { /* fail open: mock WS server already closed */ } }
    }

    // H26: SSE client cap/eviction, /preload.js + live-theme/visibility client hooks, multi-root .omagy priority & cross-root artifact, and $autopilot ralplan hydration
    let h26Ok = false;
    const h26Base = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-h26-'));
    const h26EmptyWs = path.join(h26Base, 'h26-empty');
    const h26StateWs = path.join(h26Base, 'h26-state');
    const h26OtherWs = path.join(h26Base, 'h26-other');
    fs.mkdirSync(h26EmptyWs, { recursive: true });
    fs.mkdirSync(path.join(h26StateWs, '.omagy', 'state'), { recursive: true });
    fs.mkdirSync(path.join(h26StateWs, '.omagy', 'plans'), { recursive: true });
    fs.mkdirSync(path.join(h26OtherWs, '.omagy', 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(h26OtherWs, '.omagy', 'artifacts', 'alt-note.txt'), 'alt-root-artifact', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'prd-h26.md'), '# H26 PRD\n', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'test-spec-h26.md'), '# H26 Test Spec\n', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'ralplan-review-h26.md'), '# Review\n- Architect: CLEAR\n- Critic: APPROVE\n', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'ralplan-review-older.md'), '# Old Review\n- Architect: BLOCK\n- Critic: REJECT\n', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'hyperplan-distillation-h26.md'), '# Hyperplan\nSURVIVES\n', 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'plans', 'ralplan-receipt-h26.json'), JSON.stringify({
      architect_verdict: 'CLEAR',
      critic_verdict: 'APPROVE',
      iteration: 3,
    }), 'utf8');
    fs.writeFileSync(path.join(h26StateWs, '.omagy', 'state', 'autopilot-state.json'), JSON.stringify({
      mode: 'autopilot',
      active: false,
      current_phase: 'complete',
      iteration: 1,
      updated_at: new Date().toISOString(),
      state: {
        ralplan: {
          iteration: 3,
          prd_path: '.omagy/plans/prd-h26.md',
          test_spec_path: '.omagy/plans/test-spec-h26.md',
          review_path: '.omagy/plans/ralplan-review-h26.md',
          receipt_path: '.omagy/plans/ralplan-receipt-h26.json',
        },
        handoff_artifacts: {
          ralplan: {
            verdict: 'APPROVE',
            receipt_path: '.omagy/plans/ralplan-receipt-h26.json',
          },
        },
      },
    }), 'utf8');

    const h26Srv = createHudServer('h26-tok', { maxSseClients: 2, workspaceRoot: h26EmptyWs });
    const h26Reqs = [];
    try {
      let h26HttpOk = true;
      if (canBindLoopback) {
        await new Promise((resolve) => h26Srv.listen(0, BIND_HOST, resolve));
        const h26Port = h26Srv.address().port;
        const h26Get = (reqPath, headers = {}) => new Promise((resolve, reject) => {
          const req = http.request({ host: BIND_HOST, port: h26Port, path: reqPath, method: 'GET', headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
          });
          req.on('error', reject);
          req.end();
        });
        const openH26Sse = () => new Promise((resolve, reject) => {
          let ended = false;
          const req = http.get({ host: BIND_HOST, port: h26Port, path: '/api/events', headers: { 'X-Sidecar-Token': 'h26-tok' } }, (res) => {
            res.on('end', () => { ended = true; });
            res.on('close', () => { ended = true; });
            res.once('data', () => resolve({ req, res, isEnded: () => ended }));
          });
          req.on('error', () => { ended = true; });
          h26Reqs.push(req);
          setTimeout(() => reject(new Error('H26 SSE open timeout')), 3000).unref();
        });

        const sse1 = await openH26Sse();
        const sse2 = await openH26Sse();
        const sse3 = await openH26Sse();
        for (let i = 0; i < 40 && !sse1.isEnded(); i += 1) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const sse1Evicted = sse1.isEnded();
        const activeAfter3 = h26Srv.getActiveSseClientCount();
        const h26StatusWhileSse = await h26Get('/api/status', { 'X-Sidecar-Token': 'h26-tok' });
        const h26PreloadRes = await h26Get('/preload.js');
        const h26ArtRes = await h26Get(
          `/api/artifact?workspaces=${encodeURIComponent(`${h26StateWs},${h26OtherWs}`)}&rel=${encodeURIComponent('.omagy/artifacts/alt-note.txt')}`,
          { 'X-Sidecar-Token': 'h26-tok' },
        );
        h26HttpOk = sse1Evicted === true
          && activeAfter3 === 2
          && h26StatusWhileSse.status === 200
          && h26PreloadRes.status === 200
          && String(h26PreloadRes.headers['content-type'] || '').includes('application/javascript')
          && h26PreloadRes.headers['x-content-type-options'] === 'nosniff'
          && h26ArtRes.status === 200
          && h26ArtRes.body === 'alt-root-artifact';
      }

      const h26Roots = resolveWorkspaceRoots([h26EmptyWs, h26StateWs]);
      const h26Snap = buildHudSnapshot([h26EmptyWs, h26StateWs], Date.now());
      const h26Rp = h26Snap.reviews?.ralplan;
      const scriptMatch = /<script>([\s\S]*?)<\/script>\s*<\/body>/i.exec(HUD_HTML);
      let clientScriptValid = false;
      if (scriptMatch) {
        try {
          new Function(scriptMatch[1]);
          clientScriptValid = true;
        } catch { /* fail open: syntax error surfaced via clientScriptValid=false */ }
      }

      h26Ok = h26HttpOk
        && HUD_HTML.includes('<script src="/preload.js"></script>')
        && HUD_HTML.includes('visibilitychange')
        && HUD_HTML.includes('AbortController')
        && clientScriptValid === true
        && canonicalizePath(h26Roots.primaryRoot) === canonicalizePath(h26StateWs)
        && h26Rp?.iteration === 3
        && h26Rp?.architectVerdict === 'CLEAR'
        && h26Rp?.criticVerdict === 'APPROVE'
        && h26Rp?.consensusComplete === true
        && Array.isArray(h26Rp?.planningArtifacts)
        && h26Rp.planningArtifacts.includes('.omagy/plans/prd-h26.md')
        && h26Rp.planningArtifacts.includes('.omagy/plans/test-spec-h26.md')
        && h26Rp.planningArtifacts.includes('.omagy/plans/ralplan-review-h26.md')
        && h26Rp.planningArtifacts.includes('.omagy/plans/ralplan-receipt-h26.json')
        && !h26Rp.planningArtifacts.includes('.omagy/plans/ralplan-review-older.md')
        && Array.isArray(h26Rp?.reviewArtifacts)
        && h26Rp.reviewArtifacts.includes('.omagy/plans/ralplan-review-h26.md')
        && h26Rp.reviewArtifacts.includes('.omagy/plans/ralplan-receipt-h26.json')
        && !h26Rp.reviewArtifacts.includes('.omagy/plans/prd-h26.md')
        && !h26Rp.reviewArtifacts.includes('.omagy/plans/test-spec-h26.md')
        && !h26Rp.reviewArtifacts.includes('.omagy/plans/ralplan-review-older.md')
        && h26Snap.artifacts?.plans?.some((p) => p.file === '.omagy/plans/prd-h26.md')
        && h26Snap.artifacts?.plans?.some((p) => p.file === '.omagy/plans/test-spec-h26.md')
        && !h26Snap.artifacts?.plans?.some((p) => p.file.includes('ralplan-review-') || p.file.includes('hyperplan-distillation-'))
        && !HUD_HTML.includes('rpLine + reviewRowsHtml')
        && HUD_HTML.indexOf('${rpLine}') > HUD_HTML.indexOf('Plans, Specs, Handoffs &amp; Artifacts');
    } finally {
      for (const req of h26Reqs) { try { req.destroy(); } catch { /* fail open: SSE client destroyed */ } }
      try {
        h26Srv.closeAllSseClients?.();
        h26Srv.close();
        h26Srv.closeAllConnections?.();
      } catch { /* fail open: H26 server already closed */ }
      rmDirSafe(h26Base);
    }

    // H27: HUD dispatch isolates Codex/legacy-input/foreign-workspace routing, verifies targets without `--`, and unwraps subagents.
    const h27Base = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-h27-'));
    const h27PrevRuntime = process.env.OMAGY_RUNTIME_DIR;
    let h27Ok = false;
    let h27Err = '';
    try {
      const h27WsTarget = path.join(h27Base, 'ws-target');
      const h27WsForeign = path.join(h27Base, 'ws-foreign');
      const h27Rt = path.join(h27Base, 'runtime');
      const h27Brain = path.join(h27Base, 'brain');
      fs.mkdirSync(h27WsTarget, { recursive: true });
      fs.mkdirSync(h27WsForeign, { recursive: true });
      fs.mkdirSync(h27Rt, { recursive: true });
      fs.mkdirSync(path.join(h27Brain, 'conv-sub-good'), { recursive: true });
      fs.mkdirSync(path.join(h27Brain, 'conv-root-good'), { recursive: true });

      const nowMs = Date.now();
      const writeRoutingFixture = (id, body, ageMs) => {
        const p = path.join(h27Rt, `${id}.routing.json`);
        fs.writeFileSync(p, JSON.stringify({ at: new Date(nowMs - ageMs).toISOString(), ...body }));
        const dt = new Date(nowMs - ageMs);
        fs.utimesSync(p, dt, dt);
      };
      writeRoutingFixture('conv-sub-good', { host: 'antigravity', workspaces: [h27WsTarget], skills: ['/doctor'] }, 5000);
      writeRoutingFixture('conv-foreign-agy', { host: 'antigravity', workspaces: [h27WsForeign], skills: ['/ralplan'] }, 4000);
      writeRoutingFixture('conv-legacy-input', { lastUserKey: 'input:1183:app-generated', workspaces: [h27WsTarget], skills: ['/doctor'], transcriptPath: null }, 3000);
      writeRoutingFixture('conv-codex-explicit', { host: 'codex', workspaces: [h27WsTarget], skills: ['/doctor'], transcriptPath: null }, 2000);
      writeRoutingFixture('conv-agy-subagent', { host: 'antigravity', isSubagent: true, workspaces: [h27WsTarget], skills: ['/analyze'] }, 1000);

      process.env.OMAGY_RUNTIME_DIR = h27Rt;
      const h27AgySnap = buildHudSnapshot([h27WsTarget], nowMs, '', { host: 'antigravity' });
      const h27CodexSnap = buildHudSnapshot([h27WsTarget], nowMs, '', { host: 'codex' });
      const h27ResolvedId = resolveActiveConversationId(h27WsTarget, '', { host: 'antigravity', runtimeDir: h27Rt, brainDir: h27Brain });
      const h27Cands = resolveActiveConversationCandidates(h27WsTarget, '', { host: 'antigravity', runtimeDir: h27Rt, brainDir: h27Brain });

      const h27Calls = [];
      const h27Runner = (_bin, args) => {
        const subCmdIdx = args[0] === 'agentapi' ? 1 : 0;
        const subArgs = args.slice(subCmdIdx);
        h27Calls.push(subArgs);
        if (subArgs[0] === 'get-conversation-metadata') {
          const targetId = subArgs[1];
          if (targetId === 'conv-foreign-meta') {
            return JSON.stringify({ metadata: { rootConversationId: 'conv-foreign-meta', workspaceUris: [pathToFileURL(h27WsForeign).href] } });
          }
          if (targetId === 'conv-sub-good') {
            return JSON.stringify({ metadata: { rootConversationId: 'conv-root-good', workspaceUris: [pathToFileURL(h27WsTarget).href] } });
          }
          if (targetId === 'conv-root-good') {
            return JSON.stringify({ metadata: { rootConversationId: 'conv-root-good', workspaceUris: [pathToFileURL(h27WsTarget).href] } });
          }
          throw new Error('rpc error: code = NotFound desc = not_found: trajectory not found');
        }
        return 'dispatched-h27';
      };

      const h27Verified = verifyAntigravityTargetConversation({
        candidates: ['conv-codex-stale', 'conv-foreign-meta', 'conv-sub-good'],
        explicitId: 'conv-codex-stale',
        workspaceRoots: [h27WsTarget],
        runner: h27Runner,
      });

      const h27DispatchGood = dispatchHudAction(
        { mode: 'active-chat', prompt: '/doctor', conversationId: 'conv-codex-stale', workspace: h27WsTarget },
        { runner: h27Runner },
      );

      const h27FallbackCalls = [];
      const h27FailRunner = (_bin, args) => {
        const subCmdIdx = args[0] === 'agentapi' ? 1 : 0;
        const subArgs = args.slice(subCmdIdx);
        h27FallbackCalls.push(subArgs);
        if (subArgs[0] === 'get-conversation-metadata') {
          throw new Error('rpc error: code = NotFound desc = not_found: trajectory not found');
        }
        if (subArgs[0] === 'new-conversation') return 'created-new-h27';
        throw new Error(`unexpected_subcmd:${subArgs[0]}`);
      };
      const h27DispatchFallback = dispatchHudAction(
        { mode: 'active-chat', prompt: '/doctor', conversationId: 'conv-codex-stale', workspace: h27WsTarget },
        { runner: h27FailRunner, clipboardRunner: () => {} },
      );

      const metaCallsNoDash = h27Calls
        .filter((a) => a[0] === 'get-conversation-metadata')
        .every((a) => a.length >= 2 && a[1] !== '--');

      const postDispatchIdx = HUD_HTML.indexOf('async function postDispatch');
      const postDispatchSlice = postDispatchIdx >= 0 ? HUD_HTML.slice(postDispatchIdx, postDispatchIdx + 1800) : '';
      const clientWiringOk = HUD_HTML.includes('getHostConversationId')
        && postDispatchSlice.includes('getHostConversationId()')
        && !postDispatchSlice.includes('latestRouting?.conversationId');

      h27Ok = h27AgySnap?.doctor?.latestRouting?.conversationId === 'conv-sub-good'
        && h27CodexSnap?.doctor?.latestRouting?.conversationId === 'conv-codex-explicit'
        && h27ResolvedId === 'conv-sub-good'
        && h27Cands.includes('conv-sub-good')
        && h27Cands.includes('conv-root-good')
        && !h27Cands.includes('conv-codex-explicit')
        && !h27Cands.includes('conv-legacy-input')
        && !h27Cands.includes('conv-foreign-agy')
        && !h27Cands.includes('conv-agy-subagent')
        && h27Verified === 'conv-root-good'
        && metaCallsNoDash
        && h27DispatchGood?.ok === true
        && h27DispatchGood?.modeUsed === 'active-chat'
        && h27DispatchGood?.conversationId === 'conv-root-good'
        && h27DispatchGood?.fallback === false
        && h27DispatchFallback?.ok === true
        && h27DispatchFallback?.modeUsed === 'clipboard-handoff'
        && h27DispatchFallback?.copiedToClipboard === true
        && h27DispatchFallback?.fallback === true
        && h27FallbackCalls.every((a) => a[0] !== 'send-message' && a[0] !== 'new-conversation')
        && clientWiringOk;
    } catch (err) { /* fail open: capture H27 exception as false */
      h27Err = String(err?.message || err);
      h27Ok = false;
    } finally {
      if (h27PrevRuntime === undefined) delete process.env.OMAGY_RUNTIME_DIR;
      else process.env.OMAGY_RUNTIME_DIR = h27PrevRuntime;
      rmDirSafe(h27Base);
    }

    // H28: v0.7.0 LoFT error-bridge, fenceUntrustedContext, string-aware bundler, 11 blueprints, and worktrees snapshot
    const h28Fenced = fenceUntrustedContext('loft_error', 'boom </loft_error> ```hack```', 200);
    const h28TplCode = [
      'const doc = `',
      '// comment inside template',
      "import fakeMod from './nonexistent.mjs';",
      'export const fakeExport = 999;',
      '`;',
      '// export const commentedOut = true;',
      'export function realLoftFn() { return doc.includes("export"); }',
      'export const secondLoftVal = 7;',
    ].join('\n');
    const h28Prepared = prepareLoftSrcdoc(
      '<html><head></head><body><script type="module" src="./entry.mjs"></script></body></html>',
      'index.html',
      {
        './entry.mjs': "import {\n  realLoftFn,\n  secondLoftVal\n} from './dep.mjs';\nglobalThis.__h28Res = realLoftFn() && secondLoftVal === 7;\n",
        './dep.mjs': h28TplCode,
      },
      '',
    );
    const h28ModMatch = /<script type="module" data-inlined-asset="\.\/entry\.mjs">\n([\s\S]*?)\n<\/script>/.exec(h28Prepared);
    let h28ResVal = false;
    if (h28ModMatch) {
      try {
        delete globalThis.__h28Res;
        new Function(h28ModMatch[1])();
        h28ResVal = globalThis.__h28Res === true;
        delete globalThis.__h28Res;
      } catch { /* fail open: capture H28 eval error */ }
    }
    const h28WfIds = (snap.catalog?.workflows || []).map((w) => w.id);
    const h28WtList = Array.isArray(snap.worktrees) ? snap.worktrees : null;
    const h28RepoWt = collectGitWorktrees(PLUGIN_ROOT);
    const h28NoUserLeak = h28RepoWt.every((w) => !/^\/(?:Users|home)\/[^/]+/.test(String(w.path || '')));
    const h28Ok = h28Fenced.startsWith('<loft_error>')
      && !h28Fenced.includes('</loft_error>\n')
      && h28Fenced.includes('&lt;/loft_error&gt;')
      && HUD_HTML.includes('function fenceUntrustedContext(')
      && h28ResVal
      && !h28Prepared.includes('/* unresolved local module ./nonexistent.mjs */')
      && h28Prepared.includes('id="omagy-loft-error-bridge"')
      && h28Prepared.includes('"omagy-loft-error"')
      && HUD_HTML.includes("event.source === loftFrame.contentWindow")
      && HUD_HTML.includes('data-quick-prompt')
      && HUD_HTML.includes('Dispatch Fix')
      && HUD_HTML.includes('Record Winner')
      && h28WfIds.length === 11
      && ['modernize', 'threat-model', 'release'].every((id) => h28WfIds.includes(id))
      && h28WtList !== null
      && h28NoUserLeak;

    // H29: v0.8.0 crash guards (malformed URL / clientError 400), getCachedWorktrees cache + nogit, team symlink skip + 64 KiB tail log, and readLatestRouting fallback gating
    let h29Ok = false;
    const h29Srv = createHudServer('h29-tok', { workspaceRoot: ws });
    let h29Listening = false;
    try {
      let httpCrashOk = true;
      if (canBindLoopback) {
        await new Promise((resolve) => h29Srv.listen(0, BIND_HOST, resolve));
        h29Listening = true;
        const h29Port = h29Srv.address().port;
        const sendRawHttp = (rawReq) => new Promise((resolve, reject) => {
          const sock = net.connect(h29Port, BIND_HOST);
          const chunks = [];
          sock.setTimeout(2500);
          sock.on('timeout', () => { sock.destroy(); resolve(Buffer.concat(chunks).toString('utf8')); });
          sock.on('connect', () => { sock.write(rawReq); });
          sock.on('data', (c) => chunks.push(c));
          sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          sock.on('error', (err) => {
            if (chunks.length) resolve(Buffer.concat(chunks).toString('utf8'));
            else reject(err);
          });
        });
        const badUrlRes = await sendRawHttp('GET http://[invalid HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
        const clientErrRes = await sendRawHttp('BAD_REQ_LINE\r\n\r\n');
        const aliveRes = await new Promise((resolve, reject) => {
          const req = http.request({ host: BIND_HOST, port: h29Port, path: '/preload.js', method: 'GET' }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          });
          req.on('error', reject);
          req.end();
        });
        httpCrashOk = badUrlRes.includes('400') && badUrlRes.includes('bad_request_url')
          && clientErrRes.includes('400')
          && aliveRes === 200;
      }

      const h29NoGit = path.join(ws, 'h29-nogit');
      fs.mkdirSync(h29NoGit, { recursive: true });
      const h29T0 = Date.now();
      const nogitWt = getCachedWorktrees(h29NoGit, h29T0);
      const gWt1 = getCachedWorktrees(PLUGIN_ROOT, h29T0);
      const gWt2 = getCachedWorktrees(PLUGIN_ROOT, h29T0 + 100);
      const wtCacheOk = Array.isArray(nogitWt) && nogitWt.length === 0 && gWt1 === gWt2 && Array.isArray(gWt1);

      const h29TeamWs = path.join(ws, 'h29-team-sym');
      const h29ExtDir = path.join(ws, 'h29-ext-team');
      fs.mkdirSync(path.join(h29TeamWs, '.omagy', 'state', 'team'), { recursive: true });
      fs.mkdirSync(path.join(h29TeamWs, '.omagy', 'logs'), { recursive: true });
      fs.mkdirSync(h29ExtDir, { recursive: true });
      fs.writeFileSync(path.join(h29ExtDir, 'tasks.json'), JSON.stringify({ team: 'sym-team', tasks: [{ id: '1', status: 'in_progress' }] }), 'utf8');
      try {
        fs.symlinkSync(h29ExtDir, path.join(h29TeamWs, '.omagy', 'state', 'team', 'sym-team'));
      } catch { /* fail open: ignore symlink creation on win32 without symlink perms */ }
      const bigErr = JSON.stringify({ at: '2026-11-15T00:00:00Z', event: 'stop', error: 'pad_'.repeat(300) });
      fs.writeFileSync(
        path.join(h29TeamWs, '.omagy', 'logs', 'hook-errors.jsonl'),
        `${Array.from({ length: 70 }, () => bigErr).join('\n')}\n${JSON.stringify({ at: '2026-11-15T01:00:00Z', event: 'stop', error: 'h29_tail_marker' })}\n`,
        'utf8',
      );
      const h29Snap = buildHudSnapshot([h29TeamWs], Date.now());
      const symTailOk = !h29Snap.teams.some((t) => t.team === 'sym-team')
        && Array.isArray(h29Snap.doctor?.hookErrors)
        && h29Snap.doctor.hookErrors.some((e) => e.error === 'h29_tail_marker');

      const h29RtBox = path.join(ws, 'h29-routing-iso');
      const h29IsoTmp = path.join(h29RtBox, 'tmp');
      const h29Xdg = path.join(h29RtBox, 'xdg');
      const h29LegacyDir = path.join(h29IsoTmp, 'oh-my-agy');
      const h29PrimaryDir = path.join(h29Xdg, 'oh-my-agy');
      fs.mkdirSync(h29LegacyDir, { recursive: true });
      fs.writeFileSync(path.join(h29LegacyDir, 'sess-h29.routing.json'), JSON.stringify({ host: 'antigravity', at: '2026-11-15T10:00:00Z', skills: ['analyze'], workspaces: [h29TeamWs] }), 'utf8');
      const h29SavedEnv = {
        OMAGY_RUNTIME_DIR: process.env.OMAGY_RUNTIME_DIR,
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
        TMPDIR: process.env.TMPDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
      };
      let routingFallbackOk = false;
      try {
        delete process.env.OMAGY_RUNTIME_DIR;
        process.env.XDG_RUNTIME_DIR = h29Xdg;
        process.env.TMPDIR = h29IsoTmp;
        process.env.TEMP = h29IsoTmp;
        process.env.TMP = h29IsoTmp;
        const hitLegacy = readLatestRouting(undefined, { roots: [h29TeamWs] });
        const candLegacy = resolveActiveConversationCandidates(h29TeamWs);
        const missCustomArg = readLatestRouting(path.join(h29RtBox, 'custom-rt'), { roots: [h29TeamWs] });
        const missCustomOpt = readLatestRouting(undefined, { runtimeDir: path.join(h29RtBox, 'opt-rt'), roots: [h29TeamWs] });
        const candMissOpt = resolveActiveConversationCandidates(h29TeamWs, '', { runtimeDir: path.join(h29RtBox, 'opt-rt') });
        process.env.OMAGY_RUNTIME_DIR = path.join(h29RtBox, 'env-rt');
        const missEnv = readLatestRouting(undefined, { roots: [h29TeamWs] });
        const candMissEnv = resolveActiveConversationCandidates(h29TeamWs);
        delete process.env.OMAGY_RUNTIME_DIR;
        fs.mkdirSync(h29PrimaryDir, { recursive: true });
        fs.writeFileSync(path.join(h29PrimaryDir, 'sess-h29.routing.json'), JSON.stringify({ host: 'antigravity', at: '2026-11-15T10:01:00Z', skills: ['code-review'], workspaces: [h29TeamWs] }), 'utf8');
        const hitPrimary = readLatestRouting(undefined, { roots: [h29TeamWs] });
        routingFallbackOk = hitLegacy?.skills?.[0] === 'analyze'
          && candLegacy.includes('sess-h29')
          && missCustomArg === null
          && missCustomOpt === null
          && !candMissOpt.includes('sess-h29')
          && missEnv === null
          && !candMissEnv.includes('sess-h29')
          && hitPrimary?.skills?.[0] === 'code-review';
      } finally {
        for (const [k, v] of Object.entries(h29SavedEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }

      // Verify PLUGIN_ROOT precedence and PLUGIN_DATA global notifications.json fallback
      const g4RootA = path.join(ws, 'g4-plugin-a');
      const g4RootB = path.join(ws, 'g4-plugin-b');
      const g4Self = path.join(ws, 'g4-plugin-self');
      fs.mkdirSync(g4RootA, { recursive: true });
      fs.mkdirSync(g4RootB, { recursive: true });
      fs.mkdirSync(g4Self, { recursive: true });
      fs.writeFileSync(path.join(g4RootA, 'plugin.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(g4RootB, 'plugin.json'), '{}', 'utf8');
      const g4RootOk = resolveCanonicalPluginRoot(g4Self, { OMAGY_PLUGIN_ROOT: g4RootA, PLUGIN_ROOT: g4RootB }) === path.resolve(g4RootA)
        && resolveCanonicalPluginRoot(g4Self, { PLUGIN_ROOT: g4RootB }) === path.resolve(g4RootB)
        && resolveCanonicalPluginRoot(g4Self, {}) === path.resolve(g4Self);
      const g4DataDir = path.join(rtDir, 'plugin-data');
      fs.mkdirSync(g4DataDir, { recursive: true });
      fs.writeFileSync(path.join(g4DataDir, 'notifications.json'), JSON.stringify({ telegram: { enabled: true }, command: { enabled: true } }), 'utf8');
      const g4NotifWs = path.join(ws, 'g4-notif-ws');
      fs.mkdirSync(path.join(g4NotifWs, '.omagy'), { recursive: true });
      fs.writeFileSync(path.join(g4NotifWs, '.omagy', 'notifications.json'), JSON.stringify({ command: { enabled: false } }), 'utf8');
      const g4Notifs = readNotificationBooleans(g4NotifWs);
      const g4NotifOk = g4Notifs.telegram === true && g4Notifs.command === false && g4Notifs.slack === false;

      h29Ok = httpCrashOk && wtCacheOk && symTailOk && routingFallbackOk && g4RootOk && g4NotifOk;
    } finally {
      if (h29Listening) await new Promise((resolve) => h29Srv.close(resolve));
    }

    const fg = snap.codeHealth?.floorGuard;
    const se = snap.doctor?.skillEval;
    const coreSnapHttp = JSON.stringify(snap.allowedViews) === JSON.stringify(['overview', 'workflows', 'skills', 'subagents', 'wiki'])
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
      && snap.catalog?.skills?.length === 23
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
      && Boolean(se && se.ok === true && se.rank1Pct >= 95 && se.minRank1 === 95 && se.collisionErrors === 0 && se.negativeSurvivalPct === 100)
      && snap.catalog?.subagents?.length === 18
      && snap.catalog.subagents.every((a) => Boolean(a.defaultPrompt))
      && Boolean(architectAgent && architectAgent.cliModel === '' && architectAgent.modelTier === 'inherit')
      && Boolean(exploreAgent && exploreAgent.cliModel === 'flash')
      && Boolean(docStewardAgent && docStewardAgent.cliModel === 'flash')
      && snap.catalog?.workflows?.length >= 6
      && Boolean(autopilotWf && autopilotWf.active === true && autopilotWf.currentPhase === 'ultragoal')
      && Boolean(dActive.ok && dActive.modeUsed === 'active-chat' && !dActive.fallback && dActive.args.includes('send-message') && dActive.args.includes('--'))
      && Boolean(dFallback.ok && dFallback.modeUsed === 'clipboard-handoff' && dFallback.fallback === true && dFallback.copiedToClipboard === true && dFallback.clipboardPrompt.includes('/deep-research'))
      && Boolean(dSubActive.ok && dSubActive.modeUsed === 'subagent-active' && dSubActive.args.some((x) => x.includes('invoke_subagent')))
      && Boolean(dSubFallback.ok && dSubFallback.modeUsed === 'clipboard-handoff' && dSubFallback.fallback === true && dSubFallback.agent === 'architect' && dSubFallback.model === 'inherit' && dSubFallback.clipboardPrompt.includes('invoke_subagent') && dSubExplicitPro.ok && dSubExplicitPro.model === 'pro' && !dSubStandalone.ok && dSubStandalone.status === 400 && !dNewChatRejected.ok && dNewChatRejected.status === 400)
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
      && !HUD_HTML.includes('Shadow Checkpoints')
      && !HUD_HTML.includes('>New Chat<')
      && !HUD_HTML.includes('Launch Standalone Chat')
      && !HUD_HTML.includes("runFromInput(this, this.dataset.inputId, 'new-chat')")
      && !HUD_HTML.includes("'subagent-standalone'")
      && HUD_HTML.includes('data-hud-key="ov-failure-clusters"')
      && HUD_HTML.includes('<span class="summary-label">Top Failure Clusters</span>')
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
      && blockedRootTraversal === null;

    // H30: Dynamic Pause/Continue control API, anti-stale paused snapshot, 3-state smart toggle & Antigravity Aux Pane seenWorkspaceRoots vetting
    let h30Ok = false;
    const h30Ws = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-hud-h30-'));
    try {
      const h30StateDir = path.join(h30Ws, '.omagy', 'state');
      const h30ChildWs = path.join(h30Ws, 'pkg', 'a');
      fs.mkdirSync(h30StateDir, { recursive: true });
      fs.mkdirSync(path.join(h30ChildWs, '.omagy', 'state'), { recursive: true });
      const h30ApFile = path.join(h30StateDir, 'autopilot-state.json');
      const agedTs = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
      fs.writeFileSync(h30ApFile, JSON.stringify({
        mode: 'autopilot',
        active: true,
        current_phase: 'ultragoal',
        iteration: 2,
        updated_at: new Date().toISOString(),
      }));

      // H-PAUSE-1: Aged paused snapshot telemetry (anti-stale, zero phantom pause mode, paused statusLine, multi-root preservation)
      pauseWorkspaceExecution(h30Ws, { source: 'hud' });
      const pausedApRaw = JSON.parse(fs.readFileSync(h30ApFile, 'utf8'));
      fs.writeFileSync(h30ApFile, JSON.stringify({ ...pausedApRaw, updated_at: agedTs, paused_at: agedTs }));
      const h30OtherEmpty = path.join(h30Ws, 'secondary-empty');
      fs.mkdirSync(h30OtherEmpty, { recursive: true });
      const h30SnapPaused = buildHudSnapshot([h30Ws, h30OtherEmpty], Date.now(), h30Ws);
      const h30ApMode = (h30SnapPaused.modes || []).find((m) => m.mode === 'autopilot');
      const h30Sel = selectCurrentMode(h30SnapPaused.modes || []);
      const h30NoPhantom = !(h30SnapPaused.modes || []).some((m) => m.mode === 'pause');

      const h30StatelessWs = path.join(h30Ws, 'stateless-only');
      fs.mkdirSync(h30StatelessWs, { recursive: true });
      pauseWorkspaceExecution(h30StatelessWs, { source: 'hud' });
      const h30SnapStateless = buildHudSnapshot([h30StatelessWs], Date.now());
      resumeWorkspaceExecution(h30StatelessWs);
      resumeWorkspaceExecution(h30Ws);

      const hPause1Ok = h30SnapPaused.pauseState?.paused === true
        && h30SnapPaused.pauseStatesByScope?.['.']?.paused === true
        && h30NoPhantom
        && Boolean(h30ApMode && h30ApMode.paused === true && h30ApMode.stale === false)
        && h30Sel.current?.mode === 'autopilot'
        && h30SnapPaused.statusLine === '[OMA] PAUSED | autopilot:ultragoal'
        && h30SnapStateless.statusLine === '[OMA] PAUSED';

      // H-PAUSE-2: 3-state smart toggle & multi-scope filtering
      const nowH30 = Date.now();
      const csRunningMode = resolveWorkspaceControlState({
        modes: [{ mode: 'autopilot', active: true, stale: false, paused: false, scope: '.' }],
        pauseState: { paused: false },
        pauseStatesByScope: { '.': { paused: false } },
      }, 'all', nowH30);
      const csRunningRouting = resolveWorkspaceControlState({
        modes: [],
        pauseState: { paused: false },
        pauseStatesByScope: { '.': { paused: false } },
        doctor: { latestRouting: { skills: ['analyze'], at: new Date(nowH30 - 30_000).toISOString() } },
      }, 'all', nowH30);
      const csPaused = resolveWorkspaceControlState({
        modes: [],
        pauseState: { paused: true },
        pauseStatesByScope: { '.': { paused: true } },
      }, 'all', nowH30);
      const csIdle = resolveWorkspaceControlState({
        modes: [],
        pauseState: { paused: false },
        pauseStatesByScope: { '.': { paused: false } },
      }, 'all', nowH30);
      const multiScopeData = {
        modes: [],
        pauseState: { paused: true, scope: 'pkg/a' },
        pauseStatesByScope: { '.': { paused: false }, 'pkg/a': { paused: true } },
      };
      const csScopeChildPaused = resolveWorkspaceControlState(multiScopeData, 'pkg/a', nowH30);
      const csScopeRootIdle = resolveWorkspaceControlState(multiScopeData, '.', nowH30);
      const hPause2Ok = csRunningMode === 'running'
        && csRunningRouting === 'running'
        && csPaused === 'paused'
        && csIdle === 'idle'
        && csScopeChildPaused === 'paused'
        && csScopeRootIdle === 'idle';

      // H-PAUSE-3: POST /api/workflow-control security, Aux Pane no-workspaceRoot vetting & round-trip
      const h30Calls = [];
      const h30Runner = (cmd, args) => {
        h30Calls.push({ cmd, args });
        if (args.includes('get-conversation-metadata')) return JSON.stringify({ conversationId: 'conv-h30', workspacePaths: [h30Ws] });
        return JSON.stringify({ ok: true });
      };
      const h30DesktopSrv = createHudServer('h30-tok', { desktopServe: true, workspaceRoot: h30Ws, runner: h30Runner });
      const h30AuxSrv = createHudServer('h30-aux', { runner: h30Runner });
      const h30Unauth = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', host: '127.0.0.1:48801', origin: 'http://127.0.0.1:48801' }, { action: 'pause' }, h30DesktopSrv);
      const h30BadOrigin = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', 'x-sidecar-token': 'h30-tok', host: '127.0.0.1:48801', origin: 'http://evil.example' }, { action: 'pause' }, h30DesktopSrv);
      const h30BadCt = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'text/plain', 'x-sidecar-token': 'h30-tok', host: '127.0.0.1:48801', origin: 'http://127.0.0.1:48801' }, 'pause', h30DesktopSrv);
      const h30BadAct = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', 'x-sidecar-token': 'h30-tok', host: '127.0.0.1:48801', origin: 'http://127.0.0.1:48801' }, { action: 'explode' }, h30DesktopSrv);
      const h30HostileWs = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', 'x-sidecar-token': 'h30-tok', host: '127.0.0.1:48801', origin: 'http://127.0.0.1:48801' }, { action: 'pause', workspace: '/etc' }, h30DesktopSrv);
      const h30HostileScope = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', 'x-sidecar-token': 'h30-tok', host: '127.0.0.1:48801', origin: 'http://127.0.0.1:48801' }, { action: 'pause', workspace: h30Ws, scope: '../../outside' }, h30DesktopSrv);

      // Antigravity Aux Pane mode (no startup options.workspaceRoot): GET /api/status seeds seenWorkspaceRoots
      const h30AuxStatus = await invokeHttp('GET', `/api/status?workspaces=${encodeURIComponent(JSON.stringify([h30Ws]))}`, { 'x-sidecar-token': 'h30-aux' }, null, h30AuxSrv);
      const h30AuxPause = await invokeHttp('POST', `/api/workflow-control?workspaces=${encodeURIComponent(JSON.stringify([h30Ws]))}`, { 'content-type': 'application/json', 'x-sidecar-token': 'h30-aux' }, { action: 'pause', workspace: h30Ws, scope: 'all' }, h30AuxSrv);
      const h30AuxSelfVet = await invokeHttp('POST', `/api/workflow-control?workspaces=${encodeURIComponent(JSON.stringify(['/etc']))}`, { 'content-type': 'application/json', 'x-sidecar-token': 'h30-aux' }, { action: 'pause', workspace: '/etc' }, h30AuxSrv);
      const h30PauseFileExists = fs.existsSync(path.join(h30StateDir, 'pause.json'));
      const h30AuxResume = await invokeHttp('POST', `/api/workflow-control?workspaces=${encodeURIComponent(JSON.stringify([h30Ws]))}`, { 'content-type': 'application/json', 'x-sidecar-token': 'h30-aux' }, { action: 'resume', workspace: h30Ws, scope: 'all', conversationId: 'conv-h30', dispatchResume: true }, h30AuxSrv);
      const h30PauseFileGone = !fs.existsSync(path.join(h30StateDir, 'pause.json'));
      const h30ApRestored = JSON.parse(fs.readFileSync(h30ApFile, 'utf8')).active === true;
      const h30IdleResume = await handleWorkflowControl({ action: 'resume', workspace: h30Ws, dispatchResume: false }, { vettedRoots: [h30Ws], runner: h30Runner });

      // Child-scope session-only mode paused & resumed via scope:'all', plus anchored child-folder Aux Pane seeding
      const h30ChildSessDir = path.join(h30ChildWs, '.omagy', 'state', 'sessions', 'sess-1');
      fs.mkdirSync(h30ChildSessDir, { recursive: true });
      const h30ChildSessFile = path.join(h30ChildSessDir, 'autopilot-state.json');
      fs.writeFileSync(h30ChildSessFile, JSON.stringify({ mode: 'autopilot', active: true, current_phase: 'ralplan', updated_at: new Date().toISOString() }));
      const h30AllPause = await handleWorkflowControl({ action: 'pause', workspace: h30Ws, scope: 'all' }, { vettedRoots: [h30Ws], runner: h30Runner });
      const h30ChildSessPaused = JSON.parse(fs.readFileSync(h30ChildSessFile, 'utf8')).paused === true;
      const h30AllResume = await handleWorkflowControl({ action: 'resume', workspace: h30Ws, scope: 'all', dispatchResume: false }, { vettedRoots: [h30Ws], runner: h30Runner });
      const h30ChildSessResumed = JSON.parse(fs.readFileSync(h30ChildSessFile, 'utf8')).active === true;

      const h30AnchoredSub = path.join(h30Ws, 'sub-pkg');
      fs.mkdirSync(h30AnchoredSub, { recursive: true });
      const h30AuxAnchoredSrv = createHudServer('h30-anch', { runner: h30Runner });
      const h30AnchStatus = await invokeHttp('GET', `/api/status?workspaces=${encodeURIComponent(JSON.stringify([h30AnchoredSub]))}`, { 'x-sidecar-token': 'h30-anch' }, null, h30AuxAnchoredSrv);
      const h30AnchSnap = JSON.parse(h30AnchStatus.body || '{}');
      const h30AnchPause = await invokeHttp('POST', '/api/workflow-control', { 'content-type': 'application/json', 'x-sidecar-token': 'h30-anch' }, { action: 'pause', workspace: h30AnchSnap.workspace }, h30AuxAnchoredSrv);
      resumeWorkspaceExecution(h30Ws);

      const hPause3Ok = h30Unauth.status === 401
        && h30BadOrigin.status === 403
        && h30BadCt.status === 415
        && h30BadAct.status === 400
        && h30HostileWs.status === 403
        && h30HostileScope.status === 400
        && h30AuxStatus.status === 200
        && h30AuxPause.status === 200
        && h30AuxSelfVet.status === 403
        && h30PauseFileExists
        && h30AuxResume.status === 200
        && h30PauseFileGone
        && h30ApRestored
        && h30Calls.some((c) => c.args.includes('continue'))
        && h30IdleResume.ok === true && h30IdleResume.wasPaused === false
        && h30AllPause.ok === true && h30ChildSessPaused
        && h30AllResume.ok === true && h30ChildSessResumed
        && h30AnchStatus.status === 200 && h30AnchPause.status === 200;

      // H-PAUSE-4: HTML/CSS & sharedHelpersSource contract
      const hPause4Ok = HUD_HTML.includes('toggleWorkflowPause')
        && HUD_HTML.includes('resolveWorkspaceControlState')
        && HUD_HTML.includes('getFreshRoutingHint')
        && HUD_HTML.includes('.badge-warn')
        && HUD_HTML.includes('.action-btn-warn')
        && HUD_HTML.includes('>Pause<')
        && HUD_HTML.includes('>Continue<');

      h30Ok = hPause1Ok && hPause2Ok && hPause3Ok && hPause4Ok;
    } finally {
      rmDirSafe(h30Ws);
    }

    const namedChecks = {
      coreSnapHttp,
      floorCacheOk,
      innerSnapOk,
      h13Ok,
      h14Ok,
      h15Ok,
      h16Ok,
      h17Ok,
      h18Ok,
      h19Ok,
      h20Ok,
      h21Ok,
      h22Ok,
      h23Ok,
      h24Ok,
      h25Ok,
      h26Ok,
      h27Ok,
      h28Ok,
      h29Ok,
      h30Ok,
    };
    const failedChecks = Object.entries(namedChecks)
      .filter(([, v]) => !v)
      .map(([k]) => (k === 'h27Ok' && h27Err ? `h27Ok:${h27Err}` : k));
    const ok = failedChecks.length === 0;

    process.stdout.write(`${JSON.stringify({
      selftest: ok ? 'PASS' : 'FAIL',
      views: snap.allowedViews.length,
      skills: snap.catalog?.skills?.length || 0,
      subagents: snap.catalog?.subagents?.length || 0,
      workflows: snap.catalog?.workflows?.length || 0,
      dispatchChecks: calls.length,
      statusLine: snap.statusLine,
      ...(sandboxLoopbackSkipped ? { sandboxLoopbackSkipped: true } : {}),
      ...(ok ? {} : { failedChecks }),
    })}\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (origRuntimeDir === undefined) delete process.env.OMAGY_RUNTIME_DIR;
    else process.env.OMAGY_RUNTIME_DIR = origRuntimeDir;
    if (origPluginData === undefined) delete process.env.PLUGIN_DATA;
    else process.env.PLUGIN_DATA = origPluginData;
    rmDirSafe(rtDir);
    rmDirSafe(ws);
  }
}
