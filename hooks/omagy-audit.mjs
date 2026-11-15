// Cold-path repository audit CLI and wiki/structure scanners for oh-my-agy.
// Loaded lazily from `omagy-cli.mjs` and `omagy-skill.mjs`; never imported statically by `omagy-hook.mjs`.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CODE_EXTENSIONS, redactSecrets, stripUtf8Bom } from './omagy-hook.mjs';

const SKIP_SCAN_DIRS = new Set([
  '.git', '.hg', '.svn', '.omagy', 'omagy_wiki', 'node_modules', 'dist', 'build', 'out',
  'coverage', 'vendor', 'target', '__pycache__', '.next', '.nuxt', '.venv', 'venv',
]);
const META_WIKI_PAGES = new Set(['index.md', 'agreements.md', 'log.md']);
const MIGRATION_FILE_RE = /\.(?:sql|ts|js|mjs|cjs|py)$/i;
const WORKFLOW_FILE_RE = /\.ya?ml$/i;
const TEST_FILE_RE = /(?:^|[/\\])(?:__tests__[/\\]|tests?[/\\])|\.(?:test|spec)\.[cm]?[jt]sx?$|\b(?:selftest|test_[a-z0-9_]+|[a-z0-9_]+_test)\.[cm]?[jt]s$|(?:^|[/\\])test_[^/\\]+\.py$|\b_test\.py$/i;
const RUNTIME_ENV_IGNORE = new Set([
  'NODE_ENV', 'PATH', 'HOME', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TERM', 'PWD',
  'OLDPWD', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'CI', 'COLORTERM', 'FORCE_COLOR',
  'NO_COLOR', 'TZ', 'HOSTNAME', 'PORT', 'HOST', 'COMSPEC', 'SYSTEMROOT', 'USERPROFILE',
]);

const strArg = (x) => (typeof x === 'string' ? x.trim() : '');
const toPosix = (p) => p.replace(/\\/g, '/');
const isDir = (p) => { try { return Boolean(p) && fs.statSync(p).isDirectory(); } catch { /* fail open: missing dir */ return false; } };
const isFile = (p) => { try { return Boolean(p) && fs.statSync(p).isFile(); } catch { /* fail open: missing file */ return false; } };
const listEntries = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.isSymbolicLink()); } catch { /* fail open: unreadable dir */ return []; } };
const readUtf8 = (p) => stripUtf8Bom(fs.readFileSync(p, 'utf8'));
const gitOut = (cwd, args, extra = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 16 * 1024 * 1024, ...extra });

function blankFencedLines(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let fence = '';
  return lines.map((line) => {
    const trimmed = line.trim();
    const open = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (!fence && open) { fence = open[1][0].repeat(open[1].length); return ''; }
    if (fence && trimmed.startsWith(fence) && trimmed.slice(fence.length).trim() === '') { fence = ''; return ''; }
    return fence ? '' : line;
  });
}

function collectFiles(absRoot, filterFn, limit = 3000) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 8) return;
    for (const e of listEntries(dir)) {
      if (out.length >= limit) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_SCAN_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && filterFn(full, e.name)) {
        out.push(full);
      }
    }
  };
  walk(absRoot, 0);
  return out;
}

function parseAuditArgs(rawArgs = []) {
  let dir = '';
  let baseRef = '';
  let json = false;
  let endOfFlags = false;
  const positional = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = String(rawArgs[i] ?? '');
    if (!endOfFlags && a === '--') { endOfFlags = true; continue; }
    if (!endOfFlags && a === '--json') { json = true; continue; }
    if (!endOfFlags && (a === '-C' || a === '--dir' || a === '--root')) {
      if (i + 1 >= rawArgs.length || String(rawArgs[i + 1] ?? '').startsWith('-')) return { ok: false, error: `missing_flag_value:${a}` };
      dir = rawArgs[++i];
      continue;
    }
    if (!endOfFlags && (a.startsWith('--dir=') || a.startsWith('--root='))) {
      const val = a.slice(a.indexOf('=') + 1);
      if (!val) return { ok: false, error: `missing_flag_value:${a.split('=')[0]}` };
      dir = val;
      continue;
    }
    if (!endOfFlags && (a === '--base' || a === '--base-ref')) {
      if (i + 1 >= rawArgs.length || String(rawArgs[i + 1] ?? '').startsWith('-')) return { ok: false, error: `missing_flag_value:${a}` };
      baseRef = rawArgs[++i];
      continue;
    }
    if (!endOfFlags && (a.startsWith('--base=') || a.startsWith('--base-ref='))) {
      const val = a.slice(a.indexOf('=') + 1);
      if (!val || val.startsWith('-')) return { ok: false, error: val ? `invalid_base_ref:${val}` : `missing_flag_value:${a.split('=')[0]}` };
      baseRef = val;
      continue;
    }
    if (!endOfFlags && a.startsWith('-')) return { ok: false, error: `unknown_flag:${a}` };
    positional.push(a);
  }
  if (!dir && positional[0]) dir = positional[0];
  if (!baseRef && positional[1]) baseRef = positional[1];
  if (baseRef && baseRef.startsWith('-')) return { ok: false, error: `invalid_base_ref:${baseRef}` };
  return { ok: true, rootDir: dir || process.cwd(), baseRef, json };
}

export function walkWikiMd(absWiki, skipIndex = false) {
  const out = [];
  const walk = (d) => {
    for (const e of listEntries(d)) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && e.name.endsWith('.md') && (!skipIndex || e.name !== 'index.md')) out.push(f);
    }
  };
  walk(absWiki);
  return out;
}

export function scanInitDeepCandidates(rootDir = process.cwd()) {
  if (!strArg(rootDir)) return { ok: false, exitCode: 2, root: '', commitCount: 0, candidates: [], error: 'missing_root_dir' };
  const absRoot = path.resolve(rootDir);
  if (!isDir(absRoot)) return { ok: false, exitCode: 2, root: absRoot, commitCount: 0, candidates: [], error: 'missing_root_dir' };

  const stats = new Map();
  const opsDirs = new Map();
  let files = 0;

  const bumpStat = (key, loc) => {
    const r = stats.get(key) || { codeFiles: 0, loc: 0 };
    r.codeFiles += 1;
    r.loc += loc;
    stats.set(key, r);
  };

  const countLocSafe = (full) => {
    try {
      if (fs.statSync(full).size > 524288) return null;
      return fs.readFileSync(full, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
    } catch { /* fail open: unreadable file */ return null; }
  };

  const walk = (dir, parts) => {
    if (files >= 4000 || parts.length > 6) return;
    const inWf = parts[0] === '.github' && parts[1] === 'workflows';
    const inMig = parts.some((p) => p.toLowerCase() === 'migrations');
    for (const e of listEntries(dir)) {
      if (files >= 4000) break;
      if (e.isDirectory()) {
        const allowDot = parts.length === 0 && e.name === '.github';
        if ((allowDot || !e.name.startsWith('.')) && !SKIP_SCAN_DIRS.has(e.name)) {
          walk(path.join(dir, e.name), [...parts, e.name]);
        }
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const isRootDocker = parts.length === 0 && /^(?:dockerfile(?:\.[^/]+)?|(?:docker-)?compose\.ya?ml)$/i.test(e.name);
        if (isRootDocker) {
          const loc = countLocSafe(path.join(dir, e.name));
          if (loc !== null) {
            files += 1;
            const cur = opsDirs.get('.') || { codeFiles: 0, loc: 0 };
            cur.codeFiles += 1; cur.loc += loc; opsDirs.set('.', cur);
          }
          continue;
        }
        if (inWf && WORKFLOW_FILE_RE.test(e.name)) {
          const loc = countLocSafe(path.join(dir, e.name));
          if (loc !== null) {
            files += 1;
            const k = '.github/workflows';
            const cur = opsDirs.get(k) || { codeFiles: 0, loc: 0 };
            cur.codeFiles += 1; cur.loc += loc; opsDirs.set(k, cur);
          }
          continue;
        }
        if (parts.length >= 1 && (CODE_EXTENSIONS.has(ext) || (inMig && MIGRATION_FILE_RE.test(e.name)))) {
          const loc = countLocSafe(path.join(dir, e.name));
          if (loc === null) continue;
          files += 1;
          for (let d = 1; d <= Math.min(3, parts.length); d += 1) bumpStat(parts.slice(0, d).join('/'), loc);
          if (inMig) {
            const migIdx = parts.findIndex((p) => p.toLowerCase() === 'migrations');
            const migKey = parts.slice(0, migIdx + 1).join('/');
            const cur = opsDirs.get(migKey) || { codeFiles: 0, loc: 0 };
            cur.codeFiles += 1; cur.loc += loc; opsDirs.set(migKey, cur);
          }
        }
      }
    }
  };
  walk(absRoot, []);

  let commitCount = 0; let sampled = 0; const touches = new Map();
  try {
    commitCount = Number(gitOut(absRoot, ['rev-list', '--count', 'HEAD']).trim()) || 0;
    if (commitCount > 0) {
      for (const blk of gitOut(absRoot, ['-c', 'core.quotepath=false', 'log', '-n', '100', '--pretty=format:__C__', '--name-only']).split('__C__').slice(1)) {
        sampled += 1;
        const hit = new Set();
        for (const f of blk.split(/\r?\n/)) {
          const s = f.trim().split('/').filter(Boolean);
          if (s.length >= 2 && (s[0] === '.github' || !s[0].startsWith('.')) && !SKIP_SCAN_DIRS.has(s[0])) {
            for (let d = 1; d <= Math.min(3, s.length - 1); d += 1) hit.add(s.slice(0, d).join('/'));
          }
        }
        for (const d of hit) touches.set(d, (touches.get(d) || 0) + 1);
      }
    }
  } catch { /* fail open: non-git directory has 0 churn */ }

  const allKeys = new Set([...stats.keys(), ...opsDirs.keys()]);
  const candidates = [];
  for (const dir of allKeys) {
    const info = stats.get(dir) || opsDirs.get(dir);
    const opsInfo = opsDirs.get(dir);
    const churnPct = sampled > 0 ? Math.round(((touches.get(dir) || 0) / sampled) * 1000) / 10 : 0;
    const reasons = [];
    if (info.codeFiles >= 8 && info.loc >= 500) reasons.push('density');
    if (commitCount >= 30 && churnPct >= 15 && info.codeFiles >= 1 && dir !== '.') reasons.push('churn');
    if (opsInfo && opsInfo.codeFiles >= 1) reasons.push('ops-boundary');
    if (reasons.length) {
      candidates.push({
        dir,
        codeFiles: info.codeFiles,
        loc: info.loc,
        churnPct,
        reasons,
        hasAgentsMd: isFile(path.join(absRoot, dir, 'AGENTS.md')),
      });
    }
  }
  candidates.sort((a, b) => (b.loc + b.churnPct * 20 + (b.reasons.includes('ops-boundary') ? 100 : 0)) - (a.loc + a.churnPct * 20 + (a.reasons.includes('ops-boundary') ? 100 : 0)) || a.dir.localeCompare(b.dir));
  return { ok: true, exitCode: 0, root: absRoot, commitCount, candidates };
}

export function lintWikiPages(wikiDir, repoRoot = '') {
  const rawWiki = strArg(wikiDir);
  if (!rawWiki) return { ok: false, exitCode: 2, wikiDir: '', pagesScanned: 0, brokenWikiLinks: [], brokenFileRefs: [], isolatedPages: [], error: 'missing_wiki_dir' };
  const absWiki = path.resolve(rawWiki);
  if (!isDir(absWiki)) return { ok: false, exitCode: 2, wikiDir: absWiki, pagesScanned: 0, brokenWikiLinks: [], brokenFileRefs: [], isolatedPages: [], error: 'missing_wiki_dir' };

  const absRepo = strArg(repoRoot) ? path.resolve(String(repoRoot)) : path.dirname(absWiki);
  const mdFiles = walkWikiMd(absWiki, false);
  const validSlugs = new Set(mdFiles.flatMap((f) => [path.basename(f, '.md'), toPosix(path.relative(absWiki, f)).replace(/\.md$/i, '')]));
  const brokenWikiLinks = [];
  const brokenFileRefs = [];
  const inbound = new Set();
  const outbound = new Set();
  const lineCache = new Map();
  const fileRefRe = /(?<![A-Za-z0-9_/:.@$<>-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)(?:-(\d+))?\b/g;

  for (const full of mdFiles) {
    const relPage = toPosix(path.relative(absWiki, full));
    const pageSlug = path.basename(relPage, '.md');
    const relSlug = relPage.replace(/\.md$/i, '');
    const raw = readUtf8(full).replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(raw);
    const lines = blankFencedLines(fm ? `${'\n'.repeat(fm[0].split('\n').length - 1)}${raw.slice(fm[0].length)}` : raw);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) continue;
      const noCode = line.replace(/`+[^`]*`+/g, (m) => ' '.repeat(m.length));
      const wlRe = /\[\[([^\]|#\r\n]+)(?:[|#][^\]]*)?\]\]/g;
      let wm;
      while ((wm = wlRe.exec(noCode)) !== null) {
        const t = wm[1].trim().replace(/\.md$/i, '');
        if (!t || /[<>]/.test(t)) continue;
        if (validSlugs.has(t) || validSlugs.has(path.basename(t))) {
          const targetBase = path.basename(t);
          if (targetBase !== pageSlug && t !== relSlug) {
            inbound.add(targetBase);
            outbound.add(pageSlug);
          }
        } else {
          brokenWikiLinks.push({ page: relPage, line: i + 1, target: t, raw: wm[0] });
        }
      }
      fileRefRe.lastIndex = 0;
      let fr;
      while ((fr = fileRefRe.exec(line)) !== null) {
        const rf = fr[1];
        if (rf.includes('..') || /[*<>{}$]/.test(rf)) continue;
        const start = Number(fr[2]);
        const end = fr[3] ? Number(fr[3]) : start;
        const cand = path.resolve(absRepo, rf);
        if (cand !== absRepo && !cand.startsWith(absRepo + path.sep)) continue;
        if (!isFile(cand)) brokenFileRefs.push({ page: relPage, line: i + 1, ref: fr[0], file: rf, refLine: start, reason: 'missing_file' });
        else {
          if (!lineCache.has(cand)) lineCache.set(cand, readUtf8(cand).split(/\r?\n/).length);
          const tot = lineCache.get(cand);
          if (start < 1 || start > tot || end < start || end > tot) brokenFileRefs.push({ page: relPage, line: i + 1, ref: fr[0], file: rf, refLine: start, reason: 'line_out_of_range' });
        }
      }
    }
  }

  const isolatedPages = [];
  for (const full of mdFiles) {
    const relPage = toPosix(path.relative(absWiki, full));
    const baseName = path.basename(relPage).toLowerCase();
    if (META_WIKI_PAGES.has(baseName) || /^(?:archive|deleted)\//i.test(relPage)) continue;
    const slug = path.basename(relPage, '.md');
    if (!inbound.has(slug) && !outbound.has(slug)) isolatedPages.push(relPage);
  }
  isolatedPages.sort();

  const ok = !brokenWikiLinks.length && !brokenFileRefs.length;
  return { ok, exitCode: ok ? 0 : 1, wikiDir: absWiki, pagesScanned: mdFiles.length, brokenWikiLinks, brokenFileRefs, isolatedPages };
}

// ---------- docs-drift ----------
function extractRelativeImports(absFile, text) {
  const out = [];
  const re = /(?:import\s+(?:[^'"]+\s+from\s+)?|import\s*\(|require\s*\(|export\s+[^'"]*\s+from\s+)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const base = path.resolve(path.dirname(absFile), m[1]);
    for (const c of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.js'), path.join(base, 'index.mjs'), path.join(base, 'index.ts')]) {
      if (isFile(c)) { out.push(c); break; }
    }
  }
  return out;
}

export function runDocsDrift(rootDir = process.cwd()) {
  if (!strArg(rootDir)) return { ok: false, exitCode: 2, root: '', error: 'missing_root_dir' };
  const absRoot = path.resolve(rootDir);
  if (!isDir(absRoot)) return { ok: false, exitCode: 2, root: absRoot, error: 'missing_root_dir' };

  const pkgPath = path.join(absRoot, 'package.json');
  const pkg = isFile(pkgPath) ? (() => { try { return JSON.parse(readUtf8(pkgPath)); } catch { /* fail open: invalid package.json */ return null; } })() : null;
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? new Set(Object.keys(pkg.scripts)) : null;

  const makePath = path.join(absRoot, 'Makefile');
  let makeTargets = null;
  if (isFile(makePath)) {
    makeTargets = new Set();
    for (const line of readUtf8(makePath).split(/\r?\n/)) {
      const m = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
      if (m && !m[1].startsWith('.')) makeTargets.add(m[1]);
    }
  }

  const docFiles = ['README.md', 'HOW_TO_USE.md', 'CONTRIBUTING.md'].map((n) => path.join(absRoot, n)).filter(isFile);
  if (isDir(path.join(absRoot, 'docs'))) {
    for (const f of collectFiles(path.join(absRoot, 'docs'), (p) => /\.md$/i.test(p), 500)) docFiles.push(f);
  }

  const brokenLinks = [];
  const missingScripts = [];
  const missingMakeTargets = [];

  for (const doc of docFiles) {
    const relDoc = toPosix(path.relative(absRoot, doc));
    const rawLines = readUtf8(doc).replace(/\r\n/g, '\n').split('\n');
    const lines = blankFencedLines(rawLines.join('\n'));
    const scanCommandsInSnippet = (snippet, lineNum, allowBareMake) => {
      if (scripts) {
        const npmRe = /\b(?:npm|pnpm)\s+run\s+([A-Za-z0-9_:-]+)/g;
        let sm;
        while ((sm = npmRe.exec(snippet)) !== null) {
          if (!scripts.has(sm[1])) missingScripts.push({ file: relDoc, line: lineNum, script: sm[1] });
        }
      }
      if (makeTargets && allowBareMake) {
        const mkRe = /(?:^|[\s$|&;(])make\s+(?!-)(?!sure\b|sense\b|clear\b|changes\b|it\b)([A-Za-z0-9_.-]+)\b/g;
        let mm;
        while ((mm = mkRe.exec(snippet)) !== null) {
          if (!makeTargets.has(mm[1])) missingMakeTargets.push({ file: relDoc, line: lineNum, target: mm[1] });
        }
      }
    };
    for (let i = 0; i < rawLines.length; i += 1) {
      const rawLine = rawLines[i];
      const unfenced = lines[i] || '';
      const trimmed = rawLine.trim();
      const inFencedCode = Boolean(trimmed) && !unfenced && !/^(?:`{3,}|~{3,})/.test(trimmed);
      if (inFencedCode) {
        scanCommandsInSnippet(rawLine, i + 1, true);
        continue;
      }
      const noInlineCode = unfenced.replace(/`+([^`]*)`+/g, (m, inner) => {
        scanCommandsInSnippet(inner, i + 1, true);
        return ' '.repeat(m.length);
      });
      const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let lm;
      while ((lm = linkRe.exec(noInlineCode)) !== null) {
        const href = lm[1].replace(/^<|>$/g, '');
        if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;
        const rawPathPart = href.split('#')[0].split('?')[0];
        if (!rawPathPart || /[*<>{}$]/.test(rawPathPart)) continue;
        let decoded = rawPathPart;
        try { decoded = decodeURIComponent(rawPathPart); } catch { /* fail open: literal href */ }
        const cand = path.resolve(path.dirname(doc), decoded);
        if (!fs.existsSync(cand)) {
          brokenLinks.push({ file: relDoc, line: i + 1, href, resolved: toPosix(path.relative(absRoot, cand)) });
        }
      }
      scanCommandsInSnippet(noInlineCode, i + 1, /^\s*(?:\$\s+)?make\s+/i.test(noInlineCode));
    }
  }

  // Env key-only drift & dead-module env detection (NEVER read .env files or values right of '=')
  const envExampleFile = ['.env.example', '.env.sample', '.env.template'].map((n) => path.join(absRoot, n)).find(isFile) || '';
  const exampleEnvKeys = new Set();
  if (envExampleFile) {
    for (const line of readUtf8(envExampleFile).split(/\r?\n/)) {
      const m = /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=/.exec(line);
      if (m) exampleEnvKeys.add(m[1]);
    }
  }

  const codeFiles = collectFiles(absRoot, (f) => /\.(?:[cm]?[jt]sx?|py|sh)$/i.test(f));
  const envUsage = new Map();
  const importedTargets = new Set();
  const fileImports = new Map();
  const nonTestCode = [];

  for (const cf of codeFiles) {
    const rel = toPosix(path.relative(absRoot, cf));
    const isTest = TEST_FILE_RE.test(rel);
    let body = '';
    try {
      if (fs.statSync(cf).size > 524288) continue;
      body = readUtf8(cf);
    } catch { /* fail open: unreadable code file */ continue; }
    for (const imp of extractRelativeImports(cf, body)) {
      importedTargets.add(imp);
      const list = fileImports.get(cf) || [];
      list.push(imp);
      fileImports.set(cf, list);
    }
    if (isTest) continue;
    nonTestCode.push(cf);
    const reEnv = /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b|\bprocess\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]|\bos\.(?:environ\.get|getenv)\(['"]([A-Z][A-Z0-9_]*)['"]\)/g;
    let em;
    while ((em = reEnv.exec(body)) !== null) {
      const key = em[1] || em[2] || em[3];
      if (!key || RUNTIME_ENV_IGNORE.has(key) || key.startsWith('GITHUB_')) continue;
      const s = envUsage.get(key) || new Set();
      s.add(cf);
      envUsage.set(key, s);
    }
  }

  const undocumentedEnvVars = [];
  const unusedEnvExampleVars = [];
  if (envExampleFile) {
    for (const k of [...envUsage.keys()].sort()) {
      if (!exampleEnvKeys.has(k)) undocumentedEnvVars.push(k);
    }
    for (const k of [...exampleEnvKeys].sort()) {
      if (!envUsage.has(k)) unusedEnvExampleVars.push(k);
    }
  }

  const deadModuleEnvVars = [];
  if (nonTestCode.length > 1) {
    for (const [k, files] of [...envUsage.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const onlyUnreferenced = [...files].every((f) => {
        const base = path.basename(f);
        const rel = toPosix(path.relative(absRoot, f));
        const looksEntry = /^(?:index|main|cli|server|app|run)\./i.test(base) || /^(?:hooks|bin|scripts|sidecars)\//.test(rel);
        return !importedTargets.has(f) && !looksEntry;
      });
      if (onlyUnreferenced) {
        deadModuleEnvVars.push({ key: k, files: [...files].map((f) => toPosix(path.relative(absRoot, f))) });
      }
    }
  }

  const ok = !brokenLinks.length && !missingScripts.length && !missingMakeTargets.length
    && !undocumentedEnvVars.length && !unusedEnvExampleVars.length;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    root: absRoot,
    docsScanned: docFiles.length,
    envExamplePresent: Boolean(envExampleFile),
    brokenLinks,
    missingScripts,
    missingMakeTargets,
    undocumentedEnvVars,
    unusedEnvExampleVars,
    deadModuleEnvVars,
  };
}

// ---------- coverage-map ----------
function parseCoverageData(absRoot) {
  const byFile = new Map();
  const sumPath = path.join(absRoot, 'coverage', 'coverage-summary.json');
  if (isFile(sumPath)) {
    try {
      const json = JSON.parse(readUtf8(sumPath));
      for (const [k, v] of Object.entries(json || {})) {
        if (k === 'total' || !v || typeof v !== 'object') continue;
        const pct = v.lines?.pct ?? v.statements?.pct;
        if (typeof pct === 'number') byFile.set(toPosix(path.isAbsolute(k) ? path.relative(absRoot, k) : k), pct);
      }
      return { source: 'coverage/coverage-summary.json', byFile };
    } catch { /* fail open: malformed coverage summary */ }
  }
  const lcovPath = path.join(absRoot, 'coverage', 'lcov.info');
  if (isFile(lcovPath)) {
    try {
      let cur = '';
      for (const line of readUtf8(lcovPath).split(/\r?\n/)) {
        if (line.startsWith('SF:')) cur = line.slice(3).trim();
        else if (line.startsWith('end_of_record')) cur = '';
        else if (cur && line.startsWith('LF:')) {
          const lf = Number(line.slice(3)) || 0;
          byFile.set(toPosix(path.isAbsolute(cur) ? path.relative(absRoot, cur) : cur), { lf, lh: 0 });
        } else if (cur && line.startsWith('LH:')) {
          const rec = byFile.get(toPosix(path.isAbsolute(cur) ? path.relative(absRoot, cur) : cur));
          if (rec && typeof rec === 'object') {
            rec.lh = Number(line.slice(3)) || 0;
            byFile.set(toPosix(path.isAbsolute(cur) ? path.relative(absRoot, cur) : cur), rec.lf > 0 ? Math.round((rec.lh / rec.lf) * 1000) / 10 : 100);
          }
        }
      }
      return { source: 'coverage/lcov.info', byFile };
    } catch { /* fail open: malformed lcov */ }
  }
  return { source: null, byFile };
}

export function runCoverageMap(rootDir = process.cwd()) {
  if (!strArg(rootDir)) return { ok: false, exitCode: 2, root: '', error: 'missing_root_dir' };
  const absRoot = path.resolve(rootDir);
  if (!isDir(absRoot)) return { ok: false, exitCode: 2, root: absRoot, error: 'missing_root_dir' };

  const allFiles = collectFiles(absRoot, (f) => /\.(?:[cm]?[jt]sx?|py|go|rs)$/i.test(f));
  const cov = parseCoverageData(absRoot);
  const testContents = [];
  const zeroAssertionTests = [];
  const sourceModules = [];

  for (const full of allFiles) {
    const rel = toPosix(path.relative(absRoot, full));
    let body = '';
    try {
      if (fs.statSync(full).size > 524288) continue;
      body = readUtf8(full);
    } catch { /* fail open: unreadable module */ continue; }

    const isSelfTestHost = /selftest/i.test(rel) || (path.basename(full) === 'main.mjs' && /\bH1\b/.test(body));
    const isTest = TEST_FILE_RE.test(rel) || isSelfTestHost;
    if (isTest) {
      testContents.push({ rel, body });
      const looksUnitFile = TEST_FILE_RE.test(rel) && !isSelfTestHost;
      if (looksUnitFile) {
        const hasTestCases = /\b(?:it|test|describe)\s*\(|\bdef\s+test_/i.test(body);
        const hasAssert = /\b(?:assert|expect|should)\b|\bt\.(?:ok|equal|deepEqual|throws|match|assert)\b|node:assert|\bassert_/i.test(body);
        if (hasTestCases && !hasAssert) zeroAssertionTests.push(rel);
      }
      if (isSelfTestHost) continue;
    } else {
      const loc = body.split(/\r?\n/).filter((l) => l.trim()).length;
      const exportMatches = body.match(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|default)\b|\bmodule\.exports\b|\bdef\s+[A-Za-z0-9_]+/g);
      sourceModules.push({
        file: rel,
        baseNoExt: path.basename(rel, path.extname(rel)),
        loc,
        exports: exportMatches ? exportMatches.length : 0,
      });
    }
  }

  const uncoveredModules = [];
  let coveredCount = 0;
  for (const mod of sourceModules) {
    const covPct = cov.byFile.get(mod.file);
    const stem = mod.baseNoExt.replace(/[^A-Za-z0-9._-]/g, '');
    const stemRe = stem ? new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
    const matchingTests = testContents.filter((t) => stemRe && (t.body.includes(mod.file) || t.body.includes(mod.baseNoExt) && stemRe.test(t.body))).map((t) => t.rel);
    const hasCoverage = typeof covPct === 'number' ? covPct > 0 : matchingTests.length > 0;
    if (hasCoverage) {
      coveredCount += 1;
    } else {
      uncoveredModules.push({
        file: mod.file,
        loc: mod.loc,
        exports: mod.exports,
        riskScore: mod.loc + mod.exports * 15,
      });
    }
  }
  uncoveredModules.sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file));

  return {
    ok: true,
    exitCode: 0,
    root: absRoot,
    coverageReportUsed: cov.source,
    summary: {
      sourceFilesScanned: sourceModules.length,
      testFilesScanned: testContents.length,
      coveredModules: coveredCount,
      totalUncovered: uncoveredModules.length,
      zeroAssertionCount: zeroAssertionTests.length,
    },
    uncoveredModules: uncoveredModules.slice(0, 25),
    zeroAssertionTests,
  };
}

// ---------- dep-license-diff ----------
const STRONG_COPYLEFT_RE = /^(?:AGPL|GPL|LGPL|SSPL|EUPL)(?:-|$)/i;
const PERMISSIVE_RE = /^(?:MIT|ISC|0BSD|BSD-2-Clause|BSD-3-Clause|BSD-0-Clause|Apache-2\.0|Unlicense|CC0-1\.0|Zlib|WTFPL|Python-2\.0|PSF-2\.0|BlueOak-1\.0\.0|Artistic-2\.0|MPL-2\.0)$/i;

function tokenizeSpdx(expr) {
  const raw = String(expr || '').trim();
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) { i += 1; continue; }
    if (raw[i] === '(' || raw[i] === ')') { tokens.push(raw[i]); i += 1; continue; }
    let j = i;
    while (j < raw.length && !/[\s()]/.test(raw[j])) j += 1;
    tokens.push(raw.slice(i, j));
    i = j;
  }
  return tokens;
}

export function classifySpdxLicense(expr) {
  const s = String(expr || '').trim();
  if (!s) return 'unknown';
  const tokens = tokenizeSpdx(s);
  let pos = 0;
  const evalAtom = (id) => {
    const clean = id.replace(/\+$/, '');
    if (STRONG_COPYLEFT_RE.test(clean)) return 'copyleft';
    if (PERMISSIVE_RE.test(clean)) return 'permissive';
    return 'unknown';
  };
  const combineAnd = (a, b) => (a === 'copyleft' || b === 'copyleft' ? 'copyleft' : (a === 'permissive' && b === 'permissive' ? 'permissive' : 'unknown'));
  const combineOr = (a, b) => (a === 'permissive' || b === 'permissive' ? 'permissive' : (a === 'copyleft' && b === 'copyleft' ? 'copyleft' : 'unknown'));

  const parseOr = () => {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos].toUpperCase() === 'OR') {
      pos += 1;
      left = combineOr(left, parseAnd());
    }
    return left;
  };
  const parseAnd = () => {
    let left = parsePrimary();
    while (pos < tokens.length && tokens[pos].toUpperCase() === 'AND') {
      pos += 1;
      left = combineAnd(left, parsePrimary());
    }
    return left;
  };
  const parsePrimary = () => {
    const t = tokens[pos];
    if (!t) return 'unknown';
    if (t === '(') {
      pos += 1;
      const v = parseOr();
      if (tokens[pos] === ')') pos += 1;
      return v;
    }
    pos += 1;
    if (tokens[pos] && tokens[pos].toUpperCase() === 'WITH') {
      pos += 1;
      if (tokens[pos]) pos += 1;
    }
    return evalAtom(t);
  };
  return parseOr();
}

export function runDepLicenseDiff(rootDir = process.cwd(), options = {}) {
  if (!strArg(rootDir)) return { ok: false, exitCode: 2, root: '', error: 'missing_root_dir' };
  const absRoot = path.resolve(rootDir);
  if (!isDir(absRoot)) return { ok: false, exitCode: 2, root: absRoot, error: 'missing_root_dir' };

  const copyleftFindings = [];
  const unpinnedSpecs = [];
  const missingLockfiles = [];
  const addedDeps = [];
  const removedDeps = [];

  const checkPkgLicense = (pkgName, licField, source) => {
    if (!licField) return;
    const raw = typeof licField === 'string'
      ? licField
      : (Array.isArray(licField) ? licField.map((l) => l?.type || l).filter(Boolean).join(' OR ') : String(licField.type || ''));
    if (!raw) return;
    const cls = classifySpdxLicense(raw);
    if (cls === 'copyleft') copyleftFindings.push({ package: pkgName, license: raw, classification: cls, source });
  };

  const pkgPath = path.join(absRoot, 'package.json');
  if (isFile(pkgPath)) {
    try {
      const pkg = JSON.parse(readUtf8(pkgPath));
      checkPkgLicense(pkg.name || '.', pkg.license || pkg.licenses, 'package.json');
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [name, ver] of Object.entries(deps)) {
        const s = String(ver || '').trim();
        if (!s || s === '*' || /^latest$/i.test(s) || /^git\+|^https?:/i.test(s)) {
          unpinnedSpecs.push({ file: 'package.json', package: name, spec: s || '(empty)' });
        }
      }
      const hasAnyLock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'].some((n) => isFile(path.join(absRoot, n)));
      if (Object.keys(deps).length > 0 && !hasAnyLock) {
        missingLockfiles.push({ manifest: 'package.json', expected: 'package-lock.json | pnpm-lock.yaml | yarn.lock' });
      }
    } catch { /* fail open: invalid package.json */ }
  }

  const lockPath = path.join(absRoot, 'package-lock.json');
  if (isFile(lockPath)) {
    try {
      const lock = JSON.parse(readUtf8(lockPath));
      for (const [k, info] of Object.entries(lock.packages || {})) {
        if (k && info && typeof info === 'object') checkPkgLicense(k.replace(/^.*node_modules\//, ''), info.license, 'package-lock.json');
      }
    } catch { /* fail open: malformed lockfile */ }
  }

  const reqPath = path.join(absRoot, 'requirements.txt');
  if (isFile(reqPath)) {
    for (const line of readUtf8(reqPath).split(/\r?\n/)) {
      const clean = line.split('#')[0].trim();
      if (!clean || clean.startsWith('-')) continue;
      if (/^git\+|^https?:/i.test(clean) || !/[=~<>!]/.test(clean)) {
        unpinnedSpecs.push({ file: 'requirements.txt', package: clean.split(/[@;\s]/)[0], spec: clean });
      }
    }
  }

  const nmDir = path.join(absRoot, 'node_modules');
  if (isDir(nmDir)) {
    for (const e of listEntries(nmDir)) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (e.name.startsWith('@')) {
        for (const sub of listEntries(path.join(nmDir, e.name))) {
          if (!sub.isDirectory()) continue;
          const p = path.join(nmDir, e.name, sub.name, 'package.json');
          if (isFile(p)) {
            try { const d = JSON.parse(readUtf8(p)); checkPkgLicense(`${e.name}/${sub.name}`, d.license || d.licenses, `node_modules/${e.name}/${sub.name}/package.json`); } catch { /* fail open */ }
          }
        }
      } else {
        const p = path.join(nmDir, e.name, 'package.json');
        if (isFile(p)) {
          try { const d = JSON.parse(readUtf8(p)); checkPkgLicense(e.name, d.license || d.licenses, `node_modules/${e.name}/package.json`); } catch { /* fail open */ }
        }
      }
    }
  }

  const safeBaseRef = strArg(options?.baseRef);
  if (safeBaseRef && !safeBaseRef.startsWith('-')) {
    try {
      const prevPkgRaw = gitOut(absRoot, ['show', `${safeBaseRef}:package.json`]);
      const prevPkg = JSON.parse(prevPkgRaw);
      const prevDeps = { ...(prevPkg.dependencies || {}), ...(prevPkg.devDependencies || {}) };
      const curPkg = isFile(pkgPath) ? JSON.parse(readUtf8(pkgPath)) : {};
      const curDeps = { ...(curPkg.dependencies || {}), ...(curPkg.devDependencies || {}) };
      for (const k of Object.keys(curDeps)) { if (!(k in prevDeps)) addedDeps.push({ package: k, version: curDeps[k] }); }
      for (const k of Object.keys(prevDeps)) { if (!(k in curDeps)) removedDeps.push({ package: k, version: prevDeps[k] }); }
    } catch { /* fail open: no baseRef or non-git */ }
  }

  const ok = !copyleftFindings.length && !unpinnedSpecs.length && !missingLockfiles.length;
  return { ok, exitCode: ok ? 0 : 1, root: absRoot, copyleftFindings, unpinnedSpecs, missingLockfiles, addedDeps, removedDeps };
}

// ---------- mcp-audit ----------
function isSafeEnvPlaceholder(v) {
  const s = String(v || '').trim();
  return !s || /^(?:(?:Bearer|Basic|Token|ApiKey)\s+)?(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|<[^<>]+>|process\.env\.[A-Za-z0-9_]+)$/i.test(s)
    || /^\[REDACTED/.test(s);
}

function isLoopbackHttp(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:') return true;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
  } catch { /* fail open */ return false; }
}

export function runMcpAudit(targetPath = process.cwd()) {
  if (!strArg(targetPath)) return { ok: false, exitCode: 2, root: '', filesScanned: 0, serversScanned: 0, findings: [], error: 'missing_target_path' };
  const abs = path.resolve(targetPath);
  if (!fs.existsSync(abs)) return { ok: false, exitCode: 2, root: abs, filesScanned: 0, serversScanned: 0, findings: [], error: 'target_not_found' };

  const files = isFile(abs)
    ? [abs]
    : ['.mcp.json', 'mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'].map((n) => path.join(abs, n)).filter(isFile);

  const findings = [];
  let serversScanned = 0;

  for (const cfgFile of files) {
    const rel = isFile(abs) ? path.basename(cfgFile) : toPosix(path.relative(abs, cfgFile));
    let data = null;
    try { data = JSON.parse(readUtf8(cfgFile)); } catch (err) {
      findings.push({ file: rel, server: '-', code: 'invalid_mcp_json', severity: 'high', detail: err.message });
      continue;
    }
    const serverMap = (data && typeof data === 'object' && (data.mcpServers || data.servers)) || {};
    for (const [name, def] of Object.entries(serverMap)) {
      if (!def || typeof def !== 'object') continue;
      serversScanned += 1;
      const args = Array.isArray(def.args) ? def.args.map(String) : [];
      const cmd = String(def.command || '');
      const cmdBase = path.basename(cmd).toLowerCase();

      for (const [bagName, bag] of [['env', def.env], ['headers', def.headers]]) {
        if (!bag || typeof bag !== 'object') continue;
        for (const [k, rawV] of Object.entries(bag)) {
          const val = String(rawV || '');
          if (isSafeEnvPlaceholder(val)) continue;
          const isSecretVal = redactSecrets(val) !== val || (/(?:key|token|secret|password|auth|credential)/i.test(k) && val.length >= 8 && !/^(?:true|false|bearer\s+\$)$/i.test(val));
          if (isSecretVal) {
            findings.push({ file: rel, server: name, code: 'hardcoded_secret', severity: 'high', detail: `${bagName}.${k} contains a literal credential instead of an env placeholder` });
          }
        }
      }

      const urlCandidates = [def.url, def.serverUrl, def.endpoint, ...args].filter((u) => typeof u === 'string' && /^http:\/\//i.test(u));
      for (const u of urlCandidates) {
        if (!isLoopbackHttp(u)) findings.push({ file: rel, server: name, code: 'insecure_http_url', severity: 'high', detail: `Non-loopback plaintext HTTP URL: ${redactSecrets(u)}` });
      }

      const pathCandidates = [...(typeof def.cwd === 'string' ? [['cwd', def.cwd]] : []), ...args.map((a, idx) => [`args[${idx}]`, a])];
      for (const [loc, p] of pathCandidates) {
        if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(p) || /^\/$/.test(p.trim()) || /^[A-Za-z]:\\?$/.test(p.trim()) || /^~\/?$/.test(p.trim()) || /^\$\{?HOME\}?\/?$/.test(p.trim())) {
          findings.push({ file: rel, server: name, code: 'unsafe_path_mount', severity: 'high', detail: `${loc} uses path traversal or broad filesystem root: ${p}` });
        }
      }

      if (/^(?:npx|uvx|pipx|dlx)$/.test(cmdBase)) {
        for (const a of args) {
          if (a.startsWith('-')) continue;
          if (/@latest$/i.test(a) || /^https?:\/\//i.test(a)) {
            findings.push({ file: rel, server: name, code: 'unpinned_remote_exec', severity: 'high', detail: `Unpinned remote package execution in ${cmdBase}: ${a}` });
          } else if (cmdBase === 'npx' && !a.includes('@', 1) && !/^(?:\.\.?[/\\]|[/\\]|~[/\\]|[A-Za-z]:[/\\])/.test(a)) {
            findings.push({ file: rel, server: name, code: 'unpinned_remote_exec', severity: 'high', detail: `Unpinned npx package without version pin: ${a}` });
          }
          break;
        }
      }

      if (/^(?:sh|bash|zsh|dash|fish|cmd|cmd\.exe|powershell|pwsh)$/.test(cmdBase)) {
        for (const a of args) {
          if (/(?:;|&&|\|\||\||`|\$\()/.test(a)) {
            findings.push({ file: rel, server: name, code: 'shell_injection_risk', severity: 'high', detail: `Shell metacharacters in ${cmdBase} args: ${redactSecrets(a).slice(0, 80)}` });
          }
        }
      }
    }
  }

  const ok = findings.length === 0;
  return { ok, exitCode: ok ? 0 : 1, root: abs, filesScanned: files.length, serversScanned, findings };
}

export async function runAuditCli(event, rawArgs = []) {
  const parsed = parseAuditArgs(rawArgs);
  let res;
  if (!parsed.ok) res = { ok: false, exitCode: 2, error: parsed.error };
  else if (event === 'docs-drift') res = runDocsDrift(parsed.rootDir);
  else if (event === 'coverage-map') res = runCoverageMap(parsed.rootDir);
  else if (event === 'dep-license-diff') res = runDepLicenseDiff(parsed.rootDir, { baseRef: parsed.baseRef });
  else if (event === 'mcp-audit') res = runMcpAudit(parsed.rootDir);
  else res = { ok: false, exitCode: 2, error: `unknown_audit_event:${event}` };

  process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  return Number.isInteger(res.exitCode) ? res.exitCode : (res.ok ? 0 : 1);
}
