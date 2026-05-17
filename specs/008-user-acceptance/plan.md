# Implementation Plan: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate — `engagement.*` Telemetry, `corpus accept`, `corpus engagement-proxy report`, UR-001/UR-002/UR-003 Acceptance Scenarios, C-046 End-to-End Smoke

**Branch**: `008-user-acceptance`
**Date**: 2026-05-17
**Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `specs/008-user-acceptance/spec.md`

## Summary

Ship the **user-acceptance closure** for the SP-001..SP-007 substrate: the four new `engagement.*` telemetry event classes (added additively to the existing `TelemetryEvent` discriminated union), the `corpus accept <request-id>` operator-attestation CLI subcommand (the D2 acceptance-event-definition decision per spec.md Clarifications block), the `corpus engagement-proxy report [--since=<ISO8601>] [--until=<ISO8601>] [--format=text|json] [--telemetry-log=<path>] [--timeout=<ms>]` aggregation CLI subcommand that computes the C-028 verdict (≥5 queries + ≥1 acceptance event in a 7-day window; KILL signal if queries < 3), UR-001 / UR-002 / UR-003 Gherkin scenarios tied to passing integration tests, the two SP-008-mandated adversary scenarios (empty-corpus + session-start idempotency), and the C-046 end-to-end smoke harness that spawns the production binary, generates synthetic engagement data via real MCP-stdio, runs the report, and asserts the match. **This plan is honest about the Track A / Track B split per Constitution XVI**: Track A (code) is what this sprint SHIPS — telemetry instrumentation, two CLI subcommands, integration + adversary + e2e tests; Track B (operator action) is what this sprint TESTS AGAINST — the 7-day calendar dogfood window during which Shon-as-Maya uses the installed substrate naturally, generating real queries, issuing real `corpus accept` attestations, and at end-of-window running the report whose verdict (PASS or FAIL or KILL) is captured in `specs/008-user-acceptance/RETROSPECTIVE.md` as evidence of the SPRINT-PLAN.yaml line 248 exit criterion. **Track A PR-merge can occur on Track A test pass; SP-008 sprint-completion (PM-Review approved sprint outcome per SPRINT-PLAN.yaml line 251) requires the Track B verdict.** SP-008 ships ZERO new MCP mutation surfaces (Principle III), ZERO new SQL tables (Principle X stability + spec.md FR-ENGAGEMENT-014), ZERO new `Paths.*` getters (Principle XIV + FR-ENGAGEMENT-020), ZERO new outbound non-loopback endpoints (Principle I + FR-ENGAGEMENT-015). SP-008 inherits SP-007's two deferrals: C-043 (`signals_used: []` reporting bug) and C-044 (`regenerateCatalogFromDb` summary column); both remain post-v1 polish PR work per FR-ENGAGEMENT-024.

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode). Node.js 20 LTS primary, 22 LTS forward-compatible. Inherits SP-001..SP-007 toolchain unchanged; SP-008 introduces ZERO new toolchain dependencies.

**Primary Dependencies** (additive over SP-001..SP-007 — every dependency is already in the workspace):

- `zod ^3.23.0` (existing) — `EngagementCorpusFindInvokedEventZodSchema`, `EngagementAcceptanceEventZodSchema`, `EngagementReportGeneratedEventZodSchema`, `EngagementReportTelemetryParseFailedEventZodSchema` (four new `engagement.*` event variants); `AcceptArgsZodSchema`, `EngagementProxyReportArgsZodSchema`, `EngagementProxyReportZodSchema` (CLI argv + JSON-output schemas). All seven schemas live in `packages/contracts/src/engagement.ts` (NEW file). The four event schemas are added to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (additive variants).
- `node:fs/promises` + `node:fs` (built-in) — telemetry log read (line-by-line via `readline`-on-stream pattern matching SP-007's `failures-resource-handler.ts` use); telemetry append via the EXISTING SP-003 atomic-append helper (NOT duplicated). The report's reader iterates `Paths.telemetry()` + any rotated logs whose mtime falls in the window (SP-003 rotation convention).
- `node:crypto` (built-in) — `randomUUID()` for the new `request_id` generated at `corpus.find` tool-handler entry (see Decision A in research.md), and `createHash('sha256')` for the `query_hash` field on `engagement.corpus_find_invoked` (consistent with the existing SP-005 `query_hash` field on `search.query`).
- Existing `emitTelemetry()` helper from `@llm-corpus/contracts` — sole telemetry write path; the four new `engagement.*` events route through it. ZERO duplication of telemetry-write logic.
- Existing `Paths.*` getter surface — ZERO new getters in SP-008. The engagement layer reads from `Paths.telemetry()` (SP-003) and uses no other path source.
- Built-in arg parsing — SP-008 extends the EXISTING `packages/cli/src/index.ts` subcommand dispatcher (which currently routes `init`, `uninstall`, `taxonomy promote`, `mcp`, `daemon`, `drain`, `reenrich`, `reindex`, `failures`) with two new verbs: `accept` and `engagement-proxy report`. No `commander` / `yargs` dependency.

**Storage**: SP-008 introduces ZERO new SQL tables and ZERO new `Paths.*` getters. The four new `engagement.*` event classes append to the existing `Paths.telemetry()` NDJSON log via the SP-003 atomic-append discipline (Constitution VIII + IX; ≤ 4 KB per line per Principle IX). The operator-attested acceptance state is a forward-only append to the same telemetry log keyed by `request_id` — **NOT a sidecar file under `Paths.state()/engagement/<request_id>.json` and NOT a new SQL table**. See research.md Decision B for the full storage decision + rationale + alternatives rejected.

The `corpus accept` write goes through `emitTelemetry()` (no new write surface). The `corpus engagement-proxy report` read is a read-only line-by-line scan of the telemetry log (and rotated logs in the window); the report does NOT acquire `Paths.drainLock()` (telemetry is append-only and tolerates concurrent readers + writers — SP-003 contract).

**Testing**: vitest (inherits SP-001..SP-007). New SP-008 test surfaces:

- (a) `tests/unit/engagement-schemas.test.ts` — Zod round-trip for `EngagementCorpusFindInvokedEventZodSchema`, `EngagementAcceptanceEventZodSchema`, `EngagementReportGeneratedEventZodSchema`, `EngagementReportTelemetryParseFailedEventZodSchema`, `AcceptArgsZodSchema`, `EngagementProxyReportArgsZodSchema`, `EngagementProxyReportZodSchema`; assertion that all four new event variants appear in the `TelemetryEvent` discriminated union; query-truncation contract verified (1024-char cap + `query_truncated: true` + `query_hash`).
- (b) `tests/unit/engagement-find-instrumentation.test.ts` — at the `corpus-find-tool` handler boundary, every successful `corpus.find` invocation emits an `engagement.corpus_find_invoked` event in addition to the existing `search.query` event; both events share the same `request_id` (the new field on the find handler, see Decision A); `result_count`, `tier_used`, `duration_ms` populate correctly.
- (c) `tests/unit/engagement-accept-args.test.ts` — Zod parsing of `<request-id>` positional + `--note <text>` flag; UUID validation; note-length cap (≤ 512 chars) enforced; oversize note rejected at Zod boundary.
- (d) `tests/unit/engagement-accept-writer.test.ts` — `corpus accept` (i) finds the matching `engagement.corpus_find_invoked` event in the telemetry log; (ii) rejects unknown `request_id` with non-zero exit + clear error; (iii) rejects zero-result query (`result_count == 0`) with non-zero exit; (iv) idempotent on duplicate (second invocation prints "already accepted: <id> at <ts>" + exits 0; no duplicate event in log); (v) appends well-formed `engagement.acceptance_event` to `Paths.telemetry()` via `emitTelemetry()`.
- (e) `tests/unit/engagement-telemetry-scanner.test.ts` — the report's line-by-line reader (i) parses well-formed lines via Zod; (ii) skips malformed lines + counts in `parse_errors_count` + emits `engagement.report_telemetry_parse_failed`; (iii) respects `since/until` filter (UTC-normalized ISO-8601 comparison); (iv) iterates rotated logs whose mtime falls in the window per the SP-003 rotation convention; (v) accepts AbortSignal and aborts mid-scan on SIGINT; (vi) bounded-by-timeout via `setTimeout + clearTimeout + controller.abort()` (NEVER `Promise.race(setTimeout)`).
- (f) `tests/unit/engagement-report-aggregator.test.ts` — given a synthetic event stream, computes `queries_in_window`, `acceptance_events_in_window`, `c028_threshold_met`, `kill_signal`, `verdict`, the informational aggregates (median/p95 latency, tier distribution, zero-result query count, distinct-query-hash count). Deterministic input → deterministic output.
- (g) `tests/unit/engagement-report-verdict.test.ts` — verdict table cases: (i) PASS — 5q + 1a; (ii) FAIL non-KILL — 5q + 0a (≥ 3 query floor cleared, no acceptance); (iii) FAIL KILL — 2q + 0a (< 3 query floor); (iv) FAIL non-KILL — 3q + 0a (≥ 3 floor cleared but < 5 query gate); (v) empty log → FAIL KILL (0q + 0a).
- (h) `tests/unit/engagement-report-json-shape.test.ts` — the `--format=json` output Zod-validates against `EngagementProxyReportZodSchema` for all five verdict cases; includes `schema_version: 1`, `c028_threshold`, `kill_signal_threshold` for downstream tooling.
- (i) `tests/unit/engagement-report-cli-args.test.ts` — Zod parsing of `--since/--until/--format/--telemetry-log/--timeout`; defaults applied (since = now-7d; until = now; format = text; telemetry_log = Paths.telemetry(); timeout = 30000); invalid ISO-8601 rejected; future `--until` accepted (no upper bound).
- (j) **`packages/cli/test/ur-001-acceptance.test.ts`** — UR-001 integration: drop fixture document → wait for `edges-build.completed` telemetry → invoke `corpus.find` via real MCP-stdio → assert ≥ 1 SearchHit; per FR-ENGAGEMENT-007 Gherkin in execution-journal.md (3 scenarios: happy-path, proposed-term routing, validation failure to `Paths.failed()`).
- (k) **`packages/cli/test/ur-002-acceptance.test.ts`** — UR-002 integration: simulated agent flow against the production MCP server with the SP-002 FR-009 retrieval-prompt template loaded (per FR-ENGAGEMENT-008); 3 scenarios: agent invokes `corpus.find` + grounds answer with traceable references, agent does NOT fabricate corpus citations on empty-corpus, cross-document grounding works when SearchHits span multiple documents.
- (l) **`packages/cli/test/ur-003-acceptance.test.ts`** — UR-003 integration: install + ingest N=5 → close session → fresh session start → assert `corpus://manifest` returns doc_count == N + `taxonomy_terms` unchanged + ZERO `ingest.normalized` events fire in the second session; the session-doesn't-duplicate scenario IS the FR-ENGAGEMENT-011 adversary integration test (shared harness with the session-start idempotency adversary).
- (m) **`packages/cli/test/empty-corpus-adversary.test.ts`** — FR-ENGAGEMENT-010 adversary: fresh `corpus init` with NO documents → daemon up → `corpus.find` via real MCP-stdio with 5 distinct query shapes (single-word, multi-word, special-chars, empty-string, very-long) → assert `hits: []` AND no `corpus://docs/...` URIs anywhere AND no `citations` field (or `citations: []`) for each.
- (n) **`packages/cli/test/session-start-idempotency-adversary.test.ts`** — FR-ENGAGEMENT-011 adversary: fresh install → drop N=5 documents → wait for all 5 to `edges-build.completed` → record `count(*) from documents == 5` → kill daemon → restart daemon (second session-start with identical inbox) → wait 30 s for any spurious processing → re-record count → assert (i) unchanged at 5, (ii) `ingest.dedup_hit` fired for all 5, (iii) ZERO `ingest.normalized`/`classify.completed`/`embed.completed`/`index.completed`/`edges.completed` events fired in the second session for those 5 files.
- (o) **`packages/cli/test/engagement-proxy-e2e.test.ts` — C-046 end-to-end smoke (per dispatch prompt mandate + FR-ENGAGEMENT-006)**. Builds the CLI via `pnpm build`; spawns the BUILT binary `node <dist>/bin/corpus.js init --smoke` with `CORPUS_HOME=<tempdir>`; the install's smoke seeds a deterministic document; spawns `corpus daemon`; spawns 5 separate `corpus mcp`-mediated `corpus.find({query: <fixture-queries>})` calls via real MCP-stdio (NOT library-level handler tests); for one of the returned hits, runs `corpus accept <request-id>` via the production binary; runs `corpus engagement-proxy report --format=json --since=<window-start>`; parses the JSON; asserts `{verdict: "PASS", queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true}`. Conditionally skipped when Ollama is absent (with a clear `it.skipIf(!ollamaReachable)` annotation + log line); runs unconditionally locally with Ollama. **This is the SP-006 retrospective F-1 transport-cutover-gap closer for the engagement layer — no library-level handler test is sufficient.**

**Target Platform**: Linux (Fedora 43+ baseline; tested on pai-node01) and macOS (Apple Silicon + Intel — Big Sur+). Windows OUT OF SCOPE for v1 — SP-008 inherits SP-007's platform commitments; SP-008 adds ZERO new platform-specific code paths (the engagement-proxy layer is pure JS reading a JSON-Lines file).

**Project Type**: TypeScript monorepo (npm workspaces). SP-008 extends two existing packages and adds ZERO new packages:

- `packages/contracts/` — adds `engagement.ts` (NEW file): 4 new event-class Zod schemas (`EngagementCorpusFindInvokedEventZodSchema`, `EngagementAcceptanceEventZodSchema`, `EngagementReportGeneratedEventZodSchema`, `EngagementReportTelemetryParseFailedEventZodSchema`); 3 CLI/report schemas (`AcceptArgsZodSchema`, `EngagementProxyReportArgsZodSchema`, `EngagementProxyReportZodSchema`). Extends `telemetry.ts` with the 4 new event variants added to the `TelemetryEvent` discriminated union (additive — the SP-007 12-class addition pattern). Extends `errors.ts` with 5 new typed errors (`EngagementProxyTelemetryParseError`, `EngagementProxyWindowInvalidError`, `AcceptUnknownRequestIdError`, `AcceptZeroResultQueryError`, `AcceptDuplicateRequestIdError` — informational, not failure). Extends `index.ts` with re-exports.
- `packages/cli/` — adds `src/accept-command.ts` (NEW CLI entry point — the ONLY layer permitted to `process.exit` for the accept flow per Constitution XI); adds `src/engagement-proxy-command.ts` (NEW CLI entry point for the report flow); adds `src/engagement/` directory with library helpers (`telemetry-log-scanner.ts`, `report-aggregator.ts`, `verdict-computer.ts`, `acceptance-event-writer.ts`, `accept-args-parser.ts`, `engagement-proxy-report-args-parser.ts`, `report-renderer-text.ts`, `report-renderer-json.ts`). Extends `src/index.ts` subcommand dispatcher with the `accept` + `engagement-proxy` verbs (the existing 9 verbs unchanged).
- `packages/transport/` — minimal touch: `corpus-find-tool.ts` is wrapped to generate a `request_id: randomUUID()` per invocation, emit the new `engagement.corpus_find_invoked` event after the existing `search.query` event, and (for operator UX) print the `request_id` to stderr when invoked via the CLI mediator (NOT inside the MCP-stdio response — that would change the SP-005 SearchOutput contract). See research.md Decision A.

No new package directory. The substrate packages (`daemon`, `index`, `inference`, `pipeline`, `storage`) are untouched by SP-008.

**Reasoning**: a separate `packages/engagement/` was considered and rejected — the engagement layer is operationally bound to two CLI verbs that share no API surface with any other package; the helpers are internal to the CLI. The contracts-layer schemas live in `packages/contracts/src/engagement.ts` for symmetry with `packages/contracts/src/install-schemas.ts` (the SP-007 pattern). The substrate-package discipline ("each package has ZERO new MCP surfaces") is preserved by keeping SP-008 entirely in `packages/cli/` + `packages/contracts/` + a minimal additive emit in `packages/transport/`.

**Performance Goals** (TARGETS per Constitution XVI, not guarantees; empirical p95s recorded post-implementation):

| Operation | Target p95 | Honest commitment | Measurement |
|---|---|---|---|
| `corpus accept <request-id>` (read existing event + append) | ≤ 50 ms | ≤ 200 ms | wall-clock `time` |
| `corpus engagement-proxy report` on 7-day log (typical ~ 1-5 MB telemetry) | ≤ 500 ms | ≤ 2 s | wall-clock `time` |
| `corpus engagement-proxy report` on 30-day log (~ 10-20 MB) | ≤ 2 s | ≤ 5 s | wall-clock `time` |
| Scanner throughput (lines parsed per second) | ≥ 50k lines/s | ≥ 20k lines/s | fixture timing |
| `engagement.corpus_find_invoked` emit overhead (per `corpus.find` call) | ≤ 5 ms | ≤ 20 ms | unit timing |
| `corpus engagement-proxy report --timeout=<ms>` SIGINT response | ≤ 100 ms after SIGINT | ≤ 500 ms | signal-injection test |
| **C-046 end-to-end smoke** | ≤ 60 s | ≤ 90 s | wall-clock `time` |

**Constraints** (every constraint binds a constitutional principle):

- **Zero outbound non-loopback endpoints** introduced by SP-008 at runtime (Constitution I, hard — `corpus accept` and `corpus engagement-proxy report` are local-only file IO; the existing SP-001 `no-forbidden-network-imports` ESLint rule scopes over SP-008 source). The new `engagement.corpus_find_invoked` event fires inside the same handler that already runs the local hybrid retriever — ZERO new outbound calls.
- **Zero new MCP mutation surfaces** (Constitution III, hard — `corpus accept` and `corpus engagement-proxy report` are CLI subcommands, NOT MCP tools or resources; the SP-001 `corpus.find` tool is unchanged in shape — only its telemetry surface expands; the SP-002 + SP-006 read-only resources are unchanged).
- **Zero new SQL tables** (FR-ENGAGEMENT-014 + Constitution X stability — the substrate schema is frozen post-SP-006; all `engagement.*` state lives in the existing NDJSON telemetry log).
- **Zero new `Paths.*` getters** (Constitution XIV + FR-ENGAGEMENT-020 — SP-008 reuses `Paths.telemetry()`; verified by `git diff main -- packages/contracts/src/paths.ts` returning no new exports).
- **Every IO call accepts AbortSignal and propagates it** (Constitution VII, hard — the telemetry-log scanner, the accept-event writer, the report aggregator all accept `signal: AbortSignal`; SIGINT propagates; `setTimeout + clearTimeout + controller.abort()` is the bounded-IO pattern; NEVER `Promise.race(setTimeout)`).
- **Every state transition emits a Zod-validated telemetry event** (Constitution XIII, hard — 4 new event classes in SP-008; every catch block emits before returning or re-throwing; the existing AST-level lint covers SP-008 source).
- **No subprocess invocations** in SP-008 source beyond what already exists (Constitution XII — N/A for SP-008; the `corpus accept` + report CLIs are pure-JS; the C-046 e2e smoke spawns the production binary via the existing test-harness `runTool()` arg-array pattern, NOT shell strings).
- **No `process.exit` outside `packages/cli/src/accept-command.ts` and `packages/cli/src/engagement-proxy-command.ts`** (Constitution XI, hard — library helpers under `packages/cli/src/engagement/` return `Result<T, E>` or throw typed errors; the SP-001 `no-process-exit-in-libs` ESLint rule scopes over SP-008 source).
- **Telemetry records ≤ 4096 bytes** (Constitution IX, hard — the `query` field is truncated to 1024 chars + `query_truncated: true` + `query_hash: SHA-256-hex`; the `acceptance_note` field is capped at 512 chars; the JSON report's per-line overhead is bounded by the schema).
- **No regex-extraction from free-form text** (Constitution V — every telemetry line read is Zod-parsed; every report-output line written is Zod-validated; the only string-level operation is the NDJSON line split).
- **Track A / Track B split is surfaced verbatim** in (i) this plan.md, (ii) the spec.md, (iii) the upcoming tasks.md, (iv) every engineer brief during `/speckit-implement`, (v) the PR description, (vi) the RETROSPECTIVE.md, (vii) the `corpus engagement-proxy report` text-format header banner (Constitution XVI + FR-ENGAGEMENT-022 + FR-ENGAGEMENT-023; SC-008-034).

**Scale/Scope**:

- Single user, single machine (Constitution IV).
- Net new code: **~800-1200 LOC implementation, ~1000-1500 LOC tests + fixtures**. Estimate breakdown: ~150 LOC `engagement.ts` schemas; ~80 LOC `accept-command.ts`; ~120 LOC `engagement-proxy-command.ts`; ~400-600 LOC `engagement/` helpers (scanner + aggregator + verdict + writer + arg parsers + renderers); ~50 LOC `corpus-find-tool.ts` wrapper; ~30 LOC `telemetry.ts` extension; ~30 LOC `errors.ts` extension; ~20 LOC `index.ts` dispatcher extension; ~50 LOC `contracts/src/index.ts` re-exports. Tests: ~9 unit test files × ~80 LOC each + 5 integration test files × ~150 LOC each + 1 e2e smoke harness × ~250 LOC = ~1700 LOC tests; fixtures ~100 LOC.
- Net new files: 9 source files (1 contracts schema file, 2 CLI command files, 6 engagement-helpers files); 1 `corpus-find-tool.ts` extension (additive emit); ~9 unit test files + 5 integration test files + 1 e2e harness = ~15 test files.
- Per-feature contract files: **2 NEW ADRs** (ADR-016 acceptance-event-definition, ADR-017 engagement-proxy aggregation contract); **0 amended ADRs**; **0 superseded ADRs** (purely additive — the SP-005..SP-007 ADRs are unchanged).

**Sizing call**: SP-008 is well **below** the `feedback-build-tier-sizing-rule` 2000-LOC / 15-file pre-split threshold. Production surface alone (~800-1200 LOC across ~10 source files) is comfortably under. Total surface with tests + fixtures is ~2500-3000 LOC across ~25 files. **Recommend single-phase build** when `/speckit-implement` runs, with `/simplify` + `feature-dev:code-reviewer` review before merge. The contracts landings (`packages/contracts/src/engagement.ts` + `telemetry.ts` extension + `errors.ts` extension + `index.ts` re-exports) are the first build step (PREREQs landed before CLI work compiles).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be `[x]` for the plan to merge unchallenged.

- [x] **I. Local-First, No Egress** — SP-008 introduces ZERO new outbound non-loopback endpoints. `corpus accept` and `corpus engagement-proxy report` are local-only: the accept CLI reads + appends `Paths.telemetry()` via `emitTelemetry()`; the report CLI reads `Paths.telemetry()` line-by-line + any rotated logs in the window. No network calls. No telemetry shipping. No remote aggregation. SP-001 `no-forbidden-network-imports` ESLint rule scopes over SP-008 source. SC-008-028 + FR-ENGAGEMENT-015 verification path.
- [x] **II. User Curates, LLM Classifies Metadata** — SP-008 introduces ZERO LLM body-generation. The operator's `corpus accept` attestations are human-curated free-text notes (≤ 512 chars). No LLM-generated content is written to the canonical store; no `synthesis/` namespace; no forbidden frontmatter fields. The classifier + embedder are unchanged from SP-004 / SP-005.
- [x] **III. Substrate, Not Surface** — SP-008 introduces ZERO new MCP mutation surfaces and ZERO new MCP read surfaces. `corpus accept` and `corpus engagement-proxy report` are CLI subcommands, NOT MCP tools or resources. The existing SP-001 `corpus.find` tool is unchanged in shape (only its telemetry surface expands — additive Zod-validated emit). The SP-002 four resources + SP-006 `corpus://failures` are unchanged. No HTTP server. No TUI. No browser. No graphical output. SC-008-029 + FR-ENGAGEMENT-013 verification path.
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — The Maya engagement-proxy aggregates a single operator's queries on a single machine. Spec.md Assumptions block records this explicitly (Shon-as-Maya during the dogfood window on pai-node01). No multi-user. No cross-machine sync. No SaaS connector. No conversation memory. No permissions / roles.
- [x] **V. Schema-Enforced Structured Output** — Every SP-008 telemetry event, CLI argv, and JSON output is Zod-validated. The four new `engagement.*` event variants Zod-validate at emit time (via the `TelemetryEvent` discriminated union); `EngagementProxyReportZodSchema` validates the `--format=json` output at emit time; `AcceptArgsZodSchema` + `EngagementProxyReportArgsZodSchema` validate argv at parse time; every telemetry line read by the scanner is Zod-parsed before counting (no count from raw lines). The discriminated union remains exhaustive. SC-008-030 + FR-ENGAGEMENT-004 + FR-ENGAGEMENT-012 + FR-ENGAGEMENT-018 verification path.
- [x] **VI. One Pipeline, Two Policies** — The C-046 end-to-end smoke harness (FR-ENGAGEMENT-006) invokes the SAME `ingestStage` / `classifyStage` / `embedStage` / `indexStage` / `edgesBuildStage` pipeline that production uses; the UR-001 / UR-002 / UR-003 integration tests run against the production binary in a fixture HOME. No per-test stub pipeline. No fork of the pipeline. One pipeline; smoke uses `batchPolicy` (per SP-003 daemon-policy contract). UR-002 specifically loads the production SP-002 FR-009 retrieval-prompt template — no test-only template.
- [x] **VII. Cancellable, Bounded IO** — Every SP-008 IO operation accepts `AbortSignal`. The report's telemetry-log scanner accepts `signal: AbortSignal` + iterates line-by-line with periodic abort-check; the per-invocation timeout (`--timeout=<ms>`, default 30000) is enforced via `setTimeout(() => controller.abort('engagement_report_timeout'), timeoutMs) + clearTimeout(handle)` (NEVER `Promise.race(setTimeout)` — Constitution VII forbidden pattern). SIGINT propagates through the master AbortSignal; mid-scan abort exits non-zero with a clear-remediation message. SC-008-031 + FR-ENGAGEMENT-016 verification path.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — The four new `engagement.*` events are appended to `Paths.telemetry()` via the EXISTING SP-003 atomic-append discipline (Constitution VIII + IX; ≤ 4 KB per line). The `corpus accept` write goes through the same atomic-append path (no new write surface; reuses `emitTelemetry()` from `@llm-corpus/contracts`). The report's JSON output is written to stdout (process-level — no atomic discipline needed; the file is the OS pipe). No SQL writes in SP-008 — the substrate schema is frozen.
- [x] **IX. Concurrency-Safe Shared State** — The new `engagement.*` events use the EXISTING SP-003 atomic-append discipline (no `Paths.drainLock()` needed for telemetry-log appends; the log is append-only and tolerates concurrent writers per the SP-003 contract). The report reader does NOT acquire `Paths.drainLock()` — it is a read-only scan (Constitution III substrate reads are non-blocking; SP-006 contract preserved). The `corpus accept` write does NOT acquire the drain-lock — it is also an atomic append. Telemetry JSONL records ≤ 4 KB per record (the `query` field is bounded at 1024 chars; the `acceptance_note` field is bounded at 512 chars; the JSON report's per-event payload is bounded by the schema). Constitution IX hard.
- [x] **X. Idempotent Pipeline Transitions** — `corpus accept` is idempotent (FR-ENGAGEMENT-002 + SC-008-010): a duplicate `corpus accept <same-request-id>` invocation detects the prior `engagement.acceptance_event` in the telemetry log, prints `"already accepted: <request-id> at <ts>"`, exits 0, appends NO duplicate event. `corpus engagement-proxy report` is idempotent (read-only — running it repeatedly produces a fresh verdict for the named window without mutating state). The four `engagement.*` events themselves are NOT pipeline transitions — they are observability emissions; idempotency at the event-class level means duplicate events with the same `request_id` are tolerated by the aggregator (the aggregator deduplicates by `request_id` per the FR-ENGAGEMENT-003 contract). FR-ENGAGEMENT-002 + Constitution X verification path.
- [x] **XI. Library/CLI Boundary** — `process.exit` appears only in `packages/cli/src/accept-command.ts` and `packages/cli/src/engagement-proxy-command.ts`. Library helpers under `packages/cli/src/engagement/` (`telemetry-log-scanner.ts`, `report-aggregator.ts`, `verdict-computer.ts`, `acceptance-event-writer.ts`, `accept-args-parser.ts`, `engagement-proxy-report-args-parser.ts`, `report-renderer-text.ts`, `report-renderer-json.ts`) return `Result<T, E>` or throw typed errors (`EngagementProxyTelemetryParseError`, `EngagementProxyWindowInvalidError`, `AcceptUnknownRequestIdError`, `AcceptZeroResultQueryError`, `AcceptDuplicateRequestIdError`). The SP-001 `no-process-exit-in-libs` ESLint rule is scoped over SP-008 source. SC-008-032 + FR-ENGAGEMENT-017 verification path.
- [x] **XII. Subprocess Hygiene** — N/A for SP-008's runtime CLIs (no subprocess invocations from `accept` or `engagement-proxy report` — both are pure-JS local file IO). The C-046 end-to-end smoke harness (FR-ENGAGEMENT-006) spawns the production binary via `node <dist>/bin/corpus.js` using the EXISTING test-harness `runTool()` pattern with arg arrays (no shell strings). The SP-001 `no-shell-string-exec` lint scopes over SP-008 source — passes vacuously (no new subprocess sites).
- [x] **XIII. Telemetry-or-Die** — SP-008 introduces 4 new telemetry event classes (`engagement.corpus_find_invoked`, `engagement.acceptance_event`, `engagement.report_generated`, `engagement.report_telemetry_parse_failed`); every catch block in SP-008 source emits a telemetry event before returning or re-throwing (the existing AST-level lint covers SP-008 source). Each event Zod-validates against the `TelemetryEvent` discriminated union (additive variants). Telemetry NEVER includes secrets. SC-008-033 + FR-ENGAGEMENT-019 verification path.
- [x] **XIV. XDG Paths via Single Resolver** — SP-008 reuses `Paths.telemetry()` (SP-003); ZERO new `Paths.*` getters (verified by `git diff main -- packages/contracts/src/paths.ts` returning no new exports). The `--telemetry-log=<path>` CLI flag accepts an operator-supplied override (used by Track A's fixture tests against a tempdir log) — the override is parsed via Zod, validated as an existing readable file path, and NEVER written to a `Paths.*` location implicitly; the operator owns the override path's location. The `paths-from-resolver-only` lint scopes over SP-008 source. SC-008-031 + FR-ENGAGEMENT-014 + FR-ENGAGEMENT-020 verification path.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — SP-008 does NOT touch the taxonomy promotion mechanism. The SP-007 `corpus taxonomy promote` CLI is the canonical surface; SP-008 measures engagement, not vocabulary. No hardcoded `enum FacetDomain`. No auto-promotion. No new user-review queue.
- [x] **XVI. Validation Honesty** — The Track A / Track B split is surfaced verbatim in the spec.md, in this plan.md (Summary + FR-ENGAGEMENT-022 + Constitution Check), in the upcoming tasks.md, in the engineer briefs, in the PR description, in the RETROSPECTIVE.md, and in the `corpus engagement-proxy report --format=text` header banner (the banner names "Maya Week-1 engagement-proxy per C-028" and labels the verdict as a Track B measurement). Code completion does NOT equal user-acceptance completion. The 7-day dogfood window is a real wall-clock dependency. Track B's verdict is the sprint's user-acceptance evidence per the PM-Review gate. No cross-agent compatibility marketing (SP-008 measures Claude Code's `corpus.find` invocations only, per spec.md Out of Scope). No formal eval harness as v1 success criterion. The C-046 smoke is the substantive runtime gate; the Track B 7-day window is the user-acceptance gate. SC-008-034 + SC-008-035 + FR-ENGAGEMENT-022 + FR-ENGAGEMENT-023 verification path.

**Result**: 16/16 [x]. Complexity Tracking: empty.

## Project Structure

### Documentation (this feature)

```
specs/008-user-acceptance/
├── plan.md                  # This file (/speckit-plan command output)
├── research.md              # Phase 0 output (/speckit-plan command)
├── data-model.md            # Phase 1 output (/speckit-plan command)
├── contracts/               # Phase 1 output (/speckit-plan command)
│   ├── adr-acceptance-event-definition.md      # ADR-016 — operator-attested D2 decision formalized
│   └── adr-engagement-proxy-aggregation.md     # ADR-017 — aggregation contract + report JSON schema + C-028 threshold semantics
├── checklists/
│   └── requirements.md       # Already authored at /speckit-specify
├── execution-journal.md      # Produced during SP-008 build per FR-ENGAGEMENT-007..011 (UR-001/UR-002/UR-003 + adversary Gherkin scenarios + e2e smoke evidence)
├── RETROSPECTIVE.md          # Produced at sprint close — captures Track B verdict (SC-008-035)
├── quickstart.md             # Operator walkthrough (drop → query → accept → report) — produced post-/speckit-tasks
└── tasks.md                  # Phase 2 output (/speckit-tasks command — NOT created by /speckit-plan)
```

### Source Code (repository root)

```
packages/
├── contracts/
│   └── src/
│       ├── engagement.ts                  # NEW — 4 event-class Zod schemas + 3 CLI/report Zod schemas
│       ├── telemetry.ts                   # EXTENDED — 4 new event variants additively in TelemetryEvent discriminated union
│       ├── errors.ts                      # EXTENDED — 5 new typed errors (EngagementProxyTelemetryParseError, EngagementProxyWindowInvalidError, AcceptUnknownRequestIdError, AcceptZeroResultQueryError, AcceptDuplicateRequestIdError)
│       └── index.ts                       # EXTENDED — re-exports of engagement schemas + new error classes
├── cli/
│   ├── src/
│   │   ├── index.ts                       # EXTENDED — subcommand dispatcher adds `accept` + `engagement-proxy` verbs (existing 9 verbs unchanged)
│   │   ├── accept-command.ts              # NEW — `corpus accept <request-id>` CLI entry point; THE ONLY layer permitted to process.exit for accept flow
│   │   ├── engagement-proxy-command.ts    # NEW — `corpus engagement-proxy report` CLI entry point; THE ONLY layer permitted to process.exit for report flow
│   │   └── engagement/
│   │       ├── telemetry-log-scanner.ts        # NEW — line-by-line read of Paths.telemetry() + rotated logs; AbortSignal-bounded; Zod-parse each line; emit engagement.report_telemetry_parse_failed on malformed lines
│   │       ├── report-aggregator.ts            # NEW — given filtered event stream, computes queries_in_window + acceptance_events_in_window + informational aggregates (median + p95 latency, tier distribution, zero-result count, distinct query_hash count)
│   │       ├── verdict-computer.ts             # NEW — computes c028_threshold_met + kill_signal + verdict from aggregated counts per the FR-ENGAGEMENT-005 threshold table
│   │       ├── acceptance-event-writer.ts      # NEW — find matching engagement.corpus_find_invoked event by request_id; reject unknown/zero-result; idempotent on duplicate; append engagement.acceptance_event via emitTelemetry()
│   │       ├── accept-args-parser.ts           # NEW — Zod-parse argv against AcceptArgsZodSchema (UUID + optional --note ≤ 512 chars)
│   │       ├── engagement-proxy-report-args-parser.ts  # NEW — Zod-parse argv against EngagementProxyReportArgsZodSchema (since/until/format/telemetry-log/timeout)
│   │       ├── report-renderer-text.ts         # NEW — human-readable text format with the Track A/B banner per Constitution XVI + SC-008-034
│   │       └── report-renderer-json.ts         # NEW — JSON format validated against EngagementProxyReportZodSchema; schema_version: 1
│   └── test/
│       ├── ur-001-acceptance.test.ts           # NEW — UR-001 happy-path + proposed-term + validation-failure scenarios (FR-ENGAGEMENT-007)
│       ├── ur-002-acceptance.test.ts           # NEW — UR-002 grounded-answer + no-fabrication + cross-document scenarios (FR-ENGAGEMENT-008)
│       ├── ur-003-acceptance.test.ts           # NEW — UR-003 cross-session + no-duplicate + pre-init-error scenarios (FR-ENGAGEMENT-009; shares harness with session-start adversary)
│       ├── empty-corpus-adversary.test.ts      # NEW — empty-corpus adversary, 5 query shapes (FR-ENGAGEMENT-010)
│       ├── session-start-idempotency-adversary.test.ts  # NEW — second session-start with identical inbox (FR-ENGAGEMENT-011)
│       └── engagement-proxy-e2e.test.ts        # NEW — C-046 end-to-end smoke (FR-ENGAGEMENT-006); spawn binary, 5 real MCP-find calls, 1 real accept, run report, assert match; Ollama-gated
├── transport/
│   └── src/
│       └── corpus-find-tool.ts             # EXTENDED — wrap handler to (a) generate request_id via randomUUID(), (b) emit engagement.corpus_find_invoked AFTER the existing search.query event (additive — no SearchOutput shape change), (c) when invoked via CLI mediator, print the request_id to stderr for operator capture (per spec.md Assumption #11)
└── ...                                     # daemon/index/inference/pipeline/storage — UNTOUCHED

tests/
├── unit/
│   ├── engagement-schemas.test.ts
│   ├── engagement-find-instrumentation.test.ts
│   ├── engagement-accept-args.test.ts
│   ├── engagement-accept-writer.test.ts
│   ├── engagement-telemetry-scanner.test.ts
│   ├── engagement-report-aggregator.test.ts
│   ├── engagement-report-verdict.test.ts
│   ├── engagement-report-json-shape.test.ts
│   └── engagement-report-cli-args.test.ts
└── fixtures/
    └── sp008-engagement/
        ├── telemetry-fixture-pass.jsonl         # synthetic 5q + 1a; matches PASS verdict
        ├── telemetry-fixture-fail-low-queries.jsonl  # 2q + 0a; KILL signal
        ├── telemetry-fixture-fail-no-accept.jsonl    # 5q + 0a; FAIL non-KILL
        ├── telemetry-fixture-rotated/             # rotated-log scenario (active log + 1 rotated within window)
        ├── telemetry-fixture-corrupt.jsonl        # malformed lines mixed with valid lines
        └── ur-001-fixture-docs/                    # 3 fixture documents (PDF, Markdown, plain-text)
```

**Structure Decision**: SP-008 extends `packages/cli/` with two new CLI command entry points (`accept-command.ts`, `engagement-proxy-command.ts`) + an `engagement/` library directory (the ONLY new directory under `cli/src/`), and extends `packages/contracts/` additively (new `engagement.ts`; extensions to `telemetry.ts` + `errors.ts` + `index.ts`); minimal additive emit in `packages/transport/src/corpus-find-tool.ts`. ZERO new packages. ZERO new MCP surfaces. ZERO new SQL tables. ZERO new `Paths.*` getters. ZERO new outbound endpoints. The C-046 e2e smoke + UR-001/UR-002/UR-003 + adversary integration tests live under `packages/cli/test/` (alongside the SP-007 `smoke-e2e.test.ts`) to keep the spawn-the-binary harnesses co-located with the CLI they test.

## Phase 0 — Research

See [`research.md`](./research.md) for the full decision log. Headlines (Decisions A through D resolved):

- **A. request_id sourcing for engagement events** — Generate `request_id: randomUUID()` server-side at the `corpus-find-tool` handler entry (the SAME `request_id` is used by both the existing `search.query` event and the new `engagement.corpus_find_invoked` event). Echo to stderr when the CLI is the mediator so the operator can copy it. **NOT added to `SearchOutputZodSchema`** — that would mutate the SP-005 SearchOutput contract; per spec.md Assumption #11 the operator captures `request_id` via `tail -f Paths.telemetry()`. Resolves the spec contradiction that asserts "request_id matches SearchOutput.request_id" when SP-005 SearchOutput has no `request_id` field.
- **B. Acceptance-record persistence** — Telemetry-only (append-only NDJSON to `Paths.telemetry()`). Sidecar files under `Paths.state()/engagement/<request_id>.json` REJECTED (adds a new write surface + a new file-discovery requirement for the report scanner; violates the substrate-stability commitment); a new SQL table REJECTED (substrate schema is frozen post-SP-006 per spec.md FR-ENGAGEMENT-014). The telemetry log IS the acceptance record, keyed by `request_id` matching the prior `engagement.corpus_find_invoked` event. Duplicate-detection scans the log for prior `engagement.acceptance_event` with the same `request_id`. Append-atomicity ≤ 4 KB per line preserved.
- **C. C-046 e2e smoke shape for the engagement layer** — Spawn the production binary; spawn `corpus daemon`; spawn `corpus mcp`; issue 5 real `corpus.find` queries via real MCP-stdio (NOT library-level handler tests); for one returned hit, run `corpus accept <request-id>` via the production binary (the `request_id` is captured by tailing `Paths.telemetry()` mid-test); run `corpus engagement-proxy report --format=json --since=<window-start>`; parse the JSON; assert `{verdict: "PASS", queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true}`. Ollama-gated per SP-007 FR-INSTALL-024 pattern. **No library-level handler test is sufficient** — the SP-006 retrospective F-1 root cause demands real MCP-stdio.
- **D. `corpus accept` UX — `--last` vs explicit request_id** — Always explicit `<request-id>` positional argument. `--last` REJECTED for v1 (introduces stateful "most recent" semantics that the telemetry log doesn't natively support; would require a new sidecar tracking "last query" per-session; violates the substrate-stability commitment). The operator captures `request_id` via `tail -f Paths.telemetry() | jq` (documented in the post-`/speckit-tasks` quickstart). Future-horizon: a `--last` flag could be added in v1.5+ if the operator workflow flags the friction.

## Phase 1 — Design Artifacts

See [`data-model.md`](./data-model.md) for the entity catalog. Seven SP-008 entities (`EngagementCorpusFindInvokedEvent`, `EngagementAcceptanceEvent`, `EngagementReportGeneratedEvent`, `EngagementReportTelemetryParseFailedEvent`, `EngagementProxyReport`, `AcceptArgs`, `EngagementProxyReportArgs`) — each with fields, persistence, lifecycle, invariants.

See [`contracts/`](./contracts/) for the two new ADRs:

- [`adr-acceptance-event-definition.md`](./contracts/adr-acceptance-event-definition.md) — **ADR-016**: formalizes the D2 (operator-attested) acceptance-event-definition decision from spec.md Clarifications Decision 1. Records D1 + D3 rejection rationale, the `corpus accept <request-id>` UX contract, the duplicate-detection semantics, the zero-result-query refusal, and the relationship to future cross-agent telemetry surfaces (AG-004 future-horizon).
- [`adr-engagement-proxy-aggregation.md`](./contracts/adr-engagement-proxy-aggregation.md) — **ADR-017**: formalizes the report's aggregation contract. Defines what counts as "in the window" (UTC-normalized `timestamp ∈ [since, until]`), what counts as "an acceptance event" (`engagement.acceptance_event` deduplicated by `request_id`), how the C-028 threshold is computed (`queries_in_window >= 5 AND acceptance_events_in_window >= 1`), the KILL-signal threshold (`queries_in_window < 3`), the rotated-log scan convention (mtime-in-window filter), the informational aggregates (median + p95 latency, tier distribution, zero-result count, distinct query_hash count), and the JSON report's Zod schema with `schema_version: 1`.

See [`checklists/requirements.md`](./checklists/requirements.md) for the spec-stage 16-principle pass/fail + Track A/B split verification (already authored at `/speckit-specify`).

Quickstart (`quickstart.md`) is deferred to post-`/speckit-tasks` per the SP-007 pattern; it will document the operator walkthrough: install + drop document + query from Claude Code + capture request_id from `tail Paths.telemetry()` + run `corpus accept <request-id>` + run `corpus engagement-proxy report --since=<window-start>` + observe the PASS verdict.

## ADR numbering rationale

The `.product/ADRs/` numbered set goes through ADR-011 on `main`. The SP-007 contracts use named-slug ADRs at `specs/007-install-first-run/contracts/` (`adr-install-uninstall-surface.md` = ADR-012, `adr-firewall-provisioning.md` = ADR-013, `adr-taxonomy-promote-cli.md` = ADR-014, `adr-curated-seed.md` = ADR-015 — numbers carried inside each file's header line). SP-008 continues the named-slug convention at `specs/008-user-acceptance/contracts/` and continues the numbering: **ADR-016 = `adr-acceptance-event-definition.md`**; **ADR-017 = `adr-engagement-proxy-aggregation.md`**. **Both ADRs are purely additive** — zero existing ADRs amended or superseded. The SP-007 ADR-012..015 set is unchanged; the `.product/ADRs/` ADR-001..011 set is unchanged.

## PREREQ landings (what must be in `packages/contracts/` before `packages/cli/` work compiles)

Per the substrate's compile-order discipline (matches SP-007 pattern):

1. **`packages/contracts/src/engagement.ts`** — all 7 new Zod schemas (`EngagementCorpusFindInvokedEventZodSchema`, `EngagementAcceptanceEventZodSchema`, `EngagementReportGeneratedEventZodSchema`, `EngagementReportTelemetryParseFailedEventZodSchema`, `AcceptArgsZodSchema`, `EngagementProxyReportArgsZodSchema`, `EngagementProxyReportZodSchema`). Without these, `packages/cli/src/accept-command.ts` and `packages/cli/src/engagement-proxy-command.ts` cannot compile.
2. **`packages/contracts/src/telemetry.ts`** — extended with the 4 new `engagement.*` event-class variants added to the `TelemetryEvent` discriminated union (additive). Without these, the new emit sites in `corpus-find-tool.ts`, `acceptance-event-writer.ts`, and the report renderer cannot emit Zod-validated telemetry per Constitution XIII.
3. **`packages/contracts/src/errors.ts`** — extended with the 5 new typed errors (`EngagementProxyTelemetryParseError`, `EngagementProxyWindowInvalidError`, `AcceptUnknownRequestIdError`, `AcceptZeroResultQueryError`, `AcceptDuplicateRequestIdError`). Without these, the `engagement/` helpers cannot return `Result<T, E>` per Constitution XI.
4. **`packages/contracts/src/index.ts`** — re-exports of new engagement schemas + new error classes. Without these, `packages/cli/` imports from `@llm-corpus/contracts` cannot resolve.

These four contracts landings are the first build step. They can be authored in a single contracts commit before any cli code is written. The `packages/cli/` work (2 new command files + 8 engagement-helpers files + the `corpus-find-tool.ts` additive emit + the 15 test files) follows.

## Risk Register

- **R1 (medium) — `request_id` echo to stderr clutters Claude Code's UI.** Mitigation: the echo happens ONLY when the corpus-find tool is invoked via the CLI mediator (when `process.stderr.isTTY` AND the invocation is detected as CLI-vs-MCP-stdio). When invoked via real MCP-stdio (the typical agent-driven path), stderr is captured by the agent host and may or may not be surfaced; the agent does NOT need the request_id (the operator does). Documented in spec.md Assumption #11 + the post-`/speckit-tasks` quickstart. Future-horizon: a `--print-request-id` flag could be added if operator-friction surfaces.
- **R2 (low) — Telemetry-log scanner performance on very large logs (> 100 MB).** Mitigation: the scanner uses `readline`-on-stream (memory-bounded; one line at a time); typical dogfood-window log size is ~1-10 MB. The 30-second default timeout catches pathological cases; the operator can extend via `--timeout=<ms>`. Edge case documented in spec.md Edge Cases ("Telemetry log rotation mid-window").
- **R3 (medium) — Operator confusion about Track A vs Track B split.** Mitigation: the split is surfaced in (i) the spec.md, (ii) this plan.md, (iii) the upcoming tasks.md, (iv) every engineer brief, (v) the PR description, (vi) the RETROSPECTIVE.md, (vii) the `--format=text` report's header banner. Constitution XVI compliance is verified by SC-008-034.
- **R4 (low) — Operator gaming the metric.** Mitigation: documented honestly in spec.md Edge Cases ("Operator gaming the metric"). The SP-008 metric is a Stage-5 early-signal proxy, NOT a fraud-resistant adoption measurement. The trust model is "the operator has no incentive to game on themselves" (single-user, single-machine per Principle IV).
- **R5 (medium) — Track B verdict ambiguity if the 7-day window's daemon was down for part of it.** Mitigation: the report does NOT compensate for daemon-down periods (per spec.md Edge Cases "Daemon was not running during part of the window"); the verdict reflects actual query count. Operator responsibility is to keep the daemon up. The SP-007 `--enable-autostart` flag is recommended.
- **R6 (low) — Telemetry log corruption skews report.** Mitigation: malformed lines are skipped + counted in `parse_errors_count` + emit `engagement.report_telemetry_parse_failed`; the report still emits with the parse-error count surfaced. The operator decides whether to trust the result given the error count. Edge case documented in spec.md Edge Cases.
- **R7 (medium) — Spec asserts `SearchOutput.request_id` but SP-005 doesn't have that field.** Mitigation: resolved at plan-stage (Decision A in research.md) — generate `request_id` server-side at the find-handler boundary, emit it ONLY in telemetry events (not in SearchOutput), echo to stderr for CLI capture. Spec.md Assumption #11 supports this. The contradiction is documented in research.md and surfaced in the SP-008 PR description; spec.md is NOT amended (the contradiction is a load-bearing-but-non-fatal description gap, not a decision blocker).
- **R8 (low) — UR-002 integration test ("agent invokes corpus.find") is hard to make deterministic without a real Claude Code agent.** Mitigation: the test simulates the agent flow by directly invoking the production MCP server's tool-handler with the SP-002 FR-009 retrieval-prompt template loaded; it does NOT spawn an actual Claude Code session. The "agent grounds answer with traceable references" scenario is asserted at the MCP-response level (SearchHit URI dereferences correctly), NOT at the agent-natural-language level. Documented honestly per Constitution XVI; the C-046 e2e smoke is the substantive transport-cutover-gap-closer for the engagement layer.
- **R9 (medium) — Track B 7-day calendar window may slip if the operator vacations.** Mitigation: the window can be extended (`--since` accepts any operator-chosen start); the sprint-completion PM-Review accepts an extended window with a documented start date in RETROSPECTIVE.md. Per spec.md Assumptions block: "the official SP-008 verdict is the report run at end-of-window (`--since=<dogfood-start>`)" — the operator chooses the start.
- **R10 (low) — `corpus engagement-proxy report` JSON shape changes between SP-008 and v1.5+.** Mitigation: the JSON includes `schema_version: 1` per FR-ENGAGEMENT-012; future v1.5+ may ship `schema_version: 2` with downstream tooling negotiating via the version field (the SP-007 InstallReceipt schema_version pattern).

## Performance Goals (Honest Commitments — Constitution XVI)

| Metric | Target (Spec) | SP-008 Honest Commitment | Measurement |
|---|---|---|---|
| `corpus accept` end-to-end (read log + Zod-parse + dedup-check + append) p95 | ≤ 50 ms | ≤ 200 ms | wall-clock `time` |
| `corpus engagement-proxy report` 7-day window p95 | ≤ 500 ms | ≤ 2 s | wall-clock `time` |
| `corpus engagement-proxy report` 30-day window p95 | ≤ 2 s | ≤ 5 s | wall-clock `time` |
| Scanner throughput (lines/s) | ≥ 50k | ≥ 20k | fixture timing |
| `engagement.corpus_find_invoked` emit overhead | ≤ 5 ms | ≤ 20 ms | unit timing |
| `corpus engagement-proxy report --timeout` SIGINT response | ≤ 100 ms | ≤ 500 ms | signal-injection test |
| C-046 end-to-end smoke p95 | ≤ 60 s | ≤ 90 s | wall-clock `time` |

Specific empirical p95s recorded post-implementation in this footnote.

## Complexity Tracking

*Empty (16/16 Constitution principles pass without exception).*

## Phase Gates

- **Phase 0 → Phase 1 gate**: All Decisions A through D resolved in research.md.
- **Phase 1 → Phase 2 gate**: Constitution Check 16/16 [x]; data-model.md entities specified; contracts/ ADRs authored (ADR-016 + ADR-017 — both NEW; zero amended; zero superseded).
- **Phase 2 → Phase 3 gate** (post-`/speckit-tasks`): tasks.md authored; tasks coverage-matrix covers every FR-ENGAGEMENT and SC-008.
- **Phase 3 → merge gate** (post-`/speckit-implement`): all tasks complete; `npm run build` + lint + test all green; the C-046 e2e smoke harness passes on a dev machine with Ollama; UR-001/UR-002/UR-003 integration tests green; both adversary integration tests green; quickstart walked; CLAUDE.md "SP-008 surface" section added; execution-journal.md authored covering every UR-NNN + adversary scenario as Gherkin tied to its passing test.
- **Track B gate** (post-merge — the SP-008 sprint-completion gate): 7-day dogfood window runs; operator captures `corpus engagement-proxy report --since=<dogfood-start>` verdict; RETROSPECTIVE.md updated with the verdict + JSON form; PM-Review approves the sprint outcome per SPRINT-PLAN.yaml line 251. **Track A PR-merge does NOT close SP-008; Track B verdict does.**

## Track A vs Track B — final discipline statement (Constitution XVI)

This plan ships TRACK A. Track A is verifiable by Pallas via unit + integration + end-to-end tests against a fixture HOME with synthetic telemetry. **The PR for SP-008 merges on Track A test pass alone**. Track B is the operator-dogfood verdict; it is the SOLE Track B criterion (SC-008-035) and depends on real wall-clock time + real operator action. The sprint-completion PM-Review per SPRINT-PLAN.yaml line 251 requires Track B's verdict as evidence; **a green PR + a missing Track B verdict means the SPRINT is incomplete**. Track A's tests assert the report computes the verdict correctly given known input; Track B's verdict asserts what the operator's real-world usage produced. Conflating the two ("code shipped therefore user-acceptance complete") is a Goodhart's-law violation explicitly forbidden by Constitution XVI; this plan, the spec, the tasks, the engineer briefs, the PR description, the RETROSPECTIVE, and the report's text-format banner ALL surface the split verbatim.

## Progress Tracking

- [x] Phase 0 — Research complete (research.md)
- [x] Phase 1 — Design artifacts complete (data-model.md, contracts/, checklists/requirements.md; quickstart.md deferred to post-/speckit-tasks)
- [ ] Phase 2 — Tasks generated (tasks.md) — pending `/speckit-tasks`
- [ ] Phase 3 — Implementation complete — pending `/speckit-implement`
- [ ] Phase 4 — Track A merge to main — pending all phase gates
- [ ] Phase 5 — Track B verdict captured — pending 7-day dogfood window + operator-run report (SC-008-035)
