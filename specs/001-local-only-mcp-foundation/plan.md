# Implementation Plan: Local-Only Enforcement and MCP Server Foundation

**Branch**: `001-local-only-mcp-foundation` | **Date**: 2026-05-05 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/001-local-only-mcp-foundation/spec.md`

## Summary

Ship the security primitive (no document leaks the user's machine) and the agent-facing surface (MCP `corpus.find` tool discoverable via stdio) so all subsequent features have the egress guarantee in place at startup and a discoverable surface to extend. This plan delivers feature 001 in three layers:

1. **Compile-time enforcement** — CI lint blocks forbidden network imports in `packages/{pipeline,storage,index,inference,extract}/`.
2. **Runtime enforcement** — In-process Node hook patches six outbound primitives at module-load time (per ADR-001); OS-level firewall rule provides defense-in-depth (rule shape per ADR-001 §Decision.2; install plumbing deferred to SP-007); native-addon allowlist enforced at build time.
3. **Agent-facing surface** — A single MCP server process registers exactly one `corpus.find` tool over stdio transport. The tool returns an empty `SearchHit[]` for v1 (no documents indexed yet); ranking and ingest belong to downstream features.

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode); Node.js 20 LTS as primary, 22 LTS for forward compatibility. Bun considered for the SQLite backend per ARCHITECTURE-FINAL §3 (`bun:sqlite` parity with `better-sqlite3`); for SP-001 the runtime is Node only — Bun support is a forward-looking concern that does not gate this feature.
**Primary Dependencies**:
- `@modelcontextprotocol/sdk` (MCP TypeScript SDK) — server transport over stdio, tool/resource/prompt registration, JSON-RPC handling
- `undici` (Node built-in HTTP client; we patch its `Dispatcher` at module-load time)
- `zod` — Zod-derived JSON Schema for the `corpus.find` tool input/output contract and for telemetry event shapes
- `better-sqlite3` — allowlisted native addon (placeholder dependency; not exercised at SP-001 since the index is empty)
- `sqlite-vec` — allowlisted native addon (placeholder; same)
- `vitest` — test runner (fast, ESM-native, parallel by default; replaces the older choice between Jest and Mocha)

**Storage**: SQLite (via better-sqlite3 + sqlite-vec) — declared as a dependency for allowlist enforcement, but the index is empty in SP-001. The SQLite file location resolves through `Paths.indexDb()` (Constitution Principle XIV) once the index ships in SP-005.

**Testing**: vitest for unit + integration. Custom test rigs for: (a) tcpdump packet capture during a synthetic ingest-classify-index-find cycle on a sentinel privileged document, (b) Worker-thread egress refusal, (c) child_process.spawn OS-firewall rejection, (d) MCP `tools/list` handshake using the MCP SDK's test client, (e) build-time native-addon allowlist verification, (f) bootstrap-ordering test (egress hook registered before any pipeline import).

**Target Platform**: Linux (Fedora 43+ baseline; iptables) and macOS (pf). Windows out of scope for v1. Primary user runs on `pai-node01` (Fedora) with Claude Code.

**Project Type**: TypeScript monorepo (npm workspaces). Single project with multiple packages under `packages/`. CLI binary + MCP server are the two transport entry points.

**Performance Goals**:
- Cold-start MCP `tools/list` response: under 200 ms on the user's primary machine (target, not guarantee — per Constitution Principle XVI).
- Egress hook overhead: under 1 ms per intercepted call (target).
- Build-time native-addon verification: under 5 seconds.
- Lint scan over pipeline + adapter packages: under 10 seconds.

**Constraints**:
- Zero outbound non-loopback packets during an ingest-classify-index-find cycle on a sentinel document (NFR-002, hard).
- Zero forbidden imports in pipeline + adapter packages (NFR-001, hard).
- No `process.exit` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/` (Constitution XI, hard).
- All paths via `Paths.*` (Constitution XIV, hard).
- Egress hook MUST be registered before any pipeline package is imported (bootstrap ordering, hard).

**Scale/Scope**:
- Single user, single machine.
- This feature ships ~5 packages: `contracts`, `transport` (MCP), `daemon` (egress hook bootstrap), `cli` (entry-point shell), plus build tooling for the native-addon allowlist + lint rule.
- Lines of code estimate: ~1,500–2,500 (heavily test-side; ADR-001 cites ~80 lines of patching code; the bulk is verification rigs).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be marked `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — This feature *implements* Principle I. Default `InferenceAdapter` and `EmbeddingAdapter` are NOT introduced in SP-001 (those land in SP-004/SP-005); SP-001 ships the enforcement primitives that govern them. No code path in this feature reaches a non-localhost endpoint. Compliance is hard-enforced by the same runtime hook + OS firewall + native-addon allowlist that the principle mandates.
- [x] **II. User Curates, LLM Classifies Metadata** — Feature ships no LLM, no schema fields, no document-body generation. The `corpus.find` tool is a retrieval surface; it returns an empty `SearchHit[]` in v1 (no documents indexed yet). No `synthesis/` namespace, no forbidden frontmatter fields.
- [x] **III. Substrate, Not Surface** — Feature delivers exactly two surfaces: the MCP stdio transport (read-only — no `tools/call` mutations are exposed in this feature; `corpus.find` is a read tool) and the `corpus` CLI (one-shot text only; no TUI). No HTTP server other than MCP stdio. No browser, no HTML.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — No memory, no SaaS, no shared state. The MCP server is a single-process stdio handler. `Paths.data()` is single-tenant.
- [x] **V. Schema-Enforced Structured Output** — `corpus.find` input/output schemas are Zod-derived (see `contracts/mcp-corpus-find.md`); MCP SDK enforces them at the JSON-RPC layer. Telemetry event shapes are Zod-validated before append.
- [x] **VI. One Pipeline, Two Policies** — Feature does NOT introduce a pipeline; pipeline begins at SP-003 (FR-010 inbox watcher). No fork-risk in this feature.
- [x] **VII. Cancellable, Bounded IO** — The MCP server's request handler propagates `AbortSignal` per the SDK contract; the `corpus-find-tool.ts` handler signature includes `AbortSignal` (signature defined in `contracts/egress-hook-api.md` §"Tool handler contract"). The egress hook itself intercepts BEFORE the underlying network call, so cancellation of a blocked attempt is moot — the hook returns a typed `EgressBlockedError` synchronously. Bounded execution: `tools/list` per-request timeout is configured at SDK init time (default: 30s per MCP convention; configurable via `transport.requestTimeoutMs`). No `Promise.race` against `setTimeout` anywhere; no `execSync`.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — SP-001 introduces NO atomic-rename writers (no `tmp + fsync + rename + dirsync` callers). The only disk writes in SP-001 are append-only telemetry events to `Paths.telemetry()`; those are governed by Principle IX (append-atomic JSONL ≤ 4 KB), not VIII. The contracts package defines the `atomicWrite()` and `withTempDir()` helpers as forward-looking primitives that SP-003+ ingest writers will use; they exist as types in SP-001 but are not exercised. Index transaction semantics (FTS5 + docs + sqlite-vec rows committed together) are forward-looking — the index is empty in SP-001 and the index-write code path lands in SP-005.
- [x] **IX. Concurrency-Safe Shared State** — Telemetry append discipline enforces the principle: every `EgressEvent` MUST serialize to ≤ 4 KB before append (POSIX `PIPE_BUF` atomicity guaranteed for `O_APPEND` writes ≤ that size); enforced by `assert(serialized.length <= 4096)` before each `fs.appendFile`. See `contracts/telemetry-egress-events.md` §"Size constraint." `Paths.drainLock()` and SQLite WAL mode are declared in the contracts package as forward-looking primitives; SP-003+ will exercise them. SP-001 is single-process MCP server; multi-process appends remain atomic at the per-record level by the same ≤ 4 KB rule.
- [x] **X. Idempotent Pipeline Transitions; Three-Folder Routing** — No pipeline transitions yet. Three-folder routing (pending/processed/failed) is declared in `Paths` but not exercised.
- [x] **XI. Library/CLI Boundary** — Egress hook code lives in `packages/transport/` and `packages/daemon/` (entry-point packages), NOT in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`. Lint rule rejects `process.exit` in those library paths. The `Result<T,E>` type is defined in `packages/contracts/`.
- [x] **XII. Subprocess Hygiene** — SP-001 defines the `runTool(name, args[], opts)` helper in `packages/contracts/src/run-tool.ts` (signature only; production callers land in SP-003 when extractor subprocesses begin). All SP-001 subprocess spawns (test-time only: `tcpdump` rig in `tests/integration/tcpdump-sentinel.test.ts`, child-process test in `tests/integration/child-process-firewall.test.ts`, `build:verify-native-addons` script) MUST use `runTool` with explicit arg arrays — no `execSync`, no string-formed shell commands. The principle is enforced for SP-001's small subprocess surface and the helper is in place for SP-003+ pipeline subprocess use.
- [x] **XIII. Telemetry-or-Die** — `egress.attempted`, `egress.blocked`, `egress.checkpoint` event classes are defined, schema-validated, and emitted (see `contracts/telemetry-egress-events.md`). The AST-level lint rule enforcing "every catch block emits a structured event" is **deferred to SP-003** when the pipeline introduces enough catch sites to make the rule load-bearing. SP-001 enforces the principle via code-review checklist on PRs touching `packages/transport/` or `packages/daemon/` catch sites; the explicit `EgressBlockedError` caller-error contract in `contracts/telemetry-egress-events.md` §"Caller error contract" prescribes the catch-block telemetry pattern future features will follow.
- [x] **XIV. XDG Paths via Single Resolver** — `Paths` resolver lives in `packages/contracts/src/paths.ts` per ARCHITECTURE-FINAL §2.1. All path references in this feature route through it. Lint rule rejects string literals matching `^/data/` or hardcoded `llm-corpus/` paths.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — No taxonomy in this feature (taxonomy begins SP-004 with FR-014). No hardcoded `enum FacetDomain`.
- [x] **XVI. Validation Honesty** — Performance numbers in this plan are TARGETS not guarantees. README/CLI output for v1 will not claim cross-agent compatibility (Principle XVI explicit). No formal eval harness as a v1 success criterion.

**Result: 16/16 [x]. Complexity Tracking empty.** No principle violations.

**Critique pass disclosure (2026-05-05):** The Constitution Check above was revised after an Architect critique flagged that the original VIII/IX/XII/XIII rationale was inaccurate — VIII conflated absent atomic-rename writers with "no disk writes" (telemetry IS a disk write, governed by IX); XII handwaved test-time subprocess spawns; XIII over-promised the AST lint rule. Revisions tighten each rationale to the actual SP-001 deliverable. The Engineer Constitution-Check audit (run in parallel) reported 13 VERIFIED / 3 WEAK / 0 DISHONEST against the pre-revision draft; post-revision the WEAK count should drop to 0 because the rationales now match content. *This disclosure exists in the plan because honesty about how the Constitution Check was earned is itself a Principle XVI compliance.*

## Project Structure

### Documentation (this feature)

```text
specs/001-local-only-mcp-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification (commit 33bcbcd)
├── research.md          # Phase 0 — consolidates ADR-001 + remaining technical-choice decisions
├── data-model.md        # Phase 1 — egress event, MCP request/response, forbidden-import set, native-addon allowlist
├── quickstart.md        # Phase 1 — verification recipe matching SP-001's 8 exit criteria
├── contracts/
│   ├── mcp-corpus-find.md            # Phase 1 — MCP tool schema (input/output) for corpus.find
│   └── telemetry-egress-events.md    # Phase 1 — egress.{attempted,blocked,checkpoint} event schemas
└── checklists/
    └── requirements.md   # Spec quality checklist (committed at spec time)
```

### Source Code (repository root)

```text
packages/
├── contracts/                    # Pure types — zero IO. Result<T,E>, Paths resolver, error types.
│   └── src/
│       ├── paths.ts              # XDG resolver (Constitution XIV)
│       ├── result.ts             # Result<T,E> type (Constitution XI)
│       └── telemetry.ts          # Telemetry event types (Constitution XIII)
├── transport/                    # MCP stdio transport — egress hook bootstraps here.
│   └── src/
│       ├── index.ts              # Entry-point; registers egress hook BEFORE any pipeline import
│       ├── egress-hook.ts        # Six-primitive runtime hook (per ADR-001)
│       ├── mcp-server.ts         # MCP SDK server with corpus.find tool registration
│       └── corpus-find-tool.ts   # The corpus.find tool handler (returns empty SearchHit[] in SP-001)
├── daemon/                       # Worker-thread egress-guard registration shim.
│   └── src/
│       ├── worker-bootstrap.ts   # Registers egress hook in any spawned Worker
│       └── worker-spawn-guard.ts # Refuses Worker creation without the bootstrap
└── cli/                          # corpus binary entry-point.
    └── src/
        └── index.ts              # Bootstraps egress hook; dispatches to subcommand handlers

build/
├── verify-native-addons.ts       # Build-time allowlist enforcement (better-sqlite3, sqlite-vec only)
└── verify-firewall-rule.sh       # Manual install rig for SP-001 verification (SP-007 automates this)

tests/
├── unit/
│   ├── egress-hook.test.ts        # Six primitives blocked
│   ├── result.test.ts             # Result<T,E> round-trip
│   └── paths.test.ts              # XDG resolution
├── integration/
│   ├── mcp-tools-list.test.ts     # Handshake returns corpus.find with schemas
│   ├── mcp-cold-start-error.test.ts  # server_initializing error code
│   ├── tcpdump-sentinel.test.ts   # Zero packets on non-loopback during sentinel cycle
│   ├── worker-shim-refusal.test.ts # Worker without guard is refused
│   ├── child-process-firewall.test.ts # Child-process egress blocked at OS layer
│   ├── native-addon-allowlist.test.ts # Build fails on unknown .node addon
│   └── bootstrap-order.test.ts    # Hook registered before pipeline import
└── lint-fixtures/
    ├── forbidden-import-fixture.ts # Used by NFR-001 lint test (positive case: should fail lint)
    └── clean-fixture.ts            # Used by NFR-001 lint test (negative case: should pass lint)
```

**Structure Decision**: TypeScript monorepo with npm workspaces. Each package under `packages/` has a `package.json` with strict dependency direction enforced by a build-time check (`packages/contracts` → `packages/transport`/`packages/daemon`/`packages/cli`; lower layers cannot import upper). Pipeline layers (`storage`, `index`, `inference`, `extract`, `pipeline`) are declared as empty stubs in this feature so the lint scope (NFR-001) covers them at SP-001; their content lands in SP-002+.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*Empty — all 16 principles pass without justification.*
