// On-demand host bundle emitter & strict validator for Claude Code & OpenAI Codex (zero external deps).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeDesktopHudPort, desktopHudRegistryFile, parseCodexVersion } from './omagy-host.mjs';

const SUPPORTED_HOSTS = new Set(['claude', 'codex']);
const PURE_READ_ROLES = new Set(['researcher', 'vision']);
const WRITE_ROLES = new Set(['executor', 'debugger', 'designer', 'test-engineer', 'devops-engineer', 'doc-steward']);
const ALL_ROLES = [
  'architect', 'code-reviewer', 'critic', 'debugger', 'designer', 'devops-engineer', 'doc-steward',
  'executor', 'explore', 'planner', 'researcher', 'runtime-qa', 'security-reviewer',
  'supply-chain-auditor', 'test-engineer', 'tracer', 'verifier', 'vision',
];
export const EXPLICIT_ONLY_SKILLS = new Set([
  'autopilot', 'ultragoal', 'ultraqa', 'team', 'cancel',
  'performance-goal', 'ai-slop-cleaner', 'loft', 'pr', 'code-review', 'visual-ralph',
  'modernize', 'release',
]);
export const CLAUDE_ROLE_TOOLS = {
  pureRead: {
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Agent'],
  },
  repoRead: {
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    disallowedTools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent'],
  },
  write: {
    tools: ['Read', 'Glob', 'Grep', 'Edit', 'MultiEdit', 'Write', 'Bash'],
    disallowedTools: ['Agent'],
    isolation: 'worktree',
  },
};

const CODEX_AGENTS_START = '<!-- oh-my-agy:codex:start -->';
const CODEX_AGENTS_END = '<!-- oh-my-agy:codex:end -->';
const CODEX_AGENTS_MAX_BYTES = 32_768;

function readJsonStrict(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function shellQuote(arg) {
  return `"${String(arg).replace(/(["\\$`])/g, '\\$1')}"`;
}

function unquoteScalar(raw) {
  const s = String(raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

/** Standalone YAML frontmatter parser for Claude Code SKILL.md and agent *.md validation. */
export function parseClaudeFrontmatterYaml(rawText, options = {}) {
  const errors = [];
  const fields = {};
  const text = String(rawText || '');
  if (text.charCodeAt(0) === 0xFEFF) {
    errors.push('utf8_bom');
    return { ok: false, fields, body: text, errors };
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/.exec(text);
  if (!m) {
    return { ok: false, fields, body: text, errors: ['missing_frontmatter'] };
  }
  const fmLines = m[1].replace(/\r\n/g, '\n').split('\n');
  const body = m[2] || '';
  const disallowedKeys = new Set(options.disallowedKeys || []);
  const arrayKeys = new Set(options.arrayKeys || []);

  for (let i = 0; i < fmLines.length; i += 1) {
    const line = fmLines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) {
      errors.push(`invalid_yaml_line:${i + 1}`);
      continue;
    }
    const key = kv[1];
    const rest = kv[2].trim();
    if (disallowedKeys.has(key)) {
      errors.push(`disallowed_key:${key}`);
      continue;
    }
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) {
        errors.push(`unclosed_flow_array:${key}`);
        continue;
      }
      const inner = rest.slice(1, -1).trim();
      const items = inner ? inner.split(',').map((x) => unquoteScalar(x)).filter(Boolean) : [];
      if (!items.length) errors.push(`empty_array:${key}`);
      fields[key] = items;
      continue;
    }
    if (!rest) {
      const items = [];
      let j = i + 1;
      while (j < fmLines.length && /^\s+-\s+(.+)$/.test(fmLines[j])) {
        const item = unquoteScalar(/^\s+-\s+(.+)$/.exec(fmLines[j])[1]);
        if (item) items.push(item);
        j += 1;
      }
      if (items.length || arrayKeys.has(key)) {
        if (!items.length) errors.push(`empty_array:${key}`);
        fields[key] = items;
        i = j - 1;
        continue;
      }
    }
    fields[key] = unquoteScalar(rest);
  }
  for (const reqKey of options.requiredKeys || []) {
    if (fields[reqKey] === undefined || fields[reqKey] === '') {
      errors.push(`missing_key:${reqKey}`);
    }
  }
  return { ok: errors.length === 0, fields, body, errors };
}

export function detectCodexVersion(env = process.env) {
  const fromEnv = String(env?.OMAGY_CODEX_VERSION || '').trim();
  if (fromEnv && parseCodexVersion(fromEnv)) return fromEnv;
  try {
    const out = execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = /(\d+\.\d+\.\d+)/.exec(String(out || ''));
    if (m) return m[1];
  } catch { /* fail open: codex binary absent or non-responsive during setup */ }
  return '0.167.0';
}

function getRoleTier(roleName) {
  if (PURE_READ_ROLES.has(roleName)) return 'pureRead';
  if (WRITE_ROLES.has(roleName)) return 'write';
  return 'repoRead';
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceBacktickTools(body, mapping) {
  let out = String(body || '');
  for (const [src, dst] of Object.entries(mapping)) {
    const repl = `\`${dst}\``;
    out = out.replace(new RegExp(`\`${escapeRegExp(src)}\``, 'g'), () => repl);
  }
  return out;
}

const HOST_TOOL_MAP = {
  claude: {
    invoke_subagent: 'Agent',
    ask_question: 'AskUserQuestion',
    read_file: 'Read',
    write_file: 'Write',
    write_to_file: 'Write',
    edit_file: 'Edit',
    run_command: 'Bash',
    search_web: 'WebSearch',
  },
  codex: {
    invoke_subagent: 'spawn_agent',
    ask_question: 'request_user_input',
    edit_file: 'apply_patch',
    run_command: 'exec_command',
  },
};

const HOST_PROSE_LEAK_RE = /\bantigravity\b|sidecar:\/\/|customization:\/\/|\bmanage_task\b/i;

function buildHostHudSection(host, bundleDir = '', { platform = process.platform } = {}) {
  const isWin = platform === 'win32';
  const hudCmd = isWin
    ? `node "${bundleDir ? path.win32.join(bundleDir, 'sidecars', 'hud', 'main.mjs') : 'sidecars\\hud\\main.mjs'}" desktop-ensure --host ${host} --workspace "."`
    : `sh ${shellQuote(bundleDir ? path.join(bundleDir, 'sidecars', 'hud', 'run.sh') : 'sidecars/hud/run.sh')} desktop-ensure --host ${host} --workspace "$PWD"`;
  if (host === 'claude') {
    return [
      '## Live Desktop HUD (Claude Desktop)',
      '',
      'In **Claude Desktop**, the HUD workbench runs locally via `.claude/launch.json` (`oh-my-agy-hud`) or loopback HTTP/SSE (`http://127.0.0.1:<port>/`), started on Desktop `SessionStart` or via `desktop-ensure` (omitted on CLI, IDE extensions, and CI).',
      '',
      'To get the live clickable HUD link during `/hud` or workflow reports:',
      '1. Check if the current context already includes `[oh-my-agy] Desktop HUD Preview running/ready at http://127.0.0.1:<port>/` (or Preview `oh-my-agy-hud`).',
      '2. Otherwise run:',
      '   ```sh',
      `   ${hudCmd}`,
      '   ```',
      '3. When `desktop-ensure` prints JSON with `"ok": true` and `"url": "http://127.0.0.1:<port>/"`, include `[oh-my-agy HUD](<url>)` in your response.',
      '',
    ].join('\n');
  }
  return [
    '## Live Desktop HUD (Codex Desktop)',
    '',
    'In **Codex Desktop**, the HUD workbench runs as a loopback HTTP/SSE server (`http://127.0.0.1:<port>/`), auto-started on Desktop `SessionStart` or via `desktop-ensure` (omitted on CLI, IDE extensions, and CI).',
    '',
    'To get the live clickable HUD link during `/hud` or workflow reports:',
    '1. Check if the current context already includes `[oh-my-agy] Desktop HUD Preview running/ready at http://127.0.0.1:<port>/`.',
    '2. Otherwise run:',
    '   ```sh',
    `   ${hudCmd}`,
    '   ```',
    '3. When `desktop-ensure` prints JSON with `"ok": true` and `"url": "http://127.0.0.1:<port>/"`, end your `/hud` response with `[oh-my-agy HUD](<url>)`.',
    '',
  ].join('\n');
}

function adaptHostProse(rawText, host, bundleDir = '') {
  const shortHost = host === 'claude' ? 'Claude Code' : 'Codex';
  const fullHost = host === 'claude' ? 'Claude Code' : 'OpenAI Codex';
  const hudLinkText = host === 'claude'
    ? '- **Desktop HUD Workbench**: In Claude Desktop, the oh-my-agy HUD runs via `.claude/launch.json` or loopback `http://127.0.0.1:<port>/` started on Desktop `SessionStart` or via `$hud` (`desktop-ensure`). Link only real loopback URLs reported by the HUD helper.'
    : '- **Desktop HUD Workbench**: In Codex Desktop, the oh-my-agy HUD runs as a loopback server (`http://127.0.0.1:<port>/`) started on Desktop `SessionStart` or via `$hud` (`desktop-ensure`). Link only real loopback URLs reported by the HUD helper.';
  const dispatchRepl = host === 'claude'
    ? 'POST /api/dispatch` (`clipboard-handoff` / `claude -p`)'
    : 'POST /api/dispatch` (`app-server` / `codex exec` / `clipboard-handoff`)';
  let out = replaceBacktickTools(rawText, HOST_TOOL_MAP[host] || {});
  out = out
    .replace(/<antigravity_runtime>/g, () => `<${host}_runtime>`)
    .replace(/<\/antigravity_runtime>/g, () => `</${host}_runtime>`)
    .replace(/,\s*manage_task\b/g, () => '')
    .replace(
      /- \*\*Antigravity tool disambiguation \(`manage_task` vs task checklists\)\*\*:[^\n]*/g,
      () => '- **Task checklists vs shell processes**: Background shell tasks are separate from durable workflow state. Track checklists and multi-goal plans using `.omagy/ultragoal/goals.json` (never invent ad-hoc state files).',
    )
    .replace(
      /- \*\*UI Plugin Navigation \(`sidecar:\/\/` & `customization:\/\/`\)\*\*:[^\n]*/g,
      () => hudLinkText,
    )
    .replace(
      /\s*\(and optionally copy to the conversation artifact directory[\s\S]*?`generative_ui`\s*skill\)/g,
      () => ' (keeping local assets self-contained in the workspace HTML)',
    )
    .replace(/POST \/api\/dispatch` via Antigravity's native `agentapi` CLI/g, () => dispatchRepl)
    .replace(/- `manage_subagents list` and `manage_task list`: live subagents and background tasks/g, () => '- Active subagent threads and background shell processes (when running)')
    .replace(/`manage_task list`[^`\n]*`kill`/g, () => 'list and stop background processes')
    .replace(/`manage_task kill`/g, () => 'terminate hung background processes')
    .replace(/\bmanage_task kill\b/g, () => 'terminate hung processes')
    .replace(/\bmanage_task\b/g, () => 'background process control')
    .replace(/use Antigravity's `generate_image` tool/g, () => 'use available image generation tooling (if present)')
    .replace(/Codex's hidden goal tools do not exist in Antigravity\./g, () => 'Hidden built-in goal tools are superseded here by repo-native artifacts.')
    .replace(/surface `\[oh-my-agy HUD\]\(sidecar:\/\/oh-my-agy\/hud\/?\)`/g, () => 'surface the Desktop HUD URL (run `$hud`)')
    .replace(/\[oh-my-agy HUD\]\(sidecar:\/\/oh-my-agy\/hud\/?\)/g, () => 'Desktop HUD (run `$hud` for live URL)')
    .replace(/`?sidecar:\/\/oh-my-agy\/hud\/?`?/gi, () => '`http://127.0.0.1:<port>/`')
    .replace(/sidecar:\/\/[^\s`)"']*/gi, () => 'http://127.0.0.1:<port>/')
    .replace(/`?\[oh-my-agy\]\(customization:\/\/oh-my-agy\)`?/gi, () => `${shortHost} plugin settings`)
    .replace(/customization:\/\/[^\s`)"']*/gi, () => 'plugin settings')
    .replace(/\bin the Auxiliary Pane\b/g, () => 'in the Desktop HUD')
    .replace(/\bAuxiliary Pane\b/g, () => 'Desktop HUD')
    .replace(/\bAux Pane\b/g, () => 'Desktop HUD')
    .replace(/\bfor Antigravity\./g, () => `for ${fullHost}.`)
    .replace(/\bAntigravity's\b/g, () => `${shortHost}'s`)
    .replace(/\bAntigravity\b/gi, () => shortHost);
  return out;
}

function adaptSkillMarkdown(rawMd, host, opts = {}) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(rawMd);
  if (!fm) return { text: rawMd, reverted: false };
  const skillName = String(opts.skillName || '');
  const bundleDir = String(opts.bundleDir || '');
  const platform = opts.platform || process.platform;
  const header = adaptHostProse(fm[0], host, bundleDir);
  let body = rawMd.slice(fm[0].length);
  if (skillName === 'hud') {
    const shortHost = host === 'claude' ? 'Claude Code' : 'OpenAI Codex';
    const hudHeading = `# HUD (Status Board)\n\nIn **${shortHost}**, \`oh-my-agy\` provides an **on-demand chat status board** and a **live Desktop HUD workbench** served over loopback HTTP/SSE.\n\n${buildHostHudSection(host, bundleDir, { platform })}\n`;
    body = body.replace(
      /^# HUD \(Status Board\)[\s\S]*?(?=## Presets)/m,
      () => hudHeading,
    );
  }
  body = adaptHostProse(body, host, bundleDir);
  const adapted = `${header}${body}`;
  if (Buffer.byteLength(adapted, 'utf8') <= 19_000) return { text: adapted, reverted: false };
  return { text: rawMd, reverted: true };
}

function adaptAgentBody(body, host, bundleDir = '') {
  return adaptHostProse(body, host, bundleDir);
}

function buildCodexPluginManifest(pluginJson) {
  const devName = typeof pluginJson.author === 'object' ? pluginJson.author?.name : pluginJson.author;
  const repoRaw = typeof pluginJson.repository === 'string' ? pluginJson.repository : (pluginJson.repository?.url || '');
  const repoBase = String(repoRaw || '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const supportURL = repoBase ? `${repoBase}/issues` : (pluginJson.homepage || '');
  return {
    name: pluginJson.name,
    version: pluginJson.version,
    description: pluginJson.description,
    author: pluginJson.author || { name: 'yomudogly' },
    homepage: pluginJson.homepage || '',
    repository: pluginJson.repository || '',
    license: 'MIT',
    keywords: ['orchestration', 'multi-agent', 'workflows', 'hud', 'wiki'],
    skills: './skills/',
    hooks: './hooks/hooks.json',
    interface: {
      displayName: pluginJson.displayName || 'Oh My Agy',
      shortDescription: 'Multi-agent workflow & HUD.',
      longDescription: pluginJson.description,
      developerName: devName || 'yomudogly',
      category: 'Coding',
      capabilities: ['Interactive', 'Write'],
      websiteURL: pluginJson.homepage || '',
      supportURL,
      composerIcon: './assets/logo.png',
      logo: './assets/logo.png',
      logoDark: './assets/logo.png',
      defaultPrompt: Array.isArray(pluginJson.suggestedPrompts) && pluginJson.suggestedPrompts.length
        ? pluginJson.suggestedPrompts
        : ['$autopilot', '$ralplan', '$hud'],
      brandColor: '#3B82F6',
      screenshots: [],
    },
  };
}

function buildCodexMarketplaceManifest(pluginJson) {
  return {
    name: 'oh-my-agy-local',
    interface: { displayName: 'Oh My Agy Local' },
    plugins: [
      {
        name: pluginJson.name,
        source: { source: 'local', path: `./plugins/${pluginJson.name}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Coding',
      },
    ],
  };
}

function renderClaudeAgentMarkdown(roleName, rawAgentMd, bundleDir = '') {
  const parsed = parseClaudeFrontmatterYaml(rawAgentMd, { requiredKeys: ['name', 'description'] });
  const name = parsed.fields.name || roleName;
  const description = adaptHostProse(String(parsed.fields.description || `${roleName} specialist`), 'claude', bundleDir).replace(/"/g, '\\"');
  const tier = getRoleTier(roleName);
  const spec = CLAUDE_ROLE_TOOLS[tier];
  const lines = [
    '---',
    `name: ${name}`,
    `description: "${description}"`,
    `tools: [${spec.tools.join(', ')}]`,
    `disallowedTools: [${spec.disallowedTools.join(', ')}]`,
  ];
  if (spec.isolation) lines.push(`isolation: ${spec.isolation}`);
  lines.push('---', '', adaptAgentBody(parsed.body, 'claude', bundleDir).trimStart());
  return lines.join('\n');
}

function formatTomlMultiline(val) {
  const s = String(val || '');
  if (!s.includes("'''")) return `'''\n${s.replace(/\r\n/g, '\n')}'''`;
  return JSON.stringify(s);
}

function renderCodexAgentToml(roleName, rawAgentMd, bundleDir = '') {
  const parsed = parseClaudeFrontmatterYaml(rawAgentMd, { requiredKeys: ['name', 'description'] });
  const name = parsed.fields.name || roleName;
  const desc = adaptHostProse(String(parsed.fields.description || `${roleName} specialist`), 'codex', bundleDir);
  const sandboxMode = WRITE_ROLES.has(roleName) ? 'workspace-write' : 'read-only';
  const leafGuard = [
    '<native_subagent_leaf_guard>',
    'Execute only the scoped task assigned by the parent session.',
    'Do not spawn nested child agents, orchestrate workflows recursively, or rewrite parent state files.',
    'Report concrete findings, blockers, and scope boundary crossings back to the caller.',
    '</native_subagent_leaf_guard>',
  ].join('\n');
  const instructions = `${adaptAgentBody(parsed.body, 'codex', bundleDir).trimStart().trimEnd()}\n\n${leafGuard}`;
  return [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(desc)}`,
    `sandbox_mode = ${JSON.stringify(sandboxMode)}`,
    `developer_instructions = ${formatTomlMultiline(instructions)}`,
    '',
  ].join('\n');
}

function titleCaseSkill(slug) {
  return String(slug || '').split('-').map((w) => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

function renderCodexOpenAiYaml(skillName, fmFields, bundleDir = '') {
  const displayName = titleCaseSkill(skillName);
  const shortDesc = adaptHostProse(String(fmFields.description || `${displayName} workflow`), 'codex', bundleDir).slice(0, 140).replace(/"/g, '\\"');
  const allowImplicit = !EXPLICIT_ONLY_SKILLS.has(skillName);
  return [
    'interface:',
    `  display_name: "${displayName}"`,
    `  short_description: "${shortDesc}"`,
    `  default_prompt: "Use $${skillName} to guide this task."`,
    'policy:',
    `  allow_implicit_invocation: ${allowImplicit ? 'true' : 'false'}`,
    '',
  ].join('\n');
}

const SUPPORTED_HOOK_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']);

function buildHostHooksJson(host, bundleDir, { platform = process.platform } = {}) {
  const isWin = platform === 'win32';
  const runSh = path.join(bundleDir, 'hooks', 'run.sh');
  const hookMjs = path.win32.join(bundleDir, 'hooks', 'omagy-hook.mjs');
  const mkEntry = (cliEvent, matcher = '', timeout = 15) => {
    const cmd = isWin
      ? `node "${hookMjs}" ${cliEvent} --host=${host}`
      : `OMAGY_HOST=${host} OMAGY_BUNDLE_DIR=${shellQuote(bundleDir)} sh ${shellQuote(runSh)} ${cliEvent} --host=${host}`;
    const entry = { hooks: [{ type: 'command', command: cmd, timeout }] };
    if (matcher) entry.matcher = matcher;
    return [entry];
  };
  if (host === 'claude') {
    return {
      description: 'oh-my-agy hooks for Claude Code',
      hooks: {
        SessionStart: mkEntry('session-start'),
        UserPromptSubmit: mkEntry('user-prompt-submit'),
        PreToolUse: mkEntry('pre-tool-use', 'Write|Edit|MultiEdit|NotebookEdit|Read'),
        Stop: mkEntry('stop', '', 30),
      },
    };
  }
  return {
    description: 'oh-my-agy hooks for OpenAI Codex',
    hooks: {
      SessionStart: mkEntry('session-start'),
      UserPromptSubmit: mkEntry('user-prompt-submit'),
      PreToolUse: mkEntry('pre-tool-use', 'apply_patch|Write|Edit|MultiEdit|Read|Bash|shell_command|exec_command'),
      Stop: mkEntry('stop', '', 30),
    },
  };
}

function ensureRealCleanDir(dirPath) {
  try {
    const st = fs.lstatSync(dirPath);
    if (st.isSymbolicLink() || !st.isDirectory()) fs.rmSync(dirPath, { recursive: true, force: true });
  } catch { /* fail open: directory does not exist yet */ }
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetRealCleanDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch { /* fail open: directory absent before recreate */ }
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeRealFileSync(filePath, content) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) fs.rmSync(filePath, { recursive: true, force: true });
    else if (fs.readFileSync(filePath, 'utf8') === content) return;
  } catch { /* fail open: destination file does not exist yet */ }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyDirRecursive(srcDir, dstDir, { dereference = false, skipNames = null } = {}) {
  ensureRealCleanDir(dstDir);
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store' || ent.name === 'node_modules') continue;
    if (skipNames && skipNames.has(ent.name)) continue;
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    let st;
    try { st = dereference ? fs.statSync(s) : fs.lstatSync(s); } catch { /* fail open: vanished entry */ continue; }
    if (!dereference && st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      copyDirRecursive(s, d, { dereference, skipNames });
    } else if (st.isFile()) {
      try {
        const dstSt = fs.lstatSync(d);
        if (dstSt.isSymbolicLink() || !dstSt.isFile()) fs.rmSync(d, { recursive: true, force: true });
      } catch { /* fail open: destination file absent */ }
      fs.copyFileSync(s, d);
      if (ent.name.endsWith('.sh') || (st.mode & 0o111) !== 0) fs.chmodSync(d, 0o755);
    }
  }
}

function adaptMarkdownTree(dirPath, host, bundleDir) {
  if (!fs.existsSync(dirPath)) return;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, ent.name);
    if (ent.isDirectory()) adaptMarkdownTree(p, host, bundleDir);
    else if (ent.isFile() && ent.name.endsWith('.md')) {
      writeRealFileSync(p, adaptHostProse(fs.readFileSync(p, 'utf8'), host, bundleDir));
    }
  }
}

function linkOrCopyFile(srcFile, dstFile, forceCopy) {
  try { fs.rmSync(dstFile, { force: true, recursive: true }); } catch { /* fail open: absent dst */ }
  fs.mkdirSync(path.dirname(dstFile), { recursive: true });
  if (!forceCopy) {
    try {
      fs.symlinkSync(srcFile, dstFile);
      return false;
    } catch (err) { /* fail open: fallback to file copy when symlink unsupported */
      if (!err || !['EPERM', 'ENOTSUP', 'EXDEV', 'EACCES'].includes(err.code)) throw err;
    }
  }
  fs.copyFileSync(srcFile, dstFile);
  if (srcFile.endsWith('.sh')) fs.chmodSync(dstFile, 0o755);
  return true;
}

function linkOrCopyDir(srcDir, dstDir, forceCopy) {
  try { fs.rmSync(dstDir, { force: true, recursive: true }); } catch { /* fail open: absent dst */ }
  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  if (!forceCopy) {
    try {
      fs.symlinkSync(srcDir, dstDir, 'dir');
      return false;
    } catch (err) { /* fail open: fallback to copy when directory symlink unsupported */
      if (!err || !['EPERM', 'ENOTSUP', 'EXDEV', 'EACCES'].includes(err.code)) throw err;
    }
  }
  copyDirRecursive(srcDir, dstDir);
  return true;
}

function realpathOrResolved(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { /* fail open: non-existent leaf */ return abs; }
}

function assertNotSymlinkTarget(targetPath, errCode = 'symlink_target_disallowed') {
  try {
    if (fs.lstatSync(targetPath).isSymbolicLink()) throw new Error(`${errCode}:${targetPath}`);
  } catch (err) { /* fail open: ignore missing target path only */
    if (err && err.code !== 'ENOENT') throw err;
  }
}

function assertSafeBundleTargetDir(bundleDir, pluginRoot, workspace = '') {
  const abs = path.resolve(bundleDir);
  const real = realpathOrResolved(abs);
  const forbiddenExact = new Set([
    '/', '/Users', '/home', '/tmp', '/private', '/private/tmp', '/var', '/etc', '/usr', '/opt', '/bin', '/sbin',
    realpathOrResolved(os.homedir()),
    realpathOrResolved(os.tmpdir()),
    realpathOrResolved(process.cwd()),
  ]);
  if (path.dirname(abs) === abs || forbiddenExact.has(abs) || forbiddenExact.has(real)) {
    throw new Error(`unsafe_bundle_dir:${bundleDir}`);
  }
  const realPlugin = realpathOrResolved(pluginRoot);
  if (real === realPlugin || realPlugin.startsWith(real + path.sep) || real.startsWith(realPlugin + path.sep)) {
    throw new Error(`unsafe_bundle_dir_plugin_overlap:${bundleDir}`);
  }
  if (workspace) {
    const realWs = realpathOrResolved(workspace);
    if (real === realWs || realWs.startsWith(real + path.sep)) {
      throw new Error(`unsafe_bundle_dir_workspace_overlap:${bundleDir}`);
    }
  }
  // Never wipe an existing non-empty directory that wasn't created by host-setup unless named oh-my-agy
  try {
    const st = fs.lstatSync(abs);
    if (st.isDirectory() && !st.isSymbolicLink() && path.basename(abs) !== 'oh-my-agy') {
      const entries = fs.readdirSync(abs).filter((n) => n !== '.DS_Store');
      if (entries.length > 0 && !entries.includes('host-bundle.json')) {
        throw new Error(`unsafe_bundle_dir_nonempty:${bundleDir}`);
      }
    }
  } catch (err) { /* fail open: absent dir is safe to create */
    if (err && err.code !== 'ENOENT') throw err;
  }
}

function mergeLaunchJson(launchPath, bundleDir, workspaceRoot, { platform = process.platform } = {}) {
  assertNotSymlinkTarget(path.dirname(launchPath), 'launch_dir_symlink_target');
  assertNotSymlinkTarget(launchPath, 'launch_json_symlink_target');
  let doc = { version: '0.0.1', configurations: [] };
  if (fs.existsSync(launchPath)) {
    const raw = fs.readFileSync(launchPath, 'utf8').replace(/^\uFEFF/, '');
    doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object') throw new Error('invalid_existing_launch_json');
  }
  const configs = Array.isArray(doc.configurations) ? doc.configurations.filter((c) => c && c.name !== 'oh-my-agy-hud') : [];
  const port = computeDesktopHudPort(workspaceRoot, { channel: 'launch' });
  const registryFile = desktopHudRegistryFile(workspaceRoot, '', { channel: 'launch' });
  const isWin = platform === 'win32';
  configs.push({
    name: 'oh-my-agy-hud',
    runtimeExecutable: isWin ? 'node' : 'sh',
    runtimeArgs: [
      isWin ? path.win32.join(bundleDir, 'sidecars', 'hud', 'main.mjs') : path.join(bundleDir, 'sidecars', 'hud', 'run.sh'),
      'desktop-serve', '--host', 'claude', '--workspace', path.resolve(workspaceRoot), '--port', String(port), '--registry', registryFile,
    ],
    port,
  });
  const merged = { version: doc.version || '0.0.1', ...doc, configurations: configs };
  writeRealFileSync(launchPath, `${JSON.stringify(merged, null, 2)}\n`);
  return { launchPath, port };
}

function parseTomlTableHeader(line) {
  const arr = /^\s*\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/.exec(String(line || ''));
  if (arr) return { isArray: true, name: arr[1].trim() };
  const tbl = /^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/.exec(String(line || ''));
  if (tbl) return { isArray: false, name: tbl[1].trim() };
  return null;
}

/** Upsert a `[section]` block in TOML text without touching `[mcp_servers]`, `[[array]]`, or unrelated keys. */
function upsertTomlSection(tomlText, sectionHeader, desiredPairs, removeKeys = []) {
  const lines = tomlText ? tomlText.replace(/\r\n/g, '\n').split('\n') : [];
  const out = [];
  let inTarget = false;
  let foundSection = false;
  const desiredMap = new Map(Object.entries(desiredPairs));
  const removeSet = new Set(Array.isArray(removeKeys) ? removeKeys : []);
  const seenKeys = new Set();

  const flushMissing = () => {
    const missing = [];
    for (const [k, v] of desiredMap.entries()) {
      if (!seenKeys.has(k)) missing.push(`${k} = ${v}`);
    }
    if (!missing.length) return;
    let trailingBlanks = 0;
    while (trailingBlanks < out.length && out[out.length - 1 - trailingBlanks] === '') {
      trailingBlanks += 1;
    }
    out.splice(out.length - trailingBlanks, 0, ...missing);
  };

  for (const line of lines) {
    const hdr = parseTomlTableHeader(line);
    if (hdr) {
      if (inTarget) {
        flushMissing();
        inTarget = false;
      }
      if (!hdr.isArray && hdr.name === sectionHeader) {
        foundSection = true;
        inTarget = true;
        seenKeys.clear();
      }
      out.push(line);
      continue;
    }
    if (inTarget) {
      const kvMatch = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
      if (kvMatch) {
        const k = kvMatch[1];
        if (removeSet.has(k)) continue;
        if (desiredMap.has(k)) {
          if (!seenKeys.has(k)) {
            out.push(`${k} = ${desiredMap.get(k)}`);
            seenKeys.add(k);
          }
          continue;
        }
      }
    }
    out.push(line);
  }
  if (inTarget) flushMissing();
  if (!foundSection) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`[${sectionHeader}]`);
    for (const [k, v] of desiredMap.entries()) out.push(`${k} = ${v}`);
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function mergeCodexConfigToml(configPath, roleDescs, pluginOpts = null) {
  assertNotSymlinkTarget(path.dirname(configPath), 'codex_dir_symlink_target');
  assertNotSymlinkTarget(configPath, 'config_toml_symlink_target');
  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '') : '';
  content = upsertTomlSection(content, 'agents', { enabled: 'true' });
  content = upsertTomlSection(content, 'features', { hooks: 'true' }, ['multi_agent']);
  if (pluginOpts) {
    content = upsertTomlSection(content, `marketplaces.${pluginOpts.marketplaceName}`, {
      source_type: '"local"',
      source: JSON.stringify(pluginOpts.marketplaceDir),
    });
    content = upsertTomlSection(content, `plugins.${JSON.stringify(pluginOpts.pluginId)}`, {
      enabled: 'true',
    });
  }
  for (const role of ALL_ROLES) {
    content = upsertTomlSection(content, `agents.${role}`, {
      description: JSON.stringify(roleDescs[role] || `${role} specialist`),
      config_file: JSON.stringify(`agents/${role}.toml`),
    });
  }
  writeRealFileSync(configPath, content);
  return configPath;
}

function prepareCodexAgentsMd(agentsMdPath, pluginRoot, bundleDir = '') {
  assertNotSymlinkTarget(path.dirname(agentsMdPath), 'agents_dir_symlink_target');
  assertNotSymlinkTarget(agentsMdPath, 'agents_md_symlink_target');
  const rawRules = fs.readFileSync(path.join(pluginRoot, 'rules', 'AGENTS.md'), 'utf8');
  const trimmedRules = adaptAgentBody(rawRules, 'codex', bundleDir);
  const buildBlock = (body) => `${CODEX_AGENTS_START}\n${body.trim()}\n${CODEX_AGENTS_END}\n`;
  let existing = fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, 'utf8').replace(/^\uFEFF/, '') : '';
  const blockRe = new RegExp(`${escapeRegExp(CODEX_AGENTS_START)}[\\s\\S]*?${escapeRegExp(CODEX_AGENTS_END)}\\r?\\n?`, 'g');
  existing = existing.replace(blockRe, '').trimEnd();

  const compactFallback = [
    '# oh-my-agy Operating Contract (Codex Adapter)',
    '- Lanes: `$autopilot`, `$deep-interview`, `$ralplan`, `$ultragoal`, `$team`, `$code-review`, `$ultraqa`, `$analyze`, `$modernize`, `$threat-model`, `$release`. Read the matching `SKILL.md` before executing a skill.',
    '- Subagents: Defined under `.codex/agents/*.toml` (read-only vs workspace-write). Never exceed task scope or touch unrelated user files.',
    '- Durable state: Store `.omagy/` state with refreshed `updated_at` and leave `omagy-ignore-start .. omagy-ignore-end` blocks unchanged.',
  ].join('\n');

  const candidates = [
    { body: trimmedRules, usedCompactFallback: false },
    { body: compactFallback, usedCompactFallback: true },
  ];
  for (const cand of candidates) {
    const merged = existing ? `${existing}\n\n${buildBlock(cand.body)}` : buildBlock(cand.body);
    const bytes = Buffer.byteLength(merged, 'utf8');
    if (bytes <= CODEX_AGENTS_MAX_BYTES) {
      return { agentsMdPath, content: merged, bytes, usedCompactFallback: cand.usedCompactFallback };
    }
  }
  throw new Error(`agents_md_exceeds_${CODEX_AGENTS_MAX_BYTES}`);
}

function mergeCodexAgentsMd(agentsMdPath, pluginRoot) {
  const plan = prepareCodexAgentsMd(agentsMdPath, pluginRoot);
  writeRealFileSync(plan.agentsMdPath, plan.content);
  return { agentsMdPath: plan.agentsMdPath, bytes: plan.bytes, usedCompactFallback: plan.usedCompactFallback };
}

function resolveHostTargetContext(host, options = {}) {
  const workspace = options.workspace ? path.resolve(options.workspace) : '';
  const scope = options.scope ? String(options.scope).trim().toLowerCase() : (workspace ? 'project' : 'user');
  const explicitHome = options.homeDir ? path.resolve(options.homeDir) : '';
  const claudeConfigRoot = path.resolve(options.configRoot || (explicitHome ? path.join(explicitHome, '.claude') : (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))));
  const codexHome = path.resolve(options.codexHome || (explicitHome ? path.join(explicitHome, '.codex') : (process.env.CODEX_HOME || path.join(os.homedir(), '.codex'))));
  const claudeTargetRoot = scope === 'project' && workspace ? path.join(workspace, '.claude') : claudeConfigRoot;
  const codexTargetRoot = scope === 'project' && workspace ? path.join(workspace, '.codex') : codexHome;
  const targetRoot = host === 'claude' ? claudeTargetRoot : codexTargetRoot;
  return {
    workspace,
    scope,
    claudeConfigRoot,
    codexHome,
    claudeTargetRoot,
    codexTargetRoot,
    targetRoot,
    defaultBundleDir: path.join(targetRoot, 'plugins', 'oh-my-agy'),
  };
}

function resolveDefaultBundleDir(host, options = {}) {
  return resolveHostTargetContext(host, options).defaultBundleDir;
}

function isOmagyHookEntry(entry) {
  return Boolean(
    entry
    && typeof entry === 'object'
    && Array.isArray(entry.hooks)
    && entry.hooks.some((h) => h && typeof h.command === 'string' && (h.command.includes('oh-my-agy') || /hooks[\/\\](?:run\.sh|omagy-hook\.mjs)/.test(h.command))),
  );
}

function readExistingHooksJsonStrict(hooksPath) {
  const existing = readJsonStrict(hooksPath);
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)
    || (existing.hooks !== undefined && (!existing.hooks || typeof existing.hooks !== 'object' || Array.isArray(existing.hooks)))) {
    throw new Error('invalid_existing_hooks_json');
  }
  return existing;
}

function mergeCodexHooksJson(hooksPath, hooksConfig) {
  assertNotSymlinkTarget(path.dirname(hooksPath), 'codex_dir_symlink_target');
  assertNotSymlinkTarget(hooksPath, 'codex_hooks_json_symlink_target');
  const existing = fs.existsSync(hooksPath) ? readExistingHooksJsonStrict(hooksPath) : null;
  const existingHooks = existing?.hooks || {};
  const mergedHooks = {};
  const requiredEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
  for (const ev of requiredEvents) {
    const preserved = Array.isArray(existingHooks[ev]) ? existingHooks[ev].filter((e) => !isOmagyHookEntry(e)) : [];
    const generated = Array.isArray(hooksConfig.hooks[ev]) ? hooksConfig.hooks[ev] : [];
    mergedHooks[ev] = [...preserved, ...generated];
  }
  for (const [ev, entries] of Object.entries(existingHooks)) {
    if (Object.prototype.hasOwnProperty.call(mergedHooks, ev)) continue;
    if (!Array.isArray(entries)) {
      mergedHooks[ev] = entries;
      continue;
    }
    const preserved = entries.filter((e) => !isOmagyHookEntry(e));
    if (preserved.length) mergedHooks[ev] = preserved;
  }
  const merged = {
    description: typeof existing?.description === 'string' && existing.description.trim()
      ? existing.description
      : hooksConfig.description,
    hooks: mergedHooks,
  };
  writeRealFileSync(hooksPath, `${JSON.stringify(merged, null, 2)}\n`);
  return hooksPath;
}

function stripOmagyCodexHooksJson(hooksPath) {
  assertNotSymlinkTarget(path.dirname(hooksPath), 'codex_dir_symlink_target');
  assertNotSymlinkTarget(hooksPath, 'codex_hooks_json_symlink_target');
  if (!fs.existsSync(hooksPath)) return { removedAll: false, keptForeign: false };
  const existing = readExistingHooksJsonStrict(hooksPath);
  const existingHooks = existing?.hooks || {};
  const kept = {};
  for (const [ev, entries] of Object.entries(existingHooks)) {
    if (!Array.isArray(entries)) {
      kept[ev] = entries;
      continue;
    }
    const foreign = entries.filter((e) => !isOmagyHookEntry(e));
    if (foreign.length) kept[ev] = foreign;
  }
  if (!Object.keys(kept).length) {
    fs.unlinkSync(hooksPath);
    return { removedAll: true, keptForeign: false };
  }
  writeRealFileSync(hooksPath, `${JSON.stringify({ ...(existing.description ? { description: existing.description } : {}), hooks: kept }, null, 2)}\n`);
  return { removedAll: false, keptForeign: true };
}

export function isOmagyOwnedCodexSkill(skillDir) {
  try {
    const st = fs.lstatSync(skillDir);
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(skillDir);
      if (/oh-my-agy/i.test(target)) return true;
    }
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) return false;
    const content = fs.readFileSync(skillMd, 'utf8');
    return /(?:\[oh-my-agy\]|oh-my-agy|\.omagy\/|omagy_wiki\/|omagy-hook\.mjs|hooks[\/\\]run\.sh)/i.test(content);
  } catch {
    return false; /* fail open: cannot inspect legacy skill directory */
  }
}

function cleanLegacyDuplicateCodexUserSkills(skillsDir, skillNames, warnings = []) {
  assertNotSymlinkTarget(skillsDir, 'codex_skills_dir_symlink_target');
  if (!fs.existsSync(skillsDir)) return;
  for (const sName of skillNames) {
    const legacy = path.join(skillsDir, sName);
    try {
      const st = fs.lstatSync(legacy, { throwIfNoEntry: false });
      if (!st) continue;
      if (isOmagyOwnedCodexSkill(legacy)) fs.rmSync(legacy, { recursive: true, force: true });
      else warnings.push(`preserved_foreign_codex_skill:${sName}`);
    } catch { /* fail open: legacy skill inspect/remove failed */ }
  }
}

function getCodexPluginLocations(codexTargetRoot, pluginJson) {
  const mktRoot = path.join(codexTargetRoot, 'marketplaces', 'oh-my-agy');
  const mktPluginDir = path.join(mktRoot, 'plugins', pluginJson.name);
  const cachePkgDir = path.join(codexTargetRoot, 'plugins', 'cache', 'oh-my-agy-local', pluginJson.name);
  const cacheVerDir = path.join(cachePkgDir, pluginJson.version);
  return {
    marketplaceName: 'oh-my-agy-local',
    marketplaceDir: mktRoot,
    mktAgentsDir: path.join(mktRoot, '.agents', 'plugins'),
    mktPluginDir,
    cachePkgDir,
    cachePluginDir: cacheVerDir,
    pluginId: `${pluginJson.name}@oh-my-agy-local`,
  };
}

function materializeCodexPluginTrees({ bundleDir, codexTargetRoot, pluginJson, platform = process.platform }) {
  const loc = getCodexPluginLocations(codexTargetRoot, pluginJson);
  for (const p of [
    path.join(codexTargetRoot, 'marketplaces'),
    loc.marketplaceDir,
    loc.mktPluginDir,
    path.join(codexTargetRoot, 'plugins'),
    path.join(codexTargetRoot, 'plugins', 'cache'),
    path.join(codexTargetRoot, 'plugins', 'cache', loc.marketplaceName),
    loc.cachePkgDir,
    loc.cachePluginDir,
  ]) {
    assertNotSymlinkTarget(p, 'codex_plugin_symlink_target');
  }
  if (fs.existsSync(loc.cachePkgDir)) {
    for (const ent of fs.readdirSync(loc.cachePkgDir)) {
      if (ent !== pluginJson.version) {
        fs.rmSync(path.join(loc.cachePkgDir, ent), { recursive: true, force: true });
      }
    }
  }
  resetRealCleanDir(loc.mktPluginDir);
  copyDirRecursive(bundleDir, loc.mktPluginDir, { dereference: true });
  writeRealFileSync(
    path.join(loc.mktPluginDir, 'hooks', 'hooks.json'),
    `${JSON.stringify(buildHostHooksJson('codex', loc.mktPluginDir, { platform }), null, 2)}\n`,
  );
  resetRealCleanDir(loc.mktAgentsDir);
  writeRealFileSync(
    path.join(loc.mktAgentsDir, 'marketplace.json'),
    `${JSON.stringify(buildCodexMarketplaceManifest(pluginJson), null, 2)}\n`,
  );

  resetRealCleanDir(loc.cachePluginDir);
  copyDirRecursive(bundleDir, loc.cachePluginDir, { dereference: true });
  writeRealFileSync(
    path.join(loc.cachePluginDir, 'hooks', 'hooks.json'),
    `${JSON.stringify(buildHostHooksJson('codex', loc.cachePluginDir, { platform }), null, 2)}\n`,
  );
  return loc;
}

/** Generate Claude Code or OpenAI Codex bundle and host configuration files cleanly without altering canonical root. */
export function setupHostBundle(options = {}) {
  const host = String(options.host || '').trim().toLowerCase();
  if (!SUPPORTED_HOSTS.has(host)) return { ok: false, exitCode: 2, error: `unsupported_host:${host || '(empty)'}` };
  if (options.copy && options.symlink) return { ok: false, exitCode: 2, error: 'conflicting_flags:--copy,--symlink' };

  const platform = String(options.platform || process.platform);
  const pluginRoot = path.resolve(options.pluginRoot || process.cwd());
  const pluginJson = readJsonStrict(path.join(pluginRoot, 'plugin.json'));
  const {
    workspace,
    scope,
    claudeTargetRoot,
    codexTargetRoot,
    defaultBundleDir,
  } = resolveHostTargetContext(host, options);
  if (scope !== 'project' && scope !== 'user') return { ok: false, exitCode: 2, error: `invalid_scope:${scope}` };
  if (scope === 'project' && !workspace && !options.dir) {
    return { ok: false, exitCode: 2, error: 'workspace_required_for_project_scope' };
  }

  const bundleDir = options.dir ? path.resolve(options.dir) : defaultBundleDir;
  const useSymlink = Boolean(options.symlink);

  if (options.dryRun) {
    return {
      ok: true,
      exitCode: 0,
      dryRun: true,
      host,
      scope,
      mode: useSymlink ? 'symlink' : 'copy',
      bundleDir,
      targetRoot: host === 'claude' ? claudeTargetRoot : codexTargetRoot,
      ...(host === 'codex' ? { skillsDir: scope === 'user' ? path.join(getCodexPluginLocations(codexTargetRoot, pluginJson).cachePluginDir, 'skills') : path.join(codexTargetRoot, 'skills') } : {}),
      ...(workspace ? { workspace } : {}),
    };
  }

  let codexAgentsPlan = null;
  try {
    assertSafeBundleTargetDir(bundleDir, pluginRoot, workspace);
    const agentsMdTarget = scope === 'project' && workspace ? path.join(workspace, 'AGENTS.md') : path.join(codexTargetRoot, 'AGENTS.md');
    codexAgentsPlan = host === 'codex' ? prepareCodexAgentsMd(agentsMdTarget, pluginRoot, bundleDir) : null;
    if (host === 'claude') {
      assertNotSymlinkTarget(claudeTargetRoot, 'claude_target_dir_symlink_target');
      assertNotSymlinkTarget(path.join(claudeTargetRoot, 'rules'), 'claude_rules_dir_symlink_target');
      assertNotSymlinkTarget(path.join(claudeTargetRoot, 'rules', 'oh-my-agy.md'), 'claude_rules_symlink_target');
    } else {
      assertNotSymlinkTarget(codexTargetRoot, 'codex_target_dir_symlink_target');
      assertNotSymlinkTarget(path.join(codexTargetRoot, 'hooks.json'), 'codex_hooks_json_symlink_target');
      assertNotSymlinkTarget(path.join(codexTargetRoot, 'config.toml'), 'codex_config_toml_symlink_target');
      assertNotSymlinkTarget(path.join(codexTargetRoot, 'skills'), 'codex_skills_dir_symlink_target');
      assertNotSymlinkTarget(path.join(codexTargetRoot, 'agents'), 'codex_agents_dir_symlink_target');
      if (scope === 'user') {
        assertNotSymlinkTarget(path.join(codexTargetRoot, 'marketplaces'), 'codex_plugin_symlink_target');
        assertNotSymlinkTarget(path.join(codexTargetRoot, 'plugins'), 'codex_plugin_symlink_target');
        assertNotSymlinkTarget(path.join(codexTargetRoot, 'plugins', 'cache'), 'codex_plugin_symlink_target');
      }
      const existingCodexHooks = path.join(codexTargetRoot, 'hooks.json');
      if (fs.existsSync(existingCodexHooks)) readExistingHooksJsonStrict(existingCodexHooks);
    }
  } catch (err) { /* fail open: abort setup before mutating disk */
    return { ok: false, exitCode: 2, error: err instanceof Error ? err.message : String(err) };
  }

  const warnings = [];
  let usedCopy = !useSymlink;
  ensureRealCleanDir(bundleDir);

  // 1. Real <bundleDir>/hooks/ dir with copy-by-default (or file-level symlinks via --symlink) + generated host hooks.json
  const hooksSrcDir = path.join(pluginRoot, 'hooks');
  const hooksDstDir = path.join(bundleDir, 'hooks');
  resetRealCleanDir(hooksDstDir);
  for (const name of fs.readdirSync(hooksSrcDir)) {
    if (name === 'hooks.json' || name === '.DS_Store') continue;
    const src = path.join(hooksSrcDir, name);
    if (!fs.statSync(src).isFile()) continue;
    if (linkOrCopyFile(src, path.join(hooksDstDir, name), usedCopy)) usedCopy = true;
  }
  const hooksConfig = buildHostHooksJson(host, bundleDir, { platform });
  writeRealFileSync(path.join(hooksDstDir, 'hooks.json'), `${JSON.stringify(hooksConfig, null, 2)}\n`);

  // 2. Link/copy sidecars/ and assets/ (omitting 82MB README demo GIF), and write host-adapted rules/AGENTS.md
  if (linkOrCopyDir(path.join(pluginRoot, 'sidecars'), path.join(bundleDir, 'sidecars'), usedCopy)) usedCopy = true;
  const assetsSrcDir = path.join(pluginRoot, 'assets');
  const assetsDstDir = path.join(bundleDir, 'assets');
  resetRealCleanDir(assetsDstDir);
  if (fs.existsSync(assetsSrcDir)) {
    for (const name of fs.readdirSync(assetsSrcDir)) {
      if (name === '.DS_Store' || name === 'sidecar-hud.gif') continue;
      const src = path.join(assetsSrcDir, name);
      const dst = path.join(assetsDstDir, name);
      const st = fs.statSync(src);
      if (st.isDirectory()) { if (linkOrCopyDir(src, dst, usedCopy)) usedCopy = true; }
      else if (st.isFile()) { if (linkOrCopyFile(src, dst, usedCopy)) usedCopy = true; }
    }
  }
  const rulesDstDir = path.join(bundleDir, 'rules');
  resetRealCleanDir(rulesDstDir);
  const adaptedRulesBody = adaptAgentBody(fs.readFileSync(path.join(pluginRoot, 'rules', 'AGENTS.md'), 'utf8'), host, bundleDir);
  writeRealFileSync(path.join(rulesDstDir, 'AGENTS.md'), adaptedRulesBody);

  // 3. Real <bundleDir>/skills/<name>/ dirs with copied references/scripts/assets & host-adapted SKILL.md
  const skillsSrcDir = path.join(pluginRoot, 'skills');
  const skillsDstDir = path.join(bundleDir, 'skills');
  resetRealCleanDir(skillsDstDir);
  const skillNames = fs.readdirSync(skillsSrcDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const sName of skillNames) {
    const sSrc = path.join(skillsSrcDir, sName);
    const sDst = path.join(skillsDstDir, sName);
    resetRealCleanDir(sDst);
    for (const sub of ['references', 'scripts', 'assets']) {
      if (fs.existsSync(path.join(sSrc, sub))) copyDirRecursive(path.join(sSrc, sub), path.join(sDst, sub));
    }
    adaptMarkdownTree(path.join(sDst, 'references'), host, bundleDir);
    const rawSkillMd = fs.readFileSync(path.join(sSrc, 'SKILL.md'), 'utf8');
    const adaptedSkill = adaptSkillMarkdown(rawSkillMd, host, { skillName: sName, bundleDir, platform });
    if (adaptedSkill.reverted) warnings.push(`skill_adapt_reverted_over_19000:${sName}`);
    writeRealFileSync(path.join(sDst, 'SKILL.md'), adaptedSkill.text);
    if (host === 'codex') {
      const parsedSkill = parseClaudeFrontmatterYaml(rawSkillMd, { requiredKeys: ['name', 'description'] });
      writeRealFileSync(path.join(sDst, 'agents', 'openai.yaml'), renderCodexOpenAiYaml(sName, parsedSkill.fields, bundleDir));
    }
  }

  // 4. Bundle manifests & agents
  const codexVersion = host === 'codex' ? detectCodexVersion() : undefined;
  const bundleMeta = {
    host,
    pluginName: pluginJson.name,
    version: pluginJson.version,
    sourceVersion: pluginJson.version,
    schemaVersion: 1,
    mode: usedCopy ? 'copy' : 'symlink',
    scope,
    generatedAt: new Date().toISOString(),
    pluginRoot,
    ...(codexVersion ? { codexVersion } : {}),
  };

  if (host === 'claude') {
    const claudeManifest = {
      name: pluginJson.name,
      version: pluginJson.version,
      description: pluginJson.description,
      author: pluginJson.author,
      homepage: pluginJson.homepage,
      repository: pluginJson.repository,
    };
    resetRealCleanDir(path.join(bundleDir, '.claude-plugin'));
    writeRealFileSync(path.join(bundleDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(claudeManifest, null, 2)}\n`);
    writeRealFileSync(path.join(bundleDir, 'plugin.json'), `${JSON.stringify(claudeManifest, null, 2)}\n`);

    const agentsDst = path.join(bundleDir, 'agents');
    resetRealCleanDir(agentsDst);
    for (const role of ALL_ROLES) {
      const rawAgent = fs.readFileSync(path.join(pluginRoot, 'agents', `${role}.md`), 'utf8');
      writeRealFileSync(path.join(agentsDst, `${role}.md`), renderClaudeAgentMarkdown(role, rawAgent, bundleDir));
    }

    writeRealFileSync(path.join(rulesDstDir, 'oh-my-agy.md'), adaptedRulesBody);
    fs.mkdirSync(path.join(claudeTargetRoot, 'rules'), { recursive: true });
    writeRealFileSync(path.join(claudeTargetRoot, 'rules', 'oh-my-agy.md'), adaptedRulesBody);

    let launchInfo = null;
    if (workspace) launchInfo = mergeLaunchJson(path.join(workspace, '.claude', 'launch.json'), bundleDir, workspace, { platform });

    bundleMeta.targetRoot = claudeTargetRoot;
    writeRealFileSync(path.join(bundleDir, 'host-bundle.json'), `${JSON.stringify(bundleMeta, null, 2)}\n`);
    return {
      ok: true,
      exitCode: 0,
      host,
      scope,
      mode: bundleMeta.mode,
      bundleDir,
      targetRoot: claudeTargetRoot,
      skillsCount: skillNames.length,
      agentsCount: ALL_ROLES.length,
      ...(launchInfo ? { launchJson: launchInfo.launchPath, launchPort: launchInfo.port } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  // Codex emission
  const codexManifest = buildCodexPluginManifest(pluginJson);
  writeRealFileSync(path.join(bundleDir, 'plugin.json'), `${JSON.stringify(codexManifest, null, 2)}\n`);
  resetRealCleanDir(path.join(bundleDir, '.codex-plugin'));
  writeRealFileSync(path.join(bundleDir, '.codex-plugin', 'plugin.json'), `${JSON.stringify(codexManifest, null, 2)}\n`);

  const bundleAgentsDst = path.join(bundleDir, 'agents');
  const codexAgentsDst = path.join(codexTargetRoot, 'agents');
  resetRealCleanDir(bundleAgentsDst);
  ensureRealCleanDir(codexAgentsDst);
  const roleDescs = {};
  for (const role of ALL_ROLES) {
    const rawAgent = fs.readFileSync(path.join(pluginRoot, 'agents', `${role}.md`), 'utf8');
    const parsedAgent = parseClaudeFrontmatterYaml(rawAgent, { requiredKeys: ['name', 'description'] });
    roleDescs[role] = adaptHostProse(parsedAgent.fields.description || `${role} specialist`, 'codex', bundleDir);
    const toml = renderCodexAgentToml(role, rawAgent, bundleDir);
    writeRealFileSync(path.join(bundleAgentsDst, `${role}.toml`), toml);
    writeRealFileSync(path.join(bundleAgentsDst, `${role}.md`), adaptAgentBody(rawAgent, 'codex', bundleDir));
    writeRealFileSync(path.join(codexAgentsDst, `${role}.toml`), toml);
  }

  fs.mkdirSync(codexTargetRoot, { recursive: true });
  writeRealFileSync(codexAgentsPlan.agentsMdPath, codexAgentsPlan.content);
  if (codexAgentsPlan.usedCompactFallback) warnings.push('codex_agents_md_compact_fallback');
  const agentsMdRes = codexAgentsPlan;

  let pluginLoc = null;
  let skillsDirOut = '';
  let hooksJsonOut = '';
  if (scope === 'project') {
    const codexSkillsDst = path.join(codexTargetRoot, 'skills');
    fs.mkdirSync(codexSkillsDst, { recursive: true });
    for (const sName of skillNames) {
      const targetSkillDir = path.join(codexSkillsDst, sName);
      resetRealCleanDir(targetSkillDir);
      copyDirRecursive(path.join(skillsDstDir, sName), targetSkillDir);
    }
    hooksJsonOut = mergeCodexHooksJson(path.join(codexTargetRoot, 'hooks.json'), hooksConfig);
    mergeCodexConfigToml(path.join(codexTargetRoot, 'config.toml'), roleDescs, null);
    skillsDirOut = codexSkillsDst;
  } else {
    cleanLegacyDuplicateCodexUserSkills(path.join(codexTargetRoot, 'skills'), skillNames, warnings);
    stripOmagyCodexHooksJson(path.join(codexTargetRoot, 'hooks.json'));
    pluginLoc = getCodexPluginLocations(codexTargetRoot, pluginJson);
    skillsDirOut = path.join(pluginLoc.cachePluginDir, 'skills');
  }

  bundleMeta.targetRoot = codexTargetRoot;
  bundleMeta.skillsDir = skillsDirOut;
  bundleMeta.agentsMdPath = agentsMdRes.agentsMdPath;
  if (pluginLoc) {
    bundleMeta.pluginId = pluginLoc.pluginId;
    bundleMeta.marketplaceDir = pluginLoc.marketplaceDir;
    bundleMeta.cachePluginDir = pluginLoc.cachePluginDir;
  }
  writeRealFileSync(path.join(bundleDir, 'host-bundle.json'), `${JSON.stringify(bundleMeta, null, 2)}\n`);

  if (scope === 'user') {
    materializeCodexPluginTrees({ bundleDir, codexTargetRoot, pluginJson, platform });
    mergeCodexConfigToml(path.join(codexTargetRoot, 'config.toml'), roleDescs, pluginLoc);
  }
  const configTomlPath = path.join(codexTargetRoot, 'config.toml');

  return {
    ok: true,
    exitCode: 0,
    host,
    scope,
    mode: bundleMeta.mode,
    codexVersion,
    bundleDir,
    targetRoot: codexTargetRoot,
    skillsDir: skillsDirOut,
    ...(hooksJsonOut ? { hooksJson: hooksJsonOut } : {}),
    ...(pluginLoc ? { pluginId: pluginLoc.pluginId, marketplaceDir: pluginLoc.marketplaceDir, cachePluginDir: pluginLoc.cachePluginDir } : {}),
    configTomlPath,
    agentsMdPath: agentsMdRes.agentsMdPath,
    agentsMdBytes: agentsMdRes.bytes,
    skillsCount: skillNames.length,
    agentsCount: ALL_ROLES.length,
    approvalNotice: 'Approve project/user hooks in Codex via /hooks on first session.',
    ...(warnings.length ? { warnings } : {}),
  };
}

function validateHooksConfig(hooksJsonPath, host, errors, { allowForeignHooks = false } = {}) {
  if (!fs.existsSync(hooksJsonPath)) { errors.push(`missing:${hooksJsonPath}`); return; }
  let parsed;
  try { parsed = readJsonStrict(hooksJsonPath); } catch { /* fail open: malformed JSON recorded in errors */ errors.push(`invalid_json:${hooksJsonPath}`); return; }
  if (!parsed || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
    errors.push(`missing_hooks_wrapper:${hooksJsonPath}`);
    return;
  }
  const required = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
  for (const ev of required) {
    if (!Array.isArray(parsed.hooks[ev]) || !parsed.hooks[ev].length) errors.push(`missing_hook_event:${ev}`);
  }
  const omagyMatchedEvents = new Set();
  for (const [ev, entries] of Object.entries(parsed.hooks)) {
    if (!allowForeignHooks && !SUPPORTED_HOOK_EVENTS.has(ev)) { errors.push(`unwired_hook_event:${ev}`); }
    if (!Array.isArray(entries)) { errors.push(`invalid_hook_event_array:${ev}`); continue; }
    for (let idx = 0; idx < entries.length; idx += 1) {
      const entry = entries[idx];
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks) || !entry.hooks.length) {
        errors.push(`invalid_hook_entry_schema:${ev}[${idx}]`);
        continue;
      }
      for (let hIdx = 0; hIdx < entry.hooks.length; hIdx += 1) {
        const h = entry.hooks[hIdx];
        if (!h || h.type !== 'command' || typeof h.command !== 'string' || !h.command.trim()) {
          errors.push(`invalid_hook_handler:${ev}[${idx}].hooks[${hIdx}]`);
          continue;
        }
        const isOmagyHandler = h.command.includes(`--host=${host}`) && /hooks[\/\\](?:run\.sh|omagy-hook\.mjs)/.test(h.command);
        if (isOmagyHandler) omagyMatchedEvents.add(ev);
        else if (!allowForeignHooks) errors.push(`missing_host_command_flag:${hooksJsonPath}:${ev}[${idx}]`);
      }
    }
  }
  if (allowForeignHooks) {
    for (const ev of required) {
      if (Array.isArray(parsed.hooks[ev]) && parsed.hooks[ev].length && !omagyMatchedEvents.has(ev)) {
        errors.push(`missing_host_command_flag:${hooksJsonPath}:${ev}`);
      }
    }
  }
}

function validateOpenAiYaml(ymlPath, skillName, errors) {
  if (!fs.existsSync(ymlPath)) { errors.push(`missing:skills/${skillName}/agents/openai.yaml`); return; }
  const raw = fs.readFileSync(ymlPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) { errors.push(`utf8_bom:skills/${skillName}/agents/openai.yaml`); return; }
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let section = '';
  const data = { interface: {}, policy: {} };
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!ln.trim() || /^\s*#/.test(ln)) continue;
    const secM = /^(interface|policy):\s*$/.exec(ln);
    if (secM) { section = secM[1]; continue; }
    const kvM = /^  ([a-z_]+):\s*(.+)$/.exec(ln);
    if (!kvM || !section) {
      errors.push(`invalid_openai_yaml_syntax:${skillName}:line${i + 1}`);
      return;
    }
    const val = kvM[2].trim();
    if (val.startsWith('[') && !val.endsWith(']')) {
      errors.push(`invalid_openai_yaml_syntax:${skillName}:line${i + 1}`);
      return;
    }
    data[section][kvM[1]] = unquoteScalar(val);
  }
  for (const k of ['display_name', 'short_description', 'default_prompt']) {
    if (!data.interface[k]) errors.push(`missing_openai_yaml_interface_${k}:${skillName}`);
  }
  const expectedImp = EXPLICIT_ONLY_SKILLS.has(skillName) ? 'false' : 'true';
  if (data.policy.allow_implicit_invocation !== expectedImp) {
    errors.push(`invalid_openai_yaml_policy:${skillName}`);
  }
}

function validateBasicTomlSyntax(rawText, label, errors) {
  if (rawText.charCodeAt(0) === 0xFEFF) { errors.push(`utf8_bom:${label}`); return false; }
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  let inMultiline = '';
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (inMultiline) {
      if (ln.includes(inMultiline)) inMultiline = '';
      continue;
    }
    const tr = ln.trim();
    if (!tr || tr.startsWith('#')) continue;
    if (parseTomlTableHeader(tr)) continue;
    const kv = /^(?:"[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(tr);
    if (!kv) { errors.push(`invalid_toml_syntax:${label}:line${i + 1}`); return false; }
    const val = kv[1].trim();
    if ((val.startsWith("'''") && !val.slice(3).includes("'''")) || (val.startsWith('"""') && !val.slice(3).includes('"""'))) {
      inMultiline = val.slice(0, 3);
    }
  }
  if (inMultiline) { errors.push(`unclosed_toml_multiline:${label}`); return false; }
  return true;
}

function validateCodexAgentToml(tomlPath, role, errors, labelPrefix) {
  if (!fs.existsSync(tomlPath)) { errors.push(`missing:${labelPrefix}/${role}.toml`); return; }
  const raw = fs.readFileSync(tomlPath, 'utf8');
  if (!validateBasicTomlSyntax(raw, `${labelPrefix}/${role}.toml`, errors)) return;
  const expectedSandbox = WRITE_ROLES.has(role) ? 'workspace-write' : 'read-only';
  const topLevelToml = raw.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, '""');
  const sandboxMatches = [...topLevelToml.matchAll(/^sandbox_mode\s*=\s*"([^"]*)"/gm)];
  if (sandboxMatches.length !== 1 || sandboxMatches[0][1] !== expectedSandbox) errors.push(`invalid_toml_sandbox:${labelPrefix}:${role}`);
  if (!new RegExp(`^name\\s*=\\s*"${role}"`, 'm').test(raw)) errors.push(`invalid_toml_name:${labelPrefix}:${role}`);
  if (!/^description\s*=\s*".+"/m.test(raw)) errors.push(`missing_toml_description:${labelPrefix}:${role}`);
  if (!/^developer_instructions\s*=\s*(?:'''|"""|")/m.test(raw)) errors.push(`missing_developer_instructions:${labelPrefix}:${role}`);
}

function extractTomlSectionBody(tomlText, sectionName) {
  const lines = String(tomlText || '').replace(/\r\n/g, '\n').split('\n');
  let active = false;
  const collected = [];
  for (const line of lines) {
    const hdr = parseTomlTableHeader(line);
    if (hdr) {
      if (active) break;
      if (!hdr.isArray && hdr.name === sectionName) active = true;
      continue;
    }
    if (active) collected.push(line);
  }
  return collected.join('\n');
}

function assertNoEscapingSymlinks(dirPath, rootDir, errors) {
  const realRoot = fs.realpathSync(rootDir);
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, ent.name);
    let st;
    try { st = fs.lstatSync(full); } catch { /* fail open: skip vanished entry */ continue; }
    if (st.isSymbolicLink()) {
      let realTgt = '';
      try { realTgt = fs.realpathSync(full); } catch { /* fail open: broken symlink */ }
      if (!realTgt || !(realTgt === realRoot || realTgt.startsWith(realRoot + path.sep))) {
        errors.push(`symlink_escapes_skill_dir:${path.relative(rootDir, full)}`);
      }
      continue;
    }
    if (st.isDirectory()) assertNoEscapingSymlinks(full, rootDir, errors);
  }
}

function checkSubtreeSymlinks(targetPath, label, allowedRoots, disallowSymlinks, errors, visited = new Set()) {
  let lst;
  try { lst = fs.lstatSync(targetPath); } catch { /* fail open: absent subtree reported by presence checks */ return; }
  if (lst.isSymbolicLink()) {
    if (disallowSymlinks) {
      errors.push(`symlink_disallowed_in_copy_mode:${label}`);
      return;
    }
    let realTgt = '';
    try { realTgt = fs.realpathSync(targetPath); } catch { /* fail open: broken symlink */ }
    if (!realTgt || !allowedRoots.some((r) => realTgt === r || realTgt.startsWith(r + path.sep))) {
      errors.push(`symlink_escapes_allowed_roots:${label}`);
    }
    return;
  }
  if (lst.isDirectory()) {
    const realDir = realpathOrResolved(targetPath);
    if (visited.has(realDir)) return;
    visited.add(realDir);
    for (const ent of fs.readdirSync(targetPath)) {
      if (ent === '.DS_Store' || ent === 'node_modules') continue;
      checkSubtreeSymlinks(path.join(targetPath, ent), `${label}/${ent}`, allowedRoots, disallowSymlinks, errors, visited);
    }
  }
}

function checkHostProseClean(filePath, label, errors) {
  if (!fs.existsSync(filePath)) return;
  const txt = fs.readFileSync(filePath, 'utf8');
  const m = HOST_PROSE_LEAK_RE.exec(txt);
  if (m) errors.push(`host_prose_leak:${label}:${m[0]}`);
}

function checkHostProseTree(dirPath, labelPrefix, errors) {
  if (!fs.existsSync(dirPath)) return;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, ent.name);
    if (ent.isDirectory()) checkHostProseTree(p, `${labelPrefix}/${ent.name}`, errors);
    else if (ent.isFile() && ent.name.endsWith('.md')) checkHostProseClean(p, `${labelPrefix}/${ent.name}`, errors);
  }
}

function checkManagedAgentsMdClean(agentsMdPath, errors) {
  if (!fs.existsSync(agentsMdPath)) return;
  const raw = fs.readFileSync(agentsMdPath, 'utf8');
  const bRe = new RegExp(`${escapeRegExp(CODEX_AGENTS_START)}([\\s\\S]*?)${escapeRegExp(CODEX_AGENTS_END)}`);
  const hit = bRe.exec(raw);
  const target = hit ? hit[1] : raw;
  const m = HOST_PROSE_LEAK_RE.exec(target);
  if (m) errors.push(`host_prose_leak:AGENTS.md:${m[0]}`);
}

function validateCodexSkillsTree(skillsDir, bundleSkillDirs, errors, labelPrefix) {
  let skillsLst = null;
  try { skillsLst = fs.lstatSync(skillsDir); } catch { /* fail open: missing skills dir recorded below */ }
  if (!skillsLst) { errors.push(`missing:${skillsDir}`); return; }
  if (skillsLst.isSymbolicLink() || !skillsLst.isDirectory()) { errors.push(`invalid_${labelPrefix}_dir:${skillsDir}`); return; }
  for (const sName of bundleSkillDirs) {
    const sTargetDir = path.join(skillsDir, sName);
    let stLst = null;
    try { stLst = fs.lstatSync(sTargetDir); } catch { /* fail open: missing skill recorded below */ }
    if (!stLst) { errors.push(`missing:${labelPrefix}/${sName}`); continue; }
    if (stLst.isSymbolicLink()) { errors.push(`symlink_not_allowed_in_${labelPrefix}:${sName}`); continue; }
    const skillMdPath = path.join(sTargetDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) errors.push(`missing:${labelPrefix}/${sName}/SKILL.md`);
    validateOpenAiYaml(path.join(sTargetDir, 'agents', 'openai.yaml'), sName, errors);
  }
}

/** Strictly validate generated Claude Code or Codex bundle and host configuration files. */
export function validateHostBundle(options = {}) {
  const host = String(options.host || '').trim().toLowerCase();
  if (!SUPPORTED_HOSTS.has(host)) return { ok: false, exitCode: 2, error: `unsupported_host:${host || '(empty)'}`, errors: [`unsupported_host:${host}`], warnings: [] };
  const explicitDir = options.bundleDir || options.dir;
  const bundleDir = path.resolve(explicitDir || resolveDefaultBundleDir(host, options));
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(bundleDir)) return { ok: false, exitCode: 1, host, bundleDir, errors: [`missing_bundle_dir:${bundleDir}`], warnings };

  const bundleMetaPath = path.join(bundleDir, 'host-bundle.json');
  let meta = null;
  if (!fs.existsSync(bundleMetaPath)) errors.push('missing:host-bundle.json');
  else {
    try { meta = readJsonStrict(bundleMetaPath); } catch { /* fail open: invalid json recorded */ errors.push('invalid_json:host-bundle.json'); }
  }
  if (meta && meta.host !== host) errors.push(`host_mismatch:${meta.host}!=${host}`);

  const disallowSymlinks = meta?.mode === 'copy';
  const realBundle = realpathOrResolved(bundleDir);
  const expectedPlugin = options.pluginRoot ? realpathOrResolved(options.pluginRoot) : '';
  const metaPlugin = meta?.pluginRoot ? realpathOrResolved(meta.pluginRoot) : '';
  if (!disallowSymlinks && expectedPlugin && metaPlugin && expectedPlugin !== realBundle && metaPlugin !== expectedPlugin) {
    errors.push(`plugin_root_mismatch:${meta.pluginRoot}`);
  }
  const allowedSourceRoot = disallowSymlinks ? '' : (expectedPlugin || meta?.pluginRoot || '');
  const allowedRoots = [bundleDir, ...(allowedSourceRoot ? [allowedSourceRoot] : [])]
    .map((p) => { try { return fs.realpathSync(p); } catch { /* fail open: unreadable root */ return ''; } })
    .filter(Boolean);

  const hooksDir = path.join(bundleDir, 'hooks');
  try {
    if (fs.lstatSync(hooksDir).isSymbolicLink()) errors.push('hooks_dir_must_not_be_symlink');
  } catch { /* fail open: missing hooks dir recorded */ errors.push('missing:hooks'); }
  validateHooksConfig(path.join(hooksDir, 'hooks.json'), host, errors);

  for (const rel of [
    'hooks/run.sh', 'hooks/omagy-hook.mjs', 'hooks/omagy-host.mjs',
    'hooks/omagy-cli.mjs', 'hooks/omagy-skill.mjs', 'hooks/omagy-audit.mjs',
    'sidecars/hud/run.sh', 'sidecars/hud/main.mjs', 'sidecars/hud/dispatch.mjs',
  ]) {
    try {
      if (!fs.statSync(path.join(bundleDir, rel)).isFile()) errors.push(`not_a_file:${rel}`);
    } catch { /* fail open: missing or broken entry script */
      errors.push(`missing_or_broken_entry:${rel}`);
    }
  }
  for (const sub of ['hooks', 'sidecars', 'assets', 'rules', 'agents']) {
    checkSubtreeSymlinks(path.join(bundleDir, sub), sub, allowedRoots, disallowSymlinks, errors);
  }
  if (fs.existsSync(path.join(bundleDir, 'assets', 'sidecar-hud.gif'))) errors.push('unexpected_large_asset:sidecar-hud.gif');
  checkHostProseClean(path.join(bundleDir, 'rules', 'AGENTS.md'), 'rules/AGENTS.md', errors);

  const skillsDir = path.join(bundleDir, 'skills');
  const bundleSkillDirs = [];
  let skillsLst = null;
  try { skillsLst = fs.lstatSync(skillsDir); } catch { /* fail open: missing skills dir recorded below */ }
  if (!skillsLst) errors.push('missing:skills');
  else if (skillsLst.isSymbolicLink()) errors.push('skills_dir_must_not_be_symlink');
  else if (!skillsLst.isDirectory()) errors.push('invalid:skills_not_directory');
  else {
    for (const entName of fs.readdirSync(skillsDir).sort()) {
      if (entName === '.DS_Store') continue;
      const p = path.join(skillsDir, entName);
      let lst;
      try { lst = fs.lstatSync(p); } catch { /* fail open: vanished skill entry */ continue; }
      if (lst.isSymbolicLink()) {
        errors.push(`symlink_not_allowed_in_skills:${entName}`);
        continue;
      }
      if (lst.isDirectory()) bundleSkillDirs.push(entName);
    }
    if (bundleSkillDirs.length !== 23) errors.push(`unexpected_skill_count:${bundleSkillDirs.length}!=23`);
    for (const sName of bundleSkillDirs) {
      const sDir = path.join(skillsDir, sName);
      assertNoEscapingSymlinks(sDir, sDir, errors);
      const sPath = path.join(sDir, 'SKILL.md');
      if (!fs.existsSync(sPath)) { errors.push(`missing:skills/${sName}/SKILL.md`); continue; }
      const rawMd = fs.readFileSync(sPath, 'utf8');
      if (Buffer.byteLength(rawMd, 'utf8') > 19_000) errors.push(`skill_exceeds_19000:${sName}`);
      const fm = parseClaudeFrontmatterYaml(rawMd, { requiredKeys: ['name', 'description'] });
      if (!fm.ok) errors.push(`skill_frontmatter:${sName}:${fm.errors.join(',')}`);
      if (String(fm.fields.description || '').includes('->')) errors.push(`skill_arrow_in_description:${sName}`);
      checkHostProseClean(sPath, `skills/${sName}/SKILL.md`, errors);
      checkHostProseTree(path.join(sDir, 'references'), `skills/${sName}/references`, errors);
      if (host === 'codex') {
        const ymlPath = path.join(sDir, 'agents', 'openai.yaml');
        validateOpenAiYaml(ymlPath, sName, errors);
        checkHostProseClean(ymlPath, `skills/${sName}/agents/openai.yaml`, errors);
      }
    }
  }

  const workspace = options.workspace ? path.resolve(options.workspace) : '';
  const effScope = options.scope ? String(options.scope).trim().toLowerCase() : (meta?.scope || (workspace ? 'project' : 'user'));
  const strict = Boolean(options.strict);

  if (host === 'claude') {
    if (!fs.existsSync(path.join(bundleDir, '.claude-plugin', 'plugin.json'))) errors.push('missing:.claude-plugin/plugin.json');
    for (const role of ALL_ROLES) {
      const ap = path.join(bundleDir, 'agents', `${role}.md`);
      if (!fs.existsSync(ap)) { errors.push(`missing:agents/${role}.md`); continue; }
      checkHostProseClean(ap, `bundle/agents/${role}.md`, errors);
      const fm = parseClaudeFrontmatterYaml(fs.readFileSync(ap, 'utf8'), {
        requiredKeys: ['name', 'description', 'tools', 'disallowedTools'],
        disallowedKeys: ['subagent', 'mainAgent'],
        arrayKeys: ['tools', 'disallowedTools'],
      });
      if (!fm.ok) { errors.push(`agent_frontmatter:${role}:${fm.errors.join(',')}`); continue; }
      const spec = CLAUDE_ROLE_TOOLS[getRoleTier(role)];
      if (JSON.stringify(fm.fields.tools) !== JSON.stringify(spec.tools)) errors.push(`agent_tools_tier_mismatch:${role}`);
      if (JSON.stringify(fm.fields.disallowedTools) !== JSON.stringify(spec.disallowedTools)) errors.push(`agent_disallowed_mismatch:${role}`);
      if (!Array.isArray(fm.fields.disallowedTools) || !fm.fields.disallowedTools.includes('Agent')) errors.push(`agent_must_disallow_Agent:${role}`);
      if (WRITE_ROLES.has(role) && fm.fields.isolation !== 'worktree') errors.push(`write_agent_missing_worktree_isolation:${role}`);
      if (!WRITE_ROLES.has(role) && fm.fields.isolation) errors.push(`read_agent_unexpected_isolation:${role}`);
    }
    const claudeTarget = effScope === 'user' && (options.configRoot || options.homeDir)
      ? resolveHostTargetContext('claude', options).claudeTargetRoot
      : (effScope === 'project' && workspace ? path.join(workspace, '.claude') : (meta?.targetRoot || (options.configRoot ? path.resolve(options.configRoot) : (!explicitDir ? resolveHostTargetContext('claude', options).claudeTargetRoot : ''))));
    const claudeRulePath = claudeTarget ? path.join(claudeTarget, 'rules', 'oh-my-agy.md') : '';
    if (claudeTarget && !fs.existsSync(claudeRulePath)) {
      errors.push(`missing_claude_rules:${claudeRulePath}`);
    } else if (claudeRulePath) {
      checkHostProseClean(claudeRulePath, 'claude/rules/oh-my-agy.md', errors);
    }
    if (workspace) {
      const lp = path.join(workspace, '.claude', 'launch.json');
      if (!fs.existsSync(lp)) errors.push('missing:.claude/launch.json');
      else {
        try {
          const ldoc = readJsonStrict(lp);
          const hudCfg = Array.isArray(ldoc?.configurations) ? ldoc.configurations.find((c) => c && c.name === 'oh-my-agy-hud') : null;
          if (!hudCfg) errors.push('missing_launch_hud_entry');
          else {
            const expectedExec = options.platform ? (options.platform === 'win32' ? 'node' : 'sh') : null;
            if (expectedExec ? hudCfg.runtimeExecutable !== expectedExec : (hudCfg.runtimeExecutable !== 'sh' && hudCfg.runtimeExecutable !== 'node')) {
              errors.push('invalid_launch_runtimeExecutable');
            }
            if (!Array.isArray(hudCfg.runtimeArgs) || !hudCfg.runtimeArgs.includes('desktop-serve')) errors.push('invalid_launch_runtimeArgs');
            if (!Number.isInteger(hudCfg.port) || hudCfg.port < 48800 || hudCfg.port > 49799) errors.push(`invalid_launch_port:${hudCfg.port}`);
          }
        } catch { /* fail open: malformed launch.json recorded */ errors.push('invalid_json:.claude/launch.json'); }
      }
    }
  } else {
    const codexPluginPath = path.join(bundleDir, '.codex-plugin', 'plugin.json');
    let bundlePluginManifest = null;
    if (!fs.existsSync(codexPluginPath)) errors.push('missing:.codex-plugin/plugin.json');
    else {
      try {
        bundlePluginManifest = readJsonStrict(codexPluginPath);
        if (!bundlePluginManifest.hooks || !bundlePluginManifest.skills) errors.push('invalid_codex_plugin_paths');
        const iface = bundlePluginManifest.interface || {};
        if (!iface.displayName || !iface.logo) errors.push('missing_codex_plugin_interface');
        const shortDesc = typeof iface.shortDescription === 'string' ? iface.shortDescription : '';
        if (!shortDesc || shortDesc.length > 30 || /[\r\n]/.test(shortDesc)) errors.push('invalid_codex_plugin_short_description');
        if (typeof iface.supportURL !== 'string' || !iface.supportURL.trim()) errors.push('missing_codex_plugin_support_url');
      } catch { /* fail open: malformed plugin manifest recorded */ errors.push('invalid_json:.codex-plugin/plugin.json'); }
    }
    if (!fs.existsSync(path.join(bundleDir, 'plugin.json'))) errors.push('missing:plugin.json');
    if (!fs.existsSync(path.join(bundleDir, 'assets', 'logo.png'))) errors.push('missing:assets/logo.png');
    if (!meta?.codexVersion || !parseCodexVersion(meta.codexVersion)) errors.push('missing_or_invalid:codexVersion');
    for (const role of ALL_ROLES) {
      const bToml = path.join(bundleDir, 'agents', `${role}.toml`);
      const bMd = path.join(bundleDir, 'agents', `${role}.md`);
      validateCodexAgentToml(bToml, role, errors, 'bundle/agents');
      checkHostProseClean(bToml, `bundle/agents/${role}.toml`, errors);
      if (!fs.existsSync(bMd)) errors.push(`missing:bundle/agents/${role}.md`);
      else checkHostProseClean(bMd, `bundle/agents/${role}.md`, errors);
    }
    const codexTarget = effScope === 'user' && (options.codexHome || options.homeDir)
      ? resolveHostTargetContext('codex', options).codexTargetRoot
      : (effScope === 'project' && workspace ? path.join(workspace, '.codex') : (meta?.targetRoot || (!explicitDir ? resolveHostTargetContext('codex', options).codexTargetRoot : '')));
    if (codexTarget) {
      if (effScope === 'project') {
        validateHooksConfig(path.join(codexTarget, 'hooks.json'), 'codex', errors, { allowForeignHooks: true });
        validateCodexSkillsTree(path.join(codexTarget, 'skills'), bundleSkillDirs, errors, 'target/skills');
      } else {
        const userHooksPath = path.join(codexTarget, 'hooks.json');
        if (fs.existsSync(userHooksPath)) {
          try {
            const uhDoc = readExistingHooksJsonStrict(userHooksPath);
            if (Object.values(uhDoc.hooks || {}).some((arr) => Array.isArray(arr) && arr.some(isOmagyHookEntry))) {
              errors.push('duplicate_omagy_user_hooks_json');
            }
          } catch { /* fail open: invalid foreign hooks.json recorded */ errors.push(`invalid_json:${userHooksPath}`); }
        }
        for (const sName of bundleSkillDirs) {
          const dupSkillPath = path.join(codexTarget, 'skills', sName);
          if (isOmagyOwnedCodexSkill(dupSkillPath)) errors.push(`duplicate_omagy_user_skill:${sName}`);
        }
        const pluginStub = {
          name: bundlePluginManifest?.name || meta?.pluginName || 'oh-my-agy',
          version: bundlePluginManifest?.version || meta?.version || '0.7.0',
        };
        const loc = getCodexPluginLocations(codexTarget, pluginStub);
        const mktJsonPath = path.join(loc.mktAgentsDir, 'marketplace.json');
        if (!fs.existsSync(mktJsonPath)) errors.push(`missing:${mktJsonPath}`);
        else {
          try {
            const mktDoc = readJsonStrict(mktJsonPath);
            if (!Array.isArray(mktDoc.plugins) || !mktDoc.plugins.some((p) => p && p.name === pluginStub.name)) {
              errors.push('marketplace_missing_plugin_entry');
            }
          } catch { /* fail open: malformed marketplace.json recorded */ errors.push(`invalid_json:${mktJsonPath}`); }
        }
        if (!fs.existsSync(path.join(loc.mktPluginDir, '.codex-plugin', 'plugin.json'))) {
          errors.push(`missing:${path.join(loc.mktPluginDir, '.codex-plugin', 'plugin.json')}`);
        }
        if (!fs.existsSync(loc.cachePluginDir)) {
          errors.push(`missing:${loc.cachePluginDir}`);
        } else {
          checkSubtreeSymlinks(loc.cachePluginDir, 'codex_cache', [], true, errors);
          if (!fs.existsSync(path.join(loc.cachePluginDir, '.codex-plugin', 'plugin.json'))) errors.push('missing:cache/.codex-plugin/plugin.json');
          if (!fs.existsSync(path.join(loc.cachePluginDir, 'assets', 'logo.png'))) errors.push('missing:cache/assets/logo.png');
          validateHooksConfig(path.join(loc.cachePluginDir, 'hooks', 'hooks.json'), 'codex', errors);
          validateCodexSkillsTree(path.join(loc.cachePluginDir, 'skills'), bundleSkillDirs, errors, 'cache/skills');
        }
      }
      for (const role of ALL_ROLES) {
        const tToml = path.join(codexTarget, 'agents', `${role}.toml`);
        validateCodexAgentToml(tToml, role, errors, 'target/agents');
        checkHostProseClean(tToml, `target/agents/${role}.toml`, errors);
      }
      const cfgPath = path.join(codexTarget, 'config.toml');
      if (!fs.existsSync(cfgPath)) errors.push(`missing:${cfgPath}`);
      else {
        const cfg = fs.readFileSync(cfgPath, 'utf8');
        validateBasicTomlSyntax(cfg, 'config.toml', errors);
        const agentsSectionBody = extractTomlSectionBody(cfg, 'agents');
        if (!/^\s*enabled\s*=\s*true\b/m.test(agentsSectionBody)) errors.push('config_missing_agents_enabled');
        const featuresBody = extractTomlSectionBody(cfg, 'features');
        if (!/^\s*hooks\s*=\s*true\b/m.test(featuresBody)) errors.push('config_missing_features_hooks');
        if (/^\s*multi_agent\s*=/m.test(featuresBody)) errors.push('config_deprecated_features_multi_agent');
        for (const role of ALL_ROLES) {
          const agentBody = extractTomlSectionBody(cfg, `agents.${role}`);
          if (!agentBody.includes(`agents/${role}.toml`)) errors.push(`config_missing_agent:${role}`);
        }
        if (effScope === 'user') {
          const mktBody = extractTomlSectionBody(cfg, 'marketplaces.oh-my-agy-local');
          if (!/^\s*source_type\s*=\s*"local"\s*(?:#.*)?$/m.test(mktBody) || !/^\s*source\s*=\s*"/m.test(mktBody)) {
            errors.push('config_missing_marketplace_oh_my_agy_local');
          }
          const plugBody = extractTomlSectionBody(cfg, 'plugins."oh-my-agy@oh-my-agy-local"');
          if (!/^\s*enabled\s*=\s*true\b/m.test(plugBody)) errors.push('config_missing_enabled_plugin');
        }
      }
      const agentsMdPath = (effScope === 'project' && workspace)
        ? path.join(workspace, 'AGENTS.md')
        : (meta?.agentsMdPath || path.join(codexTarget, 'AGENTS.md'));
      if (!fs.existsSync(agentsMdPath)) errors.push(`missing_agents_md:${agentsMdPath}`);
      else {
        if (fs.statSync(agentsMdPath).size > CODEX_AGENTS_MAX_BYTES) errors.push(`agents_md_too_large:${agentsMdPath}`);
        checkManagedAgentsMdClean(agentsMdPath, errors);
      }
    }
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, exitCode: ok ? 0 : 1, host, bundleDir, errors, warnings };
}

function parseHostCliArgs(rawArgs = [], maxPositional = 2) {
  const opts = { json: false, strict: false, copy: false, copyFlag: false, symlink: false, dryRun: false, help: false, pos: [], parseError: '' };
  let afterDoubleDash = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const a = String(rawArgs[i] || '');
    if (!afterDoubleDash && a === '--') { afterDoubleDash = true; continue; }
    const takeVal = (flag) => {
      if (i + 1 >= rawArgs.length || String(rawArgs[i + 1]).startsWith('-')) {
        opts.parseError = `missing_flag_value:${flag}`;
        return '';
      }
      const v = rawArgs[i + 1];
      i += 1;
      return v;
    };
    if (!afterDoubleDash && a.startsWith('-')) {
      if (a === '--help' || a === '-h') opts.help = true;
      else if (a === '--json') opts.json = true;
      else if (a === '--strict') opts.strict = true;
      else if (a === '--copy') { opts.copy = true; opts.copyFlag = true; }
      else if (a === '--symlink') opts.symlink = true;
      else if (a === '--dry-run') opts.dryRun = true;
      else if (a.startsWith('--scope=')) opts.scope = a.slice(8);
      else if (a === '--scope') opts.scope = takeVal('--scope');
      else if (a.startsWith('--dir=')) opts.dir = a.slice(6);
      else if (a === '--dir') opts.dir = takeVal('--dir');
      else if (a.startsWith('--workspace=')) opts.workspace = a.slice(12);
      else if (a === '--workspace') opts.workspace = takeVal('--workspace');
      else if (a.startsWith('--codex-home=')) opts.codexHome = a.slice(13);
      else if (a === '--codex-home') opts.codexHome = takeVal('--codex-home');
      else if (a.startsWith('--config-root=')) opts.configRoot = a.slice(14);
      else if (a === '--config-root') opts.configRoot = takeVal('--config-root');
      else opts.parseError = `unknown_flag:${a}`;
      if (opts.parseError) return opts;
      continue;
    }
    opts.pos.push(a);
    if (opts.pos.length > maxPositional) {
      opts.parseError = `unexpected_argument:${a}`;
      return opts;
    }
  }
  if (opts.copyFlag && opts.symlink) opts.parseError = 'conflicting_flags:--copy,--symlink';
  return opts;
}

function hostUsageText(event) {
  if (event === 'host-validate') {
    return [
      'Usage: sh hooks/run.sh host-validate <claude|codex> [bundleDir] [options]',
      '',
      'Options:',
      '  --dir <path>          Bundle directory to validate',
      '  --scope <user|project> Bundle scope (codex/claude)',
      '  --workspace <path>    Project workspace directory',
      '  --codex-home <path>   Override Codex home root',
      '  --config-root <path>  Override Claude config root',
      '  --strict              Treat warnings as errors',
      '  --json                Output structured JSON',
      '  -h, --help            Show this help message',
    ].join('\n');
  }
  return [
    'Usage: sh hooks/run.sh host-setup <claude|codex> [options]',
    '',
    'Options:',
    '  --dir <path>          Output bundle directory',
    '  --scope <user|project> Installation scope',
    '  --workspace <path>    Project workspace directory',
    '  --codex-home <path>   Override Codex home root',
    '  --config-root <path>  Override Claude config root',
    '  --copy | --symlink    Copy or symlink skills into bundle',
    '  --dry-run             Preview setup without writing files',
    '  --strict              Strict validation mode',
    '  --json                Output structured JSON',
    '  -h, --help            Show this help message',
  ].join('\n');
}

/** CLI dispatcher for `host-setup` and `host-validate`. */
export async function runHostSetupCli(event, rawArgs, pluginRoot) {
  const maxPos = event === 'host-validate' ? 2 : 1;
  const opts = parseHostCliArgs(rawArgs, maxPos);
  if (opts.help) {
    process.stdout.write(`${hostUsageText(event)}\n`);
    return 0;
  }
  let res;
  if (opts.parseError) {
    res = { ok: false, exitCode: 2, error: opts.parseError };
  } else {
    try {
      const host = opts.pos[0] || '';
      res = event === 'host-setup'
        ? setupHostBundle({ ...opts, host, pluginRoot })
        : validateHostBundle({ ...opts, host, pluginRoot, bundleDir: opts.dir || opts.pos[1] || '' });
    } catch (err) { /* fail open: convert unexpected CLI exception into structured JSON failure */
      res = { ok: false, exitCode: 2, error: err instanceof Error ? err.message : String(err) };
    }
  }
  process.stdout.write(`${JSON.stringify(res, null, opts.json ? 2 : 0)}\n`);
  return Number.isInteger(res.exitCode) ? res.exitCode : 2;
}
