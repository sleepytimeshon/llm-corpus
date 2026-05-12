---
description: "Task list for feature 000-nfr-008-pilot-lite (SP-000-lite)"
---

# Tasks: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Input**: Design documents from `/specs/000-nfr-008-pilot-lite/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/{pilot-harness,query-set,telemetry}.feature, quickstart.md

**Prior state**: SP-002 PR #4 merged on `main` on 2026-05-09. The `corpus.find` MCP tool and four `corpus://` resources are operational. `Paths.telemetry()` (single-file resolver) exists. `qwen3:8b` is already pulled on `pai-node01`. SP-000-lite builds *additively* on this surface — zero re-implementation of SP-001/SP-002.

**Tests**: MANDATORY for every task touching IO, telemetry events, paths, schema validation, or harness output (per `.specify/templates/tasks-template.md` project-specific override and Constitution Principles V, VII, VIII, IX, XIII, XIV, XVI). SP-000-lite touches paths (new `Paths.pilotTelemetry()` resolver), telemetry (new `nfr_008_pilot` event class + per-iteration JSONL stream), schema (event Zod schema + summary Zod schema + queries.yaml stratification linter), and personal-scale-qualifier presence (Principle XVI) — tests are mandatory throughout.

**Scope-bound**: SP-000-lite ships ONLY the pilot harness CLI subcommand (`corpus pilot run --variant <id> --iteration <1|2>`), the per-iteration JSONL telemetry + JSON summary writers, the stratification linter for `queries.yaml`, the personal-scale-qualifier presence check, and the two prerequisite SP-001 substrate amendments (`Paths.pilotTelemetry()` resolver key + `nfr_008_pilot` event class registration). SP-000-lite does NOT ship ingest (SP-003), the labeled retrieval evaluation harness (OOS-012), retrieval-quality scoring, hit-rate metrics, or any new MCP tool/resource. SP-000-lite measures *tool invocation rate*, not *retrieval quality* (AG-005 binding).

**Organization**: Tasks are grouped by phase. Phase 0 (Prerequisites) carries the two load-bearing substrate amendments that lift Constitution Check Principle XIV from `[~]` to `[x]` and Principle XIII from "spirit-only" to "schema-enforced"; these BLOCK every other task. Phases 1–5 follow the speckit-tasks template. User-story labels `[US1]` (binary exit discharge), `[US2]` (stratification rubric), `[US3]` (personal-scale framing) tag individual tasks for FR-PILOT/SC traceability. All three user stories are P1 and share the harness substrate, so they are interleaved across phases rather than carved into per-story phases. Constitution Check (15 [x] + 1 [~] resolved by Phase 0) verified at plan time; no Complexity Tracking entries.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (binary-exit-discharge), US2 (stratification-rubric), US3 (personal-scale-framing) — only on tasks that map to a user story
- File paths are repo-relative under `~/Projects/llm-corpus/`

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. SP-000-lite grows two existing packages and authors one per-feature spec asset (per plan.md "Project Structure"):

- `packages/contracts/` — extended with `Paths.pilotTelemetry()` derived getter + `nfr_008_pilot` event class registered in the telemetry Zod schema (Phase 0)
- `packages/cli/src/pilot/` — NEW subdirectory carrying the `pilot run` subcommand, summary writer, and operator README
- `packages/pipeline/src/pilot-harness/` — NEW subdirectory carrying the library-layer harness driver, stratification linter, and event Zod schema
- `specs/000-nfr-008-pilot-lite/queries.yaml` — NEW per-feature spec asset (the 50-query stratified set; NOT under `Paths.*` because it is repo-tracked spec content, not runtime state)
- `tests/{contract,integration}/sp000-lite/` — NEW test directories for harness, schema, stratification, and personal-scale-qualifier presence

---

## Phase 0: Prerequisites (load-bearing SP-001 substrate amendments)

**Purpose**: Two pure-substrate amendments to `packages/contracts/` that MUST land on `main` BEFORE any pilot harness implementation begins. These tasks discharge the `[~]` entry on Constitution Check Principle XIV (lifting it to `[x]`) and convert Principle XIII from "spirit-only" to "schema-enforced". Captured verbatim in plan.md `## Phase 2 Prerequisites`.

**⚠️ HARD BLOCKER**: All Phase 1+ tasks depend on BOTH T001 and T002. Running the pilot harness against an unmerged `Paths.pilotTelemetry()` resolver or an unregistered `nfr_008_pilot` event class is FORBIDDEN by FR-PILOT-005, FR-PILOT-006, and ADR-010 §Decision. The harness CLI MUST refuse to start if either prerequisite is missing (see quickstart.md §0.3 / §0.4).

### Phase 0 tests (mandatory per Constitution V, XIII, XIV)

- [ ] T001 [P] Author contract test `packages/contracts/src/paths.test.ts` (or extend existing paths-resolver test) verifying that `Paths.pilotTelemetry()` exists, returns a string, equals `path.join(Paths.state(), 'pilot-telemetry')`, resolves under `$HOME`, and is distinct from `Paths.telemetry()` (file vs directory). Test MUST FAIL before T003 lands. *FR-PILOT-006, SC-006, Constitution XIV; telemetry.feature scenarios "Paths.pilotTelemetry() resolves to a directory under state, not under tmp" + "Paths.pilotTelemetry() is distinct from Paths.telemetry()"*
- [ ] T002 [P] Author contract test `packages/contracts/src/telemetry.test.ts` (or extend existing telemetry-schema test) verifying that the `nfr_008_pilot` event class is registered in the telemetry-event Zod schema with all FR-PILOT-005 fields (`event_class`, `severity`, `timestamp`, `run_id`, `iteration`, `model`, `prompt_variant`, `query_id`, `query_bucket`, `retrieval_pattern`, `tool_invoked`, `tool_arguments_valid`, `malformed_call_payload`, `retrieval_outcome`, `duration_ms`) at their spec'd types; verify that schema-invalid payloads are rejected (wrong type on `tool_invoked`, missing required field, etc.). Test MUST FAIL before T004 lands. *FR-PILOT-005, Constitution XIII; telemetry.feature scenario "Each telemetry event conforms to the FR-PILOT-005 schema"*

### Phase 0 implementation

- [ ] T003 Add `Paths.pilotTelemetry(): string => path.join(Paths.state(), 'pilot-telemetry')` derived getter to `packages/contracts/src/paths.ts`. Export from the `Paths` frozen object alongside the existing SP-001 getters; do NOT add a new XDG base directory (the key composes from `Paths.state()`). Update the SP-001 `paths-from-resolver-only` lint rule's allowlist if its scope covers the new getter's call sites. T001's contract test must turn green after this task. *Prereqs: T001. FR-PILOT-006, Constitution XIV; plan.md PREREQ-001*
- [ ] T004 Register `nfr_008_pilot` event class in the telemetry-event Zod schema at `packages/contracts/src/telemetry.ts`. The class enumerates the FR-PILOT-005 fields with their types: `event_class` (z.literal `"nfr_008_pilot"`), `severity` (z.enum `["info","warn","error"]`), `timestamp` (z.string ISO-8601), `run_id` (z.string UUIDv4), `iteration` (z.union `[z.literal(1), z.literal(2)]`), `model` (z.literal `"qwen3:8b"`), `prompt_variant` (z.string), `query_id` (z.string), `query_bucket` (z.enum), `retrieval_pattern` (z.enum.nullable), `tool_invoked` (z.boolean), `tool_arguments_valid` (z.boolean), `malformed_call_payload` (z.string.max(2048).nullable), `retrieval_outcome` (z.string.max(1024)), `duration_ms` (z.number.int.nonnegative). T002's contract test must turn green after this task. *Prereqs: T002. FR-PILOT-005, Constitution XIII; plan.md PREREQ-002*

**Checkpoint**: `npm run build` succeeds; both T001 and T002 contract tests are green; `Paths.pilotTelemetry()` and the `nfr_008_pilot` event class are merged on `main`. Constitution Check Principle XIV lifts from `[~]` to `[x]`; Principle XIII lifts from "spirit-only" to "schema-enforced". Phase 1 may now begin.

---

## Phase 1: Setup (workspace plumbing for the pilot harness packages)

**Purpose**: Skeleton directories, package.json wiring, test-directory scaffolding, and the empty Vitest configuration for the new `pilot-harness/` library + `pilot/` CLI subcommand directories. No production logic in this phase — Phase 2 (Tests-First) authors the failing contract tests, Phase 3 implements them.

- [ ] T005 [P] Create directory `packages/pipeline/src/pilot-harness/` with empty placeholder files: `harness.ts` (top-level driver, library-layer; returns `Result<T, E>`), `stratification.ts` (queries.yaml linter), `events.ts` (event Zod schema re-export from `@llm-corpus/contracts`), `summary.ts` (summary Zod schema + writer signature). Files compile to empty modules; no behavior yet. *Prereqs: T003, T004. plan.md "Source Code" structure*
- [ ] T006 [P] Create directory `packages/cli/src/pilot/` with empty placeholder files: `command.ts` (CLI argument parser for `--variant` + `--iteration`), `summary.ts` (atomic summary writer wrapper — calls library helper from packages/pipeline), `README.md` (operator usage notes; carries personal-scale qualifier inline). *Prereqs: T003, T004. plan.md "Source Code" structure*
- [ ] T007 Wire `pilot` as a registered subcommand in `packages/cli/src/index.ts` (or the existing CLI command-registry file). Subcommand reads `--variant <id>` and `--iteration <1|2>`; iteration ≥ 3 is rejected at argument validation with a clear error citing ADR-010 scope. CLI surfaces `--help` output that includes a personal-scale qualifier (carries `qwen3:8b` AND "Shon's personal knowledge-work corpus" strings). *Prereqs: T006. FR-PILOT-004, FR-PILOT-008, Constitution XVI; pilot-harness.feature scenario "Iteration 3+ is rejected at CLI argument validation"*
- [ ] T008 [P] Create test directory `tests/contract/sp000-lite/` and `tests/integration/sp000-lite/` with empty placeholder test files (each carries a single `describe.todo` block so Vitest discovery picks them up): `telemetry-schema.test.ts`, `query-stratification.test.ts`, `path-resolution.test.ts`, `qualifier-presence.test.ts`, `harness-loopback.test.ts`. *Prereqs: T005. plan.md "tests/" structure*
- [ ] T009 [P] Verify `js-yaml` (already a contracts dep per SP-002 T001) is transitively available to `packages/pipeline/`; if not, add as an explicit dep in `packages/pipeline/package.json`. The stratification linter (T012/T015) and the harness (T016) read `queries.yaml` via `js-yaml`. *Prereqs: T005. plan.md "Primary Dependencies"; no new workspace package or root dep introduced*

**Checkpoint**: `npm run build` succeeds with the empty pilot directories in place; `npm run test` discovers the new sp000-lite test placeholders (all `describe.todo`, none failing); `corpus pilot --help` prints the personal-scale-qualified help text and rejects iteration ≥ 3. Toolchain ready for Phase 2 contract tests.

---

## Phase 2: Tests-First (mandatory contract tests, all MUST fail before Phase 3 begins)

**Purpose**: Author every contract test the harness implementation must satisfy. Each test in this phase MUST fail when authored (red bar verified) so that Phase 3 implementation work has a clear pass criterion. Tests cover the 9 contract-feature scenario groups across `pilot-harness.feature`, `query-set.feature`, and `telemetry.feature`, plus the personal-scale-qualifier presence check (Constitution XVI).

**⚠️ DISCIPLINE**: No Phase 3 implementation task may begin until every Phase 2 test below is authored AND has been observed to fail. The main DA verifies red-bar status before commits cross the Phase 2 → Phase 3 boundary.

### Telemetry event schema (FR-PILOT-005, Constitution XIII)

- [ ] T010 [P] [US1] Author `tests/contract/sp000-lite/telemetry-schema.test.ts` covering: each emitted event line is valid JSON; each event line is ≤ 4 KB (POSIX-atomic `O_APPEND` budget per Constitution IX); each event carries the full FR-PILOT-005 field set; the registered Zod schema accepts well-formed events and rejects malformed ones (missing required field, wrong type on `tool_invoked`, oversized `malformed_call_payload`). Test fixtures synthesize representative events covering successful turn (severity=info), malformed-call turn (severity=warn, non-null payload), non-invocation turn (severity=info, null payload), and harness-error event (severity=error). *Prereqs: T004, T008. FR-PILOT-005, SC-003, Constitution IX/XIII; telemetry.feature scenarios "Each telemetry event conforms to the FR-PILOT-005 schema" + "Each iteration emits exactly 50 events with zero dropped" + "Successful turn emits info-severity event" + "Malformed tool call emits warn-severity event with payload capture" + "Non-invocation emits info-severity event with null malformed payload"*

### Path discipline (FR-PILOT-006, SC-006, Constitution XIV)

- [ ] T011 [P] [US1] Author `tests/contract/sp000-lite/path-resolution.test.ts` covering: `Paths.pilotTelemetry()` returns a directory under `$HOME` (NOT `/tmp`, `/var`, or `os.tmpdir()`); `Paths.telemetry()` returns a file path distinct from `Paths.pilotTelemetry()`; the harness writes telemetry to `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + ".jsonl")` and summary to `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + "-summary.json")`; no hardcoded path literal appears under `packages/cli/src/pilot/` or `packages/pipeline/src/pilot-harness/` (grep-based assertion). *Prereqs: T003, T008. FR-PILOT-006, SC-006, Constitution XIV; telemetry.feature scenarios "Telemetry stream resolves through Paths.pilotTelemetry()" + "Summary file resolves through the same resolver" + "Paths.pilotTelemetry() resolves to a directory under state, not under tmp" + "Paths.pilotTelemetry() is distinct from Paths.telemetry()"*

### Query set stratification (FR-PILOT-002, FR-PILOT-003, FR-PILOT-010, FR-PILOT-011, FR-PILOT-012, SC-002)

- [ ] T012 [P] [US2] Author `tests/contract/sp000-lite/query-stratification.test.ts` covering the stratification linter: bucket counts are exactly 30 KG + 15 G + 5 A (50 total); all three retrieval-pattern labels (`factual_lookup`, `recall_by_context`, `multi_doc_synthesis`) appear at least once in the KG bucket; general + adversarial buckets carry `retrieval_pattern == null`; each retrieval pattern has exactly 2 worked-example queries with `worked_example_for == <that pattern>` and the `query_text` matches verbatim the text published in spec.md §"Retrieval Pattern Operational Definitions"; each `query_id` is unique; bucket-prefix convention is honored (e.g., `kg-001`, `g-001`, `adv-001`); KG queries carry `provenance == "mined-from-MEMORY-WORK"`; general queries carry `provenance == "hand-crafted-general"`; adversarial queries carry `provenance == "hand-crafted-adversarial"`. *Prereqs: T008. FR-PILOT-002/003/010/011, SC-002; query-set.feature scenarios "Bucket counts are exactly 30/15/5" through "query_id values are unique across the 50"*
- [ ] T013 [P] [US2] Extend `tests/contract/sp000-lite/query-stratification.test.ts` (same file as T012, separate `describe` block) with negative-path scenarios: a queries.yaml with 29 KG queries fails with FR-PILOT-002 citation; an unratified Q3 DRAFT (missing explicit ratification marker in spec.md or PR-review trace) fails with FR-PILOT-012 citation; the harness refuses to start when the linter exits non-zero. *Prereqs: T012. FR-PILOT-002/012; query-set.feature scenarios "Bucket count deviation blocks the pilot run" + "Unratified DRAFT definitions block the pilot run" + "Ratified definitions unlock the pilot run"*

### Personal-scale qualifier presence (FR-PILOT-008, SC-004, Constitution XVI)

- [ ] T014 [P] [US3] Author `tests/contract/sp000-lite/qualifier-presence.test.ts` covering: per-iteration summary JSON carries a non-empty `personal_scale_qualifier` field; the qualifier contains the literal substring `"qwen3:8b"`; the qualifier contains `"personal"` OR `"Shon"`; the qualifier does NOT contain any of `"industry-standard"`, `"benchmark floor"`, `"cross-model"`, `"cross-user"`, `"cross-machine"` (industry-generalization phrases per Constitution XVI). Additional assertion: the harness CLI `--help` output and the `packages/cli/src/pilot/README.md` BOTH carry the same qualifier inline. *Prereqs: T008. FR-PILOT-008, SC-004, Constitution XVI; telemetry.feature scenarios "Summary carries personal-scale qualifier identifying model and substrate" + "D-NNN ledger entry inherits the qualifier verbatim"*

### Summary fields + soft threshold (FR-PILOT-013)

- [ ] T015 [P] [US1] Author summary-schema contract test as a new `describe` block in `tests/contract/sp000-lite/telemetry-schema.test.ts` (co-located with T010): summary JSON carries `summary_schema_version == "1.0.0"`, full Pilot Summary field set per data-model.md Entity 4; `headline_n == bucket_invocations.knowledge_grounded`; `bucket_counts == {knowledge_grounded: 30, general: 15, adversarial: 5}`; `malformed_call_rate_kg == malformed_call_count_kg / 30`; `soft_threshold_flag == (malformed_call_count_kg > 10)`; `pattern_invocations` carries integer counts for all three retrieval patterns; `malformed_call_count_kg <= bucket_invocations.knowledge_grounded`. Soft-threshold assertion: 12 malformed → flag=true; 10 malformed → flag=false; in BOTH cases the binary exit decision remains parameterized on `headline_n` alone (no auto-escalation logic is triggered by the flag). *Prereqs: T010. FR-PILOT-013; telemetry.feature scenario "Summary fields populated correctly"; pilot-harness.feature scenarios "Malformed-call rate exceeds 10/30 on KG bucket; soft threshold flag fires" + "Malformed-call rate at or below 10/30; soft threshold flag does not fire"*

### Harness end-to-end integration (FR-PILOT-001, FR-PILOT-004, FR-PILOT-014, SC-003, SC-006)

- [ ] T016 [US1] Author `tests/integration/sp000-lite/harness-loopback.test.ts` covering: full harness drive against an in-process MCP loopback fixture + a stub Ollama HTTP responder (NO real `qwen3:8b` call in CI — operator-driven on workstation per plan.md "Testing"); exactly 50 telemetry events written to `pilot-iter1.jsonl`; summary written atomically to `pilot-iter1-summary.json`; the summary's `headline_n` matches the count of KG queries the stub responder triggered tool-calls on; iteration 2 against the same loopback writes `pilot-iter2.jsonl` + `pilot-iter2-summary.json` and does NOT delete or overwrite iteration-1 artifacts (FR-PILOT-014 retention); iteration ≥ 3 is rejected at CLI argument validation. *Prereqs: T005, T006, T010, T011, T015. FR-PILOT-001/004/014, SC-003; pilot-harness.feature scenarios "Iteration 1 runs cleanly and produces a summary with headline N" through "Iteration 3+ is rejected at CLI argument validation" + "Harness writes ONLY under Paths.* resolved paths"; telemetry.feature scenarios "Iteration 2 does NOT delete or overwrite iteration 1 artifacts" + "Harness MUST NOT clean up iteration artifacts on its own"*

### Failure-mode telemetry (Constitution XIII no-swallow)

- [ ] T017 [US1] Extend `tests/integration/sp000-lite/harness-loopback.test.ts` (same file as T016, separate `describe` block) covering failure modes: Ollama unreachable / `qwen3:8b` not pulled → harness emits a structured `error`-severity event to `Paths.telemetry()` (NOT to the pilot-iter JSONL) and exits non-zero without substituting another model and without creating a `pilot-iter*.jsonl` file; MCP server crash mid-run → harness emits `error`-severity event capturing the crash, persists partial JSONL records already written, exits non-zero within 2 seconds, does NOT attempt resumption; no `try { } catch { /* ignore */ }` block appears anywhere under `packages/cli/src/pilot/` or `packages/pipeline/src/pilot-harness/` (grep-based static check). *Prereqs: T016. Constitution XIII; pilot-harness.feature scenarios "qwen3:8b is not loadable; pilot halts cleanly" + "MCP server crash mid-pilot"; telemetry.feature scenarios "Harness-level error (MCP crash, Ollama failure) emits error-severity event to production telemetry" + "No wrapper, decorator, or middleware swallows exceptions"*

**Checkpoint**: All seven Phase 2 test files (T010, T011, T012, T013, T014, T015, T016, T017 — counting T015 and T017 as extensions of co-located files) authored; `npm run test tests/{contract,integration}/sp000-lite/` shows a fully red bar with at least one assertion failure per test file. Main DA verifies red-bar status before any Phase 3 implementation task starts.

---

## Phase 3: Core Implementation (turn Phase 2 tests green)

**Purpose**: Implement the library-layer harness, the stratification linter, the CLI subcommand wiring, and the summary writer. Each task in this phase turns one or more Phase 2 contract tests from red to green. Implementation discipline: library functions return `Result<T, E>` or throw typed errors (Constitution XI); only `packages/cli/src/pilot/command.ts` calls `process.exit`.

### Stratification linter (FR-PILOT-002, FR-PILOT-003, FR-PILOT-011, FR-PILOT-012)

- [ ] T018 [US2] Implement `packages/pipeline/src/pilot-harness/stratification.ts` exporting `lintQuerySet(yamlPath: string): Result<QuerySet, LinterError>`. The linter reads `queries.yaml` via `js-yaml`, parses against a Zod schema matching data-model.md Entity 2 fields, then runs all FR-PILOT-002/003/010/011 checks: bucket counts exactly 30/15/5; all three retrieval-pattern labels present in KG bucket; null `retrieval_pattern` on G/A buckets; each retrieval pattern has exactly 2 worked-example queries; worked-example `query_text` matches verbatim spec.md §"Retrieval Pattern Operational Definitions"; unique `query_id`s; bucket-prefix convention; provenance values per bucket. Returns `Result.Err(LinterError)` with structured error data on any failure. Turns T012 green. *Prereqs: T012, T013. FR-PILOT-002/003/010/011; query-set.feature scenarios mapped at T012*
- [ ] T019 [US2] Implement the Q3 ratification gate in `packages/pipeline/src/pilot-harness/stratification.ts` (same file as T018): a separate exported function `verifyQ3Ratified(specPath: string): Result<void, RatificationError>` that reads spec.md, locates the "## Retrieval Pattern Operational Definitions" section, and looks for a ratification marker (e.g., a `<!-- ratified: true -->` HTML comment or equivalent token written by Shon in PR walkthrough; the convention is decided here and documented inline). If the marker is absent, the function returns `Result.Err(RatificationError)` citing FR-PILOT-012. Wired into `harness.ts` as a gate that blocks pilot startup. Turns T013's ratification-gate scenarios green. *Prereqs: T018. FR-PILOT-012; query-set.feature scenarios "Unratified DRAFT definitions block the pilot run" + "Ratified definitions unlock the pilot run"*

### Authored query set (FR-PILOT-010, FR-PILOT-011)

- [ ] T020 [US2] Author `specs/000-nfr-008-pilot-lite/queries.yaml` with the full 50-query stratified set: 30 KG queries mined from `~/.claude/MEMORY/WORK/` PRD bodies (extracted question-shaped language, topic-cross-checked against Shon's bookmarks file — audit trail recorded in PR review), 15 hand-crafted general queries (NOT corpus-grounded), 5 hand-crafted adversarial queries (close-to-corpus topics that should NOT trigger `corpus.find`). Each KG query carries one of the three `retrieval_pattern` labels; all three labels appear at least once. The 6 worked-example queries (2 per retrieval pattern) carry `query_text` matching verbatim the text in spec.md §"Retrieval Pattern Operational Definitions" and `worked_example_for == <pattern>`. `query_id` follows bucket-prefix convention (`kg-001`...`kg-030`, `g-001`...`g-015`, `adv-001`...`adv-005`). The linter from T018 MUST exit zero against this file. Turns T012/T013 fully green. *Prereqs: T018, T019. FR-PILOT-010/011; query-set.feature scenarios "Substrate is the curated 32-PDF sampler enumerated in spec" + "Knowledge-grounded queries are mined from MEMORY/WORK PRD bodies" + "General and adversarial queries are hand-crafted (NOT corpus-mined)"*
- [ ] T021 [US2] Author the Q3 ratification marker in spec.md §"Retrieval Pattern Operational Definitions" (HTML-comment form per the convention decided in T019: `<!-- ratified: true -->` on each of the three pattern sub-sections, accompanied by PR-review comments that Shon supplies in walkthrough). This task is a Markdown-only edit (no implementation code), performed at PR-walkthrough time after Shon's verbal ratification — it modifies spec.md but introduces no production-code change. After T021 lands as a commit, T019's ratification-gate test passes against the ratified spec. *Prereqs: T019. FR-PILOT-012*

### Library-layer harness driver (FR-PILOT-001, FR-PILOT-004, FR-PILOT-005, FR-PILOT-006, FR-PILOT-014, Constitution VII, VIII, IX, XI, XIII, XIV)

- [ ] T022 [US1] Implement `packages/pipeline/src/pilot-harness/events.ts` exporting the `PilotTelemetryEvent` TypeScript type derived from the Zod schema registered in T004. Provides a typed constructor `mkPilotEvent(fields): PilotTelemetryEvent` that validates at construct time and throws a typed error on schema violation. Used by `harness.ts` for every per-query emission. *Prereqs: T004, T010. FR-PILOT-005, Constitution V/XIII; telemetry.feature scenario "Each telemetry event conforms to the FR-PILOT-005 schema"*
- [ ] T023 [US1] Implement `packages/pipeline/src/pilot-harness/summary.ts` exporting `mkPilotSummary(events: PilotTelemetryEvent[], runMeta): PilotSummary` and `writePilotSummary(summary, iteration, signal): Promise<Result<string, WriteError>>`. The constructor derives `headline_n`, `bucket_invocations`, `bucket_rates`, `pattern_invocations`, `malformed_call_count_kg`, `malformed_call_rate_kg`, `soft_threshold_flag` deterministically from the 50 events. The writer uses the existing atomic-write helper `withTempDir(async dir => { ... })` (`tmp + fsync + rename + dirsync`) per Constitution VIII §"Atomic Writes". Path resolves through `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + "-summary.json")`. `AbortSignal` propagated end-to-end (Constitution VII). Turns T015 green. *Prereqs: T003, T010, T015, T022. FR-PILOT-013, Constitution VII/VIII/XIV*
- [ ] T024 [US1] Implement `packages/pipeline/src/pilot-harness/harness.ts` exporting `runPilot(opts: {variant: string, iteration: 1|2, signal: AbortSignal}): Promise<Result<PilotSummary, HarnessError>>`. The driver: (a) verifies prerequisites in order (Ollama reachable, `qwen3:8b` available, MCP server operational, `Paths.pilotTelemetry()` resolver functional, stratification linter passes via T018, Q3 ratified via T019) — halting cleanly with structured telemetry to `Paths.telemetry()` on any failure (Constitution XIII); (b) loads `queries.yaml`, hashes into `query_set_id`; (c) loops 50 queries through `qwen3:8b` via the existing `@llm-corpus/inference` Ollama client, with the SP-002 MCP server advertised over stdio loopback; (d) constructs and emits one `nfr_008_pilot` event per turn via `mkPilotEvent` from T022; (e) appends each event as a single line to `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + ".jsonl")` via `O_APPEND` (POSIX-atomic per Constitution IX, line ≤ 4 KB); (f) after the 50-query loop, calls `mkPilotSummary` + `writePilotSummary` (T023); (g) emits `pilot_run_started` and `pilot_run_completed` (or `pilot_run_aborted` on SIGTERM/SIGINT) events to `Paths.telemetry()`. NEVER calls `process.exit`. Per-query timeout default 60s; per-iteration timeout 30 min. Turns T010, T011, T016 green. *Prereqs: T018, T019, T022, T023. FR-PILOT-001/004/005/006/014, Constitution VII/VIII/IX/XI/XIII/XIV*

### CLI surface wiring (FR-PILOT-004, FR-PILOT-008, Constitution XI, XVI)

- [ ] T025 [US1] [US3] Implement `packages/cli/src/pilot/command.ts` as the CLI entry: parses `--variant <id>` and `--iteration <1|2>` flags; rejects iteration ≥ 3 at argument validation with a clear error citing ADR-010 scope; constructs an `AbortController` wired to SIGTERM/SIGINT (Constitution VII); calls `runPilot` from T024; maps `Result.Err` to a non-zero `process.exit` with a structured error message to stderr; maps `Result.Ok` to exit 0. THIS is the only file in the pilot subtree allowed to call `process.exit` per Constitution XI. Turns T007 / T017 / argument-validation parts of T016 green. *Prereqs: T007, T024. FR-PILOT-004, Constitution VII/XI; pilot-harness.feature scenarios "Iteration 1 runs cleanly..." + "Iteration 3+ is rejected at CLI argument validation"*
- [ ] T026 [US3] Implement the personal-scale qualifier inline in three places: (a) `packages/cli/src/pilot/command.ts` `--help` output; (b) `packages/cli/src/pilot/README.md` operator notes; (c) the `personal_scale_qualifier` field default in `mkPilotSummary` (T023) seeded with the verbatim string from data-model.md Entity 1: `"Shon's workflow on qwen3:8b against his personal-curated-32pdf-sampler substrate; NOT an industry-standard floor."`. Each location MUST contain the literal substrings `"qwen3:8b"` AND (`"personal"` OR `"Shon"`); none may contain industry-generalization phrases. Turns T014 green. *Prereqs: T023, T025. FR-PILOT-008, SC-004, Constitution XVI; telemetry.feature scenario "Summary carries personal-scale qualifier identifying model and substrate"*

**Checkpoint**: All Phase 2 contract tests (T010–T017) are green; `corpus pilot run --variant v1 --iteration 1` against the in-process MCP loopback + Ollama stub completes successfully; the 50-event JSONL stream and the per-iteration summary write to `Paths.pilotTelemetry()` paths; the personal-scale qualifier is present in CLI `--help`, README, and summary JSON.

---

## Phase 4: Integration (live-Ollama operator run + terminal artifact authoring)

**Purpose**: Operator-driven workstation execution of the pilot harness against the real `qwen3:8b` model on `pai-node01`, followed by the binary-exit discharge: authoring the D-NNN ledger entry that closes ADR-010's gate. These tasks are intentionally NOT automated in CI (live model inference is operator-only per plan.md "Testing") — they are recorded here so the binary exit trace is complete and reviewable.

### Live iteration 1 (FR-PILOT-001, FR-PILOT-005, SC-003)

- [ ] T027 [US1] Run `corpus pilot run --variant v1 --iteration 1` on `pai-node01` against live `qwen3:8b` + the SP-002 MCP server. Verify: harness completes with exit 0; `Paths.pilotTelemetry()/pilot-iter1.jsonl` contains exactly 50 lines, each a valid `nfr_008_pilot` event passing the registered Zod schema; `Paths.pilotTelemetry()/pilot-iter1-summary.json` is present and atomically written; summary `headline_n` is in `[0, 30]`; `model == "qwen3:8b"`. Capture wall-clock duration in PR comments. *Prereqs: T020, T021, T025, T026, all of Phase 3. FR-PILOT-001/005, SC-003; quickstart.md §1*

### Decision branch — iteration 1 ≥ 15 OR optional iteration 2 (FR-PILOT-004, FR-PILOT-014)

- [ ] T028 [US1] (Conditional, runs only if iteration 1 `headline_n` < 15) Run `corpus pilot run --variant v2-revised --iteration 2` with a revised prompt-variant hypothesis. Verify: harness writes `pilot-iter2.jsonl` + `pilot-iter2-summary.json`; iteration-1 artifacts (`pilot-iter1.jsonl` + `pilot-iter1-summary.json`) are unchanged on disk (FR-PILOT-014 retention); all four files coexist under `Paths.pilotTelemetry()`. If iteration 2 also lands `headline_n` < 15, decision must route to T030 (downgrade) or T031 (escalation). *Prereqs: T027. FR-PILOT-004/014; quickstart.md §4*

### Terminal artifact — binary exit closure (FR-PILOT-007, FR-PILOT-008, SC-001, SC-004, SC-005)

- [ ] T029 [US1] [US3] (Terminal artifact A — commit-final-N) If the latest iteration's `headline_n` ≥ 15, author and commit a new entry in `.product/ledgers/decisions.jsonl` with: `decision_id == "D-NNN"` (next free); `status == "accepted"`; `related_adr == "ADR-010"`; `requirement_updated == "NFR-008"`; `rationale` containing the verbatim `personal_scale_qualifier` from the summary AND a brief narrative citing iteration count + malformed-call rate + qualitative observations; `evidence_paths` listing `pilot-iter{1,2}.jsonl` + `pilot-iter{1,2}-summary.json` under `Paths.pilotTelemetry()`. Update `.product/REQUIREMENTS.yaml` NFR-008 floor with the committed N and `linked_decision: D-NNN`. Verify the entry passes the personal-scale-qualifier presence check (`grep -E 'qwen3:8b|personal-scale' .product/ledgers/decisions.jsonl`). Update `Pilot Run.terminal_artifact_id` references in PR commentary. *Prereqs: T027, T028 (conditional). FR-PILOT-007/008, SC-001/004; quickstart.md §3; pilot-harness.feature scenario "Pilot resolves via D-NNN commit-final-N entry (terminal artifact A)"*
- [ ] T030 [US1] [US3] (Terminal artifact B — NFR-008 downgrade; mutually exclusive with T029 and T031) If both iterations land `headline_n` < 15 AND Shon judges the local-LLM tool-use rate insufficient to defend at `priority: should`, author and commit a `decisions.jsonl` D-NNN entry that downgrades NFR-008 from `priority: should` to `priority: nice_to_have`. The entry cites ADR-010 §Decision binary exit constraint, lists both iteration telemetry + summary paths as evidence, carries the personal-scale qualifier in `rationale`. Update `.product/REQUIREMENTS.yaml` NFR-008 priority accordingly. *Prereqs: T028. FR-PILOT-007/008, SC-001/004; quickstart.md §5; pilot-harness.feature scenario "Pilot resolves via NFR-008 downgrade entry (terminal artifact B)"*
- [ ] T031 [US1] [US3] (Terminal artifact C — escalation to full SP-000; mutually exclusive with T029 and T030) If iteration signals are ambiguous enough that fuller coverage (Llama family + Qwen 2.5 family per ADR-005 alternative 1) is justified, author and commit a `decisions.jsonl` D-NNN entry escalating to full SP-000. The entry cites ADR-010 §Decision AND ADR-005 §Decision, lists both iteration telemetry + summary paths as evidence, carries the personal-scale qualifier in `rationale`, and triggers authoring of a new `specs/00X-nfr-008-pilot-extended/` feature for the larger pilot. SP-003 remains blocked until SP-000-extended completes. *Prereqs: T028. FR-PILOT-007/008, SC-001/004; quickstart.md §6; pilot-harness.feature scenario "Pilot resolves via full-SP-000 escalation entry (terminal artifact C)"*

### Sequencing verification (SC-005)

- [ ] T032 [US1] Manual sequencing verification (SC-005): confirm in PR commentary that no SP-003 (ingest) spec PR is opened until the terminal D-NNN entry from T029/T030/T031 is committed to `main`. This is an operator-discipline gate (matching SC-005's "Verifiable by sequencing" framing), NOT a CI-enforced rule — there is no GitHub Action or precommit hook implementing automatic rejection. If a CI gate is later desired, capture it as a separate task in a future PR. *Prereqs: T029 OR T030 OR T031. SC-005; pilot-harness.feature scenario "SP-003 (ingest) is blocked until binary exit closes"*

**Checkpoint**: ADR-010's binary exit gate is closed by exactly one terminal D-NNN entry (T029 OR T030 OR T031). SP-003 (ingest) is unblocked (if T029 or T030) or remains blocked (if T031). The pilot run record is complete: queries.yaml committed, both iteration telemetry + summary files retained on disk, D-NNN entry references them as evidence.

---

## Phase 5: Polish & cross-cutting concerns

**Purpose**: Verification of the constitutional + spec-coverage anchors that gate the feature's "done" definition, plus operator-facing documentation cleanup. No new behavior introduced.

- [ ] T033 [P] Verify Constitution Check Principle XIV is fully `[x]` (no remaining `[~]` entry): re-read plan.md §"Constitution Check", confirm Principle XIV's text is updated post-T003 to drop the `[~]` qualifier and now reads `[x]` with PREREQ-001 cited as merged. Commit the plan.md amendment in the same PR as T003 or as an immediate follow-up. *Prereqs: T003. Constitution XIV; plan.md §"Constitution Check"*
- [ ] T034 [P] Verify Constitution Check Principle XIII is fully `[x]` "schema-enforced" (no remaining "spirit-only" qualifier): re-read plan.md §"Constitution Check", confirm Principle XIII's text is updated post-T004 to drop the "spirit-only" qualifier and now reads `[x]` with PREREQ-002 cited as merged. *Prereqs: T004. Constitution XIII; plan.md §"Constitution Check"*
- [ ] T035 [P] [US3] Audit user-facing artifacts (CLI `--help` output, `packages/cli/src/pilot/README.md`, the D-NNN ledger entry from T029/T030/T031, the `.product/REQUIREMENTS.yaml` NFR-008 fields if modified) for personal-scale qualifier presence AND absence of industry-generalization phrasing. Use `grep -E 'industry-standard|benchmark floor|cross-model|cross-user|cross-machine'` across the artifacts; expect zero hits. Confirm each artifact carries `"qwen3:8b"` AND (`"personal"` OR `"Shon"`) inline. *Prereqs: T026, T029 OR T030 OR T031. FR-PILOT-008, SC-004, Constitution XVI; telemetry.feature scenario "D-NNN ledger entry inherits the qualifier verbatim"*
- [ ] T036 [P] Run `quickstart.md` end-to-end as documentation validation: verify §0 prerequisite checks all pass (with merged Phase 0 substrate), §1 iteration-1 invocation produces the documented artifact set, §2 summary interpretation matches the actual summary schema, §3/§4/§5/§6 terminal-artifact branches match the contract scenarios. Edit quickstart.md inline for any drift discovered. *Prereqs: T029 OR T030 OR T031. SC-001/003/004/005/006; quickstart.md (all sections)*
- [ ] T037 [P] Optional cleanup (user-driven, NOT automated): document in quickstart.md §7 (already present) that the harness MUST NOT delete iteration artifacts; record the manual cleanup procedure for after the D-NNN entry stabilizes. No code change. *Prereqs: T036. FR-PILOT-014; telemetry.feature scenario "Harness MUST NOT clean up iteration artifacts on its own"*

**Checkpoint**: Constitution Check is fully `[x]` across all 16 principles; personal-scale qualifier audit is green; quickstart.md is verified against actual behavior; the SP-000-lite feature is complete and the binary exit is discharged.

---

## Coverage matrix

### Functional Requirements

| FR-PILOT-* | Tasks |
|------------|-------|
| FR-PILOT-001 (50-query drive via qwen3:8b + SP-002 MCP) | T016, T024, T027 |
| FR-PILOT-002 (30/15/5 stratification) | T012, T013, T018, T020 |
| FR-PILOT-003 (3 retrieval patterns + worked examples) | T012, T018, T020 |
| FR-PILOT-004 (1 variant + ≤1 iteration; iteration 3+ forbidden) | T007, T016, T024, T025, T028 |
| FR-PILOT-005 (telemetry event schema + JSONL path) | T002, T004, T010, T022, T024, T027 |
| FR-PILOT-006 (Paths.* discipline; no hardcoded literals) | T001, T003, T011, T023, T024 |
| FR-PILOT-007 (one of three terminal artifacts) | T029, T030, T031 |
| FR-PILOT-008 (personal-scale qualifier in terminal artifact) | T014, T026, T029, T030, T031, T035 |
| FR-PILOT-009 (NO retrieval-quality harness — AG-005 binding) | enforced by scope-bound declaration at top; no positive task — verified by absence of relevance-judgment code paths |
| FR-PILOT-010 (curated 32-PDF substrate) | T020 (substrate enumeration consumed by queries.yaml); query-set.feature scenario "Substrate is the curated 32-PDF sampler..." |
| FR-PILOT-011 (KG mined from MEMORY/WORK; G+A hand-crafted) | T012, T018, T020 |
| FR-PILOT-012 (Q3 ratification gate) | T013, T019, T021 |
| FR-PILOT-013 (summary fields + soft-threshold flag) | T015, T023 |
| FR-PILOT-014 (iteration artifact retention) | T016, T024, T028, T037 |

### Success Criteria

| SC-* | Verification tasks |
|------|--------------------|
| SC-001 (binary exit closed by one terminal D-NNN entry) | T029 OR T030 OR T031, T032 |
| SC-002 (50-query set satisfies stratification rubric) | T012, T013, T018, T020 |
| SC-003 (50 events per iteration, zero dropped) | T010, T016, T024, T027 |
| SC-004 (personal-scale qualifier on terminal artifact) | T014, T026, T029/T030/T031, T035 |
| SC-005 (SP-003 unblocked only after binary exit closes) | T032 |
| SC-006 (all artifacts under Paths.*; no /tmp /var system paths) | T001, T003, T011, T023, T024 |

### Constitution principles touched (audit-trail completeness)

| Principle | Tasks |
|-----------|-------|
| V (schema-enforced structured output) | T002, T004, T010, T015, T018, T022, T023 |
| VII (cancellable, bounded IO) | T023, T024, T025 |
| VIII (atomic writes) | T023 |
| IX (concurrency-safe shared state; POSIX-atomic append) | T010, T024 |
| XI (library/CLI boundary — only CLI calls process.exit) | T024, T025 |
| XIII (telemetry-or-die; no swallow; severity-correct) | T002, T004, T010, T017, T022, T024, T034 |
| XIV (XDG paths via single resolver) | T001, T003, T011, T024, T033 |
| XVI (validation honesty; personal-scale qualifier) | T014, T026, T029/T030/T031, T035 |

---

## DAG sanity check

**PREREQ tasks and their immediate dependents:**

- **T001 (Paths.pilotTelemetry() contract test)** blocks: T003.
- **T002 (nfr_008_pilot event class contract test)** blocks: T004.
- **T003 (implement Paths.pilotTelemetry())** blocks: T005, T006, T011, T023, T024, T033.
- **T004 (register nfr_008_pilot event class)** blocks: T005, T006, T010, T022, T024, T034.

Effectively, NO task in Phase 1+ can begin until both T003 AND T004 are merged on `main`.

**Tasks with no prereqs other than the Phase 0 set (T001–T004):**

- T005 (create pipeline/pilot-harness/ dir), T006 (create cli/pilot/ dir), T008 (create test dirs), T009 (verify js-yaml dep) — all Phase 1 scaffolding tasks depending only on T003/T004.

This is small (4 tasks), which is expected — Phase 1 is intentionally thin scaffolding before the Tests-First phase opens up parallel work.

**Tasks with the most prereqs (DAG depth confirmation):**

- T029 / T030 / T031 (terminal artifact authoring): each depends on T027 (live iteration 1) and conditionally T028 (live iteration 2), each of which transitively depends on the full Phase 3 implementation (T018–T026), which in turn depends on Phase 2 contract tests (T010–T017), which in turn depends on Phase 1 scaffolding (T005–T009), which depends on Phase 0 prerequisites (T001–T004). Effective prereq closure for T029: ~26 transitive prereqs — confirms the DAG is the expected linear-with-parallel-branches shape (Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4), not a flat list.
- T032 (SC-005 sequencing verification): depends on whichever of T029/T030/T031 was authored. Final gate.

**Parallel opportunities within phases:**

- Phase 0: T001 ‖ T002 (both `[P]` — separate contract test files).
- Phase 1: T005 ‖ T006 ‖ T008 ‖ T009 (all `[P]` — different directories / files).
- Phase 2: T010 ‖ T011 ‖ T012 ‖ T013 ‖ T014 (all `[P]` — different test files); T015 co-located with T010 (no `[P]`); T016/T017 sequential within harness-loopback.test.ts.
- Phase 3: T018 → T019 sequential (same file `stratification.ts`); T020 ‖ T021 against the spec; T022 ‖ T023 (different files); T024 sequential after T022/T023; T025/T026 sequential after T024.
- Phase 4: T027 → T028 conditional → T029 XOR T030 XOR T031 → T032.
- Phase 5: T033 ‖ T034 ‖ T035 ‖ T036 ‖ T037 (all `[P]` — verification, no shared mutation).

---

## Implementation strategy

### Phase 0 first (load-bearing prerequisites)

1. Author T001 and T002 contract tests in parallel; verify both fail red.
2. Land T003 (`Paths.pilotTelemetry()`) and T004 (`nfr_008_pilot` Zod class) — ideally in a single PR or two tightly-sequenced PRs.
3. Phase 0 closes when both contract tests turn green AND plan.md §"Constitution Check" is updated post-merge to drop the `[~]` qualifier on Principle XIV (T033) and the "spirit-only" qualifier on Principle XIII (T034).

### Phase 1 → Phase 2 → Phase 3 (Tests-First TDD)

1. Phase 1 scaffolding lands in one parallel batch (T005–T009).
2. Phase 2 contract tests authored next (T010–T017), all observed to fail red before any Phase 3 task begins.
3. Phase 3 implementation tasks turn the Phase 2 tests green incrementally: linter (T018/T019) → query set (T020/T021) → event/summary/harness library (T022/T023/T024) → CLI surface (T025/T026).

### Phase 4 (operator-driven live execution)

1. T027 runs iteration 1 against live `qwen3:8b` on `pai-node01`.
2. Decision branch: T028 (iteration 2, conditional) → T029 OR T030 OR T031 (mutually exclusive terminal artifacts).
3. T032 confirms SC-005 sequencing.

### Phase 5 (polish)

Verification + documentation. No code change beyond the small plan.md amendments in T033/T034 and any quickstart.md drift fixes in T036.

---

## Anti-scope (locked by spec.md, plan.md, AG-005)

The following are EXPLICITLY out of scope for SP-000-lite. Tasks that would implement these are NOT enumerated above and MUST NOT be added under the cover of "polish" or "cross-cutting":

- Labeled retrieval evaluation harness, hit-rate metric, or relevance-judged dataset (OOS-012 / AG-005; deferred to v1.5+).
- Any modification to the SP-002 `corpus.find` tool or four `corpus://` resources (pilot is read-only against SP-002 surface).
- A new MCP tool, MCP resource, or public CLI verb beyond the `pilot run` subcommand.
- A second model beyond `qwen3:8b` (would invalidate ADR-010's basis; full-coverage requires escalation via T031 to a new SP-000-extended feature).
- Resumption from partial state, checkpoint/restore, or iteration ≥ 3 logic (forbidden by ADR-010 scope and FR-PILOT-004).
- Automated cleanup of `Paths.pilotTelemetry()` artifacts (forbidden by FR-PILOT-014; user-driven only per quickstart.md §7).
- Any cross-user, cross-machine, or cross-substrate claim in the terminal artifact (forbidden by Constitution XVI; enforced by T014 + T035).

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks.
- `[US1]` = User Story 1 (binary exit discharge); `[US2]` = User Story 2 (stratification rubric); `[US3]` = User Story 3 (personal-scale framing). A task may carry multiple story labels when it serves multiple stories (e.g., T025 / T026 / T029 / T030 / T031 carry both US1 and US3 because terminal-artifact authoring jointly discharges the binary exit AND inherits the personal-scale qualifier).
- All three user stories are P1 and share the pilot harness substrate; they are interleaved across phases rather than carved into per-story phases. This matches spec.md's user-story structure (no P2 stories exist for this feature).
- Phase 0 PREREQ tasks (T001–T004) are SP-001 substrate amendments authored in a separate PR (or tightly-sequenced PRs) BEFORE any Phase 1+ work; they discharge the `[~]` entry on Constitution Check Principle XIV and lift Principle XIII from "spirit-only" to "schema-enforced".
- Phase 4 live-execution tasks (T027–T032) are operator-driven on `pai-node01`, NOT automated in CI — captured as enumerated tasks here so the binary exit trace is complete and reviewable.
- Constitution Check (15 `[x]` + 1 `[~]` resolved by Phase 0) verified at plan time. No Complexity Tracking entries.
