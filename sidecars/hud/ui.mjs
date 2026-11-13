// oh-my-agy HUD UI Module (zero-dependency HTML/CSS/JS renderer for Antigravity Auxiliary Pane).
// Provides pure .toString()-shared helpers (buildSkillCommandWithFlags, buildSubagentInvokeSnippet,
// renderSafeMarkdown, prepareLoftSrcdoc) and interactive SSE + Slide-Over Artifact Drawer UI.

import { renderHudClientScript } from './client.mjs';

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

    if (/^<\/[A-Z][a-z]+(?:_[A-Z][a-z]+)*>$/.test(trimmed)) {
      i += 1;
      continue;
    }

    const sdoTagMatch = /^<([A-Z][a-z]+(?:_[A-Z][a-z]+)*)>$/.exec(trimmed);
    if (sdoTagMatch) {
      const rawTag = sdoTagMatch[1];
      const tagLevel = (rawTag === 'Good' || rawTag === 'Bad') ? 4 : 3;
      out.push(`<h${tagLevel} class="md-h${tagLevel}">${escHtml(rawTag.replace(/_/g, ' '))}</h${tagLevel}>`);
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
      && !/^<\/?[A-Z][a-z]+(?:_[A-Z][a-z]+)*>$/.test(lines[i].trim())
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
  return `<div class="agreement-box${a?.expired ? ' is-expired' : ''}">`
    + '<div class="row-between-sm mb-sm">'
    + '<div class="row-wrap">'
    + `<code class="badge">${escHtml(verId || `#${idx + 1}`)}</code>`
    + `<span class="${authorCls}">${escHtml(a?.author || 'agent')}</span>`
    + (a?.expired ? '<span class="badge badge-danger">expired</span>' : (expiresLabel ? `<span class="badge tabular">expires ${escHtml(expiresLabel)}</span>` : ''))
    + '</div>'
    + (dateStr ? `<span class="muted tabular fs-12">${escHtml(dateStr)}</span>` : '')
    + '</div>'
    + `<div class="agreement-body${a?.expired ? ' line-through' : ''}">${formattedBody}</div>`
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

export function buildTaskDagWaves(tasks = []) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && t.id) : [];
  if (!list.length) return [];
  const byId = new Map();
  for (const t of list) byId.set(String(t.id), t);
  const depsById = new Map();
  for (const t of list) {
    const id = String(t.id);
    const rawDeps = Array.isArray(t.dependsOn)
      ? t.dependsOn
      : (Array.isArray(t.depends_on) ? t.depends_on : (Array.isArray(t.blocked_by) ? t.blocked_by : []));
    const validDeps = [...new Set(rawDeps.map(String))].filter((d) => d !== id && byId.has(d));
    depsById.set(id, validDeps);
  }
  const placed = new Set();
  const waves = [];
  for (let pass = 0; pass < list.length && placed.size < list.length; pass += 1) {
    const wave = [];
    for (const t of list) {
      const id = String(t.id);
      if (placed.has(id)) continue;
      const deps = depsById.get(id) || [];
      if (deps.every((d) => placed.has(d))) wave.push(t);
    }
    if (!wave.length) break;
    waves.push(wave);
    for (const t of wave) placed.add(String(t.id));
  }
  const cyclic = list.filter((t) => !placed.has(String(t.id)));
  if (cyclic.length) {
    waves.push(cyclic.map((t) => ({ ...t, _cycle: true })));
  }
  return waves;
}

export function buildBacklinksIndex(wikiPages = []) {
  const pages = Array.isArray(wikiPages) ? wikiPages : [];
  const sets = new Map();
  const addEdge = (src, tgt) => {
    const s = String(src || '').trim();
    const t = String(tgt || '').trim();
    if (!s || !t || s === t) return;
    if (!sets.has(t)) sets.set(t, new Set());
    sets.get(t).add(s);
  };
  for (const p of pages) {
    if (!p || !p.slug) continue;
    const srcSlug = String(p.slug).trim();
    if (Array.isArray(p.links)) {
      for (const t of p.links) addEdge(srcSlug, t);
    }
    const rawBody = String(p.body || p.raw || '');
    if (rawBody) {
      const stripped = rawBody.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
      const re = /\[\[([a-zA-Z0-9_-]+)(?:\|[^\]\n]+)?\]\]/g;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        addEdge(srcSlug, m[1]);
      }
    }
  }
  const out = {};
  for (const [targetSlug, srcSet] of [...sets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[targetSlug] = [...srcSet].sort();
  }
  return out;
}

export function extractMarkdownToc(markdownText = '') {
  let body = String(markdownText ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return [];
  const fmMatch = /^---\n([\s\S]*?)\n---(?:\n+|$)/.exec(body);
  if (fmMatch) body = body.slice(fmMatch[0].length);
  const lines = body.split('\n');
  const toc = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const hm = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (!hm) continue;
    const cleanText = hm[2]
      .replace(/\[\[([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g, (_m, s, lbl) => (lbl ? lbl.trim() : s))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim();
    if (cleanText) {
      toc.push({ level: hm[1].length, text: cleanText, index: toc.length });
    }
  }
  return toc;
}

export function buildCommandPaletteItems(snapshot = {}) {
  const items = [];
  const views = Array.isArray(snapshot?.allowedViews) && snapshot.allowedViews.length
    ? snapshot.allowedViews
    : ['overview', 'workflows', 'skills', 'subagents', 'wiki'];
  for (const v of views) {
    const name = String(v || '').trim();
    if (!name) continue;
    items.push({
      id: `view:${name}`,
      title: `Switch to ${name.charAt(0).toUpperCase() + name.slice(1)}`,
      subtitle: 'HUD Tab',
      category: 'views',
      action: { type: 'view', target: name },
    });
  }
  for (const s of Array.isArray(snapshot?.catalog?.skills) ? snapshot.catalog.skills : []) {
    if (!s?.name) continue;
    items.push({
      id: `skill:${s.name}`,
      title: `/${s.name}`,
      subtitle: String(s.howToUse || s.category || 'Skill'),
      category: 'skills',
      action: { type: 'skill', target: String(s.name) },
    });
  }
  for (const a of Array.isArray(snapshot?.catalog?.subagents) ? snapshot.catalog.subagents : []) {
    if (!a?.name) continue;
    items.push({
      id: `subagent:${a.name}`,
      title: String(a.name),
      subtitle: String(a.whenToUse || a.lane || 'Role Subagent'),
      category: 'subagents',
      action: { type: 'subagent', target: String(a.name) },
    });
  }
  const seenArt = new Set();
  const addArt = (relFile, title, kind) => {
    const f = String(relFile || '').trim();
    if (!f || seenArt.has(f)) return;
    seenArt.add(f);
    items.push({
      id: `artifact:${f}`,
      title: String(title || f),
      subtitle: `${kind}: ${f}`,
      category: 'artifacts',
      action: { type: 'artifact', target: f, title: String(title || f), kind: String(kind || 'artifact') },
    });
  };
  for (const p of Array.isArray(snapshot?.reviews?.ralplan?.planningArtifacts) ? snapshot.reviews.ralplan.planningArtifacts : []) {
    addArt(p, p.split('/').pop(), 'ralplan');
  }
  for (const c of Array.isArray(snapshot?.reviews?.codeReviews) ? snapshot.reviews.codeReviews : []) {
    addArt(c?.file, c?.file?.split('/').pop(), 'review');
  }
  for (const r of Array.isArray(snapshot?.research) ? snapshot.research : []) {
    addArt(r?.file, r?.title, 'research');
  }
  for (const kind of ['plans', 'specs', 'handoffs', 'ideas', 'asks']) {
    for (const item of Array.isArray(snapshot?.artifacts?.[kind]) ? snapshot.artifacts[kind] : []) {
      addArt(item?.file, item?.title, kind);
    }
  }
  if (snapshot?.ultragoal?.briefPath) addArt(snapshot.ultragoal.briefPath, 'Ultragoal Brief', 'ultragoal');
  if (snapshot?.ultragoal?.notepadPath) addArt(snapshot.ultragoal.notepadPath, 'Ultragoal Notepad', 'ultragoal');
  for (const e of Array.isArray(snapshot?.wiki?.entries) ? snapshot.wiki.entries : []) {
    if (!e?.slug) continue;
    items.push({
      id: `wiki:${e.slug}`,
      title: String(e.title || e.slug),
      subtitle: `omagy_wiki/${e.slug}.md (${e.category || 'wiki'})`,
      category: 'wiki',
      action: { type: 'wiki', target: String(e.slug) },
    });
  }
  return items;
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

export function renderHudHtml(customClientRenderer = renderHudClientScript) {
  const clientRenderer = typeof customClientRenderer === 'function' ? customClientRenderer : renderHudClientScript;
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
    buildTaskDagWaves.toString(),
    buildBacklinksIndex.toString(),
    extractMarkdownToc.toString(),
    buildCommandPaletteItems.toString(),
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
      --z-palette-backdrop: 110;
      --z-palette: 120;
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
      --hud-shadow-card: none;
      --hud-img-outline: oklch(100% 0 0 / 0.14);
      --hud-shadow-drawer: -12px 0 32px rgba(0, 0, 0, 0.42);
      --wiki-cat-architecture: #3b82f6; --wiki-cat-architecture-hi: #dbeafe; --wiki-cat-architecture-rim: #1e3a8a;
      --wiki-cat-pattern: #10b981; --wiki-cat-pattern-hi: #d1fae5; --wiki-cat-pattern-rim: #065f46;
      --wiki-cat-convention: #8b5cf6; --wiki-cat-convention-hi: #ede9fe; --wiki-cat-convention-rim: #4c1d95;
      --wiki-cat-reference: #06b6d4; --wiki-cat-reference-hi: #cffafe; --wiki-cat-reference-rim: #155e75;
      --wiki-cat-decision: #f59e0b; --wiki-cat-decision-hi: #fef3c7; --wiki-cat-decision-rim: #78350f;
      --wiki-cat-debugging: #ef4444; --wiki-cat-debugging-hi: #fee2e2; --wiki-cat-debugging-rim: #7f1d1d;
      --wiki-cat-environment: #14b8a6; --wiki-cat-environment-hi: #ccfbf1; --wiki-cat-environment-rim: #134e4a;
      --wiki-cat-session-log: #ec4899; --wiki-cat-session-log-hi: #fce7f3; --wiki-cat-session-log-rim: #831843;
      --wiki-cat-default: #64748b; --wiki-cat-default-hi: #f1f5f9; --wiki-cat-default-rim: #1e293b;
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
        --hud-shadow-card: 0 1px 3px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04);
        --hud-img-outline: oklch(0% 0 0 / 0.10);
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
      --hud-shadow-card: 0 1px 3px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04);
      --hud-img-outline: oklch(0% 0 0 / 0.10);
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
      box-shadow: var(--hud-shadow-card);
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
      transform-origin: 0 0;
      transform: translate3d(0, 0, 0) scale(1, 1);
      transition:
        transform var(--dur-short) var(--ease-out),
        opacity var(--dur-micro) var(--ease-out);
      will-change: transform, opacity;
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
      transition: background-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
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
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      text-decoration: none;
      white-space: nowrap;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
      transition: background-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
    }
    .action-btn:hover {
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .action-btn:active:not(:disabled),
    .chip-btn:active:not(:disabled) {
      transform: scale(0.96);
      transition-duration: var(--dur-press);
      transition-timing-function: var(--ease-in);
    }
    .tab-btn:active:not(:disabled),
    .wiki-mode-btn:active:not(:disabled) {
      transform: none;
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
      animation: hudContentReveal 160ms var(--ease-out);
    }
    .btn-morph-label {
      display: inline-block;
      animation: hudContentReveal 160ms var(--ease-out);
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
      animation-play-state: paused;
    }
    .wf-arrow-pulse {
      fill: var(--hud-primary);
      opacity: 0;
      animation: wfPulseTravel 2.2s cubic-bezier(0.35, 0, 0.25, 1) infinite;
      animation-delay: calc(var(--wf-step-i, 0) * 320ms);
      animation-play-state: paused;
    }
    .wf-arrow-head {
      stroke: var(--hud-primary);
      stroke-opacity: 0.82;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 150ms var(--ease-out), stroke-opacity 150ms var(--ease-out);
    }
    .wf-card:hover .wf-arrow-idle .wf-arrow-stream,
    .wf-card:focus-within .wf-arrow-idle .wf-arrow-stream {
      opacity: 0.95;
      animation-play-state: running;
    }
    .wf-card:hover .wf-arrow-idle .wf-arrow-pulse,
    .wf-card:focus-within .wf-arrow-idle .wf-arrow-pulse {
      animation-play-state: running;
    }
    .wf-arrow-active {
      color: var(--hud-primary);
    }
    .wf-arrow-active .wf-arrow-stream {
      stroke: var(--hud-primary);
      stroke-width: 2;
      opacity: 1;
      animation-duration: 0.95s;
      animation-play-state: running;
    }
    .wf-arrow-active .wf-arrow-pulse {
      fill: var(--hud-primary);
      animation-duration: 1.45s;
      animation-delay: 0ms;
      animation-play-state: running;
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
      background: var(--wiki-cat-default);
    }
    .wiki-cat-dot[data-cat="architecture"] { background: var(--wiki-cat-architecture); }
    .wiki-cat-dot[data-cat="pattern"] { background: var(--wiki-cat-pattern); }
    .wiki-cat-dot[data-cat="convention"] { background: var(--wiki-cat-convention); }
    .wiki-cat-dot[data-cat="reference"] { background: var(--wiki-cat-reference); }
    .wiki-cat-dot[data-cat="decision"] { background: var(--wiki-cat-decision); }
    .wiki-cat-dot[data-cat="debugging"] { background: var(--wiki-cat-debugging); }
    .wiki-cat-dot[data-cat="environment"] { background: var(--wiki-cat-environment); }
    .wiki-cat-dot[data-cat="session-log"] { background: var(--wiki-cat-session-log); }
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
      min-width: 28px;
      min-height: 28px;
      height: 28px;
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid var(--hud-border);
      background: var(--hud-card);
      color: var(--hud-muted);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.25;
      transition: background-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), transform 150ms var(--ease-out);
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
    @media (prefers-reduced-motion: reduce) {
      .badge,
      .tab-btn,
      .tab-pill-indicator,
      .chip-btn,
      .action-btn,
      .hud-select,
      .md-copy-btn,
      .wiki-mm-btn,
      .wiki-mode-btn,
      .wiki-page-item,
      .wiki-path-pill,
      .wiki-toc-chip,
      .wf-step,
      .wf-arrow-head,
      .bar-fill,
      .wiki-link-pill,
      .list-row-card,
      .artifact-row,
      .drawer-backdrop,
      .artifact-drawer,
      .cmd-palette-backdrop,
      .cmd-palette,
      .cmd-palette-item,
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
    table.hud-table .col-id { width: 46px; white-space: nowrap; }
    table.hud-table .col-main { width: auto; }
    table.hud-table .col-status { width: 148px; text-align: right; white-space: normal; }
    table.hud-table .col-event { width: 38%; }
    .status-cell-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      flex-wrap: wrap;
    }
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

    /* Slide-Over Artifact Drawer (Interruptible CSS transitions) */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: var(--hud-scrim);
      z-index: var(--z-backdrop);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 180ms var(--ease-out), visibility 0ms linear 180ms;
    }
    .drawer-backdrop.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 200ms var(--ease-out), visibility 0ms linear 0ms;
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
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(100%, 0, 0);
      transition: transform 240ms var(--ease-out), opacity 180ms var(--ease-out), visibility 0ms linear 240ms;
    }
    .artifact-drawer.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(0, 0, 0);
      transition: transform 240ms var(--ease-out), opacity 180ms var(--ease-out), visibility 0ms linear 0ms;
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
      outline: 1px solid var(--hud-img-outline);
      outline-offset: -1px;
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

    /* Consolidated layout & typography helpers */
    .row-gap-xs { display: flex; align-items: center; gap: 4px; }
    .row-gap-sm { display: flex; align-items: center; gap: 6px; }
    .row-gap-md { display: flex; align-items: center; gap: 8px; }
    .row-wrap { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .row-wrap-sm { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .row-between-sm { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
    .row-between-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .flex-1-min0 { min-width: 0; flex: 1 1 auto; }
    .flex-1-160 { min-width: 0; flex: 1 1 160px; }
    .min0 { min-width: 0; }
    .fw-600 { font-weight: 600; }
    .fs-12 { font-size: 12px; }
    .fs-13 { font-size: 13px; }
    .fs-14 { font-size: 14px; }
    .mono-xs { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .wrap-anywhere { overflow-wrap: anywhere; }
    .mt-0 { margin-top: 0; }
    .mt-xxs { margin-top: 2px; }
    .mt-xs { margin-top: 4px; }
    .mt-sm { margin-top: 6px; }
    .mt-md { margin-top: 8px; }
    .mt-lg { margin-top: 10px; }
    .mb-0 { margin-bottom: 0; }
    .mb-xs { margin-bottom: 4px; }
    .mb-sm { margin-bottom: 6px; }
    .mb-md { margin-bottom: 8px; }
    .mb-lg { margin-bottom: 10px; }
    .my-md { margin: 8px 0; }
    .stack-sm { display: grid; gap: 6px; }
    .w-full { width: 100%; }
    .w-auto { width: auto; }
    .select-compact { width: auto; padding: 3px 6px; }
    .hud-top-bar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px 12px;
      flex-wrap: wrap;
      padding-bottom: 12px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--hud-border);
    }
    #main-tab-bar {
      margin-bottom: 14px;
    }
    .hud-select-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      max-width: 185px;
      min-width: 0;
    }
    .hud-select-wrap.hidden-pane {
      display: none;
    }
    .hud-select {
      appearance: none;
      -webkit-appearance: none;
      cursor: pointer;
      width: 100%;
      max-width: 185px;
      padding: 5px 24px 5px 26px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      color: var(--hud-fg);
      transition: background-color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out);
    }
    .hud-select:hover {
      background: var(--hud-surface-hover);
      border-color: var(--hud-border-strong);
    }
    .hud-select option {
      background: var(--hud-card);
      color: var(--hud-fg);
    }
    .hud-select-icon,
    .hud-select-chevron {
      position: absolute;
      pointer-events: none;
      color: var(--hud-muted);
      flex-shrink: 0;
    }
    .hud-select-icon { left: 8px; }
    .hud-select-chevron { right: 8px; }
    .section-divider-top { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hud-border); }
    .drawer-controls-bar { padding: 8px 14px; border-bottom: 1px solid var(--hud-border); display: none; }
    .hidden-pane { display: none; }
    .is-expired { opacity: 0.6; }
    .line-through { text-decoration: line-through; }
    .bar-track-thin { height: 6px; }
    .ul-compact { margin: 0; padding-left: 18px; }
    .pointer { cursor: pointer; }
    .dag-waves {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 0 6px;
      margin-bottom: 8px;
    }
    .dag-wave-col {
      flex: 0 0 auto;
      min-width: 148px;
      max-width: 210px;
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      padding: 6px 8px;
      background: var(--hud-input-bg);
    }
    .dag-wave-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--hud-muted);
      margin-bottom: 5px;
    }
    .dag-node {
      border: 1px solid var(--hud-border);
      border-radius: 6px;
      padding: 5px 7px;
      margin-bottom: 4px;
      background: var(--hud-card);
      font-size: 12px;
    }
    .dag-node:last-child { margin-bottom: 0; }
    .launchpad-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .launchpad-item {
      border: 1px solid var(--hud-border);
      border-radius: 8px;
      padding: 8px 10px;
      background: var(--hud-surface-subtle);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 6px;
    }
    .cmd-palette-backdrop {
      position: fixed;
      inset: 0;
      background: var(--hud-scrim);
      z-index: var(--z-palette-backdrop);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 150ms var(--ease-out), visibility 0ms linear 150ms;
    }
    .cmd-palette-backdrop.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 160ms var(--ease-out), visibility 0ms linear 0ms;
    }
    .cmd-palette {
      position: fixed;
      top: min(12vh, 80px);
      left: 50%;
      width: min(calc(100vw - 24px), 620px);
      max-height: min(76vh, 520px);
      display: flex;
      flex-direction: column;
      background: var(--hud-card);
      border: 1px solid var(--hud-border-strong);
      border-radius: 12px;
      box-shadow: var(--hud-shadow-drawer);
      z-index: var(--z-palette);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translate3d(-50%, -8px, 0) scale(0.98);
      transition: transform 180ms var(--ease-out), opacity 150ms var(--ease-out), visibility 0ms linear 180ms;
      overflow: hidden;
    }
    .cmd-palette.is-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate3d(-50%, 0, 0) scale(1);
      transition: transform 180ms var(--ease-out), opacity 150ms var(--ease-out), visibility 0ms linear 0ms;
    }
    .cmd-palette-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--hud-border);
      background: var(--hud-sidebar);
    }
    .cmd-palette-input {
      flex: 1 1 auto;
      margin-bottom: 0;
      width: auto;
    }
    .cmd-palette-list {
      overflow-y: auto;
      max-height: 420px;
      padding: 6px;
    }
    .cmd-palette-item {
      width: 100%;
      text-align: left;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid transparent;
      cursor: pointer;
      color: var(--hud-fg);
      transition: background-color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
    }
    .cmd-palette-item:hover,
    .cmd-palette-item.is-selected {
      background: var(--hud-primary-tint);
      border-color: var(--hud-primary-border);
    }
    .cmd-kbd {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid var(--hud-border);
      background: var(--hud-surface-subtle);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--hud-muted);
    }
    .wiki-toc-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 8px 0;
      padding: 6px 8px;
      border-radius: 8px;
      background: var(--hud-surface-subtle);
      border: 1px solid var(--hud-border);
    }
    .wiki-toc-chip {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 5px;
      border: 1px solid var(--hud-border);
      background: var(--hud-card);
      color: var(--hud-muted);
      font-size: 12px;
      transition: color var(--dur-micro) var(--ease-out), border-color var(--dur-micro) var(--ease-out);
    }
    .wiki-toc-chip:hover {
      color: var(--hud-fg);
      border-color: var(--hud-border-strong);
    }
    .wiki-backlinks {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--hud-border);
    }
    .scope-chip {
      cursor: pointer;
    }
    .scope-chip.is-active {
      border-color: var(--hud-primary-border);
      background: var(--hud-primary-tint);
      color: var(--hud-primary-ink);
    }
  </style>
</head>
<body>
  <div id="hud-main-shell">
    <div class="hud-top-bar">
      <div>
        <div class="row-gap-sm">
          <span class="fw-600 fs-14">Oh My Agy</span>
          <span id="sse-status-pill" class="badge tabular" title="Live Server-Sent Events connection status">INIT</span>
        </div>
        <div id="status-line" class="muted mono-xs">[OMA] Loading&hellip;</div>
      </div>
      <div id="header-actions" class="row-wrap-sm">
        <div id="workspace-select-wrap" class="hud-select-wrap hidden-pane">
          <svg class="hud-select-icon" width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h2.35l1.3 1.4H11A1.25 1.25 0 0 1 12.25 5.15v5.1A1.25 1.25 0 0 1 11 11.5H3a1.25 1.25 0 0 1-1.25-1.25v-6.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>
          <select id="workspace-root-select" class="hud-select" aria-label="Active workspace root" onchange="onWorkspaceRootChange(this.value)"></select>
          <svg class="hud-select-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <button id="cmd-palette-btn" type="button" class="action-btn" onclick="openCommandPalette()" title="Command Palette (Cmd/Ctrl+K)"><span>Search</span><span class="cmd-kbd">&#8984;K</span></button>
        <button id="handoff-btn" type="button" class="action-btn" onclick="runQuickCommand(this, '/hud --handoff', 'active-chat')" title="Create session handoff artifact"><span>Handoff</span></button>
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
    <div id="view-workflows" class="view-pane hidden-pane"></div>
    <div id="view-skills" class="view-pane hidden-pane"></div>
    <div id="view-subagents" class="view-pane hidden-pane"></div>
    <div id="view-wiki" class="view-pane hidden-pane"></div>
  </div>

  <div id="artifact-drawer-backdrop" class="drawer-backdrop" aria-hidden="true" onclick="closeArtifactDrawer()"></div>
  <aside id="artifact-drawer" class="artifact-drawer" role="dialog" aria-modal="true" aria-labelledby="artifact-drawer-title" aria-hidden="true">
    <div class="drawer-header">
      <div class="flex-1-min0">
        <div id="artifact-drawer-title" class="fw-600 fs-13 wrap-anywhere">Artifact Preview</div>
        <div id="artifact-drawer-sub" class="muted mono-xs"></div>
      </div>
      <button type="button" id="artifact-drawer-close" class="action-btn" onclick="closeArtifactDrawer()" aria-label="Close drawer">Close (Esc)</button>
    </div>
    <div id="artifact-drawer-controls" class="drawer-controls-bar"></div>
    <div id="artifact-drawer-body" class="drawer-body"></div>
  </aside>

  <div id="cmd-palette-backdrop" class="cmd-palette-backdrop" aria-hidden="true" onclick="closeCommandPalette()"></div>
  <div id="cmd-palette" class="cmd-palette" role="dialog" aria-modal="true" aria-label="HUD Command Palette" aria-hidden="true">
    <div class="cmd-palette-head">
      <input id="cmd-palette-input" type="search" class="search-input cmd-palette-input" placeholder="Jump to tab, skill, subagent, artifact, or wiki page&hellip;" autocomplete="off" />
      <button type="button" class="action-btn" onclick="closeCommandPalette()">Esc</button>
    </div>
    <div id="cmd-palette-list" class="cmd-palette-list" role="listbox"></div>
  </div>

  <script>
    ${clientRenderer(sharedHelpersSource, ALLOWED_VIEWS)}
    </script>
</body>
</html>`;
}

export const HUD_HTML = renderHudHtml();
