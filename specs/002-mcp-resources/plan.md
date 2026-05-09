# Implementation Plan: MCP Resources — Manifest, Taxonomy, Recent Ingests, Per-Document

**Branch**: `main` (SP-002 plan landed on `main` per `.specify/extensions.yml` — `before_plan` runs only an optional `speckit.git.commit` hook, no mandatory branch hook; SP-002's feature branch is created by `/speckit-tasks` or `/speckit-implement` per the speckit-git-feature contract)
**Date**: 2026-05-05
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/002-mcp-resources/spec.md`

## Summary

Ship the agent's **structural-awareness layer** over the SP-001 foundation: four read-only MCP resources that make the corpus *legible* without forcing a `corpus.find` round-trip. SP-001 made the corpus reachable (egress sealed, MCP server registered, `corpus.find` tool advertised); SP-002 makes the corpus's structure visible. The four resources expose state, never rank or compare:

1. `corpus://manifest` — auto-loaded structural snapshot (`doc_count`, `established_domains`, `established_tags`, `last_ingest_timestamp`, `schema_version`, `taxonomy_version`)
2. `corpus://taxonomy` — flat per-axis envelope of *promoted* taxonomy terms across all four `SearchFilter` axes (`domains`, `tags`, `types`, `source_types`), each with `document_count`
3. `corpus://recent` — last N=10 successfully ingested documents in descending `ingest_timestamp` order, failure-lane excluded
4. `corpus://docs/{id}` — RFC-6570 URI template; full Markdown body + structured YAML frontmatter for one document; the dereferencing target of every `corpus.find` SearchHit URI

This plan delivers SP-002 in three layers:

1. **Protocol surface** — register exactly four canonical resources via the MCP SDK (`resources/list` for the three static URIs; `resources/templates/list` for the `corpus://docs/{id}` URI template). Each handler emits a `resource.read` telemetry event on every read, including failure paths. Cold-start contract mirrors SP-001's `tools/list` shape (`server_initializing` retriable error).
2. **Read-only adapters** — query helpers in `packages/storage/` that compose the four resource payloads from the SP-001 SQLite + FTS5 + sqlite-vec index file (empty in SP-002), plus `Paths.taxonomy()` (the user-promoted taxonomy registry). Every adapter is a pure read; lint enforces zero writes from the resource-handler call graph.
3. **Honest verification harness** — empty-corpus paths verified live against the SP-001 baseline; populated-corpus paths verified against test-fixture rows that simulate what SP-003 (ingest), SP-004 (classification), and SP-005 (ranking) will produce. Re-verification against real data lands when those features ship.

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001 toolchain.

**Primary Dependencies** (additive over SP-001):
- `@modelcontextprotocol/sdk ^1.0.0` (already pinned) — uses `ListResourcesRequestSchema`, `ListResourceTemplatesRequestSchema`, `ReadResourceRequestSchema`, `McpError` from `@modelcontextprotocol/sdk/types.js`. SDK version compatibility verified at implementation time per Decision A; if the SDK exposes a `server.registerResource()` high-level helper, that path is preferred over manual `setRequestHandler`.
- `better-sqlite3 ^11.2.0` (already pinned, allowlisted native addon) — read-only opens of the SP-001 index file. SP-002 is the first feature that actually opens the index; SP-001 declared the dependency but did not exercise it.
- `js-yaml` (NEW dependency) — taxonomy.yml read parser. Constitution V mandates a single YAML library; SP-002 introduces the project's first YAML reader. Add to `packages/storage/` deps; placeholder allowlist registry update tracked under "Dependencies on SP-001" below (no native-addon allowlist change — js-yaml is pure JS).
- `zod ^3.23.0` (already pinned) — Zod schemas for the four resource payloads + the new `resource.read` telemetry event.

**Storage**: SP-001 SQLite index file at `Paths.indexDb()` (empty for SP-002, populated post-SP-003). `Paths.taxonomy()` JSON registry (empty for SP-002, populated post-SP-004). The `corpus://recent` handler reads from a `documents` table that ships its schema in SP-003 — SP-002 ships a schema migration helper that creates the empty table with the contracted columns so the resource handler has something to query against on the empty baseline.

**Testing**: vitest (inherits SP-001). New test surfaces: (a) `tests/integration/mcp-resources-list.test.ts` — `resources/list` + `resources/templates/list` handshakes; (b) `tests/integration/resource-empty-corpus.test.ts` — empty-state shape parity (4 resources, all schema-valid empty payloads); (c) `tests/integration/resource-populated-fixtures.test.ts` — fixture-driven non-empty paths covering manifest with non-zero `doc_count`, taxonomy with promoted terms, recent with N entries, doc-by-id reads against fixture documents; (d) `tests/integration/resource-error-paths.test.ts` — `document_not_found`, `index_locked`, `server_initializing`; (e) `tests/integration/resource-read-only-lint.test.ts` — code-search lint over the resource-handler source files asserting zero writes (SC-010 by construction); (f) fixture-loader unit tests in `tests/unit/fixture-loader.test.ts`.

**Target Platform**: Linux (Fedora 43+) and macOS, inherits SP-001. Windows out of scope for v1.

**Project Type**: TypeScript monorepo (npm workspaces). SP-002 grows two packages and adds zero new ones:
- `packages/transport/` grows resource registration alongside the existing `corpus.find` tool.
- `packages/storage/` grows from stub to functional (resource adapter functions reading the SQLite + taxonomy registry).
- `packages/contracts/` grows the `resource.read` telemetry event schema and the four resource payload schemas.

**Performance Goals**:
- `resources/list` handshake response: under 100 ms cold-start, under 10 ms warm (the response is a static four-resource listing — no DB hit).
- `corpus://manifest` read: under 50 ms (single SQLite query for `doc_count` plus distinct-terms scan; empty-corpus baseline is faster).
- `corpus://taxonomy` read: under 50 ms (single read of `Paths.taxonomy()` + `document_count` aggregation per term; on the empty baseline, returns the empty envelope without DB hit).
- `corpus://recent` read: under 50 ms (one indexed SELECT with ORDER BY ingest_timestamp DESC LIMIT N).
- `corpus://docs/{id}` read: under 100 ms p95 for documents up to 1 MB (single PK lookup + frontmatter parse).
- Telemetry-event emission: under 1 ms per event (inherits SP-001 append-only JSONL discipline).

All numbers are TARGETS not guarantees per Constitution XVI; CI benchmark on the user's primary machine establishes whether they're met.

**Constraints**:
- Zero outbound non-loopback packets during any resource read (NFR-002, hard — inherited from SP-001 egress hook).
- Zero writes from any resource-handler call graph (Constitution III, Constitution XV, hard — enforced by SC-010 lint).
- All paths via `Paths.*` including fixture roots (Constitution XIV, hard — fixtures resolve through `Paths.cache()`).
- All resource reads emit telemetry on success and failure paths (Constitution XIII, hard — enforced by per-handler test).
- All resource payloads schema-validated before serialization (Constitution V, hard — Zod parse on output).
- All resource handlers accept `AbortSignal` (Constitution VII, hard — handler signature in `contracts/mcp-resources-api.md`).
- `index_locked` failures within the cancellation window must be retriable, not block (Constitution VII + IX, hard).

**Scale/Scope**:
- Single user, single machine (Constitution IV).
- Net new code: ~600–900 LOC implementation, ~1200–1800 LOC tests + fixtures (test-heavy by SP-001 precedent).
- Net new files: 4 resource-handler source files in `packages/transport/`, ~5 adapter source files in `packages/storage/`, 2 schema additions to `packages/contracts/`, ~6 test files, ~10 fixture template files.
- Per-feature contract files: 5 (one per resource + one for the new telemetry event class).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be marked `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — Plan introduces zero non-localhost code paths. The four resource handlers read from `Paths.indexDb()` (local SQLite) and `Paths.taxonomy()` (local JSON). The MCP server retains its stdio-only transport (no TCP/HTTP bind, inherited from SP-001). The SP-001 egress hook intercepts all outbound primitives at module-load time before SP-002's handlers register; any accidental network call from a resource handler is hard-failed by the hook with `EgressBlockedError` and emits an `egress.blocked` telemetry event.
- [x] **II. User Curates, LLM Classifies Metadata** — Plan introduces zero LLM-generated document bodies. The `corpus://docs/{id}` handler returns the user-curated body verbatim from the canonical store; it neither rewrites, summarizes, nor synthesizes content. The frontmatter shape exposed by per-doc reads contains only the v1 minimum surface (`id`, `source_path`, `ingest_timestamp`, `mime_type`, `hash`) — no `origin`, `provenance_*`, `confidence`, `captured_at`, or `corpus capture` fields. No `synthesis/` namespace.
- [x] **III. Substrate, Not Surface** — Plan introduces zero new surfaces. SP-002 adds resources to the existing MCP stdio transport from SP-001; no HTTP server, no TUI, no browser, no HTML, no graphical output. Critically, all four resources are read-only by design: every handler is a pure query against the index/taxonomy. SC-010 enforces this *by construction* via a code-search lint that fails the build on any write call (INSERT/UPDATE/DELETE, `fs.write*`, `fs.appendFile` outside the telemetry helper) reachable from a resource handler.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — Plan introduces no conversation memory, no SaaS connector, no shared corpus, no cross-machine sync, no multi-user concept, no roles/permissions. The MCP server remains a single-process stdio handler reading from a single user's `Paths.data()`.
- [x] **V. Schema-Enforced Structured Output** — Every resource payload is Zod-validated before serialization. The four payload schemas (`ManifestPayload`, `TaxonomyPayload`, `RecentPayload`, `DocumentPayload`) live in `packages/contracts/src/resource-schemas.ts`. The `resource.read` telemetry event extends the existing Zod `discriminatedUnion('event', [...])` in `packages/contracts/src/telemetry.ts`. The single YAML library (`js-yaml`) parses frontmatter for the per-doc handler — no hand-rolled YAML, no regex frontmatter extraction, no string replacement. The MCP SDK validates JSON-RPC envelopes; resource-payload validation is the SP-002-side guarantee.
- [x] **VI. One Pipeline, Two Policies** — Plan does NOT introduce a pipeline; the pipeline begins at SP-003 (FR-010 inbox watcher). Resource reads are not pipeline transitions and are policy-free.
- [x] **VII. Cancellable, Bounded IO** — Every resource handler signature accepts an `AbortSignal` (per `contracts/mcp-resources-api.md` §"Handler signatures"). The MCP SDK propagates `extra.signal` into each handler; handlers call `signal.throwIfAborted()` before each IO step (SQLite open, query execution, frontmatter parse). The `index_locked` retriable error path returns within the SDK's per-request timeout window (default 30s, configurable via `transport.requestTimeoutMs`); SQLite `busy_timeout` PRAGMA is set to 5 seconds with the WAL `OperationalError`-on-lock surface mapped to `index_locked` MCP error code. No `Promise.race` against `setTimeout`; no `execSync`.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — SP-002 introduces NO new disk writers besides telemetry-event appends (governed by Principle IX, not VIII) and fixture setup writers (test-time only, governed by `withTempDir` from `packages/contracts/`). The four resource handlers are read-only — no atomic-rename writers in their call graphs. The SP-005-forward `atomicWrite()` helper that ingest writers will use remains exported from `packages/contracts/`; SP-002 does not exercise it.
- [x] **IX. Concurrency-Safe Shared State** — SP-002 ships the index-locked error path as the SP-002 surface for SQLite WAL contention: when a future SP-003 ingest writer holds the WAL writer lock, a concurrent `corpus://docs/{id}` read from the MCP server returns `index_locked` (retriable, with structured `retry_after_ms` advisory) within the cancellation window. SQLite is opened with `PRAGMA journal_mode=WAL` (declared in `packages/storage/src/sqlite-open.ts`); the resource handlers use the read connection only — they do NOT take the WAL writer lock. Telemetry-event records (the new `resource.read` class) MUST serialize to ≤ 4096 bytes per Constitution IX; per-event size assertion lives in the telemetry-emit helper. The proposed event schema is small and fixed-vocabulary; size budget verified in `data-model.md`.
- [x] **X. Idempotent Pipeline Transitions; Three-Folder Routing** — Resource reads are read-only and trivially idempotent — re-reading produces the same payload (modulo concurrent writes from SP-003+). The `corpus://recent` handler honors three-folder routing semantics by *contract*: it queries only the documents successfully ingested (the SP-003 ingestion path will write them with a status field marking success), excluding any document marked failure-lane. SP-002 verifies the exclusion contract against fixture rows representing both states; real failure-lane behavior re-verifies post-SP-006.
- [x] **XI. Library/CLI Boundary** — All resource-handler source files live in `packages/transport/` (an entry-point package — exit allowed but not used) and `packages/storage/` (a library package — exit forbidden). Library-package files in `packages/storage/` return `Result<T, E>` or throw typed errors (`DocumentNotFoundError`, `IndexLockedError`, `TaxonomyParseError`); they NEVER call `process.exit`. The eslint rule `no-process-exit-in-libs` from SP-001 covers `packages/storage/` already. Resource-handler source files in `packages/transport/` use the SDK's error-throw mechanism (`McpError`) — exits remain unused.
- [x] **XII. Subprocess Hygiene** — Plan introduces zero subprocess calls. Resource handlers are pure database + filesystem reads; no `spawn`, no `exec`, no `runTool` invocation in the handler call graph. The fixture-loader test helper similarly uses no subprocess (raw SQL via better-sqlite3, JSON writes via fs/promises). Test-time tooling (vitest) is invoked by `npm run test`, not from production code.
- [x] **XIII. Telemetry-or-Die** — Every resource read emits a `resource.read` telemetry event with severity `info` on success and `warn`/`error` on failure paths. Schema lives in `contracts/telemetry-resource-events.md`; emit helper extends the existing `emitTelemetry` in `packages/contracts/src/telemetry.ts`. Per-handler tests assert one event per read (success and each failure code: `document_not_found`, `index_locked`, `server_initializing`, validation failures). The AST-level lint rule for "every catch block emits a structured event" remains active from SP-001 and covers SP-002's new catch sites in the resource handlers and storage adapters.
- [x] **XIV. XDG Paths via Single Resolver** — SP-002 reads through `Paths.indexDb()` (existing SP-001 export), `Paths.taxonomy()` (existing SP-001 export — re-named from `.yml` to `.json` per the deployed `paths.ts`; plan adopts the deployed name), and adds derived getters: `Paths.sp002FixturesRoot()` for the test-time per-test fixture root under `Paths.cache()`. Production code adds NO hardcoded path literals. Fixtures resolve through the resolver — never `os.tmpdir()`, never `/tmp/`, never anywhere outside `$HOME`. The `paths-from-resolver-only` lint rule from SP-001 covers SP-002 source files automatically.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — `corpus://taxonomy` exposes ONLY promoted (user-acknowledged) terms. The taxonomy registry distinguishes `proposed` vs `established` states (full state machine ships with SP-004); SP-002 reads only the `established` set. No hardcoded `enum FacetDomain`. The proposed-vs-established exclusion contract is verified against fixture taxonomy state in SC-005. Auto-promotion remains forbidden — SP-002 introduces no promotion path; that workflow lands with SP-004.
- [x] **XVI. Validation Honesty** — Performance numbers in this plan are TARGETS not guarantees. The auto-load semantic of `corpus://manifest` is a server-side annotation only; the spec's Edge Case section already documents that client-side honoring is a property of the client per the MCP protocol, not a v1 server guarantee — plan honors this boundary in `quickstart.md` (SC-003 verifies the *annotation is attached*, not that any specific client respects it). Fixture-driven SCs (SC-005, SC-006, SC-007 partial) are honestly partitioned from end-to-end SCs in `quickstart.md`; the populated-corpus paths re-verify post-SP-003/004/005. No formal eval harness as v1 success criterion.

**Result: 16/16 [x]. Complexity Tracking empty.** No principle violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-mcp-resources/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (clean, all CLAR resolved 2026-05-05)
├── research.md          # Phase 0 — Decisions A/B/C/D + technology choice notes
├── data-model.md        # Phase 1 — ManifestPayload, TaxonomyPayload, RecentPayload, DocumentPayload, ResourceReadEvent
├── quickstart.md        # Phase 1 — per-SC verification recipes; honest empty-vs-fixture partition
├── contracts/
│   ├── mcp-resources-api.md             # Phase 1 — registration shape, request/response envelopes, error codes
│   ├── resource-manifest.md             # Phase 1 — corpus://manifest payload contract
│   ├── resource-taxonomy.md             # Phase 1 — corpus://taxonomy payload contract
│   ├── resource-recent.md               # Phase 1 — corpus://recent payload contract
│   ├── resource-document.md             # Phase 1 — corpus://docs/{id} payload + frontmatter contract
│   └── telemetry-resource-events.md     # Phase 1 — resource.read event class schema
└── checklists/
    └── requirements.md  # Spec quality checklist (already committed at spec time, all [x])
```

### Source Code (repository root)

```text
packages/
├── contracts/                          # Pure types — zero IO
│   └── src/
│       ├── paths.ts                    # SP-001 — extended with sp002FixturesRoot getter
│       ├── result.ts                   # SP-001 — unchanged
│       ├── telemetry.ts                # SP-001 — extended with ResourceReadEvent in the discriminated union
│       ├── resource-schemas.ts         # NEW — Zod schemas for the 4 resource payloads
│       └── errors.ts                   # SP-001 — extended with DocumentNotFoundError, IndexLockedError, TaxonomyParseError
├── transport/                          # MCP stdio — egress hook bootstraps here
│   └── src/
│       ├── index.ts                    # SP-001 — extended exports for resource handlers
│       ├── egress-hook-bootstrap.ts    # SP-001 — unchanged (FIRST IMPORT discipline preserved)
│       ├── egress-hook.ts              # SP-001 — unchanged
│       ├── mcp-server.ts               # SP-001 — extended to register the four resources alongside corpus.find
│       ├── corpus-find-tool.ts         # SP-001 — unchanged
│       ├── schemas.ts                  # SP-001 — unchanged (corpus.find schemas)
│       ├── resource-manifest-handler.ts    # NEW — corpus://manifest read handler
│       ├── resource-taxonomy-handler.ts    # NEW — corpus://taxonomy read handler
│       ├── resource-recent-handler.ts      # NEW — corpus://recent read handler
│       ├── resource-document-handler.ts    # NEW — corpus://docs/{id} read handler (URI template)
│       └── resource-telemetry.ts           # NEW — emitResourceRead helper, error-code mapping
├── storage/                            # Storage adapter — read-only adapters land here
│   └── src/
│       ├── index.ts                    # SP-001 — extended exports
│       ├── sqlite-open.ts              # NEW — read-only SQLite open with WAL + busy_timeout
│       ├── manifest-adapter.ts         # NEW — composes ManifestPayload from index + taxonomy
│       ├── taxonomy-adapter.ts         # NEW — reads Paths.taxonomy() and aggregates document_counts
│       ├── recent-adapter.ts           # NEW — SELECT recent successful ingests with LIMIT N
│       ├── document-adapter.ts         # NEW — PK lookup by doc id, returns body + frontmatter
│       ├── schema-migration.ts         # NEW — creates the empty documents/taxonomy tables on fresh init (SP-002 baseline)
│       └── fixtures.ts                 # NEW (test-only export) — fixture loader for populated-corpus tests
├── daemon/                             # SP-001 — unchanged
├── pipeline/ index/ inference/ extract/ # SP-001 — unchanged stubs
└── cli/                                # SP-001 — unchanged

build/
├── verify-native-addons.ts             # SP-001 — unchanged
└── verify-firewall-rule.sh             # SP-001 — unchanged

tests/
├── unit/
│   ├── resource-schemas.test.ts        # NEW — Zod round-trip for the 4 payload schemas
│   ├── manifest-adapter.test.ts        # NEW — empty-corpus + fixture-driven shape
│   ├── taxonomy-adapter.test.ts        # NEW — promoted-only filter + 4-axis envelope
│   ├── recent-adapter.test.ts          # NEW — descending order, N limit, failure-lane exclusion
│   ├── document-adapter.test.ts        # NEW — PK hit, miss, malformed-id rejection
│   ├── fixture-loader.test.ts          # NEW — fixture loader idempotency + isolation
│   └── (SP-001 unit tests retained)
├── integration/
│   ├── mcp-resources-list.test.ts      # NEW — resources/list + resources/templates/list handshakes
│   ├── resource-empty-corpus.test.ts   # NEW — 4 resources × empty payload shape parity (SC-004)
│   ├── resource-populated-fixtures.test.ts # NEW — non-empty paths via fixtures (SC-005, SC-006, SC-007)
│   ├── resource-error-paths.test.ts    # NEW — document_not_found, index_locked, server_initializing (SC-008)
│   ├── resource-read-only-lint.test.ts # NEW — code-search lint over resource-handler files (SC-010)
│   ├── resource-telemetry.test.ts      # NEW — 50-read mixed workload, every read emits a telemetry event (SC-009)
│   ├── resource-cold-start.test.ts     # NEW — resources/list before markReady() returns server_initializing
│   └── (SP-001 integration tests retained)
└── fixtures/
    └── sp002-populated/                # NEW — source-controlled fixture templates
        ├── documents.sql               # synthetic INSERT statements simulating SP-003 output
        ├── taxonomy-promoted.json      # promoted taxonomy state (SP-004 precondition simulation)
        ├── taxonomy-mixed.json         # promoted + proposed (for SC-005 exclusion test)
        ├── recent-25-success.sql       # 25 successful ingests for FR-007 N-limit verification
        ├── recent-mixed-failure.sql    # 5 success + 5 failure-lane (for SC-006)
        ├── searchhit-fixture-uris.json # 5 fixture SearchHit URIs pointing at known doc ids (for SC-007)
        └── frontmatter-minimum.yaml    # frontmatter template (id, source_path, ingest_timestamp, mime_type, hash)
```

**Structure Decision**: TypeScript monorepo with npm workspaces (inherited from SP-001). SP-002 grows two existing packages (`packages/transport/`, `packages/storage/`) and extends one (`packages/contracts/`). Zero new packages. The strict dependency direction from SP-001 is preserved: `packages/storage/` may import from `packages/contracts/` (Result, Paths, telemetry, errors, schemas); `packages/transport/` may import from both. No package may import from upper layers.

## Phase Breakdown (driver for `/speckit-tasks`)

This section maps spec requirements to implementation phases, mirroring SP-001's pattern. `/speckit-tasks` will turn each phase into ordered tasks; phases are listed here for traceability.

| Phase | Name | Spec coverage | Output |
|---|---|---|---|
| 0 | Setup | — | Add `js-yaml` dependency; declare `Paths.sp002FixturesRoot()`; extend `errors.ts` with three new typed errors. |
| 1 | Foundational (shared infra for all 4 user stories) | Cross-cutting FR-005..FR-008 | (a) `packages/contracts/src/resource-schemas.ts` with the 4 Zod payload schemas; (b) `ResourceReadEvent` added to telemetry discriminated union; (c) `packages/transport/src/resource-telemetry.ts` with `emitResourceRead` helper + MCP-error-code mapping; (d) `packages/storage/src/sqlite-open.ts` (read-only WAL open, busy_timeout); (e) `packages/storage/src/schema-migration.ts` (creates empty `documents` + `taxonomy_terms` tables on fresh init); (f) `packages/storage/src/fixtures.ts` test-only fixture loader. |
| 2 | US1 — Manifest (P1) | FR-005, US1 acceptance scenarios 1–4 | `packages/storage/src/manifest-adapter.ts`; `packages/transport/src/resource-manifest-handler.ts`; manifest registration in `mcp-server.ts`; auto-load annotation; tests. |
| 3 | US2 — Taxonomy (P1) | FR-006, US2 acceptance scenarios 1–4 | `packages/storage/src/taxonomy-adapter.ts`; `packages/transport/src/resource-taxonomy-handler.ts`; promoted-only filter; 4-axis envelope; tests. |
| 4 | US4 — Per-document (P1) | FR-008, US4 acceptance scenarios 1–5 | `packages/storage/src/document-adapter.ts`; `packages/transport/src/resource-document-handler.ts`; URI template registration via `resources/templates/list`; `document_not_found` + `index_locked` error envelopes; SearchHit URI dereference verification; tests. |
| 5 | US3 — Recent (P2) | FR-007, US3 acceptance scenarios 1–4 | `packages/storage/src/recent-adapter.ts`; `packages/transport/src/resource-recent-handler.ts`; default N=10; failure-lane exclusion contract; configurable via `config.toml`; tests. |
| 6 | Polish | Cross-cutting Read-only / Cold-start | (a) Cold-start `server_initializing` error wired through resources/* request handlers (mirrors SP-001 tools/list); (b) read-only lint integration test (SC-010); (c) 50-read telemetry coverage test (SC-009); (d) quickstart docs sweep + final Constitution Check re-evaluation. |

**User-story sequencing rationale**: P1 stories (US1, US2, US4) ship before the P2 story (US3). Among P1, US1 (manifest) is foundational because the other resources reuse manifest-shape conventions (auto-load annotation pattern, empty-state contract). US2 (taxonomy) and US4 (per-doc) are independent of each other and could be parallelized in `/speckit-tasks` with `[P]` markers. US3 (recent) lands last because it's the only P2 and its failure-lane exclusion logic depends on the documents table schema which lands fully in US4's adapter work.

**Test strategy summary**: Empty-corpus surface (SC-004 + cold-start error + read-only lint) verifies LIVE against the SP-001 baseline — no fixture dependency. Populated-corpus surface (SC-005, SC-006, SC-007) verifies via fixtures. Re-verification post-SP-003/004/005/006 reuses the same tests under a `test:integration:populated-real` script that points `CORPUS_HOME` at a real ingested corpus instead of the fixture root; that script is a no-op until the upstream features ship.

## Dependencies on SP-001

Exhaustive list of imported types/exports/contracts from SP-001:

**From `@llm-corpus/contracts`** (`packages/contracts/src/`):
- `Paths.indexDb()` — SQLite index file path (read by SP-002 adapters)
- `Paths.taxonomy()` — taxonomy registry path (read by taxonomy adapter)
- `Paths.telemetry()` — telemetry sink path (written by `emitResourceRead`)
- `Paths.cache()` — base for `sp002FixturesRoot()` derived getter
- `Paths.docs()`, `Paths.failed()`, `Paths.processed()`, `Paths.pending()` — read by recent-adapter for failure-lane exclusion contract
- `Result<T, E>` type and constructors — return type of every storage adapter function
- `EgressEvent` discriminated union — extended by SP-002 with the new `resource.read` event class (additive)
- `emitTelemetry`, `emitTelemetrySync` — base helpers; SP-002 extends with `emitResourceRead`
- `TELEMETRY_MAX_BYTES = 4096` — Constitution IX size constraint inherited
- `TelemetryValidationError`, `TelemetrySizeExceededError` — re-thrown when applicable
- `runTool` — exported but NOT used by SP-002 (no subprocess in resource handlers)

**From `@llm-corpus/transport`** (`packages/transport/src/`):
- `buildMcpServer`, `BuildMcpServerOptions`, `BuiltMcpServer` — extended by SP-002 to register the 4 resources alongside the existing `corpus.find` tool
- `markReady()` mechanism — re-used; cold-start error envelope for `resources/list` + `resources/read` mirrors the existing `tools/list` pattern via the same `ready` flag
- `SERVER_INITIALIZING_CODE = -32002` — re-used as the error code for resource cold-start
- `SearchHit` schema (from `transport/src/schemas.ts`) — referenced by SC-007 for URI shape verification (`uri` field of every SearchHit dereferences via the per-doc resource handler)
- `installEgressHook` (transitively via `egress-hook-bootstrap.ts`) — runs FIRST per the bootstrap order contract; SP-002's resource handlers register AFTER, so any accidental network call in a handler is hard-blocked
- The MCP SDK error-throw pattern (`McpError`) — extended by SP-002 with new error codes (see `contracts/mcp-resources-api.md`)

**From the SP-001 `tools/list` contract** (`specs/001-local-only-mcp-foundation/contracts/`):
- Cold-start error envelope shape (`code: -32002`, `message: "server_initializing"`, `data: { retry_after_ms: 1000 }`) — reused verbatim for `resources/list`/`resources/read` cold-start
- The bootstrap-ordering test fixture (`tests/integration/bootstrap-order.test.ts`) — extended to assert resource handlers also register after the egress hook
- The egress-hook AttemptContext / EgressBlockedError contract — relevant only as a defensive failure mode; SP-002 never expects to trip it

**From SP-001 native-addon allowlist**: `better-sqlite3` and `sqlite-vec` already allowlisted; SP-002 adds NO new native addons. `js-yaml` is pure JS (no `.node` file).

**Explicit non-dependencies** (what SP-002 does NOT depend on):
- SP-003 (ingest pipeline) — not required at SP-002 time. SP-002 ships against the empty SP-001 index. Populated-corpus paths use fixtures. The `documents` table schema is created by SP-002's `schema-migration.ts` so handlers have a query target on the empty baseline; SP-003 will populate rows but not change the table shape.
- SP-004 (classification) — not required. SP-002 reads the *promoted* taxonomy state; the proposed-vs-established state machine and the classifier ship with SP-004. SP-002 verifies the exclusion *contract* against fixture taxonomy state.
- SP-005 (search ranking) — not required. SearchHit URI dereferencing (SC-007) uses fixture SearchHits whose `uri` fields point at fixture documents. Re-verification against real `corpus.find` output runs post-SP-005.
- SP-006 (failure lane) — not required. Failure-lane exclusion is verified against fixture rows simulating failure-lane state.
- SP-007 (install/uninstall) — not required. Plan adds no install steps.
- SP-008 (acceptance flows) — not required.

## Decisions resolved in this plan

(Full rationale + alternatives in `research.md`. Summary here.)

- **Decision A — Resource registration shape**: Static three URIs (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`) registered in `resources/list`. The `corpus://docs/{id}` URI template registered in `resources/templates/list`. Spec SC-002 wording ("the response includes exactly four canonical resources / resource templates") accommodates the protocol's static-vs-template split — no SC amendment required. Codified in `contracts/mcp-resources-api.md`.
- **Decision B — Fixture harness**: Source-controlled fixture *templates* live under `tests/fixtures/sp002-populated/` (raw SQL, JSON, YAML). Runtime fixture root resolves through `Paths.sp002FixturesRoot()` (a derived getter under `Paths.cache()` — Constitution XIV holds). A `fixture-loader` helper in `packages/storage/src/fixtures.ts` (test-only export) creates a per-test isolated `CORPUS_HOME`, executes the fixture SQL into a fresh SQLite, and writes the synthetic taxonomy.json. Re-verification post-SP-003/004/005 runs the same harness against a real ingested corpus via `test:integration:populated-real`.
- **Decision C — FR-007 default N**: **N = 10**, configurable via `config.toml` key `resources.recent.window_size`. Matches the `corpus.find` `limit` default; matches US3 AC-scenario; well-suited to typical agent context-window economics.
- **Decision D — Telemetry event class for resource reads**: New event class `resource.read`. New contract file `contracts/telemetry-resource-events.md` (separate from SP-001's `telemetry-egress-events.md`). Rationale: SP-001's egress-events file is scoped to network-primitive interception; SP-002's reads are a different concern domain. The telemetry-emit helper extends the existing `EgressEvent` `discriminatedUnion('event', [...])` additively — no breaking change. Establishes the per-concern-domain pattern for SP-003+ (`pipeline.*`), SP-004+ (`classify.*`), etc.

## Risk Register

Anything that could surprise downstream `/speckit-tasks` or `/speckit-implement`:

- **R1 — MCP SDK version pin gotcha**: SP-001 pinned `@modelcontextprotocol/sdk ^1.0.0`. The high-level `McpServer` API uses `registerTool` for tools; the resources surface uses `setRequestHandler(ListResourcesRequestSchema, ...)` and `setRequestHandler(ListResourceTemplatesRequestSchema, ...)` (manual registration). At implementation time, verify whether the pinned minor offers a `server.registerResource()` high-level helper; if so, prefer it. The contracts file documents both registration paths.
- **R2 — `resources/templates/list` MCP SDK support**: The MCP spec defines this method; SDK support quality varies by version. If the pinned SDK does not expose `ListResourceTemplatesRequestSchema`, fall back to manual schema definition (the wire shape is well-defined). Tasks phase should include a "verify SDK exposes both list endpoints" task before US4 implementation.
- **R3 — SQLite WAL `busy_timeout` calibration**: The `index_locked` retriable-error path depends on the SQLite `busy_timeout` PRAGMA. The plan sets it to 5 seconds initially; if SP-005 (which holds the writer lock during index commits) needs longer, this knob may need tuning. The contracts file makes the timeout configurable via `config.toml`.
- **R4 — Empty-corpus baseline schema migration**: SP-002 creates the empty `documents` and `taxonomy_terms` tables via `schema-migration.ts`. SP-003 will add rows but MUST NOT change the column shape without coordinating with SP-002's `manifest-adapter.ts` and `recent-adapter.ts`. The contract file documents the column shapes so SP-003 inherits them.
- **R5 — `js-yaml` dependency surface**: Adding js-yaml is a small dependency footprint, but it's the project's first YAML reader. The Constitution V "single YAML library" rule means SP-002 must publish `parseYaml` and `stringifyYaml` helpers from `packages/storage/` (or `packages/contracts/`) so downstream features inherit the choice instead of pulling their own. Tasks phase should include "publish yaml helper from contracts" as Foundational.
- **R6 — Fixture drift post-SP-003**: When SP-003 ships real ingest, the fixture SQL must match the real INSERT shape exactly or the populated tests drift. Mitigation: the fixture SQL imports its column list from the `schema-migration.ts` module, so any column-shape change in SP-003 immediately surfaces as a fixture-load failure. Documented in `data-model.md`.
- **R7 — Auto-load annotation portability**: The MCP `auto-load at session start` annotation is a standard MCP feature, but client honoring varies. Per Constitution XVI, SP-002 verifies the *annotation is attached*, not that any specific client respects it. Quickstart SC-003 reflects this honest scope.
- **R8 — Concurrency model with future SP-003 daemon**: SP-002 opens the SQLite read connection per-request (fresh connection on each resource read). When SP-003 introduces the daemon (long-lived writer), the read-connection-per-request pattern remains correct (WAL allows concurrent readers + one writer). If a future feature wants connection pooling for performance, that's an SP-005+ concern, not an SP-002 surface.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

*Empty — all 16 principles pass without justification.*
