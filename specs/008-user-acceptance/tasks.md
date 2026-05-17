---
description: "Task list for feature 008-user-acceptance (SP-008)"
---

# Tasks: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate — `engagement.*` Telemetry, `corpus accept`, `corpus engagement-proxy report`, UR-001/UR-002/UR-003, Adversary Scenarios, C-046 E2E Smoke

**Input**: Design documents from `/specs/008-user-acceptance/`
**Prerequisites**: plan.md, spec.md, research.md (Decisions A-D), data-model.md (7 entities), contracts/{adr-acceptance-event-definition.md (ADR-016), adr-engagement-proxy-aggregation.md (ADR-017)}

**Prior state**: SP-001..SP-007 merged on `main`. SP-007 added the `corpus init` 11-step pipeline + `corpus uninstall` + `corpus taxonomy promote` + 12 new SP-007 telemetry classes + the C-046 install smoke harness pattern. SP-008 builds *additively on `packages/cli/`, `packages/contracts/`, and a minimal additive emit in `packages/transport/`* — adds two new CLI command entry points (`accept-command.ts`, `engagement-proxy-command.ts`) + a `packages/cli/src/engagement/` library directory (8 helpers); extends `packages/contracts/src/` with `engagement.ts` (NEW), `telemetry.ts` (4 new event variants additively + optional `request_id?` on SearchQueryEvent per Decision A), `errors.ts` (5 new typed errors additively), `index.ts` (re-exports); extends `packages/transport/src/corpus-find-tool.ts` with an additive `randomUUID()` + `engagement.corpus_find_invoked` emit AFTER the existing `search.query` emit. ZERO new packages. ZERO new SQL tables. ZERO new `Paths.*` getters. ZERO new MCP mutation surfaces. ZERO new outbound non-loopback endpoints.

**Tests**: MANDATORY for tasks touching telemetry events, schema validation, IO, CLI argv parsing, atomic writes, subprocess invocation, Constitution Principles I/V/VII/IX/XI/XIII/XIV/XVI. SP-008 touches all of these — tests are mandatory throughout. Phase 2 PREREQs are RED-phase (failing tests authored first); Phases 3/4/5/6 are GREEN-phase (implementations turn them green) per plan.md "Sizing call" single-phase build (production surface ~800-1200 LOC across ~10 source files — well below the 2000-LOC / 15-file pre-split threshold per `feedback-build-tier-sizing-rule`).

**Scope-bound**: SP-008 ships ONLY the Track A deliverables — (1) four new `engagement.*` telemetry event classes additively in the `TelemetryEvent` union; (2) `corpus accept <request-id> [--note <text>]` CLI subcommand; (3) `corpus engagement-proxy report [--since=<ISO8601>] [--until=<ISO8601>] [--format=text|json] [--telemetry-log=<path>] [--timeout=<ms>]` CLI subcommand; (4) UR-001 / UR-002 / UR-003 integration tests against the production binary; (5) empty-corpus + session-start idempotency adversary integration tests; (6) C-046 end-to-end smoke harness spawning the production binary via real MCP-stdio. SP-008 does NOT ship `--last` flag on `corpus accept` (rejected per Decision D), an MCP-resource form of the report (forbidden per Constitution III + FR-ENGAGEMENT-013), a new SQL table for acceptances (forbidden per FR-ENGAGEMENT-014 + Decision B), cross-agent telemetry surfaces (out of scope per AG-004/OOS-011), C-043 / C-044 fixes (still DEFERRED per FR-ENGAGEMENT-024). Track B is the operator's 7-day dogfood window — code does NOT close SP-008; the Track B verdict captured in RETROSPECTIVE.md does.

**Organization**: Tasks grouped by phase per the SP-007 tasks.md convention. Phase 1 = setup/prereq verification; Phase 2 = foundational PREREQs (contracts landings + lint scope extension + RED-phase tests); Phase 3 = US1 UR-001 + `corpus-find` instrumentation (the additive emit + UR-001 integration tests); Phase 4 = US2 UR-002 + `corpus accept` CLI + UR-002 integration tests; Phase 5 = US3 UR-003 + `corpus engagement-proxy report` CLI + UR-003 integration tests + C-046 E2E smoke harness; Phase 6 = adversary integration tests (empty-corpus + session-start idempotency); Phase 7 = lint + Constitution enforcement; Phase 8 = polish + quickstart + retro + commit. Constitution Check 16/16 [x] verified at plan time; Complexity Tracking empty.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (UR-001), US2 (UR-002), US3 (UR-003) — Phase 3/4/5 user-story tasks carry this label; setup/foundational/adversary/lint/polish tasks do not.
- File paths are repo-relative under `~/Projects/llm-corpus/`.
- Trailing markup: `*Constitution X, FR-ENGAGEMENT-K, SC-008-M*` references.

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-008 adds NEW files to `packages/cli/src/` (2 command files + `engagement/` directory with 8 helpers), `packages/cli/test/` (6 integration / E2E tests), `packages/contracts/src/` (`engagement.ts` NEW), and `tests/{unit,fixtures}/sp008-engagement/` (9 unit tests + fixtures). EXTENDS `packages/cli/src/index.ts` (subcommand dispatcher), `packages/contracts/src/{telemetry,errors,index}.ts`, `packages/transport/src/corpus-find-tool.ts` (minimal additive emit), and `eslint.config.js`. ZERO new packages. ZERO new MCP transport handlers. ZERO new `packages/{daemon,index,inference,pipeline,storage,extract}/` source.

**Branch note**: Branch `008-user-acceptance` already checked out; spec/plan/data-model/research/contracts files at this path are the proof. No T-stub task required.

---

## Phase 1: Setup

**Purpose**: Single one-shot prerequisite verification before any code work. SP-008 introduces ZERO new toolchain dependencies (every dependency — `zod`, `node:fs/promises`, `node:crypto`, `node:readline`, the existing `emitTelemetry()` helper, the existing `Paths.*` resolver — is already in the workspace post-SP-007).

- [ ] T001 Verify SP-008 runtime prerequisites at `~/Projects/llm-corpus/` — assert SP-001..SP-007 merge commits on main; assert `packages/contracts/src/paths.ts` exports `Paths.telemetry()` (the existing SP-003 getter — SP-008 reuses it; verify no new exports are needed); assert `emitTelemetry()` is exported from `@llm-corpus/contracts`; assert `randomUUID` is importable from `node:crypto`; assert `createHash` is importable from `node:crypto`; assert the SP-007 `runTool()` test-harness helper exists (used by the C-046 E2E harness); assert local Ollama is reachable at `http://127.0.0.1:11434/api/tags` for the C-046 E2E smoke (Ollama-gated like SP-007 FR-INSTALL-024); document an `OLLAMA_RUNNING` env-var gate for `packages/cli/test/engagement-proxy-e2e.test.ts`; assert no new toolchain dependencies are required. *Constitution I, IV, XIV, FR-ENGAGEMENT-014, FR-ENGAGEMENT-020, Assumption "Ollama reachable for E2E only"*

**Checkpoint**: Phase 1 ends here. SP-001..SP-007 merged; `Paths.telemetry()` + `emitTelemetry()` + `runTool()` present; Ollama gating documented for C-046 E2E.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: PREREQ-001..PREREQ-005 from plan.md "PREREQ landings". RED-phase tests authored first; contracts implementations turn them green. The four contracts landings (`engagement.ts`, `telemetry.ts` extension, `errors.ts` extension, `index.ts` re-exports) are the first build step — without them, `packages/cli/src/accept-command.ts` and `packages/cli/src/engagement-proxy-command.ts` cannot compile. ESLint scope extension over the new SP-008 source paths lands here so Phase 3+ source is lint-covered from first commit.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — Phase 3+ source compiles against the Zod schemas, typed errors, telemetry classes shipped here.

### Tests-First (RED phase, Constitution V/IX/XIII)

- [ ] T002 [P] Author RED unit test `tests/unit/sp008-engagement-schemas.test.ts` — Zod round-trip for all seven new SP-008 schemas in `packages/contracts/src/engagement.ts`: `EngagementCorpusFindInvokedEventZodSchema` (8 fields per data-model.md Entity 1; query ≤ 1024 chars + `query_truncated: true` + `query_hash` SHA-256 hex; tier_used closed enum matching SP-006 `SEARCH_TIER_VALUES`; result_count ≥ 0; duration_ms ≥ 0), `EngagementAcceptanceEventZodSchema` (Entity 2; UUID v4 request_id; optional acceptance_note ≤ 512 chars), `EngagementReportGeneratedEventZodSchema` (Entity 3; verdict enum 'PASS'|'FAIL'; queries/acceptance counts ≥ 0; kill_signal boolean), `EngagementReportTelemetryParseFailedEventZodSchema` (Entity 4; telemetry_log_path; line_number? ≥ 1; error_message ≤ 1024 chars), `EngagementProxyReportZodSchema` (Entity 5; `schema_version: z.literal(1)`; all informational aggregates; c028_threshold + kill_signal_threshold literal constants per FR-ENGAGEMENT-005), `AcceptArgsZodSchema` (Entity 6; UUID v4 regex; optional --note ≤ 512 chars trimmed), `EngagementProxyReportArgsZodSchema` (Entity 7; ISO-8601 since/until with `now-7d` and `now` defaults; format ∈ {'text','json'}; timeout_ms ∈ [1, 600000]; `since <= until` refine). Asserts the discriminated union remains exhaustive. *PREREQ-001, FR-ENGAGEMENT-004, FR-ENGAGEMENT-012, FR-ENGAGEMENT-018, SC-008-002, SC-008-019, SC-008-030, Constitution V*

- [ ] T003 [P] Author RED unit test `tests/unit/sp008-engagement-telemetry-union.test.ts` — assert all four new `engagement.*` event variants appear in the `TelemetryEvent` discriminated union exported from `packages/contracts/src/telemetry.ts`; assert the union remains exhaustive at TypeScript compile time (`assertNever(event)` switch covering every variant); assert existing SP-001..SP-007 variants (`search.query`, `install.*`, `uninstall.*`, `taxonomy.*`, `pipeline.*`, `ingest.*`) still Zod-parse unchanged; assert `SearchQueryEvent` gains an optional `request_id?: string` field (Decision A — backward-compatible additive); assert `grep -c "engagement\\." packages/contracts/src/telemetry.ts` returns ≥ 4 (the four event classes); assert each event variant ≤ 4096 bytes serialized (Constitution IX). *PREREQ-002, FR-ENGAGEMENT-004, SC-008-003, SC-008-005, Constitution V, IX, XIII*

- [ ] T004 [P] Author RED unit test `tests/unit/sp008-errors.test.ts` — assert the 5 new typed errors (`EngagementProxyTelemetryParseError`, `EngagementProxyWindowInvalidError`, `AcceptUnknownRequestIdError`, `AcceptZeroResultQueryError`, `AcceptDuplicateRequestIdError`) instantiate with structured `data`, throwable, distinct `name` constants matching data-model.md "Schema migration delta — errors.ts" verbatim; assert `AcceptDuplicateRequestIdError` is INFORMATIONAL (the CLI catches it and exits 0 per FR-ENGAGEMENT-002 + Constitution X idempotency); assert zero `process.exit` references in `packages/cli/src/engagement/*.ts` source (validated by separate lint in Phase 7). *PREREQ-003, FR-ENGAGEMENT-017, SC-008-032, Constitution X, XI*

- [ ] T005 [P] Author RED unit test `tests/unit/sp008-engagement-find-instrumentation.test.ts` — at the `corpus-find-tool` handler boundary, every successful `corpus.find` invocation emits an `engagement.corpus_find_invoked` event in ADDITION to the existing `search.query` event; both events share the same `request_id` (the new Decision A field generated server-side at handler entry via `randomUUID()`); `result_count`, `tier_used`, `duration_ms` populate correctly; `query_hash` is computed over the FULL untruncated text; `query_truncated: true` only when query.length > 1024; the existing `search.query` event now carries the optional `request_id?` field matching the new emit; ZERO mutation of `SearchOutputZodSchema` shape (verified by `git diff main -- packages/contracts/src/search-schemas.ts` returning no new exports per Decision A). *PREREQ-004, FR-ENGAGEMENT-001, SC-008-001, SC-008-002, SC-008-004, SC-008-006, Constitution V, XIII*

### Implementation (GREEN phase)

- [ ] T006 [P] Implement `packages/contracts/src/engagement.ts` — exports all 7 new Zod schemas listed in data-model.md "Schema migration delta": `EngagementCorpusFindInvokedEventZodSchema` (Entity 1), `EngagementAcceptanceEventZodSchema` (Entity 2), `EngagementReportGeneratedEventZodSchema` (Entity 3), `EngagementReportTelemetryParseFailedEventZodSchema` (Entity 4), `EngagementProxyReportZodSchema` (Entity 5), `AcceptArgsZodSchema` (Entity 6), `EngagementProxyReportArgsZodSchema` (Entity 7). All strict-mode; closed enums; `schema_version: z.literal(1)` on `EngagementProxyReportZodSchema`; XOR/refine for `since <= until`; UUID v4 regex per data-model.md Entity 6 verbatim. Pattern matches SP-007's `install-schemas.ts` for symmetry. *PREREQ-001, FR-ENGAGEMENT-004, FR-ENGAGEMENT-012, SC-008-019, Constitution V*

- [ ] T007 [P] Extend `packages/contracts/src/telemetry.ts` — additively add the 4 new SP-008 event-class variants to the `TelemetryEvent` discriminated union: `EngagementCorpusFindInvokedEvent`, `EngagementAcceptanceEvent`, `EngagementReportGeneratedEvent`, `EngagementReportTelemetryParseFailedEvent`. Additionally extend the existing `SearchQueryEvent` schema with an optional `request_id?: string` field (Decision A — backward-compatible; existing SP-005-era emissions without the field still validate). Each variant ≤ 4096 bytes serialized (Constitution IX); each carries `event`, `timestamp` (ISO-8601) envelope. Pre-existing SP-001..SP-007 variants compile unchanged. *PREREQ-002, FR-ENGAGEMENT-004, SC-008-003, SC-008-005, Constitution I, V, IX, XIII*

- [ ] T008 [P] Extend `packages/contracts/src/errors.ts` — additively add 5 typed errors per data-model.md "errors.ts" + plan.md "Project Type": `EngagementProxyTelemetryParseError` (line_number + error_message + telemetry_log_path), `EngagementProxyWindowInvalidError` (since + until + reason), `AcceptUnknownRequestIdError` (request_id + telemetry_log_path), `AcceptZeroResultQueryError` (request_id), `AcceptDuplicateRequestIdError` (request_id + prior_acceptance_timestamp — INFORMATIONAL, not a failure). Each has stable `name`, structured `data`, zero `process.exit` calls. Re-export from `index.ts` (T009). *PREREQ-003, FR-ENGAGEMENT-017, SC-008-032, Constitution XI*

- [ ] T009 Extend `packages/contracts/src/index.ts` — re-export the 7 new engagement schemas from `engagement.ts` + the 5 new typed errors from `errors.ts` so `packages/cli/` imports from `@llm-corpus/contracts` resolve. Pre-existing re-exports unchanged. *PREREQ-001, PREREQ-003*

- [ ] T010 Extend `packages/cli/src/index.ts` subcommand dispatcher — add two new verbs (`accept`, `engagement-proxy`) alongside the existing 9 (`init`, `uninstall`, `taxonomy`, `mcp`, `daemon`, `drain`, `reenrich`, `reindex`, `failures`). The `accept` verb dispatches to `accept-command.ts`; `engagement-proxy` parses the second positional arg (`report` v1) and dispatches to `engagement-proxy-command.ts` for `engagement-proxy report`. Built-in arg parsing (no `commander`/`yargs`/`meow`). `--help` text covers all 11 verbs. Stubs emit "not yet implemented" + exit 64 until Phase 4/5 Engineer lands the command modules — preserves Phase 2 build greenness. *FR-ENGAGEMENT-002, FR-ENGAGEMENT-003, Constitution III, XI*

- [ ] T011 [P] Update `eslint.config.js` — extend the `files:` globs of the existing custom rules (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-promise-race-settimeout`, `no-forbidden-network-imports`, `no-writes-from-resource-handlers`) to scope over the new SP-008 source paths: `packages/cli/src/accept-command.ts`, `packages/cli/src/engagement-proxy-command.ts`, every file under `packages/cli/src/engagement/`, `packages/cli/test/ur-*.test.ts`, `packages/cli/test/empty-corpus-adversary.test.ts`, `packages/cli/test/session-start-idempotency-adversary.test.ts`, `packages/cli/test/engagement-proxy-e2e.test.ts`. The `no-process-exit-in-libs` rule excludes the two CLI command files (allowed to `process.exit` per Constitution XI). The `no-forbidden-network-imports` rule has NO new exceptions (SP-008 introduces zero outbound endpoints per FR-ENGAGEMENT-015). *PREREQ-005, FR-ENGAGEMENT-015, FR-ENGAGEMENT-017, SC-008-028, SC-008-031, SC-008-032, Constitution I, VII, XI, XII, XIV*

- [ ] T012 [P] Add fixture inputs to `tests/fixtures/sp008-engagement/` — `telemetry-fixture-pass.jsonl` (synthetic 5 `engagement.corpus_find_invoked` + 1 matching `engagement.acceptance_event` — matches PASS verdict per FR-ENGAGEMENT-005); `telemetry-fixture-fail-low-queries.jsonl` (2 queries + 0 acceptances — KILL signal); `telemetry-fixture-fail-no-accept.jsonl` (5 queries + 0 acceptances — FAIL non-KILL); `telemetry-fixture-fail-mid-queries.jsonl` (3 queries + 0 acceptances — FAIL non-KILL, ≥ 3 floor cleared but < 5 gate); `telemetry-fixture-corrupt.jsonl` (3 valid lines + 2 malformed JSON lines); `telemetry-fixture-rotated/` (active log + 1 rotated whose mtime falls in the window — SP-003 rotation convention); `ur-001-fixture-docs/` (3 fixture documents: PDF, Markdown, plain-text); `README.md` documenting fixture provenance + expected verdicts for each fixture. *plan.md Project Structure tests/fixtures/sp008-engagement/*

- [ ] T013 [P] Author RED unit test `tests/unit/sp008-engagement-discriminated-union-exhaustiveness.test.ts` — TypeScript-level assertion that the `TelemetryEvent` discriminated union remains exhaustive after the 4 SP-008 additions; a `switch(event.event)` with `default: assertNever(event)` compiles cleanly with NO missing-case errors; the existing SP-005 `search.query` event still parses against the updated schema (with the new optional `request_id?` field absent — backward-compat). *PREREQ-002, FR-ENGAGEMENT-004, SC-008-003, Constitution V*

**Checkpoint**: `npm run build` succeeds; `npm run test:unit` passes for Phase 2 PREREQ tests; `npm run lint` exits 0 with the extended `files:` globs; SP-008 contract surface exists in `@llm-corpus/contracts`; fixture inputs committed; forward-compat plumbing ready; user-story implementation can begin.

---

## Phase 3: User Story 1 — UR-001 + `corpus.find` Engagement Instrumentation (Priority: P1) 🎯 MVP

**Goal**: Every `corpus.find` invocation emits an `engagement.corpus_find_invoked` event with a server-side `request_id: randomUUID()` (Decision A) immediately after the existing `search.query` event; both events share the same `request_id`; query truncation per Constitution IX (≤ 1024 chars + `query_truncated: true` + `query_hash`); zero mutation of `SearchOutputZodSchema` shape; UR-001 ("dropped document becomes queryable on next matching query without further action") integration tests pass against the production binary.

**Independent Test**: With `CORPUS_HOME=<tempdir>` against a clean HOME on pai-node01 with Ollama running, drop a fixture document into `Paths.inbox()`, wait for `edges-build.completed` telemetry, invoke `corpus.find` via real MCP-stdio with a matching query string, assert ≥ 1 SearchHit AND assert an `engagement.corpus_find_invoked` event with a fresh UUID v4 `request_id` appears in `Paths.telemetry()` carrying `result_count ≥ 1`, valid `tier_used`, `duration_ms ≥ 0`, and `query_hash` matching SHA-256 of the query.

### Tests-First (RED — Constitution V/XIII)

- [ ] T014 [P] [US1] Author RED unit test `tests/unit/sp008-engagement-find-emit.test.ts` — directly test the wrapped find-handler in `packages/transport/src/corpus-find-tool.ts`: assert one `randomUUID()` call per invocation; assert the `request_id` is threaded into BOTH the existing `search.query` event (the new optional `request_id?` field is populated) AND the new `engagement.corpus_find_invoked` event (mandatory `request_id`); assert the emit order is `search.query` FIRST, `engagement.corpus_find_invoked` SECOND (Decision A — additive after the existing emit); assert `result_count`, `tier_used`, `duration_ms` populate from the SP-005 SearchOutput correctly; assert ZERO `request_id` field added to the MCP `tools/call` response (the SearchOutput contract is unchanged per Decision A); assert `process.stderr.write` echo of `request_id` ONLY when `process.stderr.isTTY === true` AND no `MCP_TRANSPORT=stdio` env var. *FR-ENGAGEMENT-001, SC-008-001, SC-008-002, Decision A, Constitution V, XIII*

- [ ] T015 [P] [US1] Author RED integration test `packages/cli/test/ur-001-acceptance.test.ts` — UR-001 happy-path + proposed-term + validation-failure scenarios per FR-ENGAGEMENT-007. (i) **Happy path**: drop fixture markdown doc → wait for `edges-build.completed` → invoke `corpus.find` via real MCP-stdio → assert ≥ 1 SearchHit referencing the dropped doc AND ≥ 1 `engagement.corpus_find_invoked` event in `Paths.telemetry()`. (ii) **Proposed-term routing**: drop doc whose classifier output produces a proposed-state taxonomy term → assert the term lands in `taxonomy_terms` with `state='proposed'` per SP-004 + SP-007 surfaces. (iii) **Validation failure → Paths.failed()**: drop intentionally malformed doc → assert it lands at `Paths.failed()` with the SP-006 sidecar contract AND ZERO leak to `Paths.docs()`. Each scenario tied to a named Gherkin block in `specs/008-user-acceptance/execution-journal.md` (authored in Phase 8 T058). *FR-ENGAGEMENT-007, SC-008-022, Constitution VI, XIII*

### Implementation (GREEN)

- [ ] T016 [US1] Implement the find-handler wrapper in `packages/transport/src/corpus-find-tool.ts` — additively wrap the existing handler to (a) generate `request_id: randomUUID()` at handler entry per Decision A; (b) thread the `request_id` into the existing `search.query` event emit (new optional `request_id?` field); (c) emit a new `engagement.corpus_find_invoked` event via `emitTelemetry()` AFTER the existing `search.query` emit; (d) compute `query_hash` over the FULL untruncated query via `createHash('sha256').update(query).digest('hex')`; (e) truncate `query` to 1024 chars + set `query_truncated: true` when length > 1024; (f) capture `result_count`, `tier_used`, `duration_ms` from the SearchOutput + wall-clock timing; (g) optionally echo `request_id` to stderr when CLI-mediated per Decision A (heuristic: `process.stderr.isTTY === true` AND `process.env.MCP_TRANSPORT !== 'stdio'`). ZERO mutation of `SearchOutputZodSchema` shape. *FR-ENGAGEMENT-001, SC-008-001, SC-008-002, SC-008-004, SC-008-006, Decision A, Constitution V, XIII*

- [ ] T017 [US1] Implement `packages/cli/test/ur-001-acceptance.test.ts` body — full integration harness driving the production binary: spawn `node <dist>/bin/corpus.js init --smoke=false` against a `CORPUS_HOME=<tempdir>`; spawn `corpus daemon`; drop fixture docs from `tests/fixtures/sp008-engagement/ur-001-fixture-docs/`; wait for `edges-build.completed` telemetry events (per SP-003 envelope) bounded by a 60-second AbortSignal; invoke `corpus.find` via real MCP-stdio (spawn `corpus mcp` child + JSON-RPC `tools/call`); assert SearchHits per the three scenarios in T015; tear down the daemon + tempdir. Ollama-gated via `it.skipIf(!ollamaReachable)`. *FR-ENGAGEMENT-007, SC-008-022, Constitution VI, VII*

- [ ] T018 [P] [US1] Author RED unit test `tests/unit/sp008-engagement-query-truncation.test.ts` — assert a 2KB query string emits an `engagement.corpus_find_invoked` event with `query.length === 1024` AND `query_truncated: true` AND `query_hash` matching SHA-256 of the FULL 2KB input (NOT the truncation); assert a 100-byte query emits with `query` equal to the input, `query_truncated` absent (or false), `query_hash` matching SHA-256 of the input; assert the total event payload remains ≤ 4096 bytes for both cases (Constitution IX). *FR-ENGAGEMENT-001, SC-008-004, SC-008-005, Constitution IX*

- [ ] T019 [US1] Implement query-truncation logic in the find-handler wrapper (T016) — extract the truncation + hash computation into a small inline helper or directly in the handler; ensure it's exercised by T018; assert `query_hash` is always present even when `query` is short (per data-model.md Entity 1 invariant "query_hash always present"). *FR-ENGAGEMENT-001, SC-008-004, Constitution IX*

- [ ] T020 [P] [US1] Author RED unit test `tests/unit/sp008-engagement-find-zero-result.test.ts` — assert a `corpus.find` invocation returning `result_count: 0` (empty corpus, no matching docs) STILL emits an `engagement.corpus_find_invoked` event with `result_count: 0` AND valid `tier_used` AND `duration_ms ≥ 0`; verifies the FR-ENGAGEMENT-010 empty-corpus adversary path emits telemetry correctly (a zero-result query is counted as a query by the aggregator, but cannot be the target of `corpus accept` per FR-ENGAGEMENT-002). *FR-ENGAGEMENT-001, SC-008-006, Constitution XIII*

- [ ] T021 [US1] Verify `packages/transport/src/corpus-find-tool.ts` wrapper handles ALL three transport paths (real MCP-stdio, library-handler-direct, CLI-mediated) per FR-ENGAGEMENT-001 — add a transport-discrimination assertion or comment block clarifying that the wrapper is at the handler boundary (the deepest common point); tests T014 + T015 + T017 + T020 exercise the wrapper from at least two transports. ZERO new outbound endpoints per FR-ENGAGEMENT-015 (verified by lint scope from T011). *FR-ENGAGEMENT-001, SC-008-001, Constitution III, XIII*

**Checkpoint**: User Story 1 (UR-001) is fully functional and independently testable. The engagement instrumentation is in place. Zero mutation of SearchOutput contract. Phase 4 (`corpus accept`) and Phase 5 (`corpus engagement-proxy report`) can begin in parallel — they read from the telemetry log this phase populated.

---

## Phase 4: User Story 2 — UR-002 + `corpus accept` CLI (Priority: P1)

**Goal**: `corpus accept <request-id> [--note <text>]` subcommand records an `engagement.acceptance_event` keyed by `request_id`; rejects unknown request_ids and zero-result queries with clear non-zero exits; idempotent on duplicates (prints "already accepted" + exit 0; ZERO duplicate events); writes through the existing `emitTelemetry()` atomic-append path; UR-002 ("agent invokes corpus.find AND grounds answer with traceable references") integration tests pass against the production MCP server with the SP-002 FR-009 retrieval-prompt template loaded.

**Independent Test**: With `CORPUS_HOME=<tempdir>` carrying a telemetry log seeded with one `engagement.corpus_find_invoked` event (result_count ≥ 1), spawn `node <dist>/bin/corpus.js accept <captured-request-id> --note "result was useful"`; assert exit 0; assert an `engagement.acceptance_event` with matching `request_id` appears in `Paths.telemetry()`; assert a second invocation prints "already accepted: <id> at <ts>" + exits 0; assert `corpus accept 00000000-0000-4000-8000-000000000000` exits non-zero with stderr naming the unknown request_id.

### Tests-First (RED — Constitution V/X/XIII)

- [ ] T022 [P] [US2] Author RED unit test `tests/unit/sp008-engagement-accept-args.test.ts` — Zod parsing of `<request-id>` positional + `--note <text>` flag against `AcceptArgsZodSchema`: UUID v4 regex validation; note trimmed of leading/trailing whitespace; oversize note (> 512 chars) rejected at the Zod boundary with clear error; missing positional rejected; non-UUID positional rejected; multiple `--note` flags handled (last wins or rejected — spec the behavior). Per FR-ENGAGEMENT-002 + Constitution V. *FR-ENGAGEMENT-002, SC-008-011, SC-008-012, Constitution V*

- [ ] T023 [P] [US2] Author RED unit test `tests/unit/sp008-engagement-accept-writer.test.ts` — for `packages/cli/src/engagement/acceptance-event-writer.ts`: (i) finds the matching `engagement.corpus_find_invoked` event in `Paths.telemetry()` by `request_id`; (ii) rejects unknown `request_id` by throwing `AcceptUnknownRequestIdError`; (iii) rejects zero-result query (`result_count === 0`) by throwing `AcceptZeroResultQueryError`; (iv) idempotent on duplicate — when a prior `engagement.acceptance_event` with the same `request_id` exists, throws `AcceptDuplicateRequestIdError` (INFORMATIONAL); (v) appends well-formed `engagement.acceptance_event` to `Paths.telemetry()` via `emitTelemetry()` with `event`, `timestamp`, `request_id`, `acceptance_note?`; (vi) accepts AbortSignal and aborts mid-scan on SIGINT. *FR-ENGAGEMENT-002, SC-008-007, SC-008-008, SC-008-009, SC-008-010, Constitution V, VII, X, XIII*

- [ ] T024 [P] [US2] Author RED integration test `packages/cli/test/ur-002-acceptance.test.ts` — UR-002 grounded-answer + no-fabrication + cross-document scenarios per FR-ENGAGEMENT-008. (i) **Agent grounds answer with traceable references**: simulate the agent flow against the production MCP server with the SP-002 FR-009 retrieval-prompt template loaded; invoke `corpus.find` via real MCP-stdio; assert ≥ 1 SearchHit whose URI dereferences to a `corpus://docs/{id}` resource that resolves successfully. (ii) **No fabrication on empty corpus**: with a fresh corpus, invoke `corpus.find`; assert the response carries `hits: []` AND no `corpus://docs/*` URIs anywhere. (iii) **Cross-document grounding**: with N=3 docs ingested, invoke a query that should hit all 3; assert ≥ 2 SearchHits spanning multiple `corpus://docs/{id}` URIs. The test simulates the agent flow at the MCP-response level (per R8 risk-register entry — does NOT spawn a real Claude Code session). *FR-ENGAGEMENT-008, SC-008-023, Constitution VI*

### Implementation (GREEN)

- [ ] T025 [P] [US2] Implement `packages/cli/src/engagement/accept-args-parser.ts` — reads `process.argv` for `corpus accept <request-id> [--note <text>]`, applies `AcceptArgsZodSchema`, throws on validation failure; returns parsed `AcceptArgs` per data-model.md Entity 6. ZERO `process.exit` (library — Constitution XI). *FR-ENGAGEMENT-002, FR-ENGAGEMENT-018, SC-008-011, SC-008-012, Constitution V, XI*

- [ ] T026 [P] [US2] Implement `packages/cli/src/engagement/acceptance-event-writer.ts` — accepts parsed `AcceptArgs` + AbortSignal + telemetry-log path; (a) line-by-line scans `Paths.telemetry()` for matching `engagement.corpus_find_invoked` event by `request_id`; (b) throws `AcceptUnknownRequestIdError` if absent; (c) throws `AcceptZeroResultQueryError` if `result_count === 0`; (d) scans for prior `engagement.acceptance_event` with same `request_id`; if present throws `AcceptDuplicateRequestIdError` carrying `prior_acceptance_timestamp` (INFORMATIONAL — caller handles as idempotent no-op); (e) emits new `engagement.acceptance_event` via `emitTelemetry()` (SP-003 atomic-append, ≤ 4 KB per line). Accepts AbortSignal; aborts mid-scan on SIGINT. ZERO `process.exit` (Constitution XI). *FR-ENGAGEMENT-002, SC-008-007, SC-008-008, SC-008-009, SC-008-010, Constitution V, VII, IX, X, XIII*

- [ ] T027 [US2] Implement `packages/cli/src/accept-command.ts` — CLI entry point dispatched from `index.ts` (T010); the ONLY layer permitted to `process.exit` for the accept flow per Constitution XI + FR-ENGAGEMENT-017. (a) Parses argv via `accept-args-parser.ts` (T025); on Zod failure: stderr message + exit 2. (b) Calls `acceptance-event-writer.ts` (T026) with `AbortController` for SIGINT. (c) On `AcceptUnknownRequestIdError`: stderr "unknown request_id: <id>" + exit 1. (d) On `AcceptZeroResultQueryError`: stderr "cannot accept zero-result query: <id>" + exit 1. (e) On `AcceptDuplicateRequestIdError` (INFORMATIONAL): stdout "already accepted: <id> at <ts>" + exit 0. (f) On success: stdout "accepted: <id>" + exit 0. Telemetry emitted on every error path per Constitution XIII. *FR-ENGAGEMENT-002, FR-ENGAGEMENT-017, FR-ENGAGEMENT-019, SC-008-007 through SC-008-012, SC-008-032, Constitution XI, XIII*

- [ ] T028 [US2] Implement `packages/cli/test/ur-002-acceptance.test.ts` body — full integration harness driving the production MCP server: spawn `node <dist>/bin/corpus.js init --smoke=false`; spawn `corpus daemon`; drop fixture docs; wait for ingestion; spawn `corpus mcp` child; issue real `tools/call` JSON-RPC for `corpus.find` per the three scenarios in T024; assert SearchHits and grounding correctness; tear down. Ollama-gated. *FR-ENGAGEMENT-008, SC-008-023, Constitution VI, VII*

- [ ] T029 [P] [US2] Author RED unit test `tests/unit/sp008-engagement-accept-idempotent.test.ts` — explicit idempotency test per FR-ENGAGEMENT-002 + Constitution X: seed a tempdir telemetry log with a valid `engagement.corpus_find_invoked` + `engagement.acceptance_event` pair; invoke the acceptance-event-writer with the same `request_id`; assert `AcceptDuplicateRequestIdError` is thrown carrying the prior timestamp; assert ZERO new `engagement.acceptance_event` is written to the log (verify line count unchanged after the invocation); verify the CLI catches the error + prints "already accepted: <id> at <ts>" + exits 0. *FR-ENGAGEMENT-002, SC-008-010, Constitution X*

- [ ] T030 [P] [US2] Author RED unit test `tests/unit/sp008-engagement-accept-note-truncation.test.ts` — `corpus accept <request-id> --note "<exactly 512 chars>"` records the note in the event's `acceptance_note` field; `corpus accept <request-id> --note "<513 chars>"` is rejected at the Zod boundary with non-zero exit + stderr naming the length-limit violation; per Constitution V + Constitution IX. *FR-ENGAGEMENT-002, SC-008-011, SC-008-012, Constitution V, IX*

**Checkpoint**: User Story 2 (UR-002) is fully functional and independently testable. `corpus accept` correctly records, rejects, and idempotents. The telemetry log now carries BOTH event classes that the report aggregator (Phase 5) reads. Phase 5 can begin.

---

## Phase 5: User Story 3 — UR-003 + `corpus engagement-proxy report` CLI + C-046 E2E Smoke (Priority: P1)

**Goal**: `corpus engagement-proxy report [--since=<ISO8601>] [--until=<ISO8601>] [--format=text|json] [--telemetry-log=<path>] [--timeout=<ms>]` subcommand aggregates engagement telemetry over the window; computes the C-028 verdict (PASS iff `queries_in_window >= 5 AND acceptance_events_in_window >= 1`); kill_signal iff `queries_in_window < 3`; supports text + JSON output; emits `engagement.report_generated` audit event; UR-003 ("install once, available across new agent sessions via auto-loaded resources") integration tests pass; the C-046 end-to-end smoke harness spawns the production binary, runs 5 real MCP-stdio `corpus.find` invocations, runs 1 real `corpus accept`, runs the report, and asserts the verdict matches the synthetic input.

**Independent Test**: With `CORPUS_HOME=<tempdir>` carrying a seeded telemetry log (5 valid `engagement.corpus_find_invoked` + 1 valid `engagement.acceptance_event`), spawn `node <dist>/bin/corpus.js engagement-proxy report --format=json --since=<window-start>`; assert exit 0; assert JSON output Zod-validates against `EngagementProxyReportZodSchema` with `{verdict: "PASS", queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true, schema_version: 1}`; assert an `engagement.report_generated` audit event appears in the telemetry log.

### Tests-First (RED — Constitution V/VII/XIII)

- [ ] T031 [P] [US3] Author RED unit test `tests/unit/sp008-engagement-telemetry-scanner.test.ts` — for `packages/cli/src/engagement/telemetry-log-scanner.ts`: (i) parses well-formed lines via Zod against the `TelemetryEvent` union; (ii) skips malformed lines AND increments `parse_errors_count` AND emits `engagement.report_telemetry_parse_failed` for each; (iii) respects `since/until` filter (UTC-normalized ISO-8601 comparison); (iv) iterates rotated logs whose mtime falls in the window per the SP-003 rotation file-naming convention; (v) accepts AbortSignal and aborts mid-scan on SIGINT; (vi) bounded-by-timeout via `setTimeout + clearTimeout + controller.abort()` (NEVER `Promise.race(setTimeout)` per Constitution VII forbidden pattern); (vii) uses `readline`-on-stream for memory-bounded reading. *FR-ENGAGEMENT-003, SC-008-018, SC-008-020, SC-008-021, SC-008-031, Constitution V, VII, XIII*

- [ ] T032 [P] [US3] Author RED unit test `tests/unit/sp008-engagement-report-aggregator.test.ts` — for `packages/cli/src/engagement/report-aggregator.ts`: given a synthetic event stream, computes `queries_in_window` (unique `engagement.corpus_find_invoked` by `request_id` — dedup is defense-in-depth), `acceptance_events_in_window` (unique `engagement.acceptance_event` by `request_id`), the informational aggregates per data-model.md Entity 5 (`median_latency_ms`, `p95_latency_ms`, `tier_distribution` summing ≤ queries_in_window, `zero_result_queries`, `distinct_query_hashes`). Deterministic input → deterministic output. Edge case: `queries_in_window === 0` → `*_latency_ms: null`. *FR-ENGAGEMENT-003, SC-008-014, Constitution V*

- [ ] T033 [P] [US3] Author RED unit test `tests/unit/sp008-engagement-report-verdict.test.ts` — for `packages/cli/src/engagement/verdict-computer.ts`: verdict table cases per FR-ENGAGEMENT-005: (i) **PASS** — 5q + 1a → `verdict: 'PASS'`, `c028_threshold_met: true`, `kill_signal: false`; (ii) **FAIL non-KILL** — 5q + 0a → `verdict: 'FAIL'`, `c028_threshold_met: false`, `kill_signal: false`; (iii) **FAIL KILL** — 2q + 0a → `verdict: 'FAIL'`, `c028_threshold_met: false`, `kill_signal: true`; (iv) **FAIL non-KILL** — 3q + 0a → `verdict: 'FAIL'`, `c028_threshold_met: false`, `kill_signal: false` (≥ 3 floor cleared but < 5 gate); (v) **FAIL KILL on empty log** — 0q + 0a → `verdict: 'FAIL'`, `kill_signal: true`. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-005, SC-008-015, SC-008-016, SC-008-017, Constitution V*

- [ ] T034 [P] [US3] Author RED unit test `tests/unit/sp008-engagement-report-json-shape.test.ts` — `--format=json` output Zod-validates against `EngagementProxyReportZodSchema` for all five verdict cases from T033; includes `schema_version: 1`, `c028_threshold: {min_queries: 5, min_acceptance_events: 1}`, `kill_signal_threshold: {min_queries: 3}` literal constants for downstream tooling; `informational.tier_distribution` keys match the SP-006 `SEARCH_TIER_VALUES` enum. *FR-ENGAGEMENT-012, SC-008-019, Constitution V*

- [ ] T035 [P] [US3] Author RED unit test `tests/unit/sp008-engagement-report-cli-args.test.ts` — Zod parsing of `--since/--until/--format/--telemetry-log/--timeout` against `EngagementProxyReportArgsZodSchema`: defaults applied (`since = now-7d`, `until = now`, `format = 'text'`, `telemetry_log = Paths.telemetry()`, `timeout_ms = 30000`); invalid ISO-8601 rejected with `EngagementProxyWindowInvalidError`; `since > until` rejected; future `--until` accepted (no upper bound); `--timeout=0` rejected (≥ 1); `--timeout=700000` rejected (≤ 600000). *FR-ENGAGEMENT-003, SC-008-013, SC-008-018, Constitution V, VII*

- [ ] T036 [P] [US3] Author RED integration test `packages/cli/test/ur-003-acceptance.test.ts` — UR-003 cross-session + no-duplicate + pre-init-error scenarios per FR-ENGAGEMENT-009. (i) **Install once, available across sessions**: install + ingest N=5 → close session → start fresh session → assert `corpus://manifest` returns `doc_count: 5` AND `taxonomy_terms` unchanged. (ii) **New session does NOT duplicate**: (THIS IS THE SAME SCENARIO AS the session-start idempotency adversary FR-ENGAGEMENT-011 — shared harness with `packages/cli/test/session-start-idempotency-adversary.test.ts`). (iii) **Pre-init error**: start a fresh session before `corpus init` → invoke `corpus.find` via MCP-stdio → assert a clear "corpus not initialized" error response (NOT a crash). *FR-ENGAGEMENT-009, SC-008-024, Constitution VI*

### Implementation (GREEN)

- [ ] T037 [P] [US3] Implement `packages/cli/src/engagement/engagement-proxy-report-args-parser.ts` — reads `process.argv` for `corpus engagement-proxy report [...flags]`, applies `EngagementProxyReportArgsZodSchema`, computes defaults (`since = now - 7d`, `until = now`, `format = 'text'`, `telemetry_log = Paths.telemetry()`, `timeout_ms = 30000`), throws `EngagementProxyWindowInvalidError` on malformed ISO-8601 or `since > until`. Returns `EngagementProxyReportArgs` per data-model.md Entity 7. ZERO `process.exit`. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-018, SC-008-013, Constitution V, XI*

- [ ] T038 [P] [US3] Implement `packages/cli/src/engagement/telemetry-log-scanner.ts` — line-by-line read of `Paths.telemetry()` via `readline`-on-stream (memory-bounded); Zod-parses each line against `TelemetryEvent`; filters by `event ∈ {'engagement.corpus_find_invoked', 'engagement.acceptance_event'}` AND `timestamp ∈ [since, until]`; iterates rotated logs whose mtime falls in the window per the SP-003 rotation file-naming convention; emits `engagement.report_telemetry_parse_failed` on each malformed line AND increments `parse_errors_count`; accepts AbortSignal; the per-invocation timeout uses `setTimeout(() => controller.abort('engagement_report_timeout'), timeoutMs) + clearTimeout(handle)` (NEVER `Promise.race(setTimeout)`). Returns a filtered + counted event stream. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-016, SC-008-018, SC-008-020, SC-008-021, SC-008-031, Constitution V, VII, XIII*

- [ ] T039 [P] [US3] Implement `packages/cli/src/engagement/report-aggregator.ts` — given the filtered event stream from T038, computes per data-model.md Entity 5: `queries_in_window` (unique `engagement.corpus_find_invoked` by `request_id`), `acceptance_events_in_window` (unique `engagement.acceptance_event` by `request_id`), `informational.median_latency_ms` + `p95_latency_ms` (null if 0 queries), `informational.tier_distribution` (per SP-006 canonical tier enum), `informational.zero_result_queries`, `informational.distinct_query_hashes`. Pure function (deterministic input → deterministic output). ZERO IO. *FR-ENGAGEMENT-003, SC-008-014, Constitution V*

- [ ] T040 [P] [US3] Implement `packages/cli/src/engagement/verdict-computer.ts` — given aggregated counts from T039, computes `c028_threshold_met: queries_in_window >= 5 AND acceptance_events_in_window >= 1`, `kill_signal: queries_in_window < 3`, `verdict: c028_threshold_met ? 'PASS' : 'FAIL'`. Returns the verdict trio. Pure function. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-005, SC-008-015, SC-008-016, SC-008-017, Constitution V*

- [ ] T041 [P] [US3] Implement `packages/cli/src/engagement/report-renderer-json.ts` — assembles the `EngagementProxyReport` payload from T039 + T040 + the args, INCLUDING `schema_version: 1`, `c028_threshold: {min_queries: 5, min_acceptance_events: 1}`, `kill_signal_threshold: {min_queries: 3}` literal constants; Zod-validates the assembled payload against `EngagementProxyReportZodSchema` BEFORE emitting (defense-in-depth per Constitution V); writes `JSON.stringify(payload, null, 2) + '\n'` to stdout. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-012, SC-008-019, Constitution V*

- [ ] T042 [P] [US3] Implement `packages/cli/src/engagement/report-renderer-text.ts` — human-readable text-format renderer with the Constitution XVI banner per SC-008-034 and FR-ENGAGEMENT-022: the banner names "Maya Week-1 engagement-proxy per C-028" and labels the verdict as a Track B measurement; lists `queries_in_window`, `acceptance_events_in_window`, `c028_threshold_met`, `kill_signal`, `verdict`, the informational aggregates, the parse-error count; on `kill_signal: true` includes the SPRINT-PLAN.yaml-recorded rollback recommendation ("Stage 4 recycle per C-028"). ZERO mutation of state (renderer is pure). *FR-ENGAGEMENT-003, FR-ENGAGEMENT-022, SC-008-016, SC-008-034, Constitution V, XVI*

- [ ] T043 [US3] Implement `packages/cli/src/engagement-proxy-command.ts` — CLI entry point dispatched from `index.ts` (T010); the ONLY layer permitted to `process.exit` for the report flow per Constitution XI + FR-ENGAGEMENT-017. Wires: args-parser (T037) → scanner (T038) → aggregator (T039) → verdict-computer (T040) → renderer (T041 OR T042 per `--format`). After rendering, emits `engagement.report_generated` audit event via `emitTelemetry()` carrying the verdict. Exit codes: 0 on `c028_threshold_met: true`, non-zero (1) otherwise per FR-ENGAGEMENT-003 spec line. Telemetry emitted on every error path per Constitution XIII. SIGINT propagates via `AbortController`; aborts mid-scan exit non-zero with clear-remediation stderr. *FR-ENGAGEMENT-003, FR-ENGAGEMENT-016, FR-ENGAGEMENT-017, FR-ENGAGEMENT-019, SC-008-013 through SC-008-021, SC-008-031, SC-008-032, Constitution VII, XI, XIII*

- [ ] T044 [US3] Implement `packages/cli/test/ur-003-acceptance.test.ts` body — driving the production binary across two sessions: install + ingest N=5 documents; verify `corpus://manifest` resource; tear daemon down; restart daemon (second session-start with identical inbox); re-verify `corpus://manifest` reports unchanged `doc_count: 5` AND `taxonomy_terms` unchanged AND ZERO `ingest.normalized`/`classify.completed`/`embed.completed`/`index.completed`/`edges.completed` events fired in the second session for the 5 files. Pre-init scenario: spawn `corpus mcp` against a HOME with NO `corpus init` run; invoke `corpus.find`; assert a clear unavailable-error response. Shares the session-start idempotency assertion logic with the FR-ENGAGEMENT-011 adversary test in Phase 6 T047. *FR-ENGAGEMENT-009, SC-008-024, Constitution VI*

- [ ] T045 [US3] **Implement C-046 end-to-end smoke harness `packages/cli/test/engagement-proxy-e2e.test.ts`** — per FR-ENGAGEMENT-006 + the SP-006 retrospective F-1 root-cause + the dispatch prompt's C-046 mandate. (a) `CORPUS_HOME=<tempdir>`. (b) `pnpm build` to produce dist binaries. (c) spawn `node <dist>/bin/corpus.js init --smoke` (the SP-007 smoke seeds a deterministic seed doc). (d) spawn `corpus daemon`. (e) spawn 5 separate `corpus mcp`-mediated `corpus.find({query: <fixture-queries>})` calls via real MCP-stdio (NOT library-level handler tests — per Decision C "no library-level handler test is sufficient"). (f) capture `request_id` from each via `tail -f Paths.telemetry()` mid-test. (g) for one of the returned hits, spawn `node <dist>/bin/corpus.js accept <captured-request-id>` against the production binary. (h) spawn `node <dist>/bin/corpus.js engagement-proxy report --format=json --since=<window-start>` and capture stdout. (i) parse the JSON and assert `{verdict: 'PASS', queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true, schema_version: 1}`. (j) tear down. Ollama-gated via `it.skipIf(!ollamaReachable)` (SP-007 FR-INSTALL-024 pattern). Wall-clock budget ≤ 90 s (plan.md performance table). *FR-ENGAGEMENT-006, SC-008-027, Decision C, Constitution VI, VII, XII, XVI*

- [ ] T046 [US3] Verify `corpus engagement-proxy report` reads rotated logs correctly — extend T031's scanner test OR author a focused `tests/unit/sp008-engagement-rotated-logs.test.ts` — synthesize a `tests/fixtures/sp008-engagement/telemetry-fixture-rotated/` layout with an active log + 1 rotated log (mtime in window); assert the scanner enumerates both per the SP-003 rotation file-naming convention; assert events from BOTH count toward the metric. *FR-ENGAGEMENT-003, SC-008-020, Constitution V, XIV*

**Checkpoint**: User Story 3 (UR-003) is fully functional and independently testable. The `corpus engagement-proxy report` CLI computes the C-028 verdict correctly for all five verdict cases. The C-046 E2E smoke harness ties the whole engagement layer together end-to-end. Phase 6 (adversary tests) can begin in parallel with this phase since the adversary tests share harness pieces with UR-003.

---

## Phase 6: Adversary Integration Tests (Empty-Corpus + Session-Start Idempotency)

**Purpose**: The two SP-008-mandated adversary scenarios per spec.md User Story 5 + FR-ENGAGEMENT-010 + FR-ENGAGEMENT-011. Empty-corpus adversary verifies `corpus.find` on zero docs returns empty hits envelope across 5 query shapes. Session-start idempotency verifies dropping the same file twice across daemon restarts keeps the SQL row count unchanged AND fires `ingest.dedup_hit` AND ZERO write events for unchanged inbox. These tests close out SC-008-022, SC-008-023 from the spec.

### Tests (Implementation tasks for the two adversary harnesses)

- [ ] T047 [P] Implement `packages/cli/test/empty-corpus-adversary.test.ts` — per FR-ENGAGEMENT-010 + SC-008-025: spawn `node <dist>/bin/corpus.js init --smoke=false` against `CORPUS_HOME=<tempdir>`; spawn `corpus daemon`; with NO documents ingested, invoke `corpus.find` via real MCP-stdio with 5 distinct query shapes (single-word "foo", multi-word "alpha bravo charlie", special-chars "what's @ #1!", empty-string "", very-long ≥ 2KB); for each invocation assert the MCP response carries `hits: []` AND no `corpus://docs/*` URIs anywhere AND no `citations` field (or `citations: []`); verify each invocation STILL emits an `engagement.corpus_find_invoked` event with `result_count: 0` (per SC-008-006). Ollama-gated. *FR-ENGAGEMENT-010, SC-008-025, Constitution VI, XIII*

- [ ] T048 [P] Implement `packages/cli/test/session-start-idempotency-adversary.test.ts` — per FR-ENGAGEMENT-011 + SC-008-026: spawn `node <dist>/bin/corpus.js init --smoke=false`; drop N=5 documents into `Paths.inbox()`; wait for all 5 to fire `edges-build.completed` events; record `count(*) from documents == 5` via direct SQLite read on `Paths.indexDb()`; kill the daemon; restart daemon (second session-start with identical inbox); wait 30 seconds for any spurious processing; re-record SQL count; assert (i) count unchanged at 5, (ii) every inbox file fired an `ingest.dedup_hit` event (per SP-003 FR-017 content-hash idempotency), (iii) ZERO `ingest.normalized`/`classify.completed`/`embed.completed`/`index.completed`/`edges.completed` events fired in the second session for those 5 files. Shares assertion helpers with UR-003 (T044). *FR-ENGAGEMENT-011, SC-008-026, Constitution X*

- [ ] T049 [P] Author RED Gherkin scenario blocks in `specs/008-user-acceptance/execution-journal.md` for both adversary tests AND for UR-001/UR-002/UR-003 (per FR-ENGAGEMENT-007 + FR-ENGAGEMENT-008 + FR-ENGAGEMENT-009 + FR-ENGAGEMENT-010 + FR-ENGAGEMENT-011) — Gherkin Given/When/Then blocks tied to the named integration test files; this file is the spec-stage exit-criterion artifact "every scope requirement has at least one passing Gherkin scenario in execution journal". The file is created in Phase 8 T058 with full content; this RED scaffold lands the structure. *FR-ENGAGEMENT-007 through FR-ENGAGEMENT-011, SC-008-022 through SC-008-026, Constitution VI*

- [ ] T050 Verify all 6 SP-008 integration / E2E test files (`ur-001-acceptance.test.ts`, `ur-002-acceptance.test.ts`, `ur-003-acceptance.test.ts`, `empty-corpus-adversary.test.ts`, `session-start-idempotency-adversary.test.ts`, `engagement-proxy-e2e.test.ts`) under `packages/cli/test/` are discovered by the existing vitest config (no new `tsconfig.json` paths needed); assert `pnpm test:integration` runs all 6 (Ollama-gated where applicable) and reports pass for each. *FR-ENGAGEMENT-006 through FR-ENGAGEMENT-011, SC-008-022 through SC-008-027*

**Checkpoint**: All Track A tests green on a dev machine with Ollama running. Phase 7 (lint + Constitution enforcement) can begin.

---

## Phase 7: Lint + Constitution Enforcement

**Purpose**: Final lint scope verification + Constitution check 16/16. Phase 2 T011 extended the lint scope; this phase verifies the scope is correctly applied and adds any final source-walk assertions needed for SC-008-028..SC-008-034 (Constitution I/III/V/VII/XI/XIII/XIV/XVI compliance).

- [ ] T051 [P] Verify `eslint.config.js` scope over all SP-008 source — run `pnpm lint -- packages/cli/src/accept-command.ts packages/cli/src/engagement-proxy-command.ts packages/cli/src/engagement/ packages/cli/test/ur-*.test.ts packages/cli/test/empty-corpus-adversary.test.ts packages/cli/test/session-start-idempotency-adversary.test.ts packages/cli/test/engagement-proxy-e2e.test.ts packages/contracts/src/engagement.ts`; assert exit 0; assert ALL six custom rules (`no-process-exit-in-libs`, `paths-from-resolver-only`, `no-shell-string-exec`, `no-promise-race-settimeout`, `no-forbidden-network-imports`, `no-writes-from-resource-handlers`) cover the SP-008 source set. *SC-008-028, SC-008-029, SC-008-030, SC-008-031, SC-008-032, Constitution I, III, V, VII, XI, XII, XIV*

- [ ] T052 [P] Source-walk SC-008-028..SC-008-033 verification — author a script-or-grep checklist verifying: (a) Constitution I — ZERO `import 'node:net'|'node:tls'|'node:https'|'node:dgram'|'node:dns'|'undici'` in SP-008 source per FR-ENGAGEMENT-015; (b) Constitution III — ZERO new MCP tool/resource registrations under `packages/transport/src/` for SP-008 per FR-ENGAGEMENT-013 (only the additive emit in `corpus-find-tool.ts`); (c) Constitution V — every `engagement.*` event Zod-parsed at read AND write boundaries; (d) Constitution VII — ZERO `Promise.race([...setTimeout])` in SP-008 source (verify via grep + lint); (e) Constitution XI — `process.exit` ONLY in `accept-command.ts` + `engagement-proxy-command.ts`; (f) Constitution XIII — every catch block in SP-008 source emits an `engagement.*` event before returning or re-throwing. *SC-008-028 through SC-008-033, Constitution I, III, V, VII, XI, XIII*

- [ ] T053 [P] Verify SC-008-031 + FR-ENGAGEMENT-020 — assert `git diff main -- packages/contracts/src/paths.ts` returns NO new exports (no new `Paths.*` getter added in SP-008); assert SP-008 source reads from + writes to `Paths.telemetry()` exclusively (the existing SP-003 getter). *FR-ENGAGEMENT-020, SC-008-031, Constitution XIV*

- [ ] T054 Verify SC-008-034 — Constitution XVI Track A/B banner — `corpus engagement-proxy report --format=text` against a fixture log includes the explicit banner naming "Maya Week-1 engagement-proxy per C-028" AND labels the verdict as a Track B measurement; verify the banner text via direct test assertion (extend or add to `tests/unit/sp008-engagement-report-text-banner.test.ts`); verify the spec.md + plan.md + tasks.md (this file) + RETROSPECTIVE.md + PR description all surface the split. *FR-ENGAGEMENT-022, FR-ENGAGEMENT-023, SC-008-034, Constitution XVI*

**Checkpoint**: 16/16 Constitution principles verified by lint + source-walk. SP-008 source set is fully scoped by the custom-rule lint. Ready for polish + commit.

---

## Phase 8: Polish + Commit + Retro

**Purpose**: Final `npm run build/lint/test` pass, quickstart authoring, execution journal completion, README + SESSION_STATE + CLAUDE.md updates, retrospective skeleton, ledger entries, single commit + PR open + squash-merge. Track A merges here; Track B (operator dogfood + verdict) happens out-of-band per FR-ENGAGEMENT-022.

- [ ] T055 [P] Run final `pnpm build` — assert clean build with NO TypeScript errors; assert dist binaries at `packages/cli/dist/bin/corpus.js`; assert the `engagement` + `accept` subcommand stubs replaced with real dispatches in `packages/cli/dist/src/index.js`. *plan.md "Sizing call"*

- [ ] T056 [P] Run final `pnpm lint` — assert exit 0 across all SP-008 source files + extended scope. *SC-008-028..SC-008-032*

- [ ] T057 [P] Run final `pnpm test` — assert ALL unit + integration + E2E tests pass on the dev machine with Ollama. Capture any Ollama-skipped tests in the run output for the retro. *SC-008-001 through SC-008-027*

- [ ] T058 [P] Author `specs/008-user-acceptance/quickstart.md` — operator walkthrough per the SP-008 dispatch prompt + spec.md + plan.md: (a) 7-day dogfood instructions (install via the SP-007 `corpus init` flow; use the substrate naturally; let Claude Code invoke `corpus.find` against your real questions); (b) capturing `request_id` via `tail -f $(corpus paths telemetry) | jq 'select(.event == "engagement.corpus_find_invoked")'`; (c) accepting useful results via `corpus accept <request-id> --note "<rationale>"`; (d) running the report at end-of-window via `corpus engagement-proxy report --since=<dogfood-start>`; (e) interpreting PASS / FAIL non-KILL / FAIL KILL verdicts including the rollback recommendation per FR-ENGAGEMENT-005; (f) Track A/B split note per Constitution XVI; (g) operator-friction acknowledgement per R3 risk-register. Pattern matches SP-007's quickstart.md. *plan.md "Documentation", FR-ENGAGEMENT-022, FR-ENGAGEMENT-023*

- [ ] T059 [P] Author `specs/008-user-acceptance/execution-journal.md` — full Gherkin scenario blocks for UR-001 / UR-002 / UR-003 (3 scenarios each per FR-ENGAGEMENT-007..009) + empty-corpus adversary (5 query shapes per FR-ENGAGEMENT-010) + session-start idempotency adversary (per FR-ENGAGEMENT-011) + C-046 E2E smoke (per FR-ENGAGEMENT-006); each Gherkin block names the passing integration test file path; the journal is the spec-stage exit-criterion artifact "every scope requirement has at least one passing Gherkin scenario in execution journal" per SPRINT-PLAN.yaml SP-008 verbatim. *FR-ENGAGEMENT-007 through FR-ENGAGEMENT-011, SC-008-022 through SC-008-027*

- [ ] T060 [P] Update `docs/SESSION_STATE.md` — append SP-008 SHIP section: completed items (every FR-ENGAGEMENT + every SC-008 task ID closes); carried-forward items (C-043 + C-044 still DEFERRED per FR-ENGAGEMENT-024 + SC-008-036; reference SP-007 deferral entries verbatim); the Track A/B split status (Track A merged; Track B awaiting 7-day dogfood verdict). *FR-ENGAGEMENT-024, SC-008-036*

- [ ] T061 [P] Update root `README.md` — short SP-008 surface section: two new CLI verbs (`corpus accept <request-id>`, `corpus engagement-proxy report`); ZERO new MCP surfaces; Track A/B split note. Pattern matches SP-007's README update. *plan.md "Documentation"*

- [ ] T062 [P] Update `CLAUDE.md` — short SP-008 surface section per the SP-001..SP-007 pattern: name the 4 new engagement event classes + the 2 new CLI subcommands + the Track A/B split note + the C-046 E2E smoke harness location. *plan.md "Documentation"*

- [ ] T063 [P] Author `specs/008-user-acceptance/RETROSPECTIVE.md` skeleton — sections per the SP-007 retrospective shape: "What shipped" (the Track A deliverables); "What did NOT ship and why" (Track B verdict pending the 7-day dogfood window; C-043/C-044 carry forward); "Honest performance numbers" (empirical p95s captured during the C-046 E2E smoke); "Track B verdict block" (RESERVED — populated at sprint close with the `corpus engagement-proxy report --since=<dogfood-start>` output AND the JSON form per FR-ENGAGEMENT-023); "Decisions ledger entries to add (D-NNN)" (Decisions A through D from research.md become D-entries in the project ledger); "Concerns ledger entries to add (C-NNN)" (any new concerns surfaced during build). The Track B block is the SOLE Track B criterion (SC-008-035) — Pallas cannot fill it; the operator's real-world usage over the 7-day window fills it. *FR-ENGAGEMENT-022, FR-ENGAGEMENT-023, FR-ENGAGEMENT-024, SC-008-034, SC-008-035, Constitution XVI*

- [ ] T064 Author ledger entries for Decisions D-NNN + Concerns C-NNN — append to the project ledger (location per SP-007 convention): D-entries for Decision A (request_id sourcing — server-side at find-handler), Decision B (telemetry-only acceptance persistence), Decision C (C-046 E2E shape — real MCP-stdio, not library-level), Decision D (`corpus accept` UX — always explicit `<request-id>`, no `--last`); C-entries for any new concerns surfaced (e.g., R3 Track A/B operator-confusion risk, R5 daemon-down-during-dogfood-window risk). *plan.md "Risk Register", research.md Decisions A-D*

- [ ] T065 [P] `/simplify` + `feature-dev:code-reviewer` review pass over SP-008 source — per plan.md "Sizing call" recommendation; run before merge; capture any simplification opportunities or principle drift. Critical-path: the `engagement-proxy-command.ts` orchestration (T043) + the wrapper in `corpus-find-tool.ts` (T016) are the highest-leverage simplification targets. *plan.md "Sizing call"*

- [ ] T066 Open PR on `008-user-acceptance` branch — title "SP-008: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate (Track A)"; description surfaces the Track A/B split per FR-ENGAGEMENT-022 (verbatim — "Track A PR-merge does NOT close SP-008; Track B verdict captured in RETROSPECTIVE.md does"); body includes: deliverables list (4 event classes + 2 CLI subcommands + 6 integration/E2E tests + 9 unit tests + 1 quickstart); the 16/16 Constitution check; the empirical performance numbers from T057; the C-043/C-044 carry-forward; the Track B operator-action gate per SC-008-035. *FR-ENGAGEMENT-022, FR-ENGAGEMENT-023, FR-ENGAGEMENT-024, Constitution XVI*

- [ ] T067 Squash-merge PR to `main` — single squash commit message reuses the PR description; assert `gh pr merge --squash --delete-branch` succeeds; assert `main` builds + lints + tests green post-merge. Track A done. *plan.md "Phase Gates"*

**Checkpoint**: SP-008 Track A is shipped. The 4 `engagement.*` event classes are live, `corpus accept` + `corpus engagement-proxy report` are operator-facing, UR-001/UR-002/UR-003 + adversary + C-046 E2E tests all green on the dev machine. **Track B awaits**: the 7-day dogfood window runs out-of-band; at end-of-window the operator captures `corpus engagement-proxy report --since=<dogfood-start>` and pastes the JSON + verdict into `specs/008-user-acceptance/RETROSPECTIVE.md`'s Track B verdict block. The SP-008 PM-Review gate per SPRINT-PLAN.yaml line 251 closes ONLY on Track B's verdict.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories (Phase 3-5 source compiles against the Zod schemas + typed errors shipped here).
- **Phase 3 (US1 — UR-001 + find instrumentation)**: Depends on Phase 2 — produces the telemetry log that Phases 4/5 read.
- **Phase 4 (US2 — `corpus accept` CLI)**: Depends on Phase 2; CAN run in parallel with Phase 3 (different files); Phase 4's tests need fixture telemetry logs (from T012 in Phase 2) but do NOT need Phase 3's runtime emit since fixtures suffice for unit tests.
- **Phase 5 (US3 — report CLI + C-046 E2E)**: Depends on Phase 2; the unit tests CAN run in parallel with Phase 3 + Phase 4 using fixture logs; the C-046 E2E test (T045) needs Phase 3 (the find emit) + Phase 4 (the accept CLI) + Phase 5's report CLI all wired and built — it's the integration choke point.
- **Phase 6 (Adversary tests)**: Depends on Phase 3 (UR-001 harness pieces) + Phase 5 (UR-003 harness pieces shared with session-start adversary); CAN run in parallel with Phase 5.
- **Phase 7 (Lint enforcement)**: Depends on all source landings from Phases 2-6.
- **Phase 8 (Polish + commit)**: Depends on Phase 7.

### User Story Dependencies

- **US1 (UR-001 — find instrumentation)**: Depends only on Phase 2 contracts landings. Independently testable via T015/T017 (UR-001 integration).
- **US2 (UR-002 — `corpus accept`)**: Depends only on Phase 2 contracts landings; the `acceptance-event-writer` (T026) READS the telemetry log written by US1's instrumentation, but unit tests use fixture logs (no runtime US1 dependency for unit-level). Integration tests for UR-002 (T024/T028) DO depend on US1 instrumentation being wired so a real `corpus.find` emits the find event the accept command reads.
- **US3 (UR-003 — report CLI + C-046 E2E)**: Depends only on Phase 2 contracts landings for unit tests; the C-046 E2E test (T045) depends on US1 instrumentation + US2 `corpus accept` being wired. UR-003 integration (T036/T044) shares harness pieces with the session-start adversary in Phase 6.

### Within Each User Story

- RED-phase tests authored BEFORE GREEN implementations (Constitution V/VII/IX/XIII).
- Args parsers BEFORE CLI command entry points BEFORE integration tests.
- Library helpers (engagement/*.ts) BEFORE the CLI command files that wire them.
- Each user story is independently testable upon checkpoint.

### Parallel Opportunities

- All Phase 2 PREREQ tests (T002-T005, T013) marked [P] can run in parallel — different test files.
- All Phase 2 GREEN implementations (T006-T008, T012) marked [P] can run in parallel — different source files.
- Phase 3 unit tests (T014, T018, T020) parallel-safe.
- Phase 4 unit tests (T022, T023, T029, T030) parallel-safe.
- Phase 5 unit tests (T031-T035) parallel-safe.
- Phase 5 helpers (T037-T042) parallel-safe — different files in `packages/cli/src/engagement/`.
- Phase 6 adversary harnesses (T047, T048) parallel-safe.
- Phase 7 lint verifications (T051-T053) parallel-safe.
- Phase 8 docs (T058-T063) parallel-safe.

---

## Parallel Example: Phase 2 Foundational (PREREQ landings)

```bash
# Launch all RED unit tests for Phase 2 in parallel:
Task: "T002 [P] Author RED unit test tests/unit/sp008-engagement-schemas.test.ts"
Task: "T003 [P] Author RED unit test tests/unit/sp008-engagement-telemetry-union.test.ts"
Task: "T004 [P] Author RED unit test tests/unit/sp008-errors.test.ts"
Task: "T005 [P] Author RED unit test tests/unit/sp008-engagement-find-instrumentation.test.ts"
Task: "T013 [P] Author RED unit test tests/unit/sp008-engagement-discriminated-union-exhaustiveness.test.ts"

# Then launch all GREEN implementations:
Task: "T006 [P] Implement packages/contracts/src/engagement.ts"
Task: "T007 [P] Extend packages/contracts/src/telemetry.ts"
Task: "T008 [P] Extend packages/contracts/src/errors.ts"
Task: "T012 [P] Add fixture inputs to tests/fixtures/sp008-engagement/"
```

---

## Implementation Strategy

### Single-phase build per plan.md "Sizing call"

Production surface ~800-1200 LOC across ~10 source files — well below the `feedback-build-tier-sizing-rule` 2000-LOC / 15-file pre-split threshold. **Single Engineer agent invocation** is the recommended approach. Build order: Phase 1 → Phase 2 → Phase 3 + Phase 4 + Phase 5 (parallel within constraints) → Phase 6 → Phase 7 → Phase 8.

### Critical-path subset (smallest viable shippable subset)

1. Phase 1 (T001) — verify prereqs.
2. Phase 2 (T002-T013) — contracts landings + lint scope. **REQUIRED** for any source to compile.
3. Phase 3 (T014-T021) — find instrumentation + UR-001. **REQUIRED** for any telemetry to exist.
4. Phase 4 (T022-T030) — `corpus accept` + UR-002. **REQUIRED** for acceptances to be recordable.
5. Phase 5 (T031-T046) — report CLI + UR-003 + C-046 E2E. **REQUIRED** for the verdict-producing CLI.
6. Phase 6 (T047-T050) — adversary tests. **REQUIRED** for spec.md User Story 5 acceptance criteria.
7. Phase 7 (T051-T054) — lint + Constitution check. **REQUIRED** for SC-008-028..SC-008-034.
8. Phase 8 (T055-T067) — polish, commit, retro skeleton.

The 7-day dogfood window (Track B) follows merge.

---

## Coverage Matrix — FR-ENGAGEMENT-NNN

| FR | Covered by tasks |
|---|---|
| FR-ENGAGEMENT-001 (`engagement.corpus_find_invoked` emit on every `corpus.find`) | T005, T007, T014, T016, T018, T019, T020, T021 |
| FR-ENGAGEMENT-002 (`corpus accept <request-id>` records acceptance event keyed by request_id) | T022, T023, T025, T026, T027, T029, T030 |
| FR-ENGAGEMENT-003 (`corpus engagement-proxy report` aggregates + C-028 verdict) | T031, T032, T033, T034, T035, T037, T038, T039, T040, T041, T042, T043, T046 |
| FR-ENGAGEMENT-004 (≥ 3 new Zod-validated telemetry classes additive to TelemetryEvent) | T002, T003, T006, T007, T013 |
| FR-ENGAGEMENT-005 (Threshold: ≥ 5 queries + ≥ 1 accept in 7d; KILL < 3) | T033, T040, T042 |
| FR-ENGAGEMENT-006 (C-046 E2E smoke spawning production binary) | T045, T050, T057 |
| FR-ENGAGEMENT-007 (UR-001 Gherkin + integration tests) | T015, T017, T049, T059 |
| FR-ENGAGEMENT-008 (UR-002 Gherkin + integration tests) | T024, T028, T049, T059 |
| FR-ENGAGEMENT-009 (UR-003 Gherkin + integration tests) | T036, T044, T049, T059 |
| FR-ENGAGEMENT-010 (Empty-corpus adversary) | T020, T047, T049, T059 |
| FR-ENGAGEMENT-011 (Session-start idempotency adversary) | T044, T048, T049, T059 |
| FR-ENGAGEMENT-012 (Report JSON Zod-validated + schema_version: 1) | T002, T006, T034, T041 |
| FR-ENGAGEMENT-013 (ZERO new MCP mutation surfaces) | T021, T052 |
| FR-ENGAGEMENT-014 (ZERO new SQL tables, ZERO new Paths.* getters) | T001, T053 |
| FR-ENGAGEMENT-015 (Local-only; ZERO outbound endpoints) | T011, T051, T052 |
| FR-ENGAGEMENT-016 (Every IO cancellable via AbortSignal; setTimeout+abort) | T023, T031, T035, T038, T043 |
| FR-ENGAGEMENT-017 (process.exit only in 2 CLI command files) | T004, T011, T027, T043, T051, T052 |
| FR-ENGAGEMENT-018 (Schema-enforced: every input + output Zod-validated) | T002, T006, T022, T025, T035, T037, T041 |
| FR-ENGAGEMENT-019 (Telemetry-or-die: every catch emits before return/rethrow) | T026, T027, T038, T043, T052 |
| FR-ENGAGEMENT-020 (Reuse `Paths.telemetry()`; ZERO new getters) | T001, T053 |
| FR-ENGAGEMENT-021 (Acceptance-event-definition decision: D2 chosen, D1+D3 rejected) | T026, T064 (D-entry from research.md Decision B + spec Clarifications Decision 1) |
| FR-ENGAGEMENT-022 (Track A is what ships; Track B is what's tested against) | T042, T054, T058, T063, T066 |
| FR-ENGAGEMENT-023 (Report verdict is the sprint's user-acceptance evidence) | T043, T054, T058, T063 |
| FR-ENGAGEMENT-024 (C-043 + C-044 STILL DEFERRED) | T060 |

## Coverage Matrix — SC-008-NNN

| SC | Covered by tasks |
|---|---|
| SC-008-001 (Every `corpus.find` emits `engagement.corpus_find_invoked`) | T005, T014, T016, T017, T021 |
| SC-008-002 (Each event carries request_id, query/hash, result_count, tier_used, duration_ms) | T002, T005, T014, T016 |
| SC-008-003 (4 event classes added to TelemetryEvent; union exhaustive) | T003, T007, T013 |
| SC-008-004 (Queries > 1024 chars stored as hash + truncated flag) | T002, T016, T018, T019 |
| SC-008-005 (4 new classes integrate with emitTelemetry size budget) | T003, T007 |
| SC-008-006 (Events fire even when result_count == 0) | T020, T047 |
| SC-008-007 (`corpus accept` appends event with matching request_id) | T023, T026, T027 |
| SC-008-008 (Unknown request_id → non-zero exit + clear error) | T023, T026, T027 |
| SC-008-009 (Zero-result query accept → non-zero exit) | T023, T026, T027 |
| SC-008-010 (Duplicate accept is idempotent: "already accepted" + exit 0; no dup event) | T023, T026, T027, T029 |
| SC-008-011 (`--note "<text>"` recorded in acceptance_note) | T022, T026, T030 |
| SC-008-012 (Notes > 512 chars rejected at Zod boundary) | T022, T030 |
| SC-008-013 (Report defaults --since=now-7d, --until=now) | T035, T037 |
| SC-008-014 (Report counts queries + accepts accurately for synthetic input) | T032, T039 |
| SC-008-015 (Report computes PASS when ≥ 5q + ≥ 1a) | T033, T040 |
| SC-008-016 (Report computes FAIL with kill_signal: true when queries < 3) | T033, T040, T042 |
| SC-008-017 (Report computes FAIL non-KILL when 3 ≤ q < 5 OR (q ≥ 5 AND a == 0)) | T033, T040 |
| SC-008-018 (Report honors --since/--until window) | T031, T035, T038 |
| SC-008-019 (JSON output Zod-validates against EngagementProxyReportZodSchema) | T002, T006, T034, T041 |
| SC-008-020 (Report scans rotated logs whose mtime falls in window) | T031, T038, T046 |
| SC-008-021 (Malformed lines skipped + counted; report still emits) | T031, T038 |
| SC-008-022 (UR-001 scenarios pass) | T015, T017, T049, T059 |
| SC-008-023 (UR-002 scenarios pass) | T024, T028, T049, T059 |
| SC-008-024 (UR-003 scenarios pass) | T036, T044, T049, T059 |
| SC-008-025 (Empty-corpus adversary passes) | T047, T049, T059 |
| SC-008-026 (Session-start idempotency adversary passes) | T048, T049, T059 |
| SC-008-027 (C-046 E2E smoke passes) | T045, T050 |
| SC-008-028 (Constitution I — ZERO outbound endpoints) | T011, T051, T052 |
| SC-008-029 (Constitution III — ZERO new MCP mutation surfaces) | T021, T051, T052 |
| SC-008-030 (Constitution V — every input/output/event Zod-validated) | T002, T006, T011, T051, T052 |
| SC-008-031 (Constitution VII — AbortSignal everywhere; ZERO Promise.race+setTimeout) | T011, T023, T031, T038, T043, T051, T052 |
| SC-008-032 (Constitution XI — process.exit only in 2 CLI command files) | T004, T011, T027, T043, T051, T052 |
| SC-008-033 (Constitution XIII — ≥ 4 new event classes; every catch emits) | T003, T007, T026, T027, T038, T043, T052 |
| SC-008-034 (Constitution XVI — Track A/B split surfaced verbatim) | T042, T054, T058, T063, T066 |
| SC-008-035 (TRACK B — operator's 7-day dogfood verdict in RETROSPECTIVE.md) | T063 (skeleton); fulfilled out-of-band by operator |
| SC-008-036 (C-043 + C-044 stay DEFERRED) | T060 |

## Coverage Matrix — Entities (data-model.md)

| Entity | Covered by tasks |
|---|---|
| 1. EngagementCorpusFindInvokedEvent | T002, T003, T005, T006, T007, T014, T016, T018, T019, T020 |
| 2. EngagementAcceptanceEvent | T002, T003, T006, T007, T023, T026, T027, T029, T030 |
| 3. EngagementReportGeneratedEvent | T002, T003, T006, T007, T043 |
| 4. EngagementReportTelemetryParseFailedEvent | T002, T003, T006, T007, T031, T038 |
| 5. EngagementProxyReport | T002, T006, T034, T039, T040, T041, T042 |
| 6. AcceptArgs | T002, T006, T022, T025 |
| 7. EngagementProxyReportArgs | T002, T006, T035, T037 |

---

## Anti-claims (verified absent from this task list)

- **NO `--last` flag on `corpus accept`** — REJECTED per Decision D for v1; operator captures explicit `<request-id>` from telemetry.
- **NO new SQL table for acceptances** — REJECTED per FR-ENGAGEMENT-014 + Decision B; telemetry-only.
- **NO new `Paths.*` getters** — Constitution XIV; SC-008-031; reuse `Paths.telemetry()`.
- **NO sidecar files at `Paths.state()/engagement/<request_id>.json`** — REJECTED per Decision B.
- **NO mutation of `SearchOutputZodSchema`** — per Decision A; `request_id` lives in telemetry only.
- **NO new MCP tools or resources** — Constitution III; FR-ENGAGEMENT-013; the SP-001..SP-007 surfaces are preserved.
- **NO new outbound non-loopback endpoints** — Constitution I; FR-ENGAGEMENT-015; no telemetry shipping; no remote aggregation.
- **NO cross-agent telemetry instrumentation (Gemini CLI, Codex CLI)** — out of scope per AG-004 / OOS-011.
- **NO formal eval harness as v1 success criterion** — Constitution XVI; the C-046 E2E smoke is the substantive runtime gate; Track B is the user-acceptance gate.
- **NO C-043 fix (signals_used: [] propagation)** — STILL DEFERRED per FR-ENGAGEMENT-024.
- **NO C-044 fix (regenerateCatalogFromDb summary column)** — STILL DEFERRED per FR-ENGAGEMENT-024.
- **NO automated dogfood (Track B cannot be code-completed)** — Constitution XVI; SC-008-035 is operator-driven only.
- **NO Promise.race(setTimeout) pattern** — Constitution VII forbidden; setTimeout + clearTimeout + controller.abort() everywhere.
- **NO `process.exit` in library helpers under `packages/cli/src/engagement/`** — Constitution XI; FR-ENGAGEMENT-017.

---

## Build sizing call

Per `feedback-build-tier-sizing-rule` (>2000 LOC / >15 files MUST split into N≥2 pre-planned Engineer agent invocations):

- **Production surface**: ~800-1200 LOC across ~10 source files (`engagement.ts` schemas + 2 CLI command files + 8 engagement-helpers files + `corpus-find-tool.ts` extension + `telemetry.ts` extension + `errors.ts` extension + `index.ts` re-exports + index.ts dispatcher extension).
- **Total surface with tests + fixtures**: ~2500-3000 LOC across ~25 files.
- **Recommendation per plan.md "Sizing call"**: **Single-phase build** when `/speckit-implement` runs. The four deliverables (find instrumentation + `corpus accept` + `corpus engagement-proxy report` + C-046 E2E smoke) are orthogonal but tightly coupled by the shared `engagement.*` telemetry schema; the production surface sits comfortably **below** the 2000-LOC / 15-file threshold. If during build the surface unexpectedly expands above 2000 LOC OR 15 source files, **pre-split into 2 Engineer agent invocations** per `feedback-build-tier-sizing-rule`: (a) contracts + find instrumentation + `corpus accept` (Phases 2-4); (b) `corpus engagement-proxy report` + adversary tests + C-046 E2E + polish (Phases 5-8). The split point is the accept-vs-report boundary; accept can ship first as the foundation; report builds on top of accept's telemetry-write contract.
