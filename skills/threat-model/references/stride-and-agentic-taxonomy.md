# STRIDE & Agentic Security Threat Taxonomy

Reference guide for `$threat-model` and `security-reviewer`. Use this taxonomy to enumerate systematic threats across classic web/backend services, CI/CD pipelines, and AI/agentic MCP ecosystems without falling back on vague generic checklists.

## Trust Boundary Modeling Rules

A threat only exists cleanly where data or control crosses a **trust boundary** or changes **privilege level**:

1. **External Input -> Parser / Router**:
   - HTTP JSON/form bodies, query strings, URL fragments, and headers
   - Webhook payloads and third-party callback events
   - Multipart file uploads, archives, images, and Markdown/HTML documents
   - CLI arguments, workspace paths, and environment overrides
2. **Untrusted Text -> Agent / Prompt / Tool Planner**:
   - Repository markdown files (`README.md`, `AGENTS.md`, `SKILL.md`) in external repos
   - Pull request titles/descriptions, issue comments, and external web scrapes
   - Browser DOM text, iframe `postMessage` payloads, and subprocess `stderr`/`stdout`
   - MCP server tool descriptions, schemas, and dynamic tool outputs
3. **Caller Session -> Privileged Resource**:
   - Session cookies/JWT claims -> database rows (tenant ownership & RBAC enforcement)
   - Tool path arguments -> filesystem reads/writes (symlink resolution & workspace containment)
   - Dynamic config entries -> child-process commands or outbound network requests
4. **Build / CI Trigger -> Production Artifact**:
   - Forked pull requests (`pull_request` vs `pull_request_target`)
   - Third-party CI actions, package lifecycle scripts, lockfiles, and shared build caches
   - Signing keys, registry tokens, and release artifacts

Every boundary entry in a `$threat-model` deliverable must capture: Source Actor, Target Component, AuthN/AuthZ Mechanism, Input Validation Performed, and Failure Mode when bypassed (fail-open vs fail-closed).

## Classic STRIDE Per-Boundary Checklist

| Category | Core Question | Common Failure Modes | Concrete Mitigation |
|---|---|---|---|
| **Spoofing** | Can an attacker impersonate a user, tenant, origin, or worker? | Weak JWT verification (`alg: none`), missing webhook HMAC check, missing `event.source` / origin check in `postMessage`, spoofed `X-Forwarded-For` | Constant-time HMAC verification, strict issuer/audience checks, exact `event.source === expectedWindow` & origin match |
| **Tampering** | Can an attacker alter requests, persisted state, lockfiles, or logs? | Missing integrity hashes, TOCTOU race between `lstat` and read/write, non-atomic state writes, unpinned remote script fetches | Canonical `realpath` validation with symlink rejection, atomic temp-file + rename, SHA/hash pinning, signed receipts |
| **Repudiation** | Can an actor deny performing a mutation or erase audit trails? | Silent fallback catches masking errors, unlogged destructive tool calls, overwritten ledgers without history | Append-only audit logs with actor/session ID and UTC timestamps; preserve suppression/exemption audit reasons |
| **Information Disclosure** | Can secrets, cross-tenant rows, or host paths leak in logs/errors? | Stack traces exposing `process.env`, literal secrets in configs, unredacted DB URIs, symlink workspace escapes, `/Users/` host paths | Run `redactSecrets` on logs/artifacts, scrub home paths, enforce canonical containment inside root, separate public errors |
| **Denial of Service** | Can untrusted input exhaust memory, CPU, disk, or event loops? | Unbounded recursive file walks, catastrophic backtracking regexes, missing HTTP timeouts, oversize binary assets, infinite retry loops | Hard depth/file/byte caps (`maxBuffer`, timeouts), linear-time string/regex scanners, bounded retry/QA cycle limits |
- **Elevation of Privilege** | Can a lower-privilege caller trigger admin/write actions or escape sandboxes? | SSRF to cloud metadata `169.254.169.254`, shell metacharacters in subprocess args, XSS in preview panes, over-broad CI `GITHUB_TOKEN` | Parameterized `execFileSync` (never invoke shell interpreters), private-IP SSRF blocking, strict CSP + HTML `esc()`, minimal CI `permissions:` |

## OWASP Top 10:2025 & Local Runtime Trust Additions

Evaluate **OWASP Top 10:2025** alongside classic STRIDE:
- **`A01:2025` Broken Access Control** (now absorbs SSRF alongside IDOR, path traversal, and RBAC bypasses).
- **`A02:2025` Security Misconfiguration**, **`A04:2025` Cryptographic Failures**, **`A05:2025` Injection**, **`A06:2025` Insecure Design**, **`A07:2025` Authentication Failures**, **`A08:2025` Software or Data Integrity Failures**, **`A09:2025` Security Logging and Alerting Failures**.
- **`A03:2025` Software Supply Chain Failures**: lockfile/dependency tampering, unpinned remote scripts, Trojan Unicode, and skill/MCP manifest poisoning (`dep-license-diff`, `mcp-audit`, `skill-validate --strict`).
- **`A10:2025` Mishandling of Exceptional Conditions**: fail-open `catch` blocks, uncaught malformed URL/socket crashes, symlink `TOCTOU` fallbacks, and unrotated logs.
- **Shared Temp-Dir Trust Boundary**: never write secrets or session routing into shared world-writable `/tmp/<app>` folders; require `0o700` UID-scoped runtime dirs (`XDG_RUNTIME_DIR` or `<tmpdir>/<app>-<uid>`), `lstatSync` symlink rejection, bounded log rotation, and `tmpdir-audit` verification.

## Agentic, LLM & MCP Threat Extensions (OWASP LLM / Agentic)

When evaluating agentic orchestrators, skills, hooks, or MCP integrations:

1. **Indirect Prompt Injection**:
   - Hidden Unicode Bidi/zero-width characters (`U+202E`, `U+200B`) that visually reorder code or instructions.
   - Hidden HTML comment directives outside fenced examples or malicious text inside PR bodies, logs, or iframe runtime errors.
   - **Mitigation**: scan skills with `skill-validate --strict` and fence dynamic untrusted payloads cleanly (`fenceUntrustedContext` stripping nested closing tags and enforcing strict byte caps) so external text stays data, never instructions.
2. **Tool Poisoning & Supply-Chain Hijack**:
   - Third-party skill packs or MCP server definitions embedding unpinned remote package specs, non-loopback plaintext `http://` URLs, or broken/obfuscated `scripts/*.mjs`.
   - **Mitigation**: gate skill directories with `skill-validate --strict`, never run unpinned `@latest` package specs via remote runners, and validate all MCP manifests with `mcp-audit`.
3. **Confused Deputy & Path/Workspace Escape**:
   - An untrusted payload tricks a write-enabled tool or hook into modifying shared config, credentials, `.omagy/notifications.json`, or host files via `..` traversal or symlinked directories.
   - **Mitigation**: restrict auto-write allowlists strictly, reject symlinks along target segments (`hasSymlinkSegment`), and require explicit confirmation on ambiguous or targetless file mutations.
4. **Over-Privileged Subagents & Host Bleed**:
   - Read-only advisory lanes receiving file-write or command-execution tools, or host-specific internal URIs leaking into portable prompt bundles.
   - **Mitigation**: enforce 3-tier least-privilege tool allowlists (`pureRead`, `repoRead`, `write`) validated by automated host-parity tests (`host-validate --strict`).
5. **Unsafe Code Preview & Webview Rendering**:
   - Rendering generated HTML/JS inside privileged IDE webviews with same-origin scripts enabled or unvalidated iframe `postMessage` events.
   - **Mitigation**: isolate untrusted previews in sandboxed opaque `srcdoc` iframes (`sandbox="allow-scripts"` omitting `allow-same-origin`), validate `event.source === previewFrame.contentWindow`, and HTML-escape (`esc()`) all host-rendered diagnostics.

## Verification Probes Per Mitigation

Every High or Critical entry in a `$threat-model` risk register must define a reproducible, falsifiable probe:

- **Authorization / Tenant Isolation Probe**: unauthenticated or cross-tenant caller attempts resource read or mutation -> verify fail-closed HTTP `401`/`403` and zero leaked rows.
- **Traversal / Symlink Escape Probe**: symlink inside workspace pointing to external secret file or `../../etc/passwd` path arg -> verify fail-closed rejection and zero bytes leaked.
- **Agentic / MCP Hygiene Probe**: run `sh <plugin>/hooks/run.sh mcp-audit <repo> --json`, `skill-validate --strict`, `dep-license-diff`, and `floor-guard` cleanly in CI (`exitCode: 0`).
- **Iframe / Preview XSS Probe**: thrown error containing `<img src=x onerror=...>` or closing fence tag inside sandbox preview -> verify rendered error banner escapes HTML cleanly and parent state stays isolated.
