// oh-my-agy HUD UI Module (zero-dependency HTML/CSS/JS renderer for Antigravity Auxiliary Pane).
// Provides pure .toString()-shared helpers (buildSkillCommandWithFlags, buildSubagentInvokeSnippet,
// renderSafeMarkdown, prepareLoftSrcdoc) and interactive SSE + Slide-Over Artifact Drawer UI.

const ALLOWED_VIEWS = ['overview', 'workflows', 'skills', 'subagents', 'wiki'];

export function buildSkillCommandWithFlags(baseCmd, flags = [], knownFlags = []) {
  const selected = [];
  const seenSelected = new Set();
  for (const item of Array.isArray(flags) ? flags : []) {
    const clean = String(item || '').trim();
    if (clean && !seenSelected.has(clean)) {
      seenSelected.add(clean);
      selected.push(clean);
    }
  }
  const raw = String(baseCmd || '').trim();
  if (!raw) return selected.join(' ');
  const tokens = raw.split(/\s+/);
  const cmdToken = tokens[0];
  let rest = tokens.slice(1);
  const removable = new Set(selected);
  for (const k of Array.isArray(knownFlags) ? knownFlags : []) {
    const clean = String(k || '').trim();
    if (clean) removable.add(clean);
  }
  const hasWordSelection = selected.some((f) => !f.startsWith('-'));
  if (hasWordSelection && rest.length > 0 && !rest[0].startsWith('-') && removable.has(rest[0])) {
    rest = rest.slice(1);
  }
  rest = rest.filter((tok) => !removable.has(tok));
  return [cmdToken, ...selected, ...rest].join(' ').trim();
}

export function buildSubagentInvokeSnippet(agentName, model = 'inherit', prompt = '') {
  const agent = String(agentName || 'executor').trim() || 'executor';
  const rawModel = String(model || 'inherit').trim();
  const allowedModels = ['inherit', 'flash_lite', 'flash', 'pro'];
  const tier = allowedModels.includes(rawModel) ? rawModel : 'inherit';
  const taskText = String(prompt || '').trim() || `Complete bounded slice for ${agent}`;
  return `invoke_subagent({ TypeName: ${JSON.stringify(agent)}, Model: ${JSON.stringify(tier)}, Prompt: ${JSON.stringify(taskText)} })`;
}

export function renderSafeMarkdown(md) {
  const escHtml = (val) => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const src = String(md ?? '').replace(/\r\n/g, '\n');
  if (!src.trim()) return '<p class="md-p muted">Empty document.</p>';

  const codeBlocks = [];
  const withCodePlaceholders = src.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const langBadge = lang ? `<div class="md-code-lang">${escHtml(lang)}</div>` : '';
    codeBlocks.push(`<div class="md-code-wrap">${langBadge}<pre class="md-pre"><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\n\u0000CODEBLOCK_${idx}\u0000\n`;
  });

  const formatInline = (rawLine) => {
    const inlineCodes = [];
    const tokenized = String(rawLine || '').replace(/`([^`\n]+)`/g, (_m, inner) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code class="md-inline-code">${escHtml(inner)}</code>`);
      return `\u0000INLINECODE_${idx}\u0000`;
    });

    let safe = escHtml(tokenized);

    safe = safe.replace(/\[\[([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => {
      const display = label ? label.trim() : slug;
      return `<button type="button" class="wiki-link-pill" data-wiki-slug="${slug}" onclick="navigateToWikiSlug('${slug}')">[[${display}]]</button>`;
    });

    safe = safe.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, label, rawHref) => {
      const decodedHref = rawHref.replace(/&amp;/g, '&');
      if (/^(?:https?:\/\/[^\s"'<>]+|customization:\/\/oh-my-agy\/?)$/i.test(decodedHref)) {
        const hrefAttr = escHtml(decodedHref);
        const extAttrs = /^https?:\/\//i.test(decodedHref) ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a class="md-link" href="${hrefAttr}"${extAttrs}>${label}</a>`;
      }
      return full;
    });

    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

    return safe.replace(/\u0000INLINECODE_(\d+)\u0000/g, (_m, idx) => inlineCodes[Number(idx)] || '');
  };

  const lines = withCodePlaceholders.split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line || '');
  const splitTableRow = (line) => String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => formatInline(c.trim()));

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    const cbMatch = /^\u0000CODEBLOCK_(\d+)\u0000$/.exec(trimmed);
    if (cbMatch) {
      out.push(codeBlocks[Number(cbMatch[1])] || '');
      i += 1;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level} class="md-h${level}">${formatInline(headingMatch[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr class="md-hr" />');
      i += 1;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headerCells = splitTableRow(trimmed);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().includes('|') && !/^\u0000CODEBLOCK_/.test(lines[i].trim())) {
        bodyRows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const thHtml = headerCells.map((c) => `<th>${c}</th>`).join('');
      const tbHtml = bodyRows.map((row) => `<tr>${headerCells.map((_h, colIdx) => `<td>${row[colIdx] ?? ''}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table class="hud-table md-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(formatInline(lines[i].trim().replace(/^>\s?/, '')));
        i += 1;
      }
      out.push(`<blockquote class="md-quote">${quoteLines.join('<br />')}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^[-*+]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul class="md-list">${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol class="md-list">${items.join('')}</ol>`);
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length
      && lines[i].trim()
      && !/^\u0000CODEBLOCK_/.test(lines[i].trim())
      && !/^(#{1,4})\s+/.test(lines[i].trim())
      && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
      && !/^>\s?/.test(lines[i].trim())
      && !/^[-*+]\s+/.test(lines[i].trim())
      && !/^\d+\.\s+/.test(lines[i].trim())
      && !(lines[i].trim().includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      paraLines.push(formatInline(lines[i].trim()));
      i += 1;
    }
    if (paraLines.length) {
      out.push(`<p class="md-p">${paraLines.join(' ')}</p>`);
    } else {
      i += 1;
    }
  }

  return out.join('\n');
}

export function prepareLoftSrcdoc(rawHtml, entrySubPath = 'index.html', assetMap = {}, cssVarsText = '') {
  const normAssetKey = (baseDir, spec) => {
    const cleanSpec = String(spec || '').trim().split(/[?#]/)[0];
    if (!cleanSpec || /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(cleanSpec)) return '';
    const combined = (baseDir ? `${baseDir}/${cleanSpec}` : cleanSpec).replace(/\\/g, '/');
    const parts = [];
    for (const seg of combined.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (parts.length) parts.pop();
      } else {
        parts.push(seg);
      }
    }
    return `./${parts.join('/')}`;
  };

  const dirOfKey = (assetKey) => {
    const stripped = String(assetKey || '').replace(/^\.\//, '');
    const slashIdx = stripped.lastIndexOf('/');
    return slashIdx === -1 ? '' : stripped.slice(0, slashIdx);
  };

  const bundleModuleSource = (sourceCode, currentDir) => {
    const moduleOrder = [];
    const moduleBodies = new Map();
    const visiting = new Set();

    const compileDepModule = (assetKey) => {
      if (moduleBodies.has(assetKey)) return `__omagy_mod_${moduleOrder.indexOf(assetKey)}`;
      if (visiting.has(assetKey)) return '{}';
      const rawMod = Object.prototype.hasOwnProperty.call(assetMap, assetKey) ? String(assetMap[assetKey] || '') : null;
      if (rawMod === null) return null;
      visiting.add(assetKey);
      const modDir = dirOfKey(assetKey);
      let body = rewriteImports(rawMod, modDir);
      const exportedPairs = [];
      let hasDefault = false;

      body = body.replace(/^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)/gm, (_m, fnName) => {
        hasDefault = true;
        exportedPairs.push(`default: ${fnName}`);
        return `function ${fnName}`;
      });
      body = body.replace(/^\s*export\s+default\s+/gm, () => {
        hasDefault = true;
        return 'const __omagy_default = ';
      });
      if (hasDefault && !exportedPairs.some((p) => p.startsWith('default:'))) {
        exportedPairs.push('default: __omagy_default');
      }

      body = body.replace(/^\s*export\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_m, kw, name) => {
        exportedPairs.push(`${name}: ${name}`);
        return `${kw} ${name}`;
      });
      body = body.replace(/^\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kw, name) => {
        exportedPairs.push(`${name}: ${name}`);
        return `${kw} ${name}`;
      });
      body = body.replace(/^\s*export\s*\{\s*([^}]+)\s*\}\s*;?/gm, (_m, list) => {
        for (const item of list.split(',')) {
          const t = item.trim();
          if (!t) continue;
          const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(t);
          if (asMatch) exportedPairs.push(`${asMatch[2]}: ${asMatch[1]}`);
          else exportedPairs.push(`${t}: ${t}`);
        }
        return '';
      });

      visiting.delete(assetKey);
      const idx = moduleOrder.length;
      moduleOrder.push(assetKey);
      const varName = `__omagy_mod_${idx}`;
      moduleBodies.set(assetKey, `const ${varName} = (() => {\n${body}\nreturn { ${exportedPairs.join(', ')} };\n})();`);
      return varName;
    };

    function rewriteImports(code, baseDir) {
      let next = String(code || '');
      next = next.replace(/^\s*import\s+([^'"]*?)\s+from\s+['"](\.\.?\/[^'"]+)['"]\s*;?/gm, (full, clause, spec) => {
        const key = normAssetKey(baseDir, spec);
        const modVar = key ? compileDepModule(key) : null;
        if (!modVar) return `/* unresolved local module ${spec} */`;
        const c = clause.trim();
        const nsMatch = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(c);
        if (nsMatch) return `const ${nsMatch[1]} = ${modVar};`;
        const namedOnly = /^\{\s*([^}]+)\s*\}$/.exec(c);
        if (namedOnly) {
          const destruct = namedOnly[1].replace(/\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\b/g, '$1: $2');
          return `const { ${destruct} } = ${modVar};`;
        }
        const defAndNamed = /^([A-Za-z_$][\w$]*)\s*,\s*\{\s*([^}]+)\s*\}$/.exec(c);
        if (defAndNamed) {
          const destruct = defAndNamed[2].replace(/\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\b/g, '$1: $2');
          return `const ${defAndNamed[1]} = ${modVar}.default; const { ${destruct} } = ${modVar};`;
        }
        if (/^[A-Za-z_$][\w$]*$/.test(c)) {
          return `const ${c} = ${modVar}.default;`;
        }
        return full;
      });
      next = next.replace(/^\s*import\s+['"](\.\.?\/[^'"]+)['"]\s*;?/gm, (_full, spec) => {
        const key = normAssetKey(baseDir, spec);
        const modVar = key ? compileDepModule(key) : null;
        return modVar ? `${modVar};` : `/* unresolved side-effect module ${spec} */`;
      });
      return next;
    }

    const entryTransformed = rewriteImports(sourceCode, currentDir);
    const prelude = moduleOrder.map((k) => moduleBodies.get(k)).join('\n');
    return prelude ? `${prelude}\n${entryTransformed}` : entryTransformed;
  };

  const entryKey = normAssetKey('', entrySubPath || 'index.html');
  const entryDir = dirOfKey(entryKey);
  const closeScriptTag = '</scr' + 'ipt>';
  const safeInlineJs = (js) => String(js || '').replace(/<\/script/gi, '<\\/script');

  let html = String(rawHtml || '');

  // Strip external http/https/protocol-relative script src and stylesheet links
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*(['"])(?:https?:\/\/|\/\/)[^'"]*\1[^>]*>[\s\S]*?<\/script>/gi, '<!-- stripped external script -->');
  html = html.replace(/<link\b[^>]*\bhref\s*=\s*(['"])(?:https?:\/\/|\/\/)[^'"]*\1[^>]*>/gi, '<!-- stripped external link -->');

  // Inline local <link rel="stylesheet" href="./...">
  html = html.replace(/<link\b([^>]*?)>/gi, (full, attrs) => {
    if (!/\brel\s*=\s*(['"]?)stylesheet\1/i.test(attrs)) return full;
    const hrefMatch = /\bhref\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
    if (!hrefMatch) return full;
    const key = normAssetKey(entryDir, hrefMatch[2]);
    if (!key || !Object.prototype.hasOwnProperty.call(assetMap, key)) return full;
    return `<style data-inlined-asset="${key}">\n${String(assetMap[key] || '')}\n</style>`;
  });

  // Inline local <script src="./..."> and bundle relative ES module imports inside <script type="module">
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, inlineBody) => {
    const isModule = /\btype\s*=\s*(['"]?)module\1/i.test(attrs);
    const srcMatch = /\bsrc\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
    if (srcMatch) {
      const key = normAssetKey(entryDir, srcMatch[2]);
      if (!key || !Object.prototype.hasOwnProperty.call(assetMap, key)) return '<!-- missing local script asset -->';
      const rawJs = String(assetMap[key] || '');
      const bundled = isModule || /\.mjs$/i.test(key) ? bundleModuleSource(rawJs, dirOfKey(key)) : rawJs;
      const typeAttr = isModule ? ' type="module"' : '';
      return `<script${typeAttr} data-inlined-asset="${key}">\n${safeInlineJs(bundled)}\n${closeScriptTag}`;
    }
    if (isModule && inlineBody.trim()) {
      const bundledInline = bundleModuleSource(inlineBody, entryDir);
      return `<script type="module">\n${safeInlineJs(bundledInline)}\n${closeScriptTag}`;
    }
    return full;
  });

  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:">`;
  const themeStyle = cssVarsText
    ? `<style id="omagy-hud-theme-vars">:root { ${cssVarsText} }</style>`
    : '';
  const injectedHead = `${cspMeta}\n${themeStyle}`;

  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${injectedHead}`);
  } else {
    html = `<!DOCTYPE html><html><head>${injectedHead}</head><body>${html}</body></html>`;
  }
  return html;
}

export function renderHudHtml() {
  const sharedHelpersSource = [
    buildSkillCommandWithFlags.toString(),
    buildSubagentInvokeSnippet.toString(),
    renderSafeMarkdown.toString(),
    prepareLoftSrcdoc.toString(),
  ].join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Oh My Agy</title>
  <style>
    :root {
      color-scheme: dark light;
      --hud-bg: var(--background, #0d1017);
      --hud-content: var(--content, #131822);
      --hud-card: var(--card, #161b26);
      --hud-sidebar: var(--sidebar, #10141d);
      --hud-border: var(--border, rgba(148, 163, 184, 0.18));
      --hud-fg: var(--foreground, #e5e7eb);
      --hud-muted: var(--muted-foreground, #94a3b8);
      --hud-primary: var(--primary, #60a5fa);
      --hud-accent: var(--accent, rgba(96, 165, 250, 0.14));
      --hud-surface-subtle: rgba(255, 255, 255, 0.035);
      --hud-input-bg: rgba(0, 0, 0, 0.24);
      --hud-ok: #34d399;
      --hud-warn: #fbbf24;
      --hud-danger: #f87171;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --hud-bg: var(--background, #f8fafc);
        --hud-content: var(--content, #ffffff);
        --hud-card: var(--card, #ffffff);
        --hud-sidebar: var(--sidebar, #f1f5f9);
        --hud-border: var(--border, rgba(15, 23, 42, 0.14));
        --hud-fg: var(--foreground, #0f172a);
        --hud-muted: var(--muted-foreground, #475569);
        --hud-primary: var(--primary, #2563eb);
        --hud-accent: var(--accent, rgba(37, 99, 235, 0.10));
        --hud-surface-subtle: rgba(15, 23, 42, 0.035);
        --hud-input-bg: rgba(15, 23, 42, 0.04);
        --hud-ok: #059669;
        --hud-warn: #d97706;
        --hud-danger: #dc2626;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--hud-bg);
      color: var(--hud-fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      overflow-x: hidden;
    }
    button:focus-visible,
    a:focus-visible,
    input:focus-visible,
    select:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--hud-primary);
      outline-offset: 2px;
    }
    .card {
      background: var(--hud-card);
      border: 1px solid var(--hud-border);
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
    .muted { color: var(--hud-muted); }
    .tabular { font-variant-numeric: tabular-nums; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
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
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
    }
    .badge-active {
      border-color: var(--hud-primary);
      color: var(--hud-primary);
      background: var(--hud-accent);
    }
    .badge-live {
      border-color: var(--hud-ok);
      color: var(--hud-ok);
    }
    .badge-danger {
      border-color: var(--hud-danger);
      color: var(--hud-danger);
    }
    .tab-btn {
      padding: 5px 10px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      color: var(--hud-muted);
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .tab-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-subtle);
    }
    .tab-btn.active {
      background: var(--hud-accent);
      color: var(--hud-fg);
      border-color: var(--hud-border);
    }
    .chip-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-muted);
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .chip-btn:hover {
      color: var(--hud-fg);
      border-color: var(--hud-primary);
    }
    .chip-btn.chip-active,
    .chip-btn[aria-pressed="true"] {
      color: var(--hud-primary);
      border-color: var(--hud-primary);
      background: var(--hud-accent);
    }
    .search-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid var(--hud-border);
      background: var(--hud-input-bg);
      color: var(--hud-fg);
      font-size: 12px;
      margin-bottom: 8px;
    }
    .bar-track {
      width: 100%;
      height: 8px;
      background: rgba(148, 163, 184, 0.22);
      border-radius: 9999px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--hud-primary);
      border-radius: 9999px;
      transition: width 160ms ease;
    }
    .cmd-box {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      margin-top: 8px;
      padding: 8px;
      border-radius: 7px;
      background: var(--hud-input-bg);
      border: 1px solid var(--hud-border);
    }
    .cmd-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
      border: 1px solid var(--hud-border);
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
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
    }
    .action-btn:hover {
      border-color: var(--hud-primary);
    }
    .action-btn-primary {
      border-color: var(--hud-primary);
      background: var(--hud-accent);
      color: var(--hud-primary);
    }
    .action-btn-danger {
      border-color: var(--hud-danger);
      color: var(--hud-danger);
      background: rgba(248, 113, 113, 0.1);
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
      border-bottom: 1px solid var(--hud-border);
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    table.hud-table th {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--hud-muted);
      font-weight: 600;
    }
    table.hud-table tbody tr:last-child td { border-bottom: none; }
    table.hud-table .col-id { width: 52px; white-space: nowrap; }
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
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
      min-width: 0;
    }
    .health-stat-label {
      font-size: 12px;
      color: var(--hud-muted);
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
      color: var(--hud-muted);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }
    .health-section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--hud-muted);
      margin: 10px 0 6px 0;
    }
    .health-item {
      padding: 8px 10px;
      border-radius: 7px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
      margin-top: 6px;
      min-width: 0;
    }
    details.hud-details {
      margin-top: 8px;
      border-top: 1px solid var(--hud-border);
      padding-top: 6px;
    }
    details.hud-details > summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--hud-muted);
      user-select: none;
    }
    details.hud-details[open] > summary {
      color: var(--hud-fg);
      margin-bottom: 6px;
    }
    .snippet-preview {
      margin-top: 4px;
      padding: 6px 8px;
      border-radius: 5px;
      background: var(--hud-surface-subtle);
      border: 1px dashed var(--hud-border);
      font-size: 12px;
      color: var(--hud-muted);
    }
    ul, ol, li { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      margin: 0;
    }

    /* Formatted Safe Markdown */
    .md-h1 { font-size: 16px; font-weight: 700; margin: 10px 0 6px 0; }
    .md-h2 { font-size: 15px; font-weight: 600; margin: 10px 0 6px 0; border-bottom: 1px solid var(--hud-border); padding-bottom: 3px; }
    .md-h3 { font-size: 14px; font-weight: 600; margin: 8px 0 4px 0; }
    .md-h4 { font-size: 13px; font-weight: 600; margin: 6px 0 4px 0; }
    .md-p { font-size: 13px; margin: 0 0 8px 0; }
    .md-list { margin: 0 0 8px 0; padding-left: 18px; font-size: 13px; }
    .md-quote {
      margin: 0 0 8px 0;
      padding: 6px 10px;
      border-left: 3px solid var(--hud-primary);
      background: var(--hud-surface-subtle);
      color: var(--hud-muted);
      font-size: 12px;
    }
    .md-hr { border: none; border-top: 1px solid var(--hud-border); margin: 10px 0; }
    .md-code-wrap {
      margin: 0 0 8px 0;
      border: 1px solid var(--hud-border);
      border-radius: 7px;
      background: var(--hud-input-bg);
      overflow: hidden;
    }
    .md-code-lang {
      padding: 3px 8px;
      font-size: 12px;
      color: var(--hud-muted);
      border-bottom: 1px solid var(--hud-border);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .md-pre { padding: 8px 10px; }
    .md-inline-code {
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
      font-size: 12px;
    }
    .md-link {
      color: var(--hud-primary);
      text-decoration: underline;
    }
    .wiki-link-pill {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 5px;
      border: 1px solid var(--hud-primary);
      background: var(--hud-accent);
      color: var(--hud-primary);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }

    /* Slide-Over Artifact Drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.48);
      z-index: 90;
    }
    .artifact-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(94vw, 560px);
      background: var(--hud-content);
      border-left: 1px solid var(--hud-border);
      box-shadow: -8px 0 28px rgba(0, 0, 0, 0.35);
      z-index: 100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .artifact-drawer[hidden],
    .drawer-backdrop[hidden] {
      display: none !important;
    }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--hud-border);
      background: var(--hud-sidebar);
    }
    .drawer-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 12px 14px;
    }
    .vr-side-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .vr-frame {
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      padding: 6px;
      background: var(--hud-input-bg);
    }
    .vr-frame img,
    .vr-stage img {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 4px;
    }
    .vr-stage {
      position: relative;
      width: 100%;
      overflow: hidden;
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      background: var(--hud-input-bg);
      margin-top: 8px;
    }
    .vr-stage .vr-top-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .loft-iframe {
      width: 100%;
      min-height: 360px;
      height: 58vh;
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      background: var(--hud-card);
    }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
    <div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-weight:600;font-size:14px;">Oh My Agy</span>
        <span id="sse-status-pill" class="badge tabular" title="Live Server-Sent Events connection status">INIT</span>
      </div>
      <div id="status-line" class="muted" style="font-size:12px;font-family:ui-monospace,monospace;">[OMA] Loading...</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <span class="muted" style="font-size:12px;" title="Shortcuts: 1-5 switch tabs, / search, Esc close drawer">1-5 &middot; / &middot; Esc</span>
      <button id="refresh-btn" class="tab-btn active" title="Force snapshot refresh">Refresh</button>
    </div>
  </div>

  <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;" role="tablist" aria-label="HUD sections">
    <button class="tab-btn active" role="tab" data-view="overview">Overview</button>
    <button class="tab-btn" role="tab" data-view="workflows">Workflows</button>
    <button class="tab-btn" role="tab" data-view="skills">Skills</button>
    <button class="tab-btn" role="tab" data-view="subagents">Subagents</button>
    <button class="tab-btn" role="tab" data-view="wiki">Wiki</button>
  </div>

  <div id="view-overview" class="view-pane"></div>
  <div id="view-workflows" class="view-pane" style="display:none;"></div>
  <div id="view-skills" class="view-pane" style="display:none;"></div>
  <div id="view-subagents" class="view-pane" style="display:none;"></div>
  <div id="view-wiki" class="view-pane" style="display:none;"></div>

  <div id="artifact-drawer-backdrop" class="drawer-backdrop" hidden onclick="closeArtifactDrawer()"></div>
  <aside id="artifact-drawer" class="artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="artifact-drawer-title" hidden>
    <div class="drawer-header">
      <div style="min-width:0;flex:1 1 auto;">
        <div id="artifact-drawer-title" style="font-weight:600;font-size:13px;overflow-wrap:anywhere;">Artifact Preview</div>
        <div id="artifact-drawer-sub" class="muted" style="font-size:12px;font-family:ui-monospace,monospace;"></div>
      </div>
      <button type="button" id="artifact-drawer-close" class="action-btn" onclick="closeArtifactDrawer()" aria-label="Close drawer">Close (Esc)</button>
    </div>
    <div id="artifact-drawer-controls" style="padding:8px 14px;border-bottom:1px solid var(--hud-border);display:none;"></div>
    <div id="artifact-drawer-body" class="drawer-body"></div>
  </aside>

  <script>
    ${sharedHelpersSource}

    const ALLOWED = ${JSON.stringify(ALLOWED_VIEWS)};
    const MODEL_TIERS = ['inherit', 'flash_lite', 'flash', 'pro'];
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    let activeView = ALLOWED.includes(params.get('view')) ? params.get('view') : 'overview';
    let selectedWikiSlug = params.get('slug') || '';
    let wikiSearch = '';
    let wikiCategory = 'All';
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
    let activeDrawerObjectUrls = [];
    let currentVrState = null;
    let currentLoftState = null;

    function syncUrlState() {
      try {
        const next = new URLSearchParams(window.location.search);
        next.set('view', activeView);
        if (activeView === 'wiki' && selectedWikiSlug) next.set('slug', selectedWikiSlug);
        else next.delete('slug');
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
        if (currentLoftState && !document.getElementById('artifact-drawer').hidden) {
          renderLoftFrame();
        }
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

    function captureUiState() {
      document.querySelectorAll('details[data-hud-key]').forEach((d) => {
        if (d.dataset.hudKey) persistedDetailsState[d.dataset.hudKey] = d.open;
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
      return {
        scrollX: window.scrollX || 0,
        scrollY: window.scrollY || 0,
        details: { ...persistedDetailsState },
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

    function flashButton(btn, label, ms = 1400) {
      if (!btn) return;
      const prev = btn.dataset.origLabel || btn.textContent;
      btn.dataset.origLabel = prev;
      btn.textContent = label;
      setTimeout(() => { btn.textContent = prev; }, ms);
    }

    function copyTextWithFlash(btn, text) {
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashButton(btn, 'Copied!')).catch(() => { /* fail open: clipboard permission denied */ });
      }
    }

    window.copyFromInput = function(btn, inputId) {
      const el = document.getElementById(inputId);
      copyTextWithFlash(btn, el ? el.value : '');
    };

    window.copySubagentSnippet = function(btn, agentName) {
      const previewEl = document.getElementById('sa-snippet-' + agentName);
      copyTextWithFlash(btn, previewEl ? previewEl.textContent : '');
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
      } catch { /* fail open: dispatch network failure */
        if (btn) btn.disabled = false;
        flashButton(btn, 'Failed', 1800);
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
        if (latestData) renderOverview(latestData);
      }, 6000);
      if (latestData) renderOverview(latestData);
    };

    window.abortCancelMode = function() {
      pendingCancelConfirm = false;
      if (cancelConfirmTimer) clearTimeout(cancelConfirmTimer);
      if (latestData) renderOverview(latestData);
    };

    window.confirmCancelMode = function(btn, targetMode) {
      pendingCancelConfirm = false;
      if (cancelConfirmTimer) clearTimeout(cancelConfirmTimer);
      const cmd = targetMode ? '/cancel ' + targetMode : '/cancel';
      postDispatch(btn, { mode: 'active-chat', prompt: cmd });
      if (latestData) renderOverview(latestData);
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

    function openDrawerShell(title, subtitle, controlsHtml = '') {
      revokeDrawerUrls();
      currentVrState = null;
      currentLoftState = null;
      document.getElementById('artifact-drawer-title').textContent = title || 'Artifact Preview';
      document.getElementById('artifact-drawer-sub').textContent = subtitle || '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      ctrl.innerHTML = controlsHtml || '';
      ctrl.style.display = controlsHtml ? 'block' : 'none';
      document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Loading artifact...</div>';
      document.getElementById('artifact-drawer-backdrop').hidden = false;
      document.getElementById('artifact-drawer').hidden = false;
    }

    window.closeArtifactDrawer = function() {
      revokeDrawerUrls();
      currentVrState = null;
      currentLoftState = null;
      document.getElementById('artifact-drawer-backdrop').hidden = true;
      document.getElementById('artifact-drawer').hidden = true;
      document.getElementById('artifact-drawer-body').innerHTML = '';
      document.getElementById('artifact-drawer-controls').innerHTML = '';
      document.getElementById('artifact-drawer-controls').style.display = 'none';
    };

    async function fetchArtifactResponse(relPath) {
      const q = new URLSearchParams();
      const wsRoot = latestData?.workspace || workspaceUris[0] || '';
      if (wsRoot) q.set('workspace', wsRoot);
      q.set('rel', relPath);
      const headers = token ? { 'X-Sidecar-Token': token } : {};
      return fetch('/api/artifact?' + q.toString(), { headers });
    }

    window.openMarkdownDrawer = async function(relFile, title, kindLabel) {
      if (!relFile) return;
      openDrawerShell(title || relFile, (kindLabel ? '[' + kindLabel + '] ' : '') + relFile);
      try {
        const res = await fetchArtifactResponse(relFile);
        if (!res.ok) {
          document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Artifact could not be loaded (HTTP ' + esc(res.status) + ').</div>';
          return;
        }
        const mdText = await res.text();
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="drawer-markdown-body">' + renderSafeMarkdown(mdText) + '</div>';
      } catch { /* fail open: artifact markdown fetch failed */
        document.getElementById('artifact-drawer-body').innerHTML = '<div class="muted">Failed to load Markdown artifact.</div>';
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
              <div class="muted" style="font-size:12px;margin-bottom:4px;">Reference: <code>\${esc(leftImg.name)}</code></div>
              <img src="\${esc(leftUrl)}" alt="\${esc(leftImg.name)}" />
            </div>
            \${rightImg ? \`
            <div class="vr-frame">
              <div class="muted" style="font-size:12px;margin-bottom:4px;">Candidate: <code>\${esc(rightImg.name)}</code></div>
              <img src="\${esc(rightUrl)}" alt="\${esc(rightImg.name)}" />
            </div>\` : ''}
          </div>\`;
      } else if (leftUrl && mode === 'split-slider') {
        stageHtml = \`
          <div style="margin-top:6px;">
            <label class="muted" style="font-size:12px;display:flex;justify-content:space-between;">
              <span>Split Reveal</span><span class="tabular">\${sliderPct}%</span>
            </label>
            <input type="range" min="0" max="100" value="\${sliderPct}" style="width:100%;" oninput="onVrSliderInput(this.value)" />
          </div>
          <div class="vr-stage">
            <img src="\${esc(rightUrl || leftUrl)}" alt="Candidate layer" />
            <img class="vr-top-layer" src="\${esc(leftUrl)}" alt="Reference split layer" style="clip-path: inset(0 \${100 - sliderPct}% 0 0);" />
          </div>\`;
      } else if (leftUrl && mode === 'onion-skin') {
        const alpha = (sliderPct / 100).toFixed(2);
        stageHtml = \`
          <div style="margin-top:6px;">
            <label class="muted" style="font-size:12px;display:flex;justify-content:space-between;">
              <span>Overlay Opacity</span><span class="tabular">\${sliderPct}%</span>
            </label>
            <input type="range" min="0" max="100" value="\${sliderPct}" style="width:100%;" oninput="onVrSliderInput(this.value)" />
          </div>
          <div class="vr-stage">
            <img src="\${esc(leftUrl)}" alt="Reference base" />
            <img class="vr-top-layer" src="\${esc(rightUrl || leftUrl)}" alt="Candidate onion layer" style="opacity:\${alpha};" />
          </div>\`;
      }

      const v = item.verdict;
      const verdictHtml = v ? \`
        <div class="card" style="margin-top:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
            <div style="font-weight:600;">Vision Verdict</div>
            <div style="display:flex;gap:4px;">
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
        <button type="button" class="chip-btn \${mode === m.id ? 'chip-active' : ''}" data-vr-mode="\${m.id}" aria-pressed="\${mode === m.id ? 'true' : 'false'}" onclick="setVrMode('\${m.id}')">\${m.label}</button>\`).join('');
      const imgs = item.images || [];
      const selectors = imgs.length >= 2 ? \`
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">
          <span class="muted" style="font-size:12px;">Ref:</span>
          <select class="cmd-input" style="width:auto;padding:3px 6px;" onchange="setVrPair(Number(this.value), null)">
            \${imgs.map((im, idx) => \`<option value="\${idx}" \${idx === leftIdx ? 'selected' : ''}>\${esc(im.name)}</option>\`).join('')}
          </select>
          <span class="muted" style="font-size:12px;">Cand:</span>
          <select class="cmd-input" style="width:auto;padding:3px 6px;" onchange="setVrPair(null, Number(this.value))">
            \${imgs.map((im, idx) => \`<option value="\${idx}" \${idx === rightIdx ? 'selected' : ''}>\${esc(im.name)}</option>\`).join('')}
          </select>
        </div>\` : '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      ctrl.innerHTML = \`<div style="display:flex;gap:6px;flex-wrap:wrap;">\${modeBtns}</div>\${selectors}\`;
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
      openDrawerShell('Visual Ralph: ' + vrItem.slug, 'visual-ralph (' + (vrItem.scope || '.') + ')');
      const urlMap = {};
      for (const img of vrItem.images || []) {
        try {
          const res = await fetchArtifactResponse(img.relPath);
          if (res.ok) {
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            activeDrawerObjectUrls.push(objUrl);
            urlMap[img.relPath] = objUrl;
          }
        } catch { /* fail open: skip unreadable visual-ralph image */ }
      }
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
      const keys = ['--hud-bg', '--hud-content', '--hud-card', '--hud-sidebar', '--hud-border', '--hud-fg', '--hud-muted', '--hud-primary', '--hud-accent', '--background', '--foreground', '--card', '--border', '--primary'];
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
      const rootSuffix = item.relPath.endsWith('/index.html') && !/\/variant-[a-c]\/index\.html$/.test(item.relPath) ? 'index.html' : null;
      if (rootSuffix) entries.push({ sub: 'index.html', label: 'Root Prototype' });
      for (const v of item.variants || []) {
        entries.push({ sub: v, label: v.replace('/index.html', '') });
      }
      const entryBtns = entries.map((e) => \`
        <button type="button" class="chip-btn \${!viewVerdict && activeEntry === e.sub ? 'chip-active' : ''}" aria-pressed="\${!viewVerdict && activeEntry === e.sub ? 'true' : 'false'}" onclick="selectLoftEntry('\${esc(e.sub)}')">\${esc(e.label)}</button>\`).join('');
      const verdictBtn = item.arenaVerdictFile
        ? \`<button type="button" class="chip-btn \${viewVerdict ? 'chip-active' : ''}" aria-pressed="\${viewVerdict ? 'true' : 'false'}" onclick="showLoftArenaVerdict()">Arena Verdict</button>\`
        : '';
      const ctrl = document.getElementById('artifact-drawer-controls');
      if (entryBtns || verdictBtn) {
        ctrl.innerHTML = \`<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">\${entryBtns}\${verdictBtn}</div>\`;
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
        bodyEl.innerHTML = '<div class="drawer-markdown-body">' + renderSafeMarkdown(verdictMarkdown || 'No arena verdict content.') + '</div>';
        return;
      }
      const rawHtml = htmlCache[activeEntry] || '';
      const prepared = prepareLoftSrcdoc(rawHtml, activeEntry, assetMap, collectActiveThemeCssVars());
      bodyEl.innerHTML = \`
        <div class="muted" style="font-size:12px;margin-bottom:6px;">Opaque-origin sandbox (<code>sandbox="allow-scripts"</code> &middot; local assets inlined &middot; external scripts stripped)</div>
        <iframe id="loft-sandbox-frame" class="loft-iframe" sandbox="allow-scripts" referrerpolicy="no-referrer" title="\${esc(item.title || item.slug)}"></iframe>\`;
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
      openDrawerShell('Loft: ' + (loftItem.title || loftItem.slug), loftItem.relPath);
      const scopePrefix = loftItem.scope && loftItem.scope !== '.' ? loftItem.scope + '/' : '';
      const baseDir = scopePrefix + '.omagy/artifacts/loft/' + loftItem.slug;
      const initialEntry = loftItem.relPath.startsWith(baseDir + '/')
        ? loftItem.relPath.slice(baseDir.length + 1)
        : 'index.html';
      const assetMap = {};
      for (const relAsset of loftItem.localAssets || []) {
        const cleanSub = relAsset.replace(/^\.\//, '');
        try {
          const res = await fetchArtifactResponse(baseDir + '/' + cleanSub);
          if (res.ok) assetMap[relAsset] = await res.text();
        } catch { /* fail open: skip unreadable local loft asset */ }
      }
      const htmlCache = {};
      try {
        const res = await fetchArtifactResponse(baseDir + '/' + initialEntry);
        htmlCache[initialEntry] = res.ok ? await res.text() : '<p>Unable to load Loft HTML.</p>';
      } catch { /* fail open: initial loft HTML fetch failed */
        htmlCache[initialEntry] = '<p>Unable to load Loft HTML.</p>';
      }
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

    function setTab(view) {
      activeView = ALLOWED.includes(view) ? view : 'overview';
      document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === activeView);
      });
      ALLOWED.forEach((v) => {
        const el = document.getElementById('view-' + v);
        if (el) el.style.display = v === activeView ? 'block' : 'none';
      });
      syncUrlState();
    }

    document.querySelectorAll('.tab-btn[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.view));
    });
    document.getElementById('refresh-btn').addEventListener('click', () => loadSnapshot(true));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const drawer = document.getElementById('artifact-drawer');
        if (drawer && !drawer.hidden) {
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
      const inEditable = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
      if (inEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (activeView !== 'skills' && activeView !== 'subagents' && activeView !== 'wiki') {
          setTab('skills');
        }
        const searchId = activeView === 'subagents'
          ? 'subagent-search-input'
          : (activeView === 'wiki' ? 'wiki-search-input' : 'skill-search-input');
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
      if (!document.getElementById('artifact-drawer').hidden) {
        window.closeArtifactDrawer();
      }
      selectedWikiSlug = slug;
      wikiSearch = '';
      wikiCategory = 'All';
      setTab('wiki');
      if (latestData) renderWiki(latestData);
    };

    window.selectWikiSlug = function(slug) {
      selectedWikiSlug = slug;
      syncUrlState();
      if (latestData) renderWiki(latestData);
    };

    window.setWikiCategory = function(cat) {
      wikiCategory = cat;
      if (latestData) renderWiki(latestData);
    };

    window.onWikiSearchInput = function(val) {
      wikiSearch = String(val || '');
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

    window.onSubagentSearchInput = function(val) {
      subagentSearch = String(val || '');
      if (latestData) renderSubagentsListOnly(latestData);
    };

    function renderOverview(data) {
      const activeModeObj = (data.modes || []).find((m) => m.active && !m.stale) || null;
      const modesRows = (data.modes || []).map((m) => \`
        <tr>
          <td class="col-mode"><code>\${esc(m.mode)}</code></td>
          <td class="col-phase">
            <span class="badge \${m.active && !m.stale ? 'badge-active' : ''}">\${esc(m.phase)}</span>
            <div class="muted" style="font-size:12px;margin-top:2px;">\${m.active ? (m.awaitingConfirmation ? 'WAITING CONFIRMATION' : (m.stale ? 'stale (>6h)' : 'active')) : 'inactive'}\${m.iteration != null ? \` &middot; #\${esc(m.iteration)}\` : ''}</div>
          </td>
          <td class="col-scope muted">\${esc(m.session)}</td>
        </tr>\`).join('');

      const cancelControlHtml = pendingCancelConfirm
        ? \`<button type="button" class="action-btn action-btn-danger" data-cancel-mode="\${esc(activeModeObj ? activeModeObj.mode : '')}" onclick="confirmCancelMode(this, this.dataset.cancelMode)">Confirm /cancel\${activeModeObj ? ' ' + esc(activeModeObj.mode) : ''}</button>
           <button type="button" class="action-btn" onclick="abortCancelMode()">Abort</button>\`
        : \`<button type="button" class="action-btn" onclick="armCancelMode()">Cancel Mode</button>\`;

      const quickActionsHtml = \`
        <div class="cmd-actions" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--hud-border);">
          <button type="button" class="action-btn action-btn-primary" onclick="runQuickCommand(this, 'continue', 'active-chat')">Continue</button>
          \${cancelControlHtml}
          <button type="button" class="action-btn" onclick="runQuickCommand(this, '/hud --handoff', 'active-chat')">Create Handoff</button>
          <button type="button" class="action-btn" onclick="runQuickCommand(this, '/doctor', 'active-chat')">Run /doctor</button>
          <a class="action-btn" href="customization://oh-my-agy" title="Open oh-my-agy settings">Plugin Settings</a>
        </div>\`;

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
              <div class="muted tabular" style="font-size:12px;margin-top:2px;">Rigor: <code>\${esc(g.rigor)}</code> &middot; Retries: \${g.productFailures}/3</div>
            </td>
            <td class="col-status"><span class="badge \${g.status === 'in_progress' ? 'badge-active' : ''}">\${esc(g.status)}</span></td>
          </tr>\`).join('');
        const ledgerList = Array.isArray(ug.recentLedger) ? ug.recentLedger : [];
        const ledgerRows = ledgerList.map((entry) => {
          const ts = entry.at || entry.ts || '';
          const gid = entry.goal_id || entry.goal || 'ALL';
          const act = entry.event || entry.action || entry.status || 'event';
          const note = entry.note || entry.summary || entry.verdict || entry.evidence || '';
          return \`
            <tr>
              <td class="col-id"><code>\${esc(gid)}</code></td>
              <td class="col-main">
                <div><span class="badge">\${esc(act)}</span> \${esc(note)}</div>
                \${ts ? \`<div class="muted tabular" style="font-size:12px;margin-top:2px;">\${esc(ts)}</div>\` : ''}
              </td>
            </tr>\`;
        }).join('');
        const ledgerHtml = ledgerList.length ? \`
          <details class="hud-details" data-hud-key="ug-ledger">
            <summary class="tabular">Recent Ledger Events (\${ledgerList.length})</summary>
            <div class="table-wrap"><table class="hud-table"><tbody>\${ledgerRows}</tbody></table></div>
          </details>\` : '';
        ugHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div style="font-weight:600;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;">Ultragoal: \${esc(ug.objective || 'Active Plan')}\${ugScope}</div>
              <span class="badge badge-active tabular">\${ug.counts.complete}/\${ug.counts.total}</span>
            </div>
            <div class="bar-track" style="margin:8px 0;"><div class="bar-fill" style="width:\${pct}%;"></div></div>
            <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Goal</th><th class="col-status">Status</th></tr></thead><tbody>\${goalRows}</tbody></table></div>
            \${ledgerHtml}
          </div>\`;
      }

      let ivHtml = '';
      if (data.interview) {
        const iv = data.interview;
        const ivScope = iv.scope && iv.scope !== '.' ? \` <span class="badge">Scope: \${esc(iv.scope)}</span>\` : '';
        const ambPct = Math.round((iv.currentAmbiguity || 0) * 100);
        const threshPct = Math.round((iv.threshold || 0.2) * 100);
        const dimEntries = Object.entries(iv.dimensions || {});
        const dimsHtml = dimEntries.length ? \`
          <div style="margin-top:8px;display:grid;gap:6px;">
            \${dimEntries.map(([dimKey, rawVal]) => {
              const num = Number(rawVal);
              const pctVal = Number.isFinite(num) ? (num <= 1 ? Math.round(num * 100) : Math.round(num)) : 0;
              return \`
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;"><span class="muted">\${esc(dimKey)}</span><span class="tabular">\${pctVal}%</span></div>
                  <div class="bar-track" style="height:6px;"><div class="bar-fill" style="width:\${Math.max(0, Math.min(100, pctVal))}%;"></div></div>
                </div>\`;
            }).join('')}
          </div>\` : '';
        const roundsList = Array.isArray(iv.rounds) ? iv.rounds : [];
        const roundsHtml = roundsList.length ? \`
          <details class="hud-details" data-hud-key="iv-rounds">
            <summary class="tabular">Interview Rounds (\${roundsList.length})</summary>
            \${roundsList.map((r) => \`
              <div class="health-item">
                <div style="display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;font-size:12px;">
                  <strong>Round \${esc(r.round)}: \${esc(r.target)}</strong>
                  <span class="badge tabular">\${esc(r.label)}\${r.ambiguity !== null ? ' &middot; ' + Math.round(r.ambiguity * 100) + '%' : ''}</span>
                </div>
                \${r.question ? \`<div class="muted" style="font-size:12px;margin-top:3px;">Q: \${esc(r.question)}</div>\` : ''}
                \${r.answer ? \`<div style="font-size:12px;margin-top:2px;">A: \${esc(r.answer)}</div>\` : ''}
              </div>\`).join('')}
          </details>\` : '';
        const specBtn = iv.specFile
          ? \`<button type="button" class="action-btn action-btn-primary" data-file="\${esc(iv.specFile)}" onclick="openMarkdownDrawer(this.dataset.file, 'Deep Interview Spec', 'spec')">Open Spec</button>\`
          : '';
        ivHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
              <div style="font-weight:600;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;">Deep Interview: <code>\${esc(iv.slug || 'session')}</code>\${ivScope}</div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <span class="badge tabular">\${esc(iv.profile)} (\${ambPct}% ambiguity &le; \${threshPct}%)</span>
                \${specBtn}
              </div>
            </div>
            <div class="bar-track" style="margin-top:8px;"><div class="bar-fill" style="width:\${Math.max(0, Math.min(100, 100 - ambPct))}%;"></div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
              <span class="badge">Non-goals: \${iv.readinessGates?.nonGoals ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Decision Boundaries: \${iv.readinessGates?.decisionBoundaries ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Pressure Pass: \${iv.readinessGates?.pressurePass ? 'PASS' : 'PENDING'}</span>
              <span class="badge">Closure Audit: \${iv.readinessGates?.closureAudit ? 'PASS' : 'PENDING'}</span>
            </div>
            \${dimsHtml}
            \${roundsHtml}
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
      const hpList = data.reviews?.hyperplan || [];
      const crList = data.reviews?.codeReviews || [];
      const resList = data.research || [];
      const art = data.artifacts || { plans: [], specs: [], handoffs: [], ideas: [], asks: [] };
      const artGroups = [
        ...(art.plans || []).map((x) => ({ ...x, kind: 'plan' })),
        ...(art.specs || []).map((x) => ({ ...x, kind: 'spec' })),
        ...(art.handoffs || []).map((x) => ({ ...x, kind: 'handoff' })),
        ...(art.ideas || []).map((x) => ({ ...x, kind: 'idea' })),
        ...(art.asks || []).map((x) => ({ ...x, kind: 'ask' })),
      ];

      let revResHtml = '';
      if (rp || hpList.length || crList.length || resList.length || artGroups.length) {
        const rpLine = rp ? \`<div style="margin-bottom:6px;"><span class="badge tabular">Ralplan Iter \${esc(rp.iteration)}</span> Architect: <strong>\${esc(rp.architectVerdict)}</strong> &middot; Critic: <strong>\${esc(rp.criticVerdict)}</strong> &middot; Consensus: <strong>\${rp.consensusComplete ? 'COMPLETE' : 'PENDING'}</strong></div>\` : '';
        const hpRows = hpList.map((h) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div>
              <span class="badge badge-active">Hyperplan</span>
              <span class="badge tabular">SURVIVES: \${h.survives}</span>
              <span class="badge tabular">WEAKENED: \${h.weakened}</span>
              <span class="badge tabular">KILLED: \${h.killed}</span>
            </div>
            <button type="button" class="action-btn" data-file="\${esc(h.file)}" onclick="openMarkdownDrawer(this.dataset.file, 'Hyperplan Distillation', 'hyperplan')">Open Distillation</button>
          </div>\`).join('');
        const crRows = crList.map((c) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div><span class="badge">\${esc(c.recommendation)}</span> <code>\${esc(c.file)}</code> <span class="muted tabular">(Architect: \${esc(c.architectStatus)}, \${c.filesReviewed} files)</span></div>
            <button type="button" class="action-btn" data-file="\${esc(c.file)}" onclick="openMarkdownDrawer(this.dataset.file, 'Code Review Report', 'review')">Preview</button>
          </div>\`).join('');
        const resRows = resList.map((r) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div><span class="badge badge-active tabular">Research \${r.compositeScore !== null ? r.compositeScore + '/100' : ''}</span>\${r.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(r.evalIntegrityVerdict)}</span>\` : ''} <strong>\${esc(r.title)}</strong> <span class="muted tabular">(\${esc(r.lens)} &middot; V:\${r.claims.verified} D:\${r.claims.derived} A:\${r.claims.assumed})</span></div>
            <button type="button" class="action-btn" data-file="\${esc(r.file)}" data-title="\${esc(r.title)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, 'research')">Open Report</button>
          </div>\`).join('');
        const artDrawerHtml = artGroups.length ? \`
          <details class="hud-details" data-hud-key="ov-artifacts">
            <summary class="tabular">Plans, Specs, Handoffs, Ideas &amp; Advisor Artifacts (\${artGroups.length})</summary>
            <div style="display:grid;gap:4px;">
              \${artGroups.map((item) => \`
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 0;border-bottom:1px solid var(--hud-border);">
                  <div style="min-width:0;flex:1 1 160px;">
                    <span class="badge">\${esc(item.kind)}</span>
                    <strong>\${esc(item.title)}</strong>
                    <div class="muted" style="font-size:12px;"><code>\${esc(item.file)}</code></div>
                  </div>
                  <button type="button" class="action-btn" data-file="\${esc(item.file)}" data-title="\${esc(item.title)}" data-kind="\${esc(item.kind)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, this.dataset.kind)">Open</button>
                </div>\`).join('')}
            </div>
          </details>\` : '';
        revResHtml = \`
          <div class="card">
            <div style="font-weight:600;margin-bottom:6px;">Recent Reviews &amp; Deep Research</div>
            \${rpLine}
            \${hpRows}
            \${crRows}
            \${resRows}
            \${artDrawerHtml}
          </div>\`;
      }

      const perfList = data.benchmarks?.performanceGoals || [];
      const autoList = data.benchmarks?.autoresearch || [];
      let benchHtml = '';
      if (perfList.length || autoList.length) {
        const perfRows = perfList.map((p) => {
          const cps = Array.isArray(p.checkpoints) ? p.checkpoints : [];
          const cpDetails = cps.length ? \`
            <details class="hud-details" data-hud-key="perf-\${esc(p.slug)}">
              <summary class="tabular">Checkpoints (\${cps.length})</summary>
              \${cps.map((cp) => \`
                <div class="health-item" style="font-size:12px;">
                  <div style="display:flex;justify-content:space-between;gap:4px;flex-wrap:wrap;">
                    <span class="badge">\${esc(cp.status)}</span>
                    <span class="muted tabular">\${esc(cp.at)}</span>
                  </div>
                  \${cp.patch ? \`<div style="margin-top:3px;">Patch: <code>\${esc(cp.patch)}</code></div>\` : ''}
                  \${cp.evidence ? \`<div class="muted" style="margin-top:2px;">Evidence: \${esc(cp.evidence)}</div>\` : ''}
                </div>\`).join('')}
            </details>\` : '';
          return \`
            <div class="health-item">
              <div><span class="badge \${p.status === 'active' ? 'badge-active' : ''}">Perf: \${esc(p.slug)}</span>\${p.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(p.evalIntegrityVerdict)}</span>\` : ''} <span class="muted tabular">\${esc(p.objective)} (Checkpoints: \${cps.length})</span></div>
              \${cpDetails}
            </div>\`;
        }).join('');
        const autoRows = autoList.map((a) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div><span class="badge \${a.passed ? 'badge-active' : ''}">Autoresearch: \${esc(a.slug)}</span> <span class="badge">\${esc(a.status)}</span>\${a.evalIntegrityVerdict ? \` <span class="badge">Eval: \${esc(a.evalIntegrityVerdict)}</span>\` : ''} <span class="muted tabular">(V:\${a.claims?.verified || 0} D:\${a.claims?.derived || 0} A:\${a.claims?.assumed || 0})</span></div>
            \${a.reportFile ? \`<button type="button" class="action-btn" data-file="\${esc(a.reportFile)}" data-slug="\${esc(a.slug)}" onclick="openMarkdownDrawer(this.dataset.file, 'Autoresearch: ' + this.dataset.slug, 'autoresearch')">Open Report</button>\` : ''}
          </div>\`).join('');
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
        const vrRows = vrList.map((v) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div><span class="badge badge-active">Visual Ralph: \${esc(v.slug)}</span>\${v.verdict ? \` <span class="badge tabular">\${esc(v.verdict.verdict)} (\${esc(v.verdict.score)})</span>\` : ''} <span class="muted tabular">(\${(v.images || []).length} image(s))</span></div>
            <button type="button" class="action-btn action-btn-primary" data-slug="\${esc(v.slug)}" data-scope="\${esc(v.scope || '.')}" onclick="openVisualRalphDrawer(this.dataset.slug, this.dataset.scope)">Compare</button>
          </div>\`).join('');
        const loftRows = loftList.map((l) => \`
          <div class="health-item" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div>
              <span class="badge">Loft (\${esc(l.kind)})</span>
              <strong>\${esc(l.title)}</strong>
              \${(l.variants || []).length ? \`<span class="badge tabular">\${l.variants.length} variant(s)</span>\` : ''}
              <div class="muted" style="font-size:12px;"><code>\${esc(l.relPath)}</code></div>
            </div>
            <button type="button" class="action-btn action-btn-primary" data-slug="\${esc(l.slug)}" data-scope="\${esc(l.scope || '.')}" onclick="openLoftDrawer(this.dataset.slug, this.dataset.scope)">Open Sandbox</button>
          </div>\`).join('');
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
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div style="min-width:0;flex:1 1 180px;">
              <div style="font-weight:600;margin-bottom:2px;">Workspace</div>
              <code>\${esc(data.workspace)}</code>
              \${trackedScopesHtml}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('workflows')">\${counts.workflows} Workflows</button>
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('skills')">\${counts.skills} Skills</button>
              <button type="button" class="badge" style="cursor:pointer;" onclick="setTab('subagents')">\${counts.subagents} Subagents</button>
            </div>
          </div>
          \${quickActionsHtml}
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
      const container = document.getElementById('skills-cards-container');
      if (!container) return;
      if (!filtered.length) {
        container.innerHTML = '<div class="card muted">No skills match the current filter.</div>';
        return;
      }
      container.innerHTML = filtered.map((s) => {
        const activeFlags = new Set(selectedSkillFlags[s.name] || []);
        const flagsHtml = (s.flags || []).map((f) => {
          const pressed = activeFlags.has(f);
          return \`<button type="button" class="chip-btn \${pressed ? 'chip-active' : ''}" aria-pressed="\${pressed ? 'true' : 'false'}" data-skill="\${esc(s.name)}" data-flag="\${esc(f)}" onclick="toggleSkillFlag(this.dataset.skill, this.dataset.flag)" title="Toggle flag on command"><code>\${esc(f)}</code></button>\`;
        }).join(' ');
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
            \${flagsHtml ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;" role="group" aria-label="Skill flags for \${esc(s.name)}">\${flagsHtml}</div>\` : ''}
            <div style="margin-bottom:4px;">\${esc(s.howToUse)}</div>
            <div class="cmd-box">
              <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" />
              <div class="cmd-actions">
                <button type="button" class="action-btn action-btn-primary" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'active-chat')" title="Send into the active chat conversation (or start a new chat if none is active)">Run in Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="runFromInput(this, this.dataset.inputId, 'new-chat')" title="Start a new chat conversation with this skill command">New Chat</button>
                <button type="button" class="action-btn" data-input-id="\${esc(inputId)}" onclick="copyFromInput(this, this.dataset.inputId)" title="Copy command to clipboard">Copy</button>
              </div>
            </div>
          </div>\`;
      }).join('');
    }

    function renderSkills(data) {
      const allSkills = data.catalog?.skills || [];
      const categories = ['All', ...new Set(allSkills.map((s) => s.category))];
      const catBtns = categories.map((c) => \`
        <button type="button" class="tab-btn \${skillCategory === c ? 'active' : ''}" onclick="setSkillCategory('\${esc(c)}')">\${esc(c)}</button>\`).join('');
      document.getElementById('view-skills').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:6px;">Skills Catalog (\${allSkills.length} skills)</div>
          <input type="text" id="skill-search-input" class="search-input" placeholder="Press / to search skills by name, flag, or use case (e.g. deep-research, skill, hud)..." value="\${esc(skillSearch)}" oninput="onSkillSearchInput(this.value)" />
          <div style="display:flex;gap:4px;flex-wrap:wrap;">\${catBtns}</div>
        </div>
        <div id="skills-cards-container"></div>
      \`;
      renderSkillsListOnly(data);
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
      const container = document.getElementById('subagents-cards-container');
      if (!container) return;
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
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <code style="font-weight:600;font-size:13px;">\${esc(a.name)}</code>
            <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
              <span class="badge">\${esc(a.lane)}</span>
              <span class="badge badge-active">Model: \${esc(activeTier)}</span>
            </div>
          </div>
          <div style="margin-bottom:6px;">\${esc(a.whenToUse)}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:4px;" role="group" aria-label="Model tier for \${esc(a.name)}">
            <span class="muted" style="font-size:12px;">Model:</span>\${modelPills}
          </div>
          <div class="cmd-box">
            <input type="text" class="cmd-input" id="\${esc(inputId)}" data-input-key="\${esc(inputKey)}" value="\${esc(val)}" oninput="onPromptEdit(this.dataset.inputKey, this.value)" placeholder="Task for \${esc(a.name)}..." />
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
        <button type="button" class="tab-btn \${subagentLane === l ? 'active' : ''}" onclick="setSubagentLane('\${esc(l)}')">\${esc(l)}</button>\`).join('');
      document.getElementById('view-subagents').innerHTML = \`
        <div class="card">
          <div style="font-weight:600;margin-bottom:4px;">Role Subagents (\${allSubagents.length} specialists)</div>
          <div class="muted" style="margin-bottom:8px;">Work-shape model routing: <code>flash_lite</code> / <code>flash</code> for quick mechanical lookups, <code>inherit</code> for cohesive implementation, and <code>pro</code> for architecture, critique, causal tracing, and security review.</div>
          <input type="text" id="subagent-search-input" class="search-input" placeholder="Press / to search subagents by role, lane, or capability..." value="\${esc(subagentSearch)}" oninput="onSubagentSearchInput(this.value)" />
          <div style="display:flex;gap:4px;flex-wrap:wrap;">\${laneBtns}</div>
        </div>
        <div id="subagents-cards-container"></div>
      \`;
      renderSubagentsListOnly(data);
    }

    function renderWiki(data) {
      const agItems = (data.wiki?.agreements || []).map((a) => \`
        <li style="margin-bottom:6px;\${a.expired ? 'opacity:0.5;text-decoration:line-through;' : ''}">
          <span class="badge">\${esc(a.author)}</span> \${esc(a.text)}
        </li>\`).join('');
      const entries = data.wiki?.entries || [];
      const categories = ['All', ...new Set(entries.map((e) => e.category).filter(Boolean))];
      const catBtns = categories.map((c) => \`
        <button type="button" class="chip-btn \${wikiCategory === c ? 'chip-active' : ''}" aria-pressed="\${wikiCategory === c ? 'true' : 'false'}" onclick="setWikiCategory('\${esc(c)}')">\${esc(c)}</button>\`).join('');
      const q = wikiSearch.trim().toLowerCase();
      const filteredEntries = entries.filter((e) => {
        if (wikiCategory !== 'All' && e.category !== wikiCategory) return false;
        if (!q) return true;
        return e.slug.toLowerCase().includes(q)
          || e.title.toLowerCase().includes(q)
          || e.category.toLowerCase().includes(q)
          || (e.tags || []).some((t) => t.toLowerCase().includes(q))
          || (e.body || '').toLowerCase().includes(q);
      });
      const activeEntry = filteredEntries.find((e) => e.slug === selectedWikiSlug)
        || entries.find((e) => e.slug === selectedWikiSlug && !q && wikiCategory === 'All')
        || filteredEntries[0]
        || null;
      const entryBtns = filteredEntries.map((e) => \`
        <button type="button" class="tab-btn \${activeEntry && activeEntry.slug === e.slug ? 'active' : ''}" onclick="selectWikiSlug('\${esc(e.slug)}')">
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
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <div style="font-weight:600;">Wiki Explorer (\${filteredEntries.length}/\${entries.length} pages)</div>
            \${activeEntry ? \`<code class="muted">omagy_wiki/\${esc(activeEntry.slug)}.md</code>\` : ''}
          </div>
          <input type="text" id="wiki-search-input" class="search-input" placeholder="Press / to search wiki pages by title, [[slug]], tag, or content..." value="\${esc(wikiSearch)}" oninput="onWikiSearchInput(this.value)" />
          \${catBtns ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">\${catBtns}</div>\` : ''}
          \${entryBtns ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">\${entryBtns}</div>\` : '<div class="muted">No wiki pages match the current filter.</div>'}
          \${activeEntry ? \`
            <div style="border-top:1px solid var(--hud-border);padding-top:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <div style="font-weight:600;font-size:14px;">\${esc(activeEntry.title)}</div>
                <span class="badge">\${esc(activeEntry.category)}</span>
              </div>
              \${activeEntry.tags?.length ? \`<div class="muted" style="margin:4px 0;font-size:12px;">Tags: \${activeEntry.tags.map((t) => \`<code>\${esc(t)}</code>\`).join(' ')}</div>\` : ''}
              <div class="wiki-markdown-body" style="margin-top:8px;">\${renderSafeMarkdown(activeEntry.body || '')}</div>
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
      renderOverview(data);
      if (!isEditingInContainer('view-workflows')) renderWorkflows(data);
      if (!isEditingInContainer('view-skills')) renderSkills(data);
      if (!isEditingInContainer('view-subagents')) renderSubagents(data);
      if (!isEditingInContainer('view-wiki')) renderWiki(data);
    }

    connectEventStream();
    loadSnapshot(true);
    setInterval(loadSnapshot, 15000);
  </script>
</body>
</html>`;
}

export const HUD_HTML = renderHudHtml();
