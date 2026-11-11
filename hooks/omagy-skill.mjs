// Non-lifecycle CLI dispatcher, skill validator, manifest validator, and skill scaffolder for oh-my-agy.
// Loaded lazily via `await import('./omagy-skill.mjs')` so hot lifecycle hooks never parse cold CLI code.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLD_CLI_EVENTS,
  appendJsonlRecord,
  auditResearchReport,
  buildCodebaseMap,
  buildResearchMatrix,
  buildReviewPackage,
  checkTestJunk,
  compareSessions,
  decideWatchVerdict,
  extractGoalBrief,
  intOr,
  normalizeFailureSignature,
  readJsonlRecords,
  readStdin,
  repairWikiLinks,
  scanShortcutDebt,
  stripUtf8Bom,
  validateCompletionEvidence,
  validateQualityGates,
  validateTeamTasks,
} from './omagy-hook.mjs';

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_FRONTMATTER_KEYS = ['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'];
const REQUIRED_FRONTMATTER_KEYS = ['name', 'description'];
const PERSONAL_HOME_PATH_RE = /(?:^|[^A-Za-z0-9_])\/(?:Users|home)\/[A-Za-z0-9._-]+\//;
const TRIGGER_CUE_RE = /\b(?:use\b.*?\b(?:when|for|on|to)|triggers?\s+on|activate\b)/i;
const HTML_TAG_IN_DESC_RE = /<\/[a-zA-Z]|<![a-zA-Z-]|<\?|<[a-zA-Z][a-zA-Z0-9-]*\s*\/>|<[a-zA-Z][a-zA-Z0-9-]*\s+[^>]*>|<(?:\s*)(?:script|iframe|style|img|svg|div|span|a|p|br|hr|input|button|form|meta|link|table|body|html|head|ul|ol|li|h[1-6]|code|pre|blockquote)\b[^>]*>/i;
const BANNED_CLUTTER_EXACT = new Set([
  'readme.md',
  'changelog.md',
  'installation_guide.md',
  'quick_reference.md',
  'creation-log.md',
  'example.py',
]);
const TEXT_CHECK_EXT_RE = /\.(?:md|mjs|cjs|js|ts|tsx|jsx|py|sh|json|ya?ml|txt|toml)$/i;
const ALLOWED_SCAFFOLD_RESOURCES = new Set(['references', 'scripts', 'assets', 'resources']);
const ALLOWED_SCOPES = new Set(['project', 'shared', 'user']);

function isOsMetaFile(name) {
  return name === '.DS_Store' || name === 'Thumbs.db';
}

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch { /* fail open: return null when target cannot be canonicalized */
    return null;
  }
}

function isInsideDir(candidatePath, baseDir) {
  return candidatePath === baseDir || candidatePath.startsWith(baseDir + path.sep);
}

function blankFencedLines(markdown) {
  const out = [];
  let fenceChar = '';
  let fenceLen = 0;
  for (const line of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      if (!fenceChar) {
        fenceChar = fm[1][0];
        fenceLen = fm[1].length;
        out.push('');
        continue;
      }
      if (fm[1][0] === fenceChar && fm[1].length >= fenceLen && /^ {0,3}(?:`+|~+)\s*$/.test(line)) {
        fenceChar = '';
        fenceLen = 0;
        out.push('');
        continue;
      }
    }
    out.push(fenceChar ? '' : line);
  }
  return out;
}

function stripInlineCodeSpans(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let tickLen = 1;
      while (i + tickLen < line.length && line[i + tickLen] === '`') tickLen += 1;
      const closing = '`'.repeat(tickLen);
      const endIdx = line.indexOf(closing, i + tickLen);
      if (endIdx !== -1) {
        i = endIdx + tickLen;
        continue;
      }
    }
    out += line[i];
    i += 1;
  }
  return out;
}

function extractHeadingSlugs(markdownRaw, githubSlugger) {
  const slugs = new Set();
  const seen = new Map();
  const body = stripUtf8Bom(markdownRaw).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  for (const line of blankFencedLines(body)) {
    const hm = /^ {0,3}#{1,6}\s+(.+)$/.exec(line);
    if (hm) {
      const slug = githubSlugger(hm[1], seen);
      if (slug) slugs.add(slug);
    }
  }
  return slugs;
}

function isBannedClutterName(name) {
  const lower = name.toLowerCase();
  if (BANNED_CLUTTER_EXACT.has(lower)) return true;
  if (/^test-.*\.md$/i.test(name)) return true;
  if (/\.skill$/i.test(name)) return true;
  if (name === '__pycache__' || /\.pyc$/i.test(name)) return true;
  return false;
}

function hasUnresolvedTodoPlaceholder(rawText) {
  const cleaned = String(rawText || '').replace(/`TODO:`/g, '');
  return /\bTODO:/i.test(cleaned);
}

async function validateSingleSkillDir(skillDir, options = {}) {
  const { validateFrontmatterYaml, githubSlugger } = await import('./omagy-cli.mjs');
  const strict = Boolean(options?.strict);
  const errors = [];
  const warnings = [];
  const referenceFiles = [];
  const mdFiles = [];

  const canonicalSkillDir = safeRealpath(skillDir);
  if (!canonicalSkillDir) {
    return {
      ok: false,
      exitCode: 1,
      kind: 'skill',
      target: skillDir,
      byteSize: 0,
      referenceFiles,
      errors: [`dangling_symlink:${skillDir}`],
      warnings,
    };
  }
  const parentDir = path.dirname(skillDir);
  const canonicalParentDir = safeRealpath(parentDir);

  const skillMdPath = path.join(skillDir, 'SKILL.md');
  let skillMdStat = null;
  try {
    skillMdStat = fs.lstatSync(skillMdPath);
  } catch { /* fail open: missing SKILL.md handled as validation error below */
    skillMdStat = null;
  }

  let byteSize = 0;
  if (!skillMdStat) {
    errors.push('missing_skill_md:SKILL.md');
  } else {
    if (skillMdStat.isSymbolicLink()) {
      const realSkillMd = safeRealpath(skillMdPath);
      if (!realSkillMd) errors.push('dangling_symlink:SKILL.md');
      else if (!isInsideDir(realSkillMd, canonicalSkillDir)) errors.push('symlink_escapes_skill_dir:SKILL.md');
    }
    let rawSkillMd = '';
    try {
      rawSkillMd = fs.readFileSync(skillMdPath, 'utf8');
      byteSize = Buffer.byteLength(rawSkillMd, 'utf8');
    } catch { /* fail open: unreadable SKILL.md reported as error */
      errors.push('unreadable_skill_md:SKILL.md');
    }

    if (rawSkillMd) {
      if (rawSkillMd.charCodeAt(0) === 0xFEFF) errors.push('utf8_bom:SKILL.md');
      const lineCount = rawSkillMd.replace(/\r\n/g, '\n').split('\n').length;
      if (byteSize >= 20_000) errors.push(`skill_md_exceeds_ceiling:${byteSize}>=20000`);
      else if (byteSize > 19_000) warnings.push(`skill_md_near_ceiling:${byteSize}>19000`);
      if (lineCount > 500) warnings.push(`skill_md_exceeds_500_lines:${lineCount}>500`);

      const cleanMd = stripUtf8Bom(rawSkillMd);
      const fm = validateFrontmatterYaml(cleanMd, ALLOWED_FRONTMATTER_KEYS, REQUIRED_FRONTMATTER_KEYS);
      if (!fm.ok) {
        for (const err of fm.errors) errors.push(`frontmatter:${err}`);
      }
      const fmName = String(fm.fields?.name || '').trim();
      const fmDesc = String(fm.fields?.description || '').trim();
      const expectedName = path.basename(skillDir);

      if (fmName) {
        if (fmName.length > 64) errors.push(`name_too_long:${fmName.length}>64`);
        if (!SKILL_NAME_RE.test(fmName)) errors.push(`invalid_skill_name:${fmName}`);
        if (fmName !== expectedName) errors.push(`name_dir_mismatch:${fmName}!=${expectedName}`);
      }

      const bodyRaw = cleanMd.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
      if (!bodyRaw.trim()) errors.push('empty_skill_body');
      const bodyLinesNoFence = blankFencedLines(bodyRaw);

      if (fmDesc) {
        if (fmDesc.length < 20) errors.push(`description_too_short:${fmDesc.length}<20`);
        if (fmDesc.length > 1024) errors.push(`description_too_long:${fmDesc.length}>1024`);
        if (fmDesc.includes('->')) errors.push('description_contains_step_arrow:->');
        if (HTML_TAG_IN_DESC_RE.test(fmDesc)) {
          errors.push('description_contains_html_tag');
        } else {
          const strippedPlaceholders = fmDesc.replace(/<[A-Za-z0-9_-]+>/g, '');
          if (/[<>]/.test(strippedPlaceholders)) {
            errors.push('description_unbalanced_angle_brackets');
          }
        }

        const hasTriggerCue = TRIGGER_CUE_RE.test(fmDesc);
        if (fmDesc.length >= 20 && fmDesc.length < 50) {
          warnings.push(`description_under_50_chars:${fmDesc.length}<50`);
        }
        if (!hasTriggerCue) {
          warnings.push('description_missing_trigger_cue');
          if (bodyLinesNoFence.some((ln) => /^ {0,3}##\s+When to (?:Use|Activate)\b/i.test(ln))) {
            warnings.push('trigger_guidance_only_in_body');
          }
        }
      }
    }
  }

  const walkTree = (dirPath, relPrefix) => {
    let names = [];
    try {
      names = fs.readdirSync(dirPath).sort((a, b) => a.localeCompare(b));
    } catch { /* fail open: unreadable directory reported as error */
      errors.push(`unreadable_directory:${relPrefix || '.'}`);
      return;
    }

    for (const name of names) {
      if (isOsMetaFile(name)) continue;
      const full = path.join(dirPath, name);
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      let st;
      try {
        st = fs.lstatSync(full);
      } catch { /* fail open: vanished entry skipped */
        continue;
      }

      if (st.isSymbolicLink()) {
        const realTarget = safeRealpath(full);
        if (!realTarget) {
          errors.push(`dangling_symlink:${rel}`);
          continue;
        }
        if (!isInsideDir(realTarget, canonicalSkillDir)) {
          errors.push(`symlink_escapes_skill_dir:${rel}`);
          continue;
        }
        try {
          st = fs.statSync(full);
        } catch { /* fail open: unreadable symlink target */
          errors.push(`dangling_symlink:${rel}`);
          continue;
        }
      }

      if (isBannedClutterName(name)) {
        errors.push(`banned_clutter:${rel}`);
        continue;
      }

      if (name.startsWith('.')) continue;

      if (st.isDirectory()) {
        let childEntries = [];
        try {
          childEntries = fs.readdirSync(full).filter((n) => !isOsMetaFile(n));
        } catch { /* fail open: unreadable child directory */
          errors.push(`unreadable_directory:${rel}`);
          continue;
        }
        if (childEntries.length === 0) {
          errors.push(`empty_subdirectory:${rel}`);
          continue;
        }
        if (relPrefix === 'references' || relPrefix.startsWith('references/')) {
          errors.push(`nested_references_subdir:${rel}`);
        }
        walkTree(full, rel);
        continue;
      }

      if (st.isFile()) {
        if (name.toLowerCase().endsWith('.md')) mdFiles.push({ full, rel });
        const inReferences = relPrefix === 'references' || relPrefix.startsWith('references/');
        if (inReferences || TEXT_CHECK_EXT_RE.test(name)) {
          let rawText = '';
          try {
            rawText = fs.readFileSync(full, 'utf8');
          } catch { /* fail open: skip unreadable text file after recording error */
            errors.push(`unreadable_file:${rel}`);
            continue;
          }
          if (rel !== 'SKILL.md' && rawText.charCodeAt(0) === 0xFEFF) {
            errors.push(`utf8_bom:${rel}`);
          }
          if (PERSONAL_HOME_PATH_RE.test(rawText)) {
            errors.push(`personal_home_path:${rel}`);
          }
          if (hasUnresolvedTodoPlaceholder(rawText)) {
            errors.push(`unresolved_todo:${rel}`);
          }
          if (inReferences) {
            const refBytes = Buffer.byteLength(rawText, 'utf8');
            const refLines = rawText.replace(/\r\n/g, '\n').split('\n').length;
            referenceFiles.push({ file: rel, bytes: refBytes, lines: refLines });
            if (refBytes >= 40_000) {
              errors.push(`reference_exceeds_ceiling:${rel}:${refBytes}>=40000`);
            }
            if (name.toLowerCase().endsWith('.md') && refLines > 100) {
              const noFence = blankFencedLines(stripUtf8Bom(rawText));
              const h2Count = noFence.filter((ln) => /^ {0,3}##\s+\S/.test(ln)).length;
              if (h2Count < 2) {
                warnings.push(`reference_missing_section_headings:${rel}:h2=${h2Count}<2`);
              }
            }
          }
        }
      }
    }
  };

  walkTree(skillDir, '');

  const anchorCache = new Map();
  const getAnchors = (mdPath) => {
    if (!anchorCache.has(mdPath)) {
      try {
        anchorCache.set(mdPath, extractHeadingSlugs(fs.readFileSync(mdPath, 'utf8'), githubSlugger));
      } catch { /* fail open: empty anchor set on unreadable markdown */
        anchorCache.set(mdPath, new Set());
      }
    }
    return anchorCache.get(mdPath);
  };

  for (const { full: srcFull, rel: relSrc } of mdFiles) {
    let rawMd = '';
    try {
      rawMd = fs.readFileSync(srcFull, 'utf8');
    } catch { /* fail open: unreadable markdown already flagged */
      continue;
    }
    const body = stripUtf8Bom(rawMd).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    for (const rawLine of blankFencedLines(body)) {
      if (!rawLine) continue;
      const scanLine = stripInlineCodeSpans(rawLine);
      const linkRe = /\[[^\]]*\]\(([^)\r\n]+)\)/g;
      let m;
      while ((m = linkRe.exec(scanLine)) !== null) {
        const rawHref = m[1].trim().replace(/\s+["'][^"']*["']\s*$/, '');
        if (!rawHref) continue;
        if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(rawHref)) continue;
        if (/[<>{}*$`]/.test(rawHref)) continue;
        if (rawHref.includes('\\')) {
          errors.push(`${relSrc}:backslash_in_link:${rawHref}`);
          continue;
        }
        if (rawHref.startsWith('/') || /^[A-Za-z]:/.test(rawHref)) {
          errors.push(`${relSrc}:non_relative_link:${rawHref}`);
          continue;
        }

        let filePart = '';
        let anchorPart = '';
        if (rawHref.startsWith('#')) {
          anchorPart = rawHref.slice(1);
        } else {
          const hashIdx = rawHref.indexOf('#');
          const rawPathPart = hashIdx === -1 ? rawHref : rawHref.slice(0, hashIdx);
          anchorPart = hashIdx === -1 ? '' : rawHref.slice(hashIdx + 1);
          filePart = rawPathPart.split('?')[0];
        }

        const resolvedTarget = filePart ? path.resolve(path.dirname(srcFull), filePart) : srcFull;
        const lexInsideSkill = isInsideDir(resolvedTarget, skillDir);

        if (lexInsideSkill) {
          let targetStat = null;
          try {
            targetStat = fs.statSync(resolvedTarget);
          } catch { /* fail open: missing target reported below */
            targetStat = null;
          }
          if (!targetStat || !targetStat.isFile()) {
            errors.push(`${relSrc}:missing_link_target:${rawHref}`);
            continue;
          }
          const realTarget = safeRealpath(resolvedTarget);
          if (!realTarget || !isInsideDir(realTarget, canonicalSkillDir)) {
            errors.push(`${relSrc}:symlink_escapes_skill_dir:${rawHref}`);
            continue;
          }
        } else {
          const insideParent = resolvedTarget.startsWith(parentDir + path.sep);
          const relParts = insideParent ? path.relative(parentDir, resolvedTarget).split(path.sep) : [];
          const siblingName = relParts[0] || '';
          const siblingSkillMd = siblingName ? path.join(parentDir, siblingName, 'SKILL.md') : '';
          let siblingValid = false;
          if (insideParent && relParts.length >= 2 && siblingSkillMd) {
            try {
              siblingValid = fs.statSync(siblingSkillMd).isFile();
            } catch { /* fail open: non-skill sibling rejected */
              siblingValid = false;
            }
          }
          if (!siblingValid) {
            errors.push(`${relSrc}:link_escapes_skill_dir:${rawHref}`);
            continue;
          }
          let targetStat = null;
          try {
            targetStat = fs.statSync(resolvedTarget);
          } catch { /* fail open: missing sibling link target reported below */
            targetStat = null;
          }
          if (!targetStat || !targetStat.isFile()) {
            errors.push(`${relSrc}:missing_link_target:${rawHref}`);
            continue;
          }
          const realTarget = safeRealpath(resolvedTarget);
          if (!realTarget || !canonicalParentDir || !realTarget.startsWith(canonicalParentDir + path.sep)) {
            errors.push(`${relSrc}:symlink_escapes_skill_dir:${rawHref}`);
            continue;
          }
        }

        if (anchorPart && resolvedTarget.toLowerCase().endsWith('.md')) {
          let decodedAnchor = anchorPart;
          try {
            decodedAnchor = decodeURIComponent(anchorPart);
          } catch { /* fail open: keep literal anchor on unescaped percent */ }
          const slugs = getAnchors(resolvedTarget);
          if (!slugs.has(decodedAnchor.toLowerCase())) {
            errors.push(`${relSrc}:missing_anchor:${rawHref}`);
          }
        }
      }
    }
  }

  if (strict && warnings.length > 0) {
    for (const w of warnings) errors.push(`strict:${w}`);
    warnings.length = 0;
  }

  const ok = errors.length === 0;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    kind: 'skill',
    target: skillDir,
    byteSize,
    referenceFiles,
    errors,
    warnings,
  };
}

export async function validateSkillsManifest(manifestPath, options = { strict: false }) {
  const strict = Boolean(options?.strict);
  const rawInput = String(manifestPath || '').trim();
  if (!rawInput) {
    return {
      ok: false,
      exitCode: 2,
      kind: 'manifest',
      target: '',
      entriesCount: 0,
      inheritsCount: 0,
      referenceFiles: [],
      errors: ['missing_manifest_path'],
      warnings: [],
    };
  }
  const target = path.resolve(rawInput);
  let st = null;
  try {
    st = fs.statSync(target);
  } catch { /* fail open: missing manifest returns exitCode 2 */
    st = null;
  }
  if (!st || !st.isFile()) {
    return {
      ok: false,
      exitCode: 2,
      kind: 'manifest',
      target,
      entriesCount: 0,
      inheritsCount: 0,
      referenceFiles: [],
      errors: [`manifest_not_found:${target}`],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  let rawText = '';
  try {
    rawText = fs.readFileSync(target, 'utf8');
  } catch { /* fail open: unreadable manifest */
    return {
      ok: false,
      exitCode: 2,
      kind: 'manifest',
      target,
      entriesCount: 0,
      inheritsCount: 0,
      referenceFiles: [],
      errors: [`unreadable_manifest:${target}`],
      warnings: [],
    };
  }
  if (rawText.charCodeAt(0) === 0xFEFF) errors.push('utf8_bom:skills.json');

  let parsed = null;
  try {
    parsed = JSON.parse(stripUtf8Bom(rawText));
  } catch (err) { /* fail open: report malformed manifest JSON */
    return {
      ok: false,
      exitCode: 1,
      kind: 'manifest',
      target,
      entriesCount: 0,
      inheritsCount: 0,
      referenceFiles: [],
      errors: [`invalid_json:${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      exitCode: 1,
      kind: 'manifest',
      target,
      entriesCount: 0,
      inheritsCount: 0,
      referenceFiles: [],
      errors: ['manifest_must_be_object'],
      warnings: [],
    };
  }

  for (const key of Object.keys(parsed)) {
    if (key !== 'entries' && key !== 'inherits') {
      errors.push(`unknown_top_level_key:${key}`);
    }
  }
  if (parsed.entries !== undefined && !Array.isArray(parsed.entries)) {
    errors.push('entries_must_be_array');
  }
  if (parsed.inherits !== undefined && !Array.isArray(parsed.inherits)) {
    errors.push('inherits_must_be_array');
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const inherits = Array.isArray(parsed.inherits) ? parsed.inherits : [];

  const parentDir = path.dirname(target);
  const wsRoot = options?.rootDir
    ? path.resolve(String(options.rootDir))
    : (path.basename(parentDir) === '.agents' ? path.dirname(parentDir) : parentDir);
  const canonicalWsRoot = safeRealpath(wsRoot) || wsRoot;

  const validateItemList = async (list, listName, checkLocalSkills) => {
    for (let idx = 0; idx < list.length; idx += 1) {
      const item = list[idx];
      const tag = `${listName}[${idx}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`${tag}:must_be_object`);
        continue;
      }
      for (const ik of Object.keys(item)) {
        if (ik !== 'path' && ik !== 'include_only' && ik !== 'exclude') {
          errors.push(`${tag}:unknown_key:${ik}`);
        }
      }
      const rawPath = item.path;
      let validRelPath = false;
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        errors.push(`${tag}:missing_path`);
      } else if (rawPath.includes('\0')) {
        errors.push(`${tag}:null_byte_in_path`);
      } else if (!path.isAbsolute(rawPath)) {
        const segs = rawPath.split(/[\\/]+/);
        if (segs.includes('..')) {
          errors.push(`${tag}:path_traversal:${rawPath}`);
        } else {
          validRelPath = true;
        }
      }

      const includeRegs = [];
      const excludeRegs = [];
      for (const field of ['include_only', 'exclude']) {
        if (item[field] === undefined) continue;
        if (!Array.isArray(item[field])) {
          errors.push(`${tag}:${field}_must_be_array`);
          continue;
        }
        for (const pat of item[field]) {
          if (typeof pat !== 'string' || pat.length === 0) {
            errors.push(`${tag}:${field}_invalid_pattern`);
            continue;
          }
          try {
            const re = new RegExp(pat);
            if (field === 'include_only') includeRegs.push(re);
            else excludeRegs.push(re);
          } catch { /* fail open: collect invalid_regex error */
            errors.push(`invalid_regex:${field}:${pat}`);
          }
        }
      }

      if (checkLocalSkills && validRelPath) {
        const entryDir = path.resolve(wsRoot, rawPath);
        if (!isInsideDir(entryDir, wsRoot)) {
          errors.push(`${tag}:path_escapes_workspace:${rawPath}`);
          continue;
        }
        let entryStat = null;
        try {
          entryStat = fs.lstatSync(entryDir);
        } catch { /* fail open: non-existent declared path allowed when not yet populated */
          entryStat = null;
        }
        if (!entryStat) continue;
        const realEntryDir = safeRealpath(entryDir);
        if (!realEntryDir || !isInsideDir(realEntryDir, canonicalWsRoot)) {
          errors.push(`${tag}:symlink_escapes_workspace:${rawPath}`);
          continue;
        }
        let isDir = entryStat.isDirectory();
        if (entryStat.isSymbolicLink()) {
          try {
            isDir = fs.statSync(entryDir).isDirectory();
          } catch { /* fail open: broken symlink caught above */
            isDir = false;
          }
        }
        if (!isDir) {
          errors.push(`${tag}:entry_not_directory:${rawPath}`);
          continue;
        }

        let subEntries = [];
        try {
          subEntries = fs.readdirSync(entryDir, { withFileTypes: true });
        } catch { /* fail open: unreadable entry directory */
          errors.push(`${tag}:unreadable_entry_directory:${rawPath}`);
          continue;
        }
        for (const sub of subEntries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (isOsMetaFile(sub.name) || sub.name.startsWith('.')) continue;
          if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
          const skillName = sub.name;
          if (includeRegs.length > 0 && !includeRegs.some((r) => r.test(skillName))) continue;
          if (excludeRegs.some((r) => r.test(skillName))) continue;
          const childSkillDir = path.join(entryDir, skillName);
          const childRes = await validateSingleSkillDir(childSkillDir, { strict });
          for (const e of childRes.errors) errors.push(`${rawPath}/${skillName}:${e}`);
          for (const w of childRes.warnings) warnings.push(`${rawPath}/${skillName}:${w}`);
        }
      }
    }
  };

  await validateItemList(entries, 'entries', true);
  await validateItemList(inherits, 'inherits', false);

  if (strict && warnings.length > 0) {
    for (const w of warnings) errors.push(`strict:${w}`);
    warnings.length = 0;
  }

  const ok = errors.length === 0;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    kind: 'manifest',
    target,
    entriesCount: entries.length,
    inheritsCount: inherits.length,
    referenceFiles: [],
    errors,
    warnings,
  };
}

export async function validateSkillDirectory(targetDir, options = { strict: false }) {
  const strict = Boolean(options?.strict);
  const rawInput = String(targetDir || '').trim();
  if (!rawInput) {
    return {
      ok: false,
      exitCode: 2,
      kind: 'skill',
      target: '',
      referenceFiles: [],
      errors: ['missing_target_path'],
      warnings: [],
    };
  }
  const resolved = path.resolve(rawInput);
  let lstat = null;
  try {
    lstat = fs.lstatSync(resolved);
  } catch { /* fail open: target does not exist */
    return {
      ok: false,
      exitCode: 2,
      kind: 'skill',
      target: resolved,
      referenceFiles: [],
      errors: [`target_not_found:${resolved}`],
      warnings: [],
    };
  }

  let stat = lstat;
  if (lstat.isSymbolicLink()) {
    const real = safeRealpath(resolved);
    if (!real) {
      return {
        ok: false,
        exitCode: 1,
        kind: 'skill',
        target: resolved,
        referenceFiles: [],
        errors: [`dangling_symlink:${resolved}`],
        warnings: [],
      };
    }
    try {
      stat = fs.statSync(resolved);
    } catch { /* fail open: broken symlink target */
      return {
        ok: false,
        exitCode: 1,
        kind: 'skill',
        target: resolved,
        referenceFiles: [],
        errors: [`dangling_symlink:${resolved}`],
        warnings: [],
      };
    }
  }

  if (stat.isFile()) {
    if (resolved.toLowerCase().endsWith('.json')) {
      return validateSkillsManifest(resolved, options);
    }
    if (path.basename(resolved) === 'SKILL.md') {
      return validateSingleSkillDir(path.dirname(resolved), options);
    }
    return {
      ok: false,
      exitCode: 2,
      kind: 'skill',
      target: resolved,
      referenceFiles: [],
      errors: [`not_a_skill_directory:${resolved}`],
      warnings: [],
    };
  }

  if (!stat.isDirectory()) {
    return {
      ok: false,
      exitCode: 2,
      kind: 'skill',
      target: resolved,
      referenceFiles: [],
      errors: [`not_a_skill_directory:${resolved}`],
      warnings: [],
    };
  }

  let hasDirectSkillMd = false;
  try {
    fs.lstatSync(path.join(resolved, 'SKILL.md'));
    hasDirectSkillMd = true;
  } catch { /* fail open: directory without SKILL.md treated as collection */
    hasDirectSkillMd = false;
  }

  if (hasDirectSkillMd) {
    return validateSingleSkillDir(resolved, options);
  }

  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch { /* fail open: unreadable collection directory */
    return {
      ok: false,
      exitCode: 2,
      kind: 'collection',
      target: resolved,
      skillCount: 0,
      referenceFiles: [],
      errors: [`unreadable_directory:${resolved}`],
      warnings: [],
    };
  }

  const canonicalCollection = safeRealpath(resolved) || resolved;
  const childDirs = [];
  const errors = [];
  const warnings = [];
  const referenceFiles = [];

  for (const ent of dirEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (isOsMetaFile(ent.name) || ent.name.startsWith('.')) continue;
    const childFull = path.join(resolved, ent.name);
    if (ent.isSymbolicLink()) {
      const realChild = safeRealpath(childFull);
      if (!realChild) {
        errors.push(`${ent.name}:dangling_symlink`);
        continue;
      }
      if (!isInsideDir(realChild, canonicalCollection)) {
        errors.push(`${ent.name}:symlink_escapes_collection`);
        continue;
      }
      try {
        if (fs.statSync(childFull).isDirectory()) childDirs.push(ent.name);
      } catch { /* fail open: broken symlink already checked */ }
      continue;
    }
    if (ent.isDirectory()) childDirs.push(ent.name);
  }

  if (childDirs.length === 0 && errors.length === 0) {
    return validateSingleSkillDir(resolved, options);
  }

  for (const childName of childDirs) {
    const res = await validateSingleSkillDir(path.join(resolved, childName), { strict });
    for (const e of res.errors) errors.push(`${childName}:${e}`);
    for (const w of res.warnings) warnings.push(`${childName}:${w}`);
    for (const rf of res.referenceFiles) {
      referenceFiles.push({ file: `${childName}/${rf.file}`, bytes: rf.bytes, lines: rf.lines });
    }
  }

  if (strict && warnings.length > 0) {
    for (const w of warnings) errors.push(`strict:${w}`);
    warnings.length = 0;
  }

  const ok = errors.length === 0;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    kind: 'collection',
    target: resolved,
    skillCount: childDirs.length,
    referenceFiles,
    errors,
    warnings,
  };
}

function titleCaseFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeYamlDoubleQuoted(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .trim();
}

export async function initSkillScaffold(skillName, options = {}) {
  const name = String(skillName || '').trim();
  const customDir = String(options?.dir || '').trim();
  const rawScope = String(options?.scope || 'project').trim().toLowerCase();
  const effectiveScope = customDir ? 'custom' : rawScope;

  if (!name || name.length > 64 || !SKILL_NAME_RE.test(name)) {
    return {
      ok: false,
      exitCode: 2,
      skillName: name,
      scope: ALLOWED_SCOPES.has(rawScope) ? rawScope : 'project',
      skillDir: '',
      createdFiles: [],
      manifestUpdated: null,
      validation: null,
      error: `invalid_skill_name:${name || '<empty>'}`,
    };
  }

  if (!customDir && !ALLOWED_SCOPES.has(rawScope)) {
    return {
      ok: false,
      exitCode: 2,
      skillName: name,
      scope: 'project',
      skillDir: '',
      createdFiles: [],
      manifestUpdated: null,
      validation: null,
      error: `invalid_scope:${rawScope}`,
    };
  }

  const rawResources = options?.resources;
  const resourceList = Array.isArray(rawResources)
    ? rawResources.flatMap((r) => String(r || '').split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : String(rawResources || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const resourceSet = new Set();
  for (const r of resourceList) {
    if (!ALLOWED_SCAFFOLD_RESOURCES.has(r)) {
      return {
        ok: false,
        exitCode: 2,
        skillName: name,
        scope: effectiveScope,
        skillDir: '',
        createdFiles: [],
        manifestUpdated: null,
        validation: null,
        error: `invalid_resource:${r}`,
      };
    }
    resourceSet.add(r);
  }

  const rootDir = path.resolve(String(options?.rootDir || process.cwd()));
  let skillDir = '';
  if (effectiveScope === 'custom') {
    skillDir = path.join(path.resolve(rootDir, customDir), name);
  } else if (effectiveScope === 'project') {
    skillDir = path.join(rootDir, '.agents', 'skills', name);
  } else if (effectiveScope === 'shared') {
    skillDir = path.join(rootDir, 'tools', 'agents', 'skills', name);
  } else {
    const userRoot = process.env.OMAGY_USER_SKILLS_DIR
      ? path.resolve(process.env.OMAGY_USER_SKILLS_DIR)
      : path.join(os.homedir(), '.gemini', 'config', 'skills');
    skillDir = path.join(userRoot, name);
  }

  const force = Boolean(options?.force);
  if (fs.existsSync(skillDir)) {
    let st = null;
    try {
      st = fs.lstatSync(skillDir);
    } catch { /* fail open: treat unreadable path as conflict */
      st = null;
    }
    if (!st || !st.isDirectory() || st.isSymbolicLink()) {
      return {
        ok: false,
        exitCode: 1,
        skillName: name,
        scope: effectiveScope,
        skillDir,
        createdFiles: [],
        manifestUpdated: null,
        validation: null,
        error: `target_not_directory:${skillDir}`,
      };
    }
    const existingEntries = fs.readdirSync(skillDir).filter((n) => !isOsMetaFile(n));
    if (existingEntries.length > 0 && !force) {
      return {
        ok: false,
        exitCode: 1,
        skillName: name,
        scope: effectiveScope,
        skillDir,
        createdFiles: [],
        manifestUpdated: null,
        validation: null,
        error: `target_not_empty:${skillDir}`,
      };
    }
  }

  const humanTopic = name.replace(/-/g, ' ');
  const title = titleCaseFromSlug(name);
  const customDesc = String(options?.description || '').trim();
  const description = customDesc
    || `Execute repeatable ${humanTopic} workflows with deterministic steps and evidence-backed verification. Use when tasks involve ${humanTopic} operations or require structured validation in this workspace.`;

  const resourceLinks = [];
  if (resourceSet.has('references')) resourceLinks.push('- Detailed rules and edge cases: [guide.md](./references/guide.md)');
  if (resourceSet.has('scripts')) resourceLinks.push('- Deterministic helper script: [run.mjs](./scripts/run.mjs)');

  const skillMdLines = [
    '---',
    `name: ${name}`,
    `description: "${escapeYamlDoubleQuoted(description)}"`,
    '---',
    '',
    `# ${title}`,
    '',
    `Run repeatable ${humanTopic} tasks with explicit inputs, bounded edits, and concrete verification evidence.`,
    '',
    '## Workflow',
    '',
    '1. Inspect the target files, configuration, and existing conventions before making changes.',
    `2. Apply the minimal complete ${humanTopic} procedure within the requested scope.`,
    '3. Run deterministic checks and report command exit codes alongside changed file paths.',
    ...(resourceLinks.length ? ['', '## Bundled Resources', '', ...resourceLinks] : []),
    '',
    '## Verification',
    '',
    '- Confirm every modified artifact passes targeted validation with exit code `0` before reporting completion.',
    '',
  ];

  fs.mkdirSync(skillDir, { recursive: true });
  const createdFiles = [];
  const writeTracked = (relFile, content) => {
    const absFile = path.join(skillDir, relFile);
    fs.mkdirSync(path.dirname(absFile), { recursive: true });
    fs.writeFileSync(absFile, content, 'utf8');
    createdFiles.push(absFile);
  };

  writeTracked('SKILL.md', skillMdLines.join('\n'));

  if (resourceSet.has('references')) {
    const guideLines = [
      `# ${title} Reference Guide`,
      '',
      'Parent skill entrypoint: [SKILL.md](../SKILL.md).',
      '',
      '## Rules and Invariants',
      '',
      `- Keep ${humanTopic} changes scoped to the requested files and existing repository patterns.`,
      '- Record assumptions explicitly when optional inputs are omitted.',
      '',
      '## Edge Cases and Recovery',
      '',
      '- Stop and surface actionable diagnostics whenever a prerequisite check exits non-zero.',
      '',
    ];
    writeTracked(path.join('references', 'guide.md'), guideLines.join('\n'));
  }

  if (resourceSet.has('scripts')) {
    const scriptLines = [
      '#!/usr/bin/env node',
      `// Deterministic helper script for ${name}.`,
      `process.stdout.write(\`\${JSON.stringify({ ok: true, skill: '${name}' })}\\n\`);`,
      '',
    ];
    writeTracked(path.join('scripts', 'run.mjs'), scriptLines.join('\n'));
  }

  if (resourceSet.has('assets')) {
    writeTracked(path.join('assets', '.gitkeep'), '');
  }

  if (resourceSet.has('resources')) {
    writeTracked(path.join('resources', '.gitkeep'), '');
  }

  let manifestUpdated = null;
  if (effectiveScope === 'shared') {
    const manifestPath = path.join(rootDir, '.agents', 'skills.json');
    let manifestObj = { entries: [] };
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(stripUtf8Bom(fs.readFileSync(manifestPath, 'utf8')));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return {
            ok: false,
            exitCode: 1,
            skillName: name,
            scope: effectiveScope,
            skillDir,
            createdFiles,
            manifestUpdated: null,
            validation: null,
            error: `invalid_existing_skills_manifest:${manifestPath}`,
          };
        }
        manifestObj = parsed;
      } catch { /* fail open: refuse to clobber malformed existing skills.json */
        return {
          ok: false,
          exitCode: 1,
          skillName: name,
          scope: effectiveScope,
          skillDir,
          createdFiles,
          manifestUpdated: null,
          validation: null,
          error: `invalid_existing_skills_manifest:${manifestPath}`,
        };
      }
    }
    if (!Array.isArray(manifestObj.entries)) manifestObj.entries = [];
    const normEntry = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const alreadyPresent = manifestObj.entries.some((e) => e && typeof e === 'object' && normEntry(e.path) === 'tools/agents/skills');
    if (!alreadyPresent) {
      manifestObj.entries.push({ path: 'tools/agents/skills' });
    }
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifestObj, null, 2)}\n`, 'utf8');
    manifestUpdated = manifestPath;
  }

  const validation = await validateSkillDirectory(skillDir, { strict: true });
  if (!validation.ok) {
    return {
      ok: false,
      exitCode: validation.exitCode || 1,
      skillName: name,
      scope: effectiveScope,
      skillDir,
      createdFiles,
      manifestUpdated,
      validation,
      error: validation.errors[0] || 'scaffold_validation_failed',
    };
  }

  return {
    ok: true,
    exitCode: 0,
    skillName: name,
    scope: effectiveScope,
    skillDir,
    createdFiles,
    manifestUpdated,
    validation,
  };
}

// ---------- selftest & CLI dispatch ----------
async function selftest() {
  const { runSelftest } = await import('./omagy-selftest.mjs');
  return runSelftest();
}

function parseCliArgs(rawArgs = []) {
  let jsonMode = false;
  let dashC = '';
  const pos = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (a === '--json') jsonMode = true;
    else if (a === '-C' && i + 1 < rawArgs.length) { dashC = rawArgs[i + 1]; i += 1; }
    else pos.push(a);
  }
  return { jsonMode, dashC, pos };
}

function runThrowingJsonCli(fn) {
  try {
    process.stdout.write(`${JSON.stringify(fn())}\n`);
    process.exitCode = 0;
    return 0;
  } catch (err) { /* fail open: emit structured JSON error and exit 1 */
    process.stdout.write(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`);
    process.exitCode = 1;
    return 1;
  }
}

export async function runNonLifecycleCli(event, rawArgs = []) {
  if (event === 'selftest') {
    const r = await selftest();
    process.stdout.write(`${JSON.stringify(r)}\n`);
    const code = r.selftest === 'PASS' ? 0 : 1;
    process.exitCode = code;
    return code;
  }
  if (event === 'skill-validate') {
    let jsonMode = false;
    let strict = false;
    let dashC = '';
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (a === '--json') jsonMode = true;
      else if (a === '--strict') strict = true;
      else if (a === '-C' && i + 1 < rawArgs.length) { dashC = rawArgs[i + 1]; i += 1; }
      else pos.push(a);
    }
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    let targetArg = pos[0] ? (path.isAbsolute(pos[0]) ? pos[0] : path.resolve(baseDir, pos[0])) : '';
    if (!targetArg) {
      const pluginSkills = path.join(baseDir, 'skills');
      const projectSkills = path.join(baseDir, '.agents', 'skills');
      targetArg = fs.existsSync(pluginSkills) ? pluginSkills : (fs.existsSync(projectSkills) ? projectSkills : baseDir);
    }
    const res = await validateSkillDirectory(targetArg, { strict, rootDir: baseDir });
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      const lines = [
        `SKILL-VALIDATE: ${res.ok ? 'PASS' : 'FAIL'} (kind=${res.kind}, target=${res.target}, errors=${res.errors.length}, warnings=${res.warnings.length})`,
        ...res.errors.map((e) => `ERROR: ${e}`),
        ...res.warnings.map((w) => `WARN: ${w}`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'skill-init') {
    let jsonMode = false;
    let force = false;
    let dashC = '';
    let scope = 'project';
    let dir = '';
    let resources = '';
    let description = '';
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (a === '--json') jsonMode = true;
      else if (a === '--force') force = true;
      else if (a === '-C' && i + 1 < rawArgs.length) { dashC = rawArgs[i + 1]; i += 1; }
      else if (a === '--scope' && i + 1 < rawArgs.length) { scope = rawArgs[i + 1]; i += 1; }
      else if (a.startsWith('--scope=')) scope = a.slice(8);
      else if (a === '--dir' && i + 1 < rawArgs.length) { dir = rawArgs[i + 1]; i += 1; }
      else if (a.startsWith('--dir=')) dir = a.slice(6);
      else if (a === '--resources' && i + 1 < rawArgs.length) { resources = rawArgs[i + 1]; i += 1; }
      else if (a.startsWith('--resources=')) resources = a.slice(12);
      else if (a === '--description' && i + 1 < rawArgs.length) { description = rawArgs[i + 1]; i += 1; }
      else if (a.startsWith('--description=')) description = a.slice(14);
      else pos.push(a);
    }
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const res = await initSkillScaffold(pos[0] || '', {
      scope,
      dir,
      rootDir: baseDir,
      resources,
      description,
      force,
    });
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    } else {
      process.stdout.write(
        `SKILL-INIT: ${res.ok ? 'PASS' : 'FAIL'} (skill=${res.skillName || 'n/a'}, scope=${res.scope}, dir=${res.skillDir || 'n/a'}${res.error ? `, error=${res.error}` : ''})\n`,
      );
    }
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'verify-evidence') {
    const [cwdArg, relArg, teamArg, taskIdArg] = rawArgs;
    return runThrowingJsonCli(() => validateCompletionEvidence(cwdArg || process.cwd(), relArg, { team: teamArg, taskId: taskIdArg }));
  }
  if (event === 'append-jsonl') {
    const [fileArg, jsonArg] = rawArgs;
    return runThrowingJsonCli(() => appendJsonlRecord(fileArg, jsonArg || readStdin()));
  }
  if (event === 'read-jsonl') {
    return runThrowingJsonCli(() => readJsonlRecords(rawArgs[0]));
  }
  if (event === 'quality-gates') {
    const res = validateQualityGates(rawArgs[0] || process.cwd(), rawArgs[1] || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : 1;
    process.exitCode = code;
    return code;
  }
  if (event === 'review-package') {
    const { dashC, pos } = parseCliArgs(rawArgs);
    const res = buildReviewPackage(dashC || pos[0] || process.cwd(), dashC ? pos[0] : pos[1], (dashC ? pos[1] : pos[2]) || 'HEAD', (dashC ? pos[2] : pos[3]) || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : (res.exitCode || 1);
    process.exitCode = code;
    return code;
  }
  if (event === 'goal-brief') {
    const { dashC, pos } = parseCliArgs(rawArgs);
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const resolveRel = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(baseDir, p)) : '');
    const res = extractGoalBrief(resolveRel(pos[0]), pos[1] || '', resolveRel(pos[2]));
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : (res.exitCode || 1);
    process.exitCode = code;
    return code;
  }
  if (event === 'check-test-junk') {
    const { jsonMode, dashC, pos } = parseCliArgs(rawArgs);
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const targets = pos.length
      ? pos.map((p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p)))
      : [baseDir];
    const res = checkTestJunk(targets);
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else {
      const lines = [`CHECK-TEST-JUNK: ${res.ok ? 'PASS' : 'FAIL'} (${res.filesScanned} file(s) scanned, ${res.violations.length} violation(s))`];
      for (const v of res.violations) lines.push(`${v.file}:${v.line} [${v.rule}] ${v.message} :: ${v.snippet}`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'research-matrix') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = buildResearchMatrix(pos[0] || '', pos[1] || 'general', pos.slice(2));
    if (!res.ok) {
      process.stdout.write(`${JSON.stringify(res)}\n`);
      const code = res.exitCode || 1;
      process.exitCode = code;
      return code;
    }
    process.stdout.write(jsonMode ? `${JSON.stringify(res, null, 2)}\n` : res.markdown);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'audit-research') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = auditResearchReport(pos[0] || '');
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else {
      const lines = [
        `DEEP RESEARCH AUDIT: ${res.file || pos[0] || ''} (${res.ok ? 'PASS' : 'FAIL'}, composite=${res.compositeScore ?? 'n/a'})`,
        `Claims: [VERIFIED]=${res.claimCounts?.verified ?? 0} [DERIVED]=${res.claimCounts?.derived ?? 0} [ASSUMED]=${res.claimCounts?.assumed ?? 0}`,
        ...(res.errors || []).map((e) => `ERROR: ${e}`),
        ...(res.warnings || []).map((w) => `WARN: ${w}`),
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    const code = res.ok ? 0 : (res.exitCode || 1);
    process.exitCode = code;
    return code;
  }
  if (event === 'codebase-map') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const targetRoot = pos[0] ? path.resolve(pos[0]) : process.cwd();
    const budgetArg = pos[1] ? intOr(pos[1], 1800, 100) : intOr(process.env.OMAGY_MAP_CHARS, 1800, 100);
    const mapText = buildCodebaseMap([targetRoot], budgetArg);
    if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: true, root: targetRoot, budget: budgetArg, map: mapText }, null, 2)}\n`);
    else if (mapText) process.stdout.write(`${mapText}\n`);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'scan-debt') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const targetRoot = pos[0] ? path.resolve(pos[0]) : process.cwd();
    const res = scanShortcutDebt([targetRoot], pos[1] || '');
    if (jsonMode) process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    else if (res.total === 0) process.stdout.write('No shortcut debt. Clean ledger.\n');
    else {
      const lines = res.items.map((it) => `${it.file}:${it.line}, ceiling: ${it.ceiling}. upgrade: ${it.upgrade || '[no-trigger]'}${it.noTrigger ? ' [no-trigger]' : ''}.`);
      lines.push(`${res.total} marker${res.total === 1 ? '' : 's'}, ${res.noTriggerCount} with no trigger.`);
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = 0;
    return 0;
  }
  if (event === 'validate-team-tasks') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const res = validateTeamTasks(pos[0] ? path.resolve(pos[0]) : process.cwd(), pos[1] || '');
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'watch-pr') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const inputArg = pos[0] || '{}';
    let facts = {};
    try {
      facts = JSON.parse(stripUtf8Bom(fs.existsSync(inputArg) ? fs.readFileSync(inputArg, 'utf8') : inputArg));
    } catch { /* fail open: report blocked on malformed watch-pr JSON */
      process.stdout.write(`${JSON.stringify({ verdict: 'blocked', reasons: ['invalid_input_json'] })}\n`);
      process.exitCode = 1;
      return 1;
    }
    const res = decideWatchVerdict(facts);
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    const code = res.verdict === 'blocked' || res.verdict === 'gone' ? 1 : 0;
    process.exitCode = code;
    return code;
  }
  if (event === 'failure-sig') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const inputArg = pos[0] || '';
    const signature = normalizeFailureSignature((inputArg && fs.existsSync(inputArg)) ? fs.readFileSync(inputArg, 'utf8') : (inputArg || readStdin()));
    process.stdout.write(jsonMode ? `${JSON.stringify({ ok: true, signature }, null, 2)}\n` : `${signature}\n`);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'session-compare') {
    const jsonMode = rawArgs.includes('--json');
    const failOnRegression = rawArgs.includes('--fail-on-regression');
    let maxDurationIncreasePct = 50;
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (a === '--json' || a === '--fail-on-regression') continue;
      if (a === '--max-duration-increase' && i + 1 < rawArgs.length) { maxDurationIncreasePct = Number(rawArgs[i + 1]); i += 1; }
      else pos.push(a);
    }
    const res = compareSessions(pos[0] || '', pos[1] || '', { failOnRegression, maxDurationIncreasePct });
    if (pos[2]) {
      const outPath = path.resolve(pos[2]);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(res, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'wiki-repair') {
    const { jsonMode, pos } = parseCliArgs(rawArgs);
    const wikiDirArg = pos[0] ? path.resolve(pos[0]) : path.join(process.cwd(), 'omagy_wiki');
    const changesArg = pos[1] || '{}';
    let changes = {};
    try {
      changes = JSON.parse(stripUtf8Bom(fs.existsSync(changesArg) ? fs.readFileSync(changesArg, 'utf8') : changesArg));
    } catch { /* fail open: reject malformed wiki-repair JSON */
      process.stdout.write(`${JSON.stringify({ ok: false, error: 'Invalid changes JSON' })}\n`);
      process.exitCode = 1;
      return 1;
    }
    const res = repairWikiLinks(wikiDirArg, changes);
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (COLD_CLI_EVENTS.has(event)) {
    const { handleColdCliCommand } = await import('./omagy-cli.mjs');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const defaultRoot = event === 'skill-eval' ? pluginRoot : process.cwd();
    const code = handleColdCliCommand(event, rawArgs, defaultRoot);
    process.exitCode = code;
    return code;
  }
  process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 2, error: `unknown_command:${event}` })}\n`);
  process.exitCode = 2;
  return 2;
}
