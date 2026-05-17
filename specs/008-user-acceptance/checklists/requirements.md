# Specification Quality Checklist: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate (SP-008)

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit-clarify` (optional) and then `/speckit-plan`
**Created**: 2026-05-17
**Feature**: [spec.md](../spec.md)

## Track A / Track B Split — Explicitly Recorded

Per the SP-008 dispatch prompt's CRITICAL FRAMING and per FR-ENGAGEMENT-022:

- **Track A (CODE — what this sprint SHIPS)**:
  - FR-ENGAGEMENT-001..006: Telemetry instrumentation + `corpus accept` CLI + `corpus engagement-proxy report` CLI + C-046 end-to-end smoke
  - FR-ENGAGEMENT-007..009: UR-001 / UR-002 / UR-003 Gherkin scenarios tied to passing integration tests
  - FR-ENGAGEMENT-010..011: Empty-corpus + session-start idempotency adversary integration tests
  - FR-ENGAGEMENT-012..020: Constitution-binding requirements (schema, principles, idempotency, telemetry, paths, AbortSignal)
  - FR-ENGAGEMENT-021..024: Decision records + deferrals
- **Track B (OPERATOR ACTION — what this sprint TESTS AGAINST)**:
  - 7-day dogfood window during which Shon-as-Maya uses the installed substrate naturally
  - SOLE Track B criterion: SC-008-035 — the operator runs `corpus engagement-proxy report --since=<dogfood-start>` at end-of-window AND captures the verdict in `specs/008-user-acceptance/RETROSPECTIVE.md` as evidence of the SPRINT-PLAN.yaml line 248 exit criterion
- **Sprint PR-merge requires**: Track A test pass (SC-008-001..SC-008-034 + SC-008-036)
- **Sprint COMPLETION (PM-Review approved sprint outcome per SPRINT-PLAN.yaml line 251) requires**: Track B verdict captured (SC-008-035)
- **Conflating Track A and Track B is a Goodhart's-law violation explicitly forbidden by Constitution XVI.**

## Acceptance-Event-Definition Decision — D2 (Operator-Attested) Chosen

Per FR-ENGAGEMENT-021 + Clarifications Block Decision 1:

- **D1 (auto-detected)** — REJECTED. Requires cross-process visibility into the MCP client's post-response behavior. The MCP protocol does not surface client-side message-handling; detecting "agent emitted text containing a SearchHit snippet" requires per-client integrations (Claude Code, Gemini CLI, Codex CLI), which is out of scope per AG-004 + OOS-011.
- **D3 (proxy/result-count)** — REJECTED. Conflates "got results" with "results were useful". A corpus returning 5 irrelevant SearchHits would inflate the metric. The C-028 mitigation literally requires a quality filter, not a recall filter.
- **D2 (operator-attested)** — **CHOSEN**. `corpus accept <request-id>` CLI subcommand explicitly invoked by the operator after observing a useful result. Friction-bearing but trustworthy. The operator is the single authority on usefulness per Principle IV (single-user, single-machine). D2 may evolve in v1.5+ as cross-agent surfaces ship; for v1 D2 is correct.

**This decision IS LOAD-BEARING. Re-litigating without a `/speckit-clarify` pass would invalidate the spec.**

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — implementation library choices (`flock`, `setTimeout/clearTimeout`, `INSERT OR IGNORE`, `withTempDir`, `runTool`, `SHA-256`, `AbortController`, NDJSON append) appear only as load-bearing identifiers binding to constitutional principles or pre-resolved decisions: Principle V (Zod boundaries), Principle VII (cancellable IO), Principle IX (append atomicity ≤ 4 KB), Principle XIII (Telemetry-or-Die), Principle XIV (Paths resolver). Concrete code symbols appear only where binding to a constitutional principle or an SP-001..SP-007 contract.
- [x] Focused on user value and business needs — every user story is framed around what the operator experiences: drop-and-trust (UR-001 = US1), agent-grounded answers with traceable references (UR-002 = US2), session-portable corpus state with no re-feed (UR-003 = US3), the Maya engagement-proxy gate that decides whether v1 ships at all (US4), and the adversary guardrails that prevent silent regressions of the metric (US5).
- [x] Written for non-technical stakeholders — Shon (sole stakeholder + sole developer + sole Track B operator) is the audience; the technical specificity is calibrated to him.
- [x] All mandatory sections completed — User Scenarios & Testing (5 stories), Requirements (24 FR-ENGAGEMENT-NNN), Success Criteria (36 SC-008-NNN), Assumptions, Out of Scope all populated.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the spec resolved all SP-008 v1 ambiguities by binding to existing artifacts (SP-001 MCP server contract, SP-002 FR-009 retrieval-prompt template + four auto-loaded resources, SP-003 telemetry NDJSON layer + content-hash idempotency, SP-004 classifier + taxonomy_terms, SP-005 hybrid retriever + SearchOutput.request_id + NFR-003 latency, SP-006 tier-orchestrator + `corpus://failures` resource + kill-9 recovery, SP-007 install-receipt + `corpus taxonomy promote` + 12 SP-007 telemetry event classes, the C-028 mitigation verbatim, SPRINT-PLAN.yaml SP-008 lines 235-256 verbatim, REQUIREMENTS.yaml UR-001/UR-002/UR-003 verbatim, the three D1/D2/D3 acceptance-event-definition options resolved to D2 per the Clarifications block, the Track A/B split made explicit per Constitution XVI). The single load-bearing decision (D2 acceptance event) is recorded in the Clarifications block with rationale.
- [x] Requirements are testable and unambiguous — every FR-ENGAGEMENT-NNN names a behavior, a source (Constitution / decision / verbatim citation / dispatch-prompt recommendation), and a verification path. Mapping table:
  - FR-ENGAGEMENT-001 → SC-008-001 / SC-008-002 / SC-008-004 / SC-008-006
  - FR-ENGAGEMENT-002 → SC-008-007 / SC-008-008 / SC-008-009 / SC-008-010 / SC-008-011 / SC-008-012
  - FR-ENGAGEMENT-003 → SC-008-013 / SC-008-014 / SC-008-018 / SC-008-019 / SC-008-020 / SC-008-021
  - FR-ENGAGEMENT-004 → SC-008-003 / SC-008-005
  - FR-ENGAGEMENT-005 → SC-008-015 / SC-008-016 / SC-008-017
  - FR-ENGAGEMENT-006 → SC-008-027
  - FR-ENGAGEMENT-007 → SC-008-022
  - FR-ENGAGEMENT-008 → SC-008-023
  - FR-ENGAGEMENT-009 → SC-008-024
  - FR-ENGAGEMENT-010 → SC-008-025
  - FR-ENGAGEMENT-011 → SC-008-026
  - FR-ENGAGEMENT-012 → SC-008-019
  - FR-ENGAGEMENT-013 → SC-008-029
  - FR-ENGAGEMENT-014 → (no new SQL / no new Paths.*; verified by code-grep on plan-stage)
  - FR-ENGAGEMENT-015 → SC-008-028
  - FR-ENGAGEMENT-016 → SC-008-031
  - FR-ENGAGEMENT-017 → SC-008-032
  - FR-ENGAGEMENT-018 → SC-008-030
  - FR-ENGAGEMENT-019 → SC-008-033
  - FR-ENGAGEMENT-020 → (Paths.telemetry() reused; verified at plan stage)
  - FR-ENGAGEMENT-021 → Decision 1 in Clarifications block (load-bearing)
  - FR-ENGAGEMENT-022 → SC-008-034 / SC-008-035
  - FR-ENGAGEMENT-023 → SC-008-035 (Track B verdict captured in RETROSPECTIVE.md)
  - FR-ENGAGEMENT-024 → SC-008-036 (C-043 + C-044 still deferred)
- [x] Success criteria are measurable — every SC-008-NNN names a concrete pass condition (telemetry event presence, Zod validation success, exit-code expectation, count-equality assertion, lint zero-violations). The Track B SC-008-035 is honest about its measurement window (7 calendar days from sprint merge; verdict captured in RETROSPECTIVE.md).
- [x] Success criteria are technology-agnostic where possible — phrased in terms of event counts, exit codes, JSON shape assertions, Zod-validation success, lint-detected zero-violations, end-to-end smoke pass. Identifiers like `Paths.telemetry()`, `tier_used`, `request_id`, `SHA-256` appear only where Constitution XIII / Constitution V / Principle IX bind them.
- [x] All acceptance scenarios are defined — every user story has ≥ 5 Given/When/Then scenarios; collectively 33 scenarios cover the UR-001 happy / proposed-term / validation-failure paths (US1, 5 scenarios), the UR-002 happy / empty-corpus-non-fabrication / cross-document / latency / acceptance paths (US2, 6 scenarios), the UR-003 session-portable / unchanged-inbox-idempotency / pre-init-error paths (US3, 5 scenarios), the Maya engagement-proxy gate's PASS / FAIL / KILL / report-window paths (US4, 10 scenarios), the empty-corpus + session-start idempotency adversary paths (US5, 5 scenarios).
- [x] Edge cases are identified — 16 edge cases enumerated (telemetry log rotation mid-window, `corpus accept` for zero-result query, accept for older-than-window query, heavy mid-window ingest, agent-driven programmatic invocations, oversized query payloads, multiple acceptance attestations, corrupt telemetry log, operator forgets accept, gaming concerns, daemon-down periods, DST/clock changes, mid-ingest concurrent report scan, future `--until`, per-query detail request, edge cases on `--from-proposed-with-count-ge` analogs).
- [x] Scope is clearly bounded — Out of Scope section enumerates ≥ 18 explicit deferrals: C-043 + C-044 (still deferred), D1 + D3 acceptance-event definitions (rejected), cross-agent engagement, multi-user/shared-corpus, per-query subcommand, `corpus reject`, persistent acceptance in SQLite, time-weighted metrics, real-time UI, multi-machine aggregation, remote telemetry shipping, `--watch` mode, cross-machine idempotency, real-Maya operator, threshold tuning, MCP-resource form of report.
- [x] Dependencies and assumptions identified — Assumptions section enumerates ≥ 15 prerequisites and pre-resolved decisions, each with explicit source: Shon-as-Maya operator, Track B start trigger = sprint merge, SP-007 merged at `972714c`, SP-002 FR-009 prompt template + SP-007 MCP registration intact, calendar-based 7-day window (not active-use), single-machine + single-user per Principle IV, `corpus accept` friction is acceptable per Decision 1, C-028 thresholds fixed (not tunable), Track B verdict in RETROSPECTIVE.md, C-043 + C-044 still deferred, single-engineer-agent build (~1500-2000 LOC), operator captures request_id via tail-f + copy-paste, Track A deterministic + Track B not, window can be re-run mid-flight, end-to-end smoke is dev-machine-only (CI Ollama-conditional skip).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — 24 FR-ENGAGEMENT-NNN requirements map to 36 SC-008-NNN measurable outcomes. The mapping is many-to-many; every FR-ENGAGEMENT is covered by ≥ 1 SC-008 (see the Requirement Completeness mapping table above).
- [x] User scenarios cover primary flows — US1 (UR-001 drop-and-trust, P1), US2 (UR-002 agent-grounded answers, P1), US3 (UR-003 session-portable corpus, P1), US4 (Maya engagement-proxy gate per C-028, P1), US5 (empty-corpus + session-start idempotency adversaries, P2). The five stories cover the three scope requirements (UR-001/002/003) + the C-028 gate + the two SP-008-mandated adversary scenarios.
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-008-001..SC-008-036 together cover the SP-008 exit criteria verbatim (every_scope_requirement_has_at_least_one_passing_gherkin_scenario_in_execution_journal, maya_persona_week_1_engagement_proxy_at_least_5_corpus_find_queries_in_7d_with_at_least_1_acceptance_event_per_c_028, session_start_idempotency_test_in_execution_journal_shows_sqlite_corpus_table_row_count_unchanged_after_second_session_start_with_identical_inbox, corpus_find_empty_corpus_adversary_scenario_in_execution_journal_shows_mcp_response_hits_array_empty_and_no_citation_fields, pm_review_approved_sprint_outcome) + the Constitution gates I/III/V/VII/XI/XIII/XIV/XVI.
- [x] No implementation details leak into specification — verified by re-read. Identifiers like `flock`, `setTimeout/clearTimeout`, `INSERT OR IGNORE`, `withTempDir`, `runTool`, `SHA-256`, `AbortController`, NDJSON appear only at the binding points where the constitutional principle or pre-resolved decision requires them.

## Constitution Compliance (cross-cutting, non-template)

- [x] **Principle I (Local-First, No Egress)** — SC-008-028 + FR-ENGAGEMENT-015: SP-008 introduces ZERO new outbound non-loopback endpoints. The engagement-proxy reader reads `Paths.telemetry()` locally. The accept CLI writes locally. No telemetry shipping, no analytics, no remote aggregation. The SP-001 `no-forbidden-network-imports` ESLint rule scopes over SP-008 source.
- [x] **Principle II (User Curates, LLM Classifies Metadata)** — SP-008 introduces ZERO new LLM body-generation. The operator's `corpus accept` attestations are human-curated. The taxonomy / classifier / embedder are unchanged from SP-004 / SP-005.
- [x] **Principle III (Substrate, Not Surface)** — SC-008-029 + FR-ENGAGEMENT-013: ZERO new MCP mutation surfaces. `corpus accept` and `corpus engagement-proxy report` are CLI subcommands, NOT MCP tools or resources. The existing SP-001 `corpus.find` tool is unchanged in shape — only its instrumentation surface expands. The SP-002 + SP-006 read-only resources are unchanged.
- [x] **Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)** — Assumptions explicit: one operator per machine. The Maya engagement proxy aggregates Shon's single-machine usage. No multi-user, no cross-machine sync.
- [x] **Principle V (Schema-Enforced Structured Output)** — FR-ENGAGEMENT-004 + FR-ENGAGEMENT-012 + FR-ENGAGEMENT-018 + SC-008-030: every SP-008 telemetry event, CLI argv, and JSON output is Zod-validated. The four new `engagement.*` event variants Zod-validate at emit time; the `EngagementProxyReportZodSchema` validates at JSON-emit time; the `AcceptArgsZodSchema` + `EngagementProxyReportArgsZodSchema` validate at argv-parse time.
- [x] **Principle VI (One Pipeline, Two Policies)** — The C-046 end-to-end smoke harness (FR-ENGAGEMENT-006) invokes the SAME `ingestStage` / `classifyStage` / `embedStage` / `indexStage` / `edgesBuildStage` pipeline that production uses. The Track A integration tests run against the production binary; no per-test stub pipeline.
- [x] **Principle VII (Cancellable, Bounded IO)** — FR-ENGAGEMENT-016 + SC-008-031: every SP-008 IO operation accepts AbortSignal. The report has a per-invocation timeout (30 s default, `--timeout=<ms>` configurable); the `setTimeout + clearTimeout + controller.abort()` pattern is used; NEVER `Promise.race(setTimeout)`.
- [x] **Principle VIII (Atomic Writes & Transactional Index Updates)** — The new `engagement.*` events are appended to `Paths.telemetry()` via the existing SP-003 atomic-append discipline (≤ 4 KB per line per Principle IX); no new write surface.
- [x] **Principle IX (Concurrency-Safe Shared State)** — The new `engagement.*` events use the existing SP-003 atomic-append discipline (no `Paths.drainLock()` needed for telemetry log appends; the log is append-only and tolerates concurrent writers). The `corpus accept` write goes through the same atomic-append path. The `corpus engagement-proxy report` reader does NOT acquire `Paths.drainLock()` — it is a read-only scan.
- [x] **Principle X (Idempotent Pipeline Transitions)** — FR-ENGAGEMENT-002 + SC-008-010: `corpus accept` for a duplicate request_id is an idempotent no-op (prints "already accepted" + exits 0; no duplicate event recorded). The CLI's duplicate-detection scans the log before writing.
- [x] **Principle XI (Library/CLI Boundary)** — FR-ENGAGEMENT-017 + SC-008-032: `process.exit` appears only in `packages/cli/src/accept-command.ts` and `packages/cli/src/engagement-proxy-command.ts`. Library helpers return `Result<T, E>` or throw typed errors. The SP-001 `no-process-exit-in-libs` lint scopes over SP-008 source.
- [x] **Principle XII (Subprocess Hygiene)** — SP-008's CLI subcommands do NOT spawn external commands. The C-046 end-to-end smoke harness (FR-ENGAGEMENT-006) spawns the production binary via `node <dist>/bin/corpus.js`; this is invoked via the existing test-harness `runTool()` pattern with arg arrays (not shell strings). The SP-001 `no-shell-string-exec` lint scopes over SP-008 source.
- [x] **Principle XIII (Telemetry-or-Die)** — FR-ENGAGEMENT-019 + SC-008-033: SP-008 introduces ≥ 4 new telemetry event classes (`engagement.corpus_find_invoked`, `engagement.acceptance_event`, `engagement.report_generated`, `engagement.report_telemetry_parse_failed`); every catch block emits a telemetry event before returning or re-throwing. The existing AST-level lint covers SP-008 source.
- [x] **Principle XIV (XDG Paths via Single Resolver)** — FR-ENGAGEMENT-014 + FR-ENGAGEMENT-020: SP-008 reuses `Paths.telemetry()` (introduced by SP-003); ZERO new `Paths.*` getters. The `paths-from-resolver-only` lint scopes over SP-008 source.
- [x] **Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)** — SP-008 does NOT touch the taxonomy promotion mechanism. The SP-007 `corpus taxonomy promote` CLI is the canonical surface; SP-008 measures engagement, not vocabulary.
- [x] **Principle XVI (Validation Honesty)** — FR-ENGAGEMENT-022 + FR-ENGAGEMENT-023 + SC-008-034 + SC-008-035: the Track A / Track B split is surfaced verbatim in the spec, in the RETROSPECTIVE.md template, and in the `corpus engagement-proxy report` text-format header banner. Code completion does NOT equal user-acceptance completion. The 7-day dogfood window is a real wall-clock dependency. Track B's verdict is the sprint's user-acceptance evidence per the PM-Review gate.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
- The acceptance-event-definition decision (D2 operator-attested) is recorded in the spec's Clarifications block as a LOAD-BEARING decision; re-litigating it would invalidate the spec. The dispatch prompt explicitly recommended D2 with permission to flag for `/speckit-clarify` if genuine optionality remained; the spec's rationale (D1 cross-process infeasibility per AG-004 / OOS-011; D3 conflates recall with usefulness) closes the optionality, and the operator can run `/speckit-clarify` if they disagree with the rationale.
- The Track A / Track B split is the spec's single most important Constitution XVI commitment. Pallas must surface this split verbatim in: the SP-008 plan.md (when generated by `/speckit-plan`), the SP-008 tasks.md (when generated by `/speckit-tasks`), every engineer brief during `/speckit-implement`, the SP-008 PR description, and the SP-008 RETROSPECTIVE.md. Without explicit Track A / Track B framing, the sprint risks shipping code and declaring user-acceptance complete by code-completion alone — the Goodhart's-law violation forbidden by Constitution XVI.
- C-043 (`signals_used: []`) and C-044 (`regenerateCatalogFromDb` summary column) remain deferred per FR-ENGAGEMENT-024 + SP-007 FR-INSTALL-026 / FR-INSTALL-027. Both are post-v1 polish work, not SP-008 scope.
