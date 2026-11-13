// oh-my-agy HUD Client Script Builder (zero-dependency browser UI script generator).

export function renderHudClientScript(sharedHelpersSource, allowedViews = ['overview', 'workflows', 'skills', 'subagents', 'wiki']) {
  return `
    ${sharedHelpersSource}
    const ALLOWED = ${JSON.stringify(allowedViews)};
    const MODEL_TIERS = ['inherit', 'flash_lite', 'flash', 'pro'];
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    let activeView = ALLOWED.includes(params.get('view')) ? params.get('view') : 'overview';
    let selectedWikiSlug = params.get('slug') || '';
    let wikiCategory = 'All';
    let wikiViewMode = params.get('wikimode') === 'list' ? 'list' : '3d';
    let overviewReviewTab = '';
    let skillSearch = '';
    let skillCategory = 'All';
    let subagentSearch = '';
    let subagentLane = 'All';
    let workspaceUris = [];
    let latestData = null;
    let lastSnapshotDigest = '';
    let activeEventSource = null;
    let pendingCancelConfirm = false;
    let cancelConfirmTimer = null;
    const editedPrompts = {};
    const selectedSkillFlags = {};
    const selectedSubagentModels = {};
    const persistedDetailsState = {};
    const slidingPillRects = {};
    let activeDrawerObjectUrls = [];
    let currentVrState = null;
    let currentLoftState = null;
    let drawerTriggerEl = null;
    let drawerReqSeq = 0;
    let drawerSkeletonTimer = null;
    let hasMountedInitialTab = false;
    let pendingWikiDocTransition = false;
    let pendingSkillFilterAnim = false;
    let pendingSubagentFilterAnim = false;
    let activeRoot = params.get('activeRoot') || '';
    let activeScopeFilter = params.get('scope') || 'all';
    let cmdPaletteOpen = false;
    let cmdPaletteQuery = '';
    let cmdPaletteSelected = 0;
    let cmdPaletteItems = [];
    let cmdPaletteTriggerEl = null;
    let wikiQueryText = '';
    let wikiSearchResults = null;
    let wikiSearchTimer = null;

    function syncUrlState() {
      try {
        const next = new URLSearchParams(window.location.search);
        next.set('view', activeView);
        if (activeRoot) next.set('activeRoot', activeRoot);
        else next.delete('activeRoot');
        if (activeScopeFilter && activeScopeFilter !== 'all') next.set('scope', activeScopeFilter);
        else next.delete('scope');
        if (activeView === 'wiki' && selectedWikiSlug) next.set('slug', selectedWikiSlug);
        else next.delete('slug');
        if (activeView === 'wiki' && wikiViewMode === 'list') next.set('wikimode', 'list');
        else next.delete('wikimode');
        window.history.replaceState(null, '', '?' + next.toString());
      } catch { /* fail open: history.replaceState unavailable in restricted webview */ }
    }

    function setSsePill(label, isLive) {
      const el = document.getElementById('sse-status-pill');
      if (!el) return;
      el.textContent = label;
      el.classList.toggle('badge-live', Boolean(isLive));
    }

    function buildStreamQuery() {
      const q = new URLSearchParams();
      if (token) q.set('token', token);
      if (workspaceUris.length) q.set('workspaces', JSON.stringify(workspaceUris));
      if (activeRoot) q.set('activeRoot', activeRoot);
      return q;
    }

    function connectEventStream() {
      if (activeEventSource) {
        try { activeEventSource.close(); } catch { /* fail open: previous EventSource already closed */ }
        activeEventSource = null;
      }
      if (typeof window.EventSource !== 'function') {
        setSsePill('POLL', false);
        return;
      }
      try {
        const es = new EventSource('/api/events?' + buildStreamQuery().toString());
        activeEventSource = es;
        es.onopen = () => setSsePill('LIVE', true);
        es.addEventListener('snapshot', (ev) => {
          try {
            const snap = JSON.parse(ev.data || '{}');
            setSsePill('LIVE', true);
            applySnapshot(snap, false);
          } catch { /* fail open: ignore malformed SSE JSON payload */ }
        });
        es.onerror = () => {
          setSsePill('POLL', false);
        };
      } catch { /* fail open: EventSource blocked; 15s poll fallback remains active */
        setSsePill('POLL', false);
      }
    }

    window.addEventListener('message', (event) => {
      if (!event.source || (event.source !== window.parent && event.source !== window)) return;
      if (event.data?.type === 'theme-change' && event.data.payload?.cssVariables) {
        for (const [k, v] of Object.entries(event.data.payload.cssVariables)) {
          document.documentElement.style.setProperty(k, v);
        }
        const rawTheme = String(event.data.payload.theme || event.data.payload.colorScheme || '').toLowerCase();
        if (rawTheme.includes('light') || rawTheme.includes('dark')) {
          const isLight = rawTheme.includes('light') && !rawTheme.includes('dark');
          document.documentElement.classList.toggle('light', isLight);
          document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
        }
        if (currentLoftState && document.getElementById('artifact-drawer').classList.contains('is-open')) {
          renderLoftFrame();
        }
        requestMindMapDraw();
      } else if (event.data?.type === 'workspace-change' && Array.isArray(event.data.payload?.workspaceUris)) {
        workspaceUris = event.data.payload.workspaceUris;
        lastSnapshotDigest = '';
        connectEventStream();
        loadSnapshot(true);
      }
    });

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    function syncSlidingTabPill(barEl, immediate = false) {
      if (!barEl) return;
      const activeBtn = barEl.querySelector('.tab-btn.active, .wiki-mode-btn.active');
      if (!activeBtn) return;
      const w = activeBtn.offsetWidth;
      const h = activeBtn.offsetHeight;
      if (w <= 0 || h <= 0) return;
      const x = activeBtn.offsetLeft;
      const y = activeBtn.offsetTop;
      const pillId = barEl.dataset.slidingTabs || '';
      let pill = barEl.querySelector(':scope > .tab-pill-indicator');
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'tab-pill-indicator';
        pill.setAttribute('aria-hidden', 'true');
        barEl.insertBefore(pill, barEl.firstChild);
      }
      const prevRect = pillId ? slidingPillRects[pillId] : null;
      const skipAnim = immediate || prefersReducedMotion() || !prevRect;
      pill.style.width = w + 'px';
      pill.style.height = h + 'px';
      if (skipAnim) {
        pill.style.transition = 'none';
        pill.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0) scale(1, 1)';
        barEl.classList.add('has-sliding-pill');
        void pill.offsetWidth;
        pill.style.transition = '';
      } else {
        const sx = prevRect.w > 0 ? (prevRect.w / w) : 1;
        const sy = prevRect.h > 0 ? (prevRect.h / h) : 1;
        pill.style.transition = 'none';
        pill.style.transform = 'translate3d(' + prevRect.x + 'px, ' + prevRect.y + 'px, 0) scale(' + sx.toFixed(4) + ', ' + sy.toFixed(4) + ')';
        barEl.classList.add('has-sliding-pill');
        void pill.offsetWidth;
        requestAnimationFrame(() => {
          pill.style.transition = '';
          pill.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0) scale(1, 1)';
        });
      }
      if (pillId) {
        slidingPillRects[pillId] = { x, y, w, h };
      }
    }

    function syncAllSlidingPills(immediate = false) {
      document.querySelectorAll('[data-sliding-tabs]').forEach((barEl) => {
        syncSlidingTabPill(barEl, immediate);
      });
    }

    function captureUiState() {
      document.querySelectorAll('details[data-hud-key]').forEach((d) => {
        if (d.dataset.hudKey) persistedDetailsState[d.dataset.hudKey] = d.open;
      });
      const pipelineScroll = {};
      document.querySelectorAll('.wf-pipeline[data-wf-pipeline]').forEach((el) => {
        if (el.dataset.wfPipeline && el.scrollLeft > 0) {
          pipelineScroll[el.dataset.wfPipeline] = el.scrollLeft;
        }
      });
      const active = document.activeElement;
      const focusInfo = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')
        ? {
            id: active.id || '',
            inputKey: active.dataset?.inputKey || '',
            selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
            selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
          }
        : null;
      const wikiListEl = document.getElementById('wiki-page-list');
      const wikiListScrollTop = wikiListEl ? wikiListEl.scrollTop : 0;
      return {
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        details: { ...persistedDetailsState },
        pipelineScroll,
        wikiListScrollTop,
        focusInfo,
      };
    }

    function restoreUiState(state) {
      if (!state) return;
      document.querySelectorAll('details[data-hud-key]').forEach((d) => {
        const k = d.dataset.hudKey;
        if (k && Object.prototype.hasOwnProperty.call(state.details, k)) {
          d.open = Boolean(state.details[k]);
        }
      });
      if (state.pipelineScroll) {
        document.querySelectorAll('.wf-pipeline[data-wf-pipeline]').forEach((el) => {
          const k = el.dataset.wfPipeline;
          if (k && Object.prototype.hasOwnProperty.call(state.pipelineScroll, k)) {
            el.scrollLeft = state.pipelineScroll[k];
          }
        });
      }
      if (state.wikiListScrollTop) {
        const wikiListEl = document.getElementById('wiki-page-list');
        if (wikiListEl) wikiListEl.scrollTop = state.wikiListScrollTop;
      }
      if (state.focusInfo) {
        let target = state.focusInfo.id ? document.getElementById(state.focusInfo.id) : null;
        if (!target && state.focusInfo.inputKey) {
          target = document.querySelector(\`[data-input-key="\${CSS.escape(state.focusInfo.inputKey)}"]\`);
        }
        if (target && typeof target.focus === 'function') {
          try {
            target.focus({ preventScroll: true });
            if (state.focusInfo.selectionStart !== null && typeof target.setSelectionRange === 'function') {
              target.setSelectionRange(state.focusInfo.selectionStart, state.focusInfo.selectionEnd ?? state.focusInfo.selectionStart);
            }
          } catch { /* fail open: selection range unsupported on non-text input */ }
        }
      }
      try { window.scrollTo(state.scrollX, state.scrollY); } catch { /* fail open: scrollTo unavailable */ }
    }

    function getPromptValue(key, fallback) {
      return Object.prototype.hasOwnProperty.call(editedPrompts, key) ? editedPrompts[key] : fallback;
    }

    window.onPromptEdit = function(key, val) {
      if (key) editedPrompts[key] = String(val ?? '');
      if (key && key.startsWith('sa:')) {
        const agentName = key.slice(3);
        const previewEl = document.getElementById('sa-snippet-' + agentName);
        if (previewEl) {
          const tier = selectedSubagentModels[agentName] || previewEl.dataset.defaultTier || 'inherit';
          previewEl.textContent = buildSubagentInvokeSnippet(agentName, tier, val);
        }
      }
    };

    function restoreButtonFeedback(btn) {
      if (!btn) return;
      if (btn._hudBtnTimer) {
        clearTimeout(btn._hudBtnTimer);
        btn._hudBtnTimer = null;
      }
      if (Object.prototype.hasOwnProperty.call(btn.dataset, 'origHtml')) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
      delete btn.dataset.btnState;
      btn.style.minWidth = '';
    }

    function setButtonFeedback(btn, state, label, ms = 1400) {
      if (!btn) return;
      if (btn._hudBtnTimer) {
        clearTimeout(btn._hudBtnTimer);
        btn._hudBtnTimer = null;
      }
      if (!Object.prototype.hasOwnProperty.call(btn.dataset, 'origHtml')) {
        btn.dataset.origHtml = btn.innerHTML;
      }
      if (!btn.style.minWidth) {
        try {
          const w = Math.ceil(btn.getBoundingClientRect().width);
          if (w > 0) btn.style.minWidth = w + 'px';
        } catch { /* fail open: layout measurement unavailable */ }
      }
      btn.dataset.btnState = state;
      if (state === 'loading') {
        btn.innerHTML = '<span class="btn-spin-ring" aria-hidden="true"></span><span>' + esc(label) + '</span>';
      } else if (state === 'ok') {
        btn.innerHTML = '<svg class="btn-check-svg" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path class="btn-check-path" d="M2.2 6.3L4.8 8.9L9.8 3.3" /></svg><span class="btn-morph-label">' + esc(label) + '</span>';
        if (!btn._hudLeaveBound) {
          btn._hudLeaveBound = true;
          btn.addEventListener('mouseleave', () => {
            if (btn.dataset.btnState === 'ok') {
              if (btn._hudBtnTimer) {
                clearTimeout(btn._hudBtnTimer);
                btn._hudBtnTimer = null;
              }
              btn._hudBtnTimer = setTimeout(() => restoreButtonFeedback(btn), 240);
            }
          });
        }
      } else {
        btn.innerHTML = '<span>' + esc(label) + '</span>';
      }
      if (ms > 0) {
        btn._hudBtnTimer = setTimeout(() => restoreButtonFeedback(btn), ms);
      }
    }

    function flashButton(btn, label, ms = 1400) {
      if (!btn) return;
      const state = /error|fail/i.test(String(label || '')) ? 'err' : 'ok';
      setButtonFeedback(btn, state, label, ms);
    }

    function copyTextWithFlash(btn, text) {
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => setButtonFeedback(btn, 'ok', 'Copied', 1400)).catch(() => { /* fail open: clipboard permission denied */ });
      }
    }

    window.copyMdCodeBlock = function(btn) {
      const wrap = btn && btn.closest ? btn.closest('.md-code-wrap') : null;
      const codeEl = wrap ? wrap.querySelector('pre code') : null;
      copyTextWithFlash(btn, codeEl ? codeEl.textContent : '');
    };

    window.copyFromInput = function(btn, inputId) {
      const el = document.getElementById(inputId);
      copyTextWithFlash(btn, el ? el.value : '');
    };

    window.copySubagentSnippet = function(btn, agentName) {
      const previewEl = document.getElementById('sa-snippet-' + agentName);
      copyTextWithFlash(btn, previewEl ? previewEl.textContent : '');
    };

    async function postDispatch(btn, body) {
      let spinnerShownAt = 0;
      let spinnerDelayTimer = null;
      if (btn) {
        btn.disabled = true;
        spinnerDelayTimer = setTimeout(() => {
          spinnerDelayTimer = null;
          spinnerShownAt = Date.now();
          setButtonFeedback(btn, 'loading', 'Sending\u2026', 0);
        }, 150);
      }
      const finishDispatchFeedback = (state, label, ms) => {
        if (spinnerDelayTimer) {
          clearTimeout(spinnerDelayTimer);
          spinnerDelayTimer = null;
        }
        const elapsed = spinnerShownAt > 0 ? (Date.now() - spinnerShownAt) : 300;
        const dwellLeft = spinnerShownAt > 0 ? Math.max(0, 300 - elapsed) : 0;
        const apply = () => {
          if (btn) btn.disabled = false;
          setButtonFeedback(btn, state, label, ms);
        };
        if (dwellLeft > 0) setTimeout(apply, dwellLeft);
        else apply();
      };
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
        if (!res.ok || !data.ok) {
          finishDispatchFeedback('err', 'Error', 1800);
          return;
        }
        if (data.fallback) {
          finishDispatchFeedback('ok', 'New Chat', 1600);
        } else if (data.modeUsed === 'active-chat' || data.modeUsed === 'subagent-active') {
          finishDispatchFeedback('ok', 'Sent', 1500);
        } else {
          finishDispatchFeedback('ok', 'Launched', 1500);
        }
      } catch { /* fail open: dispatch network failure */
        finishDispatchFeedback('err', 'Failed', 1800);
      }
    }

    window.runQuickCommand = function(btn, prompt, mode = 'active-chat') {
      if (!prompt) return;
      postDispatch(btn, { mode, prompt });
    };

    window.armCancelMode = function() {
      pendingCancelConfirm = true;
      if (cancelConfirmTimer) clearTimeout(cancelConfirmTimer);
      cancelConfirmTimer = setTimeout(() => {
        pendingCancelConfirm = false;
        if (latestData) {
          const st = captureUiState();
          renderOverview(latestData);
          restoreUiState(st);
        }
      }, 6000);
      if (latestData) {
        const st = captureUiState();
        renderOverview(latestData);
        restoreUiState(st);
      }
    };

    window.abortCancelMode = function() {
      pendingCancelConfirm = false;
      if (cancelConfirmTimer) clearTimeout(cancelConfirmTimer);
      if (latestData) {
        const st = captureUiState();
        renderOverview(latestData);
        restoreUiState(st);
      }
    };

    window.confirmCancelMode = function(btn, targetMode) {
      pendingCancelConfirm = false;
      if (cancelConfirmTimer) clearTimeout(cancelConfirmTimer);
      const cmd = targetMode ? '/cancel ' + targetMode : '/cancel';
      postDispatch(btn, { mode: 'active-chat', prompt: cmd });
      if (latestData) {
        const st = captureUiState();
        renderOverview(latestData);
        restoreUiState(st);
      }
    };

    window.runFromInput = function(btn, inputId, mode) {
      const el = document.getElementById(inputId);
      const prompt = el ? el.value.trim() : '';
      if (!prompt) return;
      postDispatch(btn, { mode, prompt });
    };

    window.invokeSubagentFromInput = function(btn, inputId, agent, fallbackModel, mode) {
      const el = document.getElementById(inputId);
      const prompt = el ? el.value.trim() : '';
      if (!prompt) return;
      const chosenTier = selectedSubagentModels[agent] || fallbackModel || 'inherit';
      postDispatch(btn, { mode, agent, model: chosenTier, prompt });
    };

    window.toggleSkillFlag = function(skillName, flag) {
      if (!latestData) return;
      const skillMeta = (latestData.catalog?.skills || []).find((s) => s.name === skillName);
      if (!skillMeta) return;
      const curSet = new Set(selectedSkillFlags[skillName] || []);
      if (curSet.has(flag)) curSet.delete(flag);
      else {
        if (!flag.startsWith('-')) {
          for (const existing of [...curSet]) {
            if (!existing.startsWith('-')) curSet.delete(existing);
          }
        }
        curSet.add(flag);
      }
      const nextFlags = [...curSet];
      selectedSkillFlags[skillName] = nextFlags;
      const inputKey = 'skill:' + skillName;
      const currentCmd = getPromptValue(inputKey, skillMeta.quickStart);
      const updatedCmd = buildSkillCommandWithFlags(currentCmd, nextFlags, skillMeta.flags || []);
      editedPrompts[inputKey] = updatedCmd;
      renderSkillsListOnly(latestData);
    };

    window.setSubagentModel = function(agentName, tier) {
      if (!MODEL_TIERS.includes(tier)) return;
      selectedSubagentModels[agentName] = tier;
      if (latestData) renderSubagents(latestData);
    };

    function revokeDrawerUrls() {
      for (const u of activeDrawerObjectUrls) {
        try { URL.revokeObjectURL(u); } catch { /* fail open: blob URL already revoked */ }
      }
      activeDrawerObjectUrls = [];
    }

    function setMainShellInert(isInert) {
      const shell = document.getElementById('hud-main-shell');
      if (!shell) return;
      shell.inert = Boolean(isInert);
      if (isInert) shell.setAttribute('aria-hidden', 'true');
      else shell.removeAttribute('aria-hidden');
    }

    function clearDrawerSkeleton() {
      if (drawerSkeletonTimer) {
        clearTimeout(drawerSkeletonTimer);
        drawerSkeletonTimer = null;
      }
    }

    function buildDrawerSkeletonHtml() {
      return '<div class="md-skeleton" role="status" aria-label="Loading preview">'
        + '<div class="md-skel-kicker"></div>'
        + '<div class="md-skel-title"></div>'
        + '<div class="md-skel-line"></div>'
        + '<div class="md-skel-line w-84"></div>'
        + '<div class="md-skel-line w-68"></div>'
        + '<div class="md-skel-block"></div>'
        + '</div>';
    }

    function openDrawerShell(title, subtitle, controlsHtml = '') {
      drawerReqSeq += 1;
      const reqSeq = drawerReqSeq;
      clearDrawerSkeleton();
      const backdrop = document.getElementById('artifact-drawer-backdrop');
      const drawer = document.getElementById('artifact-drawer');
      if (!drawer.classList.contains('is-open')) {
        drawerTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      revokeDrawerUrls();
      currentVrState = null;
      currentLoftState = null;
      document.getElementById('artifact-drawer-title').textContent = title || 'Artifact Preview';
      document.getElementById('artifact-drawer-sub').textContent = subtitle || '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      ctrl.innerHTML = controlsHtml || '';
      ctrl.style.display = controlsHtml ? 'block' : 'none';
      const bodyEl = document.getElementById('artifact-drawer-body');
      bodyEl.innerHTML = '';
      drawerSkeletonTimer = setTimeout(() => {
        drawerSkeletonTimer = null;
        if (drawerReqSeq === reqSeq && drawer.classList.contains('is-open')) {
          bodyEl.innerHTML = buildDrawerSkeletonHtml();
        }
      }, 120);
      backdrop.classList.add('is-open');
      drawer.classList.add('is-open');
      backdrop.setAttribute('aria-hidden', 'false');
      drawer.setAttribute('aria-hidden', 'false');
      setMainShellInert(true);
      try {
        const closeBtn = document.getElementById('artifact-drawer-close');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      } catch { /* fail open: focus management unsupported in webview */ }
      return reqSeq;
    }

    function resetDrawerDom() {
      revokeDrawerUrls();
      currentVrState = null;
      currentLoftState = null;
      const backdrop = document.getElementById('artifact-drawer-backdrop');
      const drawer = document.getElementById('artifact-drawer');
      backdrop.classList.remove('is-open');
      drawer.classList.remove('is-open');
      backdrop.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('aria-hidden', 'true');
      document.getElementById('artifact-drawer-body').innerHTML = '';
      document.getElementById('artifact-drawer-controls').innerHTML = '';
      document.getElementById('artifact-drawer-controls').style.display = 'none';
    }

    window.closeArtifactDrawer = function(immediate = false) {
      drawerReqSeq += 1;
      clearDrawerSkeleton();
      setMainShellInert(false);
      const triggerToRestore = drawerTriggerEl;
      drawerTriggerEl = null;
      if (triggerToRestore && document.contains(triggerToRestore)) {
        try { triggerToRestore.focus({ preventScroll: true }); } catch { /* fail open: focus restore unsupported */ }
      }
      resetDrawerDom();
    };

    async function fetchArtifactResponse(relPath) {
      const q = new URLSearchParams();
      const wsRoot = activeRoot || latestData?.workspace || workspaceUris[0] || '';
      if (wsRoot) q.set('workspace', wsRoot);
      if (activeRoot) q.set('activeRoot', activeRoot);
      q.set('rel', relPath);
      const headers = token ? { 'X-Sidecar-Token': token } : {};
      return fetch('/api/artifact?' + q.toString(), { headers });
    }

    window.openArtifactEntry = function(el) {
      if (!el || !el.dataset) return;
      const file = el.dataset.file || '';
      const label = el.dataset.label || file;
      const kind = el.dataset.kind || 'ralplan';
      if (String(file).endsWith('.json')) {
        window.openJsonReceiptDrawer(file, label, kind);
      } else {
        window.openMarkdownDrawer(file, label, kind);
      }
    };

    window.openJsonReceiptDrawer = async function(relFile, title, kindLabel) {
      if (!relFile) return;
      const reqSeq = openDrawerShell(title || relFile, (kindLabel ? '[' + kindLabel + '] ' : '') + relFile);
      try {
        const res = await fetchArtifactResponse(relFile);
        if (reqSeq !== drawerReqSeq) return;
        clearDrawerSkeleton();
        if (!res.ok) {
          document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Receipt could not be loaded (HTTP ' + esc(res.status) + ').</div>';
          return;
        }
        const raw = await res.text();
        if (reqSeq !== drawerReqSeq) return;
        let pretty = raw;
        let pillsHtml = '';
        try {
          const parsed = JSON.parse(raw);
          pretty = JSON.stringify(parsed, null, 2);
          const metaKeys = ['goalId', 'id', 'status', 'verdict', 'commandExitCode', 'combinedHash', 'headSha'];
          const badges = metaKeys
            .filter((k) => parsed && parsed[k] !== undefined && parsed[k] !== null && String(parsed[k]) !== '')
            .map((k) => \`<span class="badge">\${esc(k)}: <code>\${esc(String(parsed[k]).slice(0, 24))}</code></span>\`)
            .join('');
          if (badges) pillsHtml = \`<div class="row-wrap mb-md">\${badges}</div>\`;
        } catch { /* fail open: render raw JSON text on parse failure */ }
        document.getElementById('artifact-drawer-body').innerHTML = pillsHtml + \`<div class="md-code-wrap"><div class="md-code-lang"><span>json</span><button type="button" class="md-copy-btn" onclick="copyMdCodeBlock(this)">Copy</button></div><pre class="md-pre"><code>\${esc(pretty)}</code></pre></div>\`;
      } catch { /* fail open: JSON receipt drawer load failure */
        clearDrawerSkeleton();
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Failed to load JSON receipt.</div>';
      }
    };

    window.openMarkdownDrawer = async function(relFile, title, kindLabel) {
      if (!relFile) return;
      const reqSeq = openDrawerShell(title || relFile, (kindLabel ? '[' + kindLabel + '] ' : '') + relFile);
      try {
        const res = await fetchArtifactResponse(relFile);
        if (reqSeq !== drawerReqSeq) return;
        clearDrawerSkeleton();
        if (!res.ok) {
          document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Artifact could not be loaded (HTTP ' + esc(res.status) + ').</div>';
          return;
        }
        const mdText = await res.text();
        if (reqSeq !== drawerReqSeq) return;
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="drawer-markdown-body md-reveal">' + renderSafeMarkdown(mdText) + '</div>';
      } catch { /* fail open: artifact markdown fetch failed */
        if (reqSeq !== drawerReqSeq) return;
        clearDrawerSkeleton();
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Failed to load Markdown artifact.</div>';
      }
    };

    async function fetchSkillDocResponse(skillDir, refRel) {
      const q = new URLSearchParams();
      q.set('skill', String(skillDir || '').trim());
      if (refRel) q.set('ref', String(refRel).trim());
      const headers = token ? { 'X-Sidecar-Token': token } : {};
      return fetch('/api/skill-doc?' + q.toString(), { headers });
    }

    window.openSkillMarkdownDrawer = async function(skillDir, refRel = '', skillName = '') {
      const cleanSkill = String(skillDir || '').trim();
      if (!cleanSkill) return;
      const cleanRef = String(refRel || '').trim();
      const activeDoc = cleanRef || 'SKILL.md';
      const skillMeta = (latestData?.catalog?.skills || []).find((s) => s.dir === cleanSkill || s.name === cleanSkill);
      const displayTitle = '/' + (skillName || skillMeta?.name || cleanSkill);
      const subtitle = '[skill] skills/' + (skillMeta?.dir || cleanSkill) + '/' + activeDoc;
      let controlsHtml = '';
      const refs = Array.isArray(skillMeta?.references) ? skillMeta.references : [];
      if (refs.length > 0) {
        const docs = [{ ref: '', label: 'SKILL.md' }, ...refs.map((r) => ({ ref: r, label: r.startsWith('references/') ? r.slice(11) : r }))];
        const chipsHtml = docs.map((d) => {
          const isActive = (d.ref || '') === cleanRef;
          return \`<button type="button" class="chip-btn \${isActive ? 'chip-active' : ''}" aria-pressed="\${isActive ? 'true' : 'false'}" data-skill="\${esc(cleanSkill)}" data-skill-name="\${esc(skillName || skillMeta?.name || cleanSkill)}" data-ref="\${esc(d.ref)}" onclick="openSkillMarkdownDrawer(this.dataset.skill, this.dataset.ref, this.dataset.skillName)">\${esc(d.label)}</button>\`;
        }).join('');
        controlsHtml = \`<div class="row-wrap-sm" role="group" aria-label="Skill documentation files">\${chipsHtml}</div>\`;
      }
      const reqSeq = openDrawerShell(displayTitle, subtitle, controlsHtml);
      try {
        const res = await fetchSkillDocResponse(cleanSkill, cleanRef);
        if (reqSeq !== drawerReqSeq) return;
        clearDrawerSkeleton();
        if (!res.ok) {
          document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Skill markdown could not be loaded (HTTP ' + esc(res.status) + ').</div>';
          return;
        }
        const mdText = await res.text();
        if (reqSeq !== drawerReqSeq) return;
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="drawer-markdown-body md-reveal">' + renderSafeMarkdown(mdText) + '</div>';
      } catch { /* fail open: skill markdown fetch failed */
        if (reqSeq !== drawerReqSeq) return;
        clearDrawerSkeleton();
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Failed to load skill Markdown.</div>';
      }
    };

    function renderVrBody() {
      if (!currentVrState) return;
      const { item, mode, sliderPct, urlMap, leftIdx, rightIdx } = currentVrState;
      const imgs = item.images || [];
      const leftImg = imgs[leftIdx] || imgs[0] || null;
      const rightImg = imgs[rightIdx] || imgs[1] || imgs[0] || null;
      const leftUrl = leftImg ? (urlMap[leftImg.relPath] || '') : '';
      const rightUrl = rightImg ? (urlMap[rightImg.relPath] || '') : '';

      let stageHtml = '<div class="muted">No Visual Ralph images available in this directory.</div>';
      if (leftUrl && mode === 'side-by-side') {
        stageHtml = \`
          <div class="vr-side-grid">
            <div class="vr-frame">
              <div class="muted fs-12 mb-xs">Reference: <code>\${esc(leftImg.name)}</code></div>
              <img src="\${esc(leftUrl)}" alt="\${esc(leftImg.name)}" />
            </div>
            \${rightImg ? \`
            <div class="vr-frame">
              <div class="muted fs-12 mb-xs">Candidate: <code>\${esc(rightImg.name)}</code></div>
              <img src="\${esc(rightUrl)}" alt="\${esc(rightImg.name)}" />
            </div>\` : ''}
          </div>\`;
      } else if (leftUrl && mode === 'split-slider') {
        stageHtml = \`
          <div class="mt-sm">
            <label class="muted row-between fs-12">
              <span>Split Reveal</span><span class="tabular">\${sliderPct}%</span>
            </label>
            <input type="range" min="0" max="100" value="\${sliderPct}" class="w-full" oninput="onVrSliderInput(this.value)" />
          </div>
          <div class="vr-stage">
            <img src="\${esc(rightUrl || leftUrl)}" alt="Candidate layer" />
            <img class="vr-top-layer" src="\${esc(leftUrl)}" alt="Reference split layer" style="clip-path: inset(0 \${100 - sliderPct}% 0 0);" />
          </div>\`;
      } else if (leftUrl && mode === 'onion-skin') {
        const alpha = (sliderPct / 100).toFixed(2);
        stageHtml = \`
          <div class="mt-sm">
            <label class="muted row-between fs-12">
              <span>Overlay Opacity</span><span class="tabular">\${sliderPct}%</span>
            </label>
            <input type="range" min="0" max="100" value="\${sliderPct}" class="w-full" oninput="onVrSliderInput(this.value)" />
          </div>
          <div class="vr-stage">
            <img src="\${esc(leftUrl)}" alt="Reference base" />
            <img class="vr-top-layer" src="\${esc(rightUrl || leftUrl)}" alt="Candidate onion layer" style="opacity:\${alpha};" />
          </div>\`;
      }

      const v = item.verdict;
      const verdictHtml = v ? \`
        <div class="card mt-lg">
          <div class="row-between-sm mb-sm">
            <div class="fw-600">Vision Verdict</div>
            <div class="row-gap-xs">
              <span class="badge badge-active tabular">Score: \${esc(v.score)}/100</span>
              <span class="badge">\${esc(v.verdict)}</span>
            </div>
          </div>
          \${(v.differences || []).length ? \`<div class="health-section-title">Measured Differences</div><ul class="md-list">\${v.differences.map((d) => \`<li>\${esc(d)}</li>\`).join('')}</ul>\` : ''}
          \${(v.suggestions || []).length ? \`<div class="health-section-title">Next Adjustments</div><ul class="md-list">\${v.suggestions.map((s) => \`<li>\${esc(s)}</li>\`).join('')}</ul>\` : ''}
        </div>\` : '';

      document.getElementById('artifact-drawer-body').innerHTML = stageHtml + verdictHtml;
    }

    function renderVrControls() {
      if (!currentVrState) return;
      const { mode, item, leftIdx, rightIdx } = currentVrState;
      const modes = [
        { id: 'side-by-side', label: 'Side-by-Side' },
        { id: 'split-slider', label: 'Split-Slider' },
        { id: 'onion-skin', label: 'Onion-Skin' },
      ];
      const modeBtns = modes.map((m) => \`
        <button type="button" class="chip-btn \${mode === m.id ? 'chip-active' : ''}" data-vr-mode="\${m.id}" aria-pressed="\${mode === m.id ? 'true' : 'false'}" onclick="setVrMode(this.dataset.vrMode)">\${m.label}</button>\`).join('');
      const imgs = item.images || [];
      const selectors = imgs.length >= 2 ? \`
        <div class="row-wrap-sm mt-sm">
          <span class="muted fs-12">Ref:</span>
          <select class="cmd-input select-compact" onchange="setVrPair(Number(this.value), null)">
            \${imgs.map((im, idx) => \`<option value="\${idx}" \${idx === leftIdx ? 'selected' : ''}>\${esc(im.name)}</option>\`).join('')}
          </select>
          <span class="muted fs-12">Cand:</span>
          <select class="cmd-input select-compact" onchange="setVrPair(null, Number(this.value))">
            \${imgs.map((im, idx) => \`<option value="\${idx}" \${idx === rightIdx ? 'selected' : ''}>\${esc(im.name)}</option>\`).join('')}
          </select>
        </div>\` : '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      ctrl.innerHTML = \`<div class="row-wrap-sm">\${modeBtns}</div>\${selectors}\`;
      ctrl.style.display = 'block';
    }

    window.setVrMode = function(mode) {
      if (!currentVrState) return;
      currentVrState.mode = mode;
      renderVrControls();
      renderVrBody();
    };

    window.setVrPair = function(leftIdx, rightIdx) {
      if (!currentVrState) return;
      if (typeof leftIdx === 'number' && !Number.isNaN(leftIdx)) currentVrState.leftIdx = leftIdx;
      if (typeof rightIdx === 'number' && !Number.isNaN(rightIdx)) currentVrState.rightIdx = rightIdx;
      renderVrBody();
    };

    window.onVrSliderInput = function(val) {
      if (!currentVrState) return;
      currentVrState.sliderPct = Math.max(0, Math.min(100, Number(val) || 0));
      renderVrBody();
    };

    window.openVisualRalphDrawer = async function(slug, scope) {
      const vrItem = (latestData?.visualRalph || []).find((v) => v.slug === slug && (v.scope || '.') === (scope || '.'));
      if (!vrItem) return;
      const reqSeq = openDrawerShell('Visual Ralph: ' + vrItem.slug, 'visual-ralph (' + (vrItem.scope || '.') + ')');
      const urlMap = {};
      for (const img of vrItem.images || []) {
        try {
          const res = await fetchArtifactResponse(img.relPath);
          if (reqSeq !== drawerReqSeq) return;
          if (res.ok) {
            const blob = await res.blob();
            if (reqSeq !== drawerReqSeq) return;
            const objUrl = URL.createObjectURL(blob);
            activeDrawerObjectUrls.push(objUrl);
            urlMap[img.relPath] = objUrl;
          }
        } catch { /* fail open: skip unreadable visual-ralph image */ }
      }
      if (reqSeq !== drawerReqSeq) return;
      clearDrawerSkeleton();
      currentVrState = {
        item: vrItem,
        mode: 'side-by-side',
        sliderPct: 50,
        urlMap,
        leftIdx: 0,
        rightIdx: (vrItem.images || []).length > 1 ? 1 : 0,
      };
      renderVrControls();
      renderVrBody();
    };

    function collectActiveThemeCssVars() {
      const style = getComputedStyle(document.documentElement);
      const keys = ['--hud-bg', '--hud-content', '--hud-card', '--hud-sidebar', '--hud-border', '--hud-fg', '--hud-muted', '--hud-primary', '--hud-primary-tint', '--hud-primary-border', '--hud-primary-ink', '--hud-surface-subtle', '--hud-input-bg', '--background', '--foreground', '--card', '--border', '--primary'];
      const pairs = [];
      for (const k of keys) {
        const val = style.getPropertyValue(k).trim();
        if (val) pairs.push(\`\${k}: \${val};\`);
      }
      return pairs.join(' ');
    }

    function renderLoftControls() {
      if (!currentLoftState) return;
      const { item, activeEntry, viewVerdict } = currentLoftState;
      const entries = [];
      const rootSuffix = item.relPath.endsWith('/index.html') && !/\\/variant-[a-c]\\/index\\.html$/.test(item.relPath) ? 'index.html' : null;
      if (rootSuffix) entries.push({ sub: 'index.html', label: 'Root Prototype' });
      for (const v of item.variants || []) {
        entries.push({ sub: v, label: v.replace('/index.html', '') });
      }
      const entryBtns = entries.map((e) => \`
        <button type="button" class="chip-btn \${!viewVerdict && activeEntry === e.sub ? 'chip-active' : ''}" aria-pressed="\${!viewVerdict && activeEntry === e.sub ? 'true' : 'false'}" data-loft-entry="\${esc(e.sub)}" onclick="selectLoftEntry(this.dataset.loftEntry)">\${esc(e.label)}</button>\`).join('');
      const verdictBtn = item.arenaVerdictFile
        ? \`<button type="button" class="chip-btn \${viewVerdict ? 'chip-active' : ''}" aria-pressed="\${viewVerdict ? 'true' : 'false'}" onclick="showLoftArenaVerdict()">Arena Verdict</button>\`
        : '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      if (entryBtns || verdictBtn) {
        ctrl.innerHTML = \`<div class="row-wrap-sm">\${entryBtns}\${verdictBtn}</div>\`;
        ctrl.style.display = 'block';
      } else {
        ctrl.style.display = 'none';
      }
    }

    function renderLoftFrame() {
      if (!currentLoftState) return;
      const { item, activeEntry, htmlCache, assetMap, verdictMarkdown, viewVerdict } = currentLoftState;
      const bodyEl = document.getElementById('artifact-drawer-body');
      if (viewVerdict) {
        bodyEl.innerHTML = '<div class="drawer-markdown-body md-reveal">' + renderSafeMarkdown(verdictMarkdown || 'No arena verdict content.') + '</div>';
        return;
      }
      const rawHtml = htmlCache[activeEntry] || '';
      const prepared = prepareLoftSrcdoc(rawHtml, activeEntry, assetMap, collectActiveThemeCssVars());
      bodyEl.innerHTML = \`
        <div class="muted fs-12 mb-sm">Opaque-origin sandbox (<code>sandbox="allow-scripts"</code> &middot; local assets inlined &middot; external scripts stripped)</div>
        <iframe id="loft-sandbox-frame" class="loft-iframe md-reveal" sandbox="allow-scripts" referrerpolicy="no-referrer" title="\${esc(item.title || item.slug)}"></iframe>\`;
      const frame = document.getElementById('loft-sandbox-frame');
      if (frame) frame.srcdoc = prepared;
    }

    window.selectLoftEntry = async function(entrySub) {
      if (!currentLoftState) return;
      currentLoftState.viewVerdict = false;
      currentLoftState.activeEntry = entrySub;
      if (!Object.prototype.hasOwnProperty.call(currentLoftState.htmlCache, entrySub)) {
        const fullRel = currentLoftState.baseDir + '/' + entrySub;
        try {
          const res = await fetchArtifactResponse(fullRel);
          currentLoftState.htmlCache[entrySub] = res.ok ? await res.text() : '<p>Failed to load variant HTML.</p>';
        } catch { /* fail open: variant HTML fetch error */
          currentLoftState.htmlCache[entrySub] = '<p>Failed to load variant HTML.</p>';
        }
      }
      renderLoftControls();
      renderLoftFrame();
    };

    window.showLoftArenaVerdict = async function() {
      if (!currentLoftState || !currentLoftState.item.arenaVerdictFile) return;
      currentLoftState.viewVerdict = true;
      if (!currentLoftState.verdictMarkdown) {
        try {
          const res = await fetchArtifactResponse(currentLoftState.item.arenaVerdictFile);
          currentLoftState.verdictMarkdown = res.ok ? await res.text() : 'Arena verdict unavailable.';
        } catch { /* fail open: arena verdict fetch error */
          currentLoftState.verdictMarkdown = 'Arena verdict unavailable.';
        }
      }
      renderLoftControls();
      renderLoftFrame();
    };

    window.openLoftDrawer = async function(slug, scope) {
      const loftItem = (latestData?.loft || []).find((l) => l.slug === slug && (l.scope || '.') === (scope || '.'));
      if (!loftItem) return;
      const reqSeq = openDrawerShell('Loft: ' + (loftItem.title || loftItem.slug), loftItem.relPath);
      const scopePrefix = loftItem.scope && loftItem.scope !== '.' ? loftItem.scope + '/' : '';
      const baseDir = scopePrefix + '.omagy/artifacts/loft/' + loftItem.slug;
      const initialEntry = loftItem.relPath.startsWith(baseDir + '/')
        ? loftItem.relPath.slice(baseDir.length + 1)
        : 'index.html';
      const assetMap = {};
      for (const relAsset of loftItem.localAssets || []) {
        const cleanSub = relAsset.startsWith('./') ? relAsset.slice(2) : relAsset;
        try {
          const res = await fetchArtifactResponse(baseDir + '/' + cleanSub);
          if (reqSeq !== drawerReqSeq) return;
          if (res.ok) assetMap[relAsset] = await res.text();
        } catch { /* fail open: skip unreadable local loft asset */ }
      }
      const htmlCache = {};
      try {
        const res = await fetchArtifactResponse(baseDir + '/' + initialEntry);
        if (reqSeq !== drawerReqSeq) return;
        htmlCache[initialEntry] = res.ok ? await res.text() : '<p>Unable to load Loft HTML.</p>';
      } catch { /* fail open: initial loft HTML fetch failed */
        if (reqSeq !== drawerReqSeq) return;
        htmlCache[initialEntry] = '<p>Unable to load Loft HTML.</p>';
      }
      if (reqSeq !== drawerReqSeq) return;
      clearDrawerSkeleton();
      currentLoftState = {
        item: loftItem,
        baseDir,
        activeEntry: initialEntry,
        htmlCache,
        assetMap,
        verdictMarkdown: '',
        viewVerdict: false,
      };
      renderLoftControls();
      renderLoftFrame();
    };

    const WIKI_CAT_KEYS = new Set(['architecture', 'pattern', 'convention', 'reference', 'decision', 'debugging', 'environment', 'session-log']);
    const WIKI_CAT_FALLBACK = {
      architecture: { main: '#3b82f6', hi: '#dbeafe', rim: '#1e3a8a' },
      pattern: { main: '#10b981', hi: '#d1fae5', rim: '#065f46' },
      convention: { main: '#8b5cf6', hi: '#ede9fe', rim: '#4c1d95' },
      reference: { main: '#06b6d4', hi: '#cffafe', rim: '#155e75' },
      decision: { main: '#f59e0b', hi: '#fef3c7', rim: '#78350f' },
      debugging: { main: '#ef4444', hi: '#fee2e2', rim: '#7f1d1d' },
      environment: { main: '#14b8a6', hi: '#ccfbf1', rim: '#134e4a' },
      'session-log': { main: '#ec4899', hi: '#fce7f3', rim: '#831843' },
      default: { main: '#64748b', hi: '#f1f5f9', rim: '#1e293b' },
    };
    const wikiCatTokenCache = new Map();

    function getWikiCatColor(cat) {
      const rawKey = String(cat || '').toLowerCase();
      const key = WIKI_CAT_KEYS.has(rawKey) ? rawKey : 'default';
      const fallback = WIKI_CAT_FALLBACK[key] || WIKI_CAT_FALLBACK.default;
      const cacheKey = \`\${key}:\${document.documentElement?.dataset?.theme || ''}\`;
      if (wikiCatTokenCache.has(cacheKey)) return wikiCatTokenCache.get(cacheKey);
      let resolved = fallback;
      try {
        const cs = typeof getComputedStyle === 'function' && document.documentElement
          ? getComputedStyle(document.documentElement)
          : null;
        if (cs) {
          const main = (cs.getPropertyValue(\`--wiki-cat-\${key}\`) || '').trim();
          const hi = (cs.getPropertyValue(\`--wiki-cat-\${key}-hi\`) || '').trim();
          const rim = (cs.getPropertyValue(\`--wiki-cat-\${key}-rim\`) || '').trim();
          if (main && hi && rim) resolved = { main, hi, rim };
        }
      } catch { /* fail open: computed style unavailable */ }
      wikiCatTokenCache.set(cacheKey, resolved);
      return resolved;
    }

    function prefersReducedMotion() {
      try {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch { /* fail open: matchMedia unavailable */
        return false;
      }
    }

    const mmState = {
      graph: { nodes: [], edges: [] },
      nodeBySlug: new Map(),
      neighborMap: new Map(),
      yaw: 0.35,
      pitch: 0.18,
      zoom: 1,
      velYaw: 0,
      velPitch: 0,
      targetYaw: null,
      targetPitch: null,
      autoOrbit: !prefersReducedMotion(),
      orbitHoldUntil: 0,
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      dragMoved: 0,
      hoverSlug: '',
      hitNodes: [],
      width: 420,
      height: 288,
      dpr: 1,
      rafId: 0,
      pulsePhase: 0,
      initialized: false,
      initialFocused: false,
      resizeObs: null,
    };

    function computeFocusAngles(node) {
      if (!node) return { yaw: 0.35, pitch: 0.18 };
      const yaw = Math.atan2(node.x, -node.z);
      const horiz = Math.hypot(node.x, node.z);
      const rawPitch = Math.atan2(-node.y, horiz) + 0.08;
      const pitch = Math.max(-1.18, Math.min(1.18, rawPitch));
      return { yaw, pitch };
    }

    function updateMindMapReadout() {
      const el = document.getElementById('wiki-mm-readout');
      if (!el) return;
      const focusSlug = mmState.hoverSlug || selectedWikiSlug;
      const node = focusSlug ? mmState.nodeBySlug.get(focusSlug) : null;
      if (!node) {
        el.textContent = 'Drag to orbit 3D mind-map \u00b7 Click any .md node to open';
        return;
      }
      const prefix = mmState.hoverSlug ? 'Inspect' : 'Active';
      const linkLabel = node.degree === 1 ? '1 link' : (node.degree + ' links');
      el.innerHTML = '<span class="muted">' + prefix + ':</span> <code>' + esc(node.slug) + '.md</code> <span class="muted">\u00b7 ' + esc(node.category) + ' \u00b7 ' + linkLabel + '</span>';
    }

    function syncMindMapOrbitButton() {
      const btn = document.getElementById('wiki-mm-orbit-btn');
      if (btn) {
        btn.setAttribute('aria-pressed', mmState.autoOrbit ? 'true' : 'false');
        btn.textContent = mmState.autoOrbit ? 'Orbit: On' : 'Orbit: Off';
      }
    }

    function syncWikiMindMapData(entries, focusSlug, snapImmediate = false) {
      const graph = buildWikiMindMapGraph(entries || [], wikiCategory);
      mmState.graph = graph;
      mmState.nodeBySlug = new Map(graph.nodes.map((n) => [n.slug, n]));
      const nb = new Map();
      for (const n of graph.nodes) nb.set(n.slug, new Set());
      for (const e of graph.edges) {
        if (nb.has(e.source)) nb.get(e.source).add(e.target);
        if (nb.has(e.target)) nb.get(e.target).add(e.source);
      }
      mmState.neighborMap = nb;
      if (mmState.hoverSlug && !mmState.nodeBySlug.has(mmState.hoverSlug)) {
        mmState.hoverSlug = '';
      }
      if (focusSlug && mmState.nodeBySlug.has(focusSlug) && (!mmState.initialFocused || snapImmediate)) {
        const ang = computeFocusAngles(mmState.nodeBySlug.get(focusSlug));
        mmState.yaw = ang.yaw;
        mmState.pitch = ang.pitch;
        mmState.targetYaw = null;
        mmState.targetPitch = null;
        mmState.initialFocused = true;
      }
      updateMindMapReadout();
      requestMindMapDraw();
    }

    function focusMindMapOnSlug(slug) {
      const node = slug ? mmState.nodeBySlug.get(slug) : null;
      if (!node) return;
      const ang = computeFocusAngles(node);
      mmState.velYaw = 0;
      mmState.velPitch = 0;
      mmState.orbitHoldUntil = Date.now() + 3600;
      if (prefersReducedMotion()) {
        mmState.yaw = ang.yaw;
        mmState.pitch = ang.pitch;
        mmState.targetYaw = null;
        mmState.targetPitch = null;
        requestMindMapDraw();
      } else {
        mmState.targetYaw = ang.yaw;
        mmState.targetPitch = ang.pitch;
        startWikiMindMapLoop();
      }
      updateMindMapReadout();
    }

    function resizeWikiMindMap() {
      const stage = document.getElementById('wiki-mindmap-stage');
      const canvas = document.getElementById('wiki-mindmap-canvas');
      if (!stage || !canvas) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (mmState.width !== w || mmState.height !== h || mmState.dpr !== dpr || canvas.width !== Math.round(w * dpr)) {
        mmState.width = w;
        mmState.height = h;
        mmState.dpr = dpr;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
    }

    function drawRoundedCapsule(ctx, x, y, w, h, r) {
      const rad = Math.min(r, w * 0.5, h * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    }

    function isHudLightMode() {
      if (document.documentElement.classList.contains('light')) return true;
      if (document.documentElement.style.colorScheme === 'dark') return false;
      if (document.documentElement.style.colorScheme === 'light') return true;
      try {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      } catch { /* fail open: fallback to dark mode */
        return false;
      }
    }

    function drawWikiMindMapFrame() {
      const canvas = document.getElementById('wiki-mindmap-canvas');
      if (!canvas) return;
      resizeWikiMindMap();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = mmState.width;
      const h = mmState.height;
      const dpr = mmState.dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const isLight = isHudLightMode();
      const cs = getComputedStyle(document.documentElement);
      const primaryCol = cs.getPropertyValue('--hud-primary').trim() || (isLight ? '#2563eb' : '#3b82f6');
      const fgCol = cs.getPropertyValue('--hud-fg').trim() || (isLight ? '#0f172a' : '#e5e7eb');
      const mutedCol = cs.getPropertyValue('--hud-muted').trim() || (isLight ? '#475569' : '#94a3b8');

      const nodes = mmState.graph.nodes || [];
      const edges = mmState.graph.edges || [];
      if (!nodes.length) {
        ctx.fillStyle = mutedCol;
        ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No Wiki .md pages found in omagy_wiki/', w * 0.5, h * 0.5);
        ctx.restore();
        return;
      }

      // 1. Subtle 3D orbital wireframe meridian + equator rings for immediate spatial depth
      const ringAlpha = isLight ? 0.08 : 0.11;
      ctx.strokeStyle = isLight ? ('rgba(15, 23, 42, ' + ringAlpha + ')') : ('rgba(148, 163, 184, ' + ringAlpha + ')');
      ctx.lineWidth = 1;
      const segs = 40;
      for (let ring = 0; ring < 2; ring += 1) {
        ctx.beginPath();
        for (let s = 0; s <= segs; s += 1) {
          const ang = (s / segs) * Math.PI * 2;
          const pt3 = ring === 0
            ? { x: Math.cos(ang) * 0.96, y: 0, z: Math.sin(ang) * 0.96 }
            : { x: 0, y: Math.sin(ang) * 0.88, z: Math.cos(ang) * 0.96 };
          const pr = projectMindMapPoint(pt3, mmState.yaw, mmState.pitch, mmState.zoom, w, h);
          if (s === 0) ctx.moveTo(pr.sx, pr.sy);
          else ctx.lineTo(pr.sx, pr.sy);
        }
        ctx.stroke();
      }

      // 2. Project all 3D nodes
      const projected = nodes.map((n) => {
        const pr = projectMindMapPoint(n, mmState.yaw, mmState.pitch, mmState.zoom, w, h);
        return { node: n, sx: pr.sx, sy: pr.sy, z: pr.z, persp: pr.persp };
      });

      const focusSlug = mmState.hoverSlug || selectedWikiSlug;
      const focusNeighbors = focusSlug && mmState.neighborMap.has(focusSlug)
        ? mmState.neighborMap.get(focusSlug)
        : new Set();

      // 3. Depth-sorted 3D curved links + animated photon pulses along active connections
      const projEdges = edges.map((e) => {
        const pA = projected[e.sourceIndex];
        const pB = projected[e.targetIndex];
        const nA = pA.node;
        const nB = pB.node;
        let mx = (nA.x + nB.x) * 0.5;
        let my = (nA.y + nB.y) * 0.5;
        let mz = (nA.z + nB.z) * 0.5;
        const mLen = Math.hypot(mx, my, mz) || 1;
        const bow = 1.14 / mLen;
        mx *= bow; my *= bow; mz *= bow;
        const pMid = projectMindMapPoint({ x: mx, y: my, z: mz }, mmState.yaw, mmState.pitch, mmState.zoom, w, h);
        const cpX = (2 * pMid.sx) - (0.5 * (pA.sx + pB.sx));
        const cpY = (2 * pMid.sy) - (0.5 * (pA.sy + pB.sy));
        return {
          edge: e,
          pA,
          pB,
          cpX,
          cpY,
          avgZ: (pA.z + pB.z) * 0.5,
          active: Boolean(focusSlug && (e.source === focusSlug || e.target === focusSlug)),
          inFilter: nA.inFilter && nB.inFilter,
        };
      }).sort((a, b) => b.avgZ - a.avgZ);

      const reduced = prefersReducedMotion();
      for (const pe of projEdges) {
        const depthNorm = Math.max(0, Math.min(1, (1.15 - pe.avgZ) / 2.3));
        ctx.beginPath();
        ctx.moveTo(pe.pA.sx, pe.pA.sy);
        ctx.quadraticCurveTo(pe.cpX, pe.cpY, pe.pB.sx, pe.pB.sy);
        if (pe.active) {
          const srcPal = getWikiCatColor(pe.pA.node.category);
          ctx.strokeStyle = srcPal.main || primaryCol;
          ctx.globalAlpha = pe.inFilter ? 0.86 : 0.42;
          ctx.lineWidth = 1.85;
          ctx.stroke();

          if (!reduced) {
            const tRaw = (mmState.pulsePhase + (pe.edge.sourceIndex * 0.19)) % 1;
            const forward = pe.edge.source === focusSlug || pe.edge.bidirectional || pe.edge.target !== focusSlug;
            const t = forward ? tRaw : (1 - tRaw);
            const omt = 1 - t;
            const px = (omt * omt * pe.pA.sx) + (2 * omt * t * pe.cpX) + (t * t * pe.pB.sx);
            const py = (omt * omt * pe.pA.sy) + (2 * omt * t * pe.cpY) + (t * t * pe.pB.sy);
            ctx.beginPath();
            ctx.arc(px, py, 2.4, 0, Math.PI * 2);
            ctx.fillStyle = isLight ? srcPal.main : srcPal.hi;
            ctx.globalAlpha = 0.95;
            ctx.fill();
          }
        } else {
          const baseAlpha = pe.inFilter ? (0.12 + depthNorm * 0.24) : 0.06;
          ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 1)' : 'rgba(148, 163, 184, 1)';
          ctx.globalAlpha = focusSlug ? (baseAlpha * 0.65) : baseAlpha;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // 4. Painter's back-to-front 3D lit sphere orbs & crisp labels
      const sortedNodes = [...projected].sort((a, b) => b.z - a.z);
      const nextHits = [];

      for (const item of sortedNodes) {
        const n = item.node;
        const pal = getWikiCatColor(n.category);
        const isSelected = n.slug === selectedWikiSlug;
        const isHovered = n.slug === mmState.hoverSlug;
        const isNeighbor = focusNeighbors.has(n.slug);
        const depthNorm = Math.max(0, Math.min(1, (1.15 - item.z) / 2.3));
        const perspScale = Math.max(0.68, Math.min(1.45, item.persp * 3.1));
        const baseR = 7.5 + Math.min(5.2, n.degree * 0.68);
        const r = baseR * perspScale * (isSelected ? 1.16 : (isHovered ? 1.1 : 1));

        let nodeAlpha = 0.5 + (depthNorm * 0.5);
        if (!n.inFilter && !isSelected && !isHovered) nodeAlpha *= 0.28;
        else if (focusSlug && !isSelected && !isHovered && !isNeighbor) nodeAlpha *= 0.62;

        ctx.save();
        ctx.globalAlpha = Math.max(0.18, Math.min(1, nodeAlpha));

        // Selected / hovered halo & orbital ring
        if (isSelected || isHovered) {
          const glow = ctx.createRadialGradient(item.sx, item.sy, r * 0.4, item.sx, item.sy, r * 2.25);
          glow.addColorStop(0, pal.main + (isLight ? '44' : '66'));
          glow.addColorStop(1, pal.main + '00');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(item.sx, item.sy, r * 2.25, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(item.sx, item.sy, r * 1.58, r * 0.92, -0.28, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? primaryCol : pal.main;
          ctx.lineWidth = isSelected ? 1.65 : 1.3;
          ctx.stroke();
        }

        // 3D specular sphere shading
        const grad = ctx.createRadialGradient(
          item.sx - (r * 0.34),
          item.sy - (r * 0.34),
          r * 0.12,
          item.sx,
          item.sy,
          r,
        );
        grad.addColorStop(0, pal.hi);
        grad.addColorStop(0.46, pal.main);
        grad.addColorStop(1, pal.rim);
        ctx.beginPath();
        ctx.arc(item.sx, item.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.strokeStyle = isSelected ? '#ffffff' : (isLight ? 'rgba(15,23,42,0.22)' : 'rgba(255,255,255,0.24)');
        ctx.stroke();

        // Crisp pill label (>= 12px)
        const showFull = isSelected || isHovered;
        const rawLabel = showFull
          ? (n.slug + '.md')
          : (n.slug.length > 20 ? (n.slug.slice(0, 19) + '\u2026') : n.slug);
        ctx.font = (showFull ? '600 ' : '500 ') + '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const textW = Math.ceil(ctx.measureText(rawLabel).width);
        const padX = 6;
        const boxH = 19;
        const boxW = textW + (padX * 2);
        const boxX = Math.max(4, Math.min(w - boxW - 4, item.sx - (boxW * 0.5)));
        const boxY = Math.min(h - boxH - 4, item.sy + r + 5);

        const labelAlpha = showFull ? 0.98 : (n.inFilter ? (0.48 + depthNorm * 0.48) : 0.25);
        ctx.globalAlpha = Math.max(0.2, Math.min(1, labelAlpha));
        drawRoundedCapsule(ctx, boxX, boxY, boxW, boxH, 5);
        ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.90)' : 'rgba(19, 24, 34, 0.88)';
        ctx.fill();
        ctx.lineWidth = showFull ? 1.35 : 1;
        ctx.strokeStyle = isSelected
          ? primaryCol
          : (isHovered ? pal.main : (isLight ? 'rgba(15, 23, 42, 0.16)' : 'rgba(148, 163, 184, 0.24)'));
        ctx.stroke();

        ctx.fillStyle = fgCol;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(rawLabel, boxX + padX, boxY + (boxH * 0.5) + 0.5);
        ctx.restore();

        nextHits.push({
          slug: n.slug,
          sx: item.sx,
          sy: item.sy,
          hitR: Math.max(15, r + 6),
          boxX,
          boxY,
          boxW,
          boxH,
          z: item.z,
        });
      }

      // Reverse so frontmost nodes are checked first during pointer hit-testing
      mmState.hitNodes = nextHits.reverse();
      ctx.restore();
    }

    function findHitMindMapSlug(clientX, clientY) {
      const canvas = document.getElementById('wiki-mindmap-canvas');
      if (!canvas) return '';
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      for (const hNode of mmState.hitNodes) {
        const dx = x - hNode.sx;
        const dy = y - hNode.sy;
        if ((dx * dx + dy * dy) <= (hNode.hitR * hNode.hitR)) return hNode.slug;
        if (x >= hNode.boxX && x <= hNode.boxX + hNode.boxW && y >= hNode.boxY && y <= hNode.boxY + hNode.boxH) {
          return hNode.slug;
        }
      }
      return '';
    }

    function stepWikiMindMap(nowTs) {
      mmState.rafId = 0;
      if (activeView !== 'wiki' || wikiViewMode !== '3d' || document.hidden) {
        return;
      }
      let keepAnimating = false;
      const reduced = prefersReducedMotion();

      if (!mmState.dragging) {
        if (mmState.targetYaw !== null && mmState.targetPitch !== null) {
          const dYaw = ((mmState.targetYaw - mmState.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const dPitch = mmState.targetPitch - mmState.pitch;
          if (Math.abs(dYaw) < 0.004 && Math.abs(dPitch) < 0.004) {
            mmState.yaw = mmState.targetYaw;
            mmState.pitch = mmState.targetPitch;
            mmState.targetYaw = null;
            mmState.targetPitch = null;
          } else {
            mmState.yaw += dYaw * 0.14;
            mmState.pitch += dPitch * 0.14;
            keepAnimating = true;
          }
        } else {
          if (Math.abs(mmState.velYaw) > 0.0002 || Math.abs(mmState.velPitch) > 0.0002) {
            mmState.yaw += mmState.velYaw;
            mmState.pitch = Math.max(-1.28, Math.min(1.28, mmState.pitch + mmState.velPitch));
            mmState.velYaw *= 0.90;
            mmState.velPitch *= 0.90;
            keepAnimating = true;
          } else {
            mmState.velYaw = 0;
            mmState.velPitch = 0;
          }
          if (mmState.autoOrbit && !reduced && Date.now() >= mmState.orbitHoldUntil) {
            mmState.yaw += 0.0038;
            keepAnimating = true;
          }
        }
      }

      if (!reduced && (mmState.graph.edges || []).length > 0 && (selectedWikiSlug || mmState.hoverSlug)) {
        mmState.pulsePhase = ((nowTs || performance.now()) * 0.00042) % 1;
        keepAnimating = true;
      }

      drawWikiMindMapFrame();
      if (keepAnimating) {
        mmState.rafId = requestAnimationFrame(stepWikiMindMap);
      }
    }

    function requestMindMapDraw() {
      if (activeView !== 'wiki' || wikiViewMode !== '3d' || document.hidden) return;
      if (mmState.rafId) return;
      mmState.rafId = requestAnimationFrame(stepWikiMindMap);
    }

    function startWikiMindMapLoop() {
      requestMindMapDraw();
    }

    function initWikiMindMapCanvas() {
      if (mmState.initialized) return;
      const canvas = document.getElementById('wiki-mindmap-canvas');
      const stage = document.getElementById('wiki-mindmap-stage');
      if (!canvas || !stage) return;
      mmState.initialized = true;

      canvas.addEventListener('pointerdown', (ev) => {
        mmState.dragging = true;
        mmState.pointerId = ev.pointerId;
        mmState.startX = ev.clientX;
        mmState.startY = ev.clientY;
        mmState.lastX = ev.clientX;
        mmState.lastY = ev.clientY;
        mmState.dragMoved = 0;
        mmState.velYaw = 0;
        mmState.velPitch = 0;
        mmState.targetYaw = null;
        mmState.targetPitch = null;
        canvas.classList.add('is-dragging');
        try { canvas.setPointerCapture(ev.pointerId); } catch { /* fail open: pointer capture unsupported */ }
      });

      canvas.addEventListener('pointermove', (ev) => {
        if (mmState.dragging && ev.pointerId === mmState.pointerId) {
          const dx = ev.clientX - mmState.lastX;
          const dy = ev.clientY - mmState.lastY;
          mmState.lastX = ev.clientX;
          mmState.lastY = ev.clientY;
          mmState.dragMoved += Math.hypot(dx, dy);
          const dYaw = -dx * 0.0075;
          const dPitch = dy * 0.0075;
          mmState.yaw += dYaw;
          mmState.pitch = Math.max(-1.28, Math.min(1.28, mmState.pitch + dPitch));
          mmState.velYaw = dYaw * 0.65;
          mmState.velPitch = dPitch * 0.65;
          mmState.orbitHoldUntil = Date.now() + 3600;
          requestMindMapDraw();
          return;
        }
        const hit = findHitMindMapSlug(ev.clientX, ev.clientY);
        if (hit !== mmState.hoverSlug) {
          mmState.hoverSlug = hit;
          canvas.classList.toggle('is-hover-node', Boolean(hit));
          updateMindMapReadout();
          requestMindMapDraw();
        }
      });

      const endPointer = (ev) => {
        if (!mmState.dragging || (mmState.pointerId !== null && ev.pointerId !== mmState.pointerId)) return;
        const wasTap = mmState.dragMoved < 6;
        mmState.dragging = false;
        mmState.pointerId = null;
        canvas.classList.remove('is-dragging');
        try { canvas.releasePointerCapture(ev.pointerId); } catch { /* fail open: pointer already released */ }
        if (wasTap) {
          const hit = findHitMindMapSlug(ev.clientX, ev.clientY);
          if (hit) {
            window.selectWikiSlug(hit);
            return;
          }
        }
        startWikiMindMapLoop();
      };

      canvas.addEventListener('pointerup', endPointer);
      canvas.addEventListener('pointercancel', endPointer);
      canvas.addEventListener('pointerleave', () => {
        if (!mmState.dragging && mmState.hoverSlug) {
          mmState.hoverSlug = '';
          canvas.classList.remove('is-hover-node');
          updateMindMapReadout();
          requestMindMapDraw();
        }
      });

      canvas.addEventListener('wheel', (ev) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const delta = ev.deltaY < 0 ? 0.12 : -0.12;
        mmState.zoom = Math.max(0.65, Math.min(1.85, mmState.zoom + delta));
        requestMindMapDraw();
      }, { passive: false });

      if (typeof ResizeObserver === 'function') {
        mmState.resizeObs = new ResizeObserver(() => {
          resizeWikiMindMap();
          requestMindMapDraw();
        });
        mmState.resizeObs.observe(stage);
      } else {
        window.addEventListener('resize', () => {
          resizeWikiMindMap();
          requestMindMapDraw();
        });
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && activeView === 'wiki' && wikiViewMode === '3d') {
        startWikiMindMapLoop();
      }
    });

    window.setWikiViewMode = function(mode) {
      wikiViewMode = mode === 'list' ? 'list' : '3d';
      if (wikiViewMode !== '3d' && mmState.rafId) {
        cancelAnimationFrame(mmState.rafId);
        mmState.rafId = 0;
      }
      const wrap = document.getElementById('wiki-mindmap-wrap');
      if (wrap) wrap.hidden = wikiViewMode !== '3d';
      syncUrlState();
      if (latestData) renderWikiContentOnly(latestData);
      if (wikiViewMode === '3d') {
        requestAnimationFrame(() => {
          resizeWikiMindMap();
          startWikiMindMapLoop();
        });
      }
    };

    window.toggleWikiMindMapOrbit = function() {
      mmState.autoOrbit = !mmState.autoOrbit;
      if (mmState.autoOrbit) mmState.orbitHoldUntil = 0;
      syncMindMapOrbitButton();
      startWikiMindMapLoop();
    };

    window.zoomWikiMindMap = function(step) {
      mmState.zoom = Math.max(0.65, Math.min(1.85, mmState.zoom + (Number(step) || 0)));
      requestMindMapDraw();
    };

    window.resetWikiMindMap = function() {
      mmState.zoom = 1;
      mmState.velYaw = 0;
      mmState.velPitch = 0;
      if (selectedWikiSlug && mmState.nodeBySlug.has(selectedWikiSlug)) {
        focusMindMapOnSlug(selectedWikiSlug);
      } else {
        mmState.yaw = 0.35;
        mmState.pitch = 0.18;
        mmState.targetYaw = null;
        mmState.targetPitch = null;
        requestMindMapDraw();
      }
    };

    function setTab(view) {
      const prevView = activeView;
      const nextView = ALLOWED.includes(view) ? view : 'overview';
      const didSwitch = hasMountedInitialTab && nextView !== prevView;
      activeView = nextView;
      document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
        const selected = btn.dataset.view === activeView;
        btn.classList.toggle('active', selected);
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.setAttribute('tabindex', selected ? '0' : '-1');
      });
      ALLOWED.forEach((v) => {
        const el = document.getElementById('view-' + v);
        if (!el) return;
        if (v === activeView) {
          el.style.display = 'block';
          if (didSwitch && !prefersReducedMotion()) {
            el.classList.remove('pane-enter');
            void el.offsetWidth;
            el.classList.add('pane-enter');
          }
        } else {
          el.style.display = 'none';
          el.classList.remove('pane-enter');
        }
      });
      hasMountedInitialTab = true;
      syncUrlState();
      syncSlidingTabPill(document.getElementById('main-tab-bar'), !didSwitch);
      requestAnimationFrame(() => {
        syncAllSlidingPills(true);
        if (activeView === 'wiki' && wikiViewMode === '3d') {
          resizeWikiMindMap();
          startWikiMindMapLoop();
        }
      });
    }

    document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.view));
    });
    document.getElementById('refresh-btn').addEventListener('click', () => {
      const rBtn = document.getElementById('refresh-btn');
      if (rBtn && !prefersReducedMotion()) {
        rBtn.classList.remove('is-spinning');
        void rBtn.offsetWidth;
        rBtn.classList.add('is-spinning');
      }
      loadSnapshot(true);
    });
    document.getElementById('refresh-btn').addEventListener('animationend', () => {
      const rBtn = document.getElementById('refresh-btn');
      if (rBtn) rBtn.classList.remove('is-spinning');
    });
    window.addEventListener('resize', () => syncAllSlidingPills(true));

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const summary = target ? target.closest('details.hud-details > summary') : null;
      if (!summary) return;
      const details = summary.parentElement;
      if (!details || details.tagName !== 'DETAILS' || prefersReducedMotion() || typeof details.animate !== 'function') {
        return;
      }
      event.preventDefault();
      if (details._hudAnim) {
        try { details._hudAnim.cancel(); } catch { /* fail open: Web Animation already finished */ }
        details._hudAnim = null;
      }
      const startHeight = details.offsetHeight;
      if (details.open && !details.classList.contains('is-closing')) {
        details.classList.add('is-closing');
        const cs = getComputedStyle(details);
        const collapsedH = Math.ceil(
          summary.offsetHeight
          + (parseFloat(cs.paddingTop) || 0)
          + (parseFloat(cs.paddingBottom) || 0)
          + (parseFloat(cs.borderTopWidth) || 0)
          + (parseFloat(cs.borderBottomWidth) || 0),
        );
        details.style.overflow = 'hidden';
        const anim = details.animate(
          [
            { height: startHeight + 'px', opacity: 1 },
            { height: collapsedH + 'px', opacity: 0.92 },
          ],
          { duration: 150, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' },
        );
        details._hudAnim = anim;
        anim.onfinish = () => {
          details._hudAnim = null;
          details.open = false;
          details.classList.remove('is-closing');
          details.style.height = '';
          details.style.overflow = '';
          if (details.dataset.hudKey) persistedDetailsState[details.dataset.hudKey] = false;
        };
        anim.oncancel = () => {
          details.classList.remove('is-closing');
          details.style.height = '';
          details.style.overflow = '';
        };
      } else {
        details.classList.remove('is-closing');
        details.style.height = startHeight + 'px';
        details.style.overflow = 'hidden';
        details.open = true;
        details.style.height = 'auto';
        const endHeight = details.offsetHeight;
        details.style.height = startHeight + 'px';
        const anim = details.animate(
          [
            { height: startHeight + 'px' },
            { height: endHeight + 'px' },
          ],
          { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
        details._hudAnim = anim;
        anim.onfinish = () => {
          details._hudAnim = null;
          details.style.height = '';
          details.style.overflow = '';
          if (details.dataset.hudKey) persistedDetailsState[details.dataset.hudKey] = true;
        };
        anim.oncancel = () => {
          details.style.height = '';
          details.style.overflow = '';
        };
      }
    });

    function renderCommandPaletteList() {
      const listEl = document.getElementById('cmd-palette-list');
      if (!listEl) return;
      const allItems = buildCommandPaletteItems(latestData || {});
      const q = cmdPaletteQuery.trim().toLowerCase();
      cmdPaletteItems = q
        ? allItems.filter((it) =>
            String(it.title || '').toLowerCase().includes(q)
            || String(it.subtitle || '').toLowerCase().includes(q)
            || String(it.category || '').toLowerCase().includes(q)
          )
        : allItems;
      if (!cmdPaletteItems.length) {
        cmdPaletteSelected = 0;
        listEl.innerHTML = '<div class="muted p-md fs-12">No matching commands, skills, subagents, artifacts, or wiki pages.</div>';
        return;
      }
      if (cmdPaletteSelected >= cmdPaletteItems.length) cmdPaletteSelected = cmdPaletteItems.length - 1;
      if (cmdPaletteSelected < 0) cmdPaletteSelected = 0;
      listEl.innerHTML = cmdPaletteItems.slice(0, 40).map((it, idx) => \`
        <button type="button" role="option" aria-selected="\${idx === cmdPaletteSelected ? 'true' : 'false'}" class="cmd-palette-item \${idx === cmdPaletteSelected ? 'is-selected' : ''}" data-pal-idx="\${idx}" onclick="executeCommandPaletteIdx(this.dataset.palIdx)">
          <span class="flex-1-min0">
            <span class="fw-600 fs-12">\${highlightMatch(it.title, cmdPaletteQuery)}</span>
            <span class="muted fs-12" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${highlightMatch(it.subtitle, cmdPaletteQuery)}</span>
          </span>
          <span class="badge">\${esc(it.category)}</span>
        </button>\`).join('');
    }

    window.executeCommandPaletteIdx = function(rawIdx) {
      const idx = Number(rawIdx);
      const item = cmdPaletteItems[idx];
      if (!item || !item.action) return;
      window.closeCommandPalette();
      const act = item.action;
      if (act.type === 'view') {
        setTab(act.target);
      } else if (act.type === 'skill') {
        skillSearch = String(act.target || '');
        skillCategory = 'All';
        setTab('skills');
        if (latestData) renderSkills(latestData);
      } else if (act.type === 'subagent') {
        subagentSearch = String(act.target || '');
        subagentLane = 'All';
        setTab('subagents');
        if (latestData) renderSubagents(latestData);
      } else if (act.type === 'artifact') {
        if (String(act.target || '').endsWith('.json')) {
          window.openJsonReceiptDrawer(act.target, act.title || act.target, act.kind || 'receipt');
        } else {
          window.openMarkdownDrawer(act.target, act.title || act.target, act.kind || 'artifact');
        }
      } else if (act.type === 'wiki') {
        window.navigateToWikiSlug(act.target);
      }
    };

    window.openCommandPalette = function() {
      if (document.getElementById('artifact-drawer')?.classList.contains('is-open')) {
        window.closeArtifactDrawer();
      }
      cmdPaletteTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      cmdPaletteOpen = true;
      cmdPaletteQuery = '';
      cmdPaletteSelected = 0;
      const backdrop = document.getElementById('cmd-palette-backdrop');
      const palette = document.getElementById('cmd-palette');
      const input = document.getElementById('cmd-palette-input');
      if (backdrop) {
        backdrop.classList.add('is-open');
        backdrop.setAttribute('aria-hidden', 'false');
      }
      if (palette) {
        palette.classList.add('is-open');
        palette.setAttribute('aria-hidden', 'false');
      }
      setMainShellInert(true);
      if (input) {
        input.value = '';
        renderCommandPaletteList();
        try { input.focus({ preventScroll: true }); } catch { /* fail open: focus unsupported */ }
      } else {
        renderCommandPaletteList();
      }
    };

    window.closeCommandPalette = function() {
      if (!cmdPaletteOpen) return;
      cmdPaletteOpen = false;
      const backdrop = document.getElementById('cmd-palette-backdrop');
      const palette = document.getElementById('cmd-palette');
      if (backdrop) {
        backdrop.classList.remove('is-open');
        backdrop.setAttribute('aria-hidden', 'true');
      }
      if (palette) {
        palette.classList.remove('is-open');
        palette.setAttribute('aria-hidden', 'true');
      }
      setMainShellInert(false);
      if (cmdPaletteTriggerEl && document.contains(cmdPaletteTriggerEl)) {
        try { cmdPaletteTriggerEl.focus({ preventScroll: true }); } catch { /* fail open: focus restore unsupported */ }
      }
      cmdPaletteTriggerEl = null;
    };

    window.toggleCommandPalette = function() {
      if (cmdPaletteOpen) window.closeCommandPalette();
      else window.openCommandPalette();
    };

    const cmdInputEl = document.getElementById('cmd-palette-input');
    if (cmdInputEl) {
      cmdInputEl.addEventListener('input', () => {
        cmdPaletteQuery = String(cmdInputEl.value || '');
        cmdPaletteSelected = 0;
        renderCommandPaletteList();
      });
    }

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key || '').toLowerCase() === 'k') {
        event.preventDefault();
        window.toggleCommandPalette();
        return;
      }
      if (cmdPaletteOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          window.closeCommandPalette();
          return;
        }
        const shownCount = Math.min(40, cmdPaletteItems.length);
        if (event.key === 'ArrowDown' && shownCount > 0) {
          event.preventDefault();
          cmdPaletteSelected = (cmdPaletteSelected + 1) % shownCount;
          renderCommandPaletteList();
          return;
        }
        if (event.key === 'ArrowUp' && shownCount > 0) {
          event.preventDefault();
          cmdPaletteSelected = (cmdPaletteSelected - 1 + shownCount) % shownCount;
          renderCommandPaletteList();
          return;
        }
        if (event.key === 'Enter' && shownCount > 0) {
          event.preventDefault();
          window.executeCommandPaletteIdx(cmdPaletteSelected);
          return;
        }
        return;
      }
      if (event.key === 'Escape') {
        const drawer = document.getElementById('artifact-drawer');
        if (drawer && drawer.classList.contains('is-open')) {
          event.preventDefault();
          window.closeArtifactDrawer();
          return;
        }
        if (pendingCancelConfirm) {
          window.abortCancelMode();
        }
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.getAttribute('role') === 'tab') {
        const tablist = active.closest('[role="tablist"]');
        if (tablist && (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home' || event.key === 'End')) {
          const tabs = [...tablist.querySelectorAll('[role="tab"]')];
          const curIdx = tabs.indexOf(active);
          if (curIdx !== -1 && tabs.length > 1) {
            event.preventDefault();
            let nextIdx = curIdx;
            if (event.key === 'ArrowRight') nextIdx = (curIdx + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
            else if (event.key === 'Home') nextIdx = 0;
            else if (event.key === 'End') nextIdx = tabs.length - 1;
            const nextTab = tabs[nextIdx];
            if (nextTab) {
              nextTab.click();
              nextTab.focus();
            }
            return;
          }
        }
      }
      const inEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
      if (inEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (activeView !== 'skills' && activeView !== 'subagents') {
          setTab('skills');
        }
        const searchId = activeView === 'subagents' ? 'subagent-search-input' : 'skill-search-input';
        const input = document.getElementById(searchId);
        if (input) input.focus();
      } else if (/^[1-5]$/.test(event.key)) {
        const target = ALLOWED[Number(event.key) - 1];
        if (target) setTab(target);
      }
    });

    setTab(activeView);

    function applySnapshot(data, forceRender = false) {
      if (!data || typeof data !== 'object') return;
      latestData = data;
      document.getElementById('status-line').textContent = data.statusLine || '[OMA] No active modes';
      if (!forceRender && data.digest && data.digest === lastSnapshotDigest) {
        return;
      }
      lastSnapshotDigest = data.digest || '';
      const uiState = captureUiState();
      render(data);
      restoreUiState(uiState);
    }

    async function loadSnapshot(forceRender = false) {
      try {
        const res = await fetch('/api/status?' + buildStreamQuery().toString(), {
          headers: token ? { 'X-Sidecar-Token': token } : {}
        });
        if (!res.ok) return;
        const snap = await res.json();
        applySnapshot(snap, forceRender);
      } catch { /* fail open: transient status fetch failure */ }
    }

    window.navigateToWikiSlug = function(slug) {
      if (!slug) return;
      if (document.getElementById('artifact-drawer').classList.contains('is-open')) {
        window.closeArtifactDrawer();
      }
      const nextSlug = String(slug);
      if (nextSlug !== selectedWikiSlug) pendingWikiDocTransition = true;
      selectedWikiSlug = nextSlug;
      wikiCategory = 'All';
      setTab('wiki');
      if (latestData) {
        const st = captureUiState();
        renderWiki(latestData);
        restoreUiState(st);
        focusMindMapOnSlug(selectedWikiSlug);
      }
    };

    window.selectWikiSlug = function(slug) {
      const nextSlug = String(slug || '');
      if (nextSlug && nextSlug !== selectedWikiSlug) {
        pendingWikiDocTransition = true;
      }
      selectedWikiSlug = nextSlug;
      if (latestData && wikiCategory !== 'All') {
        const entry = (latestData.wiki?.entries || []).find((e) => e.slug === selectedWikiSlug);
        if (entry && entry.category && entry.category !== wikiCategory) {
          wikiCategory = 'All';
        }
      }
      syncUrlState();
      if (latestData) renderWikiContentOnly(latestData);
      focusMindMapOnSlug(selectedWikiSlug);
    };

    window.setWikiCategory = function(cat) {
      wikiCategory = String(cat || 'All');
      if (latestData) {
        const entries = latestData.wiki?.entries || [];
        const inCat = entries.filter((e) => wikiCategory === 'All' || e.category === wikiCategory);
        let switchedSlug = false;
        if (inCat.length && !inCat.some((e) => e.slug === selectedWikiSlug)) {
          selectedWikiSlug = inCat[0].slug;
          switchedSlug = true;
          pendingWikiDocTransition = true;
          syncUrlState();
        }
        renderWikiContentOnly(latestData);
        if (switchedSlug) focusMindMapOnSlug(selectedWikiSlug);
      }
    };

    window.setOverviewReviewTab = function(tab) {
      overviewReviewTab = tab === 'research' ? 'research' : 'reviews';
      if (latestData) {
        const st = captureUiState();
        renderOverview(latestData);
        restoreUiState(st);
      }
    };

    window.setSkillCategory = function(cat) {
      if (skillCategory !== cat) pendingSkillFilterAnim = true;
      skillCategory = cat;
      if (latestData) renderSkills(latestData);
    };

    window.onSkillSearchInput = function(val) {
      skillSearch = String(val || '');
      if (latestData) renderSkillsListOnly(latestData);
    };

    window.setSubagentLane = function(lane) {
      if (subagentLane !== lane) pendingSubagentFilterAnim = true;
      subagentLane = lane;
      if (latestData) renderSubagents(latestData);
    };

    window.onSubagentSearchInput = function(val) {
      subagentSearch = String(val || '');
      if (latestData) renderSubagentsListOnly(latestData);
    };

    window.onWorkspaceRootChange = function(nextRoot) {
      activeRoot = String(nextRoot || '').trim();
      activeScopeFilter = 'all';
      lastSnapshotDigest = '';
      syncUrlState();
      connectEventStream();
      loadSnapshot(true);
    };

    window.setScopeFilter = function(scopeVal) {
      activeScopeFilter = String(scopeVal || 'all');
      syncUrlState();
      if (latestData) renderOverview(latestData);
    };

    window.scrollToWikiHeading = function(rawIdx) {
      const idx = Number(rawIdx);
      if (!Number.isFinite(idx) || idx < 0) return;
      const headings = document.querySelectorAll('#wiki-doc-pane .md-h1, #wiki-doc-pane .md-h2, #wiki-doc-pane .md-h3');
      const target = headings[idx];
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    };

    function renderWikiSearchResults() {
      const el = document.getElementById('wiki-search-results');
      if (!el) return;
      const q = wikiQueryText.trim();
      if (!q) {
        el.innerHTML = '';
        return;
      }
      const list = Array.isArray(wikiSearchResults) ? wikiSearchResults : [];
      if (!list.length) {
        el.innerHTML = '<div class="muted fs-12 mb-sm">No wiki matches for query.</div>';
        return;
      }
      el.innerHTML = \`
        <div class="stack-sm mb-md">
          \${list.slice(0, 8).map((r) => \`
            <button type="button" class="wiki-page-item" data-wiki-slug="\${esc(r.slug)}" onclick="navigateToWikiSlug(this.dataset.wikiSlug)">
              <span class="flex-1-min0">
                <span class="fw-600 fs-12">\${highlightMatch(r.title || r.slug, q)}</span>
                \${r.snippet ? \`<span class="muted fs-12" style="display:block;">\${highlightMatch(r.snippet, q)}</span>\` : ''}
              </span>
              <span class="badge tabular">score \${esc(r.score)}</span>
            </button>\`).join('')}
        </div>\`;
    }

    window.onWikiQueryInput = function(val) {
      wikiQueryText = String(val || '');
      if (wikiSearchTimer) clearTimeout(wikiSearchTimer);
      const q = wikiQueryText.trim();
      if (!q) {
        wikiSearchResults = null;
        renderWikiSearchResults();
        return;
      }
      wikiSearchTimer = setTimeout(async () => {
        wikiSearchTimer = null;
        try {
          const sp = buildStreamQuery();
          sp.set('q', q);
          const res = await fetch('/api/wiki-search?' + sp.toString(), {
            headers: token ? { 'X-Sidecar-Token': token } : {},
          });
          if (!res.ok) return;
          const payload = await res.json();
          if (wikiQueryText.trim() === q) {
            wikiSearchResults = Array.isArray(payload.results) ? payload.results : [];
            renderWikiSearchResults();
          }
        } catch { /* fail open: ignore transient wiki search failure */ }
      }, 180);
    };

    function syncWorkspaceSwitcher(data) {
      const sel = document.getElementById('workspace-root-select');
      if (!sel) return;
      const wrap = document.getElementById('workspace-select-wrap') || sel;
      const roots = Array.isArray(data?.workspaces) ? data.workspaces : [];
      if (roots.length <= 1) {
        wrap.classList.add('hidden-pane');
        return;
      }
      const curRoot = activeRoot || data.activeRoot || data.workspace || roots[0];
      sel.innerHTML = roots.map((r) => {
        const label = formatWorkspaceName(r);
        return \`<option value="\${esc(r)}" \${r === curRoot ? 'selected' : ''}>\${esc(label)}</option>\`;
      }).join('');
      sel.title = curRoot;
      wrap.classList.remove('hidden-pane');
    }

    function renderHyperplanReviewRow(h) {
      return \`
        <div class="list-row-card">
          <div class="flex-1-min0">
            <div class="row-wrap mb-xs">
              <span class="badge badge-active">Hyperplan</span>
              <span class="badge tabular">SURVIVES: \${h.survives}</span>
              <span class="badge tabular">WEAKENED: \${h.weakened}</span>
              <span class="badge tabular">KILLED: \${h.killed}</span>
            </div>
            <div class="muted fs-12" title="\${esc(h.file)}"><code>\${esc(formatShortRelPath(h.file))}</code>\${h.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(h.updatedAt))}</span>\` : ''}</div>
          </div>
          <button type="button" class="action-btn" data-file="\${esc(h.file)}" onclick="openMarkdownDrawer(this.dataset.file, 'Hyperplan Distillation', 'hyperplan')">Open Distillation</button>
        </div>\`;
    }

    function renderCodeReviewRow(c) {
      const recCls = c.recommendation === 'APPROVE'
        ? 'badge badge-live'
        : (c.recommendation === 'REQUEST CHANGES' ? 'badge badge-danger' : 'badge badge-active');
      return \`
        <div class="list-row-card">
          <div class="flex-1-min0">
            <div class="row-wrap mb-xs">
              <span class="\${recCls}">\${esc(c.recommendation)}</span>
              <span class="badge">Architect: \${esc(c.architectStatus)}</span>
              <span class="muted tabular fs-12">\${c.filesReviewed} file(s) &middot; \${c.totalIssues} issue(s)</span>
            </div>
            <div class="muted fs-12" title="\${esc(c.file)}"><code>\${esc(formatShortRelPath(c.file))}</code>\${c.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(c.updatedAt))}</span>\` : ''}</div>
          </div>
          <button type="button" class="action-btn" data-file="\${esc(c.file)}" onclick="openMarkdownDrawer(this.dataset.file, 'Code Review Report', 'review')">Preview</button>
        </div>\`;
    }

    function renderOverview(data) {
      syncWorkspaceSwitcher(data);
      const scopes = Array.isArray(data.trackedScopes) && data.trackedScopes.length
        ? data.trackedScopes
        : [{ scope: '.', path: data.workspace }];
      if (activeScopeFilter !== 'all' && (scopes.length <= 1 || !scopes.some((sc) => sc.scope === activeScopeFilter))) {
        activeScopeFilter = 'all';
      }
      const matchesScope = (item) => !activeScopeFilter || activeScopeFilter === 'all' || ((item && item.scope) || '.') === activeScopeFilter;
      const allModes = Array.isArray(data.modes) ? data.modes : [];
      const filteredModes = allModes.filter(matchesScope);
      const { current: curMode, lastCompleted } = selectCurrentMode(filteredModes);
      const activeModeObj = curMode && !curMode.stale ? curMode : null;

      let currentModeBodyHtml = '';
      if (curMode) {
        const statePill = curMode.awaitingConfirmation
          ? '<span class="badge badge-live">WAITING CONFIRMATION</span>'
          : (curMode.stale ? '<span class="badge">stale (&gt;6h)</span>' : '<span class="badge badge-live">active</span>');
        const staleFixBtn = curMode.stale
          ? \`<button type="button" class="action-btn" onclick="runQuickCommand(this, '/cancel', 'active-chat')" title="Cancel stale mode in active chat">Cancel Stale Mode</button>\`
          : '';
        currentModeBodyHtml = \`
          <div class="mode-spotlight">
            <div class="row-wrap-sm min0">
              <code class="fw-600 fs-13">\${esc(curMode.mode)}</code>
              <span class="badge \${!curMode.stale ? 'badge-active' : ''}">\${esc(curMode.phase)}</span>
              \${statePill}
              \${curMode.iteration != null ? \`<span class="muted tabular fs-12">#\${esc(curMode.iteration)}</span>\` : ''}
            </div>
            <div class="row-wrap-sm">
              \${staleFixBtn}
              <span class="badge" title="\${esc(curMode.scope && curMode.scope !== '.' ? curMode.scope : data.workspace)}">\${esc(formatScopeLabel(curMode.scope || '.'))}</span>
            </div>
          </div>\`;
      } else {
        currentModeBodyHtml = \`
          <div class="mode-spotlight">
            <div class="row-wrap-sm min0">
              <code class="fw-600 fs-13">solo</code>
              <span class="badge">default lane</span>
              <span class="muted fs-12">No active workflow mode</span>
            </div>
            \${lastCompleted ? \`<span class="muted tabular fs-12" title="Most recent completed mode">Last: <code>\${esc(lastCompleted.mode)}</code> (\${esc(lastCompleted.phase)})</span>\` : ''}
          </div>
          <div class="launchpad-grid">
            <div class="launchpad-item">
              <div><div class="fw-600 fs-12">$deep-interview</div><div class="muted fs-12">Clarify vague scope before planning</div></div>
              <button type="button" class="action-btn" onclick="runQuickCommand(this, '/deep-interview', 'active-chat')">Start Interview</button>
            </div>
            <div class="launchpad-item">
              <div><div class="fw-600 fs-12">$ralplan --light</div><div class="muted fs-12">Fast structured implementation plan</div></div>
              <button type="button" class="action-btn" onclick="runQuickCommand(this, '/ralplan --light', 'active-chat')">Quick Plan</button>
            </div>
            <div class="launchpad-item">
              <div><div class="fw-600 fs-12">$autopilot</div><div class="muted fs-12">End-to-end interview, plan &amp; goals</div></div>
              <button type="button" class="action-btn action-btn-primary" onclick="runQuickCommand(this, '/autopilot', 'active-chat')">Launch Autopilot</button>
            </div>
            <div class="launchpad-item">
              <div><div class="fw-600 fs-12">$analyze</div><div class="muted fs-12">Read-only repository investigation</div></div>
              <button type="button" class="action-btn" onclick="runQuickCommand(this, '/analyze', 'active-chat')">Analyze Repo</button>
            </div>
          </div>\`;
      }

      const cancelControlHtml = pendingCancelConfirm
        ? \`<button type="button" class="action-btn action-btn-danger" data-cancel-mode="\${esc(activeModeObj ? activeModeObj.mode : '')}" onclick="confirmCancelMode(this, this.dataset.cancelMode)">Confirm /cancel\${activeModeObj ? ' ' + esc(activeModeObj.mode) : ''}</button>
           <button type="button" class="action-btn" onclick="abortCancelMode()">Abort</button>\`
        : \`<button type="button" class="action-btn" onclick="armCancelMode()">Cancel Mode</button>\`;

      const quickActionsHtml = \`
        <div class="cmd-actions section-divider-top">
          <button type="button" class="action-btn action-btn-primary" onclick="runQuickCommand(this, 'continue', 'active-chat')">Continue</button>
          \${cancelControlHtml}
          <button type="button" class="action-btn" onclick="runQuickCommand(this, '/hud --handoff', 'active-chat')">Create Handoff</button>
          <button type="button" class="action-btn" onclick="runQuickCommand(this, '/doctor', 'active-chat')">Run /doctor</button>
          <a class="action-btn" href="customization://oh-my-agy" title="Open oh-my-agy settings">Plugin Settings</a>
        </div>\`;

      const qgRows = (data.qualityGates || []).map((g) => \`<li><code>\${esc(g.stage)}</code> &rarr; <code>\${esc(g.skill)}</code> (\${esc(g.mode)}, \${esc(g.model)})</li>\`).join('');

      let ugHtml = '';
      if (data.ultragoal && matchesScope(data.ultragoal)) {
        const ug = data.ultragoal;
        const ugScope = ug.scope && ug.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(ug.scope)}">\${esc(formatScopeLabel(ug.scope))}</span>\` : '';
        const pct = ug.counts.total > 0 ? Math.round((ug.counts.complete / ug.counts.total) * 100) : 0;
        const goalRows = (ug.goals || []).map((g) => \`
          <tr>
            <td class="col-id"><code>\${esc(g.id)}</code></td>
            <td class="col-main">
              <div>\${esc(g.title)}</div>
              <div class="muted tabular fs-12 mt-xxs">Rigor: <code>\${esc(g.rigor)}</code> &middot; Retries: \${g.productFailures}/3</div>
            </td>
            <td class="col-status">
              <div class="status-cell-actions">
                <span class="badge \${g.status === 'in_progress' ? 'badge-active' : (g.status === 'complete' || g.status === 'completed' ? 'badge-live' : '')}">\${esc(g.status)}</span>
                \${g.evidencePath ? \`<button type="button" class="badge pointer" data-file="\${esc(g.evidencePath)}" data-gid="\${esc(g.id)}" onclick="openJsonReceiptDrawer(this.dataset.file, 'Evidence: ' + this.dataset.gid, 'evidence')" title="Preview goal verification receipt">Receipt</button>\` : ''}
              </div>
            </td>
          </tr>\`).join('');
        const ledgerList = (Array.isArray(ug.recentLedger) ? ug.recentLedger : []).slice(0, 5);
        const ledgerRows = ledgerList.map((entry) => {
          const ts = entry.at || entry.ts || '';
          const gid = entry.goal_id || entry.goal || 'ALL';
          const act = entry.event || entry.action || entry.status || 'event';
          const note = entry.note || entry.summary || entry.verdict || entry.evidence || '';
          const actCls = /complete|pass|done/i.test(act) ? 'badge badge-live' : 'badge badge-active';
          return \`
            <div class="ledger-item">
              <div class="ledger-item-head">
                <div class="row-wrap-sm min0">
                  <code>\${esc(gid)}</code>
                  <span class="\${actCls}">\${esc(act)}</span>
                </div>
                \${ts ? \`<span class="muted tabular fs-12" title="\${esc(ts)}">\${esc(formatShortTime(ts))}</span>\` : ''}
              </div>
              \${note ? \`<div class="ledger-item-note">\${esc(note)}</div>\` : ''}
            </div>\`;
        }).join('');
        const ledgerHtml = ledgerList.length ? \`
          <details class="hud-details" data-hud-key="ug-ledger">
            <summary class="tabular"><span class="summary-label">Recent Ledger Events (\${ledgerList.length})</span></summary>
            <div class="ledger-list">\${ledgerRows}</div>
          </details>\` : '';
        const ugDocsHtml = (ug.briefPath || ug.notepadPath) ? \`
          <div class="row-wrap mt-sm mb-sm">
            \${ug.briefPath ? \`<button type="button" class="action-btn" data-file="\${esc(ug.briefPath)}" onclick="openMarkdownDrawer(this.dataset.file, 'Ultragoal Brief', 'ultragoal')">Open Brief</button>\` : ''}
            \${ug.notepadPath ? \`<button type="button" class="action-btn" data-file="\${esc(ug.notepadPath)}" onclick="openMarkdownDrawer(this.dataset.file, 'Ultragoal Notepad', 'ultragoal')">Open Notepad</button>\` : ''}
          </div>\` : '';
        ugHtml = \`
          <div class="card">
            <div class="row-between-top">
              <div class="fw-600 flex-1-160 wrap-anywhere">Ultragoal: \${esc(ug.objective || 'Active Plan')}\${ugScope}</div>
              <span class="badge badge-active tabular">\${ug.counts.complete}/\${ug.counts.total}</span>
            </div>
            \${ugDocsHtml}
            <div class="bar-track my-md"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, pct)) / 100).toFixed(4)};"></div></div>
            <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Goal</th><th class="col-status">Status</th></tr></thead><tbody>\${goalRows}</tbody></table></div>
            \${ledgerHtml}
          </div>\`;
      }

      let ivHtml = '';
      if (data.interview && matchesScope(data.interview)) {
        const iv = data.interview;
        const ivScope = iv.scope && iv.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(iv.scope)}">\${esc(formatScopeLabel(iv.scope))}</span>\` : '';
        const ambPct = Math.round((iv.currentAmbiguity || 0) * 100);
        const threshPct = Math.round((iv.threshold || 0.2) * 100);
        const dimEntries = Object.entries(iv.dimensions || {});
        const dimsHtml = dimEntries.length ? \`
          <div class="stack-sm mt-md">
            \${dimEntries.map(([dimKey, rawVal]) => {
              const num = Number(rawVal);
              const pctVal = Number.isFinite(num) ? (num <= 1 ? Math.round(num * 100) : Math.round(num)) : 0;
              return \`
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;"><span class="muted">\${esc(dimKey)}</span><span class="tabular">\${pctVal}%</span></div>
                  <div class="bar-track bar-track-thin"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, pctVal)) / 100).toFixed(4)};"></div></div>
                </div>\`;
            }).join('')}
          </div>\` : '';
        const roundsList = Array.isArray(iv.rounds) ? iv.rounds : [];
        const roundsHtml = roundsList.length ? \`
          <details class="hud-details" data-hud-key="iv-rounds">
            <summary class="tabular"><span class="summary-label">Interview Rounds (\${roundsList.length})</span></summary>
            \${roundsList.map((r) => \`
              <div class="health-item">
                <div style="display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;font-size:12px;">
                  <strong>Round \${esc(r.round)}: \${esc(r.target)}</strong>
                  <span class="badge tabular">\${esc(r.label)}\${r.ambiguity !== null ? ' &middot; ' + Math.round(r.ambiguity * 100) + '%' : ''}</span>
                </div>
                \${r.question ? \`<div class="muted fs-12 mt-xxs">Q: \${esc(r.question)}</div>\` : ''}
                \${r.answer ? \`<div class="fs-12 mt-xxs">A: \${esc(r.answer)}</div>\` : ''}
              </div>\`).join('')}
          </details>\` : '';
        const specBtn = iv.specFile
          ? \`<button type="button" class="action-btn action-btn-primary" data-file="\${esc(iv.specFile)}" onclick="openMarkdownDrawer(this.dataset.file, 'Deep Interview Spec', 'spec')">Open Spec</button>\`
          : '';
        ivHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
              <div style="min-width:0;flex:1 1 160px;">
                <div class="fw-600 wrap-anywhere">Deep Interview: <code>\${esc(iv.slug || 'session')}</code>\${ivScope}</div>
                <div class="muted tabular fs-12 mt-xxs">Profile: <code>\${esc(iv.profile)}</code> &middot; Ambiguity: \${ambPct}% (&le; \${threshPct}%)</div>
              </div>
              \${specBtn}
            </div>
            <div class="bar-track mt-md"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, 100 - ambPct)) / 100).toFixed(4)};"></div></div>
            <div class="row-wrap-sm mt-md">
              <span class="badge \${iv.readinessGates?.nonGoals ? 'badge-live' : ''}">Non-goals: \${iv.readinessGates?.nonGoals ? 'PASS' : 'PENDING'}</span>
              <span class="badge \${iv.readinessGates?.decisionBoundaries ? 'badge-live' : ''}">Decision Boundaries: \${iv.readinessGates?.decisionBoundaries ? 'PASS' : 'PENDING'}</span>
              <span class="badge \${iv.readinessGates?.pressurePass ? 'badge-live' : ''}">Pressure Pass: \${iv.readinessGates?.pressurePass ? 'PASS' : 'PENDING'}</span>
              <span class="badge \${iv.readinessGates?.closureAudit ? 'badge-live' : ''}">Closure Audit: \${iv.readinessGates?.closureAudit ? 'PASS' : 'PENDING'}</span>
            </div>
            \${dimsHtml}
            \${roundsHtml}
          </div>\`;
      }

      let teamHtml = '';
      const filteredTeams = Array.isArray(data.teams) ? data.teams.filter(matchesScope) : [];
      if (filteredTeams.length) {
        teamHtml = filteredTeams.map((t) => {
          const tScope = t.scope && t.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(t.scope)}">\${esc(formatScopeLabel(t.scope))}</span>\` : '';
          const waves = buildTaskDagWaves(t.tasks || []);
          const wavesHtml = waves.length ? \`
            <div class="dag-waves" aria-label="Task execution waves">
              \${waves.map((wave, wIdx) => \`
                <div class="dag-wave-col">
                  <div class="dag-wave-title tabular">\${wave[0]?._cycle ? 'Cycle Overflow' : 'Wave ' + (wIdx + 1)} (\${wave.length})</div>
                  \${wave.map((task) => \`
                    <div class="dag-node">
                      <div class="row-between-sm">
                        <code>\${esc(task.id)}</code>
                        <span class="badge \${task.status === 'in_progress' ? 'badge-active' : (task.status === 'completed' || task.status === 'complete' ? 'badge-live' : '')}">\${esc(task.status)}</span>
                      </div>
                      <div class="muted fs-12 mt-xxs wrap-anywhere">\${esc(task.title)}</div>
                      \${task.evidencePath ? \`<button type="button" class="badge mt-xs" data-file="\${esc(task.evidencePath)}" data-tid="\${esc(task.id)}" onclick="openJsonReceiptDrawer(this.dataset.file, 'Task Evidence: ' + this.dataset.tid, 'evidence')">Evidence JSON</button>\` : ''}
                    </div>\`).join('')}
                </div>\`).join('')}
            </div>\` : '';
          const rows = (t.tasks || []).map((task) => \`
            <tr>
              <td class="col-id"><code>\${esc(task.id)}</code></td>
              <td class="col-main">
                <div>\${esc(task.title)}</div>
                <div class="muted fs-12 mt-xxs">Role: <code>\${esc(task.role)}</code> &middot; Evidence: \${task.requiresCodeChange ? (task.hasEvidence ? 'verified' : 'pending') : 'n/a'}</div>
              </td>
              <td class="col-status">
                <div class="status-cell-actions">
                  <span class="badge \${task.status === 'in_progress' ? 'badge-active' : ''}">\${esc(task.status)}</span>
                  \${task.evidencePath ? \`<button type="button" class="badge pointer" data-file="\${esc(task.evidencePath)}" data-tid="\${esc(task.id)}" onclick="openJsonReceiptDrawer(this.dataset.file, 'Task Evidence: ' + this.dataset.tid, 'evidence')" title="Preview task verification receipt">Receipt</button>\` : ''}
                </div>
              </td>
            </tr>\`).join('');
          return \`
            <div class="card">
              <div class="fw-600 mb-xs min0 wrap-anywhere">Team Board: <code>\${esc(t.team)}</code>\${tScope}</div>
              <div class="muted mb-sm min0 wrap-anywhere">\${esc(t.objective)}</div>
              \${wavesHtml}
              <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Task</th><th class="col-status">Status</th></tr></thead><tbody>\${rows}</tbody></table></div>
            </div>\`;
        }).join('');
      }

      const sortNewest = (arr) => [...arr].sort((a, b) => {
        const diff = (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0);
        return diff !== 0 ? diff : String(b.file || '').localeCompare(String(a.file || ''));
      });

      const rpRaw = data.reviews?.ralplan;
      const rp = rpRaw && matchesScope(rpRaw) ? rpRaw : null;
      const hpList = (data.reviews?.hyperplan || []).filter(matchesScope);
      const crList = (data.reviews?.codeReviews || []).filter(matchesScope);
      const resList = sortNewest((data.research || []).filter(matchesScope));
      const combinedReviews = sortNewest([
        ...hpList.map((h) => ({ ...h, _revKind: 'hyperplan' })),
        ...crList.map((c) => ({ ...c, _revKind: 'codeReview' })),
      ]);
      const recentReviews = combinedReviews.slice(0, 5);
      const recentResearches = resList.slice(0, 5);

      const art = data.artifacts || { plans: [], specs: [], handoffs: [], ideas: [], asks: [] };
      const artGroups = sortNewest([
        ...(art.plans || []).filter(matchesScope).map((x) => ({ ...x, kind: 'plan' })),
        ...(art.specs || []).filter(matchesScope).map((x) => ({ ...x, kind: 'spec' })),
        ...(art.handoffs || []).filter(matchesScope).map((x) => ({ ...x, kind: 'handoff' })),
        ...(art.ideas || []).filter(matchesScope).map((x) => ({ ...x, kind: 'idea' })),
        ...(art.asks || []).filter(matchesScope).map((x) => ({ ...x, kind: 'ask' })),
      ]);
      const recentArtifacts = artGroups.slice(0, 10);

      let revResHtml = '';
      if (rp || combinedReviews.length || resList.length) {
        const activeRevTab = overviewReviewTab || ((!rp && recentReviews.length === 0 && recentResearches.length > 0) ? 'research' : 'reviews');
        const rpArtsHtml = rp && Array.isArray(rp.planningArtifacts) && rp.planningArtifacts.length
          ? rp.planningArtifacts.map((filePath) => {
              const label = formatShortRelPath(filePath);
              return \`<button type="button" class="badge pointer" data-file="\${esc(filePath)}" data-label="\${esc(label)}" data-kind="ralplan" onclick="openArtifactEntry(this)">\${esc(label)}</button>\`;
            }).join('')
          : '';
        const rpLine = rp ? \`
          <div class="health-item mt-0 mb-sm row-wrap-sm">
            <span class="badge badge-active tabular">Ralplan Iter \${esc(rp.iteration)}</span>
            <span class="badge">Architect: \${esc(rp.architectVerdict)}</span>
            <span class="badge">Critic: \${esc(rp.criticVerdict)}</span>
            <span class="badge \${rp.consensusComplete ? 'badge-live' : ''}">Consensus: \${rp.consensusComplete ? 'COMPLETE' : 'PENDING'}</span>
            \${rpArtsHtml}
          </div>\` : '';
        const reviewRowsHtml = recentReviews.map((item) => item._revKind === 'hyperplan' ? renderHyperplanReviewRow(item) : renderCodeReviewRow(item)).join('');
        const researchRowsHtml = recentResearches.map((r) => \`
          <div class="list-row-card">
            <div class="flex-1-min0">
              <div class="row-wrap mb-xs">
                <span class="badge badge-active tabular">\${r.compositeScore !== null ? 'Score ' + r.compositeScore + '/100' : 'Research'}</span>
                \${r.evalIntegrityVerdict ? \`<span class="badge \${r.evalIntegrityVerdict === 'PASS' ? 'badge-live' : ''}">Eval: \${esc(r.evalIntegrityVerdict)}</span>\` : ''}
                <span class="badge">\${esc(r.lens)}</span>
              </div>
              <div class="fw-600 wrap-anywhere">\${esc(r.title)}</div>
              <div class="muted tabular fs-12 mt-xxs">Claims &middot; V:\${r.claims.verified} &middot; D:\${r.claims.derived} &middot; A:\${r.claims.assumed}</div>
            </div>
            <button type="button" class="action-btn" data-file="\${esc(r.file)}" data-title="\${esc(r.title)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, 'research')">Open Report</button>
          </div>\`).join('');

        const reviewsPaneHtml = (rpLine || reviewRowsHtml)
          ? (rpLine + reviewRowsHtml)
          : '<div class="muted fs-12">No recent reviews recorded yet.</div>';
        const researchPaneHtml = researchRowsHtml
          || '<div class="muted fs-12">No deep research reports recorded yet.</div>';

        revResHtml = \`
          <div class="card">
            <div class="row-between mb-md">
              <div class="fw-600">Recent Reviews &amp; Deep Research</div>
              <div class="tab-bar mb-0" data-sliding-tabs="ov-rev" role="tablist" aria-label="Reviews and research tabs">
                <button type="button" class="tab-btn \${activeRevTab === 'reviews' ? 'active' : ''}" role="tab" aria-selected="\${activeRevTab === 'reviews' ? 'true' : 'false'}" tabindex="\${activeRevTab === 'reviews' ? '0' : '-1'}" onclick="setOverviewReviewTab('reviews')">Reviews <span class="tabular muted">(\${recentReviews.length})</span></button>
                <button type="button" class="tab-btn \${activeRevTab === 'research' ? 'active' : ''}" role="tab" aria-selected="\${activeRevTab === 'research' ? 'true' : 'false'}" tabindex="\${activeRevTab === 'research' ? '0' : '-1'}" onclick="setOverviewReviewTab('research')">Research <span class="tabular muted">(\${recentResearches.length})</span></button>
              </div>
            </div>
            \${activeRevTab === 'research' ? researchPaneHtml : reviewsPaneHtml}
          </div>\`;
      }

      const artifactsCardHtml = recentArtifacts.length ? \`
        <div class="card">
          <details class="hud-details card-details" data-hud-key="ov-artifacts">
            <summary class="tabular">
              <span class="summary-label">Plans, Specs, Handoffs &amp; Artifacts</span>
              <span class="badge tabular">\${recentArtifacts.length}\${artGroups.length > 10 ? ' / ' + artGroups.length : ''}</span>
            </summary>
            <div class="mt-md">
              \${recentArtifacts.map((item) => \`
                <div class="artifact-row">
                  <div class="flex-1-min0">
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px;">
                      <span class="badge">\${esc(item.kind)}</span>
                      <strong style="overflow-wrap:anywhere;">\${esc(item.title)}</strong>
                    </div>
                    <div class="muted fs-12" title="\${esc(item.file)}"><code>\${esc(formatShortRelPath(item.file))}</code>\${item.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(item.updatedAt))}</span>\` : ''}</div>
                  </div>
                  <button type="button" class="action-btn" data-file="\${esc(item.file)}" data-title="\${esc(item.title)}" data-kind="\${esc(item.kind)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, this.dataset.kind)">Open</button>
                </div>\`).join('')}
            </div>
          </details>
        </div>\` : '';

      const perfList = (data.benchmarks?.performanceGoals || []).filter(matchesScope);
      const autoList = (data.benchmarks?.autoresearch || []).filter(matchesScope);
      let benchHtml = '';
      if (perfList.length || autoList.length) {
        const perfRows = perfList.map((p) => {
          const cps = Array.isArray(p.checkpoints) ? p.checkpoints : [];
          const fmtVal = (v) => (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');
          const deltaBadge = (p.baseline !== null && p.baseline !== undefined) || (p.lastValidation !== null && p.lastValidation !== undefined)
            ? \`<span class="badge tabular">\${esc(fmtVal(p.baseline ?? 'n/a'))} &rarr; \${esc(fmtVal(p.lastValidation ?? 'pending'))}</span>\`
            : '';
          const cpDetails = cps.length ? \`
            <details class="hud-details" data-hud-key="perf-\${esc(p.slug)}">
              <summary class="tabular">Checkpoints (\${cps.length})</summary>
              \${cps.map((cp) => \`
                <div class="health-item fs-12">
                  <div class="row-between-sm">
                    <span class="badge">\${esc(cp.status)}</span>
                    <span class="muted tabular">\${esc(cp.at)}</span>
                  </div>
                  \${cp.patch ? \`<div class="mt-xxs">Patch: <code>\${esc(cp.patch)}</code></div>\` : ''}
                  \${cp.evidence ? \`<div class="muted mt-xxs">Evidence: \${esc(cp.evidence)}</div>\` : ''}
                </div>\`).join('')}
            </details>\` : '';
          return \`
            <div class="health-item">
              <div class="row-between-sm">
                <div class="flex-1-min0"><span class="badge \${p.status === 'active' ? 'badge-active' : ''}">Perf: \${esc(p.slug)}</span>\${p.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(p.evalIntegrityVerdict)}</span>\` : ''} \${deltaBadge} <span class="muted tabular">\${esc(p.objective)} (Checkpoints: \${cps.length})</span></div>
                \${p.summaryPath ? \`<button type="button" class="action-btn" data-file="\${esc(p.summaryPath)}" data-slug="\${esc(p.slug)}" onclick="openMarkdownDrawer(this.dataset.file, 'Perf Summary: ' + this.dataset.slug, 'performance')">Open Summary</button>\` : ''}
              </div>
              \${cpDetails}
            </div>\`;
        }).join('');
        const autoRows = autoList.map((a) => \`
          <div class="health-item row-between-sm">
            <div><span class="badge \${a.passed ? 'badge-active' : ''}">Autoresearch: \${esc(a.slug)}</span> <span class="badge">\${esc(a.status)}</span>\${a.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(a.evalIntegrityVerdict)}</span>\` : ''} <span class="muted tabular">(V:\${a.claims?.verified || 0} D:\${a.claims?.derived || 0} A:\${a.claims?.assumed || 0})</span></div>
            \${a.reportFile ? \`<button type="button" class="action-btn" data-file="\${esc(a.reportFile)}" data-slug="\${esc(a.slug)}" onclick="openMarkdownDrawer(this.dataset.file, 'Autoresearch: ' + this.dataset.slug, 'autoresearch')">Open Report</button>\` : ''}
          </div>\`).join('');
        benchHtml = \`
          <div class="card">
            <div class="fw-600 mb-sm">Benchmarks &amp; Autoresearch</div>
            \${perfRows}
            \${autoRows}
          </div>\`;
      }

      const vrList = (data.visualRalph || []).filter(matchesScope);
      const loftList = (data.loft || []).filter(matchesScope);
      let vrLoftHtml = '';
      if (vrList.length || loftList.length) {
        const vrRows = vrList.map((v) => \`
          <div class="health-item row-between-sm">
            <div><span class="badge badge-active">Visual Ralph: \${esc(v.slug)}</span>\${v.verdict ? \` <span class="badge tabular">\${esc(v.verdict.verdict)} (\${esc(v.verdict.score)})</span>\` : ''} <span class="muted tabular">(\${(v.images || []).length} image(s))</span></div>
            <button type="button" class="action-btn action-btn-primary" data-slug="\${esc(v.slug)}" data-scope="\${esc(v.scope || '.')}" onclick="openVisualRalphDrawer(this.dataset.slug, this.dataset.scope)">Compare</button>
          </div>\`).join('');
        const loftRows = loftList.map((l) => \`
          <div class="health-item row-between-sm">
            <div>
              <span class="badge">Loft (\${esc(l.kind)})</span>
              <strong>\${esc(l.title)}</strong>
              \${(l.variants || []).length ? \`<span class="badge tabular">\${l.variants.length} variant(s)</span>\` : ''}
              <div class="muted fs-12"><code>\${esc(l.relPath)}</code></div>
            </div>
            <button type="button" class="action-btn action-btn-primary" data-slug="\${esc(l.slug)}" data-scope="\${esc(l.scope || '.')}" onclick="openLoftDrawer(this.dataset.slug, this.dataset.scope)">Open Sandbox</button>
          </div>\`).join('');
        vrLoftHtml = \`
          <div class="card">
            <div class="fw-600 mb-sm">Visual Ralph &amp; Loft Prototypes</div>
            \${vrRows}
            \${loftRows}
          </div>\`;
      }

      const ch = data.codeHealth || { reused: [], created: [], reusedCount: 0, newCount: 0, reusePct: null, openCallers: [], debtTotal: 0, noTriggerCount: 0, debtItems: [], verificationFreshness: 'none', lastVerifyCmd: '', lastEditedTarget: '' };
      const vfStatus = String(ch.verificationFreshness || 'none');
      const vfBadgeCls = vfStatus === 'pass' ? 'badge badge-live' : (vfStatus === 'fail' ? 'badge badge-danger' : 'badge');
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
            \${oc.snippet ? \`<div class="muted fs-12 mt-xs"><code>\${esc(oc.snippet)}</code></div>\` : ''}
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
            <div class="fs-12"><span class="muted">Known limit:</span> \${esc(it.ceiling)}</div>
            <div class="fs-12 mt-xxs"><span class="muted">Upgrade when:</span> \${it.upgrade ? esc(it.upgrade) : '<span class="muted">Not specified (add comma + upgrade condition)</span>'}</div>
          </div>\`).join('')}\` : '<div class="muted fs-12 mt-xs">No <code>shortcut:</code> or <code>ceiling:</code> comments recorded in workspace.</div>';

      const codeHealthHtml = \`
        <div class="card">
          <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div>
              <div class="fw-600">Code Health &amp; Technical Debt</div>
              <div class="muted fs-12 mt-xxs">Uncommitted git diff symbol reuse, orphaned call sites, floor-guard anti-tampering, verification freshness, and documented code shortcuts</div>
            </div>
            <div class="row-wrap-sm">
              \${fg.total > 0 ? \`<button type="button" class="action-btn" onclick="runQuickCommand(this, '/doctor', 'active-chat')" title="Inspect and resolve floor-guard findings">Fix with /doctor</button>\` : ''}
              <span class="\${vfBadgeCls}" title="\${esc(vfDetail)}">Verification: \${esc(vfStatus.toUpperCase())}</span>
            </div>
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

      const cpData = data.checkpoints || {};
      const cpItems = Array.isArray(cpData.items) ? cpData.items : [];
      const cpOpen = Boolean(persistedDetailsState['ov-checkpoints']);
      const checkpointsHtml = \`
        <details class="hud-details card-details" data-hud-key="ov-checkpoints" \${cpOpen ? 'open' : ''}>
          <summary class="tabular">
            <span class="summary-label">Shadow Checkpoints</span>
            <span class="badge tabular">\${Number(cpData.count || 0)}</span>
          </summary>
          <div class="mt-sm">
            \${cpItems.length ? cpItems.map((cp) => \`
              <div class="health-item fs-12">
                <div class="row-wrap-sm">
                  <code>\${esc(String(cp.id || cp.commitSha || '').slice(0, 12))}</code>
                  \${cp.commitSha ? \`<span class="badge tabular">\${esc(String(cp.commitSha).slice(0, 7))}</span>\` : ''}
                  \${cp.createdAt ? \`<span class="muted tabular">\${esc(formatShortTime(cp.createdAt))}</span>\` : ''}
                </div>
                <div class="muted mt-xxs">\${esc(cp.label || 'snapshot')}</div>
              </div>\`).join('') : '<div class="muted fs-12">No shadow checkpoints recorded in workspace.</div>'}
          </div>
        </details>\`;

      const ds = data.designSystem;
      let designSystemHtml = '';
      if (ds && ds.exists) {
        const dsChecks = Array.isArray(ds.contrastChecks) ? ds.contrastChecks : [];
        const dsErrors = Array.isArray(ds.errors) ? ds.errors : [];
        const dsWarnings = Array.isArray(ds.warnings) ? ds.warnings : [];
        const dsBadgeCls = ds.ok ? 'badge badge-live' : 'badge badge-danger';
        designSystemHtml = \`
          <div class="card">
            <div class="row-between-top mb-sm">
              <div>
                <div class="fw-600">Design System Governance (<code>\${esc(ds.file || 'DESIGN.md')}</code>)</div>
                <div class="muted fs-12 mt-xxs tabular">\${(ds.sectionsFound || []).length}/8 sections &middot; \${Number(ds.tokenCount || 0)} token(s) &middot; \${(ds.categoriesFound || []).length} categories</div>
              </div>
              <span class="\${dsBadgeCls}">\${ds.ok ? 'PASS' : 'FAIL'}</span>
            </div>
            \${(ds.categoriesFound || []).length ? \`<div class="row-wrap-sm mb-sm">\${ds.categoriesFound.map((cat) => \`<span class="badge">\${esc(cat)}</span>\`).join('')}</div>\` : ''}
            \${dsChecks.length ? \`
              <div class="health-section-title">WCAG Contrast Checks</div>
              \${dsChecks.map((cc) => \`
                <div class="health-item fs-12">
                  <div class="row-between-top">
                    <span><code>\${esc(cc.pair)}</code> <span class="muted">(\${esc(cc.fg)} / \${esc(cc.bg)})</span></span>
                    <span class="badge \${cc.pass ? 'badge-live' : 'badge-danger'} tabular">\${Number(cc.ratio || 0).toFixed(2)}:1 (min \${Number(cc.minRequired || 4.5)}:1) \${cc.pass ? 'PASS' : 'FAIL'}</span>
                  </div>
                </div>\`).join('')}\` : '<div class="muted fs-12">No automatic foreground/background contrast pairs detected.</div>'}
            \${dsErrors.length ? \`<ul class="ul-compact mt-sm">\${dsErrors.map((e) => \`<li>\${esc(e)}</li>\`).join('')}</ul>\` : ''}
            \${dsWarnings.length ? \`<div class="muted fs-12 mt-xs">\${dsWarnings.map((w) => esc(w)).join(' &middot; ')}</div>\` : ''}
          </div>\`;
      }

      const fx = data.forensics || {};
      const notif = data.notifications || {};
      const notifChannels = [
        ['slack', 'Slack'],
        ['discord', 'Discord'],
        ['telegram', 'Telegram'],
        ['webhook', 'Webhook'],
        ['command', 'Command'],
      ];
      const fxClusters = Array.isArray(fx.topFailureClusters) ? fx.topFailureClusters : [];
      const forensicsNotifHtml = \`
        <div class="card">
          <div class="row-between-top mb-sm">
            <div>
              <div class="fw-600">Session Forensics &amp; Notification Channels</div>
              <div class="muted fs-12 mt-xxs">Transcript compaction/failure health and boolean channel readiness (no secrets surfaced)</div>
            </div>
            <span class="badge \${fx.available ? 'badge-active' : ''}">\${fx.available ? 'TRANSCRIPT SCANNED' : 'NO TRANSCRIPT'}</span>
          </div>
          <div class="health-grid mb-sm">
            <div class="health-stat">
              <div class="health-stat-label">Steps Scanned</div>
              <div class="health-stat-val tabular">\${Number(fx.totalSteps || 0)}</div>
              <div class="health-stat-sub tabular">\${Number(fx.filesScanned || 0)} file(s)</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Compactions</div>
              <div class="health-stat-val tabular">\${Number(fx.compactions || 0)}</div>
              <div class="health-stat-sub">context resets</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Orphan Tool Calls</div>
              <div class="health-stat-val tabular">\${Number(fx.orphanToolCalls || 0)}</div>
              <div class="health-stat-sub">unmatched calls</div>
            </div>
            <div class="health-stat">
              <div class="health-stat-label">Failed Tool Calls</div>
              <div class="health-stat-val tabular">\${Number(fx.failedToolCalls || 0)}</div>
              <div class="health-stat-sub">error responses</div>
            </div>
          </div>
          \${fxClusters.length ? \`
            <div class="health-section-title">Top Failure Clusters</div>
            \${fxClusters.map((c) => \`
              <div class="health-item fs-12">
                <div class="row-wrap-sm"><code>\${esc(c.tool)}</code><span class="badge tabular">\${Number(c.count || 0)}x</span></div>
                <div class="muted mt-xxs">\${esc(c.signature)}</div>
              </div>\`).join('')}\` : ''}
          <div class="row-wrap-sm mt-sm">
            <span class="muted fs-12">Notifications:</span>
            \${notifChannels.map(([key, label]) => \`<span class="badge \${notif[key] ? 'badge-live' : ''}">\${label}: \${notif[key] ? 'ON' : 'OFF'}</span>\`).join('')}
          </div>
        </div>\`;

      const doc = data.doctor || {};
      const se = doc.skillEval;
      const seLabel = se && se.ok ? \`PASS (\${esc(se.rank1Pct)}%)\` : 'FAIL';
      const needsDoctorFix = Boolean((doc.staleModes || []).length || !doc.qualityGatesOk || (se && !se.ok));
      const errRows = (doc.hookErrors || []).map((e) => \`
        <tr>
          <td class="col-event">
            <div><code>\${esc(e.event)}</code></div>
            <div class="muted fs-12">\${esc(e.at)}</div>
          </td>
          <td class="col-main muted">\${esc(e.error)}</td>
        </tr>\`).join('');
      const doctorHtml = \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            <div class="fw-600">Diagnostics &amp; Runtime Health</div>
            <div class="row-wrap-sm">
              \${needsDoctorFix ? \`<button type="button" class="action-btn" onclick="runQuickCommand(this, '/doctor', 'active-chat')" title="Run full diagnostics in active chat">Run /doctor</button>\` : ''}
              <span class="badge \${se ? (se.ok ? 'badge-live' : 'badge-danger') : ''}">Skill Eval: \${seLabel}</span>
              <span class="badge \${doc.qualityGatesOk ? 'badge-live' : 'badge-danger'}">Quality Gates: \${doc.qualityGatesOk ? 'OK' : 'INVALID'}</span>
              <span class="badge">Stale Modes: \${(doc.staleModes || []).length ? esc(doc.staleModes.join(', ')) : 'none'}</span>
            </div>
          </div>
          \${(doc.qualityGateErrors || []).length ? \`<ul style="margin:0 0 8px 0;padding-left:18px;">\${doc.qualityGateErrors.map((e) => \`<li>\${esc(e)}</li>\`).join('')}</ul>\` : ''}
          \${qgRows ? \`<div class="mb-md"><div class="muted fs-12 mb-xs">Configured Quality Gates:</div><ul class="ul-compact">\${qgRows}</ul></div>\` : ''}
          <div class="mb-md">
            <span class="muted">Latest PreInvocation Routing:</span>
            \${doc.latestRouting ? \` Conversation <code>\${esc(doc.latestRouting.conversationId)}</code> &middot; Skills: <code>\${esc((doc.latestRouting.skills || []).join(', ') || 'none')}</code>\` : ' <span class="muted">No .routing.json found yet.</span>'}
          </div>
          <div>
            <div class="muted mb-xs">Recent Hook Errors (.omagy/logs/hook-errors.jsonl):</div>
            \${errRows ? \`<div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-event">Event</th><th class="col-main">Error</th></tr></thead><tbody>\${errRows}</tbody></table></div>\` : '<div class="muted">Zero hook errors recorded.</div>'}
          </div>
        </div>\`;

      const counts = {
        skills: data.catalog?.skills?.length || 0,
        subagents: data.catalog?.subagents?.length || 0,
        workflows: data.catalog?.workflows?.length || 0,
      };

      const trackedScopesHtml = scopes.length > 1
        ? \`
          <div style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;" role="group" aria-label="Scope filter">
            <span class="muted fs-12">Scopes:</span>
            <button type="button" class="badge scope-chip \${activeScopeFilter === 'all' ? 'is-active' : ''}" data-scope="all" onclick="setScopeFilter(this.dataset.scope)">All</button>
            \${scopes.map((sc) => \`<button type="button" class="badge scope-chip \${activeScopeFilter === sc.scope ? 'is-active' : ''}" data-scope="\${esc(sc.scope)}" onclick="setScopeFilter(this.dataset.scope)" title="\${esc(sc.scope && sc.scope !== '.' ? sc.scope : data.workspace)}">\${esc(formatScopeLabel(sc.scope))}</button>\`).join('')}
          </div>\`
        : \`
          <div style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;">
            <span class="muted fs-12">Scope:</span>
            \${scopes.map((sc) => \`<span class="badge \${sc.scope && sc.scope !== '.' ? 'badge-active' : ''}" title="\${esc(sc.scope && sc.scope !== '.' ? sc.scope : data.workspace)}">\${esc(formatScopeLabel(sc.scope))}</span>\`).join('')}
          </div>\`;

      document.getElementById('view-overview').innerHTML = \`
        <div class="card">
          <div class="row-between-top">
            <div style="min-width:0;flex:1 1 180px;">
              <div style="font-weight:600;margin-bottom:5px;">Workspace</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-width:0;">
                <code class="ws-folder-pill" title="\${esc(data.workspace)}">\${esc(formatWorkspaceName(data.workspace))}</code>
                \${trackedScopesHtml}
              </div>
            </div>
            <div class="row-wrap-sm">
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('workflows')">\${counts.workflows} Workflows</button>
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('skills')">\${counts.skills} Skills</button>
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('subagents')">\${counts.subagents} Subagents</button>
            </div>
          </div>
          \${quickActionsHtml}
        </div>
        <div class="card">
          <div style="font-weight:600;margin-bottom:8px;">Current Workflow Mode</div>
          \${currentModeBodyHtml}
        </div>
        \${ugHtml}
        \${ivHtml}
        \${teamHtml}
        \${revResHtml}
        \${artifactsCardHtml}
        \${benchHtml}
        \${vrLoftHtml}
        \${codeHealthHtml}
        \${checkpointsHtml}
        \${designSystemHtml}
        \${forensicsNotifHtml}
        \${doctorHtml}
      \`;
      syncSlidingTabPill(document.querySelector('[data-sliding-tabs="ov-rev"]'));
    }

    function renderWorkflows(data) {
      const list = data.catalog?.workflows || [];
      document.getElementById('view-workflows').innerHTML = list.map((wf) => {
        const stages = wf.stages || [];
        const stageInfo = resolveWorkflowStageState(stages, wf.currentPhase || '', Boolean(wf.active));
        const stagesHtml = stages.map((s, idx) => {
          const parsed = parseWorkflowStageLabel(s);
          const st = stageInfo.states[idx] || 'idle';
          const numLabel = st === 'done' ? '&#10003;' : String(idx + 1);
          const stepEl = \`
            <div class="wf-step wf-step-\${st}" role="listitem">
              <span class="wf-step-num">\${numLabel}</span>
              <span class="wf-step-body">
                <span class="wf-step-title">\${esc(parsed.title)}</span>
                \${parsed.sub ? \`<span class="wf-step-sub">(\${esc(parsed.sub)})</span>\` : ''}
              </span>
            </div>\`;
          if (idx >= stages.length - 1) return stepEl;
          const arrowSt = stageInfo.arrowStates[idx] || 'idle';
          const arrowEl = \`
            <span class="wf-arrow wf-arrow-\${arrowSt}" aria-hidden="true" style="--wf-step-i:\${idx};">
              <svg class="wf-arrow-svg" width="38" height="18" viewBox="0 0 38 18" fill="none">
                <line class="wf-arrow-track" x1="2" y1="9" x2="30" y2="9" />
                <line class="wf-arrow-stream" x1="2" y1="9" x2="30" y2="9" />
                <circle class="wf-arrow-pulse" cx="4" cy="9" r="2.2" />
                <path class="wf-arrow-head" d="M26 4.75L31.25 9L26 13.25" />
              </svg>
            </span>\`;
          return stepEl + arrowEl;
        }).join('');
        const inputKey = 'wf:' + wf.id;
        const inputId = 'input-wf-' + wf.id;
        const val = getPromptValue(inputKey, wf.quickStart);
        return \`
          <div class="card wf-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
              <div class="fw-600">\${esc(wf.title)}</div>
              \${wf.active ? \`<span class="badge badge-active">ACTIVE (\${esc(wf.currentPhase)})</span>\` : \`<span class="badge">\${esc(wf.modeKey)}</span>\`}
            </div>
            <div class="wf-pipeline" data-wf-pipeline="\${esc(wf.id)}" tabindex="0" role="list" aria-label="Workflow steps for \${esc(wf.title)}">\${stagesHtml}</div>
            <div class="mb-sm"><strong>When to use:</strong> <span class="muted">\${esc(wf.whenToUse)}</span></div>
            <div class="muted fs-12"><strong>State / Artifacts:</strong> <code>\${esc(wf.artifacts)}</code></div>
            <div class="cmd-box">
              <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" />
              <div class="cmd-actions">
                <button type="button" class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'active-chat')" title="Send into the active chat conversation (or start a new chat if none is active)">Run in Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'new-chat')" title="Start a new chat conversation with this command">New Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="copyFromInput(this, this.dataset.inputId)" title="Copy command to clipboard">Copy</button>
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
      const countEl = document.getElementById('skills-match-count');
      if (countEl) {
        const isFiltered = Boolean(q) || skillCategory !== 'All';
        countEl.textContent = isFiltered
          ? (filtered.length + ' / ' + allSkills.length)
          : (allSkills.length + ' skills');
      }
      const container = document.getElementById('skills-cards-container');
      const animateSwap = pendingSkillFilterAnim && !prefersReducedMotion();
      pendingSkillFilterAnim = false;
      if (!container) return;
      if (animateSwap) {
        container.classList.remove('filter-swap');
        void container.offsetWidth;
        container.classList.add('filter-swap');
      }
      if (!filtered.length) {
        container.innerHTML = '<div class="card muted">No skills match the current filter.</div>';
        return;
      }
      container.innerHTML = filtered.map((s) => {
        const activeFlags = new Set(selectedSkillFlags[s.name] || []);
        const flagsHtml = (s.flags || []).map((f) => {
          const pressed = activeFlags.has(f);
          return \`<button type="button" class="chip-btn \${pressed ? 'chip-active' : ''}" aria-pressed="\${pressed ? 'true' : 'false'}" data-skill="\${esc(s.name)}" data-flag="\${esc(f)}" onclick="toggleSkillFlag(this.dataset.skill, this.dataset.flag)" title="Toggle flag on command"><code>\${highlightMatch(f, skillSearch)}</code></button>\`;
        }).join(' ');
        const inputKey = 'skill:' + s.name;
        const inputId = 'input-skill-' + s.name;
        const val = getPromptValue(inputKey, s.quickStart);
        return \`
          <div class="card">
            <div class="row-between mb-xs">
              <div>
                <code class="fw-600 fs-13">/\${highlightMatch(s.name, skillSearch)}</code>
                <span class="muted" style="font-size:12px;margin-left:4px;">($\${highlightMatch(s.name, skillSearch)})</span>
              </div>
              <span class="badge">\${highlightMatch(s.category, skillSearch)}</span>
            </div>
            \${flagsHtml ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;" role="group" aria-label="Skill flags for \${esc(s.name)}">\${flagsHtml}</div>\` : ''}
            <div class="mb-xs">\${highlightMatch(s.howToUse, skillSearch)}</div>
            <div class="cmd-box">
              <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" />
              <div class="cmd-actions">
                <button type="button" class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'active-chat')" title="Send into the active chat conversation (or start a new chat if none is active)">Run in Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'new-chat')" title="Start a new chat conversation with this skill command">New Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="copyFromInput(this, this.dataset.inputId)" title="Copy command to clipboard">Copy</button>
                <button type="button" class="action-btn" data-skill="\${esc(s.dir || s.name)}" data-skill-name="\${esc(s.name)}" onclick="openSkillMarkdownDrawer(this.dataset.skill, '', this.dataset.skillName)" title="Preview \${esc(s.file || ('skills/' + s.name + '/SKILL.md'))}">Preview</button>
              </div>
            </div>
          </div>\`;
      }).join('');
    }

    function renderSkills(data) {
      const allSkills = data.catalog?.skills || [];
      const categories = ['All', ...new Set(allSkills.map((s) => s.category))];
      const catBtns = categories.map((c) => \`
        <button type="button" class="tab-btn \${skillCategory === c ? 'active' : ''}" role="tab" aria-selected="\${skillCategory === c ? 'true' : 'false'}" tabindex="\${skillCategory === c ? '0' : '-1'}" data-skill-cat="\${esc(c)}" onclick="setSkillCategory(this.dataset.skillCat)">\${esc(c)}</button>\`).join('');
      document.getElementById('view-skills').innerHTML = \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <span class="fw-600">Skills Catalog</span>
            <span id="skills-match-count" class="badge tabular" aria-live="polite">\${allSkills.length} skills</span>
          </div>
          <input type="text" id="skill-search-input" class="search-input" placeholder="Press / to search skills by name, flag, or use case (e.g. deep-research, skill, hud)&hellip;" value="\${esc(skillSearch)}" oninput="onSkillSearchInput(this.value)" />
          <div class="tab-bar mb-0" data-sliding-tabs="skill-cat" role="tablist" aria-label="Skill categories">\${catBtns}</div>
        </div>
        <div id="skills-cards-container"></div>
      \`;
      renderSkillsListOnly(data);
      syncSlidingTabPill(document.querySelector('[data-sliding-tabs="skill-cat"]'));
    }

    function renderSubagentsListOnly(data) {
      const allSubagents = data.catalog?.subagents || [];
      const q = subagentSearch.trim().toLowerCase();
      const filtered = allSubagents.filter((a) => {
        if (subagentLane !== 'All' && a.lane !== subagentLane) return false;
        if (!q) return true;
        return a.name.toLowerCase().includes(q)
          || a.lane.toLowerCase().includes(q)
          || a.whenToUse.toLowerCase().includes(q);
      });
      const countEl = document.getElementById('subagents-match-count');
      if (countEl) {
        const isFiltered = Boolean(q) || subagentLane !== 'All';
        countEl.textContent = isFiltered
          ? (filtered.length + ' / ' + allSubagents.length)
          : (allSubagents.length + ' specialists');
      }
      const container = document.getElementById('subagents-cards-container');
      const animateSwap = pendingSubagentFilterAnim && !prefersReducedMotion();
      pendingSubagentFilterAnim = false;
      if (!container) return;
      if (animateSwap) {
        container.classList.remove('filter-swap');
        void container.offsetWidth;
        container.classList.add('filter-swap');
      }
      if (!filtered.length) {
        container.innerHTML = '<div class="card muted">No subagents match the current filter.</div>';
        return;
      }
      container.innerHTML = filtered.map((a) => {
        const inputKey = 'sa:' + a.name;
        const inputId = 'input-sa-' + a.name;
        const val = getPromptValue(inputKey, a.defaultPrompt || '');
        const defaultTier = a.cliModel || 'inherit';
        const activeTier = selectedSubagentModels[a.name] || defaultTier;
        const modelPills = MODEL_TIERS.map((tier) => \`
          <button type="button" class="chip-btn \${activeTier === tier ? 'chip-active' : ''}" aria-pressed="\${activeTier === tier ? 'true' : 'false'}" data-agent="\${esc(a.name)}" data-tier="\${tier}" onclick="setSubagentModel(this.dataset.agent, this.dataset.tier)"><code>\${tier}</code></button>\`).join('');
        const snippet = buildSubagentInvokeSnippet(a.name, activeTier, val);
        return \`
        <div class="card">
          <div class="row-between mb-xs">
            <code class="fw-600 fs-13">\${highlightMatch(a.name, subagentSearch)}</code>
            <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
              <span class="badge">\${highlightMatch(a.lane, subagentSearch)}</span>
              <span class="badge">Model: \${esc(activeTier)}</span>
            </div>
          </div>
          <div class="mb-sm">\${highlightMatch(a.whenToUse, subagentSearch)}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:4px;" role="group" aria-label="Model tier for \${esc(a.name)}">
            <span class="muted fs-12">Model:</span>\${modelPills}
          </div>
          <div class="cmd-box">
            <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" placeholder="Task for \${esc(a.name)}&hellip;" />
            <div class="snippet-preview"><code id="sa-snippet-\${esc(a.name)}" data-default-tier="\${esc(defaultTier)}">\${esc(snippet)}</code></div>
            <div class="cmd-actions">
              <button type="button" class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" data-agent="\${esc(a.name)}" data-model="\${esc(activeTier)}" onclick="invokeSubagentFromInput(this, this.dataset.inputId, this.dataset.agent, this.dataset.model, 'subagent-active')" title="Send into the active chat so the leader agent calls invoke_subagent">Dispatch into Active Chat</button>
              <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" data-agent="\${esc(a.name)}" data-model="\${esc(activeTier)}" onclick="invokeSubagentFromInput(this, this.dataset.inputId, this.dataset.agent, this.dataset.model, 'subagent-standalone')" title="Open a standalone specialist chat with --profile=\${esc(a.name)}">Launch Standalone Chat</button>
              <button type="button" class="action-btn" data-agent="\${esc(a.name)}" onclick="copySubagentSnippet(this, this.dataset.agent)" title="Copy invoke_subagent call snippet">Copy Snippet</button>
            </div>
          </div>
        </div>\`;
      }).join('');
    }

    function renderSubagents(data) {
      const allSubagents = data.catalog?.subagents || [];
      const lanes = ['All', ...new Set(allSubagents.map((a) => a.lane))];
      const laneBtns = lanes.map((l) => \`
        <button type="button" class="tab-btn \${subagentLane === l ? 'active' : ''}" role="tab" aria-selected="\${subagentLane === l ? 'true' : 'false'}" tabindex="\${subagentLane === l ? '0' : '-1'}" data-sa-lane="\${esc(l)}" onclick="setSubagentLane(this.dataset.saLane)">\${esc(l)}</button>\`).join('');
      document.getElementById('view-subagents').innerHTML = \`
        <div class="card">
          <div class="row-between mb-xs">
            <span class="fw-600">Role Subagents</span>
            <span id="subagents-match-count" class="badge tabular" aria-live="polite">\${allSubagents.length} specialists</span>
          </div>
          <div class="muted mb-md">Work-shape model routing: <code>flash_lite</code> / <code>flash</code> for quick mechanical lookups, <code>inherit</code> for cohesive implementation, and <code>pro</code> for architecture, critique, causal tracing, and security review.</div>
          <input type="text" id="subagent-search-input" class="search-input" placeholder="Press / to search subagents by role, lane, or capability&hellip;" value="\${esc(subagentSearch)}" oninput="onSubagentSearchInput(this.value)" />
          <div class="tab-bar mb-0" data-sliding-tabs="sa-lane" role="tablist" aria-label="Subagent lanes">\${laneBtns}</div>
        </div>
        <div id="subagents-cards-container"></div>
      \`;
      renderSubagentsListOnly(data);
      syncSlidingTabPill(document.querySelector('[data-sliding-tabs="sa-lane"]'));
    }

    function renderWikiContentOnly(data) {
      const animateWikiDoc = pendingWikiDocTransition && !prefersReducedMotion();
      pendingWikiDocTransition = false;
      const entries = data.wiki?.entries || [];
      const categories = ['All', ...new Set(entries.map((e) => e.category).filter(Boolean))];
      const catCounts = {};
      for (const e of entries) {
        if (e.category) catCounts[e.category] = (catCounts[e.category] || 0) + 1;
      }
      const catBtns = categories.map((c) => {
        const count = c === 'All' ? entries.length : (catCounts[c] || 0);
        const dot = c === 'All'
          ? ''
          : \`<span class="wiki-cat-dot" data-cat="\${esc(c)}" aria-hidden="true"></span>\`;
        return \`
          <button type="button" class="chip-btn \${wikiCategory === c ? 'chip-active' : ''}" aria-pressed="\${wikiCategory === c ? 'true' : 'false'}" data-wiki-cat="\${esc(c)}" onclick="setWikiCategory(this.dataset.wikiCat)">\${dot}\${esc(c)} <span class="tabular muted">(\${count})</span></button>\`;
      }).join('');
      const catBarEl = document.getElementById('wiki-category-bar');
      if (catBarEl) {
        catBarEl.innerHTML = catBtns;
        catBarEl.style.display = catBtns ? 'flex' : 'none';
      }
      const filteredEntries = entries.filter((e) => wikiCategory === 'All' || e.category === wikiCategory);
      const activeEntry = filteredEntries.find((e) => e.slug === selectedWikiSlug)
        || (wikiCategory === 'All' ? entries.find((e) => e.slug === selectedWikiSlug) : null)
        || filteredEntries[0]
        || null;
      if (!selectedWikiSlug && activeEntry) {
        selectedWikiSlug = activeEntry.slug;
      }
      const wrapEl = document.getElementById('wiki-mindmap-wrap');
      if (wrapEl) {
        wrapEl.hidden = wikiViewMode !== '3d';
      }
      syncMindMapOrbitButton();
      syncWikiMindMapData(entries, activeEntry ? activeEntry.slug : '');
      if (activeView === 'wiki' && wikiViewMode === '3d') {
        startWikiMindMapLoop();
      }
      const edgeCount = mmState.graph.edges.length;
      const headerEl = document.getElementById('wiki-explorer-header');
      if (headerEl) {
        headerEl.innerHTML = \`
          <div class="row-gap-md">
            <span class="fw-600">Wiki Explorer</span>
            <span class="muted tabular" style="font-weight:400;font-size:12px;">(\${filteredEntries.length} page\${filteredEntries.length === 1 ? '' : 's'} &middot; \${edgeCount} link\${edgeCount === 1 ? '' : 's'})</span>
          </div>
          <div class="row-gap-md">
            <div class="wiki-mode-switch" data-sliding-tabs="wiki-mode" role="tablist" aria-label="Wiki Explorer display mode">
              <button type="button" role="tab" class="wiki-mode-btn \${wikiViewMode === '3d' ? 'active' : ''}" aria-selected="\${wikiViewMode === '3d' ? 'true' : 'false'}" tabindex="\${wikiViewMode === '3d' ? '0' : '-1'}" data-wiki-mode="3d" onclick="setWikiViewMode(this.dataset.wikiMode)">3D Map</button>
              <button type="button" role="tab" class="wiki-mode-btn \${wikiViewMode === 'list' ? 'active' : ''}" aria-selected="\${wikiViewMode === 'list' ? 'true' : 'false'}" tabindex="\${wikiViewMode === 'list' ? '0' : '-1'}" data-wiki-mode="list" onclick="setWikiViewMode(this.dataset.wikiMode)">List</button>
            </div>
            \${activeEntry ? \`<code class="wiki-path-pill \${animateWikiDoc ? 'wiki-path-flash' : ''}">omagy_wiki/\${esc(activeEntry.slug)}.md</code>\` : ''}
          </div>
        \`;
        syncSlidingTabPill(headerEl.querySelector('[data-sliding-tabs="wiki-mode"]'));
      }
      const resultsEl = document.getElementById('wiki-explorer-results');
      if (!resultsEl) return;
      let listSelectorHtml = '';
      if (wikiViewMode === 'list') {
        if (filteredEntries.length) {
          const listRows = filteredEntries.map((e) => {
            const isSel = Boolean(activeEntry && activeEntry.slug === e.slug);
            const dot = e.category
              ? \`<span class="wiki-cat-dot" data-cat="\${esc(e.category)}" aria-hidden="true"></span>\`
              : '';
            const deg = mmState.nodeBySlug.get(e.slug)?.degree || 0;
            return \`
              <button type="button" role="option" aria-selected="\${isSel ? 'true' : 'false'}" class="wiki-page-item \${isSel ? 'active' : ''}" data-wiki-slug="\${esc(e.slug)}" onclick="selectWikiSlug(this.dataset.wikiSlug)">
                <span class="wiki-page-item-main">
                  \${dot}
                  <code class="fw-600">\${esc(e.slug)}.md</code>
                  \${e.title && e.title !== e.slug ? \`<span class="wiki-page-item-title">\${esc(e.title)}</span>\` : ''}
                </span>
                <span class="wiki-page-item-meta">
                  <span class="muted tabular fs-12">\${deg} link\${deg === 1 ? '' : 's'}</span>
                  \${e.category ? \`<span class="badge">\${esc(e.category)}</span>\` : ''}
                </span>
              </button>\`;
          }).join('');
          listSelectorHtml = \`<div id="wiki-list-wrap" class="wiki-list-wrap"><div id="wiki-page-list" class="wiki-page-list" role="listbox" aria-label="Wiki pages">\${listRows}</div></div>\`;
        } else {
          listSelectorHtml = '<div class="muted" style="margin-bottom:10px;">No wiki pages in this group.</div>';
        }
      }
      const backlinksMap = buildBacklinksIndex(entries);
      const activeBacklinks = activeEntry ? (backlinksMap[activeEntry.slug] || []) : [];
      const activeToc = activeEntry ? extractMarkdownToc(activeEntry.body || '') : [];
      const tocBarHtml = activeToc.length > 1 ? \`
        <div class="wiki-toc-bar" role="navigation" aria-label="Document headings">
          \${activeToc.map((h) => \`<button type="button" class="wiki-toc-chip" data-toc-idx="\${h.index}" onclick="scrollToWikiHeading(this.dataset.tocIdx)">\${esc(h.level > 1 ? ('  '.repeat(h.level - 1) + h.text) : h.text)}</button>\`).join('')}
        </div>\` : '';
      const backlinksHtml = activeBacklinks.length ? \`
        <div class="wiki-backlinks">
          <div class="muted fs-12 mb-xs">Referenced by (\${activeBacklinks.length}):</div>
          <div class="row-wrap">\${activeBacklinks.map((src) => \`<button type="button" class="wiki-link-pill" data-wiki-slug="\${esc(src)}" onclick="navigateToWikiSlug(this.dataset.wikiSlug)">[[\${esc(src)}]]</button>\`).join('')}</div>
        </div>\` : '';
      resultsEl.innerHTML = \`
        \${listSelectorHtml}
        \${activeEntry ? \`
          <div id="wiki-doc-pane" class="\${animateWikiDoc ? 'md-reveal' : ''}" style="border-top:1px solid var(--hud-border);padding-top:10px;">
            <div class="row-between-sm">
              <div style="font-weight:600;font-size:14px;">\${esc(activeEntry.title)}</div>
              <span class="badge">\${esc(activeEntry.category)}</span>
            </div>
            \${activeEntry.tags?.length ? \`<div class="muted" style="margin:4px 0;font-size:12px;">Tags: \${activeEntry.tags.map((t) => \`<code>\${esc(t)}</code>\`).join(' ')}</div>\` : ''}
            \${tocBarHtml}
            <div class="wiki-markdown-body mt-md">\${renderSafeMarkdown(activeEntry.body || '')}</div>
            \${backlinksHtml}
          </div>\` : ''}
      \`;
    }

    function renderWiki(data) {
      const agList = data.wiki?.agreements || [];
      const agBoxes = agList.map((a, idx) => formatAgreementCard(a, idx)).join('');
      const lint = data.wiki?.lint || {};
      const lintIssues = [
        ...(lint.missingFrontmatter || []).map((s) => \`Missing frontmatter: <code>\${esc(s)}</code>\`),
        ...(lint.unknownCategories || []).map((s) => \`Unknown category: <code>\${esc(s)}</code>\`),
        ...(lint.danglingLinks || []).map((s) => \`Dangling link: <code>\${esc(s)}</code>\`),
        ...(lint.orphanPages || []).map((s) => \`Orphan page: <code>\${esc(s)}</code>\`),
        ...(lint.expiredPages || []).map((s) => \`Expired page: <code>\${esc(s)}</code>\`),
      ];
      const viewEl = document.getElementById('view-wiki');
      if (!document.getElementById('wiki-shell-mounted')) {
        viewEl.innerHTML = \`
          <div id="wiki-shell-mounted">
            <div class="card" id="wiki-agreements-card"></div>
            <div class="card" id="wiki-explorer-card">
              <div id="wiki-explorer-header" class="row-between mb-md"></div>
              <input type="search" id="wiki-query-box" class="search-input" placeholder="Full-text search across omagy_wiki/*.md&hellip;" value="\${esc(wikiQueryText)}" oninput="onWikiQueryInput(this.value)" />
              <div id="wiki-search-results"></div>
              <div id="wiki-category-bar" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;" role="group" aria-label="Wiki categories"></div>
              <div id="wiki-mindmap-wrap" class="wiki-mm-wrap">
                <div class="wiki-mm-toolbar">
                  <div id="wiki-mm-readout" class="wiki-mm-readout">Drag to orbit 3D mind-map &middot; Click any .md node to open</div>
                  <div class="wiki-mm-controls" role="group" aria-label="3D Mind-Map Controls">
                    <button type="button" id="wiki-mm-orbit-btn" class="wiki-mm-btn" aria-pressed="true" onclick="toggleWikiMindMapOrbit()" title="Toggle automatic 3D orbital rotation">Orbit: On</button>
                    <button type="button" class="wiki-mm-btn" data-zoom="-0.15" onclick="zoomWikiMindMap(this.dataset.zoom)" aria-label="Zoom out 3D mind-map" title="Zoom out">&minus;</button>
                    <button type="button" class="wiki-mm-btn" data-zoom="0.15" onclick="zoomWikiMindMap(this.dataset.zoom)" aria-label="Zoom in 3D mind-map" title="Zoom in">+</button>
                    <button type="button" class="wiki-mm-btn" onclick="resetWikiMindMap()" title="Reset camera orientation and zoom">Reset</button>
                  </div>
                </div>
                <div id="wiki-mindmap-stage" class="wiki-mm-stage">
                  <canvas id="wiki-mindmap-canvas" class="wiki-mm-canvas" role="img" aria-label="Interactive 3D mind-map of project wiki Markdown files and cross-links"></canvas>
                </div>
              </div>
              <div id="wiki-explorer-results"></div>
            </div>
            <div class="card" id="wiki-log-card"></div>
            <div class="card" id="wiki-lint-card"></div>
          </div>
        \`;
        initWikiMindMapCanvas();
      }
      const agOpen = Boolean(persistedDetailsState['wiki-agreements']);
      const agCard = document.getElementById('wiki-agreements-card');
      if (agCard) {
        agCard.innerHTML = \`
          <details class="hud-details card-details" data-hud-key="wiki-agreements" \${agOpen ? 'open' : ''}>
            <summary class="tabular">
              <span class="summary-label">Working Agreements</span>
              <span class="badge tabular">\${agList.length}</span>
            </summary>
            <div class="muted fs-12 mt-xs">Persistent repository guardrails from <code>omagy_wiki/agreements.md</code></div>
            \${agBoxes ? \`<div class="agreement-grid">\${agBoxes}</div>\` : '<div class="muted mt-sm">No working agreements recorded yet.</div>'}
          </details>
        \`;
      }
      const logList = Array.isArray(data.wikiLog) ? data.wikiLog : [];
      const logCard = document.getElementById('wiki-log-card');
      if (logCard) {
        if (!logList.length) {
          logCard.classList.add('hidden-pane');
        } else {
          logCard.classList.remove('hidden-pane');
          const logOpen = Boolean(persistedDetailsState['wiki-log']);
          logCard.innerHTML = \`
            <details class="hud-details card-details" data-hud-key="wiki-log" \${logOpen ? 'open' : ''}>
              <summary class="tabular">
                <span class="summary-label">Recent Wiki Activity</span>
                <span class="badge tabular">\${logList.length}</span>
              </summary>
              <div class="mt-sm">
                \${logList.map((entry) => \`
                  <div class="health-item fs-12">
                    <div class="row-wrap-sm">
                      \${entry.date ? \`<span class="badge tabular">\${esc(entry.date)}</span>\` : ''}
                      \${entry.slug ? \`<button type="button" class="wiki-link-pill" data-wiki-slug="\${esc(entry.slug)}" onclick="navigateToWikiSlug(this.dataset.wikiSlug)">[[\${esc(entry.slug)}]]</button>\` : ''}
                    </div>
                    <div class="muted mt-xxs">\${esc(entry.summary)}</div>
                  </div>\`).join('')}
              </div>
            </details>\`;
        }
      }
      const lintCard = document.getElementById('wiki-lint-card');
      if (lintCard) {
        lintCard.innerHTML = \`
          <div class="row-between-top mb-sm">
            <div class="fw-600">Read-Only Wiki Lint</div>
            \${lintIssues.length ? \`<button type="button" class="action-btn" onclick="runQuickCommand(this, '/wiki lint', 'active-chat')" title="Run wiki lint repair in active chat">Run /wiki lint</button>\` : ''}
          </div>
          \${lintIssues.length ? \`<ul class="ul-compact">\${lintIssues.map((i) => \`<li>\${i}</li>\`).join('')}</ul>\` : '<div class="muted">All wiki pages pass frontmatter, link, and index checks.</div>'}
        \`;
      }
      renderWikiContentOnly(data);
    }

    function isEditingInContainer(containerId) {
      const container = document.getElementById(containerId);
      const active = document.activeElement;
      return Boolean(container && active && container.contains(active) && active.tagName === 'INPUT');
    }

    function render(data) {
      renderOverview(data);
      if (!isEditingInContainer('view-workflows')) renderWorkflows(data);
      if (!isEditingInContainer('view-skills')) renderSkills(data);
      if (!isEditingInContainer('view-subagents')) renderSubagents(data);
      if (!isEditingInContainer('view-wiki')) renderWiki(data);
      requestAnimationFrame(() => syncAllSlidingPills(true));
    }

    setTab(activeView);
    connectEventStream();
    loadSnapshot(true);
    setInterval(loadSnapshot, 15000);
  `;
}
