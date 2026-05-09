---
description: "Task list for feature 002-mcp-resources (SP-002)"
---

# Tasks: MCP Resources — Manifest, Taxonomy, Recent Ingests, Per-Document

**Input**: Design documents from `/specs/002-mcp-resources/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{mcp-resources-api,resource-manifest,resource-taxonomy,resource-recent,resource-document,telemetry-resource-events}.md, quickstart.md

**Prior state**: SP-001 merged on `main`. Egress hook live, MCP server registered with `corpus.find` tool over stdio, telemetry sink at `Paths.telemetry()` operational, SP-001 success criteria all green. SP-002 builds *additively* on the SP-001 surface — zero re-implementation of SP-001.

**Tests**: MANDATORY for tasks touching IO, classifier output, telemetry, paths, taxonomy, schema, or subprocess (per `tasks-template.md` project-specific override and Constitution Principles V, VII, VIII, IX, X, XII, XIII, XIV, XV). SP-002 touches IO (SQLite reads, frontmatter parse), telemetry (new `resource.read` class), paths (new `Paths.sp002FixturesRoot()`), taxonomy (Constitution XV exclusion contract), and schema (4 new payload schemas) — tests are mandatory throughout. SP-002 introduces zero subprocess in production code.

**Scope-bound**: SP-002 ships ONLY the four read-only resources (manifest, taxonomy, recent, per-doc), the new `resource.read` telemetry event class, the empty-baseline SQLite schema migration (`documents` + `taxonomy_terms` tables), and the fixture harness for populated-corpus tests. SP-002 does NOT ship ingest (SP-003), classification (SP-004), search ranking (SP-005), failure-lane semantics (SP-006), install scripts (SP-007), or acceptance flows (SP-008).

**Organization**: Tasks are grouped by phase and (within user-story phases) by user story to enable independent implementation and testing. Constitution Check (16/16 [x]) verified at plan time; no Complexity Tracking entries.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3, or US4 (maps to user stories in spec.md)
- File paths are repo-relative under `~/Projects/llm-corpus/`

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-002 grows two existing packages and extends one (per plan.md "Project Structure"):

- `packages/contracts/` — extended with `resource-schemas.ts`, `markdown-frontmatter.ts`, telemetry rename, three new error classes, version constants, `sp002FixturesRoot` getter
- `packages/transport/` — extended with 4 resource-handler files, `resource-telemetry.ts`, resource registration in `mcp-server.ts`
- `packages/storage/` — grows from stub to functional (`sqlite-open.ts`, 4 adapter files, `schema-migration.ts`, `fixtures.ts`, config loader, yaml helpers)
- `tests/{unit,integration,fixtures/sp002-populated}/` — new test files + fixture templates
- `tools/eslint-rules/` — one new rule (`no-writes-from-resource-handlers`) wired into `eslint.config.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace plumbing — `js-yaml` dependency, version constants, three new typed errors, `Paths.sp002FixturesRoot()` derived getter, fixture-templates directory layout, eslint rule scaffold.

- [X] T001 [P] Add `js-yaml ^4.1.0` and `@types/js-yaml ^4.0.9` to `packages/contracts/package.json` dependencies. Constitution V mandates a single YAML library; the contracts package owns the helper so storage and transport inherit it (per plan.md R5). Verify post-install allowlist still passes (`js-yaml` is pure JS — no `.node` file). *Constitution V, plan.md R5*
- [X] T002 [P] Add `@iarna/toml ^2.2.5` (or vetted equivalent) to `packages/storage/package.json` dependencies for the `config.toml` reader required by `corpus://recent`'s configurable window size N. Verify pure-JS (native-addon allowlist unchanged). *plan.md Decision C, recent-adapter.ts config dependency*
- [X] T003 [P] Extend `packages/contracts/src/paths.ts` with the derived getter `sp002FixturesRoot()` returning `path.join(Paths.cache(), 'sp002-fixtures')`. Export from the `Paths` frozen object alongside the existing SP-001 getters; do NOT add hardcoded path literals anywhere outside this file (NFR `paths-from-resolver-only` lint rule from SP-001 enforces). *Constitution XIV, plan.md "Decisions resolved"/Decision B*
- [X] T004 [P] Extend `packages/contracts/src/errors.ts` with three new typed errors: `DocumentNotFoundError({docId})`, `IndexLockedError({uri})`, `IntegrityLossError({requestedId, frontmatterFoundId})`, plus the forward-compat `TaxonomyParseError` (reserved for SP-004 — exported but not thrown in SP-002). Each carries `name`, structured `data`, and the constitutional library-package contract (no `process.exit`). *Constitution XI, contracts/mcp-resources-api.md error-codes table, contracts/resource-document.md "URI integrity contract"*
- [X] T005 [P] Create `packages/contracts/src/version.ts` exporting `SCHEMA_VERSION = 'v1.0.0'` and `TAXONOMY_VERSION = 'v1.0.0'` constants (referenced by manifest-adapter and forward by SP-003+ schema migrations). *contracts/resource-manifest.md "Field semantics"*
- [X] T006 Create the fixture-templates directory layout under `tests/fixtures/sp002-populated/` with placeholder files (created empty here, populated by Phase 2 fixture-loader work): `documents.sql`, `taxonomy-promoted.json`, `taxonomy-mixed.json`, `recent-25-success.sql`, `recent-mixed-failure.sql`, `searchhit-fixture-uris.json`, `frontmatter-minimum.yaml`. Add `tests/fixtures/sp002-populated/README.md` documenting fixture provenance and the column-list import discipline (per plan.md R6 — fixture SQL imports column list from `schema-migration.ts`). *plan.md Decision B, R6*
- [X] T007 [P] Scaffold the new eslint rule file `tools/eslint-rules/no-writes-from-resource-handlers.ts` (skeleton only — implementation in Phase 7 polish). Stub exports the rule meta and an empty `create` function returning `{}` so `eslint.config.js` wiring in T008 lints clean. *contracts/mcp-resources-api.md §"Read-only enforcement (SC-010)", SC-010*
- [X] T008 Wire the (still-stubbed) `no-writes-from-resource-handlers` rule into `eslint.config.js` flat config alongside SP-001's 5 custom rules; scope it to `packages/transport/src/resource-*-handler.ts` and `packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts`. Lint must remain exit-0 with the empty stub. *SC-010*

**Checkpoint**: `npm install` picks up `js-yaml` + TOML reader; `npm run build` succeeds (no source change yet beyond Phase 1's three small files); `npm run lint` exits 0; `Paths.sp002FixturesRoot()` resolves under `Paths.cache()`. Toolchain ready for Phase 2 foundational work.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story depends on — payload schemas, telemetry-event class, telemetry helper, read-only SQLite open, schema migration, fixture loader, frontmatter parser, config loader, cold-start error wiring.

**⚠️ CRITICAL**: No user-story work begins until Phase 2 completes.

### Tests (mandatory per Constitution V/VII/IX/XIII/XIV)

- [X] T009 [P] Unit test `tests/unit/resource-schemas.test.ts` — Zod round-trip for the four payload schemas: `ManifestPayload`, `TaxonomyPayload` (4-axis envelope), `RecentPayload` (entries array), `DocumentPayload` (uri + body + frontmatter with `.passthrough()`). Empty-state and populated-state shapes both validate; type-mismatch inputs fail with named issues. *Constitution V, contracts/resource-{manifest,taxonomy,recent,document}.md*
- [X] T010 [P] Unit test `tests/unit/telemetry-resource-events.test.ts` — Zod schema for `ResourceReadEvent` validates: `event` literal, ISO-8601 timestamp, closed-enum `resource_uri`, optional `doc_id` (required for `corpus://docs/*`, absent for the three statics), `result` enum, `severity` enum, integer `duration_ms`, UUID `request_id`. ≤4096-byte serialization assertion. Severity-mapping table verified against contracts/telemetry-resource-events.md. *Constitution V, IX, XIII, contracts/telemetry-resource-events.md*
- [X] T011 [P] Unit test `tests/unit/telemetry-event-rename.test.ts` — assert the rename `EgressEvent → TelemetryEvent` is additive: legacy `EgressEvent` import still resolves (deprecated alias), all four event variants (`egress.attempted`, `egress.blocked`, `egress.checkpoint`, `resource.read`) parse through `TelemetryEvent.parse`, no breaking change for SP-001 callers. *Constitution V, contracts/telemetry-resource-events.md "Discriminated union extension"*
- [X] T012 [P] Unit test `tests/unit/sqlite-open.test.ts` — `openIndexReadOnly()` returns a `better-sqlite3` Database with `readonly: true`, `journal_mode = WAL`, `busy_timeout = 5000`. Attempting an `INSERT`/`UPDATE` on the returned handle throws `SQLITE_READONLY`. The `isSqliteBusyError(err)` predicate detects `SQLITE_BUSY` from a synthetic busy-error fixture. *Constitution VII, IX, contracts/mcp-resources-api.md "Read-only enforcement"*
- [X] T013 [P] Unit test `tests/unit/schema-migration.test.ts` — `runSchemaMigration(db)` creates the empty `documents` table with the contracted columns (id PK, title, body_path, source_path, facet_domain, tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status), the two indices (`idx_documents_status_ingest_ts`, `idx_documents_facet_domain`), the `taxonomy_terms` table with composite PK, and the `idx_taxonomy_terms_state_axis` index. Idempotent (`IF NOT EXISTS`). CHECK constraints reject malformed `id` and bad `status` values. *data-model.md "Persistent state", plan.md R4*
- [X] T014 [P] Unit test `tests/unit/fixture-loader.test.ts` — `loadFixture(testId, fixtureName)` creates a per-test `<test-id>` subdirectory under `Paths.sp002FixturesRoot()`, initializes a fresh SQLite at the per-test `Paths.indexDb()`, runs the schema migration, executes the fixture SQL, writes synthetic taxonomy state into the `taxonomy_terms` table, and returns a `cleanup()` callback. Per-test isolation verified across two parallel test invocations (no row leakage). Cleanup removes the per-test root completely. *plan.md Decision B*
- [X] T015 [P] Unit test `tests/unit/markdown-frontmatter.test.ts` — `parseMarkdownWithFrontmatter(text)` splits on `---` delimiters, parses the YAML block via `js-yaml`, returns `{body, frontmatter}`. Round-trip with `stringifyMarkdownWithFrontmatter` is lossless on canonical inputs. Malformed frontmatter (unterminated block, invalid YAML) rejects with a typed error; missing frontmatter returns body verbatim and an empty frontmatter object. *Constitution V, contracts/resource-document.md adapter behavior*
- [X] T016 [P] Unit test `tests/unit/yaml-helpers.test.ts` — `parseYaml(text)` and `stringifyYaml(obj)` from `packages/contracts/` wrap `js-yaml` with the project conventions: parsing rejects multi-document streams (`yaml.loadAll` not used); stringification emits stable key order; round-trip preserves canonical inputs. *Constitution V (single YAML library), plan.md R5*
- [X] T017 [P] Unit test `tests/unit/config-loader.test.ts` — `loadResourceConfig()` reads `Paths.config() + '/config.toml'`, returns `{recent: {window_size: 10}}` on missing file (defaults applied), parses the `[resources.recent] window_size = N` key, validates `N ∈ [1, 100]` with bounds-rejection at boot, surfaces a `ConfigurationError` for out-of-range values. *plan.md Decision C, contracts/resource-recent.md "Window size N"*
- [X] T018 [P] Unit test `tests/unit/emit-resource-read.test.ts` — `emitResourceRead({resource_uri, doc_id?, result, duration_ms, request_id})` from `packages/transport/src/resource-telemetry.ts` derives `severity` per the mapping table (success→info, document_not_found/index_locked/server_initializing→warn, error→error), captures `timestamp` at emit, delegates to `emitTelemetry` with the discriminated `event: 'resource.read'`, and asserts ≤4096-byte serialization on every call. *contracts/telemetry-resource-events.md "Emit helper"*
- [X] T019 [P] Integration test `tests/integration/resource-cold-start.test.ts` — boot the MCP server WITHOUT calling `markReady()`; issue `resources/list`, `resources/templates/list`, and `resources/read` (each of the four URIs); assert each returns `McpError` with code `-32002`, message `server_initializing`, `data.retry_after_ms === 1000`, `data.phase === "bootstrapping"`. Then call `markReady()` and re-issue each — assert success / appropriate response. Mirrors SP-001's `mcp-cold-start-error.test.ts` pattern. *contracts/mcp-resources-api.md "Bootstrap ordering", FR-005..FR-008 cross-cutting cold-start contract, edge case "Resource read while server is initializing"*

### Implementation

- [X] T020 [P] Implement `packages/contracts/src/yaml.ts` — single-source YAML helpers `parseYaml(text)` and `stringifyYaml(obj)` wrapping `js-yaml` with conventions (no multi-doc, stable key order). Export from `packages/contracts/src/index.ts`. *Constitution V, plan.md R5*
- [X] T021 [P] Implement `packages/contracts/src/markdown-frontmatter.ts` — `parseMarkdownWithFrontmatter(text)` and `stringifyMarkdownWithFrontmatter({body, frontmatter})` using the yaml helpers from T020. Splits on `---` delimiters; rejects malformed frontmatter with a typed error. Export from index. *contracts/resource-document.md adapter pseudocode*
- [X] T022 [P] Implement `packages/contracts/src/resource-schemas.ts` — Zod schemas `ManifestPayload`, `TaxonomyTerm`, `TaxonomyPayload` (4-axis envelope), `RecentEntry`, `RecentPayload`, `DocumentFrontmatter` (with `.passthrough()`), `DocumentPayload`. ISO-8601 regex shared via constant; doc-id regex shared via constant; SHA-256-hex regex shared. Export all schemas + inferred types from index. *Constitution V, contracts/resource-{manifest,taxonomy,recent,document}.md, data-model.md*
- [X] T023 [P] Extend `packages/contracts/src/telemetry.ts` — add `ResourceReadEvent` Zod schema (event literal, ISO-8601 timestamp, ResourceUri enum, optional doc_id, ResourceReadOutcome enum, integer duration_ms, UUID request_id, severity enum). Rename the existing `EgressEvent` discriminated union to `TelemetryEvent`; export `TelemetryEvent` AND a deprecated alias `export const EgressEvent = TelemetryEvent` (with `@deprecated` JSDoc). The existing `emitTelemetry` and `emitTelemetrySync` continue to accept the union without signature change. *Constitution V, IX, XIII, contracts/telemetry-resource-events.md "Discriminated union extension"*
- [X] T024 Implement `packages/contracts/src/version.ts` and `packages/contracts/src/errors.ts` extensions per Phase 1 design — `SCHEMA_VERSION`, `TAXONOMY_VERSION`, `DocumentNotFoundError`, `IndexLockedError`, `IntegrityLossError`, `TaxonomyParseError`, `ConfigurationError`. Re-export from index. (Phase 1 added the package.json declarations + path getter; Phase 2 ships the actual error implementations.) *contracts/mcp-resources-api.md error-codes table*
- [X] T025 [P] Implement `packages/storage/src/sqlite-open.ts` — `openIndexReadOnly()` opens `Paths.indexDb()` via `better-sqlite3` with `{readonly: true, fileMustExist: false}`, sets `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, returns the Database handle. Export `isSqliteBusyError(err)` predicate detecting `SQLITE_BUSY` / `SQLITE_BUSY_TIMEOUT` from native errors. *Constitution VII, IX, contracts/mcp-resources-api.md*
- [X] T026 Implement `packages/storage/src/schema-migration.ts` — `runSchemaMigration(db)` executes the `documents` and `taxonomy_terms` table DDL plus the three indices verbatim from `data-model.md` §"Persistent state", idempotent via `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Exports the canonical `DOCUMENTS_COLUMN_LIST` constant so the fixture SQL can import the column ordering and column-shape drift surfaces immediately as fixture-load failures. *data-model.md, plan.md R4, R6*
- [X] T027 [P] Implement `packages/storage/src/config-loader.ts` — `loadResourceConfig()` returns `{recent: {window_size: number}}` from `Paths.config() + '/config.toml'`. Defaults to 10 on missing file/key. Validates `[1, 100]` range; throws `ConfigurationError` for out-of-range values. Returns synchronously (no IO Result type — config load is a boot-time gate). *plan.md Decision C, contracts/resource-recent.md*
- [X] T028 Implement `packages/storage/src/fixtures.ts` (test-only export) — `loadFixture(testId, fixtureName, options?)`. Creates `Paths.sp002FixturesRoot() + '/<test-id>/'` directory; initializes fresh SQLite at the per-test `Paths.indexDb()` and runs `runSchemaMigration`; reads the named fixture SQL from `tests/fixtures/sp002-populated/<fixtureName>.sql` and executes it; writes synthetic taxonomy state into `taxonomy_terms` from `tests/fixtures/sp002-populated/<fixtureName>.taxonomy.json` if present; returns `{db, cleanup}` where `cleanup()` removes the per-test root. NOT exported from the package's public `index.ts` — test-only export via `packages/storage/src/fixtures.ts` direct import path. *plan.md Decision B*
- [X] T029 Populate the empty fixture template files created in T006 with the contracted contents: `documents.sql` with `INSERT INTO documents (...) VALUES (...)` for the 5 standard fixture documents (column list imported from `DOCUMENTS_COLUMN_LIST`); `taxonomy-promoted.json` with 2 promoted domains + 3 promoted tags; `taxonomy-mixed.json` with 2 promoted domains + 3 promoted tags + 2 proposed tags (for SC-005); `recent-25-success.sql` with 25 successful ingests (descending timestamps); `recent-mixed-failure.sql` with 5 success + 5 `status='failed'` rows (for SC-006); `searchhit-fixture-uris.json` with 5 SearchHits whose `uri` fields point at known fixture doc ids (for SC-007); `frontmatter-minimum.yaml` with the v1 minimum frontmatter template. *plan.md Decision B, R6*
- [X] T030 [P] Implement `packages/transport/src/resource-telemetry.ts` — `emitResourceRead(input)` typed wrapper per `contracts/telemetry-resource-events.md` §"Emit helper". Severity-mapping table inlined as `SEVERITY_MAP` constant. Captures `timestamp` at emit, delegates to `emitTelemetry` from `@llm-corpus/contracts`. Also export `MCP_ERROR_CODES = { server_initializing: -32002, document_not_found: -32010, index_locked: -32011 }` as the canonical error-code mapping (consumed by all four resource handlers). *contracts/telemetry-resource-events.md, contracts/mcp-resources-api.md error codes*
- [X] T031 Extend `packages/transport/src/mcp-server.ts` — add the `ready` flag's coverage of `resources/list`, `resources/templates/list`, `resources/read` request handlers (mirroring the existing SP-001 `tools/list` cold-start gate). Add the dispatch table in the `ReadResourceRequestSchema` handler that exact-matches the three static URIs first, then regex-matches `^corpus:\/\/docs\/(doc-[0-9a-f]{8})$`, falling through to `-32602` (Invalid params) for unknown URIs. Resource handlers themselves are registered in their respective user-story phases below. *contracts/mcp-resources-api.md "Registration shape", "Bootstrap ordering"*

**Checkpoint**: Foundation ready. `npm run lint` exits 0; `npm run build` succeeds; `npm run test:unit` passes (all Phase 2 unit tests); `tests/integration/resource-cold-start.test.ts` passes. User-story phases (US1, US2, US4) can now run in parallel; US3 has soft dependency on US4 noted in the dependency section.

---

## Phase 3: User Story 1 — Manifest auto-loaded at session start (Priority: P1) 🎯 MVP

**Goal**: An MCP-aware agent connecting at session start auto-loads `corpus://manifest` per the resource's standard MCP annotation and discovers corpus size, established vocabulary, and last-ingest timestamp without issuing any search.

**Independent Test**: Boot the MCP server. Connect an MCP-spec client over stdio. Issue `resources/list`. Verify `corpus://manifest` appears with the auto-load annotation. Read the resource. On the SP-001 empty index, the payload is the canonical empty-state manifest (doc_count: 0, all lists empty, last_ingest_timestamp: null, schema/taxonomy versions populated).

### Tests for US1 (mandatory per Constitution V, XIII, XIV, XV)

- [X] T032 [P] [US1] Unit test `tests/unit/manifest-adapter.test.ts` — `buildManifest(signal)` against an empty SQLite returns `Result.ok({doc_count: 0, established_domains: [], established_tags: [], last_ingest_timestamp: null, schema_version: 'v1.0.0', taxonomy_version: 'v1.0.0'})`. Against a fixture SQLite with 247 success rows + 3 promoted domains + 5 promoted tags, returns the populated shape with sorted-ascending lexicographic domain/tag lists. The empty-state invariant (doc_count==0 ⇒ all four data fields empty/null) asserted. `signal.throwIfAborted()` propagates. SQLite busy returns `Result.err(IndexLockedError)`. *FR-005, US1 AS3, data-model.md "Validation rules", contracts/resource-manifest.md*
- [X] T033 [P] [US1] Integration test `tests/integration/manifest-handler-empty.test.ts` — boot MCP server with empty `CORPUS_HOME`, run schema migration, issue `resources/read` for `corpus://manifest`, assert response is the canonical empty-manifest JSON in a single `contents[0]` entry with `mimeType: "application/json"`, payload validates against `ManifestPayload`, exactly one `resource.read` event with `result: 'success'` is appended to telemetry. *FR-005, US1 AS3, US1 AS4, SC-004 partial, SC-009 contributory*
- [X] T034 [P] [US1] Integration test `tests/integration/manifest-resource-listing.test.ts` — boot MCP server, issue `resources/list`, assert: (a) `corpus://manifest` appears in `result.resources`; (b) the entry carries an `annotations` object with `audience: ['assistant']` and `priority: 1.0` (the standard MCP auto-load annotation per contracts/resource-manifest.md); (c) NO entry appears at `corpus://manifest.json`, `/manifest`, or any non-canonical URI; (d) the listing is stable across two cold-starts of the server. *FR-005, US1 AS1, US1 AS2, SC-002 partial, SC-003*
- [X] T035 [P] [US1] Integration test `tests/integration/manifest-handler-populated-fixture.test.ts` — load the `taxonomy-promoted.json` fixture (2 domains + 3 tags promoted) and 5 successful documents, issue `resources/read corpus://manifest`, assert `doc_count === 5`, `established_domains` is the 2 promoted domains sorted, `established_tags` is the 3 promoted tags sorted, `last_ingest_timestamp` is the MAX over the fixture rows. *FR-005, populated-state coverage, contracts/resource-manifest.md "Populated example"*

### Implementation for US1

- [X] T036 [US1] Implement `packages/storage/src/manifest-adapter.ts` — `buildManifest(signal)` per the contracts/resource-manifest.md adapter pseudocode. Single SQLite open via `openIndexReadOnly()`; four prepared statements (count, last_ingest, domains, tags); `signal.throwIfAborted()` between statements. SQLite busy → `Result.err(IndexLockedError)`. Always closes `db` in `finally`. *FR-005, Constitution VII, IX, XV, contracts/resource-manifest.md*
- [X] T037 [US1] Implement `packages/transport/src/resource-manifest-handler.ts` — `manifestHandler(uri, signal)` per the contracts/telemetry-resource-events.md §"Caller contract" pattern: capture `startTime` and `requestId`; `signal.throwIfAborted()`; invoke `buildManifest`; on `Result.ok` validate via `ManifestPayload.safeParse`, emit `resource.read` with `result: 'success'`, return `{contents: [{uri, mimeType: 'application/json', text: JSON.stringify(...)}]}`; on `Result.err(IndexLockedError)` emit `result: 'index_locked'` then throw `McpError(-32011, 'index_locked', {retriable: true, retry_after_ms: 250})`; on safeParse failure emit `result: 'error'` then throw `McpError(-32603, 'Internal error', {validation_issues: [...]})`. *FR-005, FR cross-cutting telemetry/read-only, contracts/resource-manifest.md, contracts/telemetry-resource-events.md*
- [X] T038 [US1] Wire `resource-manifest-handler` into `mcp-server.ts` registration: add `corpus://manifest` to the `ListResourcesRequestSchema` response with `name`, `description`, `mimeType: 'application/json'`, and the auto-load `annotations: {audience: ['assistant'], priority: 1.0}`; route `corpus://manifest` exact-match to `manifestHandler` in the dispatch table. *FR-005, US1 AS1, US1 AS2, contracts/mcp-resources-api.md*

**Checkpoint**: US1 complete. SC-004 partial (manifest empty-state) verified live; SC-002 partial (manifest discoverability) and SC-003 (auto-load annotation) verified; US1 acceptance scenarios 1, 2, 3, 4 all pass.

---

## Phase 4: User Story 2 — Taxonomy as filter-vocabulary contract (Priority: P1)

**Goal**: An MCP-aware agent reads `corpus://taxonomy` to discover the user-promoted vocabulary across all four `SearchFilter` axes (domains, tags, types, source_types) before formulating filter-aware `corpus.find` queries.

**Independent Test**: Boot the MCP server. Read `corpus://taxonomy`. On the SP-001 empty corpus, all four axes are empty arrays (schema-valid empty envelope). Against the `taxonomy-mixed.json` fixture (2 promoted + 3 promoted-tags + 2 proposed-tags), the response includes ONLY the promoted entries; both proposed tags are absent.

### Tests for US2 (mandatory per Constitution V, XIII, XV)

- [X] T039 [P] [US2] Unit test `tests/unit/taxonomy-adapter.test.ts` — `buildTaxonomy(signal)` against empty SQLite returns `Result.ok({domains: [], tags: [], types: [], source_types: []})`. Against the `taxonomy-mixed.json` fixture (2 promoted domains + 3 promoted tags + 2 proposed tags), returns ONLY the promoted entries; the 2 proposed tags are absent from ALL four axes. Per-term `document_count` matches the fixture document count. Per-axis lexicographic ascending sort verified. SQLite busy → `Result.err(IndexLockedError)`. *FR-006, US2 AS1, US2 AS2, US2 AS3, Constitution XV, contracts/resource-taxonomy.md*
- [X] T040 [P] [US2] Unit test `tests/unit/taxonomy-tag-counting.test.ts` — `countDocsWithTag(db, tag)` uses `json_each(d.tags_json)` to count docs containing the tag. Verified across edge cases: doc with 0 tags, doc with 1 tag, doc with multiple tags, tag appearing in some-but-not-all docs, tag with special characters (escaped JSON). Constitution VIII (no SQL injection) — parameterized binding only. *FR-006, contracts/resource-taxonomy.md adapter pseudocode*
- [X] T041 [P] [US2] Integration test `tests/integration/taxonomy-handler-empty.test.ts` — boot MCP server with empty corpus, issue `resources/read corpus://taxonomy`, assert response is `{domains: [], tags: [], types: [], source_types: []}` in a single `contents[0]` JSON entry, payload validates against `TaxonomyPayload`, types/source_types axes are NOT pre-populated with their fixed-enum values at zero count (they remain empty arrays per data-model.md "Empty-state semantics"). *FR-006, US2 AS3, SC-004 partial*
- [X] T042 [P] [US2] Integration test `tests/integration/taxonomy-promoted-only.test.ts` — load `taxonomy-mixed.json` fixture, issue `resources/read corpus://taxonomy`, assert: `domains` axis contains exactly the 2 promoted domains with correct `document_count`s; `tags` axis contains exactly the 3 promoted tags (NOT the 2 proposed); both proposed tags absent from ALL four axes; types and source_types axes contain the established subset only. *FR-006, US2 AS1, US2 AS2, SC-005, Constitution XV*
- [X] T043 [P] [US2] Integration test `tests/integration/taxonomy-resource-listing.test.ts` — issue `resources/list`, assert `corpus://taxonomy` appears with `mimeType: 'application/json'` and NO `annotations` object (taxonomy is read-on-demand, NOT auto-loaded — only manifest carries the annotation). *FR-006, contracts/resource-taxonomy.md "Registration", SC-002 partial*

### Implementation for US2

- [X] T044 [US2] Implement `packages/storage/src/taxonomy-adapter.ts` — `buildTaxonomy(signal)` per contracts/resource-taxonomy.md adapter pseudocode. Per-axis prepared statement filtering on `state = 'established'`; `countDocsForAxis` switch over the four axis values; `countDocsWithTag` uses `json_each` for tag-array membership counts. Lexicographic sort via SQLite `ORDER BY term ASC`. SQLite busy → `Result.err(IndexLockedError)`. *FR-006, Constitution V, XV, contracts/resource-taxonomy.md*
- [X] T045 [US2] Implement `packages/transport/src/resource-taxonomy-handler.ts` — `taxonomyHandler(uri, signal)` mirroring T037's pattern: validate via `TaxonomyPayload.safeParse`, emit telemetry on every path, throw `McpError` for failures. Outcome map: success / index_locked / error. *FR-006, contracts/resource-taxonomy.md, contracts/telemetry-resource-events.md*
- [X] T046 [US2] Wire `resource-taxonomy-handler` into `mcp-server.ts`: add `corpus://taxonomy` to `ListResourcesRequestSchema` response (no auto-load annotation); route exact-match in dispatch table. *FR-006, contracts/mcp-resources-api.md*

**Checkpoint**: US2 complete. SC-002 partial (taxonomy discoverability), SC-004 partial (taxonomy empty-state), and SC-005 (promoted-only fixture-driven) all verified. US2 acceptance scenarios 1, 2, 3, 4 all pass.

---

## Phase 5: User Story 4 — Per-document dereference (Priority: P1)

**Goal**: A `corpus.find` SearchHit URI of the form `corpus://docs/{id}` dereferences to a structured `DocumentPayload` with normalized Markdown body and YAML frontmatter (id, source_path, ingest_timestamp, mime_type, hash). Error envelopes for `document_not_found` and `index_locked` follow the contracts/mcp-resources-api.md error-codes table.

**Independent Test**: Read `corpus://docs/doc-anything` against an empty corpus → MCP error `-32010 document_not_found`. Read `corpus://docs/doc-ab12cd34` against the populated fixture → success with parsed body + frontmatter, `frontmatter.id === doc-ab12cd34`. Read `corpus://docs/{any_existing_id}` while the test harness holds the SQLite writer lock → MCP error `-32011 index_locked` with `retriable: true`.

**Sequencing rationale**: US4 ships before US3 because per-document is the SearchHit dereferencing dependency and has higher P1 priority. US3 (recent) reuses US4's `documents` table column shape but is otherwise independent.

### Tests for US4 (mandatory per Constitution V, VII, VIII, XIII, XIV)

- [X] T047 [P] [US4] Unit test `tests/unit/document-adapter.test.ts` — `fetchDocument(docId, signal)` against fixture SQLite with `doc-ab12cd34` row + body file at `Paths.docs() + '/<body_path>'`: returns `Result.ok({uri: 'corpus://docs/doc-ab12cd34', body, frontmatter})` with `body` stripped of frontmatter and `frontmatter` parsed via the markdown-frontmatter helper. For unknown id: returns `Result.err(DocumentNotFoundError)`. For body-file frontmatter id ≠ requested id: returns `Result.err(IntegrityLossError)`. SQLite busy → `Result.err(IndexLockedError)`. `signal.throwIfAborted()` between SQLite read and file read. Trash (`status='trashed'`) and failure-lane (`status='failed'`) rows return `DocumentNotFoundError` (excluded by `WHERE status='success'`). *FR-008, US4 AS1, US4 AS2, US4 AS4, Constitution VII, VIII, contracts/resource-document.md*
- [X] T048 [P] [US4] Unit test `tests/unit/document-adapter-malformed-id.test.ts` — `fetchDocument('not-a-doc-id', signal)` short-circuits before SQLite IO; the dispatch in `mcp-server.ts` rejects malformed URIs at `-32602` Invalid params layer, but adapter-level defensive validation also rejects (defense in depth). Adapter accepts ONLY ids matching `/^doc-[0-9a-f]{8}$/`. *FR-008, contracts/mcp-resources-api.md "Validation gates"*
- [X] T049 [P] [US4] Integration test `tests/integration/document-handler-not-found.test.ts` — boot MCP server with empty corpus, issue `resources/read corpus://docs/doc-missing`, assert MCP error code `-32010`, message `document_not_found`, `data.uri === 'corpus://docs/doc-missing'`, `data.doc_id === 'doc-missing'`. Telemetry event with `result: 'document_not_found'`, `severity: 'warn'`, `doc_id: 'doc-missing'` is appended. *FR-008, US4 AS2, SC-008 part 1, SC-009 contributory*
- [X] T050 [P] [US4] Integration test `tests/integration/document-handler-found.test.ts` — load fixture with `doc-ab12cd34`, issue `resources/read corpus://docs/doc-ab12cd34`, assert response has single content entry, `text` parses as `DocumentPayload`, `payload.uri === 'corpus://docs/doc-ab12cd34'`, `payload.frontmatter.id === 'doc-ab12cd34'`, `payload.frontmatter.hash` is 64-hex-char SHA-256, `payload.frontmatter.mime_type === 'text/markdown'`, `payload.body` is the Markdown body sans frontmatter. *FR-008, US4 AS1, contracts/resource-document.md*
- [X] T051 [P] [US4] Integration test `tests/integration/document-handler-index-locked.test.ts` — fixture corpus opens a SECOND SQLite connection holding an exclusive transaction (WAL writer lock); test issues `resources/read corpus://docs/{existing_id}`; with `busy_timeout=5000ms` and the writer holding past that window, adapter returns `IndexLockedError`; assert MCP error code `-32011`, `data.retriable === true`, `data.retry_after_ms ≥ 0`, `data.uri` echoes the request. Telemetry `result: 'index_locked'`, `severity: 'warn'`. *FR-008, US4 AS4, SC-008 part 2, edge case "Index lock contention"*
- [X] T052 [P] [US4] Integration test `tests/integration/document-handler-integrity-loss.test.ts` — fixture with body file whose frontmatter `id` field does NOT match the requested URI's id; adapter returns `IntegrityLossError`; handler maps to `McpError(-32603, 'Internal error', ...)` with `severity: 'error'` telemetry. This is a corpus-bug surface, not user error; recorded for forensics. *FR-008, contracts/resource-document.md "URI integrity contract", Constitution VIII*
- [X] T053 [P] [US4] Integration test `tests/integration/searchhit-uri-dereference.test.ts` — load 5 fixture documents AND the `searchhit-fixture-uris.json` fixture (5 SearchHits whose `uri` fields point at the documents); for each SearchHit: validate URI matches `^corpus://docs/doc-[0-9a-f]{8}$`, read via `resources/read`, parse `DocumentPayload`, assert `payload.frontmatter.id === searchHit.id`. Zero dereference mismatches across the fixture set. *FR-008, US4 AS3, SC-007*
- [X] T054 [P] [US4] Integration test `tests/integration/document-resource-template-listing.test.ts` — issue `resources/templates/list`, assert response has exactly one template `{uriTemplate: 'corpus://docs/{id}', name: 'Document by ID', mimeType: 'application/json'}`. The static-resources `resources/list` does NOT contain `corpus://docs/{id}` (template lives in the templates list, not the static list, per Decision A). *FR-008, US4 AS1 dispatch surface, SC-002 partial, plan.md Decision A*

### Implementation for US4

- [X] T055 [US4] Implement `packages/storage/src/document-adapter.ts` — `fetchDocument(docId, signal)` per contracts/resource-document.md adapter pseudocode: SQLite SELECT by PK + `status='success'` filter; if no row → `Result.err(DocumentNotFoundError)`; else read body file at `path.join(Paths.docs(), row.body_path)` via `fs.readFile` (utf8); parse via `parseMarkdownWithFrontmatter`; assert `frontmatter.id === docId` else `IntegrityLossError`; return `Result.ok({uri, body, frontmatter})`. SQLite busy → `IndexLockedError`. *FR-008, Constitution VII, VIII, XIV, contracts/resource-document.md*
- [X] T056 [US4] Implement `packages/transport/src/resource-document-handler.ts` — `documentHandler(uri, docId, signal)` mirroring T037's pattern but with the doc-id-bearing telemetry events: every emit carries `resource_uri: 'corpus://docs/*'` AND `doc_id: docId` (success AND failure paths, including `document_not_found` where doc_id is the missing-id agents requested — forensically useful). Outcome map: success / document_not_found / index_locked / integrity_loss (mapped to 'error') / error. Wraps `body` and `frontmatter` together in a single JSON content entry per contracts/resource-document.md "Wire envelope". *FR-008, contracts/resource-document.md, contracts/telemetry-resource-events.md*
- [X] T057 [US4] Wire `resource-document-handler` into `mcp-server.ts`: add `corpus://docs/{id}` template to the `ListResourceTemplatesRequestSchema` response with name + mimeType; in the `ReadResourceRequestSchema` dispatch table, after the three exact-match URIs, regex-match `^corpus:\/\/docs\/(doc-[0-9a-f]{8})$` and route to `documentHandler(uri, match[1], signal)`. Mismatched URIs continue to fall through to the `-32602` Invalid params throw. *FR-008, contracts/mcp-resources-api.md "Registration shape", plan.md Decision A*

**Checkpoint**: US4 complete. SC-002 partial (template discoverability via `resources/templates/list`), SC-007 (SearchHit URI integrity, fixture-driven), SC-008 part 1 (`document_not_found`) and part 2 (`index_locked`) all verified. US4 acceptance scenarios 1, 2, 3, 4, 5 all pass.

---

## Phase 6: User Story 3 — Recent ingests for "what's new" workflows (Priority: P2)

**Goal**: An MCP-aware agent reads `corpus://recent` to retrieve the most recent N=10 successfully ingested documents in descending `ingest_timestamp` order. Failure-lane and trash documents are excluded.

**Independent Test**: Read `corpus://recent` against an empty corpus → `{entries: []}` (schema-valid empty envelope). Against fixture with 25 successful ingests → 10 entries in descending timestamp order. Against fixture with 5 success + 5 failed → 5 entries (failure-lane excluded).

**Sequencing rationale**: US3 ships LAST among user stories per plan.md "User-story sequencing" — it's the only P2 and depends on the `documents` table column shape that US4's adapter work fully exercises.

### Tests for US3 (mandatory per Constitution V, X, XIII)

- [X] T058 [P] [US3] Unit test `tests/unit/recent-adapter.test.ts` — `buildRecent(signal)` against empty SQLite returns `Result.ok({entries: []})`. Against `recent-25-success.sql` fixture with default N=10, returns exactly 10 entries in strict descending `ingest_timestamp` order, ties broken by `id` ascending lexicographic. Each entry has `id`, `title`, `domain`, `tags` (parsed from `tags_json`), `ingest_timestamp`. SQLite busy → `Result.err(IndexLockedError)`. Configurable N via injected config: N=5 returns top 5; N=100 returns all 25 (no padding when fewer-than-N exist). *FR-007, US3 AS1, contracts/resource-recent.md*
- [X] T059 [P] [US3] Unit test `tests/unit/recent-adapter-failure-lane.test.ts` — load `recent-mixed-failure.sql` fixture (5 success + 5 `status='failed'` rows), `buildRecent` returns exactly the 5 success entries, zero failure-lane ids appear. Repeat with 5 success + 5 `status='trashed'` — only success entries appear (Constitution X three-folder routing). *FR-007, US3 AS2, Constitution X, contracts/resource-recent.md "Failure-lane exclusion"*
- [X] T060 [P] [US3] Integration test `tests/integration/recent-handler-empty.test.ts` — empty corpus, issue `resources/read corpus://recent`, assert response is `{entries: []}` validating against `RecentPayload`, single JSON content entry. *FR-007, US3 AS3, SC-004 partial*
- [X] T061 [P] [US3] Integration test `tests/integration/recent-failure-lane-exclusion.test.ts` — load `recent-mixed-failure.sql`, issue `resources/read corpus://recent`, assert `entries.length === 5`, all 5 ids match success-fixture documents, zero failure-lane ids appear, order strictly descending by `ingest_timestamp`. *FR-007, US3 AS2, SC-006*
- [X] T062 [P] [US3] Integration test `tests/integration/recent-N-window.test.ts` — load `recent-25-success.sql` (25 ingests), issue `resources/read corpus://recent` with default config (N=10), assert `entries.length === 10`, descending order. Then re-boot with `config.toml` setting `[resources.recent] window_size = 25`, re-issue, assert `entries.length === 25`. Then config `window_size = 0` or `window_size = 101` → server boot fails with `ConfigurationError` (range [1, 100]). *FR-007, US3 AS1, plan.md Decision C*
- [X] T063 [P] [US3] Integration test `tests/integration/recent-resource-listing.test.ts` — issue `resources/list`, assert `corpus://recent` appears with `mimeType: 'application/json'` and NO `annotations` object. *FR-007, contracts/resource-recent.md "Registration", SC-002 partial*

### Implementation for US3

- [X] T064 [US3] Implement `packages/storage/src/recent-adapter.ts` — `buildRecent(signal)` per contracts/resource-recent.md adapter pseudocode: read N from `loadResourceConfig().recent.window_size`; single prepared statement `SELECT id, title, facet_domain AS domain, tags_json, ingest_timestamp FROM documents WHERE status = 'success' ORDER BY ingest_timestamp DESC, id ASC LIMIT ?`; map rows to entries with `JSON.parse(tags_json)`. SQLite busy → `Result.err(IndexLockedError)`. *FR-007, Constitution X, contracts/resource-recent.md*
- [X] T065 [US3] Implement `packages/transport/src/resource-recent-handler.ts` — `recentHandler(uri, signal)` mirroring T037's pattern with `RecentPayload.safeParse` validation. *FR-007, contracts/resource-recent.md, contracts/telemetry-resource-events.md*
- [X] T066 [US3] Wire `resource-recent-handler` into `mcp-server.ts`: add `corpus://recent` to `ListResourcesRequestSchema` response (no auto-load annotation); route exact-match in dispatch table. *FR-007, contracts/mcp-resources-api.md*

**Checkpoint**: US3 complete. SC-002 partial (recent discoverability), SC-004 partial (recent empty-state), and SC-006 (failure-lane exclusion fixture-driven) verified. US3 acceptance scenarios 1, 2, 3, 4 all pass.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: SC-001 coverage roll-up, SC-009 telemetry coverage, SC-010 read-only enforcement, performance check vs SP-001 baseline, final lint/build/test gates, README/CLAUDE.md updates, single feature-completion commit.

- [ ] T067 [P] Implement `tools/eslint-rules/no-writes-from-resource-handlers.ts` (full implementation; T007/T008 scaffolded the rule). AST scan over the resource-handler call graph (`packages/transport/src/resource-*-handler.ts` and `packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts`). Forbidden patterns: `.exec(...)` and `.run(...)` containing `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`DROP`/`ALTER` (case-insensitive, with whitespace tolerance); `fs.writeFile*`, `fs.appendFile*` (allowlist exception: calls to the project's `emitTelemetry` helper); `fs.mkdir*` (allowlist exception: telemetry-helper boot path). Build fails on violation with file + import named. *SC-010 layer 1*
- [ ] T068 [P] Integration test `tests/integration/resource-read-only-lint.test.ts` — programmatically run the eslint rule against the resource-handler call graph (`new ESLint({...}).lintFiles([...])`) and assert zero errors. PLUS a fixture-driven smoke: open fixture corpus, count rows in `documents` and `taxonomy_terms`, issue 50 mixed resource reads (4 resources × success/failure mix), re-count rows, assert COUNT(*) unchanged in both tables. *SC-010 (eslint rule + runtime row-count smoke)*
- [ ] T069 [P] Integration test `tests/integration/resource-telemetry-50-read.test.ts` — 50-read mixed workload per contracts/telemetry-resource-events.md §"Test coverage": 10 reads of each of the 4 resources against fixture data (40 success), 5 reads of `corpus://docs/doc-missing-*` (5 not_found), 5 reads of `corpus://docs/{any_existing_id}` while a synchronous test fixture holds the WAL writer lock (5 index_locked). Assert: exactly 50 `resource.read` events appended to `Paths.telemetry()` during the test window; every event passes `ResourceReadEvent.parse()`; per-event size ≤ 4096 bytes; outcome distribution {40 success, 5 document_not_found, 5 index_locked}; per-event `request_id` unique; per-event `duration_ms ≥ 0`. *SC-009*
- [ ] T070 [P] Integration test `tests/integration/sp002-suite.test.ts` — orchestration that runs all 10 SC verification tests in the order matching quickstart.md; emits a Pass/Fail report mirroring SP-001's `sp001-suite.test.ts`. Does NOT shell out to vitest sub-runs — exercises the same production primitives the per-SC files exercise so this suite remains fast and deterministic. *SC-001 (every requirement has at least one passing scenario), quickstart.md Pass/Fail Summary*
- [ ] T071 [P] Update repo `README.md` — add "Feature 002 (MCP Resources)" section linking to `specs/002-mcp-resources/` artifacts. Per Constitution Principle XVI: NO cross-agent compatibility claims; performance numbers labeled as targets. *Polish, plan.md Phase 6*
- [ ] T072 [P] Update repo `CLAUDE.md` — extend the SP-001 working-in-this-repo guide with SP-002's surface: 4 read-only resources, the `resource.read` telemetry event class, the empty-baseline schema migration, the fixture harness pattern. *Polish, plan.md Phase 6*
- [ ] T073 Performance check — `tools/perf-check.mjs` extended to measure: `resources/list` cold-start latency target (< 100 ms; currently meeting since the response is a static four-resource listing); per-resource read latency targets (manifest < 50 ms, taxonomy < 50 ms, recent < 50 ms, doc-by-id < 100 ms p95); telemetry-event emission < 1 ms per event (inherits SP-001 baseline of 0.03 ms median). Compare cold-start delta vs SP-001 baseline of 192 ms — SP-002 target is no regression beyond 250 ms. Per Constitution XVI: TARGETS not guarantees; failure is investigation-warranted but not a P1 block. *Polish, plan.md "Performance Goals", Constitution XVI*
- [ ] T074 Final lint pass — `npm run lint` exit 0 with all 6 custom rules active (5 from SP-001 + `no-writes-from-resource-handlers`); zero forbidden imports anywhere in the in-scope tree; zero writes detected from resource-handler call graph. *Polish, SC-010*
- [ ] T075 Final type-check — `npm run build` succeeds with strict TypeScript; project-references build resolves clean; no SP-001 or SP-002 type regressions. *Polish*
- [ ] T076 Final test pass — `npm run test` exits 0 with full unit + integration suite green. SP-001's tests continue to pass. SP-002's tests (Phase 2-7) all green. The 50-read telemetry test and the read-only lint smoke test BOTH pass. *Polish, SC-001 roll-up*
- [ ] T077 Single feature-completion commit on `main` (SP-002 plan landed on `main` per plan.md): "feat(002): SP-002 implementation complete — MCP resources (manifest, taxonomy, recent, per-doc) + resource.read telemetry class + empty-baseline schema migration". Bundle all SP-002 source + tests + lint rule + fixture templates. **Per Engineer-agent task brief: do not push.** *Polish*

**Checkpoint**: SP-002 implementation complete. All 10 SP-002 success criteria pass on the empty-corpus surface and the fixture-driven populated surface. Feature 002 ready for merge to main once PM review approves (Constitution Governance). Re-verification track for SC-005, SC-006, SC-007 runs post-SP-003/004/005/006 via `npm run test:integration:populated-real` (no-op until those features ship).

---

## Dependencies

**Phase ordering**:
- Phase 1 (Setup) → Phase 2 (Foundational): T001-T008 must complete before T009-T031.
- Phase 2 (Foundational) → Phases 3, 4, 5 (User Stories): T020-T031 (foundational impl) must complete before any US handler/adapter task. Foundational tests (T009-T019) can be authored in parallel with foundational impl.
- Phase 3 (US1 Manifest) ⟂ Phase 4 (US2 Taxonomy) ⟂ Phase 5 (US4 Per-doc): all three P1 user stories are independent in code; can run in parallel after Phase 2 completes.
- Phase 6 (US3 Recent) has a soft dependency on Phase 5 (US4) — both adapters share the `documents` table schema; sequencing US3 after US4 simplifies fixture coordination per plan.md "User-story sequencing rationale". Can technically parallelize, but plan recommends US3 last.
- Phase 7 (Polish) depends on Phases 3-6 complete: SC-009 (telemetry 50-read) needs all 4 handlers live; SC-010 (read-only lint) scopes the resource-handler call graph that Phases 3-6 author; SC-001 roll-up needs every per-FR test passing.

**Within a phase**:
- All `[P]`-marked tasks in the same phase can run in parallel (different files, no dependencies).
- Non-`[P]` tasks within a phase have implicit ordering — read the task description.

**Specific cross-phase serializations**:
- T031 (mcp-server.ts cold-start gate) must complete before T038, T046, T057, T066 (per-handler `mcp-server.ts` registration touches the same file — those four tasks themselves serialize, even though the handler-impl tasks T037, T045, T056, T065 parallelize).
- T028 (fixture-loader impl) must complete before T029 (populating fixture template files) — the loader is what reads them, the test population needs the loader's column-list contract.

## Parallel Execution Examples

**Phase 1 (Setup) parallelism**:
- T001, T002, T003, T004, T005, T007 can run in parallel (different files).
- T006, T008 must serialize after T003/T007 respectively.

**Phase 2 (Foundational) parallelism**:
- T009, T010, T011, T012, T013, T014, T015, T016, T017, T018, T019 (test authoring) — all in parallel.
- T020, T021, T022, T023, T025, T027, T030 (impl) — all in parallel after their respective tests.
- T024 (errors.ts + version.ts) sequences with T004/T005 from Phase 1.
- T026 (schema-migration) must precede T028 (fixture-loader) — loader uses migration's column-list constant.
- T029 (populating fixture files) must precede the populated-state US tests (T035, T042, T050, T053, T061, T062, T068, T069).
- T031 (mcp-server.ts cold-start gate) must complete before any per-handler registration in Phases 3-6.

**Phase 3 (US1 Manifest) parallelism**:
- T032, T033, T034, T035 (tests) all parallel.
- T036, T037 sequence (handler depends on adapter).
- T038 (mcp-server.ts wiring) sequences after T037.

**Phase 4 (US2 Taxonomy) parallelism**:
- T039, T040, T041, T042, T043 (tests) all parallel.
- T044, T045 sequence; T046 sequences after T045.

**Phase 5 (US4 Per-doc) parallelism**:
- T047, T048, T049, T050, T051, T052, T053, T054 (tests) all parallel.
- T055, T056 sequence; T057 sequences after T056.

**Phase 6 (US3 Recent) parallelism**:
- T058, T059, T060, T061, T062, T063 (tests) all parallel.
- T064, T065 sequence; T066 sequences after T065.

**Phase 7 (Polish) parallelism**:
- T067, T068, T069, T070, T071, T072 all parallel.
- T073, T074, T075, T076 must serialize toward the end (full-suite gates).
- T077 (commit) is the last task.

## Implementation Strategy

**MVP scope**: User Story 1 (Manifest, P1) + User Story 2 (Taxonomy, P1) + User Story 4 (Per-doc, P1) form the SP-002 MVP — the three P1 stories together establish the structural-awareness layer agents need. US3 (Recent, P2) is the convenience layer; ships in v1 (per FR-007 priority `must`) bundled with the P1 stories.

**Recommended order**: Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4 ∥ Phase 5) → Phase 6 → Phase 7.

**Test-first discipline**: Within each user-story phase, tests are authored BEFORE the corresponding implementation. The Constitution-mandated test surface (Constitution V/VII/VIII/IX/X/XIII/XIV/XV) means failing tests upfront drive the implementation contract — every passing test is a constitutional checkbox earned.

**Total task count**: 77 tasks. Mapped 1:1 to:
- Constitution principles I–XVI: every applicable principle has at least one test or impl task (II, IV, VI not directly exercised — see "Constitution principles → tasks" table below).
- Spec.md user stories US1-US4: every user story has its own phase.
- Spec.md acceptance scenarios: 17 (US1: 4, US2: 4, US3: 4, US4: 5) → covered across phases 3–6.
- Spec.md success criteria SC-001 through SC-010: every SC has at least one task.
- Plan.md project structure: every package + every contract document maps to tasks.
- Plan.md risk register R1-R8: every risk addressed by at least one task (see "Risk register → tasks" table below).

Each task is specific enough that an Engineer agent (or a developer) can complete it without additional context — file path, dependency, and constitutional rationale are inline.

## Sizing call (per `feedback-build-tier-sizing-rule`)

**Estimated LOC**: ~600-900 implementation + ~1200-1800 tests + fixtures = **~1800-2700 LOC total** (per plan.md "Scale/Scope").

**Estimated file count**: ~30-35 net new/modified files:
- 4 resource-handler source files (`packages/transport/src/resource-*-handler.ts`)
- 5 storage adapter source files (`packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts`, `sqlite-open.ts`)
- 4 storage support files (`schema-migration.ts`, `fixtures.ts`, `config-loader.ts`, plus existing `index.ts` extensions)
- 4-5 contracts source files (`resource-schemas.ts`, `markdown-frontmatter.ts`, `yaml.ts`, `version.ts`, plus `errors.ts`/`paths.ts`/`telemetry.ts` extensions)
- 1 transport support file (`resource-telemetry.ts`)
- ~14-16 test files (6 unit, ~10 integration)
- 7 fixture template files
- 1 new eslint rule + config wire
- 2 README/CLAUDE.md updates

**Recommendation**: SP-002 sits **below** the 2000 LOC / 15 files split threshold (~2700 LOC IS above the 2000 LOC threshold — but 60-70% of that is tests + fixtures, which is review-light surface; production surface is ~600-900 LOC across ~14 files). Recommend **single Engineer-agent dispatch** with phase-checkpoint discipline — Engineer halts at each phase Checkpoint for review before proceeding. SP-001 was 4 dispatches for ~12K LOC across 105 files; SP-002's read-only single-concern surface doesn't warrant multi-dispatch.

If `/speckit-implement` time judges otherwise (e.g., parallel agent capacity is available), a 2-dispatch split is natural along the Phase 2 boundary: Dispatch 1 = Phases 1-2 (foundational), Dispatch 2 = Phases 3-7 (user stories + polish).

## Risk register → tasks

Every risk in plan.md §"Risk Register" addressed by at least one task:

| Risk | Description | Addressed by |
|---|---|---|
| R1 | MCP SDK version pin / `server.registerResource()` helper | T031, T038, T046, T057, T066 (each `mcp-server.ts` registration verifies SDK shape at impl time, falls back to manual `setRequestHandler`) |
| R2 | `resources/templates/list` SDK support | T054, T057 (template-listing test verifies SDK shape; T057 is the registration site) |
| R3 | SQLite WAL `busy_timeout` calibration | T012, T025 (sqlite-open uses `busy_timeout=5000`); T051 (busy-timeout exhaust test) |
| R4 | Empty-corpus baseline schema migration / column shape contract | T013, T026 (schema-migration test + impl exports `DOCUMENTS_COLUMN_LIST`); T029 (fixture imports column list) |
| R5 | `js-yaml` dependency / single YAML library rule | T001, T016, T020 (yaml helper centralized in contracts) |
| R6 | Fixture drift post-SP-003 | T026, T029 (column list as canonical; fixture imports it; drift surfaces as fixture-load failure) |
| R7 | Auto-load annotation portability | T034 (test verifies annotation is *attached*, not that any specific client respects it — per Constitution XVI) |
| R8 | Concurrency model with future SP-003 daemon | T025 (sqlite-open per-request; WAL allows concurrent readers + one writer); T051 (busy-timeout + retriable error path) |

## Constitution principles → tasks

Quick mapping of which Constitution principles get exercised by which tasks:

| Principle | Description | Exercised by |
|---|---|---|
| I | Local-First, No Egress | T034, T041, T043, T049, T060, T063 (all integration tests run within the SP-001 egress-hook envelope; any accidental network call hard-fails) |
| II | User Curates, LLM Classifies Metadata | (not exercised — SP-002 ships zero LLM-generated content. T056 returns user-curated body verbatim, no rewriting) |
| III | Substrate, Not Surface | T067, T068 (read-only lint rule + runtime row-count smoke); T037, T045, T056, T065 (handlers take no mutation arguments) |
| IV | Single-User, Single-Machine | (not directly exercised — SP-002 introduces no multi-user code paths) |
| V | Schema-Enforced Structured Output | T009, T010, T022, T023 (Zod schemas for 4 payloads + telemetry event); T037, T045, T056, T065 (handlers `safeParse` before serialization) |
| VI | One Pipeline, Two Policies | (not exercised — SP-002 introduces no pipeline; pipeline begins at SP-003) |
| VII | Cancellable, Bounded IO | T012, T025 (busy_timeout); T032, T039, T047, T058 (adapter `signal.throwIfAborted()` propagation); handlers accept AbortSignal |
| VIII | Atomic Writes & Transactional Index Updates | T052 (integrity-loss test asserts URI ↔ frontmatter id agreement — same SQLite file is search index AND document store) |
| IX | Concurrency-Safe Shared State | T010, T012, T018 (telemetry size budget ≤ 4096 bytes asserted); T051 (WAL writer lock contention → `index_locked`) |
| X | Idempotent Pipeline Transitions; Three-Folder Routing | T059, T061 (failure-lane and trash exclusion in `corpus://recent`) |
| XI | Library/CLI Boundary | T004, T024 (typed errors in `packages/storage/`, no `process.exit`); existing SP-001 `no-process-exit-in-libs` rule covers SP-002 source files |
| XII | Subprocess Hygiene | (not exercised — SP-002 introduces zero subprocess calls in production; lint rule from SP-001 still active) |
| XIII | Telemetry-or-Die | T010, T011, T018, T030 (telemetry helper); T033, T035, T041, T042, T049, T050, T051, T060, T061 (every handler test asserts one event per read on success AND failure paths); T069 (50-read coverage) |
| XIV | XDG Paths via Single Resolver | T003 (`Paths.sp002FixturesRoot()`); T028 (fixture loader uses Paths only); SP-001 `paths-from-resolver-only` rule covers SP-002 source files |
| XV | Dynamic Taxonomy with User-Reviewed Promotion | T039, T042 (promoted-only filter — proposed terms excluded); SC-005 fixture-driven |
| XVI | Validation Honesty | T034 (auto-load annotation attached, NOT enforced); T070 (sp002-suite emits Pass/Fail with honest empty-vs-fixture partition); T073 (perf numbers labeled as TARGETS not guarantees); fixture-driven SC-005/006/007 honestly partitioned from end-to-end SCs |

## Recommended next step

`/speckit-implement` for SP-002 — **single Engineer-agent dispatch** covering T001-T077 with phase-checkpoint discipline (halt at each phase Checkpoint for review).

**Env prerequisites**: NONE beyond what SP-001 established. SP-002 is all-unprivileged — no sudo / root requirements (read-only on the index file, no firewall rule manipulation, no native-addon installs since `js-yaml` is pure JS). The `LLM_CORPUS_ROOT_TESTS=1` gate from SP-001's `tcpdump-sentinel.test.ts` and `child-process-firewall.test.ts` is not relevant to SP-002 — those tests continue to skip cleanly under default `npm run test`.

**Recommended split (if multi-dispatch judged necessary at implement time)**:
- Dispatch 1: T001-T031 (Phases 1-2, foundational — ~600 LOC).
- Dispatch 2: T032-T077 (Phases 3-7, user stories + polish — ~2100 LOC).

Phase 2 boundary is the natural split point: foundational deliverables stand on their own (the new schemas, the schema migration, the telemetry rename, the cold-start error wiring, the fixture loader) and an independent verification gate is achievable before the user-story handlers depend on them.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story (US1, US2, US3, US4) for traceability.
- Each user story can be independently completable and testable on its own slice (Phase 2 + that story's phase).
- Verify tests fail before implementing.
- Commit after each task or logical group at developer discretion; the single feature-completion commit (T077) is the merge gate.
- Stop at any checkpoint to validate story independently.
- Avoid: vague tasks, same-file conflicts (Phases 3-6 share `mcp-server.ts` registration; T031 + T038/T046/T057/T066 serialize this), cross-story dependencies that break independence.
