#!/usr/bin/env node
// Strictly read-only, zero-dependency stdio JSON-RPC 2.0 MCP server for oh-my-agy state & deterministic tools.
// Exposes ONLY 6 read-only, zero-shell, zero-mutation tools wrapping existing hook/CLI exports.
// Zero external npm dependencies (Node.js >= 18 built-in modules only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeStates,
  buildCodebaseMap,
  canonicalizePath,
  discoverOmagyScopes,
  hasSymlinkSegment,
  isAwaitingConfirmation,
  loadModeStates,
  sameModulePath,
  stateRoot,
  stripUtf8Bom,
  validateCompletionEvidence,
} from '../hooks/omagy-hook.mjs';
import {
  lintWikiPages,
  queryWikiPages,
  verifyPlanHash,
} from '../hooks/omagy-cli.mjs';

// Redirect stdout-writing console methods to stderr so zero stray non-JSON bytes ever pollute stdio framing.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

const SERVER_INFO = Object.freeze({
  name: 'oh-my-agy-state',
  version: '0.9.1',
});

const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isFile(p) {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isWithinDir(rootReal, candidateReal) {
  const r = process.platform === 'win32' ? rootReal.toLowerCase() : rootReal;
  const c = process.platform === 'win32' ? candidateReal.toLowerCase() : candidateReal;
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : `${r}${path.sep}`;
  return c.startsWith(prefix);
}

function resolveWorkspaceDir(rawWorkspace, { required = false } = {}) {
  if (rawWorkspace === undefined || rawWorkspace === null || rawWorkspace === '') {
    if (required) throw new RpcError(-32602, 'workspace is required and must be a non-empty directory path');
    return canonicalizePath(process.cwd());
  }
  if (typeof rawWorkspace !== 'string' || !rawWorkspace.trim() || rawWorkspace.includes('\0')) {
    throw new RpcError(-32602, 'workspace must be a valid directory path string');
  }
  const canon = canonicalizePath(rawWorkspace.trim());
  let st;
  try {
    st = fs.statSync(canon);
  } catch {
    throw new RpcError(-32602, `workspace directory does not exist: ${rawWorkspace.trim()}`);
  }
  if (!st.isDirectory()) {
    throw new RpcError(-32602, `workspace path is not a directory: ${rawWorkspace.trim()}`);
  }
  return canon;
}

function resolveContainedPath(wsReal, rawInput, fieldName, baseDir = wsReal) {
  if (typeof rawInput !== 'string' || !rawInput.trim() || rawInput.includes('\0')) {
    throw new RpcError(-32602, `${fieldName} must be a non-empty path string`);
  }
  const trimmed = rawInput.trim();
  const rawTarget = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(baseDir, trimmed);
  if (!path.isAbsolute(trimmed)) {
    const relLex = path.relative(wsReal, rawTarget);
    if (relLex === '..' || relLex.startsWith(`..${path.sep}`) || path.isAbsolute(relLex)) {
      throw new RpcError(-32602, `${fieldName} escapes workspace via path traversal`);
    }
  }
  const canonTarget = canonicalizePath(rawTarget);
  if (!isWithinDir(wsReal, canonTarget)) {
    throw new RpcError(-32602, `${fieldName} resolves outside workspace`);
  }
  try {
    if (fs.existsSync(rawTarget)) {
      const realTarget = (fs.realpathSync.native || fs.realpathSync)(rawTarget);
      if (!isWithinDir(wsReal, realTarget)) {
        throw new RpcError(-32602, `${fieldName} symlink resolves outside workspace`);
      }
    } else if (fs.lstatSync(rawTarget).isSymbolicLink()) {
      const linkDest = path.resolve(path.dirname(rawTarget), fs.readlinkSync(rawTarget));
      if (!isWithinDir(wsReal, canonicalizePath(linkDest))) {
        throw new RpcError(-32602, `${fieldName} symlink escapes workspace`);
      }
    }
  } catch (err) {
    if (err instanceof RpcError) throw err;
    if (err && err.code === 'ELOOP') {
      throw new RpcError(-32602, `${fieldName} contains a symlink loop`);
    }
  }
  return canonTarget;
}

function summarizeModeState(s) {
  return {
    mode: s.mode,
    active: Boolean(s.data?.active === true),
    phase: String(s.data?.current_phase || ''),
    iteration: s.data?.iteration ?? null,
    scope: s.scope || '.',
    owner: s.owner || '',
    foreignOwner: Boolean(s.foreignOwner),
    awaitingConfirmation: isAwaitingConfirmation(s),
    updatedAt: s.data?.updated_at || null,
    file: s.file,
  };
}

function handleStatus(args) {
  const ws = resolveWorkspaceDir(args.workspace);
  if (args.conversationId !== undefined && typeof args.conversationId !== 'string') {
    throw new RpcError(-32602, 'conversationId must be a string');
  }
  const convId = typeof args.conversationId === 'string' ? args.conversationId.trim() : '';
  const sRoot = stateRoot(ws);
  const scopes = discoverOmagyScopes(sRoot);
  const allModes = loadModeStates(ws, convId).map(summarizeModeState);
  const activeModes = activeStates([ws], null, convId).map(summarizeModeState);
  return {
    root: ws,
    stateRoot: sRoot,
    scopes,
    activeModes,
    allModes,
  };
}

function handleWikiQuery(args) {
  const ws = resolveWorkspaceDir(args.workspace);
  if (typeof args.query !== 'string' || !args.query.trim()) {
    throw new RpcError(-32602, 'query must be a non-empty string');
  }
  let limit = null;
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
      throw new RpcError(-32602, 'limit must be an integer between 1 and 100');
    }
    limit = args.limit;
  }
  const wikiDir = resolveContainedPath(ws, 'omagy_wiki', 'omagy_wiki');
  const res = queryWikiPages(wikiDir, args.query.trim());
  if (limit !== null && Array.isArray(res.results)) {
    return {
      ...res,
      totalResults: res.results.length,
      results: res.results.slice(0, limit),
    };
  }
  return res;
}

function handleWikiLint(args) {
  const ws = resolveWorkspaceDir(args.workspace);
  const wikiDir = resolveContainedPath(ws, 'omagy_wiki', 'omagy_wiki');
  return lintWikiPages(wikiDir, ws);
}

function validateReceiptRelativeField(wsReal, absPlan, rawVal, fieldName) {
  const trimmed = String(rawVal || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('\0')) {
    throw new RpcError(-32602, `${fieldName} contains invalid null byte`);
  }
  const planDir = path.dirname(absPlan);
  const candWs = resolveContainedPath(wsReal, trimmed, fieldName, wsReal);
  const candPlanDir = resolveContainedPath(wsReal, trimmed, fieldName, planDir);
  if (isFile(candWs)) return candWs;
  if (isFile(candPlanDir)) return candPlanDir;
  // Guard against verifyPlanHash's `path.resolve(planDir, '..', '..')` fallback escaping workspace.
  const up2Base = path.resolve(planDir, '..', '..');
  const candUp2 = path.resolve(up2Base, trimmed);
  if (!isWithinDir(wsReal, canonicalizePath(candUp2)) && fs.existsSync(candUp2)) {
    throw new RpcError(-32602, `${fieldName} resolves outside workspace`);
  }
  return '';
}

function handlePlanHash(args) {
  const ws = resolveWorkspaceDir(args.workspace, { required: true });
  const mode = args.mode === undefined ? 'compute' : String(args.mode).trim().toLowerCase();
  if (mode !== 'compute' && mode !== 'verify') {
    throw new RpcError(-32602, "mode must be 'compute' or 'verify'");
  }
  const absPlan = resolveContainedPath(ws, args.prdFile, 'prdFile');
  let absSpec = args.specFile !== undefined && args.specFile !== ''
    ? resolveContainedPath(ws, args.specFile, 'specFile')
    : '';
  let absSourceSpec = args.sourceSpecFile !== undefined && args.sourceSpecFile !== ''
    ? resolveContainedPath(ws, args.sourceSpecFile, 'sourceSpecFile')
    : '';

  const absReceipt = args.receiptFile !== undefined && args.receiptFile !== ''
    ? resolveContainedPath(ws, args.receiptFile, 'receiptFile')
    : '';

  if (mode === 'compute') {
    // Strictly read-only: pass empty receiptPath and omit verdict so verifyPlanHash never writes files.
    return verifyPlanHash('compute', absPlan, '', {
      specPath: absSpec,
      sourceSpecPath: absSourceSpec,
      baseDir: ws,
    });
  }

  if (!absReceipt) {
    throw new RpcError(-32602, 'receiptFile is required when mode is verify');
  }
  if (isFile(absReceipt)) {
    let rec = null;
    try {
      rec = JSON.parse(stripUtf8Bom(fs.readFileSync(absReceipt, 'utf8')));
    } catch {
      // Let verifyPlanHash return its standard invalid_receipt_json result.
      rec = null;
    }
    if (isPlainObject(rec)) {
      if (typeof rec.prd_file === 'string' && rec.prd_file.trim()) {
        validateReceiptRelativeField(ws, absPlan, rec.prd_file, 'receipt.prd_file');
      }
      if (typeof rec.test_spec_file === 'string' && rec.test_spec_file.trim()) {
        const resolvedSpec = validateReceiptRelativeField(ws, absPlan, rec.test_spec_file, 'receipt.test_spec_file');
        if (!absSpec && resolvedSpec) absSpec = resolvedSpec;
      }
      if (typeof rec.source_spec_file === 'string' && rec.source_spec_file.trim()) {
        const resolvedSourceSpec = validateReceiptRelativeField(ws, absPlan, rec.source_spec_file, 'receipt.source_spec_file');
        if (!absSourceSpec && resolvedSourceSpec) absSourceSpec = resolvedSourceSpec;
      }
    }
  }
  return verifyPlanHash('verify', absPlan, absReceipt, {
    specPath: absSpec,
    sourceSpecPath: absSourceSpec,
    baseDir: ws,
  });
}

function handleCodebaseMap(args) {
  const ws = resolveWorkspaceDir(args.workspace);
  const map = buildCodebaseMap([ws]);
  return {
    root: ws,
    map,
    chars: map.length,
  };
}

function handleVerifyEvidence(args) {
  const ws = resolveWorkspaceDir(args.workspace, { required: true });
  if (typeof args.file !== 'string' || !args.file.trim() || args.file.includes('\0')) {
    throw new RpcError(-32602, 'file must be a non-empty path string');
  }
  if (args.team !== undefined && typeof args.team !== 'string') {
    throw new RpcError(-32602, 'team must be a string');
  }
  if (args.taskId !== undefined && typeof args.taskId !== 'string') {
    throw new RpcError(-32602, 'taskId must be a string');
  }
  const rawFile = args.file.trim();
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(rawFile)) {
    throw new RpcError(-32602, 'file escapes workspace via path traversal');
  }
  const evidenceBase = path.join(ws, '.omagy', 'evidence');
  let relForValidator;
  if (path.isAbsolute(rawFile)) {
    const canon = resolveContainedPath(ws, rawFile, 'file');
    if (!isWithinDir(evidenceBase, canon) || canon === evidenceBase) {
      throw new RpcError(-32602, 'file must reside inside .omagy/evidence/');
    }
    relForValidator = path.relative(ws, canon);
  } else {
    const normRel = rawFile.replace(/^\.[\\/]/, '');
    const startsWithOmagy = /^\.omagy(?:[/\\]|$)/.test(normRel);
    const candidateRel = startsWithOmagy ? normRel : path.join('.omagy', 'evidence', normRel);
    const canon = resolveContainedPath(ws, candidateRel, 'file');
    if (!isWithinDir(evidenceBase, canon) || canon === evidenceBase) {
      throw new RpcError(-32602, 'file must reside inside .omagy/evidence/');
    }
    const rawTarget = path.resolve(ws, candidateRel);
    if (hasSymlinkSegment(ws, rawTarget)) {
      throw new RpcError(-32602, 'file path must not contain symlinks');
    }
    relForValidator = candidateRel;
  }
  try {
    return validateCompletionEvidence(ws, relForValidator, {
      team: args.team,
      taskId: args.taskId,
    });
  } catch (err) {
    return {
      _toolError: true,
      data: {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
});

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'omagy_status',
    description: 'Inspect active and recorded oh-my-agy workflow modes and .omagy/ scopes for a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory (defaults to current working directory).' },
        conversationId: { type: 'string', description: 'Optional conversation ID to prioritize session-scoped state.' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'omagy_wiki_query',
    description: 'Search omagy_wiki/ markdown pages by keyword/tag and return ranked matches.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory (defaults to current working directory).' },
        query: { type: 'string', description: 'Search query terms.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Optional max number of matches to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'omagy_wiki_lint',
    description: 'Lint omagy_wiki/ pages for broken [[slug]] links, dead file:line refs, and isolated pages.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory (defaults to current working directory).' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'omagy_plan_hash',
    description: 'Read-only SHA-256 plan hash computation or receipt verification with strict workspace path containment.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory.' },
        mode: { type: 'string', enum: ['compute', 'verify'], description: "Operation mode: 'compute' (read-only) or 'verify'." },
        prdFile: { type: 'string', description: 'Path to PRD file inside workspace.' },
        specFile: { type: 'string', description: 'Optional path to paired test-spec file inside workspace.' },
        sourceSpecFile: { type: 'string', description: 'Optional path to upstream source spec file inside workspace.' },
        receiptFile: { type: 'string', description: 'Path to review receipt JSON inside workspace (required for verify mode).' },
      },
      required: ['workspace', 'prdFile'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'omagy_codebase_map',
    description: 'Build a bounded shared-first exported symbol map for a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory (defaults to current working directory).' },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'omagy_verify_evidence',
    description: 'Validate a task completion evidence JSON file under .omagy/evidence/ with strict workspace containment.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace root directory.' },
        file: { type: 'string', description: 'Evidence JSON path inside .omagy/evidence/.' },
        team: { type: 'string', description: 'Optional expected team name.' },
        taskId: { type: 'string', description: 'Optional expected task ID.' },
      },
      required: ['workspace', 'file'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
  },
]);

const TOOL_HANDLERS = Object.freeze({
  omagy_status: handleStatus,
  omagy_wiki_query: handleWikiQuery,
  omagy_wiki_lint: handleWikiLint,
  omagy_plan_hash: handlePlanHash,
  omagy_codebase_map: handleCodebaseMap,
  omagy_verify_evidence: handleVerifyEvidence,
});

export function dispatchRpcMessage(rawLine) {
  let msg;
  try {
    msg = JSON.parse(rawLine);
  } catch {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid JSON' },
    };
  }
  if (!isPlainObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' || !msg.method) {
    return {
      jsonrpc: '2.0',
      id: isPlainObject(msg) && 'id' in msg ? msg.id : null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== undefined;
  const { id, method, params } = msg;

  // Notifications have no id and MUST NOT produce a response.
  if (!hasId) {
    return null;
  }

  try {
    if (method === 'initialize') {
      const pv = isPlainObject(params) && typeof params.protocolVersion === 'string' && params.protocolVersion.trim()
        ? params.protocolVersion.trim()
        : DEFAULT_PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: pv,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
    }

    if (method === 'tools/call') {
      if (!isPlainObject(params) || typeof params.name !== 'string' || !params.name.trim()) {
        throw new RpcError(-32602, 'Invalid params: tool name is required');
      }
      const toolName = params.name.trim();
      const handler = Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, toolName) ? TOOL_HANDLERS[toolName] : null;
      if (!handler) {
        throw new RpcError(-32601, `Unknown tool: ${toolName}`);
      }
      if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
        throw new RpcError(-32602, 'Invalid params: arguments must be an object');
      }
      const toolArgs = params.arguments || {};
      const res = handler(toolArgs);
      if (isPlainObject(res) && res._toolError === true) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(res.data) }],
            isError: true,
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(res) }],
          isError: false,
        },
      };
    }

    throw new RpcError(-32601, `Method not found: ${method}`);
  } catch (err) {
    if (err instanceof RpcError) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: err.code, message: err.message },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    };
  }
}

function startStdioServer() {
  let buffer = '';
  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const response = dispatchRpcMessage(trimmed);
    if (response !== null) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nlIdx;
    while ((nlIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
      buffer = buffer.slice(nlIdx + 1);
      processLine(line);
    }
  });
  process.stdin.on('end', () => {
    const tail = buffer.replace(/\r$/, '');
    buffer = '';
    processLine(tail);
  });
}

const isMainModule = Boolean(process.argv[1] && sameModulePath(process.argv[1], fileURLToPath(import.meta.url)));
if (isMainModule) {
  startStdioServer();
}
