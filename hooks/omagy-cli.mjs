// Cold-path CLI evaluators and static hygiene validators for oh-my-agy.
// Loaded lazily via `await import('./omagy-cli.mjs')` so hot-path lifecycle hooks stay fast and small.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  TEST_FILE_NAME_RE,
  parseUnifiedDiff,
  redactSecrets,
  scanRepoCodeHygiene,
  stripCodeStrings,
  stripUtf8Bom,
  transformOutsideCodeSpans,
} from './omagy-hook.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UNTRACKED_MAX_FILES = 200;
const ASSERTION_LINE_RE = /\b(?:expect|assert(?:\.[A-Za-z_]\w*|_[a-z_]+!?)?|should)\s*(?:\(|\.)|^\s*assert\s+\S/;
const THRESHOLD_TOKEN_RE = /(?<![-=])(<=|>=|<|>|≤|≥)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|(?:bytes?|kb|mb|gb|b|ms|secs?|s|pct|chars?|lines?)\b)?/gi;

const CANONICAL_OMAGY_SUBROOTS = new Set([
  'state',
  'logs',
  'context',
  'interviews',
  'specs',
  'plans',
  'drafts',
  'ultragoal',
  'goals',
  'evidence',
  'artifacts',
  'config.json',
  'notifications.json',
]);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'ask', 'asks', 'at', 'be', 'before', 'after', 'by', 'can', 'do',
  'does', 'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'let', 'lets',
  'make', 'me', 'my', 'need', 'needs', 'no', 'not', 'of', 'oh', 'agy', 'antigravity', 'on', 'one',
  'only', 'or', 'our', 'out', 'over', 'please', 'run', 'runs', 'running', 'set', 'should', 'so',
  'some', 'supports', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'this', 'through',
  'to', 'up', 'use', 'used', 'user', 'users', 'using', 'via', 'want', 'wants', 'we', 'what', 'when',
  'where', 'which', 'while', 'with', 'without', 'you', 'your', 'flags', 'default', 'mode', 'modes',
]);

const SKILL_QUERY_ALIASES = {
  deslop: ['slop', 'cleanup', 'refactor', 'dead'],
  bloat: ['bloated', 'slop', 'cleanup'],
  messy: ['bloated', 'repetitive', 'cleanup'],
  investigate: ['analyze', 'analysis', 'causing'],
  why: ['analyze', 'causing', 'synthesis'],
  root: ['causing', 'analyze'],
  advisor: ['claude', 'gemini', 'codex', 'opinion'],
  autonomous: ['autopilot', 'delivery', 'hands'],
  endtoend: ['autopilot', 'delivery'],
  stop: ['cancel', 'abort'],
  abort: ['cancel'],
  merge: ['review', 'approve', 'verdict'],
  slack: ['notifications', 'webhook', 'notify'],
  discord: ['notifications', 'webhook', 'notify'],
  telegram: ['notifications', 'webhook', 'notify'],
  ambiguous: ['interview', 'socratic', 'ambiguity'],
  requirements: ['interview', 'ambiguity', 'criteria'],
  landscape: ['multidisciplinary', 'research', 'market'],
  market: ['business', 'research', 'landscape'],
  palette: ['design', 'ui', 'ux', 'frontend'],
  broken: ['doctor', 'diagnose', 'issues', 'hooks'],
  troubleshoot: ['doctor', 'diagnose', 'issues'],
  compact: ['handoff', 'compaction', 'resume', 'session'],
  dashboard: ['hud', 'status', 'board'],
  prototype: ['loft', 'variants', 'throwaway', 'switcher'],
  install: ['setup', 'enable', 'uninstall', 'bootstrap'],
  uninstall: ['setup', 'install'],
  latency: ['performance', 'speed', 'throughput', 'benchmark', 'optimize'],
  slow: ['performance', 'speed', 'latency', 'optimize'],
  memory: ['performance', 'benchmark', 'optimize'],
  lightweight: ['plan', 'scoping'],
  pull: ['pr', 'reversibility', 'paper', 'trail'],
  consensus: ['ralplan', 'architectural', 'critic', 'hyperplan'],
  parallel: ['team', 'workers', 'subagent', 'board'],
  workers: ['team', 'board'],
  goals: ['ultragoal', 'ledger', 'sequential'],
  milestone: ['ultragoal', 'goals', 'ledger'],
  adversarial: ['ultraqa', 'hostile', 'scenario', 'matrix'],
  e2e: ['ultraqa', 'qa', 'scenario'],
  mockup: ['visual', 'ralph', 'pixel', 'reference', 'ui'],
  screenshot: ['visual', 'ralph', 'pixel', 'ui'],
  clone: ['visual', 'ralph', 'url'],
  knowledge: ['wiki', 'omagy', 'markdown', 'notes'],
};

function zeroFloorSummary() {
  return {
    silencedCheckers: 0,
    unfinishedWork: 0,
    emptyCatches: 0,
    protectedBlocksModified: 0,
    testsMadeEasier: 0,
    deletedTests: 0,
    removedAssertions: 0,
    loosenedThresholds: 0,
    rulesRemoved: 0,
    untrackedBlockers: 0,
    total: 0,
  };
}

function canonicalizeLocal(p) {
  const abs = path.resolve(String(p || ''));
  try {
    return fs.realpathSync(abs);
  } catch { /* fail open: path may not exist yet */ }
  return abs;
}

function normalizeThresholdUnit(rawUnit, num) {
  const u = String(rawUnit || '').toLowerCase();
  if (!u) return { unitFamily: 'scalar', scaledNum: num };
  if (u === '%' || u === 'pct') return { unitFamily: 'pct', scaledNum: num };
  if (u === 'b' || u === 'byte' || u === 'bytes') return { unitFamily: 'bytes', scaledNum: num };
  if (u === 'kb') return { unitFamily: 'bytes', scaledNum: num * 1024 };
  if (u === 'mb') return { unitFamily: 'bytes', scaledNum: num * 1048576 };
  if (u === 'gb') return { unitFamily: 'bytes', scaledNum: num * 1073741824 };
  if (u === 'ms') return { unitFamily: 'time', scaledNum: num };
  if (u === 's' || u === 'sec' || u === 'secs') return { unitFamily: 'time', scaledNum: num * 1000 };
  if (u === 'char' || u === 'chars') return { unitFamily: 'chars', scaledNum: num };
  if (u === 'line' || u === 'lines') return { unitFamily: 'lines', scaledNum: num };
  return { unitFamily: u, scaledNum: num };
}

function extractThresholds(line) {
  const out = [];
  THRESHOLD_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = THRESHOLD_TOKEN_RE.exec(line)) !== null) {
    const op = m[1];
    const num = Number(String(m[2]).replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    const unit = String(m[3] || '').toLowerCase();
    const { unitFamily, scaledNum } = normalizeThresholdUnit(unit, num);
    const bound = (op === '<' || op === '<=' || op === '≤') ? 'upper' : 'lower';
    const before = line.slice(0, m.index).toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim();
    const labelTokens = before.split(/\s+/).filter(Boolean);
    const label = labelTokens.slice(-2).join('_');
    out.push({ op, num, scaledNum, unit, unitFamily, bound, label, raw: m[0].trim() });
  }
  return out;
}

function isRuleGovernanceFile(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  return /(?:^|\/)CONSTRAINTS\.md$/i.test(norm) || /(?:^|\/)omagy_wiki\/agreements\.md$/i.test(norm);
}

export function runFloorGuard(cwd = process.cwd(), baseRef = '', options = {}) {
  const summary = zeroFloorSummary();
  const findings = [];
  const repoDir = path.resolve(String(cwd || process.cwd()));
  if (!fs.existsSync(repoDir)) {
    return { ok: false, exitCode: 2, baseSha: '', findings, summary, error: `Directory does not exist: ${repoDir}` };
  }
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
    }).trim();
    if (inside !== 'true') {
      return { ok: false, exitCode: 2, baseSha: '', findings, summary, error: `Not a git worktree: ${repoDir}` };
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: 2,
      baseSha: '',
      findings,
      summary,
      error: `Not a git worktree: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const cleanRef = String(baseRef || '').trim();
  if (cleanRef.startsWith('-')) {
    return { ok: false, exitCode: 2, baseSha: '', findings, summary, error: `Invalid baseRef '${cleanRef}'.` };
  }

  let baseSha = '';
  try {
    if (!cleanRef) {
      baseSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
        cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
      }).trim();
    } else {
      baseSha = execFileSync('git', ['merge-base', cleanRef, 'HEAD'], {
        cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
      }).trim();
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: 2,
      baseSha: '',
      findings,
      summary,
      error: `Unable to resolve git base (${cleanRef || 'HEAD'}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!baseSha) {
    return { ok: false, exitCode: 2, baseSha: '', findings, summary, error: 'Resolved empty git base SHA.' };
  }

  const recordFinding = (category, file, line, message, snippet, fromUntracked = false) => {
    findings.push({
      category,
      file,
      line: Number(line) || 1,
      message,
      snippet: redactSecrets(String(snippet || '').trim()).slice(0, 160),
    });
    if (category === 'silenced-checker') summary.silencedCheckers += 1;
    else if (category === 'unfinished-work') summary.unfinishedWork += 1;
    else if (category === 'empty-catch') summary.emptyCatches += 1;
    else if (category === 'protected-block-modified') summary.protectedBlocksModified += 1;
    else if (category === 'test-made-easier') summary.testsMadeEasier += 1;
    else if (category === 'test-deleted') summary.deletedTests += 1;
    else if (category === 'assertion-removed') summary.removedAssertions += 1;
    else if (category === 'threshold-loosened') summary.loosenedThresholds += 1;
    else if (category === 'rule-removed') summary.rulesRemoved += 1;
    if (fromUntracked) summary.untrackedBlockers += 1;
  };

  let diffText = '';
  try {
    diffText = execFileSync('git', [
      '-c', 'core.quotepath=false',
      'diff', '-M', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3', baseSha, '--',
    ], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    return {
      ok: false,
      exitCode: 2,
      baseSha,
      findings,
      summary,
      error: `git diff failed against ${baseSha}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsedFiles = parseUnifiedDiff(diffText);
  const maxUntracked = Number(options.maxUntrackedFiles ?? UNTRACKED_MAX_FILES);

  for (const entry of parsedFiles) {
    const relFile = entry.newFile || entry.oldFile;
    if (!relFile) continue;

    // 1. Deleted or renamed-out test file check
    if (entry.status === 'deleted' && TEST_FILE_NAME_RE.test(entry.oldFile)) {
      recordFinding('test-deleted', entry.oldFile, 1, `Deleted test file '${entry.oldFile}'.`, entry.oldFile);
    } else if (entry.status === 'renamed' && TEST_FILE_NAME_RE.test(entry.oldFile) && !TEST_FILE_NAME_RE.test(entry.newFile)) {
      recordFinding('test-deleted', entry.oldFile, 1, `Renamed test file '${entry.oldFile}' to non-test path '${entry.newFile}'.`, `${entry.oldFile} -> ${entry.newFile}`);
    }

    // 2. Governance rules & directional thresholds (CONSTRAINTS.md & omagy_wiki/agreements.md)
    if (isRuleGovernanceFile(relFile)) {
      const govDiskPath = path.join(repoDir, relFile);
      const govDiskText = fs.existsSync(govDiskPath) ? fs.readFileSync(govDiskPath, 'utf8') : '';
      if (entry.status === 'deleted') {
        recordFinding('rule-removed', relFile, 1, `Deleted governance file '${relFile}'.`, relFile);
      } else {
        for (const hunk of entry.hunks) {
          const delLines = hunk.lines.filter((l) => l.type === 'del');
          const addLines = hunk.lines.filter((l) => l.type === 'add');

          // Directional & unit-scaled threshold check within hunk
          const delThresholds = delLines.flatMap((l) => extractThresholds(l.content).map((t) => ({ ...t, line: l.oldLine || 1, src: l.content })));
          const addThresholds = addLines.flatMap((l) => extractThresholds(l.content).map((t) => ({ ...t, line: l.newLine || 1, src: l.content, used: false })));

          for (const dt of delThresholds) {
            let match = addThresholds.find((at) => !at.used && at.bound === dt.bound && at.unitFamily === dt.unitFamily && at.label && at.label === dt.label);
            if (!match) {
              match = addThresholds.find((at) => !at.used && at.bound === dt.bound && at.unitFamily === dt.unitFamily && at.unit === dt.unit);
            }
            if (!match) {
              match = addThresholds.find((at) => !at.used && at.bound === dt.bound && at.unitFamily === dt.unitFamily);
            }
            if (match) {
              match.used = true;
              const loosened = dt.bound === 'upper' ? (match.scaledNum > dt.scaledNum) : (match.scaledNum < dt.scaledNum);
              if (loosened) {
                recordFinding('threshold-loosened', relFile, match.line, `Threshold loosened from '${dt.raw}' to '${match.raw}' in '${relFile}'.`, match.src);
              }
            } else if (!govDiskText.includes(dt.raw)) {
              recordFinding('threshold-loosened', relFile, dt.line, `Threshold '${dt.raw}' removed or bound-flipped in '${relFile}'.`, dt.src);
            }
          }

          // Rule bullet removal check
          const delBullets = delLines.filter((l) => /^\s*[-*]\s+\S/.test(l.content));
          const addBullets = addLines.filter((l) => /^\s*[-*]\s+\S/.test(l.content));
          let unmatchedPlainRemoved = 0;
          for (const db of delBullets) {
            const ruleTag = /\[(v\d+)\]/i.exec(db.content);
            if (ruleTag) {
              const tagToken = `[${ruleTag[1]}]`;
              const stillPresent = (govDiskText && govDiskText.toLowerCase().includes(tagToken.toLowerCase()))
                || addBullets.some((ab) => ab.content.toLowerCase().includes(tagToken.toLowerCase()));
              if (!stillPresent) {
                recordFinding('rule-removed', relFile, db.oldLine || 1, `Removed floor agreement ${tagToken} from '${relFile}'.`, db.content);
              }
            } else {
              unmatchedPlainRemoved += 1;
            }
          }
          if (unmatchedPlainRemoved > addBullets.length) {
            const droppedCount = unmatchedPlainRemoved - addBullets.length;
            const sample = delBullets.find((b) => !/\[(v\d+)\]/i.test(b.content)) || delBullets[0];
            for (let k = 0; k < droppedCount; k += 1) {
              recordFinding('rule-removed', relFile, sample?.oldLine || 1, `Removed constraint bullet from '${relFile}'.`, sample?.content || relFile);
            }
          }
        }
      }
    }

    if (entry.status === 'deleted') continue;

    // 3. Net assertion removal in surviving test files
    if (TEST_FILE_NAME_RE.test(relFile)) {
      const delAssertions = [];
      let addAssertionCount = 0;
      for (const hunk of entry.hunks) {
        for (const l of hunk.lines) {
          if (l.type !== 'add' && l.type !== 'del') continue;
          const trimmed = l.content.trim();
          if (!trimmed || /^(?:\/\/|#|\/\*|\*)/.test(trimmed)) continue;
          const clean = stripCodeStrings(l.content);
          if (ASSERTION_LINE_RE.test(clean)) {
            if (l.type === 'del') delAssertions.push(l);
            else addAssertionCount += 1;
          }
        }
      }
      if (delAssertions.length > addAssertionCount) {
        const netDrop = delAssertions.length - addAssertionCount;
        for (let i = 0; i < netDrop; i += 1) {
          const rem = delAssertions[i];
          recordFinding('assertion-removed', relFile, rem.oldLine || 1, `Net assertion count decreased in '${relFile}' (-${netDrop}).`, rem.content);
        }
      }
    }
  }

  // 4. Shared protected-block, code-hunk blocker/suppression/empty-catch, & untracked code scan
  for (const item of scanRepoCodeHygiene(repoDir, parsedFiles, { baseRef: baseSha, maxUntrackedFiles: maxUntracked })) {
    let msg = `${item.fromUntracked ? 'Untracked' : 'Added'} ${item.kind} in '${item.file}'.`;
    if (item.category === 'protected-block-modified') msg = `Modified, renamed, or deleted ${item.blockKind} protected block in '${item.file}'.`;
    else if (item.category === 'silenced-checker') {
      msg = item.fromUntracked ? `Untracked unexempted checker suppression in '${item.file}'.` : `Unexempted checker suppression in '${item.file}' (add '-- <reason>' or 'shortcut:').`;
    } else if (item.category === 'empty-catch') {
      msg = item.fromUntracked ? `Untracked empty catch block in '${item.file}'.` : `Empty or placeholder catch block in '${item.file}' (use '/* fail open: <reason> */' or 'shortcut:').`;
    }
    recordFinding(item.category, item.file, item.line, msg, item.snippet, item.fromUntracked);
  }

  summary.total = findings.length;
  const ok = findings.length === 0;
  return { ok, exitCode: ok ? 0 : 1, baseSha, findings, summary };
}

// ---------- TF-IDF Skill Router & Corpus Evaluator ----------
function stemToken(raw) {
  let w = String(raw || '').toLowerCase();
  if (w.length < 3) return w;
  if (/^(?:notif|notifi)/.test(w)) return 'notify';
  if (/^configur/.test(w)) return 'config';
  if (/^instal/.test(w)) return 'install';
  if (/^optimiz/.test(w)) return 'optim';
  if (/^validat/.test(w)) return 'valid';
  if (/^analys|^analyz/.test(w)) return 'analyz';
  if (/^architec/.test(w)) return 'architect';
  if (/^simplif/.test(w)) return 'simplif';
  if (/^documen/.test(w)) return 'doc';
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) {
    let base = w.slice(0, -3);
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2]) base = base.slice(0, -1);
    return base;
  }
  if (w.length > 6 && (w.endsWith('ations') || w.endsWith('ation'))) return w.replace(/ations?$/, '');
  if (w.length > 6 && (w.endsWith('ments') || w.endsWith('ment'))) return w.replace(/ments?$/, '');
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && !/(?:ses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function tokenizeForSkillEval(text, expandAliases = false) {
  let cleaned = String(text || '').replace(/^\s*\[oh-my-agy\]\s*/i, ' ').toLowerCase();
  if (expandAliases) {
    cleaned = cleaned.replace(/\b(?:without|instead\s+of|rather\s+than)\s+(?:running\s+|a\s+|an\s+|full\s+|heavy\s+)*[a-z0-9-]+(?:\s+[a-z0-9-]+){0,4}/g, ' ');
  }
  const rawParts = cleaned.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const tokens = [];
  for (const part of rawParts) {
    tokens.push(stemToken(part));
    if (expandAliases && Object.prototype.hasOwnProperty.call(SKILL_QUERY_ALIASES, part)) {
      for (const alias of SKILL_QUERY_ALIASES[part]) {
        tokens.push(stemToken(alias));
      }
    }
  }
  return tokens.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function buildNormalizedTfIdf(tokens, idfMap, defaultIdf) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const vec = new Map();
  let normSq = 0;
  for (const [term, count] of tf.entries()) {
    const idf = idfMap.get(term) ?? defaultIdf;
    const weight = (1 + Math.log(count)) * idf;
    vec.set(term, weight);
    normSq += weight * weight;
  }
  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    for (const [term, weight] of vec.entries()) vec.set(term, weight / norm);
  }
  return vec;
}

function cosineMaps(vecA, vecB) {
  if (!vecA.size || !vecB.size) return 0;
  const [small, large] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
  let dot = 0;
  for (const [k, v] of small.entries()) {
    const other = large.get(k);
    if (other !== undefined) dot += v * other;
  }
  return dot;
}

export function evaluateSkillRouting(pluginRoot, options = {}) {
  const minRank1 = Number(options.minRank1 ?? 90);
  const minPositive = Number(options.minPositive ?? 3);
  const minNegative = Number(options.minNegative ?? 2);
  const rootDir = path.resolve(String(pluginRoot || process.cwd()));
  const skillsDir = path.join(rootDir, 'skills');
  const casesPath = options.casesPath
    ? path.resolve(String(options.casesPath))
    : path.join(rootDir, 'hooks', 'skill-eval-cases.json');

  const baseEmpty = {
    ok: false,
    exitCode: 2,
    skillCount: 0,
    totalPositive: 0,
    passedPositive: 0,
    rank1Pct: 0,
    minRank1,
    totalNegative: 0,
    passedNegative: 0,
    negativeSurvivalPct: 0,
    collisionWarnings: [],
    collisionErrors: [],
    schemaErrors: [],
    failures: [],
  };

  if (!fs.existsSync(skillsDir) || !fs.existsSync(casesPath)) {
    return {
      ...baseEmpty,
      schemaErrors: [`Missing skills directory (${skillsDir}) or eval cases (${casesPath}).`],
    };
  }

  let skillDirs = [];
  try {
    skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    return { ...baseEmpty, schemaErrors: [`Unreadable skills directory: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (skillDirs.length === 0) {
    return { ...baseEmpty, schemaErrors: ['Zero skill directories discovered under skills/.'] };
  }

  let casesJson = null;
  try {
    casesJson = JSON.parse(stripUtf8Bom(fs.readFileSync(casesPath, 'utf8')));
  } catch (err) {
    return { ...baseEmpty, schemaErrors: [`Invalid JSON in ${casesPath}: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const discovered = new Map();
  const schemaErrors = [];
  for (const dirName of skillDirs) {
    const skillMdPath = path.join(skillsDir, dirName, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      schemaErrors.push(`Missing SKILL.md for '${dirName}'.`);
      continue;
    }
    const raw = fs.readFileSync(skillMdPath, 'utf8');
    const fmRes = validateFrontmatterYaml(raw, ['name', 'description'], ['name', 'description']);
    const desc = fmRes.fields.description || '';
    const nameTokens = dirName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stemToken);
    const descTokens = tokenizeForSkillEval(desc, false);
    const routeTokens = [...nameTokens, ...nameTokens, ...descTokens];
    discovered.set(dirName, {
      name: dirName,
      description: desc,
      descTokens,
      routeTokens,
    });
  }

  const N = discovered.size;
  if (N === 0) {
    return { ...baseEmpty, schemaErrors };
  }

  if (!casesJson || typeof casesJson !== 'object' || casesJson.version !== 1 || !casesJson.skills || typeof casesJson.skills !== 'object') {
    schemaErrors.push('skill-eval-cases.json must have { "version": 1, "skills": { ... } }.');
  }
  const caseSkills = (casesJson && casesJson.skills && typeof casesJson.skills === 'object') ? casesJson.skills : {};
  for (const sName of discovered.keys()) {
    if (!Object.prototype.hasOwnProperty.call(caseSkills, sName)) {
      schemaErrors.push(`Missing eval cases for skill '${sName}'.`);
    }
  }
  for (const cName of Object.keys(caseSkills)) {
    if (!discovered.has(cName)) {
      schemaErrors.push(`Unknown skill '${cName}' in skill-eval-cases.json.`);
    }
  }

  // Build IDF maps across discovered corpus
  const routeDf = new Map();
  const descDf = new Map();
  for (const info of discovered.values()) {
    for (const t of new Set(info.routeTokens)) routeDf.set(t, (routeDf.get(t) || 0) + 1);
    for (const t of new Set(info.descTokens)) descDf.set(t, (descDf.get(t) || 0) + 1);
  }
  const defaultIdf = Math.log((N + 1) / 1) + 1;
  const routeIdf = new Map();
  for (const [t, df] of routeDf.entries()) routeIdf.set(t, Math.log((N + 1) / (df + 1)) + 1);
  const descIdf = new Map();
  for (const [t, df] of descDf.entries()) descIdf.set(t, Math.log((N + 1) / (df + 1)) + 1);

  for (const info of discovered.values()) {
    info.routeVec = buildNormalizedTfIdf(info.routeTokens, routeIdf, defaultIdf);
    info.descVec = buildNormalizedTfIdf(info.descTokens, descIdf, defaultIdf);
  }

  // Pairwise description cosine collision detector
  const collisionWarnings = [];
  const collisionErrors = [];
  const namesList = [...discovered.keys()];
  for (let i = 0; i < namesList.length; i += 1) {
    for (let j = i + 1; j < namesList.length; j += 1) {
      const a = discovered.get(namesList[i]);
      const b = discovered.get(namesList[j]);
      const cos = Math.round(cosineMaps(a.descVec, b.descVec) * 10000) / 10000;
      if (cos >= 0.75) {
        collisionErrors.push({ pair: [a.name, b.name], cosine: cos });
      } else if (cos >= 0.50) {
        collisionWarnings.push({ pair: [a.name, b.name], cosine: cos });
      }
    }
  }

  const buildQueryVec = (promptText) => buildNormalizedTfIdf(tokenizeForSkillEval(promptText, true), routeIdf, defaultIdf);

  const cheatSigilRe = /(?:^|[\s(])[$/][a-z][a-z0-9-]*/i;
  let totalPositive = 0;
  let passedPositive = 0;
  let totalNegative = 0;
  let passedNegative = 0;
  const failures = [];

  for (const sName of namesList) {
    const entry = caseSkills[sName];
    if (!entry || typeof entry !== 'object') continue;
    const posList = Array.isArray(entry.positive) ? entry.positive : [];
    const negList = Array.isArray(entry.negative) ? entry.negative : [];
    if (posList.length < minPositive) {
      schemaErrors.push(`Skill '${sName}' has ${posList.length} positive prompt(s); expected >= ${minPositive}.`);
    }
    if (negList.length < minNegative) {
      schemaErrors.push(`Skill '${sName}' has ${negList.length} negative prompt(s); expected >= ${minNegative}.`);
    }

    for (const rawPrompt of posList) {
      const prompt = String(rawPrompt || '').trim();
      if (!prompt) {
        schemaErrors.push(`Empty positive prompt in '${sName}'.`);
        continue;
      }
      if (cheatSigilRe.test(prompt)) {
        schemaErrors.push(`Positive prompt in '${sName}' contains forbidden $/ skill prefix: "${prompt}".`);
      }
      totalPositive += 1;
      const qVec = buildQueryVec(prompt);
      let bestSkill = '';
      let bestScore = -1;
      let secondScore = -1;
      let selfScore = 0;
      for (const cand of namesList) {
        const sc = cosineMaps(qVec, discovered.get(cand).routeVec);
        if (cand === sName) selfScore = sc;
        if (sc > bestScore) {
          secondScore = bestScore;
          bestScore = sc;
          bestSkill = cand;
        } else if (sc > secondScore) {
          secondScore = sc;
        }
      }
      if (bestSkill === sName && selfScore > 0 && selfScore > secondScore) {
        passedPositive += 1;
      } else {
        failures.push({ kind: 'positive', skill: sName, prompt, topSkill: bestSkill, topScore: Math.round(bestScore * 10000) / 10000, selfScore: Math.round(selfScore * 10000) / 10000 });
      }
    }

    for (const negItem of negList) {
      if (!negItem || typeof negItem !== 'object') {
        schemaErrors.push(`Negative entry in '${sName}' must be an { prompt, owner } object.`);
        continue;
      }
      const prompt = String(negItem.prompt || '').trim();
      const owner = String(negItem.owner || '').trim();
      if (!prompt || !owner) {
        schemaErrors.push(`Negative entry in '${sName}' requires non-empty prompt and owner.`);
        continue;
      }
      if (owner === sName || !discovered.has(owner)) {
        schemaErrors.push(`Negative entry in '${sName}' has invalid owner '${owner}'.`);
        continue;
      }
      totalNegative += 1;
      const qVec = buildQueryVec(prompt);
      const ownerScore = cosineMaps(qVec, discovered.get(owner).routeVec);
      const selfScore = cosineMaps(qVec, discovered.get(sName).routeVec);
      if (ownerScore > 0 && ownerScore > selfScore) {
        passedNegative += 1;
      } else {
        failures.push({ kind: 'negative', skill: sName, owner, prompt, ownerScore: Math.round(ownerScore * 10000) / 10000, selfScore: Math.round(selfScore * 10000) / 10000 });
      }
    }
  }

  const rank1Pct = totalPositive > 0 ? Math.round((passedPositive / totalPositive) * 1000) / 10 : 0;
  const negativeSurvivalPct = totalNegative > 0 ? Math.round((passedNegative / totalNegative) * 1000) / 10 : 0;
  const ok = schemaErrors.length === 0 && collisionErrors.length === 0 && totalPositive > 0 && rank1Pct >= minRank1 && negativeSurvivalPct === 100;
  return {
    ok, exitCode: ok ? 0 : 1, skillCount: N, totalPositive, passedPositive, rank1Pct, minRank1,
    totalNegative, passedNegative, negativeSurvivalPct, collisionWarnings, collisionErrors, schemaErrors, failures,
  };
}

// ---------- Fail-Closed Scanner Report Validator (quality-gate) ----------
const SEMGREP_BLOCKING = new Set(['ERROR', 'HIGH', 'CRITICAL']);
const SEMGREP_NON_BLOCKING = new Set(['WARNING', 'WARN', 'MEDIUM', 'INFO', 'LOW', 'INVENTORY', 'EXPERIMENT']);
const AXE_BLOCKING = new Set(['serious', 'critical']);
const AXE_NON_BLOCKING = new Set(['minor', 'moderate']);

function isAxePageObject(obj) {
  return Boolean(obj && typeof obj === 'object' && !Array.isArray(obj) && (
    'violations' in obj || 'passes' in obj || 'incomplete' in obj || ('url' in obj && !('results' in obj))
  ));
}

export function evaluateQualityGate(reportPaths = []) {
  const rawList = Array.isArray(reportPaths) ? reportPaths : [reportPaths];
  const paths = rawList.map((p) => String(p || '').trim()).filter(Boolean);
  const blockingFindings = [];
  const invalidReasons = [];
  let reportsChecked = 0;

  if (paths.length === 0) {
    return {
      ok: false,
      exitCode: 2,
      reportsChecked: 0,
      blockingFindings: [],
      invalidReasons: [
        'empty_report_paths: pass one or more semgrep/axe JSON report files (to validate .omagy/config.json workflow gates on a directory, use "quality-gates").',
      ],
    };
  }

  for (const rawPath of paths) {
    const abs = path.resolve(rawPath);
    if (!fs.existsSync(abs)) {
      invalidReasons.push(`missing_report:${rawPath}`);
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch { /* fail open: record unreadable_report */
      invalidReasons.push(`unreadable_report:${rawPath}`);
      continue;
    }
    if (st.isDirectory()) {
      invalidReasons.push(
        `directory_argument:${rawPath} — 'quality-gate' validates semgrep/axe JSON report files; to validate .omagy/config.json workflow gates on a workspace directory, run 'sh ./hooks/run.sh quality-gates ${rawPath}'.`,
      );
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      invalidReasons.push(`invalid_file_type:${rawPath}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(stripUtf8Bom(fs.readFileSync(abs, 'utf8')));
    } catch { /* fail open: record invalid_json */
      invalidReasons.push(`invalid_json:${rawPath}`);
      continue;
    }

    // Semgrep schema detection
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('results' in parsed || 'paths' in parsed)) {
      reportsChecked += 1;
      if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        invalidReasons.push(`scanner_errors:${rawPath} (${parsed.errors.length} error(s))`);
      }
      const scanned = parsed.paths && Array.isArray(parsed.paths.scanned) ? parsed.paths.scanned : [];
      if (scanned.length === 0) {
        invalidReasons.push(`empty_scanned_paths:${rawPath}`);
      }
      if (!Array.isArray(parsed.results)) {
        invalidReasons.push(`malformed_semgrep_results:${rawPath}`);
        continue;
      }
      for (const item of parsed.results) {
        const rawSev = String(item?.extra?.severity ?? item?.severity ?? '').trim().toUpperCase();
        if (!rawSev || (!SEMGREP_BLOCKING.has(rawSev) && !SEMGREP_NON_BLOCKING.has(rawSev))) {
          invalidReasons.push(`unknown_severity:${rawPath}:${rawSev || '<empty>'}`);
          continue;
        }
        if (SEMGREP_BLOCKING.has(rawSev)) {
          blockingFindings.push({
            file: String(item?.path || rawPath),
            tool: 'semgrep',
            severity: rawSev,
            ruleId: String(item?.check_id || 'unknown'),
            message: String(item?.extra?.message || item?.message || ''),
          });
        }
      }
      continue;
    }

    // Axe schema detection (single page object or array of page objects)
    if (Array.isArray(parsed) || isAxePageObject(parsed)) {
      const pages = Array.isArray(parsed) ? parsed : [parsed];
      reportsChecked += 1;
      if (pages.length === 0) {
        invalidReasons.push(`empty_audit:${rawPath} (0 pages)`);
        continue;
      }
      for (const page of pages) {
        if (!isAxePageObject(page)) {
          invalidReasons.push(`malformed_axe_page:${rawPath}`);
          continue;
        }
        const pageUrl = String(page.url ?? '').trim();
        if (!/^https?:\/\/\S+/i.test(pageUrl)) {
          invalidReasons.push(`invalid_page_url:${rawPath}:${pageUrl || '<missing>'}`);
        }
        if (!Array.isArray(page.violations)) {
          invalidReasons.push(`malformed_axe_violations:${rawPath}`);
          continue;
        }
        const passes = Array.isArray(page.passes) ? page.passes : [];
        const incomplete = Array.isArray(page.incomplete) ? page.incomplete : [];
        if (passes.length + page.violations.length + incomplete.length === 0) {
          invalidReasons.push(`empty_audit:${rawPath} (0 audited checks)`);
        }
        for (const v of page.violations) {
          const rawImpact = String(v?.impact ?? '').trim().toLowerCase();
          if (!rawImpact || (!AXE_BLOCKING.has(rawImpact) && !AXE_NON_BLOCKING.has(rawImpact))) {
            invalidReasons.push(`unknown_severity:${rawPath}:${rawImpact || '<empty>'}`);
            continue;
          }
          if (AXE_BLOCKING.has(rawImpact)) {
            blockingFindings.push({
              file: rawPath,
              tool: 'axe',
              severity: rawImpact,
              ruleId: String(v?.id || 'unknown'),
              message: String(v?.help || v?.description || ''),
            });
          }
        }
      }
      continue;
    }

    invalidReasons.push(`unknown_scanner_schema:${rawPath}`);
  }

  let exitCode = 0;
  if (invalidReasons.length > 0) exitCode = 2;
  else if (blockingFindings.length > 0) exitCode = 1;
  return {
    ok: exitCode === 0,
    exitCode,
    reportsChecked,
    blockingFindings,
    invalidReasons,
  };
}

// ---------- Static Validators (Slugger, YAML Hazards, Links, Path Parity, Secret Redaction) ----------
export function githubSlugger(rawHeading, seenCounts = null) {
  const base = String(rawHeading || '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    .replace(/<[!\/a-z][^>]*>/gi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[`*~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
  if (!seenCounts || !(seenCounts instanceof Map)) return base;
  const prev = seenCounts.get(base);
  if (prev === undefined) {
    seenCounts.set(base, 0);
    return base;
  }
  const next = prev + 1;
  seenCounts.set(base, next);
  return `${base}-${next}`;
}

function extractHeadingAnchorSet(markdownRaw) {
  const withoutFm = String(markdownRaw || '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const lines = withoutFm.replace(/\r\n/g, '\n').split('\n');
  const slugs = new Set();
  const seenCounts = new Map();
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (const line of lines) {
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      const marker = fm[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
        continue;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && /^ {0,3}(?:`+|~+)\s*$/.test(line)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        continue;
      }
    }
    if (inFence) continue;
    const hm = /^ {0,3}#{1,6}\s+(.+)$/.exec(line);
    if (hm) {
      const slug = githubSlugger(hm[1], seenCounts);
      if (slug) slugs.add(slug);
    }
  }
  return slugs;
}

export function validateFrontmatterYaml(rawMarkdown, allowedKeys = ['name', 'description'], requiredKeys = []) {
  const raw = String(rawMarkdown || '');
  const errors = [];
  const fields = {};
  if (!/^---\r?\n/.test(raw)) {
    return { ok: false, fields, errors: ['missing_frontmatter'] };
  }
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!fmMatch) {
    return { ok: false, fields, errors: ['unclosed_frontmatter'] };
  }
  const allowedSet = allowedKeys ? new Set(allowedKeys) : null;
  const lines = fmMatch[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNum = i + 2;
    if (line.includes('\t')) {
      errors.push(`tab_indentation:line_${lineNum}`);
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^[ \t]+/.test(line)) {
      errors.push(`unexpected_indentation:line_${lineNum}`);
      continue;
    }
    const km = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(line);
    if (!km) {
      errors.push(`malformed_mapping:line_${lineNum}`);
      continue;
    }
    const key = km[1];
    const rawVal = km[2].trim();
    if (allowedSet && !allowedSet.has(key)) {
      errors.push(`disallowed_key:${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      errors.push(`duplicate_key:${key}`);
    }
    if (!rawVal) {
      fields[key] = '';
      errors.push(`empty_scalar:${key}`);
      continue;
    }
    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      const quote = rawVal[0];
      let closedIdx = -1;
      let unescaped = '';
      for (let ci = 1; ci < rawVal.length; ci += 1) {
        const ch = rawVal[ci];
        if (quote === '"' && ch === '\\') {
          if (ci + 1 >= rawVal.length) break;
          const nxt = rawVal[ci + 1];
          if (nxt === 'n') unescaped += '\n';
          else if (nxt === 't') unescaped += '\t';
          else unescaped += nxt;
          ci += 1;
          continue;
        }
        if (ch === quote) {
          if (quote === "'" && rawVal[ci + 1] === "'") {
            unescaped += "'";
            ci += 1;
            continue;
          }
          closedIdx = ci;
          break;
        }
        unescaped += ch;
      }
      if (closedIdx === -1) {
        errors.push(`unclosed_quote:${key}`);
      } else {
        const trailing = rawVal.slice(closedIdx + 1).trim();
        if (trailing && !trailing.startsWith('#')) {
          errors.push(`trailing_after_quote:${key}`);
        }
        fields[key] = unescaped;
      }
    } else {
      const plain = rawVal.replace(/\s+#.*$/, '').trim();
      if (/^[\[{!&`@%*,|>?]/.test(plain)) {
        errors.push(`reserved_plain_scalar:${key}`);
      }
      if (/:(?:\s|$)/.test(plain)) {
        errors.push(`unquoted_colon_hazard:${key}`);
      }
      fields[key] = plain;
    }
  }

  for (const req of requiredKeys || []) {
    if (!fields[req] || !String(fields[req]).trim()) {
      errors.push(`missing_required_key:${req}`);
    }
  }

  return { ok: errors.length === 0, fields, errors };
}

export function validateReferenceLinks(skillsDir) {
  const baseSkills = canonicalizeLocal(skillsDir);
  const errors = [];
  if (!fs.existsSync(baseSkills)) {
    return { ok: false, errors: [`missing_skills_dir:${baseSkills}`] };
  }
  const anchorCache = new Map();
  const getAnchors = (absFile) => {
    if (!anchorCache.has(absFile)) {
      anchorCache.set(absFile, extractHeadingAnchorSet(fs.readFileSync(absFile, 'utf8')));
    }
    return anchorCache.get(absFile);
  };

  const mdFiles = [];
  const walkSkillFiles = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* fail open: unreadable dir reported via empty check */ return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walkSkillFiles(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) mdFiles.push(full);
    }
  };
  walkSkillFiles(baseSkills);

  for (const sourceFile of mdFiles) {
    const relSource = path.relative(baseSkills, sourceFile).replace(/\\/g, '/');
    const raw = fs.readFileSync(sourceFile, 'utf8');
    const withoutFm = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    transformOutsideCodeSpans(withoutFm, (proseSegment) => {
      const linkRe = /\[[^\]]*\]\(([^)\r\n]+)\)/g;
      let m;
      while ((m = linkRe.exec(proseSegment)) !== null) {
        const rawHref = m[1].trim().replace(/\s+["'][^"']*["']\s*$/, '');
        if (!rawHref) continue;
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawHref)) continue;
        if (/[<>{}*$`]/.test(rawHref)) continue;

        let filePart = '';
        let anchorPart = '';
        if (rawHref.startsWith('#')) {
          filePart = '';
          anchorPart = rawHref.slice(1);
        } else {
          const mdMatch = /^([^#?\s]+\.md)(?:#([^?\s]+))?$/i.exec(rawHref);
          if (!mdMatch) continue;
          filePart = mdMatch[1];
          anchorPart = mdMatch[2] || '';
        }

        const resolvedTarget = filePart
          ? path.resolve(path.dirname(sourceFile), filePart)
          : sourceFile;
        const canonTarget = canonicalizeLocal(resolvedTarget);
        if (canonTarget !== baseSkills && !canonTarget.startsWith(baseSkills + path.sep)) {
          errors.push(`${relSource}:outside-skills-dir=${rawHref}`);
          continue;
        }
        if (!fs.existsSync(canonTarget) || !fs.statSync(canonTarget).isFile()) {
          errors.push(`${relSource}:missing-ref=${rawHref}`);
          continue;
        }
        if (anchorPart) {
          let decodedAnchor = anchorPart;
          try { decodedAnchor = decodeURIComponent(anchorPart); } catch { /* fail open: keep raw anchor on literal percent */ }
          decodedAnchor = decodedAnchor.toLowerCase();
          const anchors = getAnchors(canonTarget);
          if (!anchors.has(decodedAnchor)) {
            errors.push(`${relSource}:missing-anchor=${rawHref} (available: ${[...anchors].slice(0, 8).join(', ')})`);
          }
        }
      }
      return proseSegment;
    });
  }

  return { ok: errors.length === 0, errors };
}

function collectPluginScanFiles(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const out = [];
  const subdirs = ['rules', 'skills', 'agents', 'hooks', 'sidecars'];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* fail open: skip unreadable directory */ return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(?:md|mjs|js|sh|json)$/i.test(e.name)) out.push(full);
    }
  };
  for (const sub of subdirs) walk(path.join(root, sub));
  return out;
}

export function validateArtifactPathParity(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const files = collectPluginScanFiles(root);
  const violations = [];
  const omagyPathRe = /\.omagy\/([^\s`'")\]}>,;]+)/g;

  for (const full of files) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      omagyPathRe.lastIndex = 0;
      let m;
      while ((m = omagyPathRe.exec(line)) !== null) {
        const rawRest = m[1];
        const firstSeg = rawRest.split('/')[0].replace(/[.:;!?]+$/, '');
        if (!firstSeg || firstSeg === '.' || firstSeg === '..') continue;
        if (/[*<>{}$\\]/.test(firstSeg)) continue;
        if (!CANONICAL_OMAGY_SUBROOTS.has(firstSeg)) {
          violations.push({
            file: rel,
            line: i + 1,
            subroot: firstSeg,
            match: m[0],
          });
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function validateStagedDiffRedaction(pluginRoot) {
  const root = path.resolve(String(pluginRoot || process.cwd()));
  const files = collectPluginScanFiles(root);
  const violations = [];
  const unsafeStagedDiffRe = /\bgit\s+diff\s+[^\r\n'"`]*--(?:staged|cached)\b/;
  const safeMetadataFlagRe = /--(?:name-only|name-status|stat|numstat|shortstat|quiet|check)\b/;

  for (const full of files) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (unsafeStagedDiffRe.test(line) && !safeMetadataFlagRe.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function handleColdCliCommand(event, rawArgs = [], defaultRoot = '') {
  let dashC = '';
  const filteredArgs = [];
  let afterDoubleDash = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (afterDoubleDash) {
      filteredArgs.push(a);
      continue;
    }
    if (a === '--') {
      afterDoubleDash = true;
      filteredArgs.push(a);
      continue;
    }
    if (a === '-C' && i + 1 < rawArgs.length) {
      dashC = rawArgs[i + 1];
      i += 1;
      continue;
    }
    filteredArgs.push(a);
  }
  const effectiveDefaultRoot = defaultRoot
    ? path.resolve(defaultRoot)
    : (event === 'skill-eval' ? PLUGIN_ROOT : process.cwd());
  const baseDir = dashC ? path.resolve(dashC) : effectiveDefaultRoot;

  if (event === 'floor-guard') {
    const jsonMode = filteredArgs.includes('--json');
    const pos = filteredArgs.filter((a) => a !== '--json');
    const cwdArg = pos[0] ? path.resolve(baseDir, pos[0]) : baseDir;
    const baseArg = pos[1] || '';
    const res = runFloorGuard(cwdArg, baseArg);
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else if (res.exitCode === 2) {
      process.stdout.write(`FLOOR-GUARD: ERROR (exit 2) — ${res.error || 'Unable to run floor-guard.'}\n`);
    } else {
      const lines = [`FLOOR-GUARD: ${res.ok ? 'PASS' : 'FAIL'} (base=${res.baseSha.slice(0, 7)}, findings=${res.summary.total})`];
      for (const f of res.findings) lines.push(`${f.file}:${f.line} [${f.category}] ${f.message} :: ${f.snippet}`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    return res.exitCode;
  }
  if (event === 'skill-eval') {
    const jsonMode = filteredArgs.includes('--json');
    const argBase = dashC ? path.resolve(dashC) : process.cwd();
    let minRank1 = 90;
    let casesPath = '';
    const pos = [];
    for (let i = 0; i < filteredArgs.length; i += 1) {
      const a = filteredArgs[i];
      if (a === '--json') continue;
      if (a === '--min-rank1' && i + 1 < filteredArgs.length) {
        minRank1 = Number(filteredArgs[i + 1]);
        i += 1;
      } else if (a.startsWith('--min-rank1=')) {
        minRank1 = Number(a.slice('--min-rank1='.length));
      } else if (a === '--cases' && i + 1 < filteredArgs.length) {
        casesPath = path.resolve(argBase, filteredArgs[i + 1]);
        i += 1;
      } else {
        pos.push(a);
      }
    }
    const targetRoot = pos[0] ? path.resolve(argBase, pos[0]) : baseDir;
    const res = evaluateSkillRouting(targetRoot, { minRank1, ...(casesPath ? { casesPath } : {}) });
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      const lines = [
        `SKILL-EVAL: ${res.ok ? 'PASS' : 'FAIL'} (skills=${res.skillCount}, rank1=${res.rank1Pct}% [min ${res.minRank1}%], negSurvival=${res.negativeSurvivalPct}%, collisions=${res.collisionErrors.length})`,
      ];
      for (const se of res.schemaErrors) lines.push(`SCHEMA: ${se}`);
      for (const ce of res.collisionErrors) lines.push(`COLLISION_ERROR: ${ce.pair.join(' <-> ')} (${ce.cosine})`);
      for (const cw of res.collisionWarnings) lines.push(`COLLISION_WARN: ${cw.pair.join(' <-> ')} (${cw.cosine})`);
      for (const fl of res.failures) {
        lines.push(fl.kind === 'positive'
          ? `MISS [positive] ${fl.skill}: "${fl.prompt}" -> top=${fl.topSkill} (${fl.topScore} vs ${fl.selfScore})`
          : `MISS [negative] ${fl.skill} vs owner ${fl.owner}: "${fl.prompt}" (${fl.ownerScore} vs ${fl.selfScore})`);
      }
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    return res.exitCode;
  }
  if (event === 'quality-gate') {
    const jsonMode = filteredArgs.includes('--json');
    const reportPaths = filteredArgs
      .filter((a) => a !== '--json')
      .map((p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p)));
    const res = evaluateQualityGate(reportPaths);
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      let label = 'FAIL';
      if (res.exitCode === 0) label = 'PASS';
      else if (res.exitCode === 2) label = 'INVALID';
      const lines = [`QUALITY-GATE: ${label} (reports=${res.reportsChecked}, blocking=${res.blockingFindings.length}, invalid=${res.invalidReasons.length})`];
      for (const ir of res.invalidReasons) lines.push(`INVALID: ${ir}`);
      for (const bf of res.blockingFindings) lines.push(`BLOCKING [${bf.tool}:${bf.severity}] ${bf.file} (${bf.ruleId}): ${bf.message}`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    return res.exitCode;
  }
  process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 2, event, cwd: baseDir, error: `Cold CLI command '${event}' is not yet implemented.` })}\n`);
  return 2;
}


