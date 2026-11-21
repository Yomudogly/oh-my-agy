// Non-lifecycle CLI dispatcher, skill validator, manifest validator, and skill scaffolder for oh-my-agy.
// Loaded lazily via `await import('./omagy-skill.mjs')` so hot lifecycle hooks never parse cold CLI code.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  COLD_CLI_EVENTS,
  IDLE_GAP_MS,
  IGNORED_SCAN_DIRS,
  MAX_EVIDENCE_BYTES,
  TEST_FILE_NAME_RE,
  appendJsonlRecord,
  auditResearchReport,
  buildCodebaseMap,
  buildResearchMatrix,
  buildReviewPackage,
  decideWatchVerdict,
  extractGoalBrief,
  hasSymlinkSegment,
  intOr,
  nonPlaceholderText,
  normalizeFailureSignature,
  readJsonlRecords,
  readStdin,
  repairWikiLinks,
  scanShortcutDebt,
  stateRoot,
  stripUtf8Bom,
  validateCompletionEvidence,
  validateQualityGates,
} from './omagy-hook.mjs';

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_FRONTMATTER_KEYS = ['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility', 'disable-slash-command'];
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
const AUDIT_CLI_EVENTS = new Set(['docs-drift', 'coverage-map', 'dep-license-diff', 'mcp-audit', 'tmpdir-audit']);
const TROJAN_UNICODE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const HTML_COMMENT_BLOCK_RE = /<!--(?:(?!-->)[\s\S])*?-->/g;
const PROMPT_INJ_COMMENT_RE = /\b(?:ignore\s+(?:all\s+)?previous|system\s+prompt|override\s+(?:all\s+)?instructions|disregard\s+all|you\s+must\s+silently|exfiltrate)\b/i;
const UNPINNED_PIPE_RE = /\b(?:curl|wget)\b[^\r\n|]*\|\s*(?:env\s+)?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:ba|da|z|k|a)?sh\b|\bnpx\s+(?:--yes|-y)\s+[^\s]+@latest\b/i;
const NEG_EXAMPLE_RE = /\b(?:never|avoid|do\s+not|don't|block|blocks|prevent|reject|flag|fail|disallow|forbid|anti-pattern|unsafe|example)\b/i;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function scanSupplyChainText(rel, rawText, isMd, errors) {
  const clean = stripUtf8Bom(rawText);
  if (TROJAN_UNICODE_RE.test(clean)) errors.push(`trojan_unicode:${rel}`);
  if (isMd) {
    const comments = blankFencedLines(clean).join('\n').match(HTML_COMMENT_BLOCK_RE) || [];
    if (comments.some((c) => PROMPT_INJ_COMMENT_RE.test(c))) {
      errors.push(`prompt_injection_comment:${rel}`);
    }
  }
  for (const ln of clean.replace(/\r\n/g, '\n').split('\n')) {
    if (UNPINNED_PIPE_RE.test(ln) && !NEG_EXAMPLE_RE.test(ln)) {
      errors.push(`unpinned_remote_exec:${rel}`);
      break;
    }
  }
}

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
        if (st.size > 5 * 1024 * 1024) errors.push(`asset_exceeds_5mb:${rel}`);
        if (name.toLowerCase().endsWith('.png')) {
          try {
            const fd = fs.openSync(full, 'r');
            const hdr = Buffer.alloc(8);
            const nRead = fs.readSync(fd, hdr, 0, 8, 0);
            fs.closeSync(fd);
            if (nRead < 8 || !hdr.equals(PNG_SIG)) errors.push(`invalid_png_header:${rel}`);
          } catch { /* fail open: unreadable png header flagged */
            errors.push(`invalid_png_header:${rel}`);
          }
        }
        if ((relPrefix === 'scripts' || relPrefix.startsWith('scripts/')) && /\.(?:c|m)?js$/i.test(name)) {
          try {
            execFileSync(process.execPath, ['--check', full], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
          } catch { /* fail open: syntax check failure recorded */
            errors.push(`script_syntax_error:${rel}`);
          }
        }
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
          scanSupplyChainText(rel, rawText, name.toLowerCase().endsWith('.md'), errors);
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
  const existingStat = fs.lstatSync(skillDir, { throwIfNoEntry: false });
  if (existingStat) {
    if (!existingStat.isDirectory() || existingStat.isSymbolicLink()) {
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

const TEAM_TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']);

export function validateTeamTasks(cwd, teamName) {
  const cleanTeam = String(teamName || '').trim();
  if (!cwd || !cleanTeam || /[/\\]|\.\./.test(cleanTeam)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam || '<empty>'}`] };
  }
  const sRoot = stateRoot(path.resolve(cwd));
  const teamDir = path.join(sRoot, '.omagy', 'state', 'team', cleanTeam);
  if (!fs.existsSync(teamDir)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam}/<missing_dir>`] };
  }
  if (hasSymlinkSegment(sRoot, teamDir)) {
    return { ok: false, exitCode: 1, team: cleanTeam, taskCount: 0, errors: [`team_task_read_failed:${cleanTeam}/<symlink_dir>`] };
  }
  const errors = [];
  const checkDirs = [teamDir];
  const subTasksDir = path.join(teamDir, 'tasks');
  try {
    if (fs.existsSync(subTasksDir)) {
      if (fs.lstatSync(subTasksDir).isSymbolicLink()) {
        errors.push(`team_task_read_failed:${cleanTeam}/tasks`);
      } else if (fs.statSync(subTasksDir).isDirectory()) {
        checkDirs.push(subTasksDir);
      }
    }
  } catch { /* fail open: record unreadable tasks dir */
    errors.push(`team_task_read_failed:${cleanTeam}/tasks`);
  }

  let manifestIds = null;
  const manifestTasks = new Map();
  const standaloneTasks = new Map();
  const seenManifestIds = new Set();
  const seenStandaloneIds = new Set();
  const taskFilesSeen = [];

  for (const dir of checkDirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { /* fail open: unreadable team task dir */
      errors.push(`team_task_read_failed:${cleanTeam}/${path.basename(dir)}`);
      continue;
    }
    const isSubDir = dir === subTasksDir;
    for (const name of entries) {
      if (name !== 'tasks.json' && !/^task-.+\.json$/i.test(name)) continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(full); } catch { /* fail open: unreadable task file */
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      if (st.isSymbolicLink() || !st.isFile() || st.size === 0 || st.size > MAX_EVIDENCE_BYTES) {
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(stripUtf8Bom(fs.readFileSync(full, 'utf8'))); } catch { /* fail open: malformed task json */
        errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
        continue;
      }
      if (name === 'tasks.json' && !isSubDir) {
        const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks) ? parsed.tasks : null);
        if (!list) {
          errors.push(`team_task_read_failed:${cleanTeam}/tasks.json`);
          continue;
        }
        manifestIds = new Set();
        for (const item of list) {
          if (!item || typeof item !== 'object' || !nonPlaceholderText(item.id) || typeof item.status !== 'string' || !item.status.trim()) {
            errors.push(`team_task_read_failed:${cleanTeam}/tasks.json`);
            break;
          }
          const id = String(item.id).trim();
          const status = item.status.trim();
          if (seenManifestIds.has(id)) {
            errors.push(`team_task_read_failed:${cleanTeam}/tasks.json:duplicate_task_id:${id}`);
          } else {
            seenManifestIds.add(id);
            manifestIds.add(id);
            if (!TEAM_TASK_STATUSES.has(status)) {
              errors.push(`team_task_read_failed:${cleanTeam}/tasks.json:invalid_status:${id}:${status}`);
            }
            manifestTasks.set(id, item);
          }
        }
      } else if (name !== 'tasks.json') {
        const expectedId = name.replace(/^task-/i, '').replace(/\.json$/i, '');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !nonPlaceholderText(parsed.id) || typeof parsed.status !== 'string' || !parsed.status.trim()) {
          errors.push(`team_task_read_failed:${cleanTeam}/${name}`);
          continue;
        }
        const id = String(parsed.id).trim();
        const status = parsed.status.trim();
        if (id !== expectedId) {
          errors.push(`team_task_read_failed:${cleanTeam}/${name}:task_id_mismatch`);
          continue;
        }
        taskFilesSeen.push({ id, status, parsed, name, isSubDir });
      }
    }
  }

  for (const tf of taskFilesSeen) {
    if (seenStandaloneIds.has(tf.id)) {
      errors.push(`team_task_read_failed:${cleanTeam}/${tf.name}:duplicate_task_id:${tf.id}`);
      continue;
    }
    seenStandaloneIds.add(tf.id);
    if (manifestIds && tf.isSubDir && !manifestIds.has(tf.id)) {
      errors.push(`team_task_read_failed:${cleanTeam}/tasks/${tf.name}:orphan_task_file:${tf.id}`);
      continue;
    }
    if (!TEAM_TASK_STATUSES.has(tf.status)) {
      errors.push(`team_task_read_failed:${cleanTeam}/${tf.name}:invalid_status:${tf.id}:${tf.status}`);
    }
    if (!manifestTasks.has(tf.id)) standaloneTasks.set(tf.id, tf.parsed);
  }

  const allTasks = new Map([...standaloneTasks, ...manifestTasks]);
  const taskCount = allTasks.size;
  const depsOf = (t) => {
    const raw = Array.isArray(t?.depends_on) ? t.depends_on : (Array.isArray(t?.dependsOn) ? t.dependsOn : (Array.isArray(t?.blocked_by) ? t.blocked_by : []));
    return raw.map((d) => String(d || '').trim()).filter(Boolean);
  };
  const validIds = new Set(allTasks.keys());
  for (const [id, task] of allTasks) {
    for (const dep of depsOf(task)) {
      if (!validIds.has(dep)) {
        errors.push(`team_task_read_failed:${cleanTeam}/${id}:missing_dependency:${dep}`);
      }
    }
  }
  const color = new Map();
  const reportedCycles = new Set();
  const visit = (id) => {
    color.set(id, 1);
    const task = allTasks.get(id);
    for (const dep of depsOf(task)) {
      if (!validIds.has(dep)) continue;
      if (dep === id || color.get(dep) === 1) {
        const key = `${id}->${dep}`;
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push(`team_task_read_failed:${cleanTeam}/${id}:dependency_cycle:${dep}`);
        }
      } else if (!color.get(dep)) {
        visit(dep);
      }
    }
    color.set(id, 2);
  };
  for (const id of allTasks.keys()) {
    if (!color.get(id)) visit(id);
  }

  const ok = errors.length === 0 && taskCount > 0;
  if (taskCount === 0 && errors.length === 0) {
    errors.push(`team_task_read_failed:${cleanTeam}/<no_tasks>`);
  }
  return { ok, exitCode: ok ? 0 : 1, team: cleanTeam, taskCount, errors };
}

// ---------- relocated cold junk-test & session-compare helpers ----------
const TEST_JUNK_RULES = [
  {
    rule: 'source-grep',
    message: 'Reads source file inside a test to grep implementation text (class 10 source-grep). Test runtime behavior instead.',
    test: (line) => /\b(?:readFileSync|fs\.readFile|fsPromises\.readFile|os\.ReadFile|ioutil\.ReadFile|std::fs::read_to_string)\s*\(/.test(line),
  },
  {
    rule: 'prose-pin',
    message: 'Pins exact long prose (>80 chars) in an equality assertion (class 5 exact-error-prose). Match error code/type or key phrase.',
    test: (line) => /\b(?:toBe|toEqual|toStrictEqual|assert_eq!|assertEqual)\s*\(\s*["'`][^"'`\n]{80,}["'`]\s*\)/.test(line),
  },
  {
    rule: 'fixed-sleep',
    message: 'Uses arbitrary fixed sleep in test (class 12 fixed-sleep). Await deterministic condition or fake timers.',
    test: (line) => /\b(?:setTimeout\s*\(\s*resolve\s*,\s*\d+|sleep\s*\(\s*\d+|time\.sleep\s*\(\s*\d+|thread::sleep|time\.Sleep)\b/.test(line),
  },
  {
    rule: 'focused',
    message: 'Focused test (.only / #[test_only]) silently skips the rest of the suite.',
    test: (line) => /\b(?:it|test|describe)\.only\s*\(|#\[\s*test_only\s*\]/.test(line),
  },
  {
    rule: 'skipped',
    message: 'Skipped test (.skip / xit / #[ignore] / todo!() / @pytest.mark.skip / t.Skip) left in suite without suppression.',
    test: (line) => /\b(?:(?:it|test|describe)\.skip|xit|xtest|xdescribe)\s*\(|^\s*#\[\s*(?:ignore(?:\s*=\s*["'][^"']*["'])?|cfg_attr\([^]]*\bignore\b[^]]*\))\s*\]|\b(?:todo|unimplemented)!\s*\(|^\s*@pytest\.mark\.skip\b(?!if)|\bt\.(?:Skip|Skipf|SkipNow)\s*\(/.test(line),
  },
  {
    rule: 'self-compare',
    message: 'Tautological self-comparison (expect(x).toBe(x) or assert(x == x)) (class 1 tautology).',
    test: (line) => {
      const m1 = /\bexpect\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\)/.exec(line);
      if (m1 && m1[1] === m1[2]) return true;
      const m2 = /\b(?:assert|assert_eq!)\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:===?|==|,)\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/.exec(line);
      return Boolean(m2 && m2[1] === m2[2]);
    },
  },
  {
    rule: 'lower-bound',
    message: 'Weak lower-bound assertion (>= 0 or >= 1 on length/size/count) instead of exact expected shape.',
    test: (line) => /\bexpect\s*\([^)]*\.(?:length|size|count)\s*\)\s*\.\s*toBeGreaterThanOrEqual\s*\(\s*[01]\s*\)|\b(?:len|count)\s*\([^)]+\)\s*>=\s*0\b/.test(line),
  },
];

export function checkTestJunk(targets = []) {
  const rawList = Array.isArray(targets) ? targets : [targets];
  const files = [];
  const seen = new Set();
  const collect = (p, explicit) => {
    const abs = path.resolve(String(p || ''));
    if (!abs || seen.has(abs)) return;
    let st;
    try { st = fs.lstatSync(abs); } catch { /* fail open: missing target */ return; }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      if (explicit || TEST_FILE_NAME_RE.test(abs)) {
        seen.add(abs);
        files.push(abs);
      }
      return;
    }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { /* fail open: unreadable dir */ return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (e.name.startsWith('.') || IGNORED_SCAN_DIRS.has(e.name)) continue;
        collect(path.join(abs, e.name), false);
      }
    }
  };
  for (const t of rawList) {
    if (t && String(t).trim()) collect(String(t).trim(), true);
  }
  const violations = [];
  for (const file of files) {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { /* fail open: unreadable file */ continue; }
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || /^(?:\/\/|#|\/\*|\*)/.test(trimmed)) continue;
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (/check-test-junk:\s*ignore/i.test(line) || /check-test-junk:\s*ignore/i.test(prevLine)) continue;
      for (const ruleObj of TEST_JUNK_RULES) {
        if (ruleObj.test(line)) {
          violations.push({
            file,
            line: i + 1,
            rule: ruleObj.rule,
            message: ruleObj.message,
            snippet: trimmed.slice(0, 140),
          });
        }
      }
    }
  }
  return {
    ok: violations.length === 0,
    exitCode: violations.length === 0 ? 0 : 1,
    filesScanned: files.length,
    violations,
  };
}

export function summarizeTranscriptMetrics(records) {
  let turnsStarted = 0;
  let turnsCompleted = 0;
  let toolCalls = 0;
  let failedTools = 0;
  let incomplete = 0;
  let compactions = 0;
  const timestamps = [];
  const byTool = {};
  const fileReads = {};
  const toolIdToName = new Map();
  const countedFailedIds = new Set();
  const tokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    total_tokens: 0,
  };
  const posNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const addUsage = (u) => {
    const inp = posNum(u.input_tokens ?? u.inputTokens);
    const out = posNum(u.output_tokens ?? u.outputTokens);
    const cr = posNum(u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? u.cached_input_tokens);
    const cw = posNum(u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? u.cache_write_input_tokens);
    const tot = posNum(u.total_tokens ?? u.totalTokens) || (inp + out + cr + cw);
    tokenUsage.input_tokens += inp;
    tokenUsage.output_tokens += out;
    tokenUsage.cache_read_input_tokens += cr;
    tokenUsage.cache_creation_input_tokens += cw;
    tokenUsage.total_tokens += tot;
  };
  const hasLastUsage = records.some((r) => r && typeof r === 'object' && r.payload?.info?.last_token_usage);
  let lastTotalUsage = null;

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const ts = Date.parse(rec.created_at || rec.at || rec.timestamp || '');
    if (Number.isFinite(ts)) timestamps.push(ts);
    const type = String(rec.type || '').toUpperCase();
    const status = String(rec.status || '').toUpperCase();
    if (type === 'USER_INPUT' || rec.role === 'user') turnsStarted += 1;
    if (type === 'PLANNER_RESPONSE' || rec.role === 'assistant') {
      if (!status || status === 'DONE' || status === 'COMPLETED') turnsCompleted += 1;
    }
    if (type.includes('COMPACT') || (typeof rec.content === 'string' && /(?:^|\s)\/compact\b/i.test(rec.content))) {
      compactions += 1;
    }
    const u = rec.usage || rec.message?.usage || rec.token_usage || rec.payload?.info?.last_token_usage || null;
    if (u && typeof u === 'object') addUsage(u);
    else if (!hasLastUsage && rec.payload?.info?.total_token_usage && typeof rec.payload.info.total_token_usage === 'object') {
      lastTotalUsage = rec.payload.info.total_token_usage;
    }
    if (status === 'ERROR' || status === 'FAILED' || rec.error || rec.is_error === true || rec.isError === true) {
      failedTools += 1;
    } else if (status && status !== 'DONE' && status !== 'COMPLETED') {
      incomplete += 1;
    }
    const recordToolCall = (rawToolName, rawArgs, rawCallId, isFailedCall = false) => {
      toolCalls += 1;
      const cleaned = String(rawToolName || 'unknown').replace(/[^A-Za-z0-9_:-]/g, '');
      const name = cleaned || 'unknown';
      if (!byTool[name]) byTool[name] = { calls: 0, failed: 0 };
      byTool[name].calls += 1;
      const cid = String(rawCallId || '');
      if (cid) toolIdToName.set(cid, name);
      if (isFailedCall) {
        byTool[name].failed += 1;
        failedTools += 1;
        if (cid) countedFailedIds.add(cid);
      }
      if (/^(?:read_file|view_file|read)$/i.test(name)) {
        let argsObj = rawArgs || null;
        if (typeof argsObj === 'string') {
          try { argsObj = JSON.parse(argsObj); } catch { /* fail open: ignore non-JSON tool args */ argsObj = null; }
        }
        const readPath = argsObj && typeof argsObj === 'object'
          ? String(argsObj.Path || argsObj.filePath || argsObj.TargetFile || argsObj.path || '').trim()
          : '';
        if (readPath) {
          fileReads[readPath] = (fileReads[readPath] || 0) + 1;
        }
      }
    };
    const calls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
    for (const tc of calls) {
      if (!tc || typeof tc !== 'object') continue;
      recordToolCall(
        tc.name || tc.toolName || tc.function?.name || 'unknown',
        tc.arguments || tc.args || tc.input || tc.function?.arguments || null,
        tc.id || tc.tool_use_id || tc.call_id || '',
        tc.status === 'ERROR' || Boolean(tc.error) || tc.is_error === true || tc.isError === true,
      );
    }
    const contentBlocks = Array.isArray(rec.message?.content) ? rec.message.content : (Array.isArray(rec.content) ? rec.content : []);
    for (const blk of contentBlocks) {
      if (blk?.type === 'tool_use') {
        recordToolCall(blk.name || 'unknown', blk.input || null, blk.id || '', false);
      }
    }
    const resultItems = [
      ...(Array.isArray(rec.tool_results) ? rec.tool_results : []),
      ...contentBlocks.filter((b) => b && b.type === 'tool_result'),
    ];
    for (const tr of resultItems) {
      if (!tr || typeof tr !== 'object') continue;
      if (!(tr.is_error === true || tr.isError === true || tr.status === 'ERROR' || tr.error)) continue;
      const tid = String(tr.tool_use_id || tr.call_id || tr.id || '');
      if (tid && countedFailedIds.has(tid)) continue;
      if (tid) countedFailedIds.add(tid);
      failedTools += 1;
      const mapped = tid ? toolIdToName.get(tid) : '';
      if (mapped && byTool[mapped]) byTool[mapped].failed += 1;
    }
  }
  if (lastTotalUsage) addUsage(lastTotalUsage);
  const repeatedWork = Object.values(fileReads).filter((c) => c >= 3).length;
  const stumbles = failedTools + incomplete;
  timestamps.sort((a, b) => a - b);
  let rawDurationMs = (records.length === 1 && timestamps.length === 1) ? 0 : null;
  let durationMs = rawDurationMs;
  if (timestamps.length >= 2 && timestamps.at(-1) > timestamps[0]) {
    rawDurationMs = timestamps.at(-1) - timestamps[0];
    let idleMs = 0;
    for (let i = 1; i < timestamps.length; i += 1) {
      if (timestamps[i] - timestamps[i - 1] > IDLE_GAP_MS) idleMs += timestamps[i] - timestamps[i - 1];
    }
    durationMs = Math.max(0, rawDurationMs - idleMs);
  }
  return {
    records: records.length,
    duration_ms: durationMs,
    raw_duration_ms: rawDurationMs,
    turns: turnsStarted,
    turns_started: turnsStarted,
    turns_completed: turnsCompleted,
    tool_calls: toolCalls,
    failed_tools: failedTools,
    incomplete,
    stumbles,
    repeated_work: repeatedWork,
    compactions,
    token_usage: tokenUsage,
    byTool,
  };
}

export function compareSessions(baselinePath, candidatePath, opts = {}) {
  const safeRead = (p) => {
    try {
      const r = readJsonlRecords(String(p || ''));
      return Array.isArray(r) ? r : (Array.isArray(r?.records) ? r.records : []);
    } catch { /* fail open: missing transcript file */
      return [];
    }
  };
  const baseRecs = safeRead(baselinePath);
  const candRecs = safeRead(candidatePath);
  const base = summarizeTranscriptMetrics(baseRecs);
  const cand = summarizeTranscriptMetrics(candRecs);
  const reasons = [];
  let status = 'no_regression';

  if (base.records === 0 || cand.records === 0) {
    status = 'inconclusive';
    reasons.push('missing_transcript_records');
  } else if ((base.tool_calls > 0 && base.duration_ms === null) || (cand.tool_calls > 0 && cand.duration_ms === null)) {
    status = 'inconclusive';
    reasons.push('missing_measured_duration');
  } else {
    if (cand.failed_tools > base.failed_tools) reasons.push('failed_tools_increased');
    if (cand.incomplete > base.incomplete) reasons.push('incomplete_steps_increased');
    if (cand.stumbles > base.stumbles && !reasons.includes('failed_tools_increased') && !reasons.includes('incomplete_steps_increased')) {
      reasons.push('stumbles_increased');
    }
    if (cand.repeated_work > base.repeated_work) reasons.push('repeated_work_increased');
    const maxPct = opts.maxDurationIncreasePct !== undefined ? Number(opts.maxDurationIncreasePct) : 50;
    if (Number.isFinite(maxPct) && base.duration_ms !== null && base.duration_ms > 0 && cand.duration_ms !== null) {
      const pctIncrease = ((cand.duration_ms - base.duration_ms) / base.duration_ms) * 100;
      if (pctIncrease > maxPct) reasons.push('duration_regression');
    }
    if (reasons.length > 0) status = 'regression';
  }

  const allTools = new Set([...Object.keys(base.byTool), ...Object.keys(cand.byTool)]);
  const byTool = {};
  for (const t of [...allTools].sort()) {
    const b = base.byTool[t] || { calls: 0, failed: 0 };
    const c = cand.byTool[t] || { calls: 0, failed: 0 };
    byTool[t] = {
      baseline_calls: b.calls,
      candidate_calls: c.calls,
      delta_calls: c.calls - b.calls,
      baseline_failed: b.failed,
      candidate_failed: c.failed,
      delta_failed: c.failed - b.failed,
    };
  }
  const pickSummary = (m) => ({
    duration_ms: m.duration_ms,
    raw_duration_ms: m.raw_duration_ms,
    turns: m.turns,
    turns_started: m.turns_started,
    turns_completed: m.turns_completed,
    tool_calls: m.tool_calls,
    failed_tools: m.failed_tools,
    incomplete: m.incomplete,
    stumbles: m.stumbles,
    repeated_work: m.repeated_work,
    compactions: m.compactions,
    token_usage: m.token_usage,
  });
  const failOnReg = Boolean(opts.failOnRegression);
  const exitCode = !failOnReg ? 0 : (status === 'regression' ? 2 : (status === 'inconclusive' ? 3 : 0));
  return {
    ok: exitCode === 0,
    exitCode,
    baseline: pickSummary(base),
    candidate: pickSummary(cand),
    deltas: {
      duration_ms: (base.duration_ms !== null && cand.duration_ms !== null) ? (cand.duration_ms - base.duration_ms) : null,
      raw_duration_ms: (base.raw_duration_ms !== null && cand.raw_duration_ms !== null) ? (cand.raw_duration_ms - base.raw_duration_ms) : null,
      turns: cand.turns - base.turns,
      tool_calls: cand.tool_calls - base.tool_calls,
      failed_tools: cand.failed_tools - base.failed_tools,
      incomplete: cand.incomplete - base.incomplete,
      stumbles: cand.stumbles - base.stumbles,
      repeated_work: cand.repeated_work - base.repeated_work,
      compactions: cand.compactions - base.compactions,
      total_tokens: (cand.token_usage?.total_tokens ?? 0) - (base.token_usage?.total_tokens ?? 0),
    },
    byTool,
    assessment: { status, reasons },
  };
}

// ---------- selftest & CLI dispatch ----------
async function selftest() {
  const { runSelftest } = await import('./omagy-selftest.mjs');
  return runSelftest();
}

function hasHelpFlagBeforeDashDash(rawArgs = []) {
  for (const a of rawArgs) {
    if (a === '--') break;
    if (a === '--help' || a === '-h') return true;
  }
  return false;
}

function skillUsageText(event) {
  const usageMap = {
    help: [
      'Usage: sh hooks/run.sh <command> [options]',
      '',
      'Lifecycle events (JSON on stdin):',
      '  session-start | pre-invocation | pre-tool-use | stop | post-tool-use',
      '  user-prompt-submit | subagent-start | subagent-stop | pre-compact | post-compact',
      '',
      'CLI utilities:',
      '  selftest | skill-validate | skill-init | skill-eval | check-test-junk',
      '  validate-team-tasks | verify-evidence | docs-drift | tmpdir-audit | floor-guard',
      '  goal-done | plan-hash | session-compare | session-scan | host-setup | host-validate',
      '',
      'Pass --help or -h to any subcommand for details.',
    ].join('\n'),
    'skill-validate': 'Usage: sh hooks/run.sh skill-validate [target] [--scope project|shared|user|all] [-C <dir>] [--strict] [--json]',
    'skill-init': 'Usage: sh hooks/run.sh skill-init <name> [--scope project|shared|user] [--dir <parent>] [--resources <list>] [--description <text>] [--force] [-C <dir>] [--json]',
    selftest: 'Usage: sh hooks/run.sh selftest (runs offline selftest suite T1..T61)',
    'verify-evidence': 'Usage: sh hooks/run.sh verify-evidence [cwd] <evidenceRelPath> [team] [taskId]',
    'append-jsonl': 'Usage: sh hooks/run.sh append-jsonl <file> [jsonRecord]',
    'read-jsonl': 'Usage: sh hooks/run.sh read-jsonl <file>',
    'quality-gates': 'Usage: sh hooks/run.sh quality-gates [cwd] [stage]',
    'review-package': 'Usage: sh hooks/run.sh review-package [-C <cwd>] [baseRef] [headRef] [outPath]',
    'goal-brief': 'Usage: sh hooks/run.sh goal-brief [-C <cwd>] <sourcePath> [goalId] [outPath]',
    'check-test-junk': 'Usage: sh hooks/run.sh check-test-junk [-C <dir>] [--json] [targets...]',
    'research-matrix': 'Usage: sh hooks/run.sh research-matrix [--json] <topic> [lens] [facets...]',
    'audit-research': 'Usage: sh hooks/run.sh audit-research [--json] <reportPath>',
    'codebase-map': 'Usage: sh hooks/run.sh codebase-map [--json] [root] [budget]',
    'scan-debt': 'Usage: sh hooks/run.sh scan-debt [--json] [root] [marker]',
    'validate-team-tasks': 'Usage: sh hooks/run.sh validate-team-tasks [--json] [cwd] [team]',
    'watch-pr': 'Usage: sh hooks/run.sh watch-pr [--json] <factsJsonOrFile>',
    'failure-sig': 'Usage: sh hooks/run.sh failure-sig [--json] [fileOrText]',
    'session-compare': 'Usage: sh hooks/run.sh session-compare [--json] [--fail-on-regression] [--max-duration-increase <pct>] <baseline> <candidate> [outPath]',
    'wiki-repair': 'Usage: sh hooks/run.sh wiki-repair [--json] [wikiDir] [changesJsonOrFile]',
  };
  return usageMap[event] || usageMap.help;
}

function parseCliArgs(rawArgs = []) {
  let jsonMode = false;
  let helpMode = false;
  let dashC = '';
  let endOfOpts = false;
  const pos = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = rawArgs[i];
    if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
    if (!endOfOpts && (a === '--help' || a === '-h')) helpMode = true;
    else if (!endOfOpts && a === '--json') jsonMode = true;
    else if (!endOfOpts && a === '-C' && i + 1 < rawArgs.length) { dashC = rawArgs[i + 1]; i += 1; }
    else pos.push(a);
  }
  return { jsonMode, helpMode, dashC, pos };
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
  if (event === '--help' || event === '-h' || event === 'help') {
    process.stdout.write(`${skillUsageText('help')}\n`);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'selftest') {
    if (hasHelpFlagBeforeDashDash(rawArgs)) {
      process.stdout.write(`${skillUsageText('selftest')}\n`);
      process.exitCode = 0;
      return 0;
    }
    const r = await selftest();
    process.stdout.write(`${JSON.stringify(r)}\n`);
    const code = r.selftest === 'PASS' ? 0 : 1;
    process.exitCode = code;
    return code;
  }
  if (event === 'skill-validate') {
    let jsonMode = false;
    let strict = false;
    let helpMode = false;
    let dashC = '';
    let scopeArg = '';
    let cliErr = '';
    let endOfOpts = false;
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
      if (!endOfOpts && (a === '--help' || a === '-h')) helpMode = true;
      else if (!endOfOpts && a === '--json') jsonMode = true;
      else if (!endOfOpts && a === '--strict') strict = true;
      else if (!endOfOpts && a === '-C') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:-C'; }
        else { dashC = rawArgs[i + 1]; i += 1; }
      } else if (!endOfOpts && a === '--scope') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:--scope'; }
        else { scopeArg = String(rawArgs[i + 1] || '').trim().toLowerCase(); i += 1; }
      } else if (!endOfOpts && a.startsWith('--scope=')) {
        scopeArg = a.slice(8).trim().toLowerCase();
      } else if (!endOfOpts && a.startsWith('-')) {
        if (!cliErr) cliErr = `unknown_option:${a}`;
      } else {
        pos.push(a);
      }
    }
    if (helpMode) {
      process.stdout.write(`${skillUsageText('skill-validate')}\n`);
      process.exitCode = 0;
      return 0;
    }
    if (!cliErr && pos.length > 1) cliErr = `unexpected_argument:${pos[1]}`;
    if (!cliErr && scopeArg && pos.length > 0) cliErr = 'scope_conflicts_with_positional_target';
    const VALIDATE_SCOPES = new Set(['project', 'shared', 'user', 'all']);
    if (!cliErr && scopeArg && !VALIDATE_SCOPES.has(scopeArg)) cliErr = `invalid_scope:${scopeArg}`;
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { /* fail open: missing path */ return false; } };
    const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { /* fail open: missing path */ return false; } };
    const userSkillsDir = process.env.OMAGY_USER_SKILLS_DIR
      ? path.resolve(process.env.OMAGY_USER_SKILLS_DIR)
      : path.join(os.homedir(), '.gemini', 'config', 'skills');
    const pluginSkills = path.join(baseDir, 'skills');
    const sharedManifest = path.join(baseDir, '.agents', 'skills.json');
    const sharedDir = path.join(baseDir, 'tools', 'agents', 'skills');
    const projectSkills = path.join(baseDir, '.agents', 'skills');
    const selfSkillMd = path.join(baseDir, 'SKILL.md');

    let res;
    if (cliErr) {
      res = { ok: false, exitCode: 2, kind: 'unknown', target: pos[0] || baseDir, skillCount: 0, referenceFiles: [], errors: [cliErr], warnings: [] };
    } else if (scopeArg === 'all') {
      const candidates = [
        ...(isDir(pluginSkills) ? [pluginSkills] : []),
        ...(isDir(projectSkills) ? [projectSkills] : []),
        ...(isFile(sharedManifest) ? [sharedManifest] : (isDir(sharedDir) ? [sharedDir] : [])),
        ...(isDir(userSkillsDir) ? [userSkillsDir] : []),
      ];
      const seenTargets = new Set();
      const uniqueTargets = [];
      for (const c of candidates) {
        const key = safeRealpath(c) || path.resolve(c);
        if (!seenTargets.has(key)) {
          seenTargets.add(key);
          uniqueTargets.push(c);
        }
      }
      if (uniqueTargets.length === 0) {
        res = { ok: false, exitCode: 2, kind: 'scope:all', target: baseDir, targets: [], skillCount: 0, referenceFiles: [], errors: [`no_skills_target_found:${baseDir}`], warnings: [] };
      } else {
        const errors = [];
        const warnings = [];
        const referenceFiles = [];
        let skillCount = 0;
        let worstExit = 0;
        for (const t of uniqueTargets) {
          const r = await validateSkillDirectory(t, { strict, rootDir: baseDir });
          const relT = path.relative(baseDir, t) || t;
          skillCount += Number(r.skillCount ?? r.entriesCount ?? (r.kind === 'skill' ? 1 : 0));
          for (const e of (r.errors || [])) errors.push(`${relT}:${e}`);
          for (const w of (r.warnings || [])) warnings.push(`${relT}:${w}`);
          for (const rf of (r.referenceFiles || [])) referenceFiles.push({ ...rf, scopeTarget: relT });
          if (r.exitCode && r.exitCode > worstExit) worstExit = r.exitCode;
        }
        const ok = errors.length === 0 && worstExit === 0;
        res = { ok, exitCode: ok ? 0 : (worstExit || 1), kind: 'scope:all', target: baseDir, targets: uniqueTargets, skillCount, referenceFiles, errors, warnings };
      }
    } else {
      let targetArg = pos[0] ? (path.isAbsolute(pos[0]) ? pos[0] : path.resolve(baseDir, pos[0])) : '';
      if (!targetArg) {
        if (scopeArg === 'project') targetArg = projectSkills;
        else if (scopeArg === 'shared') targetArg = isFile(sharedManifest) ? sharedManifest : sharedDir;
        else if (scopeArg === 'user') targetArg = userSkillsDir;
        else if (isDir(pluginSkills)) targetArg = pluginSkills;
        else if (isFile(sharedManifest)) targetArg = sharedManifest;
        else if (isDir(projectSkills)) targetArg = projectSkills;
        else if (isFile(selfSkillMd)) targetArg = baseDir;
        else cliErr = `no_skills_target_found:${baseDir}`;
      }
      res = cliErr
        ? { ok: false, exitCode: 2, kind: 'unknown', target: targetArg || baseDir, skillCount: 0, referenceFiles: [], errors: [cliErr], warnings: [] }
        : await validateSkillDirectory(targetArg, { strict, rootDir: baseDir });
    }
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
    let helpMode = false;
    let dashC = '';
    let scope = 'project';
    let dir = '';
    let resources = '';
    let description = '';
    let cliErr = '';
    let endOfOpts = false;
    const pos = [];
    const appendRes = (v) => { resources = resources ? `${resources},${v}` : String(v || ''); };
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
      if (!endOfOpts && (a === '--help' || a === '-h')) helpMode = true;
      else if (!endOfOpts && a === '--json') jsonMode = true;
      else if (!endOfOpts && a === '--force') force = true;
      else if (!endOfOpts && a === '-C') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:-C'; }
        else { dashC = rawArgs[i + 1]; i += 1; }
      } else if (!endOfOpts && a === '--scope') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:--scope'; }
        else { scope = rawArgs[i + 1]; i += 1; }
      } else if (!endOfOpts && a.startsWith('--scope=')) scope = a.slice(8);
      else if (!endOfOpts && a === '--dir') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:--dir'; }
        else { dir = rawArgs[i + 1]; i += 1; }
      } else if (!endOfOpts && a.startsWith('--dir=')) dir = a.slice(6);
      else if (!endOfOpts && a === '--resources') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:--resources'; }
        else { appendRes(rawArgs[i + 1]); i += 1; }
      } else if (!endOfOpts && a.startsWith('--resources=')) appendRes(a.slice(12));
      else if (!endOfOpts && a === '--description') {
        if (i + 1 >= rawArgs.length) { if (!cliErr) cliErr = 'missing_option_value:--description'; }
        else { description = rawArgs[i + 1]; i += 1; }
      } else if (!endOfOpts && a.startsWith('--description=')) description = a.slice(14);
      else if (!endOfOpts && a.startsWith('-')) {
        if (!cliErr) cliErr = `unknown_option:${a}`;
      } else {
        pos.push(a);
      }
    }
    if (helpMode) {
      process.stdout.write(`${skillUsageText('skill-init')}\n`);
      process.exitCode = 0;
      return 0;
    }
    if (!cliErr && pos.length > 1) cliErr = `unexpected_argument:${pos[1]}`;
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const res = cliErr
      ? {
        ok: false,
        exitCode: 2,
        skillName: pos[0] || '',
        scope,
        skillDir: '',
        createdFiles: [],
        manifestUpdated: null,
        validation: null,
        error: cliErr,
      }
      : await initSkillScaffold(pos[0] || '', {
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
    if (hasHelpFlagBeforeDashDash(rawArgs)) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const [cwdArg, relArg, teamArg, taskIdArg] = rawArgs;
    return runThrowingJsonCli(() => validateCompletionEvidence(cwdArg || process.cwd(), relArg, { team: teamArg, taskId: taskIdArg }));
  }
  if (event === 'append-jsonl') {
    if (hasHelpFlagBeforeDashDash(rawArgs)) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const [fileArg, jsonArg] = rawArgs;
    return runThrowingJsonCli(() => appendJsonlRecord(fileArg, jsonArg || readStdin()));
  }
  if (event === 'read-jsonl') {
    if (hasHelpFlagBeforeDashDash(rawArgs)) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    return runThrowingJsonCli(() => readJsonlRecords(rawArgs[0]));
  }
  if (event === 'quality-gates') {
    if (hasHelpFlagBeforeDashDash(rawArgs)) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const res = validateQualityGates(rawArgs[0] || process.cwd(), rawArgs[1] || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : 1;
    process.exitCode = code;
    return code;
  }
  if (event === 'review-package') {
    const { helpMode, dashC, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const res = buildReviewPackage(dashC || pos[0] || process.cwd(), dashC ? pos[0] : pos[1], (dashC ? pos[1] : pos[2]) || 'HEAD', (dashC ? pos[2] : pos[3]) || '');
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : (res.exitCode || 1);
    process.exitCode = code;
    return code;
  }
  if (event === 'goal-brief') {
    const { helpMode, dashC, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const baseDir = dashC ? path.resolve(dashC) : process.cwd();
    const resolveRel = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(baseDir, p)) : '');
    const res = extractGoalBrief(resolveRel(pos[0]), pos[1] || '', resolveRel(pos[2]));
    process.stdout.write(`${JSON.stringify(res)}\n`);
    const code = res.ok ? 0 : (res.exitCode || 1);
    process.exitCode = code;
    return code;
  }
  if (event === 'check-test-junk') {
    const { jsonMode, helpMode, dashC, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const targetRoot = pos[0] ? path.resolve(pos[0]) : process.cwd();
    const budgetArg = pos[1] ? intOr(pos[1], 1800, 100) : intOr(process.env.OMAGY_MAP_CHARS, 1800, 100);
    const mapText = buildCodebaseMap([targetRoot], budgetArg);
    if (jsonMode) process.stdout.write(`${JSON.stringify({ ok: true, root: targetRoot, budget: budgetArg, map: mapText }, null, 2)}\n`);
    else if (mapText) process.stdout.write(`${mapText}\n`);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'scan-debt') {
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const res = validateTeamTasks(pos[0] ? path.resolve(pos[0]) : process.cwd(), pos[1] || '');
    process.stdout.write(`${JSON.stringify(res, null, jsonMode ? 2 : 0)}\n`);
    process.exitCode = res.exitCode;
    return res.exitCode;
  }
  if (event === 'watch-pr') {
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
    const inputArg = pos[0] || '';
    const signature = normalizeFailureSignature((inputArg && fs.existsSync(inputArg)) ? fs.readFileSync(inputArg, 'utf8') : (inputArg || readStdin()));
    process.stdout.write(jsonMode ? `${JSON.stringify({ ok: true, signature }, null, 2)}\n` : `${signature}\n`);
    process.exitCode = 0;
    return 0;
  }
  if (event === 'session-compare') {
    let jsonMode = false;
    let failOnRegression = false;
    let helpMode = false;
    let endOfOpts = false;
    let maxDurationIncreasePct = 50;
    const pos = [];
    for (let i = 0; i < rawArgs.length; i += 1) {
      const a = rawArgs[i];
      if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
      if (!endOfOpts && (a === '--help' || a === '-h')) helpMode = true;
      else if (!endOfOpts && a === '--json') jsonMode = true;
      else if (!endOfOpts && a === '--fail-on-regression') failOnRegression = true;
      else if (!endOfOpts && a === '--max-duration-increase' && i + 1 < rawArgs.length) { maxDurationIncreasePct = Number(rawArgs[i + 1]); i += 1; }
      else pos.push(a);
    }
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
    const { jsonMode, helpMode, pos } = parseCliArgs(rawArgs);
    if (helpMode) { process.stdout.write(`${skillUsageText(event)}\n`); process.exitCode = 0; return 0; }
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
  if (event === 'host-setup' || event === 'host-validate') {
    const { runHostSetupCli } = await import('./omagy-host-setup.mjs');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const code = await runHostSetupCli(event, rawArgs, pluginRoot);
    process.exitCode = code;
    return code;
  }
  if (COLD_CLI_EVENTS.has(event)) {
    const { handleColdCliCommand } = await import('./omagy-cli.mjs');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const defaultRoot = event === 'skill-eval' ? pluginRoot : process.cwd();
    const code = handleColdCliCommand(event, rawArgs, defaultRoot);
    process.exitCode = code;
    return code;
  }
  if (AUDIT_CLI_EVENTS.has(event)) {
    const { runAuditCli } = await import('./omagy-audit.mjs');
    const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const code = await runAuditCli(event, rawArgs, pluginRoot);
    process.exitCode = code;
    return code;
  }
  process.stdout.write(`${JSON.stringify({ ok: false, exitCode: 2, error: `unknown_command:${event}` })}\n`);
  process.exitCode = 2;
  return 2;
}
