import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalizePath, redactSecrets } from '../../hooks/omagy-hook.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CLAUDE_MODEL_MAP = { flash_lite: 'haiku', flash: 'haiku', pro: 'opus' };
const CODEX_WRITE_ROLES = new Set(['executor', 'debugger', 'designer', 'test-engineer', 'devops-engineer', 'doc-steward']);
const OMAGY_SKILL_SLUGS = new Set([
  'ai-slop-cleaner', 'analyze', 'ask', 'autopilot', 'cancel', 'code-review',
  'deep-interview', 'deep-research', 'doctor', 'hud', 'loft', 'modernize',
  'performance-goal', 'pr', 'ralplan', 'release', 'skill', 'team',
  'threat-model', 'ultragoal', 'ultraqa', 'visual-ralph', 'wiki',
]);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX_UPGRADE_BYTES = 32 * 1024;
const WS_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/** Return true only for canonical loopback hostnames or addresses. */
export function isLoopbackHost(hostname) {
  const norm = String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return LOOPBACK_HOSTS.has(norm);
}

function isLoopbackIp(addr) {
  const ip = String(addr || '').trim().toLowerCase();
  return ip === '::1' || /^127\./.test(ip) || /^::ffff:127\./.test(ip);
}

/** Rewrite leading oh-my-agy `/<skill>` commands to `$<skill>` on Claude Code and Codex while leaving file paths intact. */
export function normalizeHostPromptSigil(prompt, host = 'antigravity', skillSlugs = OMAGY_SKILL_SLUGS) {
  const raw = String(prompt || '');
  if (host !== 'claude' && host !== 'codex') return raw;
  const known = skillSlugs instanceof Set ? skillSlugs : new Set(skillSlugs || OMAGY_SKILL_SLUGS);
  return raw.replace(/^(\s*)\/([a-z0-9-]+)(?=$|\s)/, (full, sp, slug) => (known.has(slug) ? `${sp}$${slug}` : full));
}

function redactErrorText(text) {
  return redactSecrets(String(text || ''));
}

/** Copy text to the OS clipboard via stdin without shell interpolation; browser fallback stays enabled. */
export function copyToSystemClipboard(text, options = {}) {
  const content = String(text || '');
  if (!content) return { ok: false, copied: false, method: 'none', error: 'empty_clipboard_text' };
  if (typeof options.clipboardRunner === 'function') {
    try {
      options.clipboardRunner(content);
      return { ok: true, copied: true, method: 'custom' };
    } catch (err) { /* fail open: custom clipboard runner failed, caller still receives clipboardText */
      return { ok: false, copied: false, method: 'custom', error: redactErrorText(err?.message || err) };
    }
  }
  const candidates = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip.exe', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  let lastError = 'no_clipboard_binary';
  for (const [cmd, args] of candidates) {
    try {
      execFileSync(cmd, args, { input: content, encoding: 'utf8', timeout: 2500, stdio: ['pipe', 'ignore', 'ignore'] });
      return { ok: true, copied: true, method: cmd };
    } catch (err) { /* fail open: try next platform clipboard helper */
      lastError = err?.code || err?.message || cmd;
    }
  }
  return { ok: false, copied: false, method: candidates[0]?.[0] || 'none', error: redactErrorText(lastError) };
}

function encodeWsFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const len = payloadBuf.length;
  let headerLen = 6;
  if (len >= 126 && len <= 0xffff) headerLen = 8;
  else if (len > 0xffff) headerLen = 14;
  const out = Buffer.allocUnsafe(headerLen + len);
  out[0] = 0x80 | (opcode & 0x0f);
  let offset = 2;
  if (len < 126) {
    out[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    out[1] = 0x80 | 126;
    out.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    out[1] = 0x80 | 127;
    out.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }
  const mask = crypto.randomBytes(4);
  mask.copy(out, offset);
  offset += 4;
  for (let i = 0; i < len; i += 1) {
    out[offset + i] = payloadBuf[i] ^ mask[i & 3];
  }
  return out;
}

function tryDecodeWsFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = Boolean(b0 & 0x80);
  const opcode = b0 & 0x0f;
  const masked = Boolean(b1 & 0x80);
  if (masked) throw new Error('ws_masked_server_frame');
  if (![0x0, 0x1, 0x2, 0x8, 0x9, 0xa].includes(opcode)) throw new Error('ws_unsupported_opcode');
  let payloadLen = b1 & 0x7f;
  if (opcode >= 0x8) {
    if (!fin) throw new Error('ws_fragmented_control_frame');
    if (payloadLen > 125) throw new Error('ws_control_frame_too_large');
  }
  let offset = 2;
  if (payloadLen === 126) {
    if (buf.length < offset + 2) return null;
    payloadLen = buf.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLen === 127) {
    if (buf.length < offset + 8) return null;
    const bigLen = buf.readBigUInt64BE(offset);
    if (bigLen > BigInt(WS_MAX_MESSAGE_BYTES)) throw new Error('ws_frame_too_large');
    payloadLen = Number(bigLen);
    offset += 8;
  }
  if (payloadLen > WS_MAX_MESSAGE_BYTES) throw new Error('ws_frame_too_large');
  if (buf.length < offset + payloadLen) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + payloadLen));
  return { fin, opcode, payload, totalLen: offset + payloadLen };
}

function parseHttpUpgradeHeaders(headText) {
  const lines = headText.split('\r\n');
  const statusLine = lines[0] || '';
  const m = /^HTTP\/\d\.\d\s+(\d+)/i.exec(statusLine);
  const status = m ? Number(m[1]) : 0;
  const headers = {};
  for (let i = 1; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(':');
    if (idx > 0) {
      headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
    }
  }
  return { status, headers };
}

/** Dispatch a prompt to loopback Codex app-server over RFC 6455 WebSocket JSON-RPC 2.0. */
export async function dispatchViaCodexAppServer(wsUrl, opts = {}) {
  let parsed;
  try {
    parsed = new URL(String(wsUrl || '').trim());
  } catch { /* fail open: reject malformed Codex WebSocket URL */
    return { ok: false, status: 400, error: 'invalid_ws_url' };
  }
  if (parsed.protocol !== 'ws:' || !isLoopbackHost(parsed.hostname)) {
    return { ok: false, status: 403, error: 'non_loopback_ws_url_refused' };
  }

  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, status: 400, error: 'invalid_ws_port' };
  }
  let connectHost = host;
  if (host.toLowerCase() === 'localhost') {
    const lookupFn = typeof opts.dnsLookup === 'function'
      ? opts.dnsLookup
      : (h) => dns.promises.lookup(h, { all: true, verbatim: true });
    let addrs = [];
    try { addrs = await lookupFn('localhost'); } catch { /* fail open: refused below on empty resolution */ addrs = []; }
    if (!Array.isArray(addrs) || !addrs.length || !addrs.every((a) => isLoopbackIp(a?.address))) {
      return { ok: false, status: 403, error: 'non_loopback_ws_url_refused' };
    }
    connectHost = (addrs.find((a) => /^127\./.test(String(a?.address || ''))) || addrs[0]).address;
  } else if (!isLoopbackIp(host)) {
    return { ok: false, status: 403, error: 'non_loopback_ws_url_refused' };
  }
  const reqPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
  const timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 8000));
  const wsKey = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(`${wsKey}${WS_GUID}`).digest('base64');

  return new Promise((resolve) => {
    const connector = typeof opts.wsConnect === 'function' ? opts.wsConnect : net.createConnection;
    const socket = connector({ host: connectHost, port });
    let settled = false;
    let upgraded = false;
    let rxBuf = Buffer.alloc(0);
    let fragChunks = [];
    let fragOpcode = 0;
    let fragBytes = 0;
    let nextId = 1;
    const pending = new Map();

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const p of pending.values()) p.reject(new Error(outcome.error || 'ws_closed'));
      pending.clear();
      try { socket.removeAllListeners(); } catch { /* fail open: ignore listener teardown errors */ }
      try {
        if (upgraded && !socket.destroyed) socket.write(encodeWsFrame(0x8));
        socket.end();
      } catch { /* fail open: ignore close frame write error */ }
      try { socket.destroy(); } catch { /* fail open: ignore socket destroy error */ }
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ ok: false, status: 504, error: 'codex_ws_timeout' }), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const sendRpc = (method, params = {}, isNotification = false) => {
      if (isNotification) {
        socket.write(encodeWsFrame(0x1, Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, params }), 'utf8')));
        return Promise.resolve(null);
      }
      const id = nextId;
      nextId += 1;
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
      return new Promise((resRpc, rejRpc) => {
        pending.set(id, { resolve: resRpc, reject: rejRpc });
        socket.write(encodeWsFrame(0x1, body));
      });
    };

    const runProtocolHandshake = async () => {
      try {
        await sendRpc('initialize', {
          clientInfo: { name: 'oh-my-agy-hud', version: String(opts.version || '0.8.1') },
          capabilities: { experimentalApi: true },
        });
        await sendRpc('initialized', {}, true);

        let threadId = '';
        let fallbackUsed = false;
        const requestedThread = String(opts.threadId || '').trim();
        if (requestedThread) {
          try {
            const resumed = await sendRpc('thread/resume', { threadId: requestedThread });
            threadId = String(resumed?.thread?.id || resumed?.threadId || resumed?.id || requestedThread);
          } catch (resumeErr) { /* fail open: fall back to thread/start only when caller permits */
            if (!opts.fallbackToNewThread) throw resumeErr;
            fallbackUsed = true;
          }
        }
        if (!threadId) {
          const started = await sendRpc('thread/start', {
            ...(opts.workspaceRoot ? { cwd: path.resolve(opts.workspaceRoot) } : {}),
            ...(opts.approvalPolicy ? { approvalPolicy: opts.approvalPolicy } : {}),
          });
          threadId = String(started?.thread?.id || started?.threadId || started?.id || '');
        }
        if (!threadId) throw new Error('codex_missing_thread_id');

        const turnRes = await sendRpc('turn/start', {
          threadId,
          input: [{ type: 'text', text: String(opts.prompt || '') }],
        });
        const turnId = String(turnRes?.turn?.id || turnRes?.turnId || turnRes?.id || '');
        finish({ ok: true, status: 200, transport: 'codex-app-server', threadId, turnId, fallback: fallbackUsed });
      } catch (err) { /* fail open: return structured RPC error without hanging socket */
        finish({ ok: false, status: 502, error: redactErrorText(err?.message || err) });
      }
    };

    const handleWsFrames = () => {
      while (!settled) {
        let frame;
        try {
          frame = tryDecodeWsFrame(rxBuf);
        } catch (err) { /* fail open: abort on invalid WebSocket frame */
          finish({ ok: false, status: 502, error: redactErrorText(err?.message || err) });
          return;
        }
        if (!frame) return;
        rxBuf = rxBuf.subarray(frame.totalLen);
        if (frame.opcode === 0x8) {
          finish({ ok: false, status: 502, error: 'codex_ws_closed_by_peer' });
          return;
        }
        if (frame.opcode === 0x9) {
          try { socket.write(encodeWsFrame(0xa, frame.payload)); } catch { /* fail open: ignore pong write error */ }
          continue;
        }
        if (frame.opcode === 0xa) continue;
        if (frame.opcode === 0x1 || frame.opcode === 0x2 || frame.opcode === 0x0) {
          if (frame.opcode !== 0x0) {
            if (fragOpcode !== 0) {
              finish({ ok: false, status: 502, error: 'ws_interleaved_fragment' });
              return;
            }
            fragOpcode = frame.opcode;
            fragChunks = [frame.payload];
            fragBytes = frame.payload.length;
          } else {
            if (!fragOpcode) {
              finish({ ok: false, status: 502, error: 'ws_unexpected_continuation' });
              return;
            }
            fragBytes += frame.payload.length;
            if (fragBytes > WS_MAX_MESSAGE_BYTES) {
              finish({ ok: false, status: 502, error: 'ws_message_too_large' });
              return;
            }
            fragChunks.push(frame.payload);
          }
          if (!frame.fin) continue;
          const fullMsg = Buffer.concat(fragChunks);
          const msgOpcode = fragOpcode;
          fragOpcode = 0;
          fragChunks = [];
          fragBytes = 0;
          if (msgOpcode !== 0x1) continue;
          let msg;
          try { msg = JSON.parse(fullMsg.toString('utf8')); } catch { /* fail open: ignore non-JSON WS frame */ continue; }
          if (msg && Object.prototype.hasOwnProperty.call(msg, 'id') && pending.has(msg.id)) {
            const wait = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) wait.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else wait.resolve(msg.result);
          }
        }
      }
    };

    socket.on('error', (err) => {
      finish({ ok: false, status: 502, error: redactErrorText(err?.code || err?.message || 'ws_socket_error') });
    });

    socket.on('close', () => {
      if (!settled) finish({ ok: false, status: 502, error: 'ws_socket_closed' });
    });

    socket.on('connect', () => {
      const upgradeReq = [
        `GET ${reqPath} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(upgradeReq);
    });

    socket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      if (!upgraded) {
        const hdrEnd = rxBuf.indexOf('\r\n\r\n');
        if (hdrEnd < 0) {
          if (rxBuf.length > WS_MAX_UPGRADE_BYTES) {
            finish({ ok: false, status: 502, error: 'ws_upgrade_header_too_large' });
          }
          return;
        }
        if (hdrEnd > WS_MAX_UPGRADE_BYTES) {
          finish({ ok: false, status: 502, error: 'ws_upgrade_header_too_large' });
          return;
        }
        const headText = rxBuf.subarray(0, hdrEnd).toString('utf8');
        rxBuf = rxBuf.subarray(hdrEnd + 4);
        const { status, headers } = parseHttpUpgradeHeaders(headText);
        if (status !== 101 || headers['sec-websocket-accept'] !== expectedAccept) {
          finish({ ok: false, status: 502, error: 'ws_upgrade_failed' });
          return;
        }
        upgraded = true;
        runProtocolHandshake();
      }
      if (upgraded && rxBuf.length > 0) handleWsFrames();
    });
  });
}

function buildClipboardFallback({ host, mode, effectivePrompt, agentName, cliModel, fallback, options, reason }) {
  const clip = copyToSystemClipboard(effectivePrompt, options);
  const label = host === 'codex' ? 'Codex Desktop' : 'Claude Desktop';
  return {
    ok: true,
    status: 200,
    modeUsed: 'clipboard-handoff',
    host,
    requestedMode: mode,
    ...(agentName ? { agent: agentName, model: cliModel || 'inherit' } : {}),
    fallback: Boolean(fallback),
    clipboardPrompt: effectivePrompt,
    clipboardText: effectivePrompt,
    copiedToClipboard: Boolean(clip.copied),
    clipboardCopied: Boolean(clip.copied),
    clipboardMethod: clip.method,
    ...(reason ? { transportReason: redactErrorText(reason) } : {}),
    message: clip.copied
      ? `Copied prompt for ${label} — paste into chat.`
      : `Clipboard unavailable for ${label} — copy prompt manually.`,
  };
}

function spawnDetachedCli(cmd, args, cwd) {
  return new Promise((resolve) => {
    let done = false;
    try {
      const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' });
      child.once('error', (err) => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: redactErrorText(err?.code || err?.message || 'spawn_error') });
      });
      child.once('spawn', () => {
        if (done) return;
        done = true;
        child.unref();
        resolve({ ok: true, pid: child.pid || 0 });
      });
    } catch (err) { /* fail open: treat synchronous spawn exception as unavailable binary */
      if (!done) {
        done = true;
        resolve({ ok: false, error: redactErrorText(err?.code || err?.message || 'spawn_exception') });
      }
    }
  });
}

/** Dispatch validated HUD actions natively for Claude Desktop or Codex Desktop. */
export async function dispatchDesktopHostAction(ctx, payload = {}, options = {}) {
  const { host, mode, rawPrompt, workspaceRoot, agentName, cliModel, effectivePrompt } = ctx;
  const skillSet = options.skillSlugs ? new Set(options.skillSlugs) : OMAGY_SKILL_SLUGS;
  const normRawPrompt = normalizeHostPromptSigil(rawPrompt, host, skillSet);
  const normEffectivePrompt = normalizeHostPromptSigil(effectivePrompt, host, skillSet);

  if (mode === 'subagent-standalone') {
    let cmd = '';
    let args = [];
    if (host === 'claude') {
      cmd = 'claude';
      args = ['-p', '--agent', agentName];
      const claudeModel = CLAUDE_MODEL_MAP[cliModel] || '';
      if (claudeModel) args.push('--model', claudeModel);
      args.push('--', normRawPrompt);
    } else {
      cmd = 'codex';
      const sandbox = ctx.sandboxMode || (CODEX_WRITE_ROLES.has(agentName) ? 'workspace-write' : 'read-only');
      args = ['exec', '--sandbox', sandbox, '-C', path.resolve(workspaceRoot), '--', `Use the ${agentName} agent role to complete this task: ${normRawPrompt}`];
    }
    if (typeof options.asyncRunner === 'function') {
      try {
        const res = await options.asyncRunner(cmd, args, { cwd: path.resolve(workspaceRoot), host, agent: agentName, model: cliModel || 'inherit' });
        return {
          ok: true,
          status: 200,
          modeUsed: 'subagent-standalone',
          host,
          agent: agentName,
          model: cliModel || 'inherit',
          fallback: false,
          command: cmd,
          args,
          ...(res && typeof res === 'object' ? res : { output: String(res || '').trim() }),
        };
      } catch (err) { /* fail open: return 500 JSON when custom async runner rejects */
        return { ok: false, status: 500, error: redactErrorText(err?.message || err) };
      }
    }
    const launched = await spawnDetachedCli(cmd, args, path.resolve(workspaceRoot));
    if (launched.ok) {
      return {
        ok: true,
        status: 200,
        modeUsed: 'subagent-standalone',
        host,
        agent: agentName,
        model: cliModel || 'inherit',
        fallback: false,
        command: cmd,
        args,
        pid: launched.pid,
      };
    }
    return buildClipboardFallback({
      host,
      mode,
      effectivePrompt: normRawPrompt,
      agentName,
      cliModel,
      fallback: true,
      options,
      reason: launched.error,
    });
  }

  if (host === 'codex') {
    const rawPayloadWs = options.allowPayloadWsUrl === false ? '' : payload?.wsUrl;
    const wsUrl = String(
      rawPayloadWs || options.codexAppServerUrl || options.codexWsUrl || process.env.OMAGY_CODEX_APP_SERVER_URL || process.env.CODEX_APP_SERVER_WS_URL || process.env.OMAGY_CODEX_WS_URL || '',
    ).trim();
    if (wsUrl) {
      const wsRes = await dispatchViaCodexAppServer(wsUrl, {
        prompt: normEffectivePrompt,
        workspaceRoot,
        threadId: (mode === 'active-chat' || mode === 'subagent-active') ? (payload?.conversationId || options.threadId || '') : '',
        fallbackToNewThread: mode === 'active-chat',
        version: options.version || '0.8.1',
        wsConnect: options.wsConnect,
      });
      if (wsRes.ok) {
        return {
          ok: true,
          status: 200,
          modeUsed: mode,
          host: 'codex',
          transport: 'codex-app-server',
          threadId: wsRes.threadId,
          turnId: wsRes.turnId,
          ...(agentName ? { agent: agentName, model: cliModel || 'inherit' } : {}),
          fallback: Boolean(wsRes.fallback),
        };
      }
      if (wsRes.status === 400 || wsRes.status === 403) {
        return wsRes;
      }
      return buildClipboardFallback({
        host,
        mode,
        effectivePrompt: normEffectivePrompt,
        agentName,
        cliModel,
        fallback: true,
        options,
        reason: wsRes.error,
      });
    }
  }

  return buildClipboardFallback({
    host,
    mode,
    effectivePrompt: normEffectivePrompt,
    agentName,
    cliModel,
    fallback: true,
    options,
  });
}

function normalizeWorkspaceKey(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let fsPath = raw;
  if (raw.startsWith('file://')) {
    try {
      fsPath = fileURLToPath(raw);
    } catch { /* fail open: fallback to string prefix strip when file URL is malformed */
      fsPath = raw.replace(/^file:\/\//, '');
    }
  }
  return canonicalizePath(fsPath);
}

/**
 * Infer the host ('antigravity', 'codex', 'claude', or 'unknown') that wrote a routing record.
 */
export function inferRoutingRecordHost(data) {
  if (!data || typeof data !== 'object') return 'unknown';
  const explicitHost = String(data.host || '').trim().toLowerCase();
  if (explicitHost) return explicitHost;
  const tx = String(data.transcriptPath || '').trim().toLowerCase().replace(/\\/g, '/');
  if (tx.includes('/.codex/')) return 'codex';
  if (tx.includes('/.claude/')) return 'claude';
  if (tx.includes('/.gemini/antigravity/')) return 'antigravity';
  if (String(data.lastUserKey || '').trim().startsWith('input:')) return 'codex';
  return 'unknown';
}

/**
 * Return true if a routing record's inferred host is compatible with expectedHost.
 */
export function isRoutingHostCompatible(dataOrHost, expectedHost = 'antigravity', convId = '', brainDir = '') {
  const expected = String(expectedHost || 'antigravity').trim().toLowerCase() || 'antigravity';
  const inferred = typeof dataOrHost === 'string'
    ? (dataOrHost.trim().toLowerCase() || 'unknown')
    : inferRoutingRecordHost(dataOrHost);
  if (inferred === expected) return true;
  if (inferred !== 'unknown') return false;
  if (expected === 'antigravity' && brainDir && convId) {
    try {
      const target = path.join(brainDir, String(convId));
      const st = fs.lstatSync(target);
      return st.isDirectory() && !st.isSymbolicLink();
    } catch { /* fail open: missing brain directory entry excludes ambiguous legacy routing record */
      return false;
    }
  }
  return true;
}

/**
 * Classify how a routing record's workspace list matches the HUD's workspace roots.
 */
export function routingMatchesWorkspaces(dataWorkspaces, targetRoots) {
  const rootsInput = Array.isArray(targetRoots) ? targetRoots : [targetRoots];
  const targetKeys = rootsInput.map(normalizeWorkspaceKey).filter(Boolean);
  const recordKeys = (Array.isArray(dataWorkspaces) ? dataWorkspaces : []).map(normalizeWorkspaceKey).filter(Boolean);
  if (!targetKeys.length || !recordKeys.length) return 'unscoped';
  const targetSet = new Set(targetKeys);
  return recordKeys.some((k) => targetSet.has(k)) ? 'match' : 'mismatch';
}

/**
 * Resolve the Antigravity brain directory unless suppressed by OMAGY_RUNTIME_DIR in tests.
 */
export function resolveAntigravityBrainDir(explicitBrainDir = '') {
  const explicit = String(explicitBrainDir || '').trim();
  if (explicit) {
    try {
      const st = fs.lstatSync(explicit);
      return st.isDirectory() && !st.isSymbolicLink() ? explicit : '';
    } catch { /* fail open: explicit brain directory unavailable */
      return '';
    }
  }
  if (process.env.OMAGY_RUNTIME_DIR) return '';
  const defaultDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  try {
    const st = fs.lstatSync(defaultDir);
    return st.isDirectory() && !st.isSymbolicLink() ? defaultDir : '';
  } catch { /* fail open: default antigravity brain directory unavailable */
    return '';
  }
}

/**
 * Verify candidate Antigravity conversation IDs via get-conversation-metadata, unwrapping subagents.
 */
export function verifyAntigravityTargetConversation({
  candidates = [],
  explicitId = '',
  workspaceRoots = [],
  runner = null,
  agentapi = null,
  invoke = null,
  timeoutMs = 2500,
  maxCandidates = 8,
} = {}) {
  const validIdRe = /^[a-zA-Z0-9_-]{6,80}$/;
  const trimmedExplicit = String(explicitId || '').trim();
  const targetRoots = (Array.isArray(workspaceRoots) ? workspaceRoots : [workspaceRoots])
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const uniqueCandidates = [];
  const dedup = new Set();
  for (const rawId of Array.isArray(candidates) ? candidates : []) {
    const id = String(rawId || '').trim();
    if (!id || !validIdRe.test(id) || dedup.has(id)) continue;
    dedup.add(id);
    uniqueCandidates.push(id);
    if (uniqueCandidates.length >= maxCandidates) break;
  }
  if (!uniqueCandidates.length) return '';

  const invokeMeta = typeof invoke === 'function'
    ? invoke
    : (args) => {
      const bin = String(
        agentapi?.bin
        || process.env.OMAGY_AGENTAPI_BIN
        || path.join(os.homedir(), '.gemini', 'antigravity', 'bin', 'agentapi'),
      );
      const prefix = Array.isArray(agentapi?.prefixArgs) ? agentapi.prefixArgs : [];
      if (typeof runner === 'function') {
        const out = runner(bin, [...prefix, ...args], { encoding: 'utf8', timeout: timeoutMs });
        return typeof out === 'string' ? { stdout: out, output: out } : out;
      }
      const stdout = execFileSync(bin, [...prefix, ...args], {
        encoding: 'utf8',
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { stdout: String(stdout || ''), output: String(stdout || '') };
    };

  const visited = new Set();
  const inspectCandidate = (id, isExplicit, depth = 0) => {
    let raw;
    try {
      raw = invokeMeta(['get-conversation-metadata', id]);
    } catch { /* fail open: metadata lookup failed for candidate conversation */
      return '';
    }
    const text = (typeof raw === 'string' ? raw : String(raw?.stdout ?? raw?.output ?? '')).trim();
    if (!text) return '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch { /* fail open: non-JSON output treated as mocked or opaque success */
      return id;
    }
    if (!parsed || typeof parsed !== 'object') return '';

    const meta = parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : parsed;
    const convWs = Array.isArray(meta.workspaceUris)
      ? meta.workspaceUris
      : (Array.isArray(meta.workspaces) ? meta.workspaces : []);
    if (!isExplicit && targetRoots.length > 0 && convWs.length > 0) {
      if (routingMatchesWorkspaces(convWs, targetRoots) === 'mismatch') {
        return '';
      }
    }

    const rootId = String(meta.rootConversationId || '').trim();
    if (rootId && validIdRe.test(rootId) && rootId !== id && depth < 2 && !visited.has(rootId)) {
      visited.add(rootId);
      return inspectCandidate(rootId, isExplicit, depth + 1);
    }
    return id;
  };

  for (const candId of uniqueCandidates) {
    if (visited.has(candId)) continue;
    visited.add(candId);
    const verified = inspectCandidate(candId, Boolean(trimmedExplicit && candId === trimmedExplicit), 0);
    if (verified) return verified;
  }
  return '';
}
