---
artifact: ADR
adr_id: ADR-001
project_slug: llm-corpus
stage: 4-plan
tier: deep
template_version: 3.0.0
generated: 2026-04-26T00:11:00Z
generated_by: ProductDevelopment Skill v3.0
status: accepted
supersedes: null
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-04-26T00:11:00Z
date_accepted: 2026-04-26T00:35:00Z
product_type: software

links:
  decisions_jsonl_id: D-013
  decisions_supersedes_consequences_of: [D-004]
  requirements_gated: [NFR-001, NFR-002]
  roadmap_items_gated: [RM-002]
  related_adrs: []

reversibility: low
tags: [security, architecture, egress, networking]
---

# ADR-001: In-Process Node Runtime Egress Hook (Six Outbound Primitives)

## Status

accepted

## Context

NFR-001 (static-lint local-only) blocks forbidden imports at compile time, but cannot prevent transitive native dependencies or runtime-loaded modules from making outbound calls. NFR-002 closes that gap with a runtime guarantee that no non-loopback packets leave the process during pipeline operations.

**Forces / constraints:**
- AG-001 / OPP-005: documents must NOT leave the user's machine, regardless of code path
- David persona has explicitly raised "always-on" framing as a blocking concern (C-016)
- Sonnet-4-6 Council (C-029) flagged that a static-lint-only approach misses Worker threads, child_process, native addons
- Stage 3 SP-002 was reference-implementation analysis only — runtime verification deferred to build

**Alternatives considered:**

1. **Static lint only (NFR-001 alone)** — Fast, simple, no runtime overhead. Misses transitive deps via Worker threads, dynamic imports, child_process, and native addons. Insufficient for the David persona threat model.
2. **OS-level firewall only (pf/iptables UID-scoped)** — Strong defense-in-depth boundary. Requires sudo at install time, varies across Linux/macOS, cannot prevent the JS-land code from attempting the call (it just blocks the wire).
3. **In-process Node hook patching net.Socket + undici + dgram + dns + http2 + tls at module load** — Catches the call before it reaches the network layer; emits structured telemetry for every attempt. ~80 lines of code per Stage 3 SP-002. NodeShield (arXiv 2508.13750) is the reference implementation pattern. Worker threads + child_process require additional handling.
4. **eBPF/USDT probes** — Strongest enforcement; defeated by Node JIT per Stage 2 Research; eBPF unavailable on macOS without kernel extension.

**Origin of these alternatives:** Stage 2 Research (D-004 baseline rationale) + Stage 3 SP-002 (NodeShield reference) + Stage 3 Sonnet-4-6 Council audit (C-029 expanded coverage). Decision laundering check: D-004 + D-013 rationale fields cite the Stage 2 Research finding and SP-002; alternatives are not invented after the fact.

## Decision

We will implement NFR-002 as an **in-process Node hook** that monkey-patches six outbound primitives at module load time (net.Socket.connect, undici Dispatcher, dgram.send, dns.lookup, http2.connect, tls.connect), registered in the entry-point bootstrap before any pipeline code is imported. We will additionally:

1. **Cover Worker threads**: register the hook in any Worker's bootstrap shim; refuse to spawn Workers without the shim.
2. **Provision OS-level firewall as a TR-001 install side-effect** (path (b) chosen at PM-Review 2026-04-26 to close C-036): subprocesses launched by `child_process.spawn` and native addons making raw POSIX socket calls bypass the JS-land hook. They are blocked at the OS-level firewall layer (pf on macOS, iptables on Linux) — the firewall rule is **installed automatically by TR-001 as a required install side-effect**, not merely documented. The install script provisions a UID-scoped rule (`block out proto {tcp, udp} from any to any user <corpus-uid>` on macOS pf; `OUTPUT -m owner --uid-owner <corpus-uid> -j REJECT` on Linux iptables) and SP-007 exit criterion verifies the rule is active post-install. Uninstall (TR-002) reverses the firewall rule.
3. **Native addon allowlist enforced at build time**: native .node addons making raw POSIX socket calls bypass JS-land patching. v1 pipeline whitelists native addons (better-sqlite3, sqlite-vec) that perform no outbound I/O; whitelist enforced at build time via `build:verify-native-addons` script that fails the build if any `.node` addon outside the allowlist is bundled. SP-001 exit criterion verifies the build-time check fires (per Architect audit recommendation).
4. **Verification at build-ready gate**: tcpdump-on-non-loopback integration test (C-029 condition) including synthetic Worker thread + child_process egress attempts must pass before Stage 5 Build-Ready gate.

## Consequences

**Positive:**
- Closes the David-persona threat model at runtime, not just compile time
- Structured telemetry (`egress.attempted` / `egress.blocked` events per NFR-016) provides forensic record
- Pattern is well-precedented (NodeShield) and ~80 lines of maintainable code
- Defense in depth: static lint + runtime hook + OS firewall = three independent layers
- Worker thread coverage closes C-029 OBJ-D-002

**Negative:**
- ~80 lines of patching code is fragile to Node version changes; CI must include "hook still patches" tests on each LTS release
- child_process and native-addon exclusions must be permanent constraints; any future requirement to spawn subprocesses or load arbitrary native addons re-opens NFR-002 (would require this ADR to be deprecated/superseded)
- D-013 reversibility revised from medium to low per C-029 OBJ-D-004 — this is a one-way door once shipped; retrofitting alternative architectures (Worker isolation, sandboxed runtime) becomes substantially more expensive after build
- Hook registration ordering bug = silent failure; bootstrap test must verify hook active before pipeline import

**Neutral:**
- Adds a constraint on every future module load: must not preempt the hook bootstrap
- Constrains future ADRs around plugin systems and dynamic adapter loading

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for NFR-002 cover the six primitives + import-time egress + Worker-thread egress + child_process egress (latter documents OS-firewall fallback). Adversary scenarios from C-016 (always-on David objection) covered.
- **Telemetry**: `egress.checkpoint` events at each pipeline stage transition; `egress.attempted` / `egress.blocked` event classes per NFR-016.
- **Trigger to revisit**: any future requirement that needs `child_process.spawn` for outbound work, OR a Node major version that changes the underlying APIs of any of the six primitives, OR a documented bypass of the hook in a CI test failure → open ADR-001-superseder.
