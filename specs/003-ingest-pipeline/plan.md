# Implementation Plan: Inbox Watcher + Ingest Pipeline (Validation, Normalization, Content-Hash Idempotency)

**Branch**: `003-ingest-pipeline`
**Date**: 2026-05-12
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/003-ingest-pipeline/spec.md`

## Summary

Ship the **producer side** of the corpus: a filesystem-watcher-driven, validation-gated, content-hash-idempotent, atomic-write ingest pipeline that lands normalized Markdown documents in the canonical store and emits ≥6 named telemetry event classes covering both success and failure paths. SP-001 made the corpus *reachable* (egress sealed, MCP server registered). SP-002 made the corpus *legible* (manifest/taxonomy/recent/per-doc resources against an empty index). SP-003 makes the corpus *populated* — dropping a file into `Paths.inbox()` results in a `documents` row, a normalized Markdown body in the canonical store, and structured telemetry, without further user action and without any LLM in the loop.

Three-layer delivery:

1. **Validation gate + watcher** — Linux/macOS-portable filesystem watcher monitoring `Paths.inbox()` (initial-scan + ongoing detection). Files pass through a fixed-order validation gate (filename sanity → extension check → MIME sniff → size limit) before any content read past the cutoff. Disallowed-MIME, mismatch, oversize, and filename-sanity rejections route to `Paths.failed()` with a structured `.error.json` sidecar.
2. **Hash + normalize + persist** — Validated files atomically move to `Paths.pending()`, get full-file SHA-256 hashed (ADR-002, defense-in-depth via `documents.hash UNIQUE`), normalize to Markdown + YAML frontmatter via the FR-008 minimum surface, write to a deterministic path under the canonical store via the existing `withTempDir`-mediated atomic-write primitive, and commit the row + body file in a single SQLite transaction. Duplicate content (same hash) short-circuits to a `ingest.dedup_hit` no-op.
3. **Telemetry + drain serialization** — Every state transition emits a structured event registered in the Zod telemetry discriminated union under a new `ingest.*` / `inbox.*` event-class family. The drain process serializes via `flock(LOCK_EX | LOCK_NB)` on `Paths.drainLock()`; concurrent invocations emit `pipeline.lock_contention` and exit cleanly. Cancellable IO is mandatory throughout (`AbortSignal` propagated end-to-end; SIGTERM → `controller.abort()` → in-flight ingests marked `failed` with `error_code='aborted'`).

SP-003 is honest about what it produces (raw frontmatter with sentinel classifier columns — `facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`, `source_type='inbox-filesystem'`) and what it defers (semantic classification to SP-004, embedding/ranking to SP-005, kill-9 survival and `corpus://failures` MCP resource to SP-006).

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001/SP-002 toolchain.

**Primary Dependencies** (additive over SP-001 + SP-002):
- `chokidar ^3.6.0` (NEW dependency) — filesystem watcher, cross-platform (uses `inotify` on Linux, `FSEvents` on macOS, polling fallback). Pure JS + optional `fsevents` peer (macOS only); no native-addon allowlist impact on Linux. Decision E in `research.md`.
- `pdf-parse ^1.1.1` (NEW dependency, invoked via `runTool` subprocess) — PDF text extractor. Wrapped in a vendored CLI shim under `tools/pdf-extractor/` so Constitution XII (subprocess hygiene) holds end-to-end; the pipeline never `require`s `pdf-parse` directly. Decision F in `research.md`.
- `turndown ^7.2.0` (NEW dependency) — HTML→Markdown converter, pure JS, deterministic output with configured rules. In-process (no subprocess needed for pure-JS deterministic conversion). Decision G in `research.md`.
- `file-type ^19.0.0` (NEW dependency) — MIME-sniff from magic bytes, pure JS. Already named in ADR-007.
- `better-sqlite3 ^11.2.0` (existing, allowlisted) — index writer connection (WAL writer lock during the per-document transaction).
- `js-yaml` (existing, SP-002) — YAML frontmatter codec (existing helper `parseMarkdownWithFrontmatter` / `stringifyMarkdownWithFrontmatter`).
- `zod ^3.23.0` (existing) — new SP-003 telemetry event class schemas added to the `TelemetryEvent` discriminated union.

**Storage**: SP-002 SQLite index file at `Paths.indexDb()` (currently empty after SP-002; SP-003 populates `documents` rows). Canonical body files under `Paths.docs() + '/store/'` (a new SP-003-introduced subdirectory under the existing `Paths.docs()` umbrella; deterministic per-id layout — see `data-model.md`). Telemetry JSONL at `Paths.telemetry()` (existing). Drain lock at `Paths.drainLock()` (existing path). Failure-lane sidecars at `Paths.failed() + '/<filename>.error.json'`.

**Testing**: vitest (inherits SP-001/SP-002). New SP-003 test surfaces: (a) `tests/unit/inbox-watcher.test.ts` — watcher debounce + initial-scan + atomic-rename detection; (b) `tests/unit/validation-gate.test.ts` — filename sanity / extension / MIME-sniff / size-limit ordering and short-circuit; (c) `tests/unit/normalizer-{pdf,html,md,txt}.test.ts` — per-MIME deterministic normalization; (d) `tests/unit/hasher.test.ts` — stream SHA-256 + cancellability + the F-10 60-MB identical-prefix-different-tail adversary; (e) `tests/unit/drain-lock.test.ts` — flock acquisition, contention, release on SIGTERM; (f) `tests/integration/end-to-end-ingest.test.ts` — drop one PDF + MD + TXT + HTML, assert four `documents` rows + four body files + per-doc telemetry; (g) `tests/integration/dedup-content-hash.test.ts` — duplicate detection + ADR-002 F-10 adversary; (h) `tests/integration/failure-lane.test.ts` — every rejection class produces a sidecar; (i) `tests/integration/telemetry-coverage.test.ts` — mixed-workload run produces ≥6 distinct event classes + telemetry-write-failure honesty path; (j) `tests/integration/concurrency.test.ts` — concurrent drain processes; one acquires lock + processes, the other emits `lock_contention` and exits 0; (k) `tests/integration/sigterm-abort.test.ts` — SIGTERM mid-ingest aborts within 2s with `error_code='aborted'`.

**Target Platform**: Linux (Fedora 43+) and macOS. Windows out of scope for v1.

**Project Type**: TypeScript monorepo (npm workspaces). SP-003 grows three existing packages and extends two:
- `packages/pipeline/` — grows from pilot-harness-only stub to functional (watcher, drain orchestrator, validation gate, hasher, persister, abort/lock coordinator).
- `packages/extract/` — grows from empty stub to functional (PDF / HTML / Markdown / plain-text normalizers; per-MIME dispatch).
- `packages/storage/` — extends `document-adapter.ts` with `insertDocument(row, signal)` write-side adapter; adds `unique-hash-migration.ts` for the `documents.hash UNIQUE` constraint.
- `packages/contracts/` — extends `telemetry.ts` with the new SP-003 event classes (`inbox.allowlist_hit`, `inbox.allowlist_miss`, `inbox.mime_mismatch`, `inbox.size_exceeded`, `inbox.filename_sanity_failed`, `inbox.watcher_resource_exhausted`, `ingest.dedup_hit`, `ingest.dedup_miss`, `ingest.normalized`, `ingest.completed`, `ingest.file_unstable`, `ingest.aborted`, `pipeline.lock_contention`, `persist.failed`). Also extends `errors.ts` with `IngestError` / `ValidationError` / `NormalizeError` / `PersistError` / `WatcherError` typed errors.
- `packages/daemon/` — adds the SP-003 daemon entry point that owns the watcher lifecycle (SIGTERM coordination, single drain loop, AbortController wiring). The daemon is the only `process.exit` site in the SP-003 surface (Constitution XI).

**Performance Goals**:
- Watcher detection latency (file landed → drain enqueue): under 200 ms p95 on `inotify` backend; under 1.5 s on polling fallback (macOS without `fsevents`).
- Per-document ingest wall-clock (validation → hash → normalize → persist), excluding classification/embedding: under 5 s p95 for PDF up to 60 MB; under 500 ms p95 for MD/TXT/HTML up to 5 MB. Hash dominates large-PDF case at ~250 ms / 60 MB per ADR-002.
- Drain-lock acquisition: under 50 ms warm; under 200 ms on first cold daemon boot (Constitution IX flock semantics).
- SIGTERM → process exit: under 2 s wall-clock (Constitution VII bounded abort).
- Telemetry emission per event: under 1 ms (inherits SP-002 append-only JSONL discipline).

All numbers are TARGETS not guarantees per Constitution XVI; CI benchmark on the primary user's hardware establishes whether they're met. The SP-003 per-document budget MUST sit inside the NFR-014 90-second first-run envelope minus the SP-004/SP-005 share; the explicit number is finalized at implementation time once classifier wall-clock is empirically measured. SP-003 commits to *documented, measured, within budget* — not to a specific p95 number.

> **T085 measurement footnote (2026-05-12, pai-node01)**: Empirical per-document wall-clock measured by `tests/integration/per-doc-budget.test.ts` against a mixed-MIME fixture set of 30 small documents (10× Markdown + 10× plain-text + 10× HTML, each <5 KB). Total wall-clock: ~509 ms; mean per-doc: ~17 ms. Comfortably within the 500 ms plan target for MD/TXT/HTML up to 5 MB. PDF wall-clock not measured here (pdf-parse subprocess invocation dominates and is bounded by the per-stage timeout). Re-run via `npx vitest run tests/integration/per-doc-budget.test.ts`.

**Constraints**:
- Zero outbound non-loopback packets during any ingest stage (Constitution I, hard — inherited from SP-001 egress hook).
- Zero writes outside `Paths.*` (Constitution XIV, hard — `paths-from-resolver-only` lint covers SP-003 source).
- Every IO call accepts `AbortSignal` and propagates it (Constitution VII, hard — `no-promise-race-settimeout` lint covers SP-003 source).
- Every disk write atomic via `withTempDir` + `tmp + fsync + rename + dirsync` (Constitution VIII, hard).
- Documents-row insert + body-file rename to canonical store commit in one SQLite transaction or both fail (Constitution VIII, hard).
- Every state transition emits a Zod-validated telemetry event (Constitution XIII, hard).
- Subprocess invocations (PDF extractor) route through `runTool` only (Constitution XII, hard — `no-shell-string-exec` lint covers SP-003 source).
- No `process.exit` in `packages/pipeline/`, `packages/extract/`, `packages/storage/`, `packages/contracts/` (Constitution XI, hard — existing SP-001 lint covers SP-003).
- Telemetry records ≤ 4096 bytes (Constitution IX, hard — existing `TelemetrySizeExceededError` covers SP-003 events).
- Document body content MUST NOT appear in telemetry payloads (Constitution I + SC-INGEST-014).

**Scale/Scope**:
- Single user, single machine (Constitution IV).
- Net new code: ~1500–2200 LOC implementation, ~2800–4200 LOC tests + fixtures (test-heavy by SP-002 precedent — IO-heavy surface, multiple failure modes per stage).
- Net new files: 1 watcher source, 1 drain orchestrator, 1 validation gate, 1 hasher, 4 normalizers (PDF / HTML / MD / TXT), 1 persister, 1 daemon entry-point, 1 unique-hash migration, ~3 contracts extensions (telemetry classes, errors, frontmatter helper), ~12 test files, 1 vendored PDF extractor CLI shim under `tools/pdf-extractor/`, ~10 fixture files.
- Per-feature contract files: 6 (one Gherkin feature per spec area: inbox-watcher, validation-gate, normalize, idempotency, failure-lane, telemetry).

**Sizing call**: SP-003 sits **above** the 2000 LOC / 15 files split threshold. Production surface alone (~1500–2200 LOC across ~14 source files plus the vendored CLI shim) is borderline; total surface (incl. tests + fixtures) is ~4500–6500 LOC across ~30 files. Recommend **2-dispatch split** at Phase 3 boundary: Dispatch 1 = Phases 0–2 (prerequisites + setup + tests-first), Dispatch 2 = Phases 3–5 (core implementation + integration + polish). The split point is natural — Dispatch 1's failing-RED test suite is the input contract for Dispatch 2's GREEN implementation. (Per `feedback-build-tier-sizing-rule`.)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). `[~]` indicates a partial dependency that a Phase 0 PREREQ task lifts to `[x]` before `/speckit-implement` begins. All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-003 introduces zero non-localhost code paths. Watcher reads local filesystem only. Hash + normalize + persist are entirely on-disk. PDF subprocess via `runTool` runs the vendored extractor against a local file; no network call. The SP-001 egress hook intercepts all outbound primitives at module-load time; any accidental network call from a normalizer or extractor hard-fails with `EgressBlockedError` and emits `egress.blocked` telemetry. Telemetry records the SHA-256 hash and file paths only — never body content (SC-INGEST-014 enforced by integration test).
- [x] **II. User Curates, LLM Classifies Metadata** — SP-003 introduces zero LLM-generated content. The normalizers are deterministic byte-transformers: PDF→text (pdf-parse), HTML→Markdown (turndown with fixed rules), Markdown passthrough, plain-text wrapping. Body files in the canonical store are byte-identical to the deterministic normalization of inbox source bytes (SC-INGEST-020 enforced by integration test). SP-003 populates only the FR-008 minimum frontmatter (`id`, `source_path`, `ingest_timestamp`, `mime_type`, `hash`); classifier-owned columns get documented sentinel values that SP-004 overwrites — NO `origin`, `provenance_*`, `confidence`, `captured_at`, `corpus capture` fields. No `synthesis/` namespace.
- [x] **III. Substrate, Not Surface** — SP-003 introduces zero new surfaces. No HTTP server, no TUI, no browser, no HTML output. FR-INGEST-012 commits to zero MCP mutation surfaces — files arrive via filesystem operation; the MCP server remains read-only per Constitution III (the SP-002 resource layer continues to be the only MCP-visible surface). The daemon is a long-lived process that owns the watcher, not a user surface.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — SP-003 watches one local filesystem path (`Paths.inbox()`). No cross-user inbox, no shared inbox, no remote inbox. No conversation memory, no per-session preferences, no SaaS connector. The frontmatter SP-003 writes carries only durable knowledge metadata.
- [x] **V. Schema-Enforced Structured Output** — Every SP-003 telemetry event class is registered in the existing `TelemetryEvent` Zod discriminated union (additive — see `data-model.md`). Every event validates via `emitTelemetry` before append (existing `TelemetryValidationError` covers SP-003 events). The frontmatter Markdown codec routes through the single project YAML helper (`packages/contracts/src/markdown-frontmatter.ts`) — no hand-rolled YAML, no regex frontmatter extraction. The `documents` row insert via `insertDocument(row, signal)` validates the row against an `InsertDocumentInput` Zod schema before binding to the prepared statement.
- [x] **VI. One Pipeline, Two Policies** — SP-003 ships ONE pipeline. Interactive-style ingest (`corpus drain` CLI invocation by the user) and autonomous-style ingest (the SP-003 daemon's watcher-triggered drain) share the same drain-loop function with two named policies (`interactivePolicy` / `batchPolicy`) governing timeouts, retry, progress emission. No forked code path. Decision H in `research.md` codifies the policy shape.
- [x] **VII. Cancellable, Bounded IO** — Every IO call in the SP-003 pipeline accepts `AbortSignal` and propagates it: `chokidar.watch()` lifecycle bound to the daemon's master `AbortController`; `fs.createReadStream` for hashing piped through `pipeline()` with the signal; `runTool` (PDF subprocess) already propagates signal per its SP-001 contract; SQLite prepared-statement steps check `signal.throwIfAborted()` between rows; atomic-rename helper accepts signal. SIGTERM → master controller `abort()` → in-flight ingests routed to `failed/` with `error_code='aborted', retriable=true` → process exit within 2 s (SC-INGEST-016 enforced by integration test). NO `Promise.race(setTimeout)`; NO `execSync`; per-document and per-stage timeouts configurable via `config.toml`.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — Body-file writes go through the existing `withTempDir` helper (`tmp + fsync + rename + dirsync` with PID+entropy temp suffix). The atomic move from `pending/` to `processed/` uses the same primitive. Index write: the `documents` row INSERT and the body-file rename-into-canonical-store commit in a single `BEGIN TRANSACTION ... COMMIT` block on the better-sqlite3 connection — both succeed or both fail. The `.error.json` sidecar write is atomic per the same primitive. The persister exposes `persist(input, signal): Promise<Result<PersistedDoc, PersistError>>` — no partial state leak under exception or SIGTERM.
- [x] **IX. Concurrency-Safe Shared State** — Drain serializes via `flock(LOCK_EX | LOCK_NB)` on `Paths.drainLock()` (FR-INGEST-011); concurrent invocations emit `pipeline.lock_contention` and exit 0 (SC-INGEST-015). SQLite remains in WAL mode (set in `sqlite-open.ts`). The SP-003 writer connection takes the WAL writer lock during per-doc transactions; SP-002 readers continue to surface `index_locked` retriable errors during contention. Telemetry JSONL records all ≤ 4096 bytes (existing `TelemetrySizeExceededError` check); SP-003 event payloads are small (path/id/hash + outcome enum) and verified within budget in `data-model.md`. The lock release path covers normal exit, exception, and SIGTERM (Constitution VII coordination).
- [x] **X. Idempotent Pipeline Transitions; Three-Folder Routing** — Every SP-003 transition is `(state, input) → next_state | error` with no extra side effects on re-run. Validate / hash / normalize / persist are pure functions modulo their explicit IO; the content-hash dedup short-circuits re-runs on the same content (FR-INGEST-005). Three-folder routing invariants enforced at drain-end: `pending/` MUST be empty (asserted by drain finalizer + integration test); `processed/` files have a `status='success'` row (verified post-drain reconciliation); `failed/` files have a sibling `.error.json` sidecar and NO `status='success'` row (SC-INGEST-002). Full kill-9 survival across stages is SP-006 territory; SP-003 ships the single-stage atomicity contract (SC-INGEST-004).
- [x] **XI. Library/CLI Boundary** — Zero `process.exit` in `packages/pipeline/`, `packages/extract/`, `packages/storage/`, `packages/contracts/` source files (FR-INGEST-013). All library functions return `Result<T, E>` or throw typed errors (`IngestError`, `ValidationError`, `NormalizeError`, `PersistError`, `WatcherError`, `LockContentionError`). Only the SP-003 daemon entry point in `packages/daemon/src/index.ts` may exit the process; daemon coordinates the master AbortController + the drain loop + the watcher lifecycle. SP-001's existing `no-process-exit-in-libs` eslint rule already covers `packages/pipeline/`, `packages/extract/`, `packages/storage/`, `packages/contracts/`.
- [x] **XII. Subprocess Hygiene** — The PDF extractor is the only subprocess in the SP-003 pipeline. It is a vendored CLI shim (`tools/pdf-extractor/extract.mjs`) invoked exclusively via `runTool('node', ['tools/pdf-extractor/extract.mjs', '--in', tmpPath, '--out', outPath], opts)` from `packages/extract/src/normalize-pdf.ts`. Constitution XII's `runTool` helper propagates `AbortSignal`, captures stdout/stderr, emits `tool_invoked` telemetry with the binary name (not the full args). The HTML / Markdown / plain-text normalizers are in-process (pure JS, deterministic, no subprocess). SP-001's `no-shell-string-exec` lint (per ADR-009 narrowing) covers SP-003 source — `execSync` / `child_process.exec` are forbidden as bare identifiers.
- [x] **XIII. Telemetry-or-Die** — Every SP-003 state transition emits a structured Zod-validated event (FR-INGEST-009). Every catch block in SP-003 source emits a telemetry event at severity matching the actual error severity BEFORE re-throwing or converting to `Result.err`. The SP-001 AST-level lint for "every catch block emits structured event" remains active and covers SP-003 source. The telemetry-write-failure honesty path (SC-INGEST-013) is explicitly handled: if `emitTelemetry` itself throws (filesystem read-only, ENOSPC), the in-flight document is routed to `failed/` with `error_code='telemetry_write_failed', retriable=true`, and the exception is observable to the caller — NO silent swallow.
- [x] **XIV. XDG Paths via Single Resolver** — All SP-003 paths route through existing `Paths.*` getters: `Paths.inbox()`, `Paths.pending()`, `Paths.processed()`, `Paths.failed()`, `Paths.docs()` (canonical body store base), `Paths.telemetry()`, `Paths.drainLock()`, `Paths.cache()` (for `withTempDir` tmp), `Paths.indexDb()`, `Paths.config()` (for `config.toml`). NO new XDG base; SP-003 adds derived getter `Paths.docsStore()` returning `path.join(Paths.docs(), 'store')` (the canonical body file root, distinct from the three-folder inbox/pending/processed/failed subtree). NO writes to `/tmp/`, `/var/`, `os.tmpdir()`, or any non-`Paths.*` literal. SP-001's `paths-from-resolver-only` lint covers SP-003 source.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — SP-003 writes sentinel values into the classifier-owned columns (`facet_domain=''`, `tags_json='[]'`, `facet_type='unclassified'`, `source_type='inbox-filesystem'`). NO hardcoded `enum FacetDomain`. NO `taxonomy_terms` row insertions from SP-003 — that table remains empty until SP-004 ships the proposed-vs-established state machine. The sentinel choice is documented in `data-model.md` and tested at the SQL level (rows pass the schema-migration CHECK constraints but observably-unclassified — `corpus://taxonomy` continues to return empty established lists per SP-002's contract).
- [x] **XVI. Validation Honesty** — Performance numbers in this plan are TARGETS not guarantees. The per-document budget number is *documented, measured, and within the SP-003 share of the NFR-014 envelope* — the specific p95 is finalized at implementation time once classifier wall-clock is empirically measured. The fixture-driven SCs (PDF F-10 adversary, mixed-workload telemetry) are honestly partitioned from the live-against-primary-machine SCs (end-to-end ingest, three-folder routing invariants) in `quickstart.md`. NO cross-agent compatibility claim. NO formal eval harness as v1 success criterion. The watcher backend is `chokidar` (documented choice in `research.md` Decision E), NOT raw inotify — honest about the dependency footprint.

**Result: 16/16 [x]. Complexity Tracking empty.** No principle violations. Phase 0 prerequisites listed below are forward-compatibility plumbing, not justifications for principle drift.

## Phase 0 Prerequisites (must complete before `/speckit-implement` begins)

These are SP-001/SP-002-era code touches that SP-003 needs before the user-story implementation can begin. They are NOT principle violations — they are forward-compatibility plumbing that the existing tasks template explicitly anticipates ("Phase 0 — Prerequisites" in `/speckit-tasks`).

- **PREREQ-001 — `Paths.docsStore()` derived getter**: Add `docsStore: (): string => path.join(Paths.docs(), 'store')` to `packages/contracts/src/paths.ts`. The canonical body file root is a deterministic per-id subtree under `Paths.docs() + '/store/'`, distinct from the existing `pending/processed/failed` subtree at the same `Paths.docs()` umbrella. No new XDG base; pure derived getter under Constitution XIV.
- **PREREQ-002 — `documents.hash UNIQUE` constraint migration**: The existing `packages/storage/src/schema-migration.ts` declares `hash TEXT NOT NULL` without UNIQUE. SP-003 adds a forward-compatible migration step (in `packages/storage/src/unique-hash-migration.ts`) that, on fresh init, creates `documents` with `hash TEXT NOT NULL UNIQUE`; on an existing-DB upgrade path, adds a `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash_unique ON documents(hash)`. Defense-in-depth alongside FR-INGEST-005's application-level dedup. (FR-INGEST-004 commits to this.)
- **PREREQ-003 — Register SP-003 telemetry event classes**: Extend the `TelemetryEvent` Zod discriminated union in `packages/contracts/src/telemetry.ts` with 14 new event classes: `inbox.allowlist_hit`, `inbox.allowlist_miss`, `inbox.mime_mismatch`, `inbox.size_exceeded`, `inbox.filename_sanity_failed`, `inbox.watcher_resource_exhausted`, `ingest.dedup_hit`, `ingest.dedup_miss`, `ingest.normalized`, `ingest.completed`, `ingest.file_unstable`, `ingest.aborted`, `pipeline.lock_contention`, `persist.failed`. Each schema validates ISO-8601 timestamp, severity enum, outcome enum, and class-appropriate path/id reference. Additive — existing SP-001/SP-002 event variants continue to compile and parse without change. (FR-INGEST-009 + Constitution V + XIII.)
- **PREREQ-004 — Extend `errors.ts` with SP-003 typed errors**: `IngestError`, `ValidationError` (with `error_code` enum field matching the sidecar enum from FR-INGEST-007), `NormalizeError`, `PersistError`, `WatcherError`, `LockContentionError`. Each carries `name`, structured `data`, and the constitutional library-package contract (no `process.exit`).
- **PREREQ-005 — `withTempDir` re-export verification**: Confirm `withTempDir` is exported from `packages/contracts/` (or scaffold it if it lives elsewhere). SP-003 normalizers and the persister depend on it for atomic-rename semantics. (Constitution VIII.)

Each PREREQ gets a TDD contract-test/implementation task pair in `/speckit-tasks`'s Phase 0 (see `tasks.md`).

## Project Structure

### Documentation (this feature)

```text
specs/003-ingest-pipeline/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (commit 64c3bf8, untouched by /speckit-plan)
├── research.md          # Phase 0 — Decisions E/F/G/H/I + technology choice notes
├── data-model.md        # Phase 1 — Inbox/Pending/Processed/Failed entities + telemetry event class schemas + documents-row mapping
├── quickstart.md        # Phase 1 — operator walkthrough (init → drop → observe → confirm) with honest "what's NOT working yet" partition
├── contracts/
│   ├── inbox-watcher.feature      # Phase 1 — Gherkin: watcher detection + initial-scan + atomic-rename + resource-exhaustion
│   ├── validation-gate.feature    # Phase 1 — Gherkin: filename sanity / extension / MIME-sniff / size-limit ordering
│   ├── normalize.feature          # Phase 1 — Gherkin: per-MIME deterministic normalization + extractor failure routing
│   ├── idempotency.feature        # Phase 1 — Gherkin: content-hash dedup + ADR-002 F-10 adversary + cross-filename dedup
│   ├── failure-lane.feature       # Phase 1 — Gherkin: every rejection class produces structured sidecar; no documents row
│   └── telemetry.feature          # Phase 1 — Gherkin: ≥6 distinct classes, schema validation, telemetry-write-failure honesty
└── checklists/
    └── requirements.md  # Spec quality checklist (already committed at spec time, all [x])
```

### Source Code (repository root)

```text
packages/
├── contracts/                          # Pure types — zero IO
│   └── src/
│       ├── paths.ts                    # SP-001/SP-002 — extended with docsStore() getter (PREREQ-001)
│       ├── telemetry.ts                # SP-001/SP-002 — extended with 14 new SP-003 event class schemas (PREREQ-003)
│       ├── errors.ts                   # SP-001/SP-002 — extended with 6 new SP-003 typed errors (PREREQ-004)
│       ├── markdown-frontmatter.ts     # SP-002 — unchanged (SP-003 consumes parseMarkdownWithFrontmatter / stringifyMarkdownWithFrontmatter)
│       ├── yaml.ts                     # SP-002 — unchanged
│       ├── result.ts                   # SP-001 — unchanged
│       └── run-tool.ts                 # SP-001 — unchanged (SP-003 invokes for PDF subprocess)
├── pipeline/                           # Grows from pilot-harness-only to functional
│   └── src/
│       ├── inbox-watcher.ts            # NEW — chokidar wrapper, debounce, initial-scan, atomic-rename detection
│       ├── validation-gate.ts          # NEW — filename sanity → extension → MIME-sniff → size; fixed ordering
│       ├── hasher.ts                   # NEW — stream SHA-256 + AbortSignal + bounded read
│       ├── persister.ts                # NEW — single-transaction documents-row + body-file rename + atomic sidecar on failure
│       ├── drain-orchestrator.ts       # NEW — drain loop, policy dispatch, dedup short-circuit, three-folder routing
│       ├── drain-lock.ts               # NEW — flock(LOCK_EX|LOCK_NB) wrapper with SIGTERM release
│       ├── policies.ts                 # NEW — interactivePolicy / batchPolicy named Policy objects (Constitution VI)
│       ├── pilot-harness/              # Existing SP-000-lite — unchanged
│       └── index.ts                    # Exports
├── extract/                            # Grows from empty stub to functional
│   └── src/
│       ├── normalize.ts                # NEW — per-MIME dispatcher: PDF | HTML | Markdown | plain-text
│       ├── normalize-pdf.ts            # NEW — invokes tools/pdf-extractor via runTool; deterministic output
│       ├── normalize-html.ts           # NEW — turndown with fixed rule set; deterministic output
│       ├── normalize-markdown.ts       # NEW — passthrough + frontmatter normalization
│       ├── normalize-text.ts           # NEW — wrap plain-text in minimal Markdown structure
│       └── index.ts                    # Exports
├── storage/                            # Extends document-adapter for write side
│   └── src/
│       ├── document-adapter.ts         # SP-002 — extended with insertDocument(row, signal) write-side adapter
│       ├── unique-hash-migration.ts    # NEW — forward-compatible UNIQUE constraint migration (PREREQ-002)
│       ├── schema-migration.ts         # SP-002 — extended to call unique-hash-migration on init
│       └── (existing SP-002 adapters retained unchanged)
├── daemon/                             # SP-001 stub → SP-003 functional entry point
│   └── src/
│       └── index.ts                    # NEW — daemon owns master AbortController + watcher + drain loop + SIGTERM coordination
├── transport/ inference/ index/        # SP-001/SP-002 — unchanged
└── cli/                                # SP-001 — extended with `corpus drain` and `corpus daemon start|stop` subcommands

tools/
└── pdf-extractor/                      # NEW — vendored CLI shim wrapping pdf-parse (Constitution XII)
    ├── extract.mjs                     # NEW — accepts --in <path> --out <path>, writes extracted text
    └── README.md                       # NEW — why this is a CLI shim and not an in-process import

tests/
├── unit/
│   ├── inbox-watcher.test.ts           # NEW — debounce + initial-scan + atomic-rename detection
│   ├── validation-gate.test.ts         # NEW — filename sanity / extension / MIME-sniff / size ordering + short-circuit
│   ├── normalizer-pdf.test.ts          # NEW — deterministic output across fixture PDFs
│   ├── normalizer-html.test.ts         # NEW — turndown rule-set determinism
│   ├── normalizer-markdown.test.ts     # NEW — passthrough + frontmatter normalization
│   ├── normalizer-text.test.ts         # NEW — minimal-Markdown wrapping
│   ├── hasher.test.ts                  # NEW — stream SHA-256 + signal abort + F-10 60-MB adversary
│   ├── drain-lock.test.ts              # NEW — flock acquisition, contention, release on SIGTERM
│   ├── persister.test.ts               # NEW — single-transaction commit, partial-failure rollback
│   ├── policies.test.ts                # NEW — interactive vs batch policy field surface
│   └── (SP-001/SP-002 unit tests retained)
├── integration/
│   ├── end-to-end-ingest.test.ts       # NEW — drop 4 files (PDF/MD/TXT/HTML), assert 4 rows + 4 bodies + per-doc telemetry
│   ├── dedup-content-hash.test.ts      # NEW — identical content cross-filename + ADR-002 F-10 adversary
│   ├── failure-lane.test.ts            # NEW — every rejection class produces sidecar; no documents row
│   ├── telemetry-coverage.test.ts      # NEW — mixed-workload run produces ≥6 distinct classes + write-failure honesty
│   ├── concurrency.test.ts             # NEW — concurrent drain processes: one acquires lock, other emits contention + exits 0
│   ├── sigterm-abort.test.ts           # NEW — SIGTERM mid-ingest aborts within 2s with error_code='aborted'
│   ├── three-folder-routing.test.ts    # NEW — post-drain invariants: pending/ empty, processed/ rows, failed/ sidecars
│   ├── unique-hash-migration.test.ts   # NEW — PREREQ-002 migration is forward-compatible (fresh init + upgrade path)
│   └── (SP-001/SP-002 integration tests retained)
└── fixtures/
    └── sp003-ingest/                   # NEW — fixture inputs for SP-003 integration tests
        ├── valid-small.pdf             # 5-page PDF for happy-path
        ├── valid-md.md                 # 50-KB Markdown note
        ├── valid-txt.txt               # 5-KB plain-text file
        ├── valid-html.html             # single-page HTML article
        ├── adversary-60mb-identical-prefix-A.bin  # for ADR-002 F-10
        ├── adversary-60mb-identical-prefix-B.bin  # for ADR-002 F-10
        ├── disallowed-docx.docx        # for mime_not_allowlisted
        ├── mismatch-md-with-pdf-bytes.md   # for mime_mismatch
        ├── oversize-by-one-byte.txt    # for size_exceeded boundary
        └── README.md                   # fixture provenance + generation steps
```

**Structure Decision**: TypeScript monorepo with npm workspaces (inherited from SP-001/SP-002). SP-003 grows three existing packages (`packages/pipeline/`, `packages/extract/`, `packages/storage/`), extends one (`packages/contracts/`), introduces functional code in one previously-stub package (`packages/daemon/`), and adds one out-of-package vendored CLI shim (`tools/pdf-extractor/`). Zero new packages. Strict dependency direction from SP-001 preserved: `packages/contracts/` imports nothing; `packages/storage/` imports `packages/contracts/`; `packages/extract/` imports `packages/contracts/`; `packages/pipeline/` imports `packages/contracts/` + `packages/storage/` + `packages/extract/`; `packages/daemon/` imports `packages/pipeline/`. The `tools/pdf-extractor/` shim is a standalone Node.js script — it lives outside the workspaces graph and is invoked via `runTool`.

## Phase Breakdown (driver for `/speckit-tasks`)

This section maps spec requirements to implementation phases. `/speckit-tasks` will turn each phase into ordered tasks; phases are listed here for traceability.

| Phase | Name | Spec coverage | Output |
|---|---|---|---|
| 0 | Prerequisites | PREREQ-001..PREREQ-005 | TDD contract-test/impl pair for: `Paths.docsStore()` getter, `documents.hash UNIQUE` migration, 14 telemetry event class schemas registered in `TelemetryEvent`, 6 new typed errors, `withTempDir` re-export verification. |
| 1 | Setup | — | Add `chokidar`, `turndown`, `file-type`, `pdf-parse` dependencies; scaffold `tools/pdf-extractor/extract.mjs` CLI shim; create `tests/fixtures/sp003-ingest/` directory with fixture generation README; lint config update to scope new files. |
| 2 | Tests-First (RED phase) | All FR-INGEST-* + SC-INGEST-* | Author every test file under `tests/unit/` and `tests/integration/` as failing tests against the contracted behavior. Each Gherkin scenario in `contracts/*.feature` maps to ≥1 test. The Phase 2 exit gate is "every spec area's RED suite compiles and runs (all failing)." This is the input contract for Phase 3 GREEN. |
| 3 | Core Implementation (GREEN phase) | FR-INGEST-001..FR-INGEST-008, FR-INGEST-013, FR-INGEST-014 | Turn Phase 2's tests green. Per-module: watcher, validation gate, hasher, per-MIME normalizers, persister, drain orchestrator. Each module's RED suite goes green before moving to the next; per-module commits allowed. |
| 4 | Integration | FR-INGEST-009, FR-INGEST-010, FR-INGEST-011, FR-INGEST-012 | Wire daemon lifecycle: master AbortController + SIGTERM handler + watcher → drain loop → telemetry. End-to-end integration test against a real PDF fixture passes. Drain-lock concurrency test passes. SIGTERM-abort test passes. Telemetry coverage test passes (≥6 classes + write-failure honesty). |
| 5 | Polish | Cross-cutting Constitution Check re-evaluation + quickstart validation | (a) Re-evaluate Constitution Check — every `[~]` (if any survived Phase 0) lifts to `[x]`; (b) read-only-resource lint extended to assert SP-003 writers do NOT mutate via the resource handler call graph (SP-002 SC-010 invariant preserved); (c) quickstart.md walked end-to-end against actual SP-003 behavior; (d) per-document budget number empirically measured + recorded in plan.md "Performance Goals" footnote; (e) final feature-completion commit. |

**Phase sequencing rationale**: Phase 0 (Prerequisites) is hard-gated — none of the SP-003 source code compiles until the new telemetry event classes are registered in the Zod union. Phase 1 (Setup) is dependency / scaffolding only; can run in parallel with Phase 0's test-authoring. Phase 2 (Tests-First) is the project's TDD-strict gate per the constitutional commitment — every IO/schema/telemetry/paths-touching task gets a failing test first. Phase 3 (Core Implementation) turns those tests green in a per-module pattern; per-module checkpointing keeps blast radius small. Phase 4 (Integration) wires the daemon + the end-to-end paths; the daemon entry point is the only `process.exit` site and lands here. Phase 5 (Polish) closes the constitutional re-check + validates the operator walkthrough.

**Test strategy summary**: RED-phase tests written for every FR-INGEST and SC-INGEST in Phase 2 BEFORE any implementation. GREEN-phase implementation in Phase 3 turns them green per-module. End-to-end integration in Phase 4 verifies the cross-module wiring. Per Constitution XVI: SC-INGEST-001 (end-to-end happy path) verifies LIVE against the primary user's machine; SC-INGEST-006 (F-10 adversary) is fixture-driven; SC-INGEST-013 (telemetry-write-failure honesty) is fixture-driven via a mid-test read-only-remount. The honest partition between live and fixture-driven SCs is documented in `quickstart.md`.

## Dependencies on SP-001 + SP-002

Exhaustive list of imported types/exports/contracts SP-003 inherits:

**From `@llm-corpus/contracts`** (`packages/contracts/src/`):
- `Paths.inbox()`, `Paths.pending()`, `Paths.processed()`, `Paths.failed()` — three-folder routing roots (existing).
- `Paths.docs()` — canonical body store umbrella (existing). SP-003 adds derived getter `Paths.docsStore()`.
- `Paths.indexDb()`, `Paths.telemetry()`, `Paths.drainLock()`, `Paths.cache()`, `Paths.config()` — all existing.
- `Result<T, E>` type and constructors — return type of every storage / pipeline / extract adapter function.
- `TelemetryEvent` discriminated union — extended additively with 14 new SP-003 event classes (PREREQ-003).
- `emitTelemetry`, `emitTelemetrySync`, `TELEMETRY_MAX_BYTES = 4096`, `TelemetryValidationError`, `TelemetrySizeExceededError` — existing helpers SP-003 consumes.
- `parseMarkdownWithFrontmatter`, `stringifyMarkdownWithFrontmatter` — SP-002 codec helpers SP-003 consumes for body file writes.
- `runTool` — invoked by `normalize-pdf.ts` for the PDF subprocess (Constitution XII).
- `withTempDir` — atomic-write tmp-dir helper (existing). SP-003 normalizers + persister consume.

**From `@llm-corpus/storage`** (`packages/storage/src/`):
- `openIndexReadOnly()`, `openIndexReadWrite()` — SP-002's read-only opener; SP-003 adds a read-write counterpart for the persister (additive).
- `runSchemaMigration(db)` — SP-002's idempotent schema creator. SP-003 extends it to call the new `unique-hash-migration.ts` on init (PREREQ-002).
- `DOCUMENTS_COLUMN_LIST`, `TAXONOMY_TERMS_COLUMN_LIST` — exported column lists; SP-003 binds INSERT against `DOCUMENTS_COLUMN_LIST` for forward-compatibility.
- `fetchDocument(docId, signal)` — SP-002's read-side document adapter. SP-003 adds `insertDocument(row, signal)` write-side adapter alongside (no re-implementation of fetch).

**From SP-001 transport** (`packages/transport/src/`):
- Egress hook (transitively bootstrapped via `egress-hook-bootstrap.ts`) — SP-003 inherits the egress envelope. Any accidental network call from a normalizer / extractor / hasher hard-fails with `EgressBlockedError` + emits `egress.blocked` telemetry.

**Explicit non-dependencies** (what SP-003 does NOT depend on):
- SP-004 (classifier) — NOT required. SP-003 writes sentinel values into classifier-owned columns; SP-004 overwrites them. SP-003's tests verify the sentinel contract at the SQL level.
- SP-005 (embedding/ranking) — NOT required. SP-003 produces the row + body file that SP-005 will consume.
- SP-006 (kill-9 survival + `corpus://failures` resource) — NOT required. SP-003 ships the structural failure-lane primitive (`failed/` folder + `.error.json` sidecars); SP-006 adds the kill-9 cross-stage survival and the MCP resource surface.
- SP-007 (install/uninstall) — NOT required. SP-003 adds no install steps beyond `npm install` for the new dependencies.

## Decisions resolved in this plan

(Full rationale + alternatives in `research.md`. Summary here.)

- **Decision E — Watcher backend**: `chokidar ^3.6.0`. Cross-platform, mature, used by webpack/parcel/vscode. Pure JS on Linux (uses `inotify` via `fs.watch`); optional `fsevents` peer on macOS. Inotify watch-limit exhaustion surfaces as `inbox.watcher_resource_exhausted` telemetry + daemon non-zero exit (FR-INGEST-001 + edge case). Codified in `research.md`.
- **Decision F — PDF extractor**: `pdf-parse ^1.1.1` invoked via a vendored CLI shim (`tools/pdf-extractor/extract.mjs`) through `runTool`. The shim wraps `require('pdf-parse')` with a `--in <path> --out <path>` CLI; the pipeline never imports pdf-parse directly. This satisfies Constitution XII (subprocess hygiene) end-to-end and isolates the pdf-parse implementation (which uses `fs.readFile` and can recursively load PDFs.js) from the main process's egress hook surface.
- **Decision G — HTML→Markdown converter**: `turndown ^7.2.0` with a frozen rule set (no plugins, deterministic mapping). In-process (pure JS, no subprocess). Rationale: HTML normalization is CPU-only and deterministic; subprocess overhead is not justified. Rules pinned for byte-identical output across versions.
- **Decision H — Pipeline policy shape**: Two named `Policy` objects in `packages/pipeline/src/policies.ts`: `interactivePolicy` (per-doc timeout 60s, no retry, progress emission via stderr) and `batchPolicy` (per-doc timeout 300s, single retry on `IngestError` with `retriable=true`, no progress emission). Constitution VI compliance: ONE drain loop, TWO policies. Codified in `research.md`.
- **Decision I — Canonical body file layout**: Body files written to `Paths.docsStore() + '/<id-prefix>/<doc-id>.md'` where `<id-prefix>` is the first 2 hex chars of the 8-char id (`doc-ab12cd34` → `Paths.docsStore() + '/ab/doc-ab12cd34.md'`). 256-way sharding prevents directory bloat at scale. The `documents.body_path` column stores the path RELATIVE to `Paths.docs()` (matching SP-002's `fetchDocument` reader contract).

## Risk Register

Anything that could surprise downstream `/speckit-tasks` or `/speckit-implement`:

- **R1 — Watcher race conditions (FR-INGEST-001 + edge case "fast write")**: chokidar's `awaitWriteFinish` option mitigates partial-content reads, but the watcher MAY emit the create event before the file's content has fully landed if the user copies via a non-atomic operation (e.g., `cat foo.pdf > inbox/foo.pdf`). Mitigation: the watcher uses `awaitWriteFinish: { stabilityThreshold: 500ms, pollInterval: 100ms }` PLUS a stat-and-recheck pass; if `file_unstable` is detected (size changes between stat calls), the file routes to `failed/` with `error_code='file_unstable', retriable=true`. The user's documented drop pattern is atomic rename into `Paths.inbox()` (covered in `quickstart.md`).
- **R2 — `pdf-parse` security / memory footprint**: pdf-parse parses untrusted PDF bytes; malformed input can OOM. Mitigation: vendored CLI shim runs in a subprocess via `runTool` with a per-process memory limit (`--max-old-space-size=512` flag on the spawn) + per-doc timeout (60s interactive / 300s batch). OOM crashes route to `failed/` with `error_code='extract_failed', retriable=false`. Tested in `tests/unit/normalizer-pdf.test.ts` via a synthetic malformed-PDF fixture.
- **R3 — SQLite WAL writer-lock contention with SP-002 readers**: SP-002 resource handlers surface `index_locked` retriable errors when the SP-003 writer holds the WAL writer lock. SP-002 already tests this with `busy_timeout=5000ms`. SP-003 keeps per-doc transactions short (under 100ms target — INSERT + body-file rename) so the contention window stays small. Risk: if a per-doc transaction blocks longer (e.g., disk thrash), SP-002 readers time out. Mitigation: SP-003 telemetry includes per-doc `persist_duration_ms` so contention regressions are observable.
- **R4 — chokidar polling fallback on macOS without `fsevents`**: If the optional `fsevents` peer fails to install (macOS-only native addon, allowlist consideration), chokidar falls back to polling at 100ms intervals. Polling overhead is observable in `top`. Mitigation: the SP-003 daemon checks for `fsevents` at boot and emits a `inbox.watcher_resource_exhausted`-adjacent warning event if polling fallback is active. The user can install `fsevents` post-install if the warning fires.
- **R5 — `turndown` rule-set determinism across versions**: Pinned to `^7.2.0`. Risk: a minor version bump changes default rules → fixture drift. Mitigation: SP-003 ships a `normalize-html.golden.test.ts` (NEW — added to Phase 2 test list) that golden-tests against a fixture HTML → expected Markdown output; any version bump that breaks the golden surfaces immediately.
- **R6 — `documents.hash UNIQUE` migration on existing SP-002 DBs**: The SP-002 schema declared `hash NOT NULL` without UNIQUE. If an SP-002 DB has duplicate hashes (would be a bug — SP-002 wrote zero rows in production, but test fixtures could carry duplicates), the migration `CREATE UNIQUE INDEX` fails. Mitigation: PREREQ-002's migration is idempotent and tolerant of pre-existing duplicate-hash rows via a `INSERT OR IGNORE` cleanup pass on the failure path (logged via telemetry). In practice the SP-002 baseline is empty.
- **R7 — Telemetry record size budget (Constitution IX ≤ 4096 bytes)**: SP-003 events carry hashes (64 hex chars), paths (up to PATH_MAX), and error messages. Per-event size budget verified in `data-model.md`; longest plausible payload (`persist.failed` with a 4-KB error message + 64-char hash + 1-KB path) sits at ~5.5 KB → MUST truncate `message` field to 1024 chars max (codified in the Zod schema). Mitigation: every SP-003 event schema caps string fields to known-bounded lengths.
- **R8 — Vendored CLI shim and the egress hook**: The PDF extractor subprocess does NOT inherit the SP-001 egress hook (it runs in a fresh Node process). pdf-parse itself does not make network calls (it parses local bytes), but a future version COULD. Mitigation: the shim's package.json pins `pdf-parse ^1.1.1` exactly; CI guards against minor-version bumps; a fallback OS-firewall block via `runTool`'s existing `egress.blocked` detection catches accidental network access at the kernel boundary.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*Empty — all 16 principles pass without justification. Phase 0 prerequisites are forward-compatibility plumbing, not principle drift.*
