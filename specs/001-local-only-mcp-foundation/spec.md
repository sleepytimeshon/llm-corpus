# Feature Specification: Local-Only Enforcement and MCP Server Foundation

**Feature Branch**: `001-local-only-mcp-foundation`
**Created**: 2026-05-05
**Status**: Draft
**Input**: SP-001 from `.product/SPRINT-PLAN.yaml` — "Ship local-only enforcement (NFR-001 + NFR-002) and the MCP server foundation (FR-001) so all subsequent code paths have the security primitive in place." See also `.product/REQUIREMENTS.yaml` (FR-001, NFR-001, NFR-002), `.product/ACCEPTANCE-CRITERIA.feature` (`Local-only enforcement` and `corpus.find tool surface` feature blocks), `.product/ADRs/ADR-001-runtime-egress-hook.md`.

This is feature 001: the security primitive and agent-facing surface that all subsequent features depend on. It does NOT include search ranking, ingest, classification, embedding, or install — those are downstream features. What it delivers is **the guarantee that no document leaves the user's machine and the discoverability of the corpus to MCP-aware agents**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — AI agent can discover and connect to the corpus (Priority: P1)

An AI terminal agent (the user's primary workflow consumer) running an MCP-aware client connects to the corpus over stdio and discovers a `corpus.find` tool through the standard tools/list handshake. Without this, no other corpus capability is reachable from the agent.

**Why this priority**: Foundation — every other feature in the system that adds a capability (search, ingest, retrieval) depends on the agent being able to *reach* the corpus through MCP. Without a discoverable tool, the corpus is invisible to its sole consumer.

**Independent Test**: Start the corpus MCP server. Connect an MCP-spec-compliant client over stdio. Issue a `tools/list` request. Verify the response includes exactly one tool named `corpus.find` with input/output schemas advertised. No corpus content needed; this is a handshake test.

**Acceptance Scenarios**:

1. **Given** the corpus MCP server is running over stdio transport, **When** an MCP client issues the standard `tools/list` request, **Then** the response includes a tool named `corpus.find` with an input schema declaring a query field and an output schema describing a SearchHit list.
2. **Given** the corpus MCP server is running, **When** any MCP client attempts to connect over HTTP or SSE transport, **Then** the connection is refused and no inbound-connection event is logged for non-stdio transports.
3. **Given** an MCP client connected over stdio, **When** the client issues `tools/list`, **Then** exactly one tool named `corpus.find` appears in the response (no aliases, no duplicates).
4. **Given** the MCP server is in cold-start (still initializing the index), **When** an MCP client issues `tools/list`, **Then** the server returns a retriable error with code `server_initializing` (not a partial or empty tool list) so MCP clients can implement a clean retry loop.

---

### User Story 2 — User's documents never leave the user's machine during normal operation (Priority: P1)

The user's primary value proposition is that the corpus is *local-first*. During an end-to-end ingest → classify → index → find cycle on a sentinel privileged document, no document content (or hashes thereof) reaches any non-loopback network interface, regardless of the code path that attempts the egress.

**Why this priority**: This is the project's positioning principle (Constitution Principle I) and the David-persona threat model (`.product/ledgers/concerns.jsonl` C-016, C-029). If a document leaks during normal operation, the project's reason to exist is invalidated. P1 alongside US1 because the security guarantee must ship with the agent surface, not after.

**Independent Test**: With the runtime egress guard active, run an ingest → classify → index → find cycle on a sentinel privileged document while capturing packets on every non-loopback interface with `tcpdump`. Verify zero packets attributable to the corpus process during the cycle.

**Acceptance Scenarios**:

1. **Given** the runtime egress guard is active and the corpus pipeline is processing a sentinel privileged document, **When** packet capture runs on every non-loopback interface for the duration of the ingest → classify → index → find cycle, **Then** zero outbound packets attributable to the corpus process appear.
2. **Given** the runtime egress guard is active, **When** test code attempts an outbound connection via any of the six primitives (TCP socket connect, undici dispatcher, UDP via dgram, DNS lookup, http2 connect, TLS connect), **Then** the attempt is blocked at the in-process hook AND a telemetry event records the destination and primitive AND no packet appears on any non-loopback interface.
3. **Given** the corpus MCP server starts, **When** the first ingest, classify, embed, index, or find call occurs, **Then** the egress guard was already registered before that call AND remains active for the entire process lifetime.
4. **Given** a 50-document mixed-workload run, **When** every document is processed end-to-end, **Then** every per-stage transition for every document emits an `egress.checkpoint` telemetry event (proves the guard is always-on, not a sampled spot-check on a sentinel).
5. **Given** test code attempts to create a Worker thread without registering the runtime egress guard in the Worker's entry-point, **When** the Worker creation is attempted, **Then** Worker creation is refused — Workers MUST come pre-registered with the egress guard or not exist at all.
6. **Given** test code spawns a child process that attempts an outbound connection, **When** the OS firewall is consulted, **Then** the connection is rejected at the OS layer AND a telemetry event records the attempt with `result: blocked`.

---

### User Story 3 — Build fails before merge if a developer adds a forbidden network import (Priority: P2)

A project contributor (the user, or a future collaborator) modifies a file in the pipeline or adapter packages and adds an import of a network-calling module (e.g., `node:http`, `node:fetch`, a cloud SDK). CI catches the violation at lint time and fails the build with a clear diagnostic — the egress prevention is enforced by construction, not by reviewer vigilance.

**Why this priority**: Compile-time half of local-only enforcement. P2 because the runtime guard (US2) is the load-bearing safety; the lint catches mistakes earlier. Both layers ship together per ADR-001 (defense in depth).

**Independent Test**: Add an import of `node:http` to a file in the pipeline package. Run the CI lint job. Verify it exits non-zero with a message naming the offending file and the forbidden import.

**Acceptance Scenarios**:

1. **Given** the pipeline and adapter packages contain no forbidden network imports, **When** the CI lint job runs, **Then** the lint job exits with status 0 AND the forbidden-imports count is 0.
2. **Given** a developer adds an import of `node:http` to a pipeline source file, **When** the CI lint job runs on the PR, **Then** the lint job exits non-zero AND the failure message names the offending file and the forbidden import.
3. **Given** a developer adds a forbidden import in any source file under `packages/{pipeline,storage,index,inference,extract}/`, **When** lint runs, **Then** the result is FAIL — the lint scope covers every package on the build-time boundary.

---

### User Story 4 — Native addon allowlist refuses unknown native modules at build (Priority: P2)

A project contributor adds a dependency that pulls in a native `.node` addon making raw POSIX socket calls. The build's native-addon allowlist check refuses the unknown addon, preventing the egress-bypass class of risk that JS-land patching cannot catch.

**Why this priority**: Closes the third egress vector identified by ADR-001 (native addons bypass JS-land hooks). P2 alongside US3 — both are pre-merge gates.

**Independent Test**: Add a dummy native addon to dependencies. Run `build:verify-native-addons`. Verify the build fails with a message identifying the unknown addon outside the allowlist.

**Acceptance Scenarios**:

1. **Given** the only `.node` addons bundled are `better-sqlite3` and `sqlite-vec` (the v1 allowlist), **When** the build runs, **Then** the native-addon verification step passes.
2. **Given** an additional `.node` addon outside the allowlist appears in the bundled output, **When** the build runs, **Then** the build fails AND the diagnostic identifies the unauthorized addon.

---

### User Story 5 — All egress attempts are recorded for forensic review (Priority: P3)

When the runtime hook or the OS firewall blocks an outbound connection attempt, a structured telemetry event is appended to the local telemetry stream. The user can review the record after the fact to understand what was attempted, by what primitive, and to which destination.

**Why this priority**: Forensic record per Constitution Principle XIII (Telemetry-or-Die). P3 because the safety guarantee in US2 is upheld even without telemetry; the telemetry is for trust verification and debugging.

**Independent Test**: Trigger a synthetic egress attempt. Confirm the event appears in the telemetry stream with the expected fields.

**Acceptance Scenarios**:

1. **Given** test code attempts an outbound connection via any of the six primitives, **When** the hook blocks it, **Then** an `egress.blocked` telemetry event is appended with: timestamp, primitive name, destination (host + port), and request id.
2. **Given** a child process attempts an outbound connection, **When** the OS firewall blocks it, **Then** a telemetry event records the attempt with `result: blocked`.

---

### Edge Cases

- **Cold-start ordering**: the egress hook MUST be registered in the entry-point bootstrap *before* any pipeline package is imported, otherwise an import-time network call could escape unhooked. This is verified by Acceptance Scenario US2.3.
- **OS coverage**: install-time OS-firewall provisioning differs between macOS (pf) and Linux (iptables). Both MUST install successfully on supported platforms. Windows is out of scope for v1 (see Assumptions).
- **Existing firewall rules**: the corpus firewall rule MUST be UID-scoped so it coexists with the user's existing rules without conflict.
- **Worker-thread bypass**: a Worker spawned without registering the runtime egress guard would bypass the in-process hook. The system MUST refuse to create Workers that do not pre-register the guard (US2.5).
- **Native addon allowlist evolution**: adding a new native addon to the codebase requires explicit allowlist update. There is no auto-promote path; per Constitution Principle XV, allowlist promotion is a user-acknowledged change.
- **MCP cold-start race**: if `tools/list` arrives before index initialization, the response MUST be a retriable error (US1.4) rather than a partial tool list, so MCP clients can implement a clean retry loop.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 — MCP server registers `corpus.find` over stdio.** The system MUST run as a single MCP server process. The process MUST register exactly one tool named `corpus.find` (no aliases, no duplicates) discoverable via the standard MCP `tools/list` handshake. The tool MUST advertise an input schema with a query field and an output schema describing a SearchHit list. The MCP server MUST register only the stdio transport; HTTP, SSE, and any TCP transport MUST be refused.
- **NFR-001 — Compile-time forbidden-import lint.** The CI lint job MUST scan source files under `packages/{pipeline,storage,index,inference,extract}/` (the pipeline + adapter packages per the architecture's module-boundaries layout) for forbidden network imports (`node:http`, `node:https`, `node:fetch`, `node:net` outbound, cloud-provider SDKs). The lint MUST fail the build when any forbidden import is present, naming the offending file and the import. A clean repo MUST report a forbidden-imports count of 0. The lint MUST run on every PR, not only on the main branch.
- **NFR-002a — Runtime egress hook (six primitives).** The system MUST patch six outbound network primitives at module-load time: `net.Socket.connect`, `undici.Dispatcher`, `dgram.send`, `dns.lookup`, `http2.connect`, `tls.connect`. The hook MUST be active for the entire process lifetime and MUST be registered in the entry-point bootstrap before any pipeline package import. Worker threads MUST register the runtime egress guard in their entry-point; the system MUST refuse to create a Worker without the guard registration. The hook code MUST live in transport/daemon entry-point packages (e.g., `packages/transport/`, `packages/daemon/`), NOT inside `packages/{contracts,core,storage,index,inference,extract,pipeline}/` (Constitution Principle XI: Library/CLI Boundary).
- **NFR-002b — OS-level firewall as install side-effect (defense in depth).** The corpus system MUST be provisioned with a UID-scoped OS firewall rule that rejects outbound non-loopback traffic from the corpus process. Rule shape per ADR-001 §Decision.2: `block out proto {tcp, udp} from any to any user <corpus-uid>` for macOS pf; `OUTPUT -m owner --uid-owner <corpus-uid> -j REJECT` for Linux iptables. The rule MUST be installed automatically by the install script (TR-001, future feature SP-007) — not merely documented as a manual step. SP-007 carries the verification gate `os_firewall_rule_provisioned_during_install_and_blocks_outbound_non_loopback_for_corpus_uid_per_adr_001`. This feature defines the *requirement*; TR-001 implements the install plumbing.
- **NFR-002c — Native addon allowlist (build-time).** The build MUST include a `build:verify-native-addons` step that fails when any bundled `.node` addon is outside the v1 allowlist (`better-sqlite3`, `sqlite-vec`). Adding a new addon to the allowlist MUST require an explicit code change; there is no implicit promotion.
- **NFR-002d — Always-on, all-documents enforcement.** The runtime egress guard MUST be active for every operation on every document, not sampled or sentinel-only. A 50-document mixed-workload run MUST produce per-stage `egress.checkpoint` telemetry for every document.
- **FR-OBS — Egress telemetry events (subset of NFR-016).** Every egress attempt (whether blocked at the in-process hook, at the OS firewall, or successfully reaching loopback) MUST emit a structured telemetry event with: timestamp, primitive name, destination, result (`blocked` / `loopback`), and document id when applicable. SP-001 ships a *subset* of NFR-016's full event surface — specifically the `egress.blocked`, `egress.attempted`, and `egress.checkpoint` event classes. SP-003 (NFR-016) expands telemetry to the full ≥6-class set (validate/ingest/transform/classify/index/search). This feature does NOT ship NFR-016 in full; it ships the egress-class subset that NFR-002 verification requires.

### Key Entities *(include if feature involves data)*

- **MCP request / response**: the JSON-RPC wire format exchanged between an MCP-aware agent and the corpus server over stdio. The relevant message types for this feature are the `tools/list` request and its response, plus the (future) `tools/call` for `corpus.find`.
- **Egress event**: a telemetry record describing one egress attempt. Fields: `event` (`egress.attempted` / `egress.blocked` / `egress.checkpoint`), `timestamp`, `primitive`, `destination_host`, `destination_port`, `result`, `doc_id` (optional), `pipeline_stage` (optional).
- **Forbidden-import set**: the build-time list of network-calling module names that the lint scans for. Defined per ADR-001; immutable for v1.
- **Native-addon allowlist**: the build-time set of permitted `.node` addon names. v1: `better-sqlite3`, `sqlite-vec`.
- **Sentinel privileged document**: a fixture used in the tcpdump verification test; represents a worst-case document the user would NOT want leaving the machine.

## Success Criteria *(mandatory)*

### Verification Strategy

For SP-001 verification, several success criteria depend on infrastructure that future features deliver. To prevent circular dependencies that would block SP-001 from ever passing:

- **OS firewall rule** (SC-004): for SP-001's verification, the rule MAY be installed manually by the developer running the SP-001 verification suite. SP-007 (TR-001) replaces manual install with the automated install side-effect. SC-004 passes when the synthetic `child_process.spawn` egress is blocked by the rule, regardless of whether the rule was installed manually or by the (future) install script.
- **Native-addon allowlist** (SC-005): the build infrastructure required to enforce the allowlist (`build:verify-native-addons` script) is delivered AS PART OF this feature's implementation; it does not depend on a future feature.
- **MCP `tools/list` cold-start error** (US1.4): the server's cold-start error contract is part of FR-001 implementation; no external dependency.
- **Always-on `egress.checkpoint` telemetry** (SC-008): the per-stage hook points exist in this feature's transport/daemon entry-point. Stages downstream of the egress guard (ingest/classify/embed/index) are *future-feature* code paths; for SP-001 verification, SC-008 is satisfied by exercising the find-path stages plus stub fixtures simulating the future stages, demonstrating the guard would fire at every stage transition once those stages exist. SP-005 re-verifies SC-008 against the real end-to-end pipeline.

### Measurable Outcomes

- **SC-001 — Coverage**: For every requirement in scope (FR-001, NFR-001, NFR-002a–d, FR-OBS), at least one Acceptance Scenario in this spec's User Stories passes when executed against the implementation. (The frozen `.product/ACCEPTANCE-CRITERIA.feature` archive predates this spec; this spec's User Stories are the canonical gate per Constitution Source-of-Truth Hierarchy item 5.)
- **SC-002 — Zero packets**: tcpdump capture during an end-to-end ingest → classify → index → find cycle on a sentinel privileged document, on the user's primary machine, shows zero outbound packets on every non-loopback interface.
- **SC-003 — Worker-thread block**: A synthetic Worker-thread egress attempt is blocked by the in-process hook on the user's primary machine; a corresponding `egress.blocked` telemetry event is recorded.
- **SC-004 — Child-process block at OS layer**: A synthetic `child_process.spawn` egress attempt is blocked by the OS firewall on the user's primary machine (Fedora/iptables); a telemetry event records the attempt with `result: blocked`.
- **SC-005 — Native-addon allowlist enforcement**: Adding a dummy native addon outside the allowlist causes the build to fail with a diagnostic identifying the offender.
- **SC-006 — Tool discoverability**: An MCP-spec-compliant client connected to the corpus server over stdio receives a `tools/list` response listing exactly one tool named `corpus.find` with input and output schemas advertised, on every cold-start of the server.
- **SC-007 — Bootstrap ordering**: The egress hook is registered in the entry-point bootstrap before any pipeline package is imported, verified by a startup-order test that fails if the import order is reversed.
- **SC-008 — Always-on enforcement**: A synthetic 50-document fixture exercising the find-path stages plus stub fixtures for the (future) ingest/classify/embed/index stages produces a per-stage `egress.checkpoint` telemetry event for every document at every guard-registered hook point. This proves the guard fires at every stage transition that exists today AND that the hook points are registered for the future stages SP-003/SP-004/SP-005 will deliver. SP-005 re-verifies SC-008 against the real end-to-end pipeline.

## Assumptions

- **Primary user**: shonrs on Fedora workstation (pai-node01) with Claude Code as the primary MCP-aware client. Cross-agent compatibility is a portability property of MCP, not a v1 user-validated guarantee (see Constitution Principle XVI).
- **Supported platforms for v1**: Linux (Fedora baseline; iptables) and macOS (pf). Windows is out of scope for v1.
- **Prerequisite**: SP-000 (NFR-008 retrieval-prompt-template pilot) MUST complete before this feature's implementation phase begins. SP-000 outputs the prompt template version and the NFR-008 N value referenced by future features (SP-002, SP-004); it does not constrain SP-001's implementation but its completion is the SP-001 entry criterion.
- **ADR dependency**: ADR-001 (in-process Node runtime egress hook with six outbound primitives) is `accepted` (date_accepted: 2026-04-26). Implementation follows ADR-001's hybrid approach (in-process hook + OS firewall + native-addon allowlist) — not eBPF/USDT, not OS-firewall-only.
- **UID model**: the corpus runs under the user's UID; the OS firewall rule is UID-scoped. A dedicated `corpus` UID is not required for v1.
- **Install script**: TR-001 (install + first-run UX) is a future feature (SP-007). For SP-001's verification, the OS firewall rule may be installed manually by the developer running the verification tests; SP-007 will automate this for v1 release.

## Out of Scope (deferred to other features)

- **Search ranking and retrieval** (FR-002, FR-003, FR-004) — `corpus.find` SearchHit construction and ranking belongs in feature SP-005.
- **Other MCP resources** (manifest, taxonomy, recent, per-doc) — FR-005..FR-008 in feature SP-002.
- **Inbox watcher and ingest** (FR-010, FR-011, FR-017) — feature SP-003.
- **Classification and metadata schema** (FR-012, FR-013, FR-014) — feature SP-004.
- **Embedding and indexing** (FR-015) — feature SP-005.
- **Idempotency, resumability, failure lane** (FR-016a, FR-016b, FR-018) — feature SP-006.
- **Install / uninstall scripts** (TR-001, TR-002) — feature SP-007.
- **End-user acceptance flows** (UR-001, UR-002, UR-003) — feature SP-008.

This feature delivers the security primitive and the agent-facing surface; it does NOT yet ingest, classify, embed, or rank. A feature 001 implementation will produce a discoverable MCP server that returns an empty SearchHit list (no documents indexed yet) and a hard guarantee that nothing leaves the machine. Subsequent features build the corpus capabilities behind that guarantee.
