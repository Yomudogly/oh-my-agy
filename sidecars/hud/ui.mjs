// oh-my-agy HUD UI Module (zero-dependency HTML/CSS/JS renderer for Antigravity Auxiliary Pane).
// Extracted from sidecars/hud/main.mjs so backend HTTP/SSE logic and frontend UI stay modular.

const ALLOWED_VIEWS = ['overview', 'workflows', 'skills', 'subagents', 'wiki'];

export function renderHudHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Oh My Agy</title>
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
      font-size: 12px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
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
      font-variant-numeric: tabular-nums;
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
      font-size: 12px;
      color: var(--muted-foreground, #9ca3af);
      margin-bottom: 3px;
    }
    .health-stat-val {
      font-weight: 600;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      overflow-wrap: anywhere;
    }
    .health-stat-sub {
      font-size: 12px;
      color: var(--muted-foreground, #9ca3af);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }
    .health-section-title {
      font-size: 12px;
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
      if (!event.source || (event.source !== window.parent && event.source !== window)) return;
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
        navigator.clipboard.writeText(text).then(() => flashButton(btn, 'Copied!')).catch(() => { /* fail open: clipboard write unavailable */ });
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
        const data = await res.json().catch(() => { /* fail open: non-JSON dispatch error payload */ return {}; });
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
      } catch (e) { /* fail open: dispatch network failure */
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
      } catch (e) { /* fail open: transient status fetch failure */
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
            <div class="muted" style="font-size:12px;margin-top:2px;">\${m.active ? (m.awaitingConfirmation ? 'WAITING CONFIRMATION' : (m.stale ? 'stale (>6h)' : 'active')) : 'inactive'}\${m.iteration != null ? \` &middot; #\${esc(m.iteration)}\` : ''}</div>
          </td>
          <td class="col-scope muted">\${esc(m.session)}</td>
        </tr>\`).join('');

      const qgRows = (data.qualityGates || []).map((g) => \`<li><code>\${esc(g.stage)}</code> &rarr; <code>\${esc(g.skill)}</code> (\${esc(g.mode)}, \${esc(g.model)})</li>\`).join('');

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
              <div class="muted" style="font-size:12px;margin-top:2px;">Rigor: <code>\${esc(g.rigor)}</code> &middot; Retries: \${g.productFailures}/3</div>
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

      let teamHtml = '';
      if (data.teams && data.teams.length) {
        teamHtml = data.teams.map((t) => {
          const tScope = t.scope && t.scope !== '.' ? \` <span class="badge">Scope: \${esc(t.scope)}</span>\` : '';
          const rows = (t.tasks || []).map((task) => \`
            <tr>
              <td class="col-id"><code>\${esc(task.id)}</code></td>
              <td class="col-main">
                <div>\${esc(task.title)}</div>
                <div class="muted" style="font-size:12px;margin-top:2px;">Role: <code>\${esc(task.role)}</code> &middot; Evidence: \${task.requiresCodeChange ? (task.hasEvidence ? 'verified' : 'pending') : 'n/a'}</div>
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

      const ch = data.codeHealth || { reused: [], created: [], reusedCount: 0, newCount: 0, reusePct: null, openCallers: [], debtTotal: 0, noTriggerCount: 0, debtItems: [], verificationFreshness: 'none', lastVerifyCmd: '', lastEditedTarget: '' };
      const vfStatus = String(ch.verificationFreshness || 'none');
      const vfBadgeCls = vfStatus === 'pass' ? 'badge badge-active' : 'badge';
      const vfDetail = vfStatus === 'stale' && ch.lastEditedTarget
        ? \`Edited after pass: \${ch.lastEditedTarget}\`
        : (ch.lastVerifyCmd ? \`Last verify: \${ch.lastVerifyCmd}\` : 'No verification run in transcript tail');
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
            \${oc.snippet ? \`<div class="muted" style="font-size:12px;margin-top:4px;"><code>\${esc(oc.snippet)}</code></div>\` : ''}
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
            <div style="font-size:12px;margin-top:2px;"><span class="muted">Upgrade when:</span> \${it.upgrade ? esc(it.upgrade) : '<span class="muted">Not specified (add comma + upgrade condition)</span>'}</div>
          </div>\`).join('')}\` : '<div class="muted" style="font-size:12px;margin-top:4px;">No <code>shortcut:</code> or <code>ceiling:</code> comments recorded in workspace.</div>';

      const codeHealthHtml = \`
        <div class="card">
          <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;">Code Health &amp; Technical Debt</div>
              <div class="muted" style="font-size:12px;margin-top:2px;">Uncommitted git diff symbol reuse, orphaned call sites, floor-guard anti-tampering, verification freshness, and documented code shortcuts</div>
            </div>
            <span class="\${vfBadgeCls}" title="\${esc(vfDetail)}">Verification: \${esc(vfStatus.toUpperCase())}</span>
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

      const doc = data.doctor || {};
      const se = doc.skillEval;
      const seLabel = se && se.ok ? \`PASS (\${esc(se.rank1Pct)}%)\` : 'FAIL';
      const errRows = (doc.hookErrors || []).map((e) => \`
        <tr>
          <td class="col-event">
            <div><code>\${esc(e.event)}</code></div>
            <div class="muted" style="font-size:12px;">\${esc(e.at)}</div>
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
        ? \`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="muted" style="font-size:12px;">Tracked .omagy scopes:</span>\${(data.trackedScopes || []).map((sc) => \`<span class="badge \${sc.scope !== '.' ? 'badge-active' : ''}"><code>\${esc(sc.scope)}</code></span>\`).join('')}</div>\`
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
    setInterval(loadSnapshot, 15000);
  </script>
</body>
</html>`;
}

export const HUD_HTML = renderHudHtml();
