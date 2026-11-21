---
name: threat-model
description: "[oh-my-agy] Structured security threat modeling with trust-boundary data-flow diagrams, STRIDE and OWASP Agentic/LLM risks, likelihood-impact scoring, file:line mitigations, and MCP audits. Use for $threat-model or mapping attack surfaces."
---

# Threat Model

Produce an evidence-backed, architecture-specific threat model for systems, services, AI/agentic toolchains, or high-risk features. Unlike `$code-review` (which checks a scoped PR diff) or `$analyze` (general debugging/diagnosis), `$threat-model` systematically models assets, actors, trust boundaries, STRIDE threats, OWASP LLM/Agentic Top-10 vectors, and concrete code-level mitigations grounded in observed `file:line` references.

## Usage

```text
$threat-model "target component, service, or whole repository"
$threat-model --scope auth "authentication, session, and webhook trust boundaries"
$threat-model --agentic "plugin hooks, MCP servers, and tool execution sandbox"
```

## Boundaries

- Read [references/stride-and-agentic-taxonomy.md](references/stride-and-agentic-taxonomy.md) before enumerating STRIDE categories, OWASP Agentic risks, or trust-boundary mitigations.
- **Read-only by default**: `$threat-model` analyzes code, manifests, configs, and schemas without editing application source unless the user separately asks to implement fixes. Save the deliverable to `.omagy/artifacts/threat-model-{slug}-{YYYYMMDDTHHMMSSZ}.md`.
- **Evidence first, never generic filler**: every threat entry must tie to real assets, entrypoints, configs, or observed `file:line` handlers in the repo (or explicitly mark unverified runtime assumptions as inferred).
- **Never expose secrets**: never echo `.env` values or literal tokens into artifacts; run automated checks only against safe metadata (`mcp-audit`, `dep-license-diff`).

## Workflow

Execute through parallel read-only reconnaissance (`explore`, `security-reviewer`, `supply-chain-auditor`, `architect` as scope warrants):

1. **Asset & Trust-Boundary Inventory**:
   - Identify protected assets (credentials/tokens, PII, tenant data, signing keys, filesystem/shell capabilities, payment/admin mutations).
   - Map actors (unauthenticated external callers, authenticated low-privilege users, cross-tenant users, CI/build pipelines, untrusted external repos/web content, autonomous AI tools/MCP servers) and trust boundaries where privilege or data sanitization changes.
2. **Data-Flow Diagram (DFD)**:
   - Draw a `flowchart LR` Mermaid diagram illustrating external inputs, API/CLI entrypoints, authz gates, storage/queues, MCP/subagent hops, and explicit trust boundaries (`subgraph`).
3. **Automated Config & Supply-Chain Pre-Checks**:
   - Run `sh <plugin>/hooks/run.sh mcp-audit <repo> --json` to flag literal credentials in MCP headers/env, plaintext non-loopback `http://`, filesystem root/`..` mounts, unpinned remote packages, and shell-metacharacter args.
   - Run `sh <plugin>/hooks/run.sh dep-license-diff <repo> --json` and `sh <plugin>/hooks/run.sh skill-validate ./skills --strict --json` (if skills/plugins exist) for Trojan Unicode, hidden prompt-injection comments, or unpinned remote pipelines.
   - Inspect `.github/workflows/*.yml` for overly broad `permissions:`, pull-request-target script injection, or unpinned third-party actions (`devops-engineer` / `supply-chain-auditor`).
4. **Threat Enumeration (STRIDE + Agentic/LLM Top-10)**:
   - Evaluate **Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege** across every crossing of a trust boundary.
   - For AI/agentic/plugin/MCP systems, evaluate prompt injection (indirect HTML comments/external web/PR payloads), tool poisoning/shadowing, confused deputy filesystem/shell escapes, cross-session state bleed, path/symlink traversal, and untrusted `postMessage` / iframe sandbox leaks.
5. **Risk Matrix & Prioritized Mitigations**:
   - Score each threat (`Likelihood` x `Impact` -> `Critical | High | Medium | Low`), record existing controls (`file:line` verified), identify control gaps, and propose concrete, minimal-change mitigations with verification commands (`test-engineer` / `runtime-qa` probes).

## Output Deliverable Contract

Write `.omagy/artifacts/threat-model-{slug}-{YYYYMMDDTHHMMSSZ}.md` containing:
- Scope & Protected Assets table
- Trust-Boundary Mermaid `flowchart LR` DFD
- Automated Audit Findings (`mcp-audit`, `dep-license-diff`, CI/workflow permissions)
- Threat Register table (`ID`, `Category`, `Boundary/File`, `Threat Vector`, `Likelihood/Impact`, `Existing Control`, `Gap & Concrete Mitigation`, `Verification Test`)
- Top-5 Priority Actions & Out-of-Scope/Deferred Risks

Return the artifact path and concise Top-5 risk summary to the user.
