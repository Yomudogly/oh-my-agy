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

  let bodySrc = String(md ?? '').replace(/\r\n/g, '\n');
  if (!bodySrc.trim()) return '<p class="md-p muted">Empty document.</p>';

  let frontmatterHtml = '';
  const fmMatch = /^---\n([\s\S]*?)\n---(?:\n+|$)/.exec(bodySrc);
  if (fmMatch) {
    const fmLines = fmMatch[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const looksLikeYaml = fmLines.length > 0 && fmLines.every((l) => /^[a-zA-Z0-9_-]+\s*:/.test(l) || /^-\s+/.test(l));
    if (looksLikeYaml) {
      const pairs = [];
      for (const fl of fmLines) {
        const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(fl);
        if (kv && kv[2].trim()) {
          const cleanVal = kv[2].trim().replace(/^['"]|['"]$/g, '');
          pairs.push(`<span class="md-fm-chip"><span class="md-fm-key">${escHtml(kv[1])}</span><span class="md-fm-val">${escHtml(cleanVal)}</span></span>`);
        }
      }
      if (pairs.length) {
        frontmatterHtml = `<div class="md-frontmatter">${pairs.join('')}</div>`;
      }
      bodySrc = bodySrc.slice(fmMatch[0].length);
    }
  }

  const codeBlocks = [];
  const withCodePlaceholders = bodySrc.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const langText = lang ? escHtml(lang) : 'code';
    const langBar = `<div class="md-code-lang"><span>${langText}</span><button type="button" class="md-copy-btn" onclick="copyMdCodeBlock(this)">Copy</button></div>`;
    codeBlocks.push(`<div class="md-code-wrap">${langBar}<pre class="md-pre"><code>${escHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
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
      return `<button type="button" class="wiki-link-pill" data-wiki-slug="${slug}" onclick="navigateToWikiSlug(this.dataset.wikiSlug)">[[${display}]]</button>`;
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
  const protectTablePipes = (rawRow) => {
    const codeSpans = [];
    const withCode = String(rawRow || '').replace(/`([^`\n]+)`/g, (_m, inner) => {
      const idx = codeSpans.length;
      codeSpans.push('`' + inner.replace(/\\\|/g, '|') + '`');
      return `\u0000TCODE_${idx}\u0000`;
    });
    return {
      protectedRow: withCode.replace(/\\\|/g, '\u0000ESCPIPE\u0000'),
      restoreCell: (cell) => cell
        .replace(/\u0000ESCPIPE\u0000/g, '|')
        .replace(/\u0000TCODE_(\d+)\u0000/g, (_m, idx) => codeSpans[Number(idx)] || ''),
    };
  };
  const splitTableRow = (line) => {
    const { protectedRow, restoreCell } = protectTablePipes(line);
    return protectedRow
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => formatInline(restoreCell(c).trim()));
  };

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

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1].length);
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
        const rawL = lines[i];
        const indentMatch = /^( +|\t+)/.exec(rawL);
        const indentCols = indentMatch ? indentMatch[1].replace(/\t/g, '  ').length : 0;
        const subCls = indentCols >= 2 ? ' class="md-subitem"' : '';
        items.push(`<li${subCls}>${formatInline(rawL.trim().replace(/^[-*+]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul class="md-list">${items.join('')}</ul>`);
      continue;
    }

    const olStartMatch = /^(\d+)\.\s+/.exec(trimmed);
    if (olStartMatch) {
      const startNum = Number(olStartMatch[1]) || 1;
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${formatInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      const startAttr = startNum > 1 ? ` start="${startNum}"` : '';
      out.push(`<ol class="md-list"${startAttr}>${items.join('')}</ol>`);
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length
      && lines[i].trim()
      && !/^\u0000CODEBLOCK_/.test(lines[i].trim())
      && !/^(#{1,6})\s+/.test(lines[i].trim())
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

  if (frontmatterHtml) out.unshift(frontmatterHtml);
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
  const safeInlineCss = (css) => String(css || '').replace(/<\/style/gi, '<\\/style');
  const extractHtmlAttr = (attrs, attrName) => {
    const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i');
    const m = re.exec(String(attrs || ''));
    if (!m) return null;
    return (m[1] ?? m[2] ?? m[3] ?? '').trim();
  };
  const isExternalOrBlockedUrl = (u) => /^(?:https?:\/\/|\/\/|javascript:|vbscript:)/i.test(String(u || '').trim());

  let html = String(rawHtml || '');

  // Strip self-closing external <script src=... /> tags
  html = html.replace(/<script\b([^>]*?)\/>/gi, (full, attrs) => {
    const srcVal = extractHtmlAttr(attrs, 'src');
    return srcVal !== null && isExternalOrBlockedUrl(srcVal) ? '<!-- stripped external script -->' : full;
  });

  // Strip external <link href=...> and inline local <link rel="stylesheet" href="./...">
  html = html.replace(/<link\b([^>]*?)>/gi, (full, attrs) => {
    const hrefVal = extractHtmlAttr(attrs, 'href');
    if (hrefVal !== null && isExternalOrBlockedUrl(hrefVal)) {
      return '<!-- stripped external link -->';
    }
    const relVal = extractHtmlAttr(attrs, 'rel') || '';
    if (!/\bstylesheet\b/i.test(relVal) || !hrefVal) return full;
    const key = normAssetKey(entryDir, hrefVal);
    if (!key || !Object.prototype.hasOwnProperty.call(assetMap, key)) return full;
    return `<style data-inlined-asset="${key}">\n${safeInlineCss(assetMap[key])}\n</style>`;
  });

  // Strip external <script src=...>, inline local <script src="./...">, and bundle relative ES module imports [W-1]
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (full, attrs, inlineBody) => {
    const typeVal = extractHtmlAttr(attrs, 'type') || '';
    const isModule = /^module$/i.test(typeVal);
    const srcVal = extractHtmlAttr(attrs, 'src');
    if (srcVal !== null) {
      if (isExternalOrBlockedUrl(srcVal)) return '<!-- stripped external script -->';
      const key = normAssetKey(entryDir, srcVal);
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
    ? `<style id="omagy-hud-theme-vars">:root { ${safeInlineCss(cssVarsText)} }</style>`
    : '';
  const injectedHead = `${cspMeta}\n${themeStyle}`;

  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${injectedHead}`);
  } else {
    html = `<!DOCTYPE html><html><head>${injectedHead}</head><body>${html}</body></html>`;
  }
  return html;
}

export function formatWorkspaceName(ws) {
  const clean = String(ws || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  if (!clean) return 'workspace';
  const parts = clean.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

export function formatScopeLabel(scope) {
  const clean = String(scope || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  if (!clean || clean === '.') return 'workspace';
  const parts = clean.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

export function formatShortTime(ts) {
  const raw = String(ts || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  return m ? `${m[1]} ${m[2]}` : raw;
}

export function formatShortRelPath(rel) {
  return String(rel || '').replace(/^(?:[^/]+\/)?\.omagy\//, '');
}

export function selectCurrentMode(modes) {
  const list = Array.isArray(modes) ? [...modes] : [];
  if (!list.length) return { current: null, lastCompleted: null };
  const byUpdatedDesc = (a, b) => (Number(b.updatedMs) || 0) - (Number(a.updatedMs) || 0);
  const liveModes = list.filter((m) => m.active && !m.stale).sort(byUpdatedDesc);
  if (liveModes.length) {
    const topAuto = liveModes.find((m) => m.mode === 'autopilot');
    return { current: topAuto || liveModes[0], lastCompleted: null };
  }
  const staleActive = list.filter((m) => m.active).sort(byUpdatedDesc);
  if (staleActive.length) {
    const topAuto = staleActive.find((m) => m.mode === 'autopilot');
    return { current: topAuto || staleActive[0], lastCompleted: null };
  }
  const finished = list.sort(byUpdatedDesc);
  return { current: null, lastCompleted: finished[0] || null };
}

export function formatAgreementCard(a, idx) {
  const escHtml = (val) => String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  let rest = String(a?.text || '').replace(/^-\s*/, '').trim();
  let verId = '';
  const verMatch = /^\[(v\d+)\]\s*/i.exec(rest);
  if (verMatch) {
    verId = verMatch[1];
    rest = rest.slice(verMatch[0].length).trim();
  }
  rest = rest.replace(/^(?:\[by:\s*(?:human|agent)\]|\(by:\s*(?:human|agent)\))\s*/i, '').trim();
  let expiresLabel = '';
  rest = rest.replace(/(?:\[|\()\s*expires\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[^\])\s]+)?)\s*(?:\]|\))/i, (_m, expDate) => {
    expiresLabel = expDate;
    return '';
  }).trim();
  let dateStr = '';
  const dateMatch = /\s+(?:\u2014|--)\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:T\S+)?)\s*$/.exec(rest);
  if (dateMatch) {
    dateStr = dateMatch[1];
    rest = rest.slice(0, dateMatch.index).trim();
  }
  const inlineTokens = [];
  const tokenized = rest.replace(/`([^`\n]+)`/g, (_m, codeInner) => {
    const tIdx = inlineTokens.length;
    inlineTokens.push(`<code class="md-inline-code">${escHtml(codeInner)}</code>`);
    return `\u0000AGCODE_${tIdx}\u0000`;
  });
  const formattedBody = escHtml(tokenized).replace(/\u0000AGCODE_(\d+)\u0000/g, (_m, n) => inlineTokens[Number(n)] || '');
  const authorCls = a?.author === 'human' ? 'badge badge-active' : 'badge';
  return `<div class="agreement-box"${a?.expired ? ' style="opacity:0.6;"' : ''}>`
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'
    + '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">'
    + `<code class="badge">${escHtml(verId || `#${idx + 1}`)}</code>`
    + `<span class="${authorCls}">${escHtml(a?.author || 'agent')}</span>`
    + (a?.expired ? '<span class="badge badge-danger">expired</span>' : (expiresLabel ? `<span class="badge tabular">expires ${escHtml(expiresLabel)}</span>` : ''))
    + '</div>'
    + (dateStr ? `<span class="muted tabular" style="font-size:12px;">${escHtml(dateStr)}</span>` : '')
    + '</div>'
    + `<div class="agreement-body"${a?.expired ? ' style="text-decoration:line-through;"' : ''}>${formattedBody}</div>`
    + '</div>';
}

export function parseWorkflowStageLabel(rawStage) {
  const text = String(rawStage || '').trim();
  const parenMatch = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(text);
  if (!parenMatch) return { title: text, sub: '' };
  return {
    title: parenMatch[1].trim(),
    sub: parenMatch[2].trim().replace(/\s*->\s*/g, ' \u00b7 '),
  };
}

export function resolveWorkflowStageState(stages = [], currentPhase = '', active = false) {
  const list = Array.isArray(stages) ? stages.map((s) => String(s || '')) : [];
  if (!list.length) return { activeIndex: -1, states: [], arrowStates: [] };
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  const phase = norm(currentPhase);
  if (!active || !phase) {
    return {
      activeIndex: -1,
      states: list.map(() => 'idle'),
      arrowStates: list.slice(0, -1).map(() => 'idle'),
    };
  }
  const normStages = list.map((s) => norm(s.replace(/^\$/, '')));
  let activeIndex = normStages.findIndex((st) => {
    if (!st) return false;
    if (st.includes(phase)) return true;
    const headTok = st.replace(/^[^a-z0-9]+/, '').split(/[^a-z0-9-]+/)[0] || '';
    return headTok.length >= 3 && phase.includes(headTok);
  });
  if (activeIndex < 0) {
    const synonymGroups = [
      { re: /(?:interview|clarif|preflight|context|scope|lens)/, target: /(?:interview|preflight|context|lens|assemble|explore|decompose|dag)/, fallback: 0 },
      { re: /(?:plan|ralplan|prd|architect|hyperplan|matrix|brief)/, target: /(?:ralplan|planner|prd|architect|matrix|brief|wave)/, fallback: Math.min(1, list.length - 1) },
      { re: /(?:critic)/, target: /(?:critic|ralplan)/, fallback: Math.min(2, list.length - 1) },
      { re: /(?:ultragoal|exec|implement|work|wave|harvest|synth|qa)/, target: /(?:ultragoal|execute|evidence|harvest|synth|qa)/, fallback: Math.min(2, list.length - 1) },
      { re: /(?:review|verif|audit|verdict|merge|report|ship)/, target: /(?:review|verify|audit|verdict|merge|report)/, fallback: list.length - 1 },
    ];
    for (const grp of synonymGroups) {
      if (grp.re.test(phase)) {
        const hit = normStages.findIndex((st) => grp.target.test(st));
        activeIndex = hit >= 0 ? hit : grp.fallback;
        break;
      }
    }
  }
  if (activeIndex < 0) activeIndex = 0;
  const states = list.map((_s, idx) => (idx < activeIndex ? 'done' : (idx === activeIndex ? 'current' : 'upcoming')));
  const arrowStates = list.slice(0, -1).map((_s, idx) => {
    if (activeIndex === list.length - 1 && list.length > 1) {
      return idx < activeIndex - 1 ? 'done' : 'active';
    }
    if (idx < activeIndex) return 'done';
    if (idx === activeIndex) return 'active';
    return 'upcoming';
  });
  return { activeIndex, states, arrowStates };
}

export function buildWikiMindMapGraph(entries = [], filterCategory = 'All') {
  const rawList = Array.isArray(entries) ? entries : [];
  const bySlug = new Map();
  for (const item of rawList) {
    const slug = String(item?.slug || '').trim();
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      title: String(item?.title || slug),
      category: String(item?.category || 'uncategorized'),
      tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
      expired: Boolean(item?.expired),
      rawLinks: Array.isArray(item?.links) ? item.links.map((l) => String(l || '').trim()).filter(Boolean) : [],
    });
  }
  const slugs = [...bySlug.keys()];
  const n = slugs.length;
  if (!n) return { nodes: [], edges: [] };

  const idxBySlug = new Map(slugs.map((s, i) => [s, i]));
  const directedSet = new Set();
  for (const [src, item] of bySlug.entries()) {
    for (const dst of item.rawLinks) {
      if (dst !== src && bySlug.has(dst)) {
        directedSet.add(`${src}\u0000${dst}`);
      }
    }
  }

  const pairMap = new Map();
  const degree = new Array(n).fill(0);
  for (const key of directedSet) {
    const [src, dst] = key.split('\u0000');
    const a = src < dst ? src : dst;
    const b = src < dst ? dst : src;
    const pairKey = `${a}\u0000${b}`;
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        source: src,
        target: dst,
        sourceIndex: idxBySlug.get(src),
        targetIndex: idxBySlug.get(dst),
        bidirectional: directedSet.has(`${dst}\u0000${src}`),
      });
      degree[idxBySlug.get(src)] += 1;
      degree[idxBySlug.get(dst)] += 1;
    }
  }
  const edges = [...pairMap.values()];

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const cats = [...new Set(slugs.map((s) => bySlug.get(s).category))];
  const pos = slugs.map((s, i) => {
    if (n === 1) return { x: 0, y: 0, z: -0.6 };
    const catIdx = Math.max(0, cats.indexOf(bySlug.get(s).category));
    const t = (i + 0.5) / n;
    const y = 1 - 2 * t;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i + (catIdx * 0.65);
    return {
      x: Math.cos(theta) * r,
      y: y * 0.86,
      z: Math.sin(theta) * r,
    };
  });

  if (n > 1) {
    const maxDeg = Math.max(1, ...degree);
    for (let iter = 0; iter < 36; iter += 1) {
      const fx = new Array(n).fill(0);
      const fy = new Array(n).fill(0);
      const fz = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          let dx = pos[i].x - pos[j].x;
          let dy = pos[i].y - pos[j].y;
          let dz = pos[i].z - pos[j].z;
          const distSq = dx * dx + dy * dy + dz * dz + 0.04;
          const dist = Math.sqrt(distSq);
          const rep = 0.085 / distSq;
          dx = (dx / dist) * rep;
          dy = (dy / dist) * rep;
          dz = (dz / dist) * rep;
          fx[i] += dx; fy[i] += dy; fz[i] += dz;
          fx[j] -= dx; fy[j] -= dy; fz[j] -= dz;
        }
      }
      for (const e of edges) {
        const i = e.sourceIndex;
        const j = e.targetIndex;
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dz = pos[j].z - pos[i].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
        const pull = (dist - 0.92) * 0.075;
        const px = (dx / dist) * pull;
        const py = (dy / dist) * pull;
        const pz = (dz / dist) * pull;
        fx[i] += px; fy[i] += py; fz[i] += pz;
        fx[j] -= px; fy[j] -= py; fz[j] -= pz;
      }
      for (let i = 0; i < n; i += 1) {
        pos[i].x += Math.max(-0.18, Math.min(0.18, fx[i]));
        pos[i].y += Math.max(-0.18, Math.min(0.18, fy[i]));
        pos[i].z += Math.max(-0.18, Math.min(0.18, fz[i]));
        const rad = Math.sqrt(pos[i].x * pos[i].x + pos[i].y * pos[i].y + pos[i].z * pos[i].z) || 1;
        const targetRad = 0.78 + (1 - (degree[i] / maxDeg) * 0.22) * 0.24;
        const blend = rad + (targetRad - rad) * 0.35;
        const scale = blend / rad;
        pos[i].x *= scale;
        pos[i].y *= scale;
        pos[i].z *= scale;
      }
    }
  }

  const catFilter = String(filterCategory || 'All');
  const nodes = slugs.map((slug, idx) => {
    const info = bySlug.get(slug);
    return {
      slug,
      title: info.title,
      category: info.category,
      tags: info.tags,
      expired: info.expired,
      degree: degree[idx],
      inFilter: catFilter === 'All' || info.category === catFilter,
      x: Number(pos[idx].x.toFixed(4)),
      y: Number(pos[idx].y.toFixed(4)),
      z: Number(pos[idx].z.toFixed(4)),
    };
  });

  return { nodes, edges };
}

export function projectMindMapPoint(pt, yaw = 0, pitch = 0, zoom = 1, width = 420, height = 280) {
  const x = Number(pt?.x) || 0;
  const y = Number(pt?.y) || 0;
  const z = Number(pt?.z) || 0;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const y2 = y * cosP - z1 * sinP;
  const z2 = y * sinP + z1 * cosP;
  const camDist = 3.15;
  const safeZoom = Math.max(0.55, Math.min(2.2, Number(zoom) || 1));
  const baseSpan = Math.min(Math.max(180, width), Math.max(180, height)) * 0.92;
  const persp = safeZoom / Math.max(0.75, camDist + z2);
  return {
    sx: (width * 0.5) + (x1 * baseSpan * persp),
    sy: (height * 0.5) + (y2 * baseSpan * persp),
    z: z2,
    persp,
  };
}

export function highlightMatch(rawText, rawQuery) {
  const escHtml = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const str = String(rawText ?? '');
  const q = String(rawQuery || '').trim();
  if (!q) return escHtml(str);
  const escapedRe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escapedRe})`, 'gi');
  return str.split(re).map((part, idx) => (
    idx % 2 === 1 ? `<mark class="hud-mark">${escHtml(part)}</mark>` : escHtml(part)
  )).join('');
}

export function renderHudHtml() {
  const sharedHelpersSource = [
    buildSkillCommandWithFlags.toString(),
    buildSubagentInvokeSnippet.toString(),
    renderSafeMarkdown.toString(),
    prepareLoftSrcdoc.toString(),
    formatWorkspaceName.toString(),
    formatScopeLabel.toString(),
    formatShortTime.toString(),
    formatShortRelPath.toString(),
    selectCurrentMode.toString(),
    formatAgreementCard.toString(),
    parseWorkflowStageLabel.toString(),
    resolveWorkflowStageState.toString(),
    buildWikiMindMapGraph.toString(),
    projectMindMapPoint.toString(),
    highlightMatch.toString(),
  ].join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Oh My Agy</title>
  <style>
    /* hallmark: developer-workbench | system-sans + ui-monospace | concentric-surfaces | critique: h:9 r:9 c:9 t:8 d:9 */
    :root {
      color-scheme: dark light;
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
      --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
      --dur-press: 100ms;
      --dur-micro: 120ms;
      --dur-short: 220ms;
      --dur-long: 420ms;
      --hud-ease: var(--ease-out);
      --z-backdrop: 90;
      --z-drawer: 100;
      --hud-bg: var(--background, #0d1017);
      --hud-content: var(--content, #131822);
      --hud-card: var(--card, #161b26);
      --hud-sidebar: var(--sidebar, #10141d);
      --hud-border: var(--border, rgba(148, 163, 184, 0.18));
      --hud-fg: var(--foreground, #e5e7eb);
      --hud-muted: var(--muted-foreground, #94a3b8);
      --hud-primary: var(--primary, #3b82f6);
      --hud-primary-fg: var(--primary-foreground, #ffffff);
      --hud-border-strong: rgba(148, 163, 184, 0.34);
      --hud-surface-subtle: rgba(255, 255, 255, 0.045);
      --hud-surface-hover: rgba(255, 255, 255, 0.085);
      --hud-surface-active: rgba(255, 255, 255, 0.12);
      --hud-input-bg: rgba(0, 0, 0, 0.22);
      --hud-primary-tint: rgba(59, 130, 246, 0.14);
      --hud-primary-tint-strong: rgba(59, 130, 246, 0.20);
      --hud-primary-tint-hover: rgba(59, 130, 246, 0.28);
      --hud-primary-border: rgba(96, 165, 250, 0.45);
      --hud-primary-ink: #93c5fd;
      --hud-ok: #10b981;
      --hud-ok-fg: #ffffff;
      --hud-ok-tint: rgba(16, 185, 129, 0.14);
      --hud-ok-border: rgba(16, 185, 129, 0.42);
      --hud-ok-ink: #6ee7b7;
      --hud-warn: #f59e0b;
      --hud-danger: #ef4444;
      --hud-danger-tint: rgba(239, 68, 68, 0.13);
      --hud-danger-border: rgba(239, 68, 68, 0.44);
      --hud-danger-ink: #fca5a5;
      --hud-scrim: rgba(4, 7, 13, 0.54);
      --hud-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.22);
      --hud-shadow-drawer: -12px 0 32px rgba(0, 0, 0, 0.42);
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
        --hud-primary-fg: var(--primary-foreground, #ffffff);
        --hud-border-strong: rgba(15, 23, 42, 0.26);
        --hud-surface-subtle: rgba(15, 23, 42, 0.04);
        --hud-surface-hover: rgba(15, 23, 42, 0.075);
        --hud-surface-active: rgba(15, 23, 42, 0.11);
        --hud-input-bg: rgba(15, 23, 42, 0.035);
        --hud-primary-tint: rgba(37, 99, 235, 0.12);
        --hud-primary-tint-strong: rgba(37, 99, 235, 0.17);
        --hud-primary-tint-hover: rgba(37, 99, 235, 0.24);
        --hud-primary-border: rgba(37, 99, 235, 0.40);
        --hud-primary-ink: #1d4ed8;
        --hud-ok: #059669;
        --hud-ok-fg: #ffffff;
        --hud-ok-tint: rgba(5, 150, 105, 0.12);
        --hud-ok-border: rgba(5, 150, 105, 0.38);
        --hud-ok-ink: #047857;
        --hud-warn: #d97706;
        --hud-danger: #dc2626;
        --hud-danger-tint: rgba(220, 38, 38, 0.11);
        --hud-danger-border: rgba(220, 38, 38, 0.38);
        --hud-danger-ink: #b91c1c;
        --hud-scrim: rgba(15, 23, 42, 0.36);
        --hud-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
        --hud-shadow-drawer: -10px 0 28px rgba(15, 23, 42, 0.16);
      }
    }
    html.light {
      --hud-bg: var(--background, #f8fafc);
      --hud-content: var(--content, #ffffff);
      --hud-card: var(--card, #ffffff);
      --hud-sidebar: var(--sidebar, #f1f5f9);
      --hud-border: var(--border, rgba(15, 23, 42, 0.14));
      --hud-fg: var(--foreground, #0f172a);
      --hud-muted: var(--muted-foreground, #475569);
      --hud-primary: var(--primary, #2563eb);
      --hud-primary-fg: var(--primary-foreground, #ffffff);
      --hud-ok: #059669;
      --hud-ok-fg: #ffffff;
      --hud-warn: #d97706;
      --hud-danger: #dc2626;
      --hud-scrim: rgba(15, 23, 42, 0.36);
      --hud-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
      --hud-shadow-drawer: -10px 0 28px rgba(15, 23, 42, 0.16);
    }
    @supports (color: color-mix(in srgb, #000, #fff)) {
      :root,
      html.light {
        --hud-border-strong: color-mix(in srgb, var(--hud-fg) 22%, var(--hud-border));
        --hud-surface-subtle: color-mix(in srgb, var(--hud-fg) 5.5%, transparent);
        --hud-surface-hover: color-mix(in srgb, var(--hud-fg) 10%, transparent);
        --hud-surface-active: color-mix(in srgb, var(--hud-fg) 13%, transparent);
        --hud-input-bg: color-mix(in srgb, var(--hud-bg) 68%, var(--hud-card));
        --hud-primary-tint: color-mix(in srgb, var(--hud-primary) 14%, transparent);
        --hud-primary-tint-strong: color-mix(in srgb, var(--hud-primary) 20%, transparent);
        --hud-primary-tint-hover: color-mix(in srgb, var(--hud-primary) 28%, transparent);
        --hud-primary-border: color-mix(in srgb, var(--hud-primary) 45%, var(--hud-border));
        --hud-primary-ink: color-mix(in srgb, var(--hud-primary) 48%, var(--hud-fg));
        --hud-ok-tint: color-mix(in srgb, var(--hud-ok) 14%, transparent);
        --hud-ok-border: color-mix(in srgb, var(--hud-ok) 44%, var(--hud-border));
        --hud-ok-ink: color-mix(in srgb, var(--hud-ok) 50%, var(--hud-fg));
        --hud-danger-tint: color-mix(in srgb, var(--hud-danger) 13%, transparent);
        --hud-danger-border: color-mix(in srgb, var(--hud-danger) 44%, var(--hud-border));
        --hud-danger-ink: color-mix(in srgb, var(--hud-danger) 52%, var(--hud-fg));
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { overflow-x: clip; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--hud-bg);
      color: var(--hud-fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      overflow-x: hidden;
      overflow-x: clip;
      -webkit-font-smoothing: antialiased;
    }
    button,
    input,
    select,
    textarea {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      color: inherit;
      margin: 0;
    }
    button {
      appearance: none;
      -webkit-appearance: none;
      background: none;
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
      border-radius: 12px;
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
      line-height: 1.35;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      vertical-align: middle;
      max-width: 100%;
      flex-shrink: 0;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
      transition: background var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    button.badge:hover {
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    button.badge:active:not(:disabled) {
      transform: translateY(1px) scale(0.985);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }
    .badge-active {
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint);
      color: var(--hud-primary-ink);
    }
    .badge-live {
      border-color: var(--hud-ok-border);
      background: var(--hud-ok-tint);
      color: var(--hud-ok-ink);
    }
    #sse-status-pill.badge-live::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: var(--hud-ok);
      flex-shrink: 0;
      animation: hudLiveDot 2.4s var(--ease-in-out) infinite;
    }
    .badge-danger {
      border-color: var(--hud-danger-border);
      background: var(--hud-danger-tint);
      color: var(--hud-danger-ink);
    }
    .tab-bar {
      position: relative;
      isolation: isolate;
      display: flex;
      gap: 3px;
      flex-wrap: wrap;
      padding: 3px;
      margin-bottom: 12px;
      border-radius: 9px;
      background: var(--hud-sidebar);
      border: 1px solid var(--hud-border);
    }
    .tab-pill-indicator {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 0;
      pointer-events: none;
      border-radius: 6px;
      background: var(--hud-card);
      border: 1px solid var(--hud-border-strong);
      box-shadow: var(--hud-shadow-sm);
      opacity: 0;
      transform: translate3d(0, 0, 0);
      transition:
        transform var(--dur-short) var(--ease-out),
        width var(--dur-short) var(--ease-out),
        height var(--dur-short) var(--ease-out),
        opacity var(--dur-micro) var(--ease-out);
      will-change: transform, width, height;
    }
    .card .tab-pill-indicator,
    .wiki-mode-switch .tab-pill-indicator {
      background: var(--hud-surface-active);
      box-shadow: none;
    }
    .has-sliding-pill > .tab-pill-indicator {
      opacity: 1;
    }
    .tab-btn {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      white-space: nowrap;
      cursor: pointer;
      border: 1px solid transparent;
      background: transparent;
      color: var(--hud-muted);
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .tab-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-subtle);
    }
    .tab-btn.active {
      background: var(--hud-card);
      color: var(--hud-fg);
      border-color: var(--hud-border-strong);
      font-weight: 600;
      box-shadow: var(--hud-shadow-sm);
    }
    .card .tab-btn.active {
      background: var(--hud-surface-active);
      border-color: var(--hud-border-strong);
      box-shadow: none;
    }
    .has-sliding-pill > .tab-btn.active,
    .card .has-sliding-pill > .tab-btn.active,
    .has-sliding-pill > .wiki-mode-btn.active {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
    }
    .view-pane.pane-enter {
      animation: hudPaneEnter 165ms var(--ease-out);
    }
    .filter-swap {
      animation: hudFilterSwap 145ms var(--ease-out);
    }
    .hud-mark {
      background: var(--hud-primary-tint-strong);
      color: inherit;
      border-radius: 3px;
      padding: 0 2px;
    }
    .chip-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex-shrink: 0;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-muted);
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .chip-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .chip-btn.chip-active,
    .chip-btn[aria-pressed="true"] {
      color: var(--hud-primary-ink);
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint-strong);
      font-weight: 600;
    }
    .chip-btn.chip-active:hover,
    .chip-btn[aria-pressed="true"]:hover {
      background: var(--hud-primary-tint-hover);
      border-color: var(--hud-primary);
    }
    .chip-btn code,
    .badge code {
      color: inherit;
      font-size: 12px;
      line-height: inherit;
      white-space: nowrap;
      word-break: normal;
      overflow-wrap: normal;
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
      transition: border-color var(--dur-micro) var(--ease-out), background var(--dur-micro) var(--ease-out);
    }
    .search-input:hover {
      border-color: var(--hud-border-strong);
    }
    .bar-track {
      width: 100%;
      height: 8px;
      background: var(--hud-surface-hover);
      border-radius: 9999px;
      overflow: hidden;
    }
    .bar-fill {
      width: 100%;
      height: 100%;
      background: var(--hud-primary);
      border-radius: 9999px;
      transform-origin: left center;
      transform: scaleX(var(--bar-scale, 0));
      transition: transform var(--dur-short) var(--ease-out);
      will-change: transform;
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
      transition: border-color var(--dur-micro) var(--ease-out), background var(--dur-micro) var(--ease-out);
    }
    .cmd-input:hover {
      border-color: var(--hud-border-strong);
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
      justify-content: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      text-decoration: none;
      white-space: nowrap;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .action-btn:hover {
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .action-btn:active:not(:disabled),
    .chip-btn:active:not(:disabled),
    .tab-btn:active:not(:disabled),
    .wiki-mode-btn:active:not(:disabled) {
      transform: translateY(1px) scale(0.985);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }
    .action-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      transform: none;
    }
    .action-btn[data-btn-state="ok"],
    .md-copy-btn[data-btn-state="ok"] {
      border-color: var(--hud-ok-border);
      background: var(--hud-ok-tint);
      color: var(--hud-ok-ink);
    }
    .action-btn[data-btn-state="err"] {
      border-color: var(--hud-danger-border);
      background: var(--hud-danger-tint);
      color: var(--hud-danger-ink);
    }
    .btn-check-svg {
      flex-shrink: 0;
      overflow: visible;
    }
    .btn-check-path {
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 16;
      stroke-dashoffset: 16;
      animation: hudCheckDraw 180ms var(--ease-out) forwards;
    }
    .btn-spin-ring {
      width: 11px;
      height: 11px;
      border-radius: 9999px;
      border: 1.6px solid currentColor;
      border-right-color: transparent;
      flex-shrink: 0;
      animation: hudSpin 620ms linear infinite;
    }
    .refresh-icon {
      flex-shrink: 0;
    }
    #refresh-btn.is-spinning .refresh-icon {
      animation: hudSpin var(--dur-long) var(--ease-out);
    }
    .action-btn-primary {
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint-strong);
      color: var(--hud-primary-ink);
      font-weight: 600;
    }
    .action-btn-primary:hover {
      background: var(--hud-primary-tint-hover);
      border-color: var(--hud-primary);
      color: var(--hud-primary-ink);
    }
    .action-btn-danger {
      border-color: var(--hud-danger-border);
      color: var(--hud-danger-ink);
      background: var(--hud-danger-tint);
    }
    .action-btn-danger:hover {
      border-color: var(--hud-danger);
      color: var(--hud-danger-ink);
    }
    /* Workflow Pipeline & Animated Transition Arrows */
    .wf-pipeline {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 2px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: var(--hud-border-strong) transparent;
      padding: 9px 10px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
      white-space: nowrap;
    }
    .wf-pipeline::-webkit-scrollbar {
      height: 5px;
    }
    .wf-pipeline::-webkit-scrollbar-track {
      background: transparent;
    }
    .wf-pipeline::-webkit-scrollbar-thumb {
      background: var(--hud-border-strong);
      border-radius: 9999px;
    }
    .wf-pipeline:focus-visible {
      outline: 2px solid var(--hud-primary);
      outline-offset: 2px;
    }
    .wf-step {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 6px;
      border: 1px solid var(--hud-border);
      background: var(--hud-card);
      color: var(--hud-fg);
      font-size: 12px;
      line-height: 1.35;
      flex: 0 0 auto;
      flex-shrink: 0;
      white-space: nowrap;
      word-break: normal;
      overflow-wrap: normal;
      transition: border-color 150ms var(--ease-out), background 150ms var(--ease-out), color 150ms var(--ease-out);
    }
    .wf-step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      background: var(--hud-surface-hover);
      color: var(--hud-muted);
      flex-shrink: 0;
    }
    .wf-step-body {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      flex-wrap: nowrap;
      white-space: nowrap;
    }
    .wf-step-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--hud-fg);
      white-space: nowrap;
    }
    .wf-step-sub {
      font-size: 12px;
      color: var(--hud-muted);
      white-space: nowrap;
    }
    .wf-step-done {
      border-color: var(--hud-ok-border);
      background: var(--hud-ok-tint);
    }
    .wf-step-done .wf-step-num {
      background: var(--hud-ok);
      color: var(--hud-ok-fg);
    }
    .wf-step-done .wf-step-title {
      color: var(--hud-ok-ink);
    }
    .wf-step-current {
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint-strong);
      box-shadow: 0 0 0 1px var(--hud-primary-tint);
    }
    .wf-step-current .wf-step-num {
      background: var(--hud-primary);
      color: var(--hud-primary-fg);
      animation: wfNodePulse 1.8s var(--ease-in-out) infinite;
    }
    .wf-step-current .wf-step-title {
      color: var(--hud-primary-ink);
    }
    .wf-step-upcoming {
      opacity: 0.72;
    }
    .wf-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 1px;
      color: var(--hud-muted);
      flex-shrink: 0;
    }
    .wf-arrow-svg {
      display: block;
      overflow: visible;
    }
    .wf-arrow-track {
      stroke: currentColor;
      stroke-opacity: 0.26;
      stroke-width: 1.5;
      stroke-linecap: round;
    }
    .wf-arrow-stream {
      stroke: var(--hud-primary);
      stroke-width: 1.75;
      stroke-dasharray: 4 5;
      stroke-linecap: round;
      opacity: 0.65;
      animation: wfStreamFlow 1.35s linear infinite;
    }
    .wf-arrow-pulse {
      fill: var(--hud-primary);
      opacity: 0;
      animation: wfPulseTravel 2.2s cubic-bezier(0.35, 0, 0.25, 1) infinite;
      animation-delay: calc(var(--wf-step-i, 0) * 320ms);
    }
    .wf-arrow-head {
      stroke: var(--hud-primary);
      stroke-opacity: 0.82;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 150ms var(--ease-out), stroke-opacity 150ms var(--ease-out);
    }
    .wf-card:hover .wf-arrow-idle .wf-arrow-stream {
      opacity: 0.95;
    }
    .wf-arrow-active {
      color: var(--hud-primary);
    }
    .wf-arrow-active .wf-arrow-stream {
      stroke: var(--hud-primary);
      stroke-width: 2;
      opacity: 1;
      animation-duration: 0.95s;
    }
    .wf-arrow-active .wf-arrow-pulse {
      fill: var(--hud-primary);
      animation-duration: 1.45s;
      animation-delay: 0ms;
    }
    .wf-arrow-active .wf-arrow-head {
      stroke: var(--hud-primary);
      stroke-opacity: 1;
      stroke-width: 2;
    }
    .wf-arrow-done {
      color: var(--hud-ok);
    }
    .wf-arrow-done .wf-arrow-track {
      stroke: var(--hud-ok);
      stroke-opacity: 0.85;
      stroke-width: 1.75;
    }
    .wf-arrow-done .wf-arrow-stream,
    .wf-arrow-done .wf-arrow-pulse {
      display: none;
    }
    .wf-arrow-done .wf-arrow-head {
      stroke: var(--hud-ok);
      stroke-opacity: 0.95;
    }
    .wf-arrow-upcoming .wf-arrow-stream,
    .wf-arrow-upcoming .wf-arrow-pulse {
      display: none;
    }
    .wf-arrow-upcoming .wf-arrow-head {
      stroke: currentColor;
      stroke-opacity: 0.4;
    }

    /* Interactive 3D Wiki Mind-Map */
    .wiki-cat-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .wiki-mm-wrap {
      margin-bottom: 10px;
      border-radius: 8px;
      border: 1px solid var(--hud-border);
      background:
        radial-gradient(circle at 50% 44%, var(--hud-primary-tint) 0%, transparent 68%),
        var(--hud-input-bg);
      overflow: hidden;
      animation: hudContentReveal 180ms var(--ease-out);
    }
    .wiki-mm-wrap[hidden] {
      display: none !important;
    }
    .wiki-mm-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      padding: 6px 10px;
      border-bottom: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      font-size: 12px;
    }
    .wiki-mm-readout {
      min-width: 0;
      flex: 1 1 140px;
      font-size: 12px;
      color: var(--hud-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wiki-mm-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .wiki-mm-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid var(--hud-border);
      background: var(--hud-card);
      color: var(--hud-muted);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.25;
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .wiki-mm-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .wiki-mm-btn:active:not(:disabled) {
      transform: translateY(1px) scale(0.97);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }
    .wiki-mm-btn[aria-pressed="true"] {
      color: var(--hud-primary-ink);
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint-strong);
      font-weight: 600;
    }
    .wiki-mm-stage {
      position: relative;
      width: 100%;
      height: 288px;
      touch-action: none;
      user-select: none;
    }
    .wiki-mm-canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: grab;
    }
    .wiki-mm-canvas.is-dragging {
      cursor: grabbing;
    }
    .wiki-mm-canvas.is-hover-node {
      cursor: pointer;
    }
    .wiki-mode-switch {
      position: relative;
      isolation: isolate;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: 8px;
      background: var(--hud-sidebar);
      border: 1px solid var(--hud-border);
    }
    .wiki-mode-btn {
      position: relative;
      z-index: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--hud-muted);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      white-space: nowrap;
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .wiki-mode-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-subtle);
    }
    .wiki-mode-btn.active {
      background: var(--hud-surface-active);
      color: var(--hud-fg);
      border-color: var(--hud-border-strong);
      font-weight: 600;
    }
    .wiki-list-wrap {
      margin-bottom: 10px;
      border-radius: 8px;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      overflow: hidden;
      animation: hudContentReveal 165ms var(--ease-out);
    }
    .wiki-page-list {
      display: flex;
      flex-direction: column;
      max-height: 256px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--hud-border-strong) transparent;
    }
    .wiki-page-item {
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--hud-border);
      background: transparent;
      color: var(--hud-fg);
      font-size: 12px;
      line-height: 1.35;
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out);
    }
    .wiki-page-item:last-child {
      border-bottom: 0;
    }
    .wiki-page-item:hover {
      background: var(--hud-surface-hover);
    }
    .wiki-page-item.active {
      background: var(--hud-primary-tint-strong);
      color: var(--hud-primary-ink);
    }
    .wiki-page-item-main {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .wiki-page-item-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--hud-muted);
      font-size: 12px;
    }
    .wiki-page-item.active .wiki-page-item-title {
      color: var(--hud-primary-ink);
      opacity: 0.88;
    }
    .wiki-page-item-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .wiki-path-pill {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 5px;
      border: 1px solid transparent;
      background: var(--hud-surface-subtle);
      color: var(--hud-muted);
      font-size: 12px;
      transition: border-color var(--dur-short) var(--ease-out), background var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out);
    }
    .wiki-path-pill.wiki-path-flash {
      animation: hudPathFlash var(--dur-long) var(--ease-out);
    }

    @keyframes wfStreamFlow {
      from { stroke-dashoffset: 18; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes wfPulseTravel {
      0% { transform: translateX(0); opacity: 0; }
      18% { opacity: 0.95; }
      78% { opacity: 0.95; }
      100% { transform: translateX(24px); opacity: 0; }
    }
    @keyframes wfNodePulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--hud-primary-tint-strong); }
      50% { box-shadow: 0 0 0 4px transparent; }
    }
    @keyframes hudPaneEnter {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes hudFilterSwap {
      from { opacity: 0.42; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes hudContentReveal {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes hudPathFlash {
      0% { border-color: var(--hud-primary); background: var(--hud-primary-tint-strong); color: var(--hud-primary-ink); }
      100% { border-color: transparent; background: var(--hud-surface-subtle); color: var(--hud-muted); }
    }
    @keyframes hudCheckDraw {
      from { stroke-dashoffset: 16; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes hudSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes hudLiveDot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.84); }
    }
    @keyframes hudSkelShimmer {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }
    @keyframes hudDrawerIn {
      from { transform: translateX(20px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes hudDrawerOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(16px); opacity: 0; }
    }
    @keyframes hudBackdropIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes hudBackdropOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .badge,
      .tab-btn,
      .tab-pill-indicator,
      .chip-btn,
      .action-btn,
      .md-copy-btn,
      .wiki-mm-btn,
      .wiki-mode-btn,
      .wiki-page-item,
      .wiki-path-pill,
      .wf-step,
      .wf-arrow-head,
      .bar-fill,
      .wiki-link-pill,
      .list-row-card,
      .artifact-row,
      details.hud-details > summary::before {
        transition: none !important;
      }
      .artifact-drawer,
      .drawer-backdrop,
      .view-pane.pane-enter,
      .filter-swap,
      .md-reveal,
      .wiki-mm-wrap,
      .wiki-list-wrap,
      .wiki-path-pill.wiki-path-flash,
      .btn-check-path,
      .btn-spin-ring,
      #refresh-btn.is-spinning .refresh-icon,
      #sse-status-pill.badge-live::before,
      .md-skeleton::after,
      .wf-arrow-stream,
      .wf-arrow-pulse,
      .wf-step-current .wf-step-num {
        animation: none !important;
      }
      .btn-check-path {
        stroke-dashoffset: 0;
      }
      .wf-arrow-pulse,
      .md-skeleton::after {
        display: none;
      }
      .action-btn:active:not(:disabled),
      .chip-btn:active:not(:disabled),
      .tab-btn:active:not(:disabled),
      .wiki-mode-btn:active:not(:disabled),
      .wiki-mm-btn:active:not(:disabled),
      button.badge:active:not(:disabled),
      .md-copy-btn:active:not(:disabled) {
        transform: none;
      }
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
    table.hud-table .col-id { width: 58px; white-space: nowrap; }
    table.hud-table .col-main { width: auto; }
    table.hud-table .col-status { width: 96px; text-align: right; white-space: nowrap; }
    table.hud-table .col-event { width: 38%; }
    .ws-folder-pill {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: bottom;
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      font-size: 13px;
      font-weight: 600;
      word-break: normal;
      overflow-wrap: normal;
    }
    .mode-spotlight {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      padding: 9px 11px;
      border-radius: 8px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
    }
    .ledger-list {
      display: grid;
      gap: 0;
      margin-top: 4px;
    }
    .ledger-item {
      padding: 8px 4px;
      border: 0;
      border-bottom: 1px solid var(--hud-border);
      min-width: 0;
    }
    .ledger-item:last-child {
      border-bottom: 0;
      padding-bottom: 2px;
    }
    .ledger-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ledger-item-note {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.45;
      color: var(--hud-fg);
      overflow-wrap: anywhere;
    }
    .list-row-card,
    .artifact-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 6px;
      border-radius: 6px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--hud-border);
      min-width: 0;
      transition: background var(--dur-micro) var(--ease-out);
    }
    .list-row-card:last-child,
    .artifact-row:last-child {
      border-bottom: 0;
    }
    .list-row-card:hover,
    .artifact-row:hover {
      background: var(--hud-surface-subtle);
    }
    .agreement-grid {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    .agreement-box {
      padding: 8px 11px;
      border-radius: 0 6px 6px 0;
      background: var(--hud-surface-subtle);
      border: 0;
      border-left: 2px solid var(--hud-border-strong);
      min-width: 0;
    }
    .agreement-body {
      font-size: 12px;
      line-height: 1.52;
      color: var(--hud-fg);
      text-wrap: pretty;
    }
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }
    .health-stat {
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--hud-surface-subtle);
      border: 1px solid transparent;
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
      margin: 10px 0 4px 0;
    }
    .health-item {
      padding: 8px 4px;
      border: 0;
      border-bottom: 1px solid var(--hud-border);
      min-width: 0;
    }
    .health-item:last-child {
      border-bottom: 0;
      padding-bottom: 2px;
    }
    details.hud-details {
      margin-top: 8px;
      border-top: 1px solid var(--hud-border);
      padding-top: 6px;
    }
    details.hud-details.card-details {
      margin-top: 0;
      border-top: none;
      padding-top: 0;
    }
    details.hud-details > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      color: var(--hud-muted);
      user-select: none;
      padding: 2px 0;
      transition: color var(--dur-micro) var(--ease-out);
    }
    details.hud-details > summary::-webkit-details-marker {
      display: none;
    }
    details.hud-details > summary::before {
      content: "";
      width: 6px;
      height: 6px;
      border-right: 1.75px solid currentColor;
      border-bottom: 1.75px solid currentColor;
      transform: rotate(-45deg);
      flex-shrink: 0;
      transition: transform 160ms var(--ease-out);
    }
    details.hud-details[open]:not(.is-closing) > summary::before {
      transform: rotate(45deg);
    }
    details.hud-details > summary:hover {
      color: var(--hud-fg);
    }
    details.hud-details.card-details > summary {
      font-size: 13px;
      color: var(--hud-fg);
    }
    details.hud-details > summary .summary-label {
      flex: 1 1 auto;
      min-width: 0;
    }
    details.hud-details[open] > summary {
      color: var(--hud-fg);
      margin-bottom: 6px;
    }
    .snippet-preview {
      margin-top: 4px;
      padding: 6px 8px;
      border-radius: 6px;
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

    /* Formatted Safe Markdown & Preview Skeletons */
    .md-reveal {
      animation: hudContentReveal 180ms var(--ease-out);
    }
    .md-skeleton {
      position: relative;
      overflow: hidden;
      display: grid;
      gap: 9px;
      padding: 6px 0;
    }
    .md-skeleton::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 0%, var(--hud-surface-hover) 50%, transparent 100%);
      animation: hudSkelShimmer 1.35s var(--ease-in-out) infinite;
      pointer-events: none;
    }
    .md-skel-kicker,
    .md-skel-title,
    .md-skel-line,
    .md-skel-block {
      border-radius: 5px;
      background: var(--hud-surface-subtle);
    }
    .md-skel-kicker { width: 28%; height: 12px; }
    .md-skel-title { width: 62%; height: 18px; margin-bottom: 4px; }
    .md-skel-line { width: 96%; height: 12px; }
    .md-skel-line.w-84 { width: 84%; }
    .md-skel-line.w-68 { width: 68%; }
    .md-skel-block { width: 100%; height: 64px; border-radius: 8px; margin-top: 4px; }
    .drawer-markdown-body,
    .wiki-markdown-body {
      min-width: 0;
      width: 100%;
      line-height: 1.58;
    }
    .md-frontmatter {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 10px;
      margin: 0 0 12px 0;
      border-radius: 8px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
    }
    .md-fm-chip {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--hud-card);
      border: 1px solid var(--hud-border);
      font-size: 12px;
      max-width: 100%;
    }
    .md-fm-key {
      color: var(--hud-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .md-fm-val {
      color: var(--hud-fg);
      font-weight: 500;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .md-h1,
    .md-h2,
    .md-h3,
    .md-h4 {
      font-style: normal;
      line-height: 1.3;
      text-wrap: balance;
    }
    .md-h1 { font-size: 16px; font-weight: 700; margin: 10px 0 8px 0; }
    .md-h2 { font-size: 15px; font-weight: 600; margin: 12px 0 6px 0; border-bottom: 1px solid var(--hud-border); padding-bottom: 4px; }
    .md-h3 { font-size: 14px; font-weight: 600; margin: 10px 0 5px 0; }
    .md-h4 { font-size: 13px; font-weight: 600; margin: 8px 0 4px 0; }
    .md-p { font-size: 13px; line-height: 1.58; margin: 0 0 10px 0; text-wrap: pretty; }
    .md-list { margin: 0 0 10px 0; padding-left: 20px; font-size: 13px; line-height: 1.55; }
    .md-list li + li { margin-top: 4px; }
    .md-list li.md-subitem { margin-left: 16px; list-style-type: circle; }
    .md-quote {
      margin: 0 0 10px 0;
      padding: 7px 11px;
      border-left: 3px solid var(--hud-primary);
      border-radius: 0 6px 6px 0;
      background: var(--hud-surface-subtle);
      color: var(--hud-muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .md-hr { border: none; border-top: 1px solid var(--hud-border); margin: 12px 0; }
    .drawer-markdown-body .table-wrap,
    .wiki-markdown-body .table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 0 0 12px 0;
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      background: var(--hud-surface-subtle);
    }
    table.hud-table.md-table {
      table-layout: auto;
      width: 100%;
    }
    table.hud-table.md-table th,
    table.hud-table.md-table td {
      padding: 7px 10px;
      min-width: 72px;
      word-break: normal;
      overflow-wrap: break-word;
    }
    table.hud-table.md-table th:first-child,
    table.hud-table.md-table td:first-child {
      min-width: 0;
    }
    table.hud-table.md-table th {
      white-space: nowrap;
      overflow: visible;
      text-overflow: clip;
      background: var(--hud-surface-subtle);
    }
    .md-code-wrap {
      margin: 0 0 10px 0;
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      background: var(--hud-input-bg);
      overflow: hidden;
    }
    .md-code-lang {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 8px 4px 10px;
      font-size: 12px;
      color: var(--hud-muted);
      border-bottom: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .md-copy-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 5px;
      border: 1px solid var(--hud-border);
      background: var(--hud-card);
      color: var(--hud-muted);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.25;
      transition: background var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .md-copy-btn:hover {
      color: var(--hud-fg);
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .md-copy-btn:active:not(:disabled) {
      transform: translateY(1px) scale(0.98);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }
    .md-pre {
      padding: 10px 12px;
      overflow-x: auto;
      white-space: pre;
      word-break: normal;
      overflow-wrap: normal;
      line-height: 1.5;
    }
    .md-pre code {
      white-space: pre;
      word-break: normal;
      overflow-wrap: normal;
    }
    .md-inline-code {
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
      font-size: 12px;
    }
    .md-link {
      color: var(--hud-primary-ink);
      text-decoration: underline;
    }
    .wiki-link-pill {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 5px;
      border: 1px solid var(--hud-primary-border);
      background: var(--hud-primary-tint);
      color: var(--hud-primary-ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
      transition: background var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .wiki-link-pill:hover {
      background: var(--hud-primary-tint-hover);
      border-color: var(--hud-primary);
    }
    .wiki-link-pill:active {
      transform: translateY(1px) scale(0.98);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }

    /* Slide-Over Artifact Drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: var(--hud-scrim);
      z-index: var(--z-backdrop);
      animation: hudBackdropIn 200ms var(--ease-out);
    }
    .drawer-backdrop.is-closing {
      animation: hudBackdropOut 150ms var(--ease-in) forwards;
      pointer-events: none;
    }
    .artifact-drawer {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(100vw, 780px);
      background: var(--hud-content);
      border-left: 1px solid var(--hud-border);
      box-shadow: var(--hud-shadow-drawer);
      z-index: var(--z-drawer);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: hudDrawerIn 240ms var(--ease-out);
    }
    .artifact-drawer.is-closing {
      animation: hudDrawerOut 170ms var(--ease-in) forwards;
      pointer-events: none;
    }
    .artifact-drawer[hidden],
    .drawer-backdrop[hidden] {
      display: none !important;
    }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 11px 16px;
      border-bottom: 1px solid var(--hud-border);
      background: var(--hud-sidebar);
    }
    .drawer-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 14px 16px;
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
  <div id="hud-main-shell">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;font-size:14px;">Oh My Agy</span>
          <span id="sse-status-pill" class="badge tabular" title="Live Server-Sent Events connection status">INIT</span>
        </div>
        <div id="status-line" class="muted" style="font-size:12px;font-family:ui-monospace,monospace;">[OMA] Loading&hellip;</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="refresh-btn" type="button" class="action-btn" title="Force snapshot refresh"><svg class="refresh-icon" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M11.8 7a4.8 4.8 0 1 1-1.25-3.24M11.9 2.1v2.35H9.55" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Refresh</span></button>
      </div>
    </div>

    <div id="main-tab-bar" class="tab-bar" data-sliding-tabs="main" role="tablist" aria-label="HUD sections">
      <span class="tab-pill-indicator" aria-hidden="true"></span>
      <button type="button" class="tab-btn active" role="tab" data-view="overview">Overview</button>
      <button type="button" class="tab-btn" role="tab" data-view="workflows">Workflows</button>
      <button type="button" class="tab-btn" role="tab" data-view="skills">Skills</button>
      <button type="button" class="tab-btn" role="tab" data-view="subagents">Subagents</button>
      <button type="button" class="tab-btn" role="tab" data-view="wiki">Wiki</button>
    </div>

    <div id="view-overview" class="view-pane"></div>
    <div id="view-workflows" class="view-pane" style="display:none;"></div>
    <div id="view-skills" class="view-pane" style="display:none;"></div>
    <div id="view-subagents" class="view-pane" style="display:none;"></div>
    <div id="view-wiki" class="view-pane" style="display:none;"></div>
  </div>

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
    let drawerCloseTimer = null;
    let drawerSkeletonTimer = null;
    let hasMountedInitialTab = false;
    let pendingWikiDocTransition = false;
    let pendingSkillFilterAnim = false;
    let pendingSubagentFilterAnim = false;

    function syncUrlState() {
      try {
        const next = new URLSearchParams(window.location.search);
        next.set('view', activeView);
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
        if (currentLoftState && !document.getElementById('artifact-drawer').hidden) {
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
      const wasCreated = !pill;
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'tab-pill-indicator';
        pill.setAttribute('aria-hidden', 'true');
        barEl.insertBefore(pill, barEl.firstChild);
      }
      const prevRect = pillId ? slidingPillRects[pillId] : null;
      const skipAnim = immediate || prefersReducedMotion() || !prevRect;
      if (wasCreated && prevRect && !skipAnim) {
        pill.style.transition = 'none';
        pill.style.width = prevRect.w + 'px';
        pill.style.height = prevRect.h + 'px';
        pill.style.transform = 'translate3d(' + prevRect.x + 'px, ' + prevRect.y + 'px, 0)';
        barEl.classList.add('has-sliding-pill');
        void pill.offsetWidth;
        pill.style.transition = '';
      } else if (skipAnim) {
        pill.style.transition = 'none';
      }
      pill.style.width = w + 'px';
      pill.style.height = h + 'px';
      pill.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
      barEl.classList.add('has-sliding-pill');
      if (skipAnim) {
        void pill.offsetWidth;
        pill.style.transition = '';
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
        btn.innerHTML = '<svg class="btn-check-svg" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path class="btn-check-path" d="M2.2 6.3L4.8 8.9L9.8 3.3" /></svg><span>' + esc(label) + '</span>';
      } else {
        btn.innerHTML = '<span>' + esc(label) + '</span>';
      }
      if (ms > 0) {
        btn._hudBtnTimer = setTimeout(() => {
          btn._hudBtnTimer = null;
          if (Object.prototype.hasOwnProperty.call(btn.dataset, 'origHtml')) {
            btn.innerHTML = btn.dataset.origHtml;
            delete btn.dataset.origHtml;
          }
          delete btn.dataset.btnState;
          btn.style.minWidth = '';
        }, ms);
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
      if (btn) {
        btn.disabled = true;
        setButtonFeedback(btn, 'loading', 'Sending\u2026', 0);
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
          setButtonFeedback(btn, 'err', 'Error', 1800);
          return;
        }
        if (data.fallback) {
          setButtonFeedback(btn, 'ok', 'New Chat', 1600);
        } else if (data.modeUsed === 'active-chat' || data.modeUsed === 'subagent-active') {
          setButtonFeedback(btn, 'ok', 'Sent', 1500);
        } else {
          setButtonFeedback(btn, 'ok', 'Launched', 1500);
        }
      } catch { /* fail open: dispatch network failure */
        if (btn) btn.disabled = false;
        setButtonFeedback(btn, 'err', 'Failed', 1800);
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
      if (drawerCloseTimer) {
        clearTimeout(drawerCloseTimer);
        drawerCloseTimer = null;
      }
      clearDrawerSkeleton();
      const backdrop = document.getElementById('artifact-drawer-backdrop');
      const drawer = document.getElementById('artifact-drawer');
      if (drawer.hidden || drawer.classList.contains('is-closing')) {
        drawerTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      backdrop.classList.remove('is-closing');
      drawer.classList.remove('is-closing');
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
        if (drawerReqSeq === reqSeq && !drawer.hidden) {
          bodyEl.innerHTML = buildDrawerSkeletonHtml();
        }
      }, 120);
      backdrop.hidden = false;
      drawer.hidden = false;
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
      backdrop.classList.remove('is-closing');
      drawer.classList.remove('is-closing');
      backdrop.hidden = true;
      drawer.hidden = true;
      document.getElementById('artifact-drawer-body').innerHTML = '';
      document.getElementById('artifact-drawer-controls').innerHTML = '';
      document.getElementById('artifact-drawer-controls').style.display = 'none';
    }

    window.closeArtifactDrawer = function(immediate = false) {
      drawerReqSeq += 1;
      clearDrawerSkeleton();
      if (drawerCloseTimer) {
        clearTimeout(drawerCloseTimer);
        drawerCloseTimer = null;
      }
      setMainShellInert(false);
      const drawer = document.getElementById('artifact-drawer');
      const backdrop = document.getElementById('artifact-drawer-backdrop');
      const triggerToRestore = drawerTriggerEl;
      drawerTriggerEl = null;
      if (triggerToRestore && document.contains(triggerToRestore)) {
        try { triggerToRestore.focus({ preventScroll: true }); } catch { /* fail open: focus restore unsupported */ }
      }
      if (immediate || prefersReducedMotion() || drawer.hidden) {
        resetDrawerDom();
        return;
      }
      backdrop.classList.add('is-closing');
      drawer.classList.add('is-closing');
      drawerCloseTimer = setTimeout(() => {
        drawerCloseTimer = null;
        resetDrawerDom();
      }, 175);
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
        <button type="button" class="chip-btn \${mode === m.id ? 'chip-active' : ''}" data-vr-mode="\${m.id}" aria-pressed="\${mode === m.id ? 'true' : 'false'}" onclick="setVrMode(this.dataset.vrMode)">\${m.label}</button>\`).join('');
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
        bodyEl.innerHTML = '<div class="drawer-markdown-body md-reveal">' + renderSafeMarkdown(verdictMarkdown || 'No arena verdict content.') + '</div>';
        return;
      }
      const rawHtml = htmlCache[activeEntry] || '';
      const prepared = prepareLoftSrcdoc(rawHtml, activeEntry, assetMap, collectActiveThemeCssVars());
      bodyEl.innerHTML = \`
        <div class="muted" style="font-size:12px;margin-bottom:6px;">Opaque-origin sandbox (<code>sandbox="allow-scripts"</code> &middot; local assets inlined &middot; external scripts stripped)</div>
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

    const WIKI_CAT_PALETTE = {
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

    function getWikiCatColor(cat) {
      const k = String(cat || '').toLowerCase();
      return WIKI_CAT_PALETTE[k] || WIKI_CAT_PALETTE.default;
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
      if (!document.getElementById('artifact-drawer').hidden) {
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

    function renderHyperplanReviewRow(h) {
      return \`
        <div class="list-row-card">
          <div style="min-width:0;flex:1 1 auto;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
              <span class="badge badge-active">Hyperplan</span>
              <span class="badge tabular">SURVIVES: \${h.survives}</span>
              <span class="badge tabular">WEAKENED: \${h.weakened}</span>
              <span class="badge tabular">KILLED: \${h.killed}</span>
            </div>
            <div class="muted" style="font-size:12px;" title="\${esc(h.file)}"><code>\${esc(formatShortRelPath(h.file))}</code>\${h.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(h.updatedAt))}</span>\` : ''}</div>
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
          <div style="min-width:0;flex:1 1 auto;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
              <span class="\${recCls}">\${esc(c.recommendation)}</span>
              <span class="badge">Architect: \${esc(c.architectStatus)}</span>
              <span class="muted tabular" style="font-size:12px;">\${c.filesReviewed} file(s) &middot; \${c.totalIssues} issue(s)</span>
            </div>
            <div class="muted" style="font-size:12px;" title="\${esc(c.file)}"><code>\${esc(formatShortRelPath(c.file))}</code>\${c.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(c.updatedAt))}</span>\` : ''}</div>
          </div>
          <button type="button" class="action-btn" data-file="\${esc(c.file)}" onclick="openMarkdownDrawer(this.dataset.file, 'Code Review Report', 'review')">Preview</button>
        </div>\`;
    }

    function renderOverview(data) {
      const { current: curMode, lastCompleted } = selectCurrentMode(data.modes);
      const activeModeObj = curMode && !curMode.stale ? curMode : null;

      let currentModeBodyHtml = '';
      if (curMode) {
        const statePill = curMode.awaitingConfirmation
          ? '<span class="badge badge-live">WAITING CONFIRMATION</span>'
          : (curMode.stale ? '<span class="badge">stale (&gt;6h)</span>' : '<span class="badge badge-live">active</span>');
        currentModeBodyHtml = \`
          <div class="mode-spotlight">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0;">
              <code style="font-weight:600;font-size:13px;">\${esc(curMode.mode)}</code>
              <span class="badge \${!curMode.stale ? 'badge-active' : ''}">\${esc(curMode.phase)}</span>
              \${statePill}
              \${curMode.iteration != null ? \`<span class="muted tabular" style="font-size:12px;">#\${esc(curMode.iteration)}</span>\` : ''}
            </div>
            <span class="badge" title="\${esc(curMode.scope && curMode.scope !== '.' ? curMode.scope : data.workspace)}">\${esc(formatScopeLabel(curMode.scope || '.'))}</span>
          </div>\`;
      } else {
        currentModeBodyHtml = \`
          <div class="mode-spotlight">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0;">
              <code style="font-weight:600;font-size:13px;">solo</code>
              <span class="badge">default lane</span>
              <span class="muted" style="font-size:12px;">No active workflow mode</span>
            </div>
            \${lastCompleted ? \`<span class="muted tabular" style="font-size:12px;" title="Most recent completed mode">Last: <code>\${esc(lastCompleted.mode)}</code> (\${esc(lastCompleted.phase)})</span>\` : ''}
          </div>\`;
      }

      const cancelControlHtml = pendingCancelConfirm
        ? \`<button type="button" class="action-btn action-btn-danger" data-cancel-mode="\${esc(activeModeObj ? activeModeObj.mode : '')}" onclick="confirmCancelMode(this, this.dataset.cancelMode)">Confirm /cancel\${activeModeObj ? ' ' + esc(activeModeObj.mode) : ''}</button>
           <button type="button" class="action-btn" onclick="abortCancelMode()">Abort</button>\`
        : \`<button type="button" class="action-btn" onclick="armCancelMode()">Cancel Mode</button>\`;

      const quickActionsHtml = \`
        <div class="cmd-actions" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--hud-border);">
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
        const ugScope = ug.scope && ug.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(ug.scope)}">\${esc(formatScopeLabel(ug.scope))}</span>\` : '';
        const pct = ug.counts.total > 0 ? Math.round((ug.counts.complete / ug.counts.total) * 100) : 0;
        const goalRows = (ug.goals || []).map((g) => \`
          <tr>
            <td class="col-id"><code>\${esc(g.id)}</code></td>
            <td class="col-main">
              <div>\${esc(g.title)}</div>
              <div class="muted tabular" style="font-size:12px;margin-top:2px;">Rigor: <code>\${esc(g.rigor)}</code> &middot; Retries: \${g.productFailures}/3</div>
            </td>
            <td class="col-status"><span class="badge \${g.status === 'in_progress' ? 'badge-active' : (g.status === 'complete' || g.status === 'completed' ? 'badge-live' : '')}">\${esc(g.status)}</span></td>
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
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0;">
                  <code>\${esc(gid)}</code>
                  <span class="\${actCls}">\${esc(act)}</span>
                </div>
                \${ts ? \`<span class="muted tabular" style="font-size:12px;" title="\${esc(ts)}">\${esc(formatShortTime(ts))}</span>\` : ''}
              </div>
              \${note ? \`<div class="ledger-item-note">\${esc(note)}</div>\` : ''}
            </div>\`;
        }).join('');
        const ledgerHtml = ledgerList.length ? \`
          <details class="hud-details" data-hud-key="ug-ledger">
            <summary class="tabular"><span class="summary-label">Recent Ledger Events (\${ledgerList.length})</span></summary>
            <div class="ledger-list">\${ledgerRows}</div>
          </details>\` : '';
        ugHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
              <div style="font-weight:600;min-width:0;flex:1 1 160px;overflow-wrap:anywhere;">Ultragoal: \${esc(ug.objective || 'Active Plan')}\${ugScope}</div>
              <span class="badge badge-active tabular">\${ug.counts.complete}/\${ug.counts.total}</span>
            </div>
            <div class="bar-track" style="margin:8px 0;"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, pct)) / 100).toFixed(4)};"></div></div>
            <div class="table-wrap"><table class="hud-table"><thead><tr><th class="col-id">ID</th><th class="col-main">Goal</th><th class="col-status">Status</th></tr></thead><tbody>\${goalRows}</tbody></table></div>
            \${ledgerHtml}
          </div>\`;
      }

      let ivHtml = '';
      if (data.interview) {
        const iv = data.interview;
        const ivScope = iv.scope && iv.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(iv.scope)}">\${esc(formatScopeLabel(iv.scope))}</span>\` : '';
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
                  <div class="bar-track" style="height:6px;"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, pctVal)) / 100).toFixed(4)};"></div></div>
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
                \${r.question ? \`<div class="muted" style="font-size:12px;margin-top:3px;">Q: \${esc(r.question)}</div>\` : ''}
                \${r.answer ? \`<div style="font-size:12px;margin-top:2px;">A: \${esc(r.answer)}</div>\` : ''}
              </div>\`).join('')}
          </details>\` : '';
        const specBtn = iv.specFile
          ? \`<button type="button" class="action-btn action-btn-primary" data-file="\${esc(iv.specFile)}" onclick="openMarkdownDrawer(this.dataset.file, 'Deep Interview Spec', 'spec')">Open Spec</button>\`
          : '';
        ivHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
              <div style="min-width:0;flex:1 1 160px;">
                <div style="font-weight:600;overflow-wrap:anywhere;">Deep Interview: <code>\${esc(iv.slug || 'session')}</code>\${ivScope}</div>
                <div class="muted tabular" style="font-size:12px;margin-top:2px;">Profile: <code>\${esc(iv.profile)}</code> &middot; Ambiguity: \${ambPct}% (&le; \${threshPct}%)</div>
              </div>
              \${specBtn}
            </div>
            <div class="bar-track" style="margin-top:8px;"><div class="bar-fill" style="--bar-scale:\${(Math.max(0, Math.min(100, 100 - ambPct)) / 100).toFixed(4)};"></div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
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
      if (data.teams && data.teams.length) {
        teamHtml = data.teams.map((t) => {
          const tScope = t.scope && t.scope !== '.' ? \` <span class="badge badge-active" title="\${esc(t.scope)}">\${esc(formatScopeLabel(t.scope))}</span>\` : '';
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

      const sortNewest = (arr) => [...arr].sort((a, b) => {
        const diff = (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0);
        return diff !== 0 ? diff : String(b.file || '').localeCompare(String(a.file || ''));
      });

      const rp = data.reviews?.ralplan;
      const hpList = data.reviews?.hyperplan || [];
      const crList = data.reviews?.codeReviews || [];
      const resList = sortNewest(data.research || []);
      const combinedReviews = sortNewest([
        ...hpList.map((h) => ({ ...h, _revKind: 'hyperplan' })),
        ...crList.map((c) => ({ ...c, _revKind: 'codeReview' })),
      ]);
      const recentReviews = combinedReviews.slice(0, 5);
      const recentResearches = resList.slice(0, 5);

      const art = data.artifacts || { plans: [], specs: [], handoffs: [], ideas: [], asks: [] };
      const artGroups = sortNewest([
        ...(art.plans || []).map((x) => ({ ...x, kind: 'plan' })),
        ...(art.specs || []).map((x) => ({ ...x, kind: 'spec' })),
        ...(art.handoffs || []).map((x) => ({ ...x, kind: 'handoff' })),
        ...(art.ideas || []).map((x) => ({ ...x, kind: 'idea' })),
        ...(art.asks || []).map((x) => ({ ...x, kind: 'ask' })),
      ]);
      const recentArtifacts = artGroups.slice(0, 10);

      let revResHtml = '';
      if (rp || combinedReviews.length || resList.length) {
        const activeRevTab = overviewReviewTab || ((!rp && recentReviews.length === 0 && recentResearches.length > 0) ? 'research' : 'reviews');
        const rpLine = rp ? \`
          <div class="health-item" style="margin-top:0;margin-bottom:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span class="badge badge-active tabular">Ralplan Iter \${esc(rp.iteration)}</span>
            <span class="badge">Architect: \${esc(rp.architectVerdict)}</span>
            <span class="badge">Critic: \${esc(rp.criticVerdict)}</span>
            <span class="badge \${rp.consensusComplete ? 'badge-live' : ''}">Consensus: \${rp.consensusComplete ? 'COMPLETE' : 'PENDING'}</span>
          </div>\` : '';
        const reviewRowsHtml = recentReviews.map((item) => item._revKind === 'hyperplan' ? renderHyperplanReviewRow(item) : renderCodeReviewRow(item)).join('');
        const researchRowsHtml = recentResearches.map((r) => \`
          <div class="list-row-card">
            <div style="min-width:0;flex:1 1 auto;">
              <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
                <span class="badge badge-active tabular">\${r.compositeScore !== null ? 'Score ' + r.compositeScore + '/100' : 'Research'}</span>
                \${r.evalIntegrityVerdict ? \`<span class="badge \${r.evalIntegrityVerdict === 'PASS' ? 'badge-live' : ''}">Eval: \${esc(r.evalIntegrityVerdict)}</span>\` : ''}
                <span class="badge">\${esc(r.lens)}</span>
              </div>
              <div style="font-weight:600;overflow-wrap:anywhere;">\${esc(r.title)}</div>
              <div class="muted tabular" style="font-size:12px;margin-top:2px;">Claims &middot; V:\${r.claims.verified} &middot; D:\${r.claims.derived} &middot; A:\${r.claims.assumed}</div>
            </div>
            <button type="button" class="action-btn" data-file="\${esc(r.file)}" data-title="\${esc(r.title)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, 'research')">Open Report</button>
          </div>\`).join('');

        const reviewsPaneHtml = (rpLine || reviewRowsHtml)
          ? (rpLine + reviewRowsHtml)
          : '<div class="muted" style="font-size:12px;">No recent reviews recorded yet.</div>';
        const researchPaneHtml = researchRowsHtml
          || '<div class="muted" style="font-size:12px;">No deep research reports recorded yet.</div>';

        revResHtml = \`
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <div style="font-weight:600;">Recent Reviews &amp; Deep Research</div>
              <div class="tab-bar" data-sliding-tabs="ov-rev" role="tablist" aria-label="Reviews and research tabs" style="margin-bottom:0;">
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
            <div style="margin-top:8px;">
              \${recentArtifacts.map((item) => \`
                <div class="artifact-row">
                  <div style="min-width:0;flex:1 1 auto;">
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px;">
                      <span class="badge">\${esc(item.kind)}</span>
                      <strong style="overflow-wrap:anywhere;">\${esc(item.title)}</strong>
                    </div>
                    <div class="muted" style="font-size:12px;" title="\${esc(item.file)}"><code>\${esc(formatShortRelPath(item.file))}</code>\${item.updatedAt ? \` &middot; <span class="tabular">\${esc(formatShortTime(item.updatedAt))}</span>\` : ''}</div>
                  </div>
                  <button type="button" class="action-btn" data-file="\${esc(item.file)}" data-title="\${esc(item.title)}" data-kind="\${esc(item.kind)}" onclick="openMarkdownDrawer(this.dataset.file, this.dataset.title, this.dataset.kind)">Open</button>
                </div>\`).join('')}
            </div>
          </details>
        </div>\` : '';

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
              <span class="badge \${se ? (se.ok ? 'badge-live' : 'badge-danger') : ''}">Skill Eval: \${seLabel}</span>
              <span class="badge \${doc.qualityGatesOk ? 'badge-live' : 'badge-danger'}">Quality Gates: \${doc.qualityGatesOk ? 'OK' : 'INVALID'}</span>
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

      const scopes = Array.isArray(data.trackedScopes) && data.trackedScopes.length
        ? data.trackedScopes
        : [{ scope: '.', path: data.workspace }];
      const trackedScopesHtml = \`
        <div style="display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center;">
          <span class="muted" style="font-size:12px;">\${scopes.length > 1 ? 'Scopes:' : 'Scope:'}</span>
          \${scopes.map((sc) => \`<span class="badge \${sc.scope && sc.scope !== '.' ? 'badge-active' : ''}" title="\${esc(sc.scope && sc.scope !== '.' ? sc.scope : data.workspace)}">\${esc(formatScopeLabel(sc.scope))}</span>\`).join('')}
        </div>\`;

      document.getElementById('view-overview').innerHTML = \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div style="min-width:0;flex:1 1 180px;">
              <div style="font-weight:600;margin-bottom:5px;">Workspace</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-width:0;">
                <code class="ws-folder-pill" title="\${esc(data.workspace)}">\${esc(formatWorkspaceName(data.workspace))}</code>
                \${trackedScopesHtml}
              </div>
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
              <div style="font-weight:600;">\${esc(wf.title)}</div>
              \${wf.active ? \`<span class="badge badge-active">ACTIVE (\${esc(wf.currentPhase)})</span>\` : \`<span class="badge">\${esc(wf.modeKey)}</span>\`}
            </div>
            <div class="wf-pipeline" data-wf-pipeline="\${esc(wf.id)}" tabindex="0" role="list" aria-label="Workflow steps for \${esc(wf.title)}">\${stagesHtml}</div>
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
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <div>
                <code style="font-weight:600;font-size:13px;">/\${highlightMatch(s.name, skillSearch)}</code>
                <span class="muted" style="font-size:12px;margin-left:4px;">($\${highlightMatch(s.name, skillSearch)})</span>
              </div>
              <span class="badge">\${highlightMatch(s.category, skillSearch)}</span>
            </div>
            \${flagsHtml ? \`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;" role="group" aria-label="Skill flags for \${esc(s.name)}">\${flagsHtml}</div>\` : ''}
            <div style="margin-bottom:4px;">\${highlightMatch(s.howToUse, skillSearch)}</div>
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
        <button type="button" class="tab-btn \${skillCategory === c ? 'active' : ''}" role="tab" aria-selected="\${skillCategory === c ? 'true' : 'false'}" tabindex="\${skillCategory === c ? '0' : '-1'}" data-skill-cat="\${esc(c)}" onclick="setSkillCategory(this.dataset.skillCat)">\${esc(c)}</button>\`).join('');
      document.getElementById('view-skills').innerHTML = \`
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <span style="font-weight:600;">Skills Catalog</span>
            <span id="skills-match-count" class="badge tabular" aria-live="polite">\${allSkills.length} skills</span>
          </div>
          <input type="text" id="skill-search-input" class="search-input" placeholder="Press / to search skills by name, flag, or use case (e.g. deep-research, skill, hud)&hellip;" value="\${esc(skillSearch)}" oninput="onSkillSearchInput(this.value)" />
          <div class="tab-bar" data-sliding-tabs="skill-cat" role="tablist" aria-label="Skill categories" style="margin-bottom:0;">\${catBtns}</div>
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
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <code style="font-weight:600;font-size:13px;">\${highlightMatch(a.name, subagentSearch)}</code>
            <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
              <span class="badge">\${highlightMatch(a.lane, subagentSearch)}</span>
              <span class="badge">Model: \${esc(activeTier)}</span>
            </div>
          </div>
          <div style="margin-bottom:6px;">\${highlightMatch(a.whenToUse, subagentSearch)}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:4px;" role="group" aria-label="Model tier for \${esc(a.name)}">
            <span class="muted" style="font-size:12px;">Model:</span>\${modelPills}
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
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-weight:600;">Role Subagents</span>
            <span id="subagents-match-count" class="badge tabular" aria-live="polite">\${allSubagents.length} specialists</span>
          </div>
          <div class="muted" style="margin-bottom:8px;">Work-shape model routing: <code>flash_lite</code> / <code>flash</code> for quick mechanical lookups, <code>inherit</code> for cohesive implementation, and <code>pro</code> for architecture, critique, causal tracing, and security review.</div>
          <input type="text" id="subagent-search-input" class="search-input" placeholder="Press / to search subagents by role, lane, or capability&hellip;" value="\${esc(subagentSearch)}" oninput="onSubagentSearchInput(this.value)" />
          <div class="tab-bar" data-sliding-tabs="sa-lane" role="tablist" aria-label="Subagent lanes" style="margin-bottom:0;">\${laneBtns}</div>
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
          : \`<span class="wiki-cat-dot" style="background:\${getWikiCatColor(c).main};" aria-hidden="true"></span>\`;
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
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;">Wiki Explorer</span>
            <span class="muted tabular" style="font-weight:400;font-size:12px;">(\${filteredEntries.length} page\${filteredEntries.length === 1 ? '' : 's'} &middot; \${edgeCount} link\${edgeCount === 1 ? '' : 's'})</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
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
              ? \`<span class="wiki-cat-dot" style="background:\${getWikiCatColor(e.category).main};" aria-hidden="true"></span>\`
              : '';
            const deg = mmState.nodeBySlug.get(e.slug)?.degree || 0;
            return \`
              <button type="button" role="option" aria-selected="\${isSel ? 'true' : 'false'}" class="wiki-page-item \${isSel ? 'active' : ''}" data-wiki-slug="\${esc(e.slug)}" onclick="selectWikiSlug(this.dataset.wikiSlug)">
                <span class="wiki-page-item-main">
                  \${dot}
                  <code style="font-weight:600;">\${esc(e.slug)}.md</code>
                  \${e.title && e.title !== e.slug ? \`<span class="wiki-page-item-title">\${esc(e.title)}</span>\` : ''}
                </span>
                <span class="wiki-page-item-meta">
                  <span class="muted tabular" style="font-size:12px;">\${deg} link\${deg === 1 ? '' : 's'}</span>
                  \${e.category ? \`<span class="badge">\${esc(e.category)}</span>\` : ''}
                </span>
              </button>\`;
          }).join('');
          listSelectorHtml = \`<div id="wiki-list-wrap" class="wiki-list-wrap"><div id="wiki-page-list" class="wiki-page-list" role="listbox" aria-label="Wiki pages">\${listRows}</div></div>\`;
        } else {
          listSelectorHtml = '<div class="muted" style="margin-bottom:10px;">No wiki pages in this group.</div>';
        }
      }
      resultsEl.innerHTML = \`
        \${listSelectorHtml}
        \${activeEntry ? \`
          <div id="wiki-doc-pane" class="\${animateWikiDoc ? 'md-reveal' : ''}" style="border-top:1px solid var(--hud-border);padding-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
              <div style="font-weight:600;font-size:14px;">\${esc(activeEntry.title)}</div>
              <span class="badge">\${esc(activeEntry.category)}</span>
            </div>
            \${activeEntry.tags?.length ? \`<div class="muted" style="margin:4px 0;font-size:12px;">Tags: \${activeEntry.tags.map((t) => \`<code>\${esc(t)}</code>\`).join(' ')}</div>\` : ''}
            <div class="wiki-markdown-body" style="margin-top:8px;">\${renderSafeMarkdown(activeEntry.body || '')}</div>
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
              <div id="wiki-explorer-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
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
            <div class="muted" style="font-size:12px;margin-top:4px;">Persistent repository guardrails from <code>omagy_wiki/agreements.md</code></div>
            \${agBoxes ? \`<div class="agreement-grid">\${agBoxes}</div>\` : '<div class="muted" style="margin-top:6px;">No working agreements recorded yet.</div>'}
          </details>
        \`;
      }
      const lintCard = document.getElementById('wiki-lint-card');
      if (lintCard) {
        lintCard.innerHTML = \`
          <div style="font-weight:600;margin-bottom:6px;">Read-Only Wiki Lint</div>
          \${lintIssues.length ? \`<ul style="margin:0;padding-left:18px;">\${lintIssues.map((i) => \`<li>\${i}</li>\`).join('')}</ul>\` : '<div class="muted">All wiki pages pass frontmatter, link, and index checks.</div>'}
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
  </script>
</body>
</html>`;
}

export const HUD_HTML = renderHudHtml();
