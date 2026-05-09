# Phase 0 — Research: MCP Resources — Manifest, Taxonomy, Recent Ingests, Per-Document

**Feature**: 002-mcp-resources
**Date**: 2026-05-05

This document records the architectural decisions that gate SP-002. The spec arrived clean (zero `[NEEDS CLARIFICATION]` markers — CLAR-1, CLAR-2, CLAR-3 resolved at spec time on 2026-05-05). The four decisions below are *plan-time* decisions that the spec deferred or that are emergent from spec + SP-001 inheritance.

Format: Decision → Rationale → Alternatives considered.

---

## Decision A — Resource registration shape (static URIs vs. URI template)

**Decision**: Register the three static-URI resources (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`) via the MCP SDK's `resources/list` request handler. Register the `corpus://docs/{id}` URI template via the `resources/templates/list` request handler. Both registrations are mandatory; both lists must be discoverable on cold-start handshake.

**Rationale**:

- The MCP protocol distinguishes static resource URIs (advertised via `resources/list`, RFC 3986 fixed URIs) from RFC 6570 URI templates (advertised via `resources/templates/list`, parameterized URIs that match a family of resources). `corpus://docs/{id}` is a classic RFC 6570 Level 1 template (single path-component variable) and belongs in the templates list per the MCP spec.
- ARCHITECTURE-FINAL §5.2 (lines 283–291) explicitly says "Resource URIs are URI-template valid per RFC 6570" — confirming the architectural intent that per-doc URIs are templates, not static.
- Spec SC-002's exact wording — *"a `resources/list` response that includes exactly four canonical resources / resource templates: `corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, and the `corpus://docs/{id}` template"* — already accommodates the static-vs-template split via the "/ resource templates" clause. SC-002 is **not** literal about everything being in `resources/list`. No SC-002 amendment is required. The plan's `quickstart.md` clarifies: SC-002 verification covers BOTH endpoints (`resources/list` AND `resources/templates/list`); the four URIs together represent SP-002's full canonical surface.
- This decision is the cleaner path. Forcing all four into `resources/list` (the alternative below) would either (a) export a wildcard `corpus://docs/{id}` URI as if it were static — a protocol abuse — or (b) enumerate every single document URI in `resources/list`, which doesn't scale and breaks the auto-load semantic for `corpus://manifest`.

**Alternatives considered**:

- **Static-only registration (everything in `resources/list`)**: Rejected. Protocol abuse, doesn't scale, breaks auto-load semantics.
- **Templates-only registration**: Rejected. The static three URIs (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`) are NOT templates — they have no variable path components. The MCP spec's static-vs-template distinction matches the resource shape; respect it.
- **Custom URI scheme registration**: Rejected. The MCP SDK's standard request handlers cover the use case; no custom scheme handling needed.

**Implementation guidance (for `/speckit-implement`)**: Verify at implementation time whether the pinned `@modelcontextprotocol/sdk ^1.0.0` exposes a `server.registerResource()` high-level helper analogous to `registerTool`. If it does, prefer it; if not, use `setRequestHandler(ListResourcesRequestSchema, ...)` and `setRequestHandler(ListResourceTemplatesRequestSchema, ...)` directly. Both paths are documented in `contracts/mcp-resources-api.md`. Also verify that `ReadResourceRequestSchema` from the SDK matches incoming reads against the static URI exact match before falling through to template URI pattern matching — this is the standard SDK behavior; SP-002 is a consumer, not an author, of that dispatch logic.

---

## Decision B — Fixture harness for populated-corpus tests

**Decision**: Source-controlled fixture *templates* live under `tests/fixtures/sp002-populated/` (raw `.sql`, `.json`, `.yaml` files). Runtime fixture root resolves through a new derived path getter `Paths.sp002FixturesRoot()` returning `path.join(Paths.cache(), 'sp002-fixtures')`. A test-only fixture-loader helper in `packages/storage/src/fixtures.ts` (a) creates a per-test isolated `CORPUS_HOME` under `Paths.sp002FixturesRoot() + '/<test-id>/'`, (b) initializes a fresh SQLite at the per-test `Paths.indexDb()` and runs the contracted schema migration, (c) executes the fixture SQL files to insert synthetic rows, (d) writes synthetic `Paths.taxonomy()` JSON, (e) returns a `cleanup()` callback that removes the per-test root.

A `test:integration:populated-real` script (no-op until SP-005 ships) runs the same integration tests against a real ingested corpus by pointing `CORPUS_HOME` at a developer's actual data root and skipping the fixture-loader setup.

**Rationale**:

- **Constitution XIV (Paths-only)**: Fixtures resolve through `Paths.*` — they live under `Paths.cache() + '/sp002-fixtures/'`. NEVER `os.tmpdir()`, NEVER `/tmp/`, NEVER `vitest`'s default temp roots without going through the resolver. `paths.ts` adds the `sp002FixturesRoot` derived getter; no string literals leak into test files.
- **Per-test isolation**: Each test gets its own `<test-id>` subdirectory so parallel vitest workers don't collide. The fixture-loader generates `<test-id>` from a UUID + the test name; cleanup is per-test.
- **Constitution VIII (atomic writes)**: Fixture setup is a test-time concern; the `withTempDir` helper from `packages/contracts/` is NOT required because fixtures are not "writes the system needs to commit." Fixture loader uses its own per-test directory created with `fs.mkdir({recursive: true})` + cleaned up via the callback. No atomic-rename writers in the fixture path.
- **Fixture template format**: Raw SQL for index rows because (a) it's the most direct way to express what SP-003's INSERTs will produce — the fixture SQL imports the column list from `schema-migration.ts` so any schema drift surfaces immediately as a fixture-load failure; (b) it avoids inventing a parallel fixture-DSL. Raw JSON for taxonomy state because the file format is already JSON. Raw YAML for frontmatter snippets because frontmatter is YAML.
- **Re-verification path**: When SP-003 ships real ingest, populated-corpus tests run via `npm run test:integration:populated-real` — same `*.test.ts` files, different setup hook (no fixture loader; just point at real `CORPUS_HOME`). This honors Constitution XVI: SP-002 is honest that today's populated tests are fixture-driven, and the same tests re-verify against real data later.
- **Why not `withTempDir`?** The contracts package's `withTempDir` is for production atomic-write paths (extract/transform/index workflows). Test fixtures have different lifecycle (ephemeral within a test, not crash-resilient). Per-test cleanup via the loader's returned callback is sufficient. The Constitution VIII tmp-dir lifecycle rule applies to production writers, not test fixtures.

**Alternatives considered**:

- **In-memory SQLite (`:memory:`) for fixtures**: Rejected. Tests would diverge from production semantics — better-sqlite3 with `:memory:` doesn't exercise the real WAL mode, file locking, or `busy_timeout` behavior that the `index_locked` error path depends on. SC-008 (`index_locked` testing) requires a real on-disk WAL file.
- **Fixtures under `tests/.cache/` (project-scoped)**: Rejected. Violates Constitution XIV (paths must resolve through `Paths.*`). The XDG approach via `Paths.cache()` is the constitutional path.
- **Single shared fixture corpus mutated between tests**: Rejected. Breaks parallel test execution; introduces test-ordering dependencies; obscures which fixture state each test exercises.
- **No fixtures, defer all populated tests to post-SP-003**: Rejected. Would block SP-002 from verifying its own resource-handler shapes against representative non-empty data. Constitution XVI demands honesty about what's tested when; the fixture path is the honest middle ground.
- **Test-only export from `packages/storage/src/fixtures.ts` vs a dedicated `packages/test-fixtures/` package**: Selected the test-only export because adding a new package for SP-002 violates the "structure decision: zero new packages" target. The fixture loader imports nothing production-only would import in reverse — clean separation.

---

## Decision C — FR-007 default N (recent-window size)

**Decision**: `N = 10`, configurable via `config.toml` key `resources.recent.window_size` (integer, range 1–100 inclusive, default 10).

**Rationale**:

- **Symmetry with `corpus.find` limit**: SP-001's `corpus.find` tool defaults `limit: 10` (per `packages/transport/src/schemas.ts` `SearchFilter.limit.default(10)`). Agents reasoning about "recent" and "search results" share a mental model; defaulting both to 10 reduces surprise.
- **AC-scenario alignment**: US3 acceptance scenario 1 uses N=10 explicitly (*"the configured recent window is N… `corpus://recent` returns exactly N entries"* with the AC test parameterized at 10). Choosing 10 as the default makes the AC scenario's literal text testable against the default config, no override needed.
- **Agent context-window economics**: 10 entries × ~80 chars/entry (title + domain + tags + ISO timestamp) ≈ 800 chars ≈ 200 tokens — fits any practical agent context. 50 entries (the upper bound of `corpus.find` limit) would be ~4 KB ≈ 1000 tokens for a "what's recent" workflow, which is wasteful for the recap use case US3 targets.
- **Configurability**: The user MAY override via `config.toml`. The configured value is passed to `recent-adapter.ts` at handler-init time, not per-request — this is a server-config decision, not a per-call argument (resources don't take arguments per Constitution III).
- **Range bounds**: `min 1` because zero is meaningless (use absence of the resource if you don't want recents). `max 100` because beyond that the use case shifts toward `corpus.find` with a `since` filter — different surface, don't conflate.
- **Constitution XVI honesty**: This is a default, not a guarantee. The `corpus://recent` resource simply returns at most N entries; if 7 documents exist, it returns 7 (per US3 edge-case "When fewer than N documents exist, the response MUST contain all available documents — not pad to N").

**Alternatives considered**:

- **N = 5**: Rejected. Below typical "what did I add this week" use case; agents would frequently hit the limit and need to call `corpus.find` anyway.
- **N = 25**: Rejected. AC-scenario uses 10; deviating from AC for no engineering reason adds re-verification work post-spec.
- **N = 50**: Rejected. Approaches `corpus.find`'s `limit` upper bound; conflates "recent" use case with "broad listing."
- **Time-based windowing (e.g., last 7 days)**: Rejected at spec time (CLAR-3). Halves test surface.
- **Hybrid (count + time)**: Rejected at spec time (CLAR-3). Future SP can add it if a real use case emerges.

---

## Decision D — Telemetry event class for resource reads

**Decision**: New event class `resource.read`. New contract file `contracts/telemetry-resource-events.md` (separate from SP-001's `contracts/telemetry-egress-events.md`). The `EgressEvent` discriminated union in `packages/contracts/src/telemetry.ts` is renamed to `TelemetryEvent` and extended additively to include `ResourceReadEvent` alongside the existing three egress event variants. The `emitTelemetry` helper continues to accept any variant of the discriminated union; per-call-site type narrowing remains.

**Rationale**:

- **Separation of concerns**: SP-001's `telemetry-egress-events.md` is scoped to *network-primitive interception* — the three event classes (`egress.attempted`, `egress.blocked`, `egress.checkpoint`) all describe outbound-call decisions made by the runtime hook. Adding `resource.read` to that file conflates concerns and bloats the file as more event classes ship.
- **Per-domain contract files**: The pattern SP-002 establishes — one contract file per concern domain — sets up SP-003 (`pipeline.*`: validate, extract, classify, embed, index), SP-004 (`classify.*`: ollama-call, schema-validate), SP-005 (`search.*`: query, rank, hit-emit) for clean expansion. Each future SP adds its own `telemetry-<concern>-events.md`. The `EgressEvent` → `TelemetryEvent` rename is the one-time refactor that opens the door.
- **Same emit infrastructure**: The Zod `discriminatedUnion('event', [...])` pattern handles arbitrary additional event classes additively. The existing `emitTelemetry` and `emitTelemetrySync` helpers continue to work — they validate against the union, serialize, size-check, and append. No new helper, no parallel emission path. SP-002 ships only `emitResourceRead(uri, doc_id?, result, request_id, duration_ms)` as a typed wrapper for ergonomics; the underlying call is `emitTelemetry({event: 'resource.read', ...})`.
- **Constitution XIII "Telemetry-or-Die"**: Every resource read emits an event on success and failure paths. Per-handler test asserts one event per read for each path (success, `document_not_found`, `index_locked`, `server_initializing`, schema-validation failure). The AST-level lint rule from SP-001 covers the new catch sites in resource handlers and storage adapters automatically.
- **Constitution IX size budget**: The `ResourceReadEvent` schema is small and fixed-vocabulary (URI from a closed set of 4, optional `doc_id` matching `doc-[0-9a-f]{8}`, outcome from a 5-element enum, durations as integers, ISO timestamps). Worst-case serialization size is well under 4096 bytes; budget verified in `data-model.md`. Same `assert(serialized.length <= TELEMETRY_MAX_BYTES)` invariant.
- **Renaming `EgressEvent` to `TelemetryEvent`**: One-time, ergonomic. The existing variants retain their names (`EgressAttemptedEvent`, `EgressBlockedEvent`, `EgressCheckpointEvent`); only the *union* is renamed because it is no longer egress-specific. SP-001 callers continue to import `EgressEvent` via a type alias for one minor version (`export type EgressEvent = TelemetryEvent` deprecated); SP-002 callers import `TelemetryEvent`. Tasks phase includes the rename as a Foundational task.

**Alternatives considered**:

- **Extend `telemetry-egress-events.md` with the new event class**: Rejected. Conflates concerns; the file's scope is egress, not "all telemetry." Per-domain files scale better as more event classes ship.
- **Separate emit helper (`emitResourceTelemetry`) with its own size-check**: Rejected. Duplicates Constitution-IX-discipline logic across files; one source of truth for the size assertion is correct.
- **Skip extending the discriminated union, just `z.union([...])`**: Rejected. `discriminatedUnion` provides better type narrowing and faster runtime validation than `union` — keep the existing pattern.
- **Reuse the `egress.checkpoint` event class to record resource reads**: Rejected. `egress.checkpoint` is semantically tied to pipeline-stage transitions inside the egress-guard discipline; resource reads are a different concern and deserve a distinct event class even if shapes overlap.

---

## Decisions imported from SP-001 (already accepted, applicable to SP-002)

These decisions land in SP-002 by inheritance; no re-litigation:

- **`@modelcontextprotocol/sdk` for the MCP server transport** (SP-001 research §"MCP TypeScript SDK"). SP-002 uses the same SDK to register resources and templates.
- **Zod for schema validation** (SP-001 research §"Schema library"). SP-002 adds four new resource payload schemas in the same convention. Zod-derived JSON Schema export via `zod-to-json-schema` for any client-facing schema advertisement.
- **vitest for unit + integration tests** (SP-001 research §"Test runner"). SP-002 adds new test files under the existing `tests/unit/` and `tests/integration/` trees.
- **Append-only JSONL telemetry via `fs.appendFile`** (SP-001 research §"Telemetry sink"). SP-002 reuses the same path; the new `resource.read` event class flows through the same `Paths.telemetry()` sink.
- **better-sqlite3 + sqlite-vec native-addon allowlist** (SP-001 ADR-001). SP-002 adds NO new native addons; `js-yaml` is pure JS.
- **eslint with custom rules** (SP-001 research §"Lint stack"). SP-002 adds one new rule: `no-writes-from-resource-handlers` (or composes from existing rules) to enforce SC-010 by construction.
- **MCP SDK error-code conventions** (SP-001 research open question). SP-002 confirms: `code: -32002` for `server_initializing` (already in use); new SP-002-specific codes `-32010` for `document_not_found`, `-32011` for `index_locked` (both in the JSON-RPC server-defined error range, per spec). Codified in `contracts/mcp-resources-api.md`.

---

## Decisions deliberately deferred to future features

- **`notifications/resources/updated` change-notification stream** (ARCHITECTURE-FINAL §5.2 last paragraph). SP-002 ships the resources themselves; change-notification semantics are deferred. No SP-NNN currently scopes this; tracked in the architecture archive only. SP-002's resource handlers do NOT subscribe to or emit `notifications/*` — clients re-read the resource on demand.
- **`corpus://docs/{id}/images/{n}` per-document image resource** (ARCHITECTURE-FINAL §5.2). NOT in SP-002 scope; deferred until image-extracting ingest lands.
- **`corpus://list?domain=X&type=Y&since=Z` parametric listing** (ARCHITECTURE-FINAL §5.2). NOT in SP-002 scope; agents use `corpus.find` for filter-aware queries.
- **`corpus://trash` soft-deleted-documents resource** (ARCHITECTURE-FINAL §5.2). NOT in SP-002 scope; deferred until soft-delete lands (no SP-NNN currently scopes this).
- **`corpus://failures` and `corpus://health` resources** (mentioned in spec "Out of scope"). Not in scope; not in any SP-NNN.
- **Connection pooling / read-connection lifecycle**. SP-002 uses fresh-connection-per-request for simplicity. Pool optimization is an SP-005+ concern if the benchmark warrants it.
- **Per-resource caching (SDK auto-load semantics)**. The MCP server attaches the standard `auto-load` annotation on `corpus://manifest`; client-side caching policy is the client's concern (Constitution XVI honesty). SP-002 does NOT implement server-side caching.

---

## Open questions (none blocking)

- **MCP SDK resource-helper ergonomics** — see Decision A implementation guidance. Verify at implementation time whether `server.registerResource()` exists in the pinned SDK version.
- **`PRAGMA busy_timeout` calibration** — initial value 5000 ms (5s). Tune at SP-005 time when real writer-lock contention exists. No blocker for SP-002.

Both items are implementation-time refinements, not blockers for `/speckit-tasks` or `/speckit-implement`.
