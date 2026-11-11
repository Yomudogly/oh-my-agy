// Cold-path CLI evaluators and static hygiene validators for oh-my-agy.
// Loaded lazily via `await import('./omagy-cli.mjs')` so hot-path lifecycle hooks stay fast and small.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  CODE_EXTENSIONS, TEST_FILE_NAME_RE, appendJsonlRecord, isRealVerificationCommand, loadModeStates,
  loadUltragoalNotepad, normalizeFailureSignature, parseUnifiedDiff, readJson, readJsonlRecords,
  redactSecrets, scanRepoCodeHygiene, stateRoot, stripCodeStrings, stripUtf8Bom,
  transformOutsideCodeSpans, validateCompletionEvidence,
} from './omagy-hook.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNTRACKED_MAX_FILES = 200;
const ASSERTION_LINE_RE = /\b(?:expect|assert(?:\.[A-Za-z_]\w*|_[a-z_]+!?)?|should)\s*(?:\(|\.)|^\s*assert\s+\S/;
const THRESHOLD_TOKEN_RE = /(?<![-=])(<=|>=|<|>|≤|≥)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|(?:bytes?|kb|mb|gb|b|ms|secs?|s|pct|chars?|lines?)\b)?/gi;
const CANONICAL_OMAGY_SUBROOTS = new Set('state logs context interviews specs plans drafts ultragoal goals evidence artifacts config.json notifications.json'.split(' '));
const STOPWORDS = new Set('a an and are as ask asks at be before after by can do does for from has have how if in into is it its let lets make me my need needs no not of oh agy antigravity on one only or our out over please run runs running set should so some supports that the their them then there these this through to up use used user users using via want wants we what when where which while with without you your flags default mode modes'.split(' '));
const SKILL_QUERY_ALIASES = Object.fromEntries([
  ['deslop', 'slop,cleanup,refactor,dead'], ['bloat', 'bloated,slop,cleanup'], ['messy', 'bloated,repetitive,cleanup'],
  ['investigate', 'analyze,analysis,causing'], ['why', 'analyze,causing,synthesis'], ['root', 'causing,analyze'],
  ['advisor', 'claude,gemini,codex,opinion'], ['autonomous', 'autopilot,delivery,hands'], ['endtoend', 'autopilot,delivery'],
  ['stop', 'cancel,abort'], ['abort', 'cancel'], ['merge', 'review,approve,verdict'],
  ['slack', 'doctor,notifications,webhook,notify'], ['discord', 'doctor,notifications,webhook,notify'], ['telegram', 'doctor,notifications,webhook,notify'],
  ['ambiguous', 'interview,socratic,ambiguity'], ['requirements', 'interview,ambiguity,criteria'],
  ['landscape', 'multidisciplinary,research,market'], ['market', 'business,research,landscape'],
  ['palette', 'visual,ralph,tokens,ui,ux,frontend'], ['broken', 'doctor,diagnose,issues,hooks'], ['troubleshoot', 'doctor,diagnose,issues'],
  ['compact', 'hud,compaction,resume,session'], ['dashboard', 'hud,status,board'], ['prototype', 'loft,variants,throwaway,switcher'],
  ['install', 'doctor,setup,enable,uninstall,bootstrap'], ['uninstall', 'doctor,setup,install'],
  ['latency', 'performance,speed,throughput,benchmark,optimize'], ['slow', 'performance,speed,latency,optimize'], ['memory', 'performance,benchmark,optimize'],
  ['lightweight', 'ralplan,light,scoping'], ['pull', 'pr,reversibility,paper,trail'], ['consensus', 'ralplan,architectural,critic,hyperplan'],
  ['parallel', 'team,workers,subagent,board'], ['workers', 'team,board'], ['goals', 'ultragoal,ledger,sequential'], ['milestone', 'ultragoal,goals,ledger'],
  ['adversarial', 'ultraqa,hostile,scenario,matrix'], ['e2e', 'ultraqa,qa,scenario'],
  ['mockup', 'visual,ralph,pixel,reference,ui'], ['screenshot', 'visual,ralph,pixel,ui'], ['clone', 'visual,ralph,url'],
  ['knowledge', 'wiki,omagy,markdown,notes'],
].map(([k, v]) => [k, v.split(',')]));

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const errMsg = (e) => (e instanceof Error ? e.message : String(e));
const isDir = (p) => { try { return Boolean(p) && fs.statSync(p).isDirectory(); } catch { /* fail open: missing dir */ return false; } };
const isFile = (p) => { try { return Boolean(p) && fs.statSync(p).isFile(); } catch { /* fail open: missing file */ return false; } };
const listEntries = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.isSymbolicLink()); } catch { /* fail open: unreadable dir */ return []; } };
const readUtf8 = (p) => stripUtf8Bom(fs.readFileSync(p, 'utf8'));
const writeJsonStrict = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`, 'utf8'); };
const gitOut = (cwd, args, extra = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 16 * 1024 * 1024, ...extra });
const gitHead = (d) => { try { const s = gitOut(d, ['rev-parse', '--verify', 'HEAD^{commit}']).trim(); return /^[0-9a-fA-F]{7,64}$/.test(s) ? s : ''; } catch { /* fail open: non-git or unborn HEAD */ return ''; } };
const scrubHome = (s) => redactSecrets(String(s || '')).replace(/\/(?:Users|home)\/[A-Za-z0-9._-]+/g, '<HOME>').replace(/[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/gi, '<HOME>');
function canonicalizeLocal(p) { const abs = path.resolve(String(p || '')); try { return fs.realpathSync(abs); } catch { /* fail open: path may not exist yet */ return abs; } }
const UNIT_MAP = { '%': ['pct', 1], pct: ['pct', 1], b: ['bytes', 1], byte: ['bytes', 1], bytes: ['bytes', 1], kb: ['bytes', 1024], mb: ['bytes', 1048576], gb: ['bytes', 1073741824], ms: ['time', 1], s: ['time', 1000], sec: ['time', 1000], secs: ['time', 1000], char: ['chars', 1], chars: ['chars', 1], line: ['lines', 1], lines: ['lines', 1] };

function extractThresholds(line) {
  const out = [];
  THRESHOLD_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = THRESHOLD_TOKEN_RE.exec(line)) !== null) {
    const op = m[1];
    const num = Number(String(m[2]).replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    const unit = String(m[3] || '').toLowerCase();
    const [unitFamily, mult] = !unit ? ['scalar', 1] : (UNIT_MAP[unit] || [unit, 1]);
    const bound = (op === '<' || op === '<=' || op === '≤') ? 'upper' : 'lower';
    const label = line.slice(0, m.index).toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(-2).join('_');
    out.push({ op, num, scaledNum: num * mult, unit, unitFamily, bound, label, raw: m[0].trim() });
  }
  return out;
}

export function runFloorGuard(cwd = process.cwd(), baseRef = '', options = {}) {
  const summary = { silencedCheckers: 0, unfinishedWork: 0, emptyCatches: 0, protectedBlocksModified: 0, testsMadeEasier: 0, deletedTests: 0, removedAssertions: 0, loosenedThresholds: 0, rulesRemoved: 0, untrackedBlockers: 0, total: 0 };
  const findings = [];
  const repoDir = path.resolve(String(cwd || process.cwd()));
  const fail2 = (error, baseSha = '') => ({ ok: false, exitCode: 2, baseSha, findings, summary, error });
  if (!fs.existsSync(repoDir)) return fail2(`Directory does not exist: ${repoDir}`);
  try {
    if (gitOut(repoDir, ['rev-parse', '--is-inside-work-tree'], { timeout: 3000 }).trim() !== 'true') return fail2(`Not a git worktree: ${repoDir}`);
  } catch (err) { return fail2(`Not a git worktree: ${errMsg(err)}`); }

  const cleanRef = String(baseRef || '').trim();
  if (cleanRef.startsWith('-')) return fail2(`Invalid baseRef '${cleanRef}'.`);
  let baseSha = '';
  try { baseSha = gitOut(repoDir, cleanRef ? ['merge-base', cleanRef, 'HEAD'] : ['rev-parse', '--verify', 'HEAD^{commit}'], { timeout: 3000 }).trim(); }
  catch (err) { return fail2(`Unable to resolve git base (${cleanRef || 'HEAD'}): ${errMsg(err)}`); }
  if (!baseSha) return fail2('Resolved empty git base SHA.');

  const catMap = { 'silenced-checker': 'silencedCheckers', 'unfinished-work': 'unfinishedWork', 'empty-catch': 'emptyCatches', 'protected-block-modified': 'protectedBlocksModified', 'test-made-easier': 'testsMadeEasier', 'test-deleted': 'deletedTests', 'assertion-removed': 'removedAssertions', 'threshold-loosened': 'loosenedThresholds', 'rule-removed': 'rulesRemoved' };
  const record = (category, file, line, message, snippet, untracked = false) => {
    findings.push({ category, file, line: Number(line) || 1, message, snippet: redactSecrets(String(snippet || '').trim()).slice(0, 160) });
    if (catMap[category]) summary[catMap[category]] += 1;
    if (untracked) summary.untrackedBlockers += 1;
  };

  let diffText = '';
  try { diffText = gitOut(repoDir, ['-c', 'core.quotepath=false', 'diff', '-M', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', baseSha, '--']); }
  catch (err) { return fail2(`git diff failed against ${baseSha}: ${errMsg(err)}`, baseSha); }

  const parsedFiles = parseUnifiedDiff(diffText);
  for (const entry of parsedFiles) {
    const relFile = entry.newFile || entry.oldFile;
    if (!relFile) continue;
    if (entry.status === 'deleted' && TEST_FILE_NAME_RE.test(entry.oldFile)) record('test-deleted', entry.oldFile, 1, `Deleted test file '${entry.oldFile}'.`, entry.oldFile);
    else if (entry.status === 'renamed' && TEST_FILE_NAME_RE.test(entry.oldFile) && !TEST_FILE_NAME_RE.test(entry.newFile)) record('test-deleted', entry.oldFile, 1, `Renamed test file '${entry.oldFile}' to non-test path '${entry.newFile}'.`, `${entry.oldFile} -> ${entry.newFile}`);

    if (/(?:^|\/)(?:CONSTRAINTS\.md|omagy_wiki\/agreements\.md)$/i.test(relFile.replace(/\\/g, '/'))) {
      const govPath = path.join(repoDir, relFile);
      const govText = fs.existsSync(govPath) ? fs.readFileSync(govPath, 'utf8') : '';
      if (entry.status === 'deleted') record('rule-removed', relFile, 1, `Deleted governance file '${relFile}'.`, relFile);
      else for (const hunk of entry.hunks) {
        const delLines = hunk.lines.filter((l) => l.type === 'del');
        const addLines = hunk.lines.filter((l) => l.type === 'add');
        const delT = delLines.flatMap((l) => extractThresholds(l.content).map((t) => ({ ...t, line: l.oldLine || 1, src: l.content })));
        const addT = addLines.flatMap((l) => extractThresholds(l.content).map((t) => ({ ...t, line: l.newLine || 1, src: l.content, used: false })));
        for (const dt of delT) {
          const same = (at) => !at.used && at.bound === dt.bound && at.unitFamily === dt.unitFamily;
          const m = addT.find((at) => same(at) && at.label && at.label === dt.label) || addT.find((at) => same(at) && at.unit === dt.unit) || addT.find(same);
          if (m) {
            m.used = true;
            if (dt.bound === 'upper' ? m.scaledNum > dt.scaledNum : m.scaledNum < dt.scaledNum) record('threshold-loosened', relFile, m.line, `Threshold loosened from '${dt.raw}' to '${m.raw}' in '${relFile}'.`, m.src);
          } else if (!govText.includes(dt.raw)) record('threshold-loosened', relFile, dt.line, `Threshold '${dt.raw}' removed or bound-flipped in '${relFile}'.`, dt.src);
        }
        const delB = delLines.filter((l) => /^\s*[-*]\s+\S/.test(l.content));
        const addB = addLines.filter((l) => /^\s*[-*]\s+\S/.test(l.content));
        let plainRm = 0;
        for (const db of delB) {
          const rt = /\[(v\d+)\]/i.exec(db.content);
          if (rt) {
            const tok = `[${rt[1]}]`.toLowerCase();
            if (!(govText.toLowerCase().includes(tok) || addB.some((ab) => ab.content.toLowerCase().includes(tok)))) record('rule-removed', relFile, db.oldLine || 1, `Removed floor agreement [${rt[1]}] from '${relFile}'.`, db.content);
          } else plainRm += 1;
        }
        if (plainRm > addB.length) {
          const smp = delB.find((b) => !/\[(v\d+)\]/i.test(b.content)) || delB[0];
          for (let k = 0; k < plainRm - addB.length; k += 1) record('rule-removed', relFile, smp?.oldLine || 1, `Removed constraint bullet from '${relFile}'.`, smp?.content || relFile);
        }
      }
    }
    if (entry.status === 'deleted' || !TEST_FILE_NAME_RE.test(relFile)) continue;
    const delA = []; let addA = 0;
    for (const hunk of entry.hunks) for (const l of hunk.lines) {
      if ((l.type !== 'add' && l.type !== 'del') || !l.content.trim() || /^(?:\/\/|#|\/\*|\*)/.test(l.content.trim())) continue;
      if (ASSERTION_LINE_RE.test(stripCodeStrings(l.content))) { if (l.type === 'del') delA.push(l); else addA += 1; }
    }
    for (let i = 0; i < delA.length - addA; i += 1) record('assertion-removed', relFile, delA[i].oldLine || 1, `Net assertion count decreased in '${relFile}' (-${delA.length - addA}).`, delA[i].content);
  }

  for (const item of scanRepoCodeHygiene(repoDir, parsedFiles, { baseRef: baseSha, maxUntrackedFiles: Number(options.maxUntrackedFiles ?? UNTRACKED_MAX_FILES) })) {
    let msg = `${item.fromUntracked ? 'Untracked' : 'Added'} ${item.kind} in '${item.file}'.`;
    if (item.category === 'protected-block-modified') msg = `Modified, renamed, or deleted ${item.blockKind} protected block in '${item.file}'.`;
    else if (item.category === 'silenced-checker') msg = item.fromUntracked ? `Untracked unexempted checker suppression in '${item.file}'.` : `Unexempted checker suppression in '${item.file}' (add '-- <reason>' or 'shortcut:').`;
    else if (item.category === 'empty-catch') msg = item.fromUntracked ? `Untracked empty catch block in '${item.file}'.` : `Empty or placeholder catch block in '${item.file}' (use '/* fail open: <reason> */' or 'shortcut:').`;
    record(item.category, item.file, item.line, msg, item.snippet, item.fromUntracked);
  }
  summary.total = findings.length;
  return { ok: !findings.length, exitCode: findings.length ? 1 : 0, baseSha, findings, summary };
}

// ---------- TF-IDF Skill Router & Corpus Evaluator ----------
const STEM_PFX = [['notif', 'notify'], ['configur', 'config'], ['instal', 'install'], ['optimiz', 'optim'], ['validat', 'valid'], ['analys', 'analyz'], ['analyz', 'analyz'], ['architec', 'architect'], ['simplif', 'simplif'], ['documen', 'doc']];
function stemToken(raw) {
  const w = String(raw || '').toLowerCase();
  if (w.length < 3) return w;
  for (const [p, r] of STEM_PFX) if (w.startsWith(p)) return r;
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) { const b = w.slice(0, -3); return b.length >= 3 && b[b.length - 1] === b[b.length - 2] ? b.slice(0, -1) : b; }
  if (w.length > 6 && /ations?$/.test(w)) return w.replace(/ations?$/, '');
  if (w.length > 6 && /ments?$/.test(w)) return w.replace(/ments?$/, '');
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && !/(?:ses|xes|zes)$/.test(w)) return w.slice(0, -2);
  return (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) ? w.slice(0, -1) : w;
}

function tokenizeForSkillEval(text, expandAliases = false) {
  let cleaned = String(text || '').replace(/^\s*\[oh-my-agy\]\s*/i, ' ').toLowerCase();
  if (expandAliases) cleaned = cleaned.replace(/\b(?:without|instead\s+of|rather\s+than)\s+(?:running\s+|a\s+|an\s+|full\s+|heavy\s+)*[a-z0-9-]+(?:\s+[a-z0-9-]+){0,4}/g, ' ');
  const tokens = [];
  for (const part of cleaned.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t))) {
    tokens.push(stemToken(part));
    if (expandAliases && hasOwn(SKILL_QUERY_ALIASES, part)) for (const a of SKILL_QUERY_ALIASES[part]) tokens.push(stemToken(a));
  }
  return tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function buildNormalizedTfIdf(tokens, idfMap, defaultIdf) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map(); let normSq = 0;
  for (const [term, count] of tf) { const w = (1 + Math.log(count)) * (idfMap.get(term) ?? defaultIdf); vec.set(term, w); normSq += w * w; }
  const norm = Math.sqrt(normSq);
  if (norm > 0) for (const [term, w] of vec) vec.set(term, w / norm);
  return vec;
}

function cosineMaps(vecA, vecB) {
  if (!vecA.size || !vecB.size) return 0;
  const [small, large] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  let dot = 0;
  for (const [k, v] of small) { const o = large.get(k); if (o !== undefined) dot += v * o; }
  return dot;
}

export function evaluateSkillRouting(pluginRoot, options = {}) {
  const minRank1 = Number(options.minRank1 ?? 95);
  const minPos = Number(options.minPositive ?? 3);
  const minNeg = Number(options.minNegative ?? 2);
  const rootDir = path.resolve(String(pluginRoot || process.cwd()));
  const skillsDir = path.join(rootDir, 'skills');
  const casesPath = options.casesPath ? path.resolve(String(options.casesPath)) : path.join(rootDir, 'hooks', 'skill-eval-cases.json');
  const baseEmpty = { ok: false, exitCode: 2, skillCount: 0, totalPositive: 0, passedPositive: 0, rank1Pct: 0, minRank1, totalNegative: 0, passedNegative: 0, negativeSurvivalPct: 0, collisionWarnings: [], collisionErrors: [], schemaErrors: [], failures: [] };
  if (!fs.existsSync(skillsDir) || !fs.existsSync(casesPath)) return { ...baseEmpty, schemaErrors: [`Missing skills directory (${skillsDir}) or eval cases (${casesPath}).`] };
  let skillDirs = [];
  try { skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch (err) { return { ...baseEmpty, schemaErrors: [`Unreadable skills directory: ${errMsg(err)}`] }; }
  if (!skillDirs.length) return { ...baseEmpty, schemaErrors: ['Zero skill directories discovered under skills/.'] };

  let casesJson = null;
  try { casesJson = JSON.parse(readUtf8(casesPath)); } catch (err) { return { ...baseEmpty, schemaErrors: [`Invalid JSON in ${casesPath}: ${errMsg(err)}`] }; }

  const discovered = new Map();
  const schemaErrors = [];
  for (const dirName of skillDirs) {
    const p = path.join(skillsDir, dirName, 'SKILL.md');
    if (!fs.existsSync(p)) { schemaErrors.push(`Missing SKILL.md for '${dirName}'.`); continue; }
    const desc = validateFrontmatterYaml(fs.readFileSync(p, 'utf8'), ['name', 'description'], ['name', 'description']).fields.description || '';
    const nameTokens = dirName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stemToken);
    const descTokens = tokenizeForSkillEval(desc, false);
    discovered.set(dirName, { name: dirName, description: desc, descTokens, routeTokens: [...nameTokens, ...nameTokens, ...descTokens] });
  }
  const N = discovered.size;
  if (!N) return { ...baseEmpty, schemaErrors };

  if (!casesJson || typeof casesJson !== 'object' || casesJson.version !== 1 || !casesJson.skills || typeof casesJson.skills !== 'object') schemaErrors.push('skill-eval-cases.json must have { "version": 1, "skills": { ... } }.');
  const caseSkills = (casesJson?.skills && typeof casesJson.skills === 'object') ? casesJson.skills : {};
  for (const sName of discovered.keys()) if (!hasOwn(caseSkills, sName)) schemaErrors.push(`Missing eval cases for skill '${sName}'.`);
  for (const cName of Object.keys(caseSkills)) if (!discovered.has(cName)) schemaErrors.push(`Unknown skill '${cName}' in skill-eval-cases.json.`);

  const routeDf = new Map(); const descDf = new Map();
  for (const info of discovered.values()) {
    for (const t of new Set(info.routeTokens)) routeDf.set(t, (routeDf.get(t) || 0) + 1);
    for (const t of new Set(info.descTokens)) descDf.set(t, (descDf.get(t) || 0) + 1);
  }
  const defaultIdf = Math.log(N + 1) + 1;
  const toIdf = (df) => new Map([...df].map(([t, c]) => [t, Math.log((N + 1) / (c + 1)) + 1]));
  const routeIdf = toIdf(routeDf); const descIdf = toIdf(descDf);
  for (const info of discovered.values()) { info.routeVec = buildNormalizedTfIdf(info.routeTokens, routeIdf, defaultIdf); info.descVec = buildNormalizedTfIdf(info.descTokens, descIdf, defaultIdf); }

  const round4 = (n) => Math.round(n * 10000) / 10000;
  const collisionWarnings = []; const collisionErrors = [];
  const namesList = [...discovered.keys()];
  for (let i = 0; i < namesList.length; i += 1) for (let j = i + 1; j < namesList.length; j += 1) {
    const a = discovered.get(namesList[i]); const b = discovered.get(namesList[j]);
    const cos = round4(cosineMaps(a.descVec, b.descVec));
    if (cos >= 0.75) collisionErrors.push({ pair: [a.name, b.name], cosine: cos });
    else if (cos >= 0.50) collisionWarnings.push({ pair: [a.name, b.name], cosine: cos });
  }

  const buildQ = (p) => buildNormalizedTfIdf(tokenizeForSkillEval(p, true), routeIdf, defaultIdf);
  const cheatRe = /(?:^|[\s(])[$/][a-z][a-z0-9-]*/i;
  let totalPositive = 0; let passedPositive = 0; let totalNegative = 0; let passedNegative = 0;
  const failures = [];

  for (const sName of namesList) {
    const entry = caseSkills[sName];
    if (!entry || typeof entry !== 'object') continue;
    const posList = Array.isArray(entry.positive) ? entry.positive : [];
    const negList = Array.isArray(entry.negative) ? entry.negative : [];
    if (posList.length < minPos) schemaErrors.push(`Skill '${sName}' has ${posList.length} positive prompt(s); expected >= ${minPos}.`);
    if (negList.length < minNeg) schemaErrors.push(`Skill '${sName}' has ${negList.length} negative prompt(s); expected >= ${minNeg}.`);

    for (const rawPrompt of posList) {
      const prompt = String(rawPrompt || '').trim();
      if (!prompt) { schemaErrors.push(`Empty positive prompt in '${sName}'.`); continue; }
      if (cheatRe.test(prompt)) schemaErrors.push(`Positive prompt in '${sName}' contains forbidden $/ skill prefix: "${prompt}".`);
      totalPositive += 1;
      const qVec = buildQ(prompt);
      let bestSkill = ''; let bestScore = -1; let secondScore = -1; let selfScore = 0;
      for (const cand of namesList) {
        const sc = cosineMaps(qVec, discovered.get(cand).routeVec);
        if (cand === sName) selfScore = sc;
        if (sc > bestScore) { secondScore = bestScore; bestScore = sc; bestSkill = cand; }
        else if (sc > secondScore) secondScore = sc;
      }
      if (bestSkill === sName && selfScore > 0 && selfScore > secondScore) passedPositive += 1;
      else failures.push({ kind: 'positive', skill: sName, prompt, topSkill: bestSkill, topScore: round4(bestScore), selfScore: round4(selfScore) });
    }
    for (const negItem of negList) {
      if (!negItem || typeof negItem !== 'object') { schemaErrors.push(`Negative entry in '${sName}' must be an { prompt, owner } object.`); continue; }
      const prompt = String(negItem.prompt || '').trim(); const owner = String(negItem.owner || '').trim();
      if (!prompt || !owner) { schemaErrors.push(`Negative entry in '${sName}' requires non-empty prompt and owner.`); continue; }
      if (owner === sName || !discovered.has(owner)) { schemaErrors.push(`Negative entry in '${sName}' has invalid owner '${owner}'.`); continue; }
      totalNegative += 1;
      const qVec = buildQ(prompt);
      const ownerScore = cosineMaps(qVec, discovered.get(owner).routeVec);
      const selfScore = cosineMaps(qVec, discovered.get(sName).routeVec);
      if (ownerScore > 0 && ownerScore > selfScore) passedNegative += 1;
      else failures.push({ kind: 'negative', skill: sName, owner, prompt, ownerScore: round4(ownerScore), selfScore: round4(selfScore) });
    }
  }
  const rank1Pct = totalPositive > 0 ? Math.round((passedPositive / totalPositive) * 1000) / 10 : 0;
  const negativeSurvivalPct = totalNegative > 0 ? Math.round((passedNegative / totalNegative) * 1000) / 10 : 0;
  const ok = !schemaErrors.length && !collisionErrors.length && totalPositive > 0 && rank1Pct >= minRank1 && negativeSurvivalPct === 100;
  return { ok, exitCode: ok ? 0 : 1, skillCount: N, totalPositive, passedPositive, rank1Pct, minRank1, totalNegative, passedNegative, negativeSurvivalPct, collisionWarnings, collisionErrors, schemaErrors, failures };
}

const SEMGREP_BLK = new Set(['ERROR', 'HIGH', 'CRITICAL']);
const SEMGREP_OK = new Set(['WARNING', 'WARN', 'MEDIUM', 'INFO', 'LOW', 'INVENTORY', 'EXPERIMENT']);
const AXE_BLK = new Set(['serious', 'critical']);
const AXE_OK = new Set(['minor', 'moderate']);
const isAxePage = (o) => Boolean(o && typeof o === 'object' && !Array.isArray(o) && ('violations' in o || 'passes' in o || 'incomplete' in o || ('url' in o && !('results' in o))));

export function evaluateQualityGate(reportPaths = []) {
  const paths = (Array.isArray(reportPaths) ? reportPaths : [reportPaths]).map((p) => String(p || '').trim()).filter(Boolean);
  const blockingFindings = []; const invalidReasons = []; let reportsChecked = 0;
  if (!paths.length) return { ok: false, exitCode: 2, reportsChecked: 0, blockingFindings, invalidReasons: ['empty_report_paths: pass one or more semgrep/axe JSON report files (to validate .omagy/config.json workflow gates on a directory, use "quality-gates").'] };
  for (const rawPath of paths) {
    const abs = path.resolve(rawPath);
    if (!fs.existsSync(abs)) { invalidReasons.push(`missing_report:${rawPath}`); continue; }
    let st;
    try { st = fs.lstatSync(abs); } catch { /* fail open: record unreadable_report */ invalidReasons.push(`unreadable_report:${rawPath}`); continue; }
    if (st.isDirectory()) { invalidReasons.push(`directory_argument:${rawPath} — 'quality-gate' validates semgrep/axe JSON report files; to validate .omagy/config.json workflow gates on a workspace directory, run 'sh ./hooks/run.sh quality-gates ${rawPath}'.`); continue; }
    if (st.isSymbolicLink() || !st.isFile()) { invalidReasons.push(`invalid_file_type:${rawPath}`); continue; }
    let parsed;
    try { parsed = JSON.parse(readUtf8(abs)); } catch { /* fail open: record invalid_json */ invalidReasons.push(`invalid_json:${rawPath}`); continue; }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('results' in parsed || 'paths' in parsed)) {
      reportsChecked += 1;
      if (Array.isArray(parsed.errors) && parsed.errors.length) invalidReasons.push(`scanner_errors:${rawPath} (${parsed.errors.length} error(s))`);
      if (!Array.isArray(parsed.paths?.scanned) || !parsed.paths.scanned.length) invalidReasons.push(`empty_scanned_paths:${rawPath}`);
      if (!Array.isArray(parsed.results)) { invalidReasons.push(`malformed_semgrep_results:${rawPath}`); continue; }
      for (const it of parsed.results) {
        const sev = String(it?.extra?.severity ?? it?.severity ?? '').trim().toUpperCase();
        if (!sev || (!SEMGREP_BLK.has(sev) && !SEMGREP_OK.has(sev))) invalidReasons.push(`unknown_severity:${rawPath}:${sev || '<empty>'}`);
        else if (SEMGREP_BLK.has(sev)) blockingFindings.push({ file: String(it?.path || rawPath), tool: 'semgrep', severity: sev, ruleId: String(it?.check_id || 'unknown'), message: String(it?.extra?.message || it?.message || '') });
      }
    } else if (Array.isArray(parsed) || isAxePage(parsed)) {
      const pages = Array.isArray(parsed) ? parsed : [parsed];
      reportsChecked += 1;
      if (!pages.length) { invalidReasons.push(`empty_audit:${rawPath} (0 pages)`); continue; }
      for (const pg of pages) {
        if (!isAxePage(pg)) { invalidReasons.push(`malformed_axe_page:${rawPath}`); continue; }
        const url = String(pg.url ?? '').trim();
        if (!/^https?:\/\/\S+/i.test(url)) invalidReasons.push(`invalid_page_url:${rawPath}:${url || '<missing>'}`);
        if (!Array.isArray(pg.violations)) { invalidReasons.push(`malformed_axe_violations:${rawPath}`); continue; }
        if ((Array.isArray(pg.passes) ? pg.passes.length : 0) + pg.violations.length + (Array.isArray(pg.incomplete) ? pg.incomplete.length : 0) === 0) invalidReasons.push(`empty_audit:${rawPath} (0 audited checks)`);
        for (const v of pg.violations) {
          const imp = String(v?.impact ?? '').trim().toLowerCase();
          if (!imp || (!AXE_BLK.has(imp) && !AXE_OK.has(imp))) invalidReasons.push(`unknown_severity:${rawPath}:${imp || '<empty>'}`);
          else if (AXE_BLK.has(imp)) blockingFindings.push({ file: rawPath, tool: 'axe', severity: imp, ruleId: String(v?.id || 'unknown'), message: String(v?.help || v?.description || '') });
        }
      }
    } else invalidReasons.push(`unknown_scanner_schema:${rawPath}`);
  }
  const exitCode = invalidReasons.length ? 2 : (blockingFindings.length ? 1 : 0);
  return { ok: exitCode === 0, exitCode, reportsChecked, blockingFindings, invalidReasons };
}

export function githubSlugger(rawHeading, seenCounts = null) {
  const base = String(rawHeading || '').replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').replace(/<[!\/a-z][^>]*>/gi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase().replace(/[`*~]/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
  if (!(seenCounts instanceof Map)) return base;
  const prev = seenCounts.get(base);
  if (prev === undefined) { seenCounts.set(base, 0); return base; }
  seenCounts.set(base, prev + 1);
  return `${base}-${prev + 1}`;
}

function blankFencedLines(markdown) {
  const out = []; let ch = ''; let len = 0;
  for (const line of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      if (!ch) { ch = fm[1][0]; len = fm[1].length; out.push(''); continue; }
      if (fm[1][0] === ch && fm[1].length >= len && /^ {0,3}(?:`+|~+)\s*$/.test(line)) { ch = ''; len = 0; out.push(''); continue; }
    }
    out.push(ch ? '' : line);
  }
  return out;
}
function stripFencedCodeBlocks(md) { return blankFencedLines(md).join('\n'); }

function unquoteYamlScalar(rawVal, errTag, errors) {
  const q = rawVal[0]; let closed = -1; let out = '';
  for (let i = 1; i < rawVal.length; i += 1) {
    const c = rawVal[i];
    if (q === '"' && c === '\\') { if (i + 1 >= rawVal.length) break; const nx = rawVal[++i]; out += nx === 'n' ? '\n' : (nx === 't' ? '\t' : nx); continue; }
    if (c === q) { if (q === "'" && rawVal[i + 1] === "'") { out += "'"; i += 1; continue; } closed = i; break; }
    out += c;
  }
  if (closed === -1) { errors.push(`unclosed_quote:${errTag}`); return { ok: false, value: rawVal.slice(1) }; }
  const tr = rawVal.slice(closed + 1).trim();
  if (tr && !tr.startsWith('#')) errors.push(`trailing_after_quote:${errTag}`);
  return { ok: true, value: out };
}

function extractHeadingAnchorSet(markdownRaw) {
  const slugs = new Set(); const seen = new Map();
  for (const line of blankFencedLines(String(markdownRaw || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''))) {
    const hm = /^ {0,3}#{1,6}\s+(.+)$/.exec(line);
    if (hm) { const s = githubSlugger(hm[1], seen); if (s) slugs.add(s); }
  }
  return slugs;
}

export function validateFrontmatterYaml(rawMarkdown, allowedKeys = ['name', 'description'], requiredKeys = ['name', 'description'], options = {}) {
  const raw = String(rawMarkdown || '');
  const errors = []; const fields = {};
  if (!/^---\r?\n/.test(raw)) return { ok: false, fields, errors: ['missing_frontmatter'] };
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!fmMatch) return { ok: false, fields, errors: ['unclosed_frontmatter'] };
  const allowedSet = allowedKeys ? new Set(allowedKeys) : null;
  const arraySet = new Set(Array.isArray(options?.arrayKeys) ? options.arrayKeys : []);
  const lines = fmMatch[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]; const ln = i + 2;
    if (line.includes('\t')) errors.push(`tab_indentation:line_${ln}`);
    const tr = line.trim();
    if (!tr || tr.startsWith('#')) continue;
    if (/^[ \t]+/.test(line)) { errors.push(`unexpected_indentation:line_${ln}`); continue; }
    const km = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(line);
    if (!km) { errors.push(`malformed_mapping:line_${ln}`); continue; }
    const key = km[1]; const rawVal = km[2].trim();
    const okKey = !allowedSet || allowedSet.has(key);
    if (!okKey) errors.push(`disallowed_key:${key}`);
    if (hasOwn(fields, key)) errors.push(`duplicate_key:${key}`);

    if (okKey && arraySet.has(key)) {
      if (!rawVal || rawVal.startsWith('#')) {
        const items = [];
        while (i + 1 < lines.length) {
          const nl = lines[i + 1]; const nln = i + 3; const nt = nl.trim();
          if (!nt || nt.startsWith('#')) { if (nl.includes('\t')) errors.push(`tab_indentation:line_${nln}`); i += 1; continue; }
          if (!/^[ \t]+/.test(nl)) break;
          i += 1;
          if (nl.includes('\t')) errors.push(`tab_indentation:line_${nln}`);
          const lm = /^  -\s*(.*)$/.exec(nl);
          if (!lm) { errors.push(`unexpected_indentation:line_${nln}`); continue; }
          const it = lm[1].replace(/\s+#.*$/, '').trim();
          if (!/^[A-Za-z0-9_-]+$/.test(it)) errors.push(`invalid_array_item:${key}`); else items.push(it);
        }
        if (!items.length) errors.push(`empty_array:${key}`);
        fields[key] = items; continue;
      }
      if (rawVal.startsWith('[')) {
        const ci = rawVal.indexOf(']');
        if (ci === -1) { errors.push(`unclosed_flow_array:${key}`); fields[key] = []; continue; }
        const after = rawVal.slice(ci + 1).trim();
        if (after && !after.startsWith('#')) errors.push(`trailing_after_array:${key}`);
        const inner = rawVal.slice(1, ci).trim();
        if (!inner) { errors.push(`empty_array:${key}`); fields[key] = []; continue; }
        const items = [];
        for (const p of inner.split(',')) { const it = p.trim(); if (!/^[A-Za-z0-9_-]+$/.test(it)) errors.push(`invalid_array_item:${key}`); else items.push(it); }
        fields[key] = items; continue;
      }
      errors.push(`expected_array:${key}`); fields[key] = []; continue;
    }
    if (okKey && (key === 'subagent' || key === 'mainAgent')) {
      const pb = rawVal.replace(/\s+#.*$/, '').trim();
      if (pb !== 'true' && pb !== 'false') errors.push(`invalid_boolean:${key}`);
      fields[key] = pb; continue;
    }
    if (!rawVal) { fields[key] = ''; errors.push(`empty_scalar:${key}`); continue; }
    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      const qRes = unquoteYamlScalar(rawVal, key, errors);
      if (qRes.ok) fields[key] = qRes.value;
    } else {
      const plain = rawVal.replace(/\s+#.*$/, '').trim();
      if (plain === 'true' || plain === 'false') errors.push(`unexpected_boolean:${key}`);
      if (/^[\[{!&`@%*,|>?]/.test(plain)) errors.push(`reserved_plain_scalar:${key}`);
      if (/:(?:\s|$)/.test(plain)) errors.push(`unquoted_colon_hazard:${key}`);
      fields[key] = plain;
    }
  }
  for (const req of requiredKeys || []) {
    const v = fields[req];
    if (Array.isArray(v) ? !v.length : (!v || !String(v).trim())) errors.push(`missing_required_key:${req}`);
  }
  return { ok: !errors.length, fields, errors };
}

export function validateReferenceLinks(skillsDir) {
  const baseSkills = canonicalizeLocal(skillsDir);
  const errors = [];
  if (!fs.existsSync(baseSkills)) return { ok: false, errors: [`missing_skills_dir:${baseSkills}`] };
  const anchorCache = new Map();
  const mdFiles = [];
  const walk = (d) => { for (const e of listEntries(d)) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && e.name.endsWith('.md')) mdFiles.push(f); } };
  walk(baseSkills);

  for (const src of mdFiles) {
    const relSrc = path.relative(baseSkills, src).replace(/\\/g, '/');
    const body = fs.readFileSync(src, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    transformOutsideCodeSpans(body, (seg) => {
      const re = /\[[^\]]*\]\(([^)\r\n]+)\)/g;
      let m;
      while ((m = re.exec(seg)) !== null) {
        const href = m[1].trim().replace(/\s+["'][^"']*["']\s*$/, '');
        if (!href || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || /[<>{}*$`]/.test(href)) continue;
        let fp = ''; let ap = '';
        if (href.startsWith('#')) ap = href.slice(1);
        else { const mm = /^([^#?\s]+\.md)(?:#([^?\s]+))?$/i.exec(href); if (!mm) continue; fp = mm[1]; ap = mm[2] || ''; }
        const tgt = canonicalizeLocal(fp ? path.resolve(path.dirname(src), fp) : src);
        if (tgt !== baseSkills && !tgt.startsWith(baseSkills + path.sep)) { errors.push(`${relSrc}:outside-skills-dir=${href}`); continue; }
        if (!isFile(tgt)) { errors.push(`${relSrc}:missing-ref=${href}`); continue; }
        if (ap) {
          let dec = ap; try { dec = decodeURIComponent(ap); } catch { /* fail open: keep raw anchor on literal percent */ }
          if (!anchorCache.has(tgt)) anchorCache.set(tgt, extractHeadingAnchorSet(fs.readFileSync(tgt, 'utf8')));
          const anc = anchorCache.get(tgt);
          if (!anc.has(dec.toLowerCase())) errors.push(`${relSrc}:missing-anchor=${href} (available: ${[...anc].slice(0, 8).join(', ')})`);
        }
      }
      return seg;
    });
  }
  return { ok: !errors.length, errors };
}

function collectPluginScanFiles(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const out = [];
  const walk = (d) => { for (const e of listEntries(d)) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && /\.(?:md|mjs|js|sh|json)$/i.test(e.name)) out.push(f); } };
  for (const sub of ['rules', 'skills', 'agents', 'hooks', 'sidecars']) if (fs.existsSync(path.join(root, sub))) walk(path.join(root, sub));
  return out;
}

export function validateArtifactPathParity(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const violations = [];
  const re = /\.omagy\/([^\s`'")\]}>,;]+)/g;
  for (const full of collectPluginScanFiles(root)) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(lines[i])) !== null) {
        const seg = m[1].split('/')[0].replace(/[.:;!?]+$/, '');
        if (seg && seg !== '.' && seg !== '..' && !/[*<>{}$\\]/.test(seg) && !CANONICAL_OMAGY_SUBROOTS.has(seg)) violations.push({ file: rel, line: i + 1, subroot: seg, match: m[0] });
      }
    }
  }
  return { ok: !violations.length, violations };
}

export function validateStagedDiffRedaction(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const violations = [];
  const unsafeRe = /\bgit\s+diff\s+[^\r\n'"`]*--(?:staged|cached)\b/;
  const safeRe = /--(?:name-only|name-status|stat|numstat|shortstat|quiet|check)\b/;
  for (const full of collectPluginScanFiles(root)) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) if (unsafeRe.test(lines[i]) && !safeRe.test(lines[i])) violations.push({ file: rel, line: i + 1, snippet: lines[i].trim().slice(0, 160) });
  }
  return { ok: !violations.length, violations };
}

const REQUIRED_DESIGN_CATEGORIES = ['colors', 'typography', 'spacing', 'shapes'];
const META_TOKEN_PLACEHOLDERS = new Set(['category.token', 'category.subpath', 'token.name', 'category.property', 'property.token']);
const STITCH_SECTIONS = [
  ['Overview', 'Overview'], ['Colors', 'Colors'], ['Typography', 'Typography'], ['Layout', 'Layout'],
  ['Elevation & Depth', 'Elevation\\s*(?:&|and)\\s*Depth'], ['Shapes', 'Shapes'], ['Components', 'Components'], ["Do's and Don'ts", "Do['’]s\\s+and\\s+Don['’]ts"],
].map(([name, p]) => ({ name, re: new RegExp(`^ {0,3}##\\s+(?:\\d+\\.\\s+)?${p}\\b`, 'im') }));

function parseCssColor(rawColor) {
  if (typeof rawColor !== 'string') return null;
  const s = rawColor.trim();
  const hm = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hm) {
    const h = hm[1];
    return (h.length <= 4)
      ? { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 }
      : { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const rm = /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)(?:\s*[,/]\s*([+-]?\d*(?:\.\d+)?)(%?))?\s*\)$/i.exec(s);
  if (!rm) return null;
  const [r, g, b] = [Number(rm[1]), Number(rm[2]), Number(rm[3])];
  if ([r, g, b].some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return null;
  const a = (rm[4] !== undefined && rm[4] !== '') ? (rm[5] === '%' ? Number(rm[4]) / 100 : Number(rm[4])) : 1;
  return (!Number.isFinite(a) || a < 0 || a > 1) ? null : { r, g, b, a };
}

export function computeWcagContrast(fgHexOrRgb, bgHexOrRgb) {
  const fg = parseCssColor(fgHexOrRgb); const bg = parseCssColor(bgHexOrRgb);
  if (!fg || !bg) return null;
  const blend = (c, b) => (c.a < 1 ? { r: c.r * c.a + b.r * (1 - c.a), g: c.g * c.a + b.g * (1 - c.a), b: c.b * c.a + b.b * (1 - c.a) } : c);
  const baseBg = blend(bg, { r: 255, g: 255, b: 255 });
  const effFg = blend(fg, baseBg);
  const lin = (ch) => { const c = ch / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (rgb) => 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  const l1 = lum(effFg); const l2 = lum(baseBg);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

const parseDesignScalar = (v, ln, errors) => ((v.startsWith('"') || v.startsWith("'")) ? unquoteYamlScalar(v, `line_${ln}`, errors).value : v.replace(/\s+#.*$/, '').trim());

function parseInlineFlowObject(rawVal, lineNum, errors) {
  const inner = rawVal.slice(1, -1).trim();
  const obj = {};
  if (!inner) return obj;
  const parts = []; let cur = ''; let q = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (q) { cur += c; if (c === '\\' && q === '"' && i + 1 < inner.length) cur += inner[++i]; else if (c === q) q = ''; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx === -1) { errors.push(`malformed_flow_entry:line_${lineNum}`); continue; }
    const k = part.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
    if (k) obj[k] = parseDesignScalar(part.slice(idx + 1).trim(), lineNum, errors);
  }
  return obj;
}

function parseDesignYaml(yamlText) {
  const errors = []; const root = {}; const stack = [{ indent: -1, map: root }];
  const lines = String(yamlText || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]; const ln = i + 2;
    if (line.includes('\t')) errors.push(`tab_indentation:line_${ln}`);
    const tr = line.trim();
    if (!tr || tr.startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;
    const km = /^([A-Za-z0-9_][A-Za-z0-9_-]*|['"][^'"]+['"])\s*:(.*)$/.exec(tr);
    if (!km) { errors.push(`malformed_yaml_line:line_${ln}`); continue; }
    const key = km[1].replace(/^['"]|['"]$/g, ''); const rv = km[2].trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const pm = stack[stack.length - 1].map;
    if (!rv || (rv.startsWith('#') && !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?:\s+#.*)?$/.test(rv))) { const ch = {}; pm[key] = ch; stack.push({ indent, map: ch }); }
    else pm[key] = (rv.startsWith('{') && rv.endsWith('}')) ? parseInlineFlowObject(rv, ln, errors) : parseDesignScalar(rv, ln, errors);
  }
  return { tree: root, errors };
}

export function flattenTokens(obj, prefix = '') {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const fk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (hasOwn(v, 'value') && v.value !== null && typeof v.value !== 'object') out[fk] = String(v.value);
      Object.assign(out, flattenTokens(v, fk));
    } else if (v !== undefined && v !== null) out[fk] = String(v);
  }
  return out;
}

export function validateDesignMd(filePath, options = {}) {
  const rawArg = typeof filePath === 'string' ? filePath.trim() : '';
  const empty = (exitCode, file, err) => ({ ok: false, exitCode, file, categoriesFound: [], sectionsFound: [], tokenCount: 0, contrastChecks: [], unresolvedRefs: [], errors: err ? [err] : [], warnings: [] });
  if (!rawArg) return empty(2, '', 'missing_file_argument');
  const abs = path.resolve(rawArg);
  if (!fs.existsSync(abs)) return empty(2, abs, `missing_file:${rawArg}`);
  let norm = '';
  try {
    if (!fs.statSync(abs).isFile()) return empty(2, abs, `not_a_file:${rawArg}`);
    norm = readUtf8(abs).replace(/\r\n/g, '\n');
  } catch (err) { /* fail open: report unreadable DESIGN.md with exitCode 2 */ return empty(2, abs, `unreadable_file:${errMsg(err)}`); }

  const fmMatch = /^---\n(?:([\s\S]*?)\n)?---(?:\n|$)([\s\S]*)$/.exec(norm);
  if (!fmMatch) return empty(1, abs, 'missing_or_unclosed_frontmatter');

  const { tree, errors } = parseDesignYaml(fmMatch[1] || '');
  const warnings = [];
  const categoriesFound = Object.keys(tree).filter((k) => tree[k] && typeof tree[k] === 'object' && !Array.isArray(tree[k]));
  for (const cat of REQUIRED_DESIGN_CATEGORIES) if (!tree[cat] || typeof tree[cat] !== 'object' || Array.isArray(tree[cat]) || !Object.keys(tree[cat]).length) errors.push(`missing_category:${cat}`);
  if (tree.typography && typeof tree.typography === 'object') {
    if (!tree.typography.fontFamily) warnings.push('missing_recommended_token:typography.fontFamily');
    if (!tree.typography.fontSize) warnings.push('missing_recommended_token:typography.fontSize');
  }
  if (tree.shapes && typeof tree.shapes === 'object' && !tree.shapes.radius) warnings.push('missing_recommended_token:shapes.radius');

  const flat = flattenTokens(tree);
  const proseBody = stripFencedCodeBlocks(fmMatch[2] || '');
  const sectionsFound = [];
  for (const sec of STITCH_SECTIONS) if (sec.re.test(proseBody)) sectionsFound.push(sec.name); else errors.push(`missing_section:${sec.name}`);

  const missingSet = new Set();
  const refRe = /\{([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)\}/g;
  let tm;
  while ((tm = refRe.exec(proseBody)) !== null) if (!META_TOKEN_PLACEHOLDERS.has(tm[1]) && !hasOwn(flat, tm[1])) missingSet.add(tm[1]);
  const unresolvedRefs = [...missingSet].sort().map((r) => `{${r}}`);
  for (const b of unresolvedRefs) errors.push(`unresolved_token_ref:${b}`);

  const minRequired = options?.strict ? 7.0 : 4.5;
  const contrastChecks = [];
  const gc = (k) => (hasOwn(flat, `colors.${k}`) ? flat[`colors.${k}`] : '');
  const pairs = [['textPrimary', 'background'], ['textPrimary', 'surface'], ['foreground', 'background'], ['foreground', 'surface'], ['textSecondary', 'background'], ['textSecondary', 'surface'], ['textMuted', 'background'], ['textMuted', 'surface'], ['primaryForeground', 'primary'], ['secondaryForeground', 'secondary']];
  if (!gc('textPrimary') && !gc('foreground') && !gc('primaryForeground')) pairs.push(['primary', 'background']);
  for (const [fgK, bgK] of pairs) {
    const fg = gc(fgK); const bg = gc(bgK);
    if (!fg || !bg) continue;
    const pair = `${fgK} vs ${bgK}`; const ratio = computeWcagContrast(fg, bg); const pass = ratio !== null && ratio >= minRequired;
    contrastChecks.push({ pair, fg, bg, ratio: ratio ?? 0, minRequired, pass });
    if (!pass) errors.push(`contrast_failed:${pair}:${ratio ?? 'invalid'}<${minRequired}`);
  }
  const ok = !errors.length;
  return { ok, exitCode: ok ? 0 : 1, file: abs, categoriesFound, sectionsFound, tokenCount: Object.keys(flat).length, contrastChecks, unresolvedRefs, errors, warnings };
}

// ---------- Phase 1 Deterministic Workflow CLI Subcommands (G6) ----------
const SHELL_BINS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'cmd']);
const BASE_NEG = "never|do\\s+not|don['’]?t|dont|without|avoid|forbid(?:s|den|ding)?|prohibit(?:s|ed|ing)?|reject(?:s|ed|ing)?";
const LOOKOUT_NEG_RE = new RegExp(`\\b(?:${BASE_NEG}|blocks?|prevent(?:s|ed|ing)?)\\b`, 'i');
const TIMELINE_NEG_RE = new RegExp(`\\b(?:${BASE_NEG}|no\\s+fake|anti-pattern)\\b`, 'i');
const LOOKOUT_RULES = [
  ['rm-root-or-home', /\brm\s+(?:-[A-Za-z]*[rf][A-Za-z]*\s+|--(?:recursive|force)\s+){1,4}(?:\/(?:\s|$|\*|[;|&)])|~(?:\/|\s|$|[;|&)])|\$HOME\b|\$\{HOME\})/g],
  ['git-reset-hard', /\bgit\s+reset\s+--hard\b/g], ['git-clean-force', /\bgit\s+clean\s+(?:-[A-Za-z]*f|--force\b)/g],
  ['git-push-force', /\bgit\s+push\b[^\r\n;|&]*(?:--force(?!-with-lease|-if-includes)\b|\s-[A-Za-z]*f\b)/g],
  ['sql-drop', /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/gi], ['sql-truncate', /\bTRUNCATE\s+TABLE\b/gi],
  ['sql-delete-unscoped', /\bDELETE\s+FROM\s+[A-Za-z0-9_."'`]+\s*;/gi], ['terraform-destroy-auto', /\bterraform\s+destroy\b[^\r\n;|&]*-auto-approve\b/g],
];
const FAKE_TIMELINE_RES = [/\bWeek\s+\d+\b/gi, /\b\d+\s*[-–]\s*\d+\s*(?:days?|weeks?|months?)\b/gi, /\bQ[1-4]\s+20\d{2}\b/g, /\bSprint\s+\d+\b/gi];
const SKIP_SCAN_DIRS = new Set(['.git', '.hg', '.svn', '.omagy', 'omagy_wiki', 'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', '__pycache__', '.next', '.nuxt', '.venv', 'venv']);
const strArg = (x) => (typeof x === 'string' ? x.trim() : '');
const slugify = (s, fb) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fb;
const toPosix = (p) => p.replace(/\\/g, '/');

function hasNeg48(line, idx, negRe = LOOKOUT_NEG_RE) {
  let s = Math.max(0, idx - 48);
  if (s > 0 && /\w/.test(line[s - 1])) while (s < idx && /\w/.test(line[s])) s += 1;
  return negRe.test(line.slice(s, idx).split(/[.!?]\s+/).pop());
}

function isExecutableRealCommand(cmdList) {
  const hasReal = (s) => s.split(/&&|\|\||;|\r?\n/).some((x) => isRealVerificationCommand(x.trim()));
  const cmdStr = cmdList.join(' ').trim();
  if (!cmdStr || !isRealVerificationCommand(cmdStr) || !hasReal(cmdStr)) return false;
  if (!SHELL_BINS.has(path.basename(String(cmdList[0] || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/\.exe$/, ''))) return true;
  if (cmdList.length === 1) {
    const m = /(?:^|\s)(?:-[A-Za-z]*c|\/c)\s+(['"]?)([\s\S]+?)\1\s*$/i.exec(cmdList[0]);
    return m ? Boolean(m[2].trim() && hasReal(m[2])) : /\S+\s+[^-\s]\S*/.test(cmdList[0]);
  }
  const i = cmdList.findIndex((a, k) => k > 0 && /^(?:-[A-Za-z]*c|\/c)$/i.test(a));
  return i > 0 ? Boolean(cmdList[i + 1]?.trim() && hasReal(cmdList[i + 1])) : cmdList.slice(1).some((a) => a.trim() && !a.startsWith('-'));
}

export function runGoalDone(cwd, goalId, commandArgs = []) {
  const id = String(goalId || '').trim();
  const fail = (exitCode, error, commandExitCode = -1, headSha = '') => ({ ok: false, exitCode, goalId: id, commandExitCode, evidencePath: '', headSha, error });
  if (!strArg(cwd) || !isDir(path.resolve(cwd))) return fail(2, 'missing_cwd');
  const absCwd = path.resolve(cwd);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return fail(2, 'invalid_or_missing_goal_id');
  const cmdList = Array.isArray(commandArgs) ? commandArgs.map(String) : [];
  if (!cmdList.join(' ').trim()) return fail(2, 'missing_verification_command');

  let workDir = absCwd; let goalsPath = path.join(workDir, '.omagy', 'ultragoal', 'goals.json');
  if (!isFile(goalsPath)) {
    const sr = stateRoot(absCwd); const alt = path.join(sr, '.omagy', 'ultragoal', 'goals.json');
    if (isFile(alt)) { workDir = sr; goalsPath = alt; } else return fail(2, 'missing_goals_json');
  }
  const goalsObj = readJson(goalsPath);
  const goal = Array.isArray(goalsObj?.goals) ? goalsObj.goals.find((g) => g && String(g.id) === id) : null;
  if (!goal) return fail(2, goalsObj?.goals ? `goal_not_found:${id}` : 'invalid_goals_json');
  if (!isExecutableRealCommand(cmdList)) return fail(1, 'noop_or_invalid_verification_command', -1, gitHead(absCwd));

  const cmdStr = cmdList.join(' ').trim();
  const opts = { cwd: absCwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 };
  const proc = (cmdList.length === 1 && /[\s|&;<>()$`"']/.test(cmdList[0]))
    ? (process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/s', '/c', cmdList[0]], opts) : spawnSync('/bin/sh', ['-c', cmdList[0]], opts))
    : spawnSync(cmdList[0], cmdList.slice(1), opts);
  const headSha = gitHead(absCwd);
  const code = typeof proc.status === 'number' ? proc.status : (proc.error ? 127 : 1);
  if (proc.error || code !== 0) return fail(1, 'verification_command_failed', code, headSha);

  const out = redactSecrets(`${proc.stdout || ''}${proc.stderr ? `\n${proc.stderr}` : ''}`.trim()).slice(0, 8000) || '(exit 0; 0 bytes output)';
  const relEv = `.omagy/evidence/goal-${id}.json`; const absEv = path.join(workDir, relEv); const at = new Date().toISOString();
  try {
    writeJsonStrict(absEv, { goal_id: id, summary: redactSecrets(`Verified goal ${id} via ${cmdStr}`).slice(0, 500), verdict: 'unit-test-verified', ...(headSha ? { verified_head: headSha } : {}), at, verification: [{ command: cmdStr, result: 'passed', exit_code: 0, output: out }], unverified: [] });
    validateCompletionEvidence(workDir, relEv);
  } catch (err) {
    try { fs.rmSync(absEv, { force: true }); } catch { /* fail open: cleanup rejected evidence */ }
    return fail(1, `evidence_validation_failed:${errMsg(err)}`, 0, headSha);
  }
  goal.status = 'complete'; goal.evidence = relEv; goalsObj.updated_at = at;
  writeJsonStrict(goalsPath, goalsObj);
  appendJsonlRecord(path.join(workDir, '.omagy', 'ultragoal', 'ledger.jsonl'), { at, goal_id: id, event: 'checkpoint', status: 'complete', criteria_revision: goalsObj.criteria_revision ?? 1, verdict: 'unit-test-verified', ...(headSha ? { verified_head: headSha } : {}), evidence: relEv, evidence_path: relEv });
  return { ok: true, exitCode: 0, goalId: id, commandExitCode: 0, evidencePath: relEv, headSha };
}

function readShadowCheckpoints(repoDir) {
  let raw = '';
  try { raw = gitOut(repoDir, ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/omagy/checkpoints']); } catch { /* fail open: no refs */ return []; }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const [ref, sha] = line.trim().split('\t');
    if (!ref || !sha) continue;
    try {
      const m = JSON.parse(stripUtf8Bom(gitOut(repoDir, ['log', '-1', '--format=%B', sha]).trim()));
      out.push({ id: String(m.id || ref.replace(/^refs\/omagy\/checkpoints\//, '')), commitSha: sha.trim(), headSha: String(m.headSha || ''), indexTreeSha: String(m.indexTreeSha || ''), workTreeSha: String(m.workTreeSha || ''), untrackedFiles: Array.isArray(m.untrackedFiles) ? m.untrackedFiles : [], createdAt: String(m.createdAt || ''), label: String(m.label || 'snapshot') });
    } catch { /* fail open: skip malformed checkpoint ref */ }
  }
  return out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id));
}

export function manageShadowCheckpoint(action, cwd = process.cwd(), target = '') {
  const act = String(action || '').trim().toLowerCase();
  const base = (exitCode, error = '') => ({ ok: exitCode === 0, exitCode, action: act, id: '', commitSha: '', checkpoints: [], ...(error ? { error } : {}) });
  if (!['create', 'list', 'rollback'].includes(act)) return base(2, 'invalid_checkpoint_action');
  if (!strArg(cwd) || !fs.existsSync(path.resolve(cwd))) return base(2, 'missing_cwd');
  let repoDir = ''; let headSha = '';
  try { repoDir = gitOut(path.resolve(cwd), ['rev-parse', '--show-toplevel']).trim(); headSha = gitOut(repoDir, ['rev-parse', '--verify', 'HEAD^{commit}']).trim(); }
  catch (err) { /* fail open: non-git directory */ return base(2, `not_a_git_worktree:${errMsg(err)}`); }
  if (!repoDir || !headSha) return base(2, 'not_a_git_worktree');
  const pub = (list) => list.map(({ untrackedFiles: _u, ...rest }) => rest);

  if (act === 'list') {
    const full = readShadowCheckpoints(repoDir);
    return { ok: true, exitCode: 0, action: 'list', id: full[0]?.id || '', commitSha: full[0]?.commitSha || '', checkpoints: pub(full) };
  }
  if (act === 'create') {
    const label = String(target || 'snapshot').trim() || 'snapshot';
    const createdAt = new Date().toISOString();
    const pfx = `${createdAt.replace(/[-:.]/g, '')}-${slugify(label, 'snapshot')}`;
    const seen = new Set(readShadowCheckpoints(repoDir).map((c) => c.id));
    let id = pfx; for (let n = 2; seen.has(id); n += 1) id = `${pfx}-${n}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omagy-ckpt-'));
    try {
      const realIdx = path.resolve(repoDir, gitOut(repoDir, ['rev-parse', '--git-path', 'index']).trim());
      const idx1 = path.join(tmpDir, 'i1'); const idx2 = path.join(tmpDir, 'i2');
      if (fs.existsSync(realIdx)) fs.copyFileSync(realIdx, idx1);
      else gitOut(repoDir, ['read-tree', 'HEAD'], { env: { ...process.env, GIT_INDEX_FILE: idx1 } });
      const indexTreeSha = gitOut(repoDir, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: idx1 } }).trim();
      gitOut(repoDir, ['read-tree', indexTreeSha], { env: { ...process.env, GIT_INDEX_FILE: idx2 } });
      gitOut(repoDir, ['add', '-A', '--', '.', ':(exclude).omagy'], { env: { ...process.env, GIT_INDEX_FILE: idx2 }, timeout: 10000 });
      const workTreeSha = gitOut(repoDir, ['write-tree'], { env: { ...process.env, GIT_INDEX_FILE: idx2 } }).trim();
      const untrackedFiles = gitOut(repoDir, ['-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((p) => p && p !== '.omagy' && !p.startsWith('.omagy/'));
      const commitSha = gitOut(repoDir, ['-c', 'user.name=oh-my-agy', '-c', 'user.email=ckpt@oh-my-agy.local', 'commit-tree', workTreeSha, '-p', headSha], { input: JSON.stringify({ id, label, createdAt, headSha, indexTreeSha, workTreeSha, untrackedFiles }), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      gitOut(repoDir, ['update-ref', `refs/omagy/checkpoints/${id}`, commitSha]);
      return { ok: true, exitCode: 0, action: 'create', id, commitSha, checkpoints: pub(readShadowCheckpoints(repoDir)) };
    } catch (err) { return base(1, `checkpoint_create_failed:${errMsg(err)}`); }
    finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  }

  const full = readShadowCheckpoints(repoDir);
  const req = String(target || '').trim().replace(/^refs\/omagy\/checkpoints\//, '');
  if (req && (/\.\.|[\x00-\x1f\x7f~^:?*[\]\\]/.test(req) || req.startsWith('/'))) return { ...base(2, `invalid_checkpoint_id:${req}`), checkpoints: pub(full) };
  const chosen = (!req || req === 'latest') ? full[0] : full.find((c) => c.id === req);
  if (!chosen) return { ...base(2, `unknown_checkpoint_id:${req || 'latest'}`), checkpoints: pub(full) };
  try {
    const zList = (args) => gitOut(repoDir, ['-c', 'core.quotepath=false', ...args]).split('\0').filter(Boolean);
    const wtSet = new Set(zList(['ls-tree', '-r', '-z', '--name-only', chosen.workTreeSha]));
    const repoAbs = path.resolve(repoDir);
    for (const rel of new Set([...zList(['ls-files', '-z', '--others', '--exclude-standard']), ...zList(['ls-files', '-z', '--cached']), ...zList(['ls-tree', '-r', '-z', '--name-only', 'HEAD'])])) {
      if (!rel || rel === '.omagy' || rel.startsWith('.omagy/') || wtSet.has(rel)) continue;
      const fp = path.resolve(repoAbs, rel);
      if (fp.startsWith(repoAbs + path.sep)) { try { fs.rmSync(fp, { force: true }); } catch { /* fail open: ignore removed path */ } }
    }
    if (wtSet.size > 0) gitOut(repoDir, ['checkout', '-f', chosen.workTreeSha, '--', '.', ':(exclude).omagy'], { timeout: 10000 });
    gitOut(repoDir, ['read-tree', '--reset', chosen.indexTreeSha]);
    return { ok: true, exitCode: 0, action: 'rollback', id: chosen.id, commitSha: chosen.commitSha, checkpoints: pub(full), restoredFiles: wtSet.size };
  } catch (err) { return { ...base(1, `checkpoint_rollback_failed:${errMsg(err)}`), id: chosen.id, commitSha: chosen.commitSha, checkpoints: pub(full) }; }
}

export function generateHandoffArtifact(workspaceRoot = process.cwd(), slug = '') {
  const fail = (error) => ({ ok: false, exitCode: 2, artifactPath: '', latestPath: '', activeModes: [], pendingGoals: [], error });
  if (!strArg(workspaceRoot) || !isDir(path.resolve(workspaceRoot))) return fail('invalid_workspace_root');
  const absWs = path.resolve(workspaceRoot);
  const sRoot = fs.existsSync(path.join(absWs, '.omagy')) ? absWs : stateRoot(absWs);
  const term = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'blocked', 'cleared']);
  const active = loadModeStates(sRoot).filter((s) => s.data?.active === true && !term.has(String(s.data.current_phase || '').toLowerCase()));
  const activeModes = active.map((s) => s.mode);
  const gDoc = readJson(path.join(sRoot, '.omagy', 'ultragoal', 'goals.json'));
  const goals = Array.isArray(gDoc?.goals) ? gDoc.goals : [];
  const pending = goals.filter((g) => g && String(g.status) !== 'complete');
  const pendingGoals = pending.map((g) => String(g.id));

  let gitCommits = '_Not a git worktree._'; let gitDirty = '_Clean or non-git worktree._';
  try {
    const lg = gitOut(absWs, ['log', '-n', '5', '--oneline']).trim();
    if (lg) gitCommits = lg.split(/\r?\n/).map((l) => `- \`${l}\``).join('\n');
    const st = gitOut(absWs, ['status', '--short']).trim();
    gitDirty = st ? `\`\`\`text\n${st.slice(0, 1500)}\n\`\`\`` : '- Clean working tree.';
  } catch { /* fail open: git metadata optional in non-git workspace */ }

  const evDir = path.join(sRoot, '.omagy', 'evidence');
  const evLines = listEntries(evDir).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort().slice(-5)
    .map((ef) => { const d = readJson(path.join(evDir, ef)); return d ? `- \`${ef}\`: verdict=\`${d.verdict || 'n/a'}\` — ${String(d.summary || '').slice(0, 140)}` : ''; }).filter(Boolean);

  const nowIso = new Date().toISOString();
  const safeSlug = slugify(slug || activeModes[0] || path.basename(absWs), 'session');
  const md = scrubHome([
    `# Session Handoff (${safeSlug})`, `- **Generated At**: ${nowIso}`, '',
    '## Active Modes', active.length ? active.map((s) => `- \`${s.mode}\`: phase=\`${s.data.current_phase || 'active'}\`, iteration=${s.data.iteration ?? 1}`).join('\n') : '- None active.', '',
    '## Ultragoal Progress & Notepad',
    goals.length ? `- **Completed**: ${goals.length - pending.length}/${goals.length}\n- **Pending Goals**: ${pendingGoals.join(', ') || 'none'}\n${pending.slice(0, 8).map((g) => `  - \`${g.id}\` (${g.status || 'pending'}): ${String(g.title || g.objective || '').slice(0, 140)}`).join('\n')}` : '- No `goals.json` present.',
    '', loadUltragoalNotepad([sRoot]) || '_No ultragoal notepad recorded._', '',
    '## Recent Commits & Dirty Worktree', gitCommits, gitDirty, '',
    '## Verification Status', evLines.length ? evLines.join('\n') : '- No structured `.omagy/evidence/*.json` records found.', '',
    '## Resume Prompt', `Read \`.omagy/artifacts/handoff-latest.md\`${activeModes.length ? ` (${activeModes.join(', ')})` : ''}${pendingGoals.length ? ` and continue from goal \`${pendingGoals[0]}\`.` : ' and continue from the latest verified checkpoint.'}`, '',
  ].join('\n'));
  const artDir = path.join(sRoot, '.omagy', 'artifacts');
  const artifactPath = path.join(artDir, `handoff-${safeSlug}-${nowIso.replace(/[-:.]/g, '')}.md`);
  const latestPath = path.join(artDir, 'handoff-latest.md');
  try { fs.mkdirSync(artDir, { recursive: true }); fs.writeFileSync(artifactPath, md, 'utf8'); fs.writeFileSync(latestPath, md, 'utf8'); }
  catch (err) { return fail(`handoff_write_failed:${errMsg(err)}`); }
  return { ok: true, exitCode: 0, artifactPath, latestPath, activeModes, pendingGoals };
}

export function scanLookoutHazards(inputs = [], baseDir = process.cwd()) {
  const list = Array.isArray(inputs) ? inputs.map((x) => String(x || '')).filter((x) => x.trim()) : [];
  if (!list.length) return { ok: false, exitCode: 2, findings: [], error: 'missing_lookout_inputs' };
  const findings = [];
  const scanText = (source, text) => {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) continue;
      for (const [rule, re] of LOOKOUT_RULES) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(line)) !== null) if (!hasNeg48(line, m.index, LOOKOUT_NEG_RE)) findings.push({ source, line: i + 1, rule, snippet: redactSecrets(line.trim()).slice(0, 160) });
      }
    }
  };
  for (const item of list) {
    const cand = !item.includes('\n') ? path.resolve(baseDir, item) : '';
    if (cand && isFile(cand)) { try { scanText(item, fs.readFileSync(cand, 'utf8')); } catch { /* fail open: unreadable file */ } }
    else if (cand && isDir(cand)) {
      let n = 0;
      const walk = (d) => {
        for (const e of listEntries(d)) {
          if (n >= 200) break;
          const full = path.join(d, e.name);
          if (e.isDirectory()) { if (!SKIP_SCAN_DIRS.has(e.name)) walk(full); }
          else if (e.isFile()) {
            try { if (fs.statSync(full).size <= 524288) { const t = fs.readFileSync(full, 'utf8'); if (!t.includes('\0')) { n += 1; scanText(toPosix(path.relative(baseDir, full)), t); } } }
            catch { /* fail open: unreadable file */ }
          }
        }
      };
      walk(cand);
    } else scanText('<inline>', item);
  }
  return { ok: !findings.length, exitCode: findings.length ? 1 : 0, findings };
}

export function verifyPlanHash(mode, planPath, receiptPath = '', meta = {}) {
  const mMode = String(mode || '').trim().toLowerCase();
  const empty = (exitCode, error = '') => ({ ok: false, exitCode, planHash: '', specHash: '', combinedHash: '', timelineViolations: [], matches: false, ...(error ? { error } : {}) });
  if (mMode !== 'compute' && mMode !== 'verify') return empty(2, 'invalid_plan_hash_mode');
  if (!strArg(planPath) || !isFile(path.resolve(planPath))) return empty(2, 'missing_prd_file');
  const absPlan = path.resolve(planPath);
  let absSpec = meta?.specPath ? path.resolve(String(meta.specPath)) : '';
  if (absSpec && !isFile(absSpec)) return empty(2, 'missing_spec_file');
  const absReceipt = strArg(receiptPath) ? path.resolve(String(receiptPath)) : '';
  if (mMode === 'verify' && !isFile(absReceipt)) return empty(2, 'missing_receipt_file');

  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const prdNorm = readUtf8(absPlan);
  const planHash = sha(prdNorm.replace(/\r\n/g, '\n').trim());

  let rec = null;
  if (mMode === 'verify') {
    try { rec = JSON.parse(readUtf8(absReceipt)); } catch { /* fail open: corrupt receipt JSON */
      return { ok: false, exitCode: 1, planHash, specHash: '', combinedHash: planHash, timelineViolations: [], matches: false, error: 'invalid_receipt_json' };
    }
    if (!absSpec && strArg(rec?.test_spec_file)) {
      for (const b of [meta?.baseDir ? path.resolve(meta.baseDir) : process.cwd(), path.dirname(absPlan), path.resolve(path.dirname(absPlan), '..', '..')]) {
        const c = path.resolve(b, rec.test_spec_file.trim()); if (isFile(c)) { absSpec = c; break; }
      }
    }
  }
  const specHash = absSpec ? sha(readUtf8(absSpec).replace(/\r\n/g, '\n').trim()) : '';
  const combinedHash = specHash ? sha(`${planHash}:${specHash}`) : planHash;
  const timelineViolations = [];
  if (!meta?.allowTimelines) {
    const lines = blankFencedLines(prdNorm);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].trim()) continue;
      const clean = lines[i].replace(/`+[^`]*`+/g, (x) => ' '.repeat(x.length));
      for (const re of FAKE_TIMELINE_RES) {
        re.lastIndex = 0; let m;
        while ((m = re.exec(clean)) !== null) if (!hasNeg48(clean, m.index, TIMELINE_NEG_RE)) timelineViolations.push(`line ${i + 1}: ${m[0].trim()}`);
      }
    }
  }
  if (mMode === 'compute') {
    const slug = path.basename(absPlan, path.extname(absPlan)).replace(/^prd-/, '') || 'plan';
    let outRec = '';
    if ((absReceipt || strArg(meta?.verdict)) && !timelineViolations.length) {
      outRec = absReceipt || path.join(path.dirname(absPlan), `ralplan-review-${slug}.json`);
      const relBase = meta?.baseDir ? path.resolve(meta.baseDir) : process.cwd();
      const relOf = (p) => { const r = toPosix(path.relative(relBase, p)); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : path.basename(p); };
      writeJsonStrict(outRec, { slug, prd_file: relOf(absPlan), test_spec_file: absSpec ? relOf(absSpec) : null, prd_hash: planHash, spec_hash: specHash || null, plan_hash: combinedHash, critic_verdict: strArg(meta?.verdict) || 'APPROVE', verified_at: new Date().toISOString() });
    }
    const ok = !timelineViolations.length;
    return { ok, exitCode: ok ? 0 : 1, planHash, specHash, combinedHash, timelineViolations, matches: ok, ...(outRec ? { receiptPath: outRec } : {}) };
  }
  const matches = !(rec?.test_spec_file && !absSpec) && strArg(rec?.critic_verdict).toUpperCase() === 'APPROVE' && String(rec?.plan_hash || '') === combinedHash && !timelineViolations.length;
  return { ok: matches, exitCode: matches ? 0 : 1, planHash, specHash, combinedHash, timelineViolations, matches, receiptPath: absReceipt };
}

export function scanInitDeepCandidates(rootDir = process.cwd()) {
  if (!strArg(rootDir)) return { ok: false, exitCode: 2, root: '', commitCount: 0, candidates: [], error: 'missing_root_dir' };
  const absRoot = path.resolve(rootDir);
  if (!isDir(absRoot)) return { ok: false, exitCode: 2, root: absRoot, commitCount: 0, candidates: [], error: 'missing_root_dir' };

  const stats = new Map(); let files = 0;
  const walk = (dir, parts) => {
    if (files >= 4000 || parts.length > 6) return;
    for (const e of listEntries(dir)) {
      if (files >= 4000) break;
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP_SCAN_DIRS.has(e.name)) walk(path.join(dir, e.name), [...parts, e.name]); }
      else if (e.isFile() && parts.length >= 1 && CODE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        try {
          const full = path.join(dir, e.name);
          if (fs.statSync(full).size > 524288) continue;
          const loc = fs.readFileSync(full, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
          files += 1;
          for (let d = 1; d <= Math.min(3, parts.length); d += 1) { const k = parts.slice(0, d).join('/'); const r = stats.get(k) || { codeFiles: 0, loc: 0 }; r.codeFiles += 1; r.loc += loc; stats.set(k, r); }
        } catch { /* fail open: unreadable code file */ }
      }
    }
  };
  walk(absRoot, []);

  let commitCount = 0; let sampled = 0; const touches = new Map();
  try {
    commitCount = Number(gitOut(absRoot, ['rev-list', '--count', 'HEAD']).trim()) || 0;
    if (commitCount > 0) for (const blk of gitOut(absRoot, ['-c', 'core.quotepath=false', 'log', '-n', '100', '--pretty=format:__C__', '--name-only']).split('__C__').slice(1)) {
      sampled += 1; const hit = new Set();
      for (const f of blk.split(/\r?\n/)) {
        const s = f.trim().split('/').filter(Boolean);
        if (s.length >= 2 && !s[0].startsWith('.') && !SKIP_SCAN_DIRS.has(s[0])) for (let d = 1; d <= Math.min(3, s.length - 1); d += 1) hit.add(s.slice(0, d).join('/'));
      }
      for (const d of hit) touches.set(d, (touches.get(d) || 0) + 1);
    }
  } catch { /* fail open: non-git directory has 0 churn */ }

  const candidates = [];
  for (const [dir, info] of stats) {
    const churnPct = sampled > 0 ? Math.round(((touches.get(dir) || 0) / sampled) * 1000) / 10 : 0;
    const reasons = [];
    if (info.codeFiles >= 8 && info.loc >= 500) reasons.push('density');
    if (commitCount >= 30 && churnPct >= 15 && info.codeFiles >= 1) reasons.push('churn');
    if (reasons.length) candidates.push({ dir, codeFiles: info.codeFiles, loc: info.loc, churnPct, reasons, hasAgentsMd: isFile(path.join(absRoot, dir, 'AGENTS.md')) });
  }
  candidates.sort((a, b) => (b.loc + b.churnPct * 20) - (a.loc + a.churnPct * 20) || a.dir.localeCompare(b.dir));
  return { ok: true, exitCode: 0, root: absRoot, commitCount, candidates };
}

function walkWikiMd(absWiki, skipIndex = false) {
  const out = [];
  const walk = (d) => { for (const e of listEntries(d)) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && e.name.endsWith('.md') && (!skipIndex || e.name !== 'index.md')) out.push(f); } };
  walk(absWiki);
  return out;
}

function tokenizeWikiText(text) {
  const s = String(text || '').toLowerCase(); const out = []; let m;
  const aRe = /[a-z0-9]+(?:-[a-z0-9]+)*/g;
  while ((m = aRe.exec(s)) !== null) { out.push(m[0]); if (m[0].includes('-')) out.push(...m[0].split('-').filter(Boolean)); }
  const cRe = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
  while ((m = cRe.exec(s)) !== null) { const ch = [...m[0]]; if (ch.length === 1) out.push(ch[0]); else for (let i = 0; i < ch.length - 1; i += 1) out.push(ch[i] + ch[i + 1]); }
  return out;
}

export function queryWikiPages(wikiDir, query) {
  const rawQ = String(query ?? '').trim();
  const absWiki = path.resolve(String(wikiDir || path.join(process.cwd(), 'omagy_wiki')));
  if (!rawQ) return { ok: false, exitCode: 2, query: '', wikiDir: absWiki, results: [], error: 'missing_wiki_query' };
  if (!isDir(absWiki)) return { ok: true, exitCode: 0, query: rawQ, wikiDir: absWiki, results: [] };

  const idxMeta = new Map(); const idxPath = path.join(absWiki, 'index.md');
  if (isFile(idxPath)) {
    try {
      for (const l of readUtf8(idxPath).split(/\r?\n/)) {
        const im = /^\s*-\s*\[\[([^\]|#]+)\]\]\s*[—–-]\s*([^—–\r\n]+?)(?:\s*[—–-]\s*[^—–\r\n]+?\s*[—–-]\s*(.+))?$/.exec(l);
        if (im) idxMeta.set(im[1].trim(), { title: im[2].trim(), tags: im[3] ? im[3].split(',').map((t) => t.trim()).filter(Boolean) : [] });
      }
    } catch { /* fail open: ignore unreadable wiki index */ }
  }
  const qTokens = [...new Set(tokenizeWikiText(rawQ))];
  if (!qTokens.length) return { ok: true, exitCode: 0, query: rawQ, wikiDir: absWiki, results: [] };

  const results = []; const trimQ = (v) => v.trim().replace(/^['"]|['"]$/g, '');
  for (const full of walkWikiMd(absWiki, true)) {
    const slug = path.basename(full, '.md');
    let raw = '';
    try { raw = readUtf8(full); } catch { /* fail open: unreadable wiki page */ continue; }
    let body = raw; let fmTitle = ''; const tags = [];
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    if (fm) {
      body = raw.slice(fm[0].length);
      const fl = fm[1].split(/\r?\n/);
      for (let i = 0; i < fl.length; i += 1) {
        const tm = /^\s*title\s*:\s*(.+)$/.exec(fl[i]); if (tm) fmTitle = trimQ(tm[1]);
        const tg = /^\s*tags\s*:\s*(.*)$/.exec(fl[i]);
        if (tg) {
          const tv = tg[1].trim();
          if (tv.startsWith('[') && tv.includes(']')) tags.push(...tv.slice(1, tv.indexOf(']')).split(',').map(trimQ).filter(Boolean));
          else if (tv) tags.push(...tv.split(',').map(trimQ).filter(Boolean));
          else while (i + 1 < fl.length && /^\s*-\s+/.test(fl[i + 1])) tags.push(trimQ(fl[++i].replace(/^\s*-\s+/, '')));
        }
      }
    }
    const fb = idxMeta.get(slug);
    for (const ft of fb?.tags || []) if (!tags.includes(ft)) tags.push(ft);
    const h1 = /^ {0,3}#\s+(.+)$/m.exec(body);
    const title = fmTitle || (h1 ? h1[1].trim() : '') || fb?.title || slug;
    const bodyNoH1 = body.replace(/^ {0,3}#\s+.+$/m, '');
    const tagSet = new Set(tags.flatMap((t) => [t.toLowerCase(), ...tokenizeWikiText(t)]));
    const titleSet = new Set([...tokenizeWikiText(title), ...tokenizeWikiText(slug), slug.toLowerCase()]);
    const bodySet = new Set(tokenizeWikiText(bodyNoH1));
    let score = 0;
    for (const qt of qTokens) score += (tagSet.has(qt) ? 3 : 0) + (titleSet.has(qt) ? 2 : 0) + (bodySet.has(qt) ? 1 : 0);
    if (score > 0) {
      const snip = bodyNoH1.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
      results.push({ slug, file: toPosix(path.relative(absWiki, full)), title, tags, score, snippet: redactSecrets(snip).slice(0, 160) });
    }
  }
  results.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return { ok: true, exitCode: 0, query: rawQ, wikiDir: absWiki, results };
}

export function lintWikiPages(wikiDir, repoRoot = '') {
  const rawWiki = strArg(wikiDir);
  if (!rawWiki) return { ok: false, exitCode: 2, wikiDir: '', pagesScanned: 0, brokenWikiLinks: [], brokenFileRefs: [], error: 'missing_wiki_dir' };
  const absWiki = path.resolve(rawWiki);
  if (!isDir(absWiki)) return { ok: false, exitCode: 2, wikiDir: absWiki, pagesScanned: 0, brokenWikiLinks: [], brokenFileRefs: [], error: 'missing_wiki_dir' };

  const absRepo = strArg(repoRoot) ? path.resolve(String(repoRoot)) : path.dirname(absWiki);
  const mdFiles = walkWikiMd(absWiki, false);
  const validSlugs = new Set(mdFiles.flatMap((f) => [path.basename(f, '.md'), toPosix(path.relative(absWiki, f)).replace(/\.md$/i, '')]));
  const brokenWikiLinks = []; const brokenFileRefs = []; const lineCache = new Map();
  const fileRefRe = /(?<![A-Za-z0-9_/:.@$<>-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)(?:-(\d+))?\b/g;

  for (const full of mdFiles) {
    const relPage = toPosix(path.relative(absWiki, full));
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
        if (t && !/[<>]/.test(t) && !validSlugs.has(t) && !validSlugs.has(path.basename(t))) brokenWikiLinks.push({ page: relPage, line: i + 1, target: t, raw: wm[0] });
      }
      fileRefRe.lastIndex = 0; let fr;
      while ((fr = fileRefRe.exec(line)) !== null) {
        const rf = fr[1];
        if (rf.includes('..') || /[*<>{}$]/.test(rf)) continue;
        const start = Number(fr[2]); const end = fr[3] ? Number(fr[3]) : start;
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
  const ok = !brokenWikiLinks.length && !brokenFileRefs.length;
  return { ok, exitCode: ok ? 0 : 1, wikiDir: absWiki, pagesScanned: mdFiles.length, brokenWikiLinks, brokenFileRefs };
}

export function scanSessionTranscripts(targetPath = process.cwd()) {
  const empty = (exitCode, error = '') => ({ ok: exitCode === 0, exitCode, filesScanned: 0, totalSteps: 0, compactions: 0, orphanToolCalls: 0, failedToolCalls: 0, topFailureClusters: [], ...(error ? { error } : {}) });
  if (!strArg(targetPath) || !fs.existsSync(path.resolve(targetPath))) return empty(2, 'missing_session_target');
  const absTarget = path.resolve(targetPath);

  const files = [];
  if (isFile(absTarget)) files.push(absTarget);
  else if (isDir(absTarget)) {
    const skip = new Set(['.git', 'node_modules', 'dist', 'build']); const excl = new Set(['ledger.jsonl', 'hook-errors.jsonl']);
    const walk = (d, depth) => {
      if (depth > 5 || files.length >= 100) return;
      const entries = listEntries(d); const names = new Set(entries.map((e) => e.name));
      for (const e of entries) {
        if (files.length >= 100) break;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (!skip.has(e.name)) walk(full, depth + 1); }
        else if (e.isFile() && e.name.endsWith('.jsonl') && !excl.has(e.name) && !(e.name === 'transcript_full.jsonl' && names.has('transcript.jsonl'))) files.push(full);
      }
    };
    walk(absTarget, 0);
  }

  let totalSteps = 0; let compactions = 0; let orphanToolCalls = 0; let failedToolCalls = 0;
  const clusters = new Map();
  const bump = (tool, rawErr) => {
    const ct = String(tool || 'unknown').replace(/[^A-Za-z0-9_:-]/g, '') || 'unknown';
    const lines = scrubHome(normalizeFailureSignature(String(rawErr || ''))).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const sig = (lines.find((l) => /(?:Error|Exception|FAIL|exited with code|ENOENT|EACCES|ETIMEDOUT|SyntaxError|TypeError|AssertionError)/i.test(l)) || lines[0] || `${ct}:error`).replace(/\s+/g, ' ').slice(0, 120);
    const prev = clusters.get(`${ct}::${sig}`) || { tool: ct, signature: sig, count: 0 };
    prev.count += 1; clusters.set(`${ct}::${sig}`, prev);
  };
  const errText = (st, obj, txt, fb) => {
    const badCode = typeof obj.exitCode === 'number' && obj.exitCode !== 0;
    const badOut = typeof txt === 'string' && /Command exited with code [1-9]\d*/.test(txt);
    return (st === 'ERROR' || st === 'FAILED' || obj.error || badCode || badOut) ? (obj.error || txt || (badCode ? `exit code ${obj.exitCode}` : fb)) : '';
  };

  for (const file of files) {
    let records = [];
    try { records = readJsonlRecords(file).records || []; } catch { /* fail open: skip unreadable jsonl */ continue; }
    totalSteps += records.length;
    const pending = new Map(); const idToTool = new Map(); const unidQueue = [];
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      const type = String(rec.type || '').toUpperCase(); const status = String(rec.status || '').toUpperCase();
      const isUser = type === 'USER_INPUT' || rec.role === 'user' || rec.source === 'USER_EXPLICIT';
      if (isUser && unidQueue.length) { orphanToolCalls += unidQueue.length; unidQueue.length = 0; }
      if (type.includes('COMPACT') || (!Array.isArray(rec.tool_calls) && rec.role !== 'assistant' && rec.source !== 'MODEL' && typeof rec.content === 'string' && (rec.content.includes('<CONTEXT_SUMMARY') || /(?:^|\s)\/compact\b/i.test(rec.content)))) compactions += 1;
      const respId = String(rec.tool_call_id || rec.call_id || '').trim();
      if (respId) pending.delete(respId);
      for (const tr of Array.isArray(rec.tool_results) ? rec.tool_results : []) pending.delete(String(tr?.tool_call_id || tr?.call_id || tr?.id || '').trim());

      let counted = false;
      for (const tc of Array.isArray(rec.tool_calls) ? rec.tool_calls : []) {
        if (!tc || typeof tc !== 'object') continue;
        const tName = String(tc.name || tc.toolName || tc.function?.name || 'unknown').replace(/[^A-Za-z0-9_:-]/g, '') || 'unknown';
        const tSt = String(tc.status || '').toUpperCase(); const tId = String(tc.id || tc.call_id || '').trim();
        if (tId) idToTool.set(tId, tName);
        const done = tc.output !== undefined || tc.result !== undefined || tc.exitCode !== undefined || ['DONE', 'COMPLETED', 'ERROR', 'FAILED'].includes(tSt);
        if (['PENDING', 'RUNNING', 'IN_PROGRESS', 'CANCELLED', 'ORPHANED'].includes(tSt)) orphanToolCalls += 1;
        else if (tId && !done) pending.set(tId, tName);
        else if (!tId && !done) { if (['PENDING', 'RUNNING', 'IN_PROGRESS', 'CANCELLED', 'INTERRUPTED'].includes(status)) orphanToolCalls += 1; else unidQueue.push(tName); }
        const e = errText(tSt, tc, tc.output, 'tool_error');
        if (e) { failedToolCalls += 1; counted = true; bump(tName, e); }
      }
      if (type === 'TOOL_RESULT' || type === 'TOOL_RESPONSE' || type === 'GENERIC' || rec.role === 'tool') {
        const matchedUnid = !respId && unidQueue.length ? unidQueue.shift() : '';
        const e = errText(status, rec, rec.content, 'tool_result_error');
        if (e) { failedToolCalls += 1; counted = true; bump((respId && idToTool.get(respId)) || matchedUnid || rec.name || 'tool', e); }
      } else if (!isUser && !counted && (status === 'ERROR' || status === 'FAILED' || rec.error)) {
        failedToolCalls += 1; bump(rec.toolName || 'step', rec.error || `step_${status.toLowerCase()}`);
      }
    }
    orphanToolCalls += pending.size + unidQueue.length;
  }
  const topFailureClusters = [...clusters.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)).slice(0, 10);
  return { ok: true, exitCode: 0, filesScanned: files.length, totalSteps, compactions, orphanToolCalls, failedToolCalls, topFailureClusters };
}

export function handleColdCliCommand(event, rawArgs = [], defaultRoot = '') {
  let dashC = ''; const filtered = []; let afterDD = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (afterDD) filtered.push(a);
    else if (a === '--') { afterDD = true; filtered.push(a); }
    else if (a === '-C' && i + 1 < rawArgs.length) dashC = rawArgs[++i];
    else filtered.push(a);
  }
  const baseDir = dashC ? path.resolve(dashC) : (defaultRoot ? path.resolve(defaultRoot) : (event === 'skill-eval' ? PLUGIN_ROOT : process.cwd()));
  const jm = filtered.includes('--json');
  const pos = filtered.filter((a) => a !== '--json' && a !== '--');
  const rel = (p, fb = baseDir) => (p ? path.resolve(baseDir, p) : fb);
  const emit = (j, res, text) => { process.stdout.write(j ? `${JSON.stringify(res, null, 2)}\n` : `${text}\n`); return res.exitCode; };

  if (event === 'floor-guard') {
    const r = runFloorGuard(rel(pos[0]), pos[1] || '');
    return emit(jm, r, r.exitCode === 2 ? `FLOOR-GUARD: ERROR (exit 2) — ${r.error || 'error'}` : [`FLOOR-GUARD: ${r.ok ? 'PASS' : 'FAIL'} (base=${r.baseSha.slice(0, 7)}, findings=${r.summary.total})`, ...r.findings.map((f) => `${f.file}:${f.line} [${f.category}] ${f.message} :: ${f.snippet}`)].join('\n'));
  }
  if (event === 'skill-eval') {
    const ab = dashC ? path.resolve(dashC) : process.cwd();
    let minRank1 = 95; let casesPath = ''; const sp = [];
    for (let i = 0; i < filtered.length; i += 1) {
      const a = filtered[i];
      if (a === '--json' || a === '--') continue;
      if (a === '--min-rank1' && i + 1 < filtered.length) minRank1 = Number(filtered[++i]);
      else if (a.startsWith('--min-rank1=')) minRank1 = Number(a.slice(12));
      else if (a === '--cases' && i + 1 < filtered.length) casesPath = path.resolve(ab, filtered[++i]);
      else sp.push(a);
    }
    const r = evaluateSkillRouting(sp[0] ? path.resolve(ab, sp[0]) : baseDir, { minRank1, ...(casesPath ? { casesPath } : {}) });
    return emit(jm, r, [`SKILL-EVAL: ${r.ok ? 'PASS' : 'FAIL'} (skills=${r.skillCount}, rank1=${r.rank1Pct}% [min ${r.minRank1}%], negSurvival=${r.negativeSurvivalPct}%, collisions=${r.collisionErrors.length})`, ...r.schemaErrors.map((s) => `SCHEMA: ${s}`), ...r.collisionErrors.map((c) => `COLLISION_ERROR: ${c.pair.join(' <-> ')} (${c.cosine})`), ...r.collisionWarnings.map((c) => `COLLISION_WARN: ${c.pair.join(' <-> ')} (${c.cosine})`), ...r.failures.map((f) => (f.kind === 'positive' ? `MISS [positive] ${f.skill}: "${f.prompt}" -> top=${f.topSkill} (${f.topScore} vs ${f.selfScore})` : `MISS [negative] ${f.skill} vs owner ${f.owner}: "${f.prompt}" (${f.ownerScore} vs ${f.selfScore})`))].join('\n'));
  }
  if (event === 'quality-gate') {
    const r = evaluateQualityGate(pos.map((p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p))));
    return emit(jm, r, [`QUALITY-GATE: ${r.exitCode === 0 ? 'PASS' : (r.exitCode === 2 ? 'INVALID' : 'FAIL')} (reports=${r.reportsChecked}, blocking=${r.blockingFindings.length}, invalid=${r.invalidReasons.length})`, ...r.invalidReasons.map((x) => `INVALID: ${x}`), ...r.blockingFindings.map((b) => `BLOCKING [${b.tool}:${b.severity}] ${b.file} (${b.ruleId}): ${b.message}`)].join('\n'));
  }
  if (event === 'validate-design-md') {
    const strict = pos.includes('--strict'); const dp = pos.filter((a) => a !== '--strict');
    const r = validateDesignMd(dp[0] ? rel(dp[0]) : '', { strict });
    return r.exitCode === 2
      ? emit(jm, r, `VALIDATE-DESIGN-MD: ERROR (exit 2) — ${r.errors.join('; ')}`)
      : emit(jm, r, [`VALIDATE-DESIGN-MD: ${r.ok ? 'PASS' : 'FAIL'} (tokens=${r.tokenCount}, sections=${r.sectionsFound.length}/8, contrast=${r.contrastChecks.filter((c) => c.pass).length}/${r.contrastChecks.length}, errors=${r.errors.length})`, ...r.errors.map((e) => `ERROR: ${e}`), ...r.warnings.map((w) => `WARN: ${w}`)].join('\n'));
  }
  if (event === 'goal-done') {
    const dd = filtered.indexOf('--');
    let gj = false; let gid = ''; let cmd = [];
    if (dd !== -1) { const pre = filtered.slice(0, dd); gj = pre.includes('--json'); gid = pre.find((a) => a !== '--json') || ''; cmd = filtered.slice(dd + 1); }
    else for (const a of filtered) { if ((!gid || !cmd.length) && a === '--json') gj = true; else if (!gid) gid = a; else cmd.push(a); }
    const r = runGoalDone(baseDir, gid, cmd);
    return emit(gj, r, `GOAL-DONE: ${r.ok ? 'PASS' : 'FAIL'} (goal=${r.goalId || 'n/a'}, exit=${r.exitCode}${r.evidencePath ? `, evidence=${r.evidencePath}` : ''}${r.error ? `, error=${r.error}` : ''})`);
  }
  if (event === 'checkpoint') {
    const r = manageShadowCheckpoint(pos[0] || '', baseDir, pos[1] || '');
    return emit(jm, r, `CHECKPOINT: ${r.ok ? 'PASS' : 'FAIL'} (action=${r.action || 'n/a'}, id=${r.id || 'none'}, count=${r.checkpoints.length}${r.error ? `, error=${r.error}` : ''})`);
  }
  if (event === 'handoff') {
    const r = generateHandoffArtifact(rel(pos[0]), pos[1] || '');
    return emit(jm, r, `HANDOFF: ${r.ok ? 'PASS' : 'FAIL'} (${r.artifactPath || r.error || 'error'})`);
  }
  if (event === 'lookout') {
    const r = scanLookoutHazards(pos, baseDir);
    return emit(jm, r, [`LOOKOUT: ${r.ok ? 'PASS' : 'FAIL'} (findings=${r.findings.length})`, ...r.findings.map((f) => `${f.source}:${f.line} [${f.rule}] ${f.snippet}`)].join('\n'));
  }
  if (event === 'plan-hash') {
    let allowTimelines = false; let specPath = ''; let verdict = ''; const pp = [];
    for (let i = 0; i < pos.length; i += 1) {
      const a = pos[i];
      if (a === '--allow-timelines') allowTimelines = true;
      else if (a === '--spec' && i + 1 < pos.length) specPath = rel(pos[++i]);
      else if (a.startsWith('--spec=')) specPath = rel(a.slice(7));
      else if (a === '--write-receipt') verdict = (i + 1 < pos.length && !pos[i + 1].startsWith('--')) ? pos[++i] : 'APPROVE';
      else if (a.startsWith('--write-receipt=')) verdict = a.slice(16) || 'APPROVE';
      else pp.push(a);
    }
    const r = verifyPlanHash(pp[0] || '', pp[1] ? rel(pp[1]) : '', pp[2] ? rel(pp[2]) : '', { specPath, verdict, allowTimelines, baseDir });
    return emit(jm, r, [`PLAN-HASH: ${r.ok ? 'PASS' : 'FAIL'} (hash=${r.combinedHash.slice(0, 12) || 'n/a'}, timelines=${r.timelineViolations.length})`, ...r.timelineViolations].join('\n'));
  }
  if (event === 'init-deep-scan') {
    const r = scanInitDeepCandidates(rel(pos[0]));
    return emit(jm, r, [`INIT-DEEP-SCAN: ${r.ok ? 'PASS' : 'ERROR'} (commits=${r.commitCount}, candidates=${r.candidates.length})`, ...r.candidates.map((c) => `${c.dir} (files=${c.codeFiles}, loc=${c.loc}, churn=${c.churnPct}%, reasons=${c.reasons.join(',')})`)].join('\n'));
  }
  if (event === 'wiki-query') {
    const r = queryWikiPages(rel(pos[1], path.join(baseDir, 'omagy_wiki')), pos[0] || '');
    return emit(jm, r, [`WIKI-QUERY: ${r.ok ? 'PASS' : 'ERROR'} (hits=${r.results.length})`, ...r.results.map((x) => `${x.slug} [score=${x.score}] — ${x.title}`)].join('\n'));
  }
  if (event === 'wiki-lint') {
    const r = lintWikiPages(rel(pos[0], path.join(baseDir, 'omagy_wiki')), rel(pos[1]));
    return emit(jm, r, `WIKI-LINT: ${r.ok ? 'PASS' : 'FAIL'} (pages=${r.pagesScanned}, brokenLinks=${r.brokenWikiLinks.length}, brokenRefs=${r.brokenFileRefs.length})`);
  }
  if (event === 'session-scan') {
    const r = scanSessionTranscripts(rel(pos[0]));
    return emit(jm, r, `SESSION-SCAN: ${r.ok ? 'PASS' : 'ERROR'} (files=${r.filesScanned}, steps=${r.totalSteps}, compactions=${r.compactions}, orphans=${r.orphanToolCalls}, failures=${r.failedToolCalls})`);
  }
  process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 2, event, cwd: baseDir, error: `Cold CLI command '${event}' is not yet implemented.` })}\n`);
  return 2;
}


