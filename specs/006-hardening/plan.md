# Implementation Plan: Production Hardening — Kill-9 Recovery + `corpus://failures` + Tier 1/2/3 Fallthrough

**Branch**: `006-hardening`
**Date**: 2026-05-13
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/006-hardening/spec.md`

## Summary

Ship the **production-hardening owner** for the post-SP-005 substrate — the FINAL substrate sprint that closes the design-ladder defer items per SP-003/004/005 Out-of-Scope citations and ARCHITECTURE-FINAL §10.6. Three orthogonal deliverables in one sprint, all read-only / idempotent / drain-lock-serialized:

1. **Kill-9 cross-stage recovery** — `packages/pipeline/src/recovery-scanner.ts` (NEW) + `packages/daemon/src/index.ts` startup-hook extension. On daemon restart, BEFORE accepting new ingest work, the recovery scanner acquires `Paths.drainLock()`, reads `Paths.telemetry()` JSONL backwards from end-of-file to the most-recent `daemon.started` marker, builds a `(doc_id, stage) → started-without-completed` orphan map, routes each orphan through the resumability matrix (Decision B), and re-queues resumable orphans into the existing SP-003 → SP-005 idempotent transitions OR writes a `<doc-id>.recovery.error.json` sidecar at `Paths.failed()` for non-resumable cases. Emits ≥ 9 new SP-006 telemetry classes (`recovery.scan_started`, `recovery.scan_completed`, `recovery.scan_skipped`, `recovery.scan_reentry`, `recovery.orphan_found`, `recovery.resumed`, `recovery.aborted`, `recovery.telemetry_parse_failed`, `recovery.aborted_scan`).

2. **`corpus://failures` MCP resource** — `packages/storage/src/failures-resource-adapter.ts` (NEW) + `packages/transport/src/failures-resource-handler.ts` (NEW). The fifth read-only MCP resource alongside SP-002's four (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, `corpus://docs/{id}`). The adapter globs `Paths.failed() + '/*.error.json'` and `Paths.failed() + '/*.recovery.error.json'`, parses each per the SP-003 verbatim schema, applies optional `?stage=`, `?since=`, `?limit=`, `?offset=` filters, returns a Zod-validated `{entries: FailureEntry[], total_count: int, returned_count: int, schema_version: 1}` payload. The `no-writes-from-resource-handlers` ESLint rule is scoped to the new handler + adapter. Per-sidecar malformed-JSON graceful degradation via `failures.sidecar_parse_failed` events.

3. **Tier 1/2/3 fallthrough** — `packages/index/src/tier-orchestrator.ts` (NEW; replaces SP-005's `search.ts` hardcoded Tier 0 path) + `packages/index/src/{bm25-only,catalog-grep,fs-grep}-tier.ts` (NEW × 3) + extension to `packages/storage/src/index-persister.ts` to also append a line to `Paths.data() + '/CATALOG.md'` per indexed document. When Tier 0 (the SP-005 hybrid retriever, unchanged) returns fewer than `[search].min_results` hits (default=3), the orchestrator falls through to Tier 1 (BM25-only against `documents_fts`, < 5 ms target), then Tier 2 (in-process body grep over CATALOG.md, < 50 ms target), then Tier 3 (`runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()])` per Constitution XII subprocess hygiene, < 500 ms target). Aggregate latency budget (default 600 ms) enforced via AbortController. Each SearchHit carries a new `tier_used` enum field; the `search.completed` event payload's `tier_used` is updated from hardcoded `'hybrid'` to the enum. Emits 4 new SP-006 telemetry classes (`search.tier_fallthrough`, `search.tier_skipped`, `search.tier_failed`, `search.tier_budget_exceeded`).

SP-006 is honest about what it produces (recovery + failures-read + tier-fallthrough — all read-only / idempotent / drain-lock-serialized) and what it defers (sidecar mutation surfaces to future sprints, eval-harness to v1.5+, Tier 4+ to future-horizon, recovery from SQLite corruption to v1.5+, cross-corpus federation to never). SP-006 is the FINAL substrate sprint: after merge, the corpus substrate is install-complete (SP-001..SP-006 all on `main`).

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001..SP-005 toolchain unchanged.

**Primary Dependencies** (additive over SP-001 + SP-002 + SP-003 + SP-004 + SP-005):

- `better-sqlite3 ^11.2.0` (existing) — read-only access to `documents_fts` for Tier 1; read-only access to `documents` for Tier 3 path→doc_id reverse mapping. No new SQL writes.
- `zod ^3.23.0` (existing) — `FailureEntryZodSchema`, `FailuresResourceResponseZodSchema`, `FailuresQueryZodSchema` live in `packages/contracts/src/failures-resource-schema.ts` (NEW file). SP-006 telemetry event classes added to the `TelemetryEvent` discriminated union additively (≥ 13 new classes).
- `js-yaml` (existing) — NOT used by SP-006 (sidecars are JSON; recovery telemetry is JSON). Listed for completeness.
- `node:fs/promises` (built-in) — sidecar globbing + parsing for the failures resource; recovery scanner telemetry-log reverse iteration; CATALOG.md append.
- `node:crypto` (built-in) — NOT new in SP-006 (SP-005 introduced SHA-256 query hashing; SP-006 inherits).
- Existing `runTool(name, args[], opts)` helper from SP-001 — used by Tier 3 fs-grep invocation only.

**Storage**: SP-006 ADDS ZERO SQL tables. The recovery scanner reads `Paths.telemetry()` JSONL only. The failures resource reads `Paths.failed()/*.error.json` + `Paths.failed()/*.recovery.error.json` only. The tier cascade reads SP-005's `documents_fts` (Tier 1) + the new `Paths.data() + '/CATALOG.md'` flat file (Tier 2) + `Paths.docs()/**/*.md` body files (Tier 3) only. The CATALOG.md write is a new write target — flat file append, NOT a SQL table; lives at `Paths.data() + '/CATALOG.md'` (a known XDG-compliant path). Drain lock at `Paths.drainLock()` (reused). Failure-lane sidecars at `Paths.failed() + '/<doc-id>.error.json'` (SP-003-written, SP-006-read) + the new `Paths.failed() + '/<doc-id>.recovery.error.json'` (SP-006-written for non-resumable orphans).

**Testing**: vitest (inherits SP-001..SP-005). New SP-006 test surfaces:

- (a) `tests/unit/recovery-scanner.test.ts` — reverse-line iterator; orphan detection from synthetic telemetry; resumability-matrix dispatch;
- (b) `tests/unit/recovery-orphan-resumability.test.ts` — every resumability-matrix case (ingest file-present / ingest file-absent / classify / embed / index / edges-build / scan-reentry);
- (c) `tests/unit/recovery-sidecar-writer.test.ts` — `.recovery.error.json` sidecar shape + idempotent write;
- (d) `tests/unit/failures-resource-schema.test.ts` — FailuresResourceResponse + FailureEntry + FailuresQuery Zod;
- (e) `tests/unit/failures-resource-adapter.test.ts` — sidecar globbing + parsing + filter + sort + pagination; malformed-sidecar graceful skip;
- (f) `tests/unit/failures-resource-handler.test.ts` — MCP resource handler returns validated response; unknown-stage rejection with envelope;
- (g) `tests/unit/tier-orchestrator.test.ts` — Tier 0 → 1 → 2 → 3 cascade; fallthrough triggers; budget enforcement;
- (h) `tests/unit/bm25-only-tier.test.ts` — Tier 1 against `documents_fts`, no dense/graph/confidence;
- (i) `tests/unit/catalog-grep-tier.test.ts` — Tier 2 in-process grep over CATALOG.md; absent-file graceful skip;
- (j) `tests/unit/fs-grep-tier.test.ts` — Tier 3 `runTool('grep', ...)` invocation; path → doc_id reverse mapping; ENOENT graceful handling;
- (k) `tests/unit/catalog-md-generator.test.ts` — CATALOG.md append per-document; idempotent regeneration via `corpus reindex`;
- (l) `tests/unit/telemetry-sp006-classes.test.ts` — Zod round-trip for all 13 new SP-006 event classes;
- (m) `tests/integration/end-to-end-recovery.test.ts` — full daemon kill-9 + restart + recovery scan + re-queue + telemetry assertion against the user's pai-node01;
- (n) `tests/integration/failures-resource-mcp.test.ts` — full MCP-server end-to-end resource read against fixture sidecars;
- (o) `tests/integration/tier-fallthrough-end-to-end.test.ts` — query against corpus with manual table emptying to force each tier; assert tier_used in response + telemetry;
- (p) `tests/integration/recovery-concurrency.test.ts` — concurrent CLI invocations during recovery scan emit lock_contention;
- (q) `tests/integration/tier-budget-exceeded.test.ts` — aggressive budget forces AbortController fire + partial response.

**Target Platform**: Linux (Fedora 43+) and macOS. Windows out of scope. POSIX `grep` binary required on PATH for Tier 3.

**Project Type**: TypeScript monorepo (npm workspaces). SP-006 extends six packages and adds zero new packages:

- `packages/pipeline/` — adds `recovery-scanner.ts` + `recovery-resumability.ts`.
- `packages/index/` — adds `tier-orchestrator.ts` + `bm25-only-tier.ts` + `catalog-grep-tier.ts` + `fs-grep-tier.ts`; the existing `search.ts` is REFACTORED to delegate to the tier orchestrator (the existing Tier 0 hybrid retriever stays the same; the orchestrator wraps it).
- `packages/storage/` — adds `failures-resource-adapter.ts` + extends `index-persister.ts` with the CATALOG.md append.
- `packages/transport/` — adds `failures-resource-handler.ts`; existing four resource handlers unchanged; `corpus-find-tool.ts` handler unchanged (still delegates to the search-orchestrator, which now wraps the tier cascade).
- `packages/contracts/` — adds `failures-resource-schema.ts` (FailureEntry, FailuresQuery, FailuresResourceResponse Zod schemas); extends `telemetry.ts` with the 13 new SP-006 event classes; extends `search-schemas.ts` additively with the `tier_used` enum field on SearchHit.
- `packages/daemon/` — extends `index.ts` startup-hook chain to call `runRecoveryScan()` BEFORE the watcher / classify-hook / embed-hook chains are activated.
- `packages/cli/` — extends `reindex-command.ts` to also regenerate CATALOG.md (additive to the SP-005 backfill loop).

**Performance Goals**:

- Recovery scanner total runtime (typical 1000-10000 event session): under 1 s p95 on pai-node01. Pathological cases bounded by 30 s scan timeout.
- `corpus://failures` resource read on 100-sidecar backlog: under 10 ms p95. On 1000-sidecar backlog: under 100 ms p95. Bounded by `limit` × sidecar-parse cost.
- Tier 0 (hybrid): inherited from SP-005 — under 100 ms p95 honest commitment, sub-20 ms §10.6 aspirational.
- Tier 1 (BM25-only): under 5 ms p95 target per §10.6; sub-25 ms honest commitment.
- Tier 2 (CATALOG.md in-process grep): under 50 ms p95 target per §10.6; sub-150 ms honest commitment.
- Tier 3 (fs-grep via runTool): under 500 ms p95 target per §10.6; sub-1000 ms honest commitment.
- Aggregate cascade latency budget (configurable; default 600 ms): enforced via AbortController.
- CATALOG.md append per-document: under 1 ms (single line append; bounded by fs.appendFile latency).
- SIGTERM → recovery-scanner exit: under 2 s wall-clock (Constitution VII bounded abort).
- Telemetry emission per event: under 1 ms.

All numbers are TARGETS not guarantees per Constitution XVI. The §10.6 per-tier latency targets are aspirational ceilings; SP-006 reports empirical p95 in plan.md's Performance Goals footnote after `tests/integration/tier-fallthrough-end-to-end.test.ts` runs.

**Constraints**:

- Zero outbound non-loopback packets during any recovery / failures-read / tier-cascade stage (Constitution I, hard — inherited from SP-001 egress hook).
- Zero writes outside `Paths.*` (Constitution XIV, hard — `paths-from-resolver-only` lint covers SP-006 source).
- Every IO call accepts `AbortSignal` and propagates it (Constitution VII, hard).
- Recovery scanner + `corpus://failures` resource + tier cascade ALL respect `Paths.drainLock()` semantics (Constitution IX, hard — recovery scanner ACQUIRES the lock; failures resource is read-only and does NOT need the lock; tier cascade is read-only and does NOT need the lock).
- Every state transition emits a Zod-validated telemetry event (Constitution XIII, hard).
- Tier 3 fs-grep is the only subprocess in SP-006 (Constitution XII; `runTool('grep', args[], opts)` with arg array; `no-shell-string-exec` lint covers SP-006 source).
- No `process.exit` in `packages/{contracts,inference,index,storage,pipeline,transport,daemon}/` SP-006 source (Constitution XI, hard).
- Telemetry records ≤ 4096 bytes (Constitution IX, hard).
- Document body content MUST NOT appear in telemetry payloads (Constitution I + SC-HARDEN-024). User query strings continue to be SHA-256-hashed per SP-005 FR-RETRIEVAL-023.
- No new MCP mutation surfaces (Constitution III, hard — `corpus://failures` is read-only by construction; ESLint rule scoped).
- No hardcoded enum FacetDomain (Constitution XV, hard — SP-006 doesn't touch taxonomy).
- The new `tier_used` enum on SearchHit is ADDITIVE — the existing SP-005 fields are preserved; consumers reading `SearchHit` without checking `tier_used` continue to work.

**Scale/Scope**:

- Single user, single machine (Constitution IV).
- Net new code: ~1200-1600 LOC implementation, ~1500-2000 LOC tests + fixtures.
- Net new files: 1 recovery scanner, 1 recovery-resumability helper, 1 failures-resource adapter, 1 failures-resource handler, 1 failures-resource-schema contracts module, 1 tier orchestrator, 3 tier retrievers (BM25-only, CATALOG-grep, fs-grep), 1 CATALOG.md generator helper, ~3 contracts extensions (telemetry classes, errors, search-schemas tier_used), 1 daemon startup-hook extension, 1 reindex-command CATALOG.md extension, ~17 test files.
- Per-feature contract files: 3 ADRs (kill-9 recovery, failures resource, tier fallthrough) + 1 JSON Schema (failures resource response).

**Sizing call**: SP-006 sits below the 2000 LOC / 15 files split threshold. Production surface alone (~1200-1600 LOC across ~13 source files) is under threshold; total surface with tests + fixtures is ~2700-3600 LOC across ~30 files. Per `feedback-build-tier-sizing-rule` (>2000 LOC / >15 files MUST split into N≥2 pre-planned Engineer agent invocations), recommend **single-phase build** when `/speckit-implement` runs; the three orthogonal deliverables (recovery scanner, failures resource, tier fallthrough) can run sequentially or with limited internal parallelism — each is a self-contained ~400-600 LOC surface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-006 introduces ZERO new IO endpoints. Recovery scanner reads `Paths.telemetry()` JSONL (local disk). Failures resource reads `Paths.failed()/*.error.json` (local disk). Tier 0/1 read SQLite (in-process). Tier 2 reads `Paths.data() + '/CATALOG.md'` (local disk). Tier 3 invokes `runTool('grep', ...)` against `Paths.docs()` (local disk). NO HTTP. NO non-localhost destinations. Telemetry records hashes, paths (XDG-relative), durations, stages, doc_ids — NEVER body content nor raw query text (SC-HARDEN-024 inherited from SP-005 SC-RETRIEVAL-016).
- [x] **II. User Curates, LLM Classifies Metadata** — SP-006 does NOT touch body files (the SP-004 classifier remains the only body-file writer; SP-005's frontmatter is unchanged). The CATALOG.md generator (FR-HARDEN-018) writes a flat file at `Paths.data() + '/CATALOG.md'` — NOT a body file. The recovery scanner does NOT modify body files. The Tier 3 grep READS body files (read-only). No new LLM-generated body content introduced.
- [x] **III. Substrate, Not Surface** — SP-006 adds ONE new MCP resource (`corpus://failures`) — READ-ONLY by construction (`no-writes-from-resource-handlers` ESLint rule scoped). ZERO new MCP tools. ZERO new MCP prompts. ZERO new mutation surfaces. The existing `corpus.find` tool is extended internally (tier cascade); its surface (input/output shape) is preserved with an additive `tier_used` field on each SearchHit. Recovery scanner is library-level (triggered by daemon startup, NOT MCP-exposed). CATALOG.md generator is library-level (SP-005 index-persister extension, NOT MCP-exposed). No HTTP server. No TUI. No browser.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — SP-006 reads / writes one local SQLite + reads local body files + reads/writes `Paths.failed()` sidecars + reads/writes `Paths.data() + '/CATALOG.md'`. No conversation memory. No per-session preferences. No SaaS connector. No cross-machine sync. Single-user, single-machine. No federation. No permissions. No roles.
- [x] **V. Schema-Enforced Structured Output** — `FailuresQueryZodSchema` validates `corpus://failures` query parameters at the resource handler boundary; invalid input returns a `validation_error` envelope (FR-HARDEN-010). `FailuresResourceResponseZodSchema` validates the response before serialization. `FailureEntryZodSchema` validates each entry. The new `tier_used: z.enum([...])` field on `SearchHitZodSchema` is Zod-validated. The recovery scanner's parsed telemetry events are Zod-validated via the existing discriminated union. The SP-003 sidecar shape is consumed READ-ONLY through the same Zod-validated `FailureEntryZodSchema`. NO regex extraction from free-form text. NO hand-rolled JSON parsing.
- [x] **VI. One Pipeline, Two Policies** — The recovery scanner's re-queue path invokes the SAME `ingestStage` / `classifyStage` / `embedStage` / `indexStage` / `edgesBuildStage` functions that the daemon hook chain and the CLI invocations use. The recovery-driven re-queue is policy-driven (uses `batchPolicy` per Decision M); the daemon's normal new-ingest path uses `batchPolicy` for SP-003 drain and the CLI uses `interactivePolicy`. One pipeline, two policies — preserved.
- [x] **VII. Cancellable, Bounded IO** — `runRecoveryScan(deps, signal)` takes AbortSignal end-to-end; `signal.throwIfAborted()` between orphan resolutions and between telemetry-log read chunks. The failures resource handler's sidecar globbing + parsing is cancellable. The tier orchestrator wires `setTimeout(() => controller.abort('tier_budget_exceeded'), budget_ms)` + `clearTimeout` on cascade completion (NEVER `Promise.race(setTimeout)`). The Tier 3 `runTool('grep', ...)` invocation propagates signal directly. SIGTERM → 2 s exit budget inherited from SP-003.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — SP-006 introduces ZERO new SQL writes inside index transactions. The recovery scanner's re-queue path uses the existing SP-005 index-persister (which already implements the Constitution VIII transactional contract). The CATALOG.md append happens AFTER the SP-005 SQL transaction commits — it's a flat-file mirror in the same category as the SP-004 body-file frontmatter rewrite (NOT inside the SQL transaction). The failures resource is read-only. The tier cascade is read-only. The `.recovery.error.json` sidecar write is a single fs.writeFile (not a multi-step transaction).
- [x] **IX. Concurrency-Safe Shared State** — The recovery scanner acquires `Paths.drainLock()` BEFORE reading the telemetry log AND BEFORE re-queueing work. Concurrent CLI invocations (`corpus drain`, `corpus reenrich`, `corpus reindex`) during recovery scan emit `pipeline.lock_contention` and exit 0 (FR-INGEST-011 / FR-CLASSIFY-015 / FR-RETRIEVAL-018 contract preserved). Read paths (`corpus://failures`, `corpus.find` queries) are NOT gated by the drain-lock (Constitution III: substrate reads are non-blocking). Single serialization point preserved.
- [x] **X. Idempotent Pipeline Transitions** — The recovery scanner is itself idempotent: re-running it produces the same orphan set + re-queues the same work; the re-queued work's underlying transitions (classify / embed / index / edges-build) are all idempotent per the SP-003/004/005 atomic contracts. The CATALOG.md regeneration (via `corpus reindex`) is idempotent: re-running on an existing CATALOG.md produces the same lines. The `corpus://failures` resource is pure-read: idempotent by construction. The tier cascade is read-only: idempotent.
- [x] **XI. Library/CLI Boundary** — Zero `process.exit` in `packages/{contracts,inference,index,storage,pipeline,transport,daemon}/` SP-006 source. Library functions return `Result<T, E>` or throw typed errors (`RecoveryScanError`, `FailuresResourceError`, `TierFallthroughError`, `CatalogMissingError`, `GrepSubprocessError`, `RecoveryOrphanUnresumableError`). Only `packages/cli/` may exit. The daemon's `startDaemon()` propagates recovery errors as throws to its CLI caller (`packages/cli/src/daemon-command.ts`).
- [x] **XII. Subprocess Hygiene** — Tier 3's fs-grep is the only subprocess in SP-006. Invoked via `runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()], {signal, timeoutMs})` — arg array, never a string-formed shell command. The `<pattern>` is the query string escaped for grep (no shell expansion). The `<path>` is a literal `Paths.docs()` value (no shell expansion). The `no-shell-string-exec` ESLint rule covers SP-006 source. No `execSync`. No `child_process.exec`.
- [x] **XIII. Telemetry-or-Die** — ≥ 13 new SP-006 telemetry event classes (9 recovery.* + 4 search.tier_* per FR-HARDEN-005 + FR-HARDEN-019; plus the SP-005 `search.completed` `tier_used` field update). Every catch block in SP-006 source emits a structured event before returning or re-throwing (existing AST-level lint covers SP-006). Each event is ≤ 4096 bytes (Constitution IX). Recovery telemetry never carries body content nor raw query text.
- [x] **XIV. XDG Paths via Single Resolver** — SP-006 reuses existing getters only: `Paths.failed()` (recovery sidecars + failures resource source), `Paths.telemetry()` (recovery scanner JSONL), `Paths.docs()` (Tier 3 grep target), `Paths.data()` (CATALOG.md location), `Paths.drainLock()` (recovery serialization), `Paths.inbox()` (recovery ingest-orphan resumability check). ZERO new XDG bases. The `paths-from-resolver-only` ESLint rule covers SP-006 source.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — SP-006 does NOT touch `taxonomy_terms` (SP-004-owned). The classifier's vocabulary contract from SP-004 is preserved. No hardcoded `enum FacetDomain` introduced. The new `tier_used` enum on SearchHit is a TIER-name enum, not a taxonomy axis — explicitly out of scope of Principle XV.
- [x] **XVI. Validation Honesty** — All per-tier latency numbers are TARGETS (§10.6 aspirational). SP-006 honest commitments are 5x the aspirational ceilings, measured empirically and reported in plan.md footnote. The "100-sidecar < 10 ms" failures-resource read claim is a target measured at implementation time. No cross-agent compatibility claims. No formal retrieval-eval harness as v1 success criterion. The README, CLI `--help`, and docs explicitly state: "Tier latency budgets per §10.6 are TARGETS, not guarantees." The CATALOG.md is documented as a TIER 2 INPUT, not a "marketing-grade corpus summary" — its job is to be a flat-file index for Tier 2 grep, nothing more.

**Result**: 16/16 [x]. Complexity Tracking: empty.

## Project Structure

### Documentation (this feature)

```
specs/006-hardening/
├── plan.md          # This file (/speckit-plan command output)
├── research.md      # Phase 0 output (/speckit-plan command)
├── data-model.md    # Phase 1 output (/speckit-plan command)
├── quickstart.md    # Operator walkthrough (kill-9 sim + corpus://failures + force-fallthrough)
├── contracts/       # Phase 1 output (/speckit-plan command)
│   ├── adr-kill9-recovery.md
│   ├── adr-failures-resource.md
│   ├── adr-tier-fallthrough.md
│   └── failures-resource-schema.json
├── checklists/
│   └── requirements.md
└── tasks.md         # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```
packages/
├── contracts/
│   └── src/
│       ├── failures-resource-schema.ts  # NEW — FailureEntryZodSchema + FailuresQueryZodSchema + FailuresResourceResponseZodSchema
│       ├── telemetry.ts                  # EXTENDED — 13 new SP-006 event classes additively in TelemetryEvent discriminated union
│       ├── errors.ts                     # EXTENDED — 6 new typed errors (RecoveryScanError, RecoveryOrphanUnresumableError, FailuresResourceError, TierFallthroughError, CatalogMissingError, GrepSubprocessError)
│       └── search-schemas.ts             # EXTENDED — tier_used enum field added to SearchHitZodSchema; SearchOutputZodSchema's tier_used updated from z.literal('hybrid') to z.enum([...])
├── pipeline/
│   └── src/
│       ├── recovery-scanner.ts           # NEW — runRecoveryScan(deps, signal); reverse-line telemetry iteration; orphan detection
│       └── recovery-resumability.ts      # NEW — resumability-matrix dispatcher; routes orphans to re-queue or fail-clean
├── index/
│   └── src/
│       ├── tier-orchestrator.ts          # NEW — Tier 0 → 1 → 2 → 3 cascade with budget enforcement
│       ├── bm25-only-tier.ts             # NEW — Tier 1 BM25-only over documents_fts
│       ├── catalog-grep-tier.ts          # NEW — Tier 2 in-process grep over CATALOG.md
│       ├── fs-grep-tier.ts               # NEW — Tier 3 runTool('grep', ...) over Paths.docs()
│       └── search.ts                     # REFACTORED — delegates to tier-orchestrator; the existing four-signal hybrid retriever stays the Tier 0 implementation
├── storage/
│   └── src/
│       ├── failures-resource-adapter.ts  # NEW — sidecar globbing + parsing + filter/sort/paginate
│       ├── index-persister.ts            # EXTENDED — CATALOG.md append-after-commit (FR-HARDEN-018)
│       └── catalog-md-generator.ts       # NEW — formatCatalogLine() helper; atomic append via withTempDir
├── transport/
│   └── src/
│       └── failures-resource-handler.ts  # NEW — MCP resource handler delegating to failures-resource-adapter
├── daemon/
│   └── src/
│       └── index.ts                       # EXTENDED — startDaemon() startup-hook calls runRecoveryScan() BEFORE accept-new-work
└── cli/
    └── src/
        └── reindex-command.ts             # EXTENDED — CATALOG.md regeneration as part of the backfill loop

tests/
├── unit/
│   ├── recovery-scanner.test.ts
│   ├── recovery-orphan-resumability.test.ts
│   ├── recovery-sidecar-writer.test.ts
│   ├── failures-resource-schema.test.ts
│   ├── failures-resource-adapter.test.ts
│   ├── failures-resource-handler.test.ts
│   ├── tier-orchestrator.test.ts
│   ├── bm25-only-tier.test.ts
│   ├── catalog-grep-tier.test.ts
│   ├── fs-grep-tier.test.ts
│   ├── catalog-md-generator.test.ts
│   ├── telemetry-sp006-classes.test.ts
│   └── search-hit-tier-used.test.ts
├── integration/
│   ├── end-to-end-recovery.test.ts
│   ├── failures-resource-mcp.test.ts
│   ├── tier-fallthrough-end-to-end.test.ts
│   ├── recovery-concurrency.test.ts
│   └── tier-budget-exceeded.test.ts
└── fixtures/
    └── sp006-hardening/
        ├── orphaned-telemetry.jsonl
        ├── fixture-sidecars/*.error.json
        ├── synthetic-catalog.md
        └── README.md
```

## Phase 0 — Research

See [`research.md`](./research.md) for the full decision log. Headlines (Decisions A through J resolved per the dispatch context's pre-resolved-decisions block):

- **A. Recovery detection algorithm** — reverse-line iterator over `Paths.telemetry()` JSONL bounded by the most-recent `daemon.started` marker; build `(doc_id, stage)` orphan map.
- **B. Resumability matrix** — ingest (resumable IF inbox file present; non-resumable otherwise); classify / embed / index / edges-build (ALL resumable by Constitution X idempotency contracts).
- **C. `corpus://failures` resource URI** — query parameters `?stage=<stage>&since=<ISO date>&limit=<int>&offset=<int>`; defaults stage=*, since=unbounded, limit=50, offset=0.
- **D. Tier fallthrough trigger** — Tier 0 returns < `[search].min_results` (default=3) → fall to Tier 1; Tier 1 < min → Tier 2; Tier 2 < min → Tier 3; aggregate budget 600 ms.
- **E. Per-tier latency budgets** — §10.6 verbatim: Tier 0 <20ms (SP-005 already), Tier 1 <5ms, Tier 2 <50ms, Tier 3 <500ms. Per Constitution XVI honesty: TARGETS.
- **F. Recovery + drain-lock coordination** — scanner acquires `Paths.drainLock()` at startup; releases after recovery; concurrent CLI invocations during recovery emit `pipeline.lock_contention` exit 0.
- **G. CATALOG.md generation** — auto-generated at SP-005 index-stage time (additive); regenerated by `corpus reindex`; if absent (legacy DB), Tier 2 emits `search.tier_skipped` and proceeds to Tier 3.
- **H. fs-grep (Tier 3)** — `runTool('grep', ['-rn','-l','--include=*.md', <pattern>, Paths.docs()], {signal, timeoutMs})` per Constitution XII; bounded by per-tier timeout.
- **I. `corpus://failures` schema versioning** — `schema_version: 1` field; future SP-007+ can evolve additively.
- **J. Failures-resource read latency** — bounded by sidecar count × parse cost; <100ms on 1000-sidecar backlog at default limit.

## Phase 1 — Design Artifacts

See [`data-model.md`](./data-model.md) for the entity catalog and the four new SP-006 entities (RecoveryOrphan, FailureEntry, TierResult, TierFallthroughTelemetry).

See [`contracts/`](./contracts/) for the three ADRs (kill-9 recovery + failures resource + tier fallthrough) and the JSON Schema (failures resource response).

See [`quickstart.md`](./quickstart.md) for the operator walkthrough (simulate kill-9 mid-classify, restart daemon, observe recovery in logs; read `corpus://failures` via MCP; force Tier 0 empty and observe fallthrough).

See [`checklists/requirements.md`](./checklists/requirements.md) for the 16-principle pass/fail + anti-scope verification.

## Risk Register

- **R1 (low) — `grep` binary missing on PATH.** Mitigation: Tier 3 emits `search.tier_failed` with `errno='ENOENT'` and returns prior tiers' results. The other three tiers still function. Acceptable degradation.
- **R2 (low) — Telemetry log corruption from concurrent JSONL appends.** Mitigation: SP-001 telemetry-writer is already append-atomic per Constitution VIII; the recovery scanner gracefully skips malformed lines via `recovery.telemetry_parse_failed` events. The scan still completes with the well-formed events.
- **R3 (medium) — Recovery race condition: daemon process A's old session events being read by daemon process B's recovery scan.** Mitigation: the `daemon.started` marker bounds the scan window; only events within the previous session are inspected. A daemon that didn't emit a `daemon.started` event (programming error) wouldn't have its orphans recovered — but the SP-001 daemon-startup contract requires this event, so this case is structurally prevented.
- **R4 (low) — Tier 3 grep returns massive result set on very large corpus.** Mitigation: `runTool` invocation includes `-l` flag (file paths only, not match lines) and the orchestrator caps results at `policy.topKPerRetriever` (default 64). The path→doc_id reverse mapping is bounded.
- **R5 (medium) — CATALOG.md grows unboundedly (one line per indexed doc).** Mitigation: at 100k docs × ~200 chars/line = ~20 MB; Tier 2's in-process grep is still sub-50ms on this size. Beyond 1M docs, the operator should consider sharding (deferred to future-horizon).
- **R6 (low) — `.recovery.error.json` sidecars accumulate forever.** Mitigation: documented in spec.md Out-of-Scope; future sprint may add cleanup CLI.
- **R7 (low) — SearchHit `tier_used` field addition breaks existing consumers.** Mitigation: the new field is OPTIONAL in the v1 enum sense (it's a string enum; consumers that ignore unknown fields are unaffected). The Zod schema-version bump on SearchHit is `additive`; downstream MCP clients that strict-parse SP-005's SearchHit will get the new field and ignore it (standard MCP behavior).
- **R8 (medium) — Recovery scan + daemon-startup race.** Mitigation: the daemon's `startDaemon()` AWAITS `runRecoveryScan()` before activating any watchers / hooks; no concurrent classify-stage hook can fire while recovery holds the lock.
- **R9 (low) — Aggregate latency budget exhausted before Tier 3 even starts.** Mitigation: per-tier budget allocation respects the §10.6 per-tier targets; if Tier 0+1+2 exhaust 75ms, Tier 3 has 500ms left. Worst-case budget exhaustion is documented in `search.tier_budget_exceeded` telemetry.

## Performance Goals (Honest Commitments — Constitution XVI)

| Metric | §10.6 Aspirational | SP-006 Honest Commitment | Measurement |
|---|---|---|---|
| Tier 0 hybrid p95 | <20 ms | <100 ms | inherited from SP-005 |
| Tier 1 BM25-only p95 | <5 ms | <25 ms | empirical at impl time |
| Tier 2 CATALOG.md grep p95 | <50 ms | <150 ms | empirical at impl time |
| Tier 3 fs-grep p95 | <500 ms | <1000 ms | empirical at impl time |
| Aggregate cascade budget (configurable) | 600 ms | enforced | AbortController-driven |
| Recovery scan p95 (typical session) | n/a | <1 s | empirical at impl time |
| `corpus://failures` p95 (100 sidecars) | n/a | <10 ms | empirical at impl time |
| `corpus://failures` p95 (1000 sidecars) | n/a | <100 ms | empirical at impl time |

Specific empirical p95s recorded post-implementation in this footnote.

## Complexity Tracking

*Empty (16/16 Constitution principles pass without exception).*

## Phase Gates

- **Phase 0 → Phase 1 gate**: All Decisions A through J resolved in research.md.
- **Phase 1 → Phase 2 gate**: Constitution Check 16/16 [x]; data-model.md entities specified; contracts/ ADRs authored.
- **Phase 2 → Phase 3 gate** (post-/speckit-tasks): tasks.md authored; tasks coverage-matrix covers every FR-HARDEN and SC-HARDEN.
- **Phase 3 → merge gate** (post-/speckit-implement): all tasks complete; npm run build + lint + test all green; quickstart walked; CLAUDE.md "SP-006 surface" section added.

## Progress Tracking

- [x] Phase 0 — Research complete (research.md)
- [x] Phase 1 — Design artifacts complete (data-model.md, contracts/, checklists/requirements.md, quickstart.md)
- [ ] Phase 2 — Tasks generated (tasks.md) — pending `/speckit-tasks`
- [ ] Phase 3 — Implementation complete — pending `/speckit-implement`
- [ ] Phase 4 — Merge to main — pending all phase gates
