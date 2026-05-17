# SP-008 Retrospective — User-Acceptance + Maya Engagement-Proxy Gate

**Sprint**: 008-user-acceptance
**Goal**: Close user-level acceptance (UR-001, UR-002, UR-003) and validate the Maya Week-1 engagement-proxy gate per C-028. Ship Track A (code) so that Track B (operator dogfood) can produce the SC-008-035 verdict.
**Track A merged**: 2026-05-17 (this retrospective is authored at sprint close pre-merge).
**Retrospective author**: Engineer #3 (post-build, pre-merge).
**Status**: **COMPLETED-WITH-TRACK-B-VERDICT-PENDING** per Constitution Principle XVI. PR-merge ships Track A; SC-008-035 (the only Track B criterion) requires the operator's 7-day dogfood window and cannot be code-completed.

## Track A/B split — explicit per FR-ENGAGEMENT-022 + Constitution XVI

- **Track A (code) — what this sprint SHIPS** (merged in this PR): 4 new `engagement.*` telemetry event classes (+1 additive `request_id?` field on `SearchQueryEvent`); `corpus accept <request-id> [--note]` CLI; `corpus engagement-proxy report [--since][--until][--format]` CLI; UR-001/UR-002/UR-003 integration tests; 2 adversary integration tests; C-046 E2E smoke harness against the production binary; Constitution XVI Track A/B banner in the text-format report.
- **Track B (operator action) — what this sprint TESTS AGAINST**: the 7-day dogfood window during which the operator (Shon-as-Maya) actually USES the installed substrate against real questions, generating real `corpus.find` invocations and pressing `corpus accept` when results are useful. At end-of-window the operator runs `corpus engagement-proxy report` against the dogfood window and the verdict (PASS / FAIL non-KILL / FAIL KILL per C-028) lands in the "Track B Verdict" block below.

**The PR-merge does NOT close SP-008.** The Track B Verdict block (RESERVED — see below) does.

## What shipped (Track A — recap)

- **4 new `engagement.*` event classes** at `packages/contracts/src/engagement.ts`:
  - `engagement.corpus_find_invoked` — per FR-ENGAGEMENT-001; fires on every `corpus.find` invocation; carries `request_id`, `query` (or `truncated_query_hash` if ≥ 1024 chars), `result_count`, `tier_used`, `duration_ms`. Wraps the live SP-005/006 hybrid handler at `packages/transport/src/corpus-find-tool.ts:wrapHandlerWithEngagement`.
  - `engagement.acceptance_event` — per FR-ENGAGEMENT-002 + ADR-016 (Decision B = telemetry-only persistence; rejected D1 sidecar files at `Paths.state()/engagement/*.json` and rejected D3 new SQL table; chose D2 forward-only telemetry log keyed by `request_id`).
  - `engagement.report_generated` — audit-trail for verdict invocations.
  - `engagement.report_telemetry_parse_failed` — malformed-row signal during scan; the report continues, `parse_errors_count` increments.
  - Plus additive `request_id?: string` on `SearchQueryEvent` (SP-005) per Decision A — Zod-optional, fully backward-compatible.
- **`corpus accept <request-id> [--note "<text>"]`** at `packages/cli/src/accept-command.ts`. Per ADR-016 + Decision D (no `--last` flag in v1 — operator captures explicit `<request-id>` from the telemetry stream). Idempotent (Constitution X — duplicate accept emits "already accepted" + exits 0; no duplicate event written). Non-zero exit + clear error on unknown request_id (SC-008-008) or zero-result query accept (SC-008-009). `--note` truncated/rejected at Zod boundary at 512 chars (SC-008-012).
- **`corpus engagement-proxy report [--since=<ISO8601>] [--until=<ISO8601>] [--format=text|json]`** at `packages/cli/src/engagement-proxy-command.ts`. Per ADR-017. Telemetry-only aggregation — ZERO new SQL tables; ZERO new `Paths.*` getters (reuses `Paths.telemetry()`). Defaults `--since=now-7d`, `--until=now`. Text format carries the Constitution XVI banner: `"Maya Week-1 Engagement-Proxy Report (per C-028)"` + `"Track B measurement — operator-dogfood verdict"`. JSON Zod-validates against `EngagementProxyReportZodSchema` with `schema_version: 1`. Reads + writes audit-trail to the existing NDJSON telemetry log; reads rotated logs by mtime-in-window per SC-008-020. Verdict computer per FR-ENGAGEMENT-005: PASS (≥ 5 queries + ≥ 1 accept), FAIL non-KILL (3 ≤ queries < 5 OR (queries ≥ 5 AND accepts == 0)), FAIL KILL (queries < 3 → Stage 4 recycle per C-028).
- **Constitution XVI Track A/B banner** in the text-format report — text-renderer at `packages/cli/src/engagement/report-renderer-text.ts` always prints "Maya Week-1 Engagement-Proxy Report (per C-028)" + "Track B measurement — operator-dogfood verdict" at the top of every text report. Asserted by `tests/unit/sp008-engagement-report-text-banner.test.ts` (T054). Per FR-ENGAGEMENT-022 + FR-ENGAGEMENT-023 + SC-008-034.
- **Adversary tests** per FR-ENGAGEMENT-010 + FR-ENGAGEMENT-011 + SC-008-025 + SC-008-026:
  - `packages/cli/test/empty-corpus-adversary.test.ts` (T047) — `corpus.find` on zero documents across 5 query shapes (single-word, multi-word, special-chars, empty-string, ≥ 2KB very-long). Asserts `hits: []`, no `corpus://docs/*` URIs, no citations field, engagement event STILL emits with `result_count: 0`, NO `engagement.acceptance_event`. Ollama-gated full cycle; CI-safe structural assertion always runs.
  - `packages/cli/test/session-start-idempotency-adversary.test.ts` (T048) — daemon restart with N=5 identical inbox: documents row count unchanged + `ingest.dedup_hit` for all 5 + ZERO write events in session 2. Ollama-gated full cycle; CI-safe structural assertion against the dedup vocabulary.
- **C-046 E2E smoke harness** at `packages/cli/test/engagement-proxy-e2e.test.ts` (T045). Spawns the production binary (`node <dist>/index.js engagement-proxy report --format=json`) against a tempdir HOME carrying the synthetic `tests/fixtures/sp008-engagement/telemetry-fixture-pass.jsonl` (5 corpus_find_invoked + 1 acceptance_event in the dogfood window). Asserts the stdout JSON `{verdict: 'PASS', queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true, schema_version: 1}`. Per Decision C ("no library-level handler test is sufficient" — the SP-006 retrospective F-1 root-cause stays closed). Wall-clock < 1 s; deterministic; Ollama-independent.
- **Lint + Constitution enforcement** — `eslint.config.js` extends `no-process-exit-in-libs` over `packages/cli/src/engagement/**/*.ts`; the other 5 custom rules (`paths-from-resolver-only`, `no-shell-string-exec`, `no-forbidden-network-imports`, `no-direct-worker-spawn`, `no-writes-from-resource-handlers`) already scope over `packages/**/*.ts`. Source-walk grep verifications per T052 (Constitution I/III/V/VII/XI/XIII) all pass.
- **Documentation**: `specs/008-user-acceptance/quickstart.md` (operator Track B walkthrough), `specs/008-user-acceptance/execution-journal.md` (Gherkin scenarios bound to passing tests), `docs/SESSION_STATE.md` + `README.md` + `CLAUDE.md` updated to reflect Track A merged + Track B pending.

**Sprint test counts (snapshot at sprint close, 2026-05-17)**: 264 test files, 1240 passing tests, 11 skipped (Ollama-gated UR + adversary integration tests skip silently on CI without Ollama), 0 failing. Build + lint + test all green. Constitution Check 16/16.

## What worked

- The 3-engineer pre-planned build split per `feedback-build-tier-sizing-rule` produced a coherent 67-task sprint with no cross-engineer rework. Engineer #1 landed Phase 1-2 (contracts + lint scope T001-T013). Engineer #2 landed Phase 3-5 (find instrumentation + `corpus accept` + report CLI + C-046 E2E T014-T046). Engineer #3 (this engineer) landed Phase 6-8 (adversary tests + lint enforcement + polish + commit T047-T067).
- The `wrapHandlerWithEngagement` wrapper pattern in `packages/transport/src/corpus-find-tool.ts` cleanly threads the engagement instrumentation without disturbing the SP-005 hybrid handler or the SP-006 tier-orchestrator. The wrap-at-boundary discipline (instrument only at the corpus-find-tool layer) keeps Constitution III honest (ZERO new MCP surfaces) and makes the SC-008-006 invariant trivially enforceable (the wrapper always emits, regardless of inner result_count).
- Telemetry-only acceptance persistence (Decision B) — keyed by `request_id`, forward-only append — gave us "idempotency by replay" almost for free: duplicate `corpus accept` invocations are detected by reading the existing telemetry log for prior `engagement.acceptance_event` rows with matching `request_id`. No SQL migration, no new lock contention, no new `Paths.*` getter.
- The C-046 E2E test (T045) ships as the structural closer for the SP-006 retrospective F-1 (transport cutover gap). It spawns the production binary, exercises the real CLI surface end-to-end, and asserts the verdict deterministically against a synthetic fixture. Wall-clock < 1 s on the dev box; runs in CI without Ollama; deterministic. Decision C ("no library-level handler test is sufficient") proved load-bearing — every cutover-style task in future sprints should ship with a production-binary spawn.
- The Constitution XVI Track A/B banner is not just documentation — it is in the runtime text output of every `corpus engagement-proxy report --format=text` invocation. The operator cannot read the verdict without seeing "Track B measurement" labeled on the page. Future sprints that produce operator-facing surfaces against operator-driven verdicts should ship the same banner pattern.

## What didn't work (root-causes, not symptoms)

### F-1 — Adversary integration tests degraded to Ollama-gated + structural-only on CI

The two adversary harnesses (`packages/cli/test/empty-corpus-adversary.test.ts` + `packages/cli/test/session-start-idempotency-adversary.test.ts`) cannot run their full daemon-restart + corpus.find-via-real-MCP-stdio cycles on CI without Ollama. The Ollama-gated `it.skipIf` pattern keeps CI green but the full adversary cycle only fires on dev boxes with Ollama. The CI-safe structural assertions (event-name vocabulary regression guards, query-shape enumeration) catch shape drift but not behavioral regressions.

The trade-off was accepted because: (a) the SP-007 FR-INSTALL-024 / FR-INSTALL-013 pattern already established Ollama-gated integration tests as the v1 norm; (b) the structural unit tests in `tests/unit/sp008-engagement-find-zero-result.test.ts` cover the engagement-event-emit invariant CI-safely; (c) the C-046 E2E smoke runs the report CLI deterministically without Ollama. The full adversary cycles are part of Track B operator dogfood — when the operator runs `corpus init` on a clean machine and observes `corpus.find` against zero docs, that exercises the empty-corpus adversary in real-world conditions.

**Process gap**: a future SP-009 (or polish PR) could add a Vitest setup that boots an in-memory mock Ollama on a free port and re-runs the Ollama-gated integration tests against the mock. That would re-enable the full adversary cycles on CI. Tracked as a future improvement, NOT a Track A blocker.

### F-2 — `request_id` propagation through the engagement layer was straightforward but underspecified at plan time

Decision A (research.md) chose "server-side `request_id` at the find-handler boundary" — the wrapper at `corpus-find-tool.ts` generates a UUID per invocation and threads it through both the engagement telemetry event and the optional `request_id?` field on `SearchQueryEvent`. This was the right call (the spec/plan converged on it before build), but the data-model.md sections did not enumerate the exhaustive write-points for `request_id` (find-handler, accept-command, report-command audit). Engineer #2 had to read the contracts twice to confirm `request_id` is generated exactly once (at the find boundary) and consumed downstream (at accept + at report).

**Process gap**: data-model.md should include a "write-points" table for any value that flows across CLI / instrumentation / report boundaries: name, generated-at, consumed-at, Zod schema, optional/required. The omission cost ~15 min of contract-reading; not load-bearing but worth fixing in the ProductDevelopment skill template.

### F-3 — SC-008-035 cannot be code-completed; the verdict block stays RESERVED at PR-merge

This is not a process failure — it's the Constitution XVI honesty discipline working as designed. SC-008-035 ("the Maya Week-1 engagement-proxy verdict") is the SOLE Track B criterion and is captured by the operator running `corpus engagement-proxy report` at end-of-window. Pallas cannot fulfill it; the operator's real engagement does. The retrospective ships with a RESERVED block (below); the post-merge Track B PR fills it.

**Process gate**: any future sprint that has an operator-action acceptance criterion (engagement, retention, uptime over wall-clock) MUST surface the criterion in the RETROSPECTIVE.md with an explicit RESERVED block and a Constitution XVI label. The "Track A merged" PR is NOT the sprint-close PR for such sprints.

## Decisions recorded (see decisions.jsonl D-030..D-033)

- **D-030**: SP-008 outcome — sprint shipping Track A complete with Track B verdict PENDING. Constitution Principle XVI honesty: PR-merge does NOT close SP-008; the Track B Verdict block in this retrospective does. C-043 + C-044 STILL DEFERRED per FR-ENGAGEMENT-024 + SC-008-036.
- **D-031**: Decision A (request_id sourcing) — server-side at the find-handler boundary in `wrapHandlerWithEngagement`; threaded as additive `request_id?` on `SearchQueryEvent` (Zod-optional, backward-compatible) AND as required field on `engagement.corpus_find_invoked`. Rejected client-side (Claude Code would need to invent the ID, no contract).
- **D-032**: Decision B (acceptance-event persistence) — D2 chosen: forward-only append to `Paths.telemetry()` keyed by `request_id`. Rejected D1 (sidecar files at `Paths.state()/engagement/<request_id>.json` — violates ZERO-new-Paths discipline); rejected D3 (new `engagement_acceptances` SQL table — violates ZERO-new-SQL-tables discipline + spec.md "schema frozen for v1").
- **D-033**: Decision C (C-046 E2E shape) — real MCP-stdio + production-binary spawn, NOT library-level handler test. Closes the SP-006 retrospective F-1 (transport cutover gap) by enforcing that "the changed surface is reachable from the production entry point" is an explicit acceptance criterion for every cutover-style task going forward.
- **D-034**: Decision D (`corpus accept` UX) — always-explicit `<request-id>` argument; NO `--last` flag in v1. The friction is the load-bearing signal: operator must read the telemetry stream, copy the request_id, and pass it explicitly. A future sprint may add `--last` or a "rate this result" prompt if the operator-friction (R3 risk) becomes load-bearing.

## Concerns recorded (see concerns.jsonl C-050..C-052)

- **C-050**: R3 operator-friction risk surfaced — the manual `corpus accept <request-id>` workflow is intentional v1 friction (Decision D). If Track B PASS lands but the operator reports the workflow as unusable, a follow-up sprint should add `--last` or a session-end prompt.
- **C-051**: R5 daemon-down-during-dogfood-window risk — if the operator's daemon crashes (kill-9, systemd restart, machine reboot) during the 7-day window, the engagement telemetry has a gap. The C-046 E2E smoke confirms the report tolerates gaps (parse_errors_count + continues), but a multi-day gap could push a queries-in-window count below the C-028 threshold artificially. Mitigation: the operator should run `systemctl --user status corpus.service` at least once per day; the next polish PR could add a `corpus engagement-proxy report --include-uptime` flag.
- **C-052**: Track B verdict PENDING — SC-008-035 cannot be satisfied at sprint close; the 7-day window is the SOLE source of the verdict. This is not a defect; it is recorded as a concern so the post-merge tracking is explicit.

## SP-008 sprint status

**COMPLETED-WITH-TRACK-B-VERDICT-PENDING.** Track A (code) is fully shipped and merged in this PR. Track B (operator dogfood) starts post-merge. SC-008-035 (the Maya Week-1 engagement-proxy verdict) is the sole criterion that cannot be satisfied at sprint close; per FR-ENGAGEMENT-022 + Constitution XVI the PR-merge is "Track A complete" only.

C-043 and C-044 STILL DEFERRED per FR-ENGAGEMENT-024 + SC-008-036; routed to a post-v1 polish PR. The engagement-proxy report computes metrics from `result_count` + `tier_used` (NOT `signals_used`), so the C-043 deferral is not load-bearing for the SP-008 verdict.

**Constitution Check 16/16** verified at sprint close. **264 test files, 1240 passing tests, 11 skipped (Ollama-gated), 0 failing.**

## Constitution Check 16/16 — line-by-line

| # | Principle | SP-008 Status |
|---|---|---|
| I | Local-First, No Egress (Non-Negotiable) | PASS — ZERO new outbound endpoints; engagement reader is local-NDJSON-only; T052a grep zero-hits. |
| II | Schema-First, Migration-Discipline | PASS — ZERO new SQL tables; engagement events are additive Zod variants on the existing telemetry union. |
| III | Substrate, Not Surface | PASS — ZERO new MCP tools or resources; `corpus accept` + `corpus engagement-proxy report` are operator CLI subcommands. |
| IV | Tools That Compose, Not Tools That Sprawl | PASS — 2 CLI subcommands, both small; library helpers under `packages/cli/src/engagement/` are single-purpose. |
| V | Schema-Enforced Output | PASS — every input + output Zod-validated; `EngagementProxyReportZodSchema` carries `schema_version: 1`. |
| VI | Acceptance-First | PASS — every FR-ENGAGEMENT has at least one passing test bound in `execution-journal.md`. |
| VII | Cancellable, Bounded IO | PASS — every IO uses AbortSignal + `setTimeout` + `clearTimeout` + `controller.abort()`; ZERO `Promise.race([...setTimeout])` per T052d. |
| VIII | Library-First | PASS — engagement helpers live under `packages/cli/src/engagement/*.ts` and are unit-tested in isolation. |
| IX | Test-First | PASS — RED unit tests landed in Phase 2; GREEN implementations followed. |
| X | Idempotent + Recoverable | PASS — `corpus accept` is idempotent (replay-detect via telemetry scan); session-start adversary T048 verifies daemon-restart idempotency. |
| XI | Zero `process.exit` in Library Code | PASS — `process.exit` only in `accept-command.ts` + `engagement-proxy-command.ts`; engagement helpers throw typed errors. |
| XII | No Shell-String Exec | PASS — no `spawn(string)` in SP-008 source; only `spawn(argv-array, ..., {shell: false})`. |
| XIII | Telemetry-or-Die | PASS — every catch block in engagement command/writer/aggregator emits an `engagement.*` event before return or re-throw. |
| XIV | Reuse `Paths.*` Getters | PASS — `git diff main -- packages/contracts/src/paths.ts` is empty; SP-008 reads + writes `Paths.telemetry()` exclusively. |
| XV | Honest Performance Numbers | PASS — quickstart.md "Honest performance notes" + the C-046 E2E smoke wall-clock < 1 s is the deterministic perf evidence. |
| XVI | Honest Sprint-Close | PASS — Track A/B split surfaced verbatim in spec, plan, tasks, quickstart, retrospective, PR description, runtime report banner. |

---

## Track B Verdict (RESERVED — populated at sprint close by the operator)

This block is the sole SC-008-035 evidence. The operator runs the workflow in `specs/008-user-acceptance/quickstart.md`, captures the `corpus engagement-proxy report --since="$DOGFOOD_START"` output in both `--format=text` and `--format=json`, and pastes both here. The verdict + the report-JSON together close SP-008.

### Track B Verdict — TEXT FORMAT

```
(RESERVED — paste `corpus engagement-proxy report --since="$DOGFOOD_START" --format=text` output here at end of 7-day window.)
```

### Track B Verdict — JSON FORMAT

```json
(RESERVED — paste `corpus engagement-proxy report --since="$DOGFOOD_START" --format=json` output here at end of 7-day window. Zod-validated against EngagementProxyReportZodSchema; schema_version: 1.)
```

### Track B Verdict — Outcome

- [ ] **PASS** — C-028 gate cleared (≥ 5 queries + ≥ 1 accept in 7d window). v1.0.0 substrate is release-ready. Next: open PR titled "SP-008 Track B verdict: PASS — v1.0.0 substrate release-ready"; tag `v1.0.0`; publish to npm.
- [ ] **FAIL (non-KILL)** — engagement floor cleared but C-028 gate not met. Extend dogfood window 3-7 days; re-run report. Capture the soft-fail in this block; do NOT roll back.
- [ ] **FAIL (KILL)** — queries < 3 in 7d → C-028 KILL signal. Stage 4 recycle per C-028 mitigation (SPRINT-PLAN.yaml line 253). v1.0.0 does NOT ship until a re-instrumented re-dogfood produces PASS.

### Track B Verdict — operator notes

(RESERVED — operator's narrative on the 7-day window: which questions did Maya/Shon ask, which results were load-bearing, where did the agent fabricate vs cite, what should v1.1.0 prioritize based on the dogfood signal.)

---

## Entry conditions for v1.0.0 release ceremony

After the Track B Verdict block is populated with PASS, the v1.0.0 release ceremony begins. Steps live OUTSIDE SP-008 scope but are documented here for continuity:

1. Tag `v1.0.0` on `main` at the SP-008-Track-B-verdict-PR squash commit.
2. Generate release notes from SP-001..SP-008 ledger D-entries (see `.product/ledgers/decisions.jsonl`).
3. Publish `@llm-corpus/cli` to npm.
4. Open a "v1.0.0 release" PR with the release notes draft (no code changes).
5. Tag the release on GitHub.

If Track B returns FAIL (KILL), the v1.0.0 release queue is paused and a Stage 4 recycle PR opens against the spec-kit corpus per C-028.

## Notes for ProductDevelopment skill template improvements

- Data-model.md sections should include a "write-points" table for any value that flows across CLI / instrumentation / report boundaries (F-2 above). The omission was minor cost but worth fixing in the skill template.
- Sprints with operator-action acceptance criteria (engagement, retention, real-world adoption) MUST surface a RESERVED block in the RETROSPECTIVE.md with a Constitution XVI label, and the "Track A merged" PR is NOT the sprint-close PR (F-3 above). The ProductDevelopment skill should generate the RESERVED block automatically for any sprint where SC-NNN-NNN references "operator", "dogfood", or "real-world".
- "Cutover" / "wire X into production" / "instrument the production path" tasks MUST ship with a C-046-style production-binary spawn test in the SAME PR (Decision C). The SP-006 retrospective F-1 root-cause is closed by enforcing this pattern in code (T045) and surfacing it as a skill-template rule.
