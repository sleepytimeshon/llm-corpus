# Phase 0 — Research: User-Level Acceptance + Maya Week-1 Engagement-Proxy Gate (SP-008)

**Feature**: 008-user-acceptance
**Date**: 2026-05-17

This document records the plan-stage architectural decisions that gate SP-008. The spec arrived from `/speckit-specify` clean of `[NEEDS CLARIFICATION]` markers and with the load-bearing D2 (operator-attested) acceptance-event-definition decision already recorded in spec.md Clarifications Block Decision 1 + the Track A/B split recorded in Decision 2 + the engagement-instrumentation surface recorded in Decision 3. The decisions below resolve four additional plan-stage design-space items that the spec defers to research:

- **A. `request_id` sourcing** for the new `engagement.corpus_find_invoked` event — the spec asserts a foreign-key relationship to the SP-005 SearchOutput's `request_id`, but SP-005 SearchOutput has no `request_id` field (load-bearing description gap to resolve).
- **B. Acceptance-record persistence** — sidecar files under `Paths.state()/engagement/<request_id>.json` vs a new SQL table vs telemetry-only.
- **C. C-046 end-to-end smoke harness shape** for the engagement layer — the SP-006 retrospective F-1 transport-cutover-gap closer for engagement instrumentation.
- **D. `corpus accept` UX** — explicit `<request-id>` positional vs `--last` flag.

Format: Decision → Recommendation → Rationale → Alternatives considered → Source citations.

---

## Decision A — `request_id` sourcing for `engagement.corpus_find_invoked`

**Decision**: Generate `request_id: randomUUID()` **server-side** at the entry of the `corpus-find-tool` handler (`packages/transport/src/corpus-find-tool.ts`). Thread the SAME `request_id` through both (a) the existing SP-005 `search.query` telemetry event (additive — the existing event gains a new optional `request_id` field) AND (b) the new SP-008 `engagement.corpus_find_invoked` event (mandatory `request_id` field per spec.md FR-ENGAGEMENT-001). For operator-UX capture, echo the `request_id` to **stderr** when the handler detects CLI mediation (`process.stderr.isTTY` heuristic); ZERO echo when invoked via real MCP-stdio (the agent host captures stderr and may or may not surface it — irrelevant for the agent's flow; the operator captures from `tail -f Paths.telemetry()`). **The `request_id` is NOT added to `SearchOutputZodSchema`** — that would mutate the SP-005 SearchOutput contract for v1, which is forbidden by the substrate-stability commitment (the SP-005..SP-007 ADRs are unchanged in SP-008).

**Rationale**:

- **The spec contradicts SP-005 reality**: spec.md FR-ENGAGEMENT-001 states "`request_id: UUID` (matching the SP-005 SearchOutput's `request_id`)". Verification of `packages/contracts/src/search-schemas.ts` at line 128-142 confirms `SearchOutputZodSchema` has fields `{hits, query, result_count, tier_used, signals_used, degraded_signals?, filters_applied?, error?}` — **no `request_id` field**. Cross-checking `packages/transport/src/corpus-find-tool.ts` confirms the find handler does NOT generate a `request_id` either. SP-005's `SearchQueryEvent` telemetry has `query_hash` but no `request_id`. **The spec assumes a field that does not exist.** This contradiction must be resolved at plan-stage; resolving by amending SP-005 SearchOutput is out of scope (substrate stability) and unnecessary (per spec.md Assumption #11 the operator captures `request_id` via telemetry, not via the MCP response).
- **Server-side UUID at handler entry is the cleanest insertion point**: a single `randomUUID()` call at the top of the find-handler produces a value that BOTH telemetry events share, and the existing handler structure already wires `signal` and other call-scoped state through. No new dependency. Pattern matches `packages/transport/src/resource-recent-handler.ts`, `resource-manifest-handler.ts`, `failures-resource-handler.ts`, `egress-hook.ts`, and `run-tool.ts` — all of which already use `randomUUID()` at handler entry. **The find-handler is the ONLY tool handler without a `request_id`**; SP-008's emit makes it consistent with the substrate.
- **Stderr echo for CLI mediation, silent for MCP-stdio**: when the agent invokes `corpus.find` via real MCP-stdio, the response is the MCP tool's `result` — adding `request_id` to that response would be an SP-005 SearchOutput contract change. When the operator invokes via the CLI (e.g., the C-046 e2e smoke harness directly calls `corpus mcp` to issue a `tools/call` for `corpus.find`), the operator NEEDS the `request_id` to subsequently run `corpus accept <request-id>`. Stderr echo (via `process.stderr.write` — not telemetry, just a one-line print) satisfies the CLI mediator without mutating the MCP response. **Detection**: the wrapper checks `process.stderr.isTTY === true` AND the invoking process is not an MCP child (heuristic: no `MCP_TRANSPORT=stdio` env var). Conservative default: NO echo, operator captures from telemetry per Assumption #11.
- **Per spec.md Assumption #11**: "the operator captures `request_id` via `tail -f Paths.telemetry()` or via a future agent-side affordance (e.g., the agent prints the `request_id` after invoking `corpus.find`). For v1, `tail -f` plus copy-paste is acceptable friction; a future-horizon 'agent prints request_id' affordance is out of scope." This decision is consistent with the spec's assumption.

**Alternatives considered**:

- **Amend `SearchOutputZodSchema` to add `request_id`**: REJECTED. Mutates the SP-005 contract for v1; would require an SP-005 ADR amendment + a backward-compat path for existing MCP clients; out of scope per the substrate-stability commitment. The SP-005..SP-007 ADRs are unchanged in SP-008.
- **Generate `request_id` client-side and pass it as a `SearchInput` field**: REJECTED. Mutates the SP-005 `SearchInputZodSchema` (currently `{query, filters?, limit}`). Same out-of-scope concern. Also creates ambiguity about who owns the UUID (client-generated UUIDs are not authoritative — the server is the trust boundary per Constitution V).
- **Hash the `query` + `timestamp` to derive `request_id` deterministically**: REJECTED. Hash collisions would break the foreign-key relationship between `engagement.corpus_find_invoked` and `engagement.acceptance_event`; `randomUUID()` is collision-free for the substrate's lifetime.
- **Reuse the existing `query_hash` field as the engagement key**: REJECTED. `query_hash` collides intentionally (duplicate queries hash identically — the SP-005 contract). The engagement layer needs a per-invocation unique key so the operator can accept ONE specific query's results without accepting all queries with the same text.
- **Generate `request_id` only at the `engagement.corpus_find_invoked` emit site (not shared with `search.query`)**: REJECTED. Forensic value — operators investigating a search failure want to correlate the `search.query` event with the `engagement.corpus_find_invoked` event; a shared `request_id` is the join key. The SP-005 `SearchQueryEvent` gets an additive `request_id?: string` field (optional for backward compat with existing logs; populated by the new emit path).

**Source citations**:

- spec.md FR-ENGAGEMENT-001 verbatim
- spec.md Assumption #11 verbatim
- `packages/contracts/src/search-schemas.ts` line 128-142 (SearchOutput schema)
- `packages/contracts/src/telemetry.ts` line 745-756 (SearchQueryEvent schema)
- `packages/transport/src/corpus-find-tool.ts` (find handler — no request_id generation)
- `packages/transport/src/resource-recent-handler.ts` line 22 (`randomUUID()` pattern)
- `packages/contracts/src/run-tool.ts` line 231 (`randomUUID()` pattern)
- Constitution V (Schema-Enforced Output)
- Constitution X (substrate stability)

---

## Decision B — Acceptance-record persistence

**Decision**: **Telemetry-only.** The operator-attested acceptance state is an append-only `engagement.acceptance_event` line in the existing `Paths.telemetry()` NDJSON log. NO sidecar files under `Paths.state()/engagement/<request_id>.json`; NO new SQL table on the index database. The telemetry log IS the acceptance record, keyed by `request_id`. Duplicate-detection scans the log for prior `engagement.acceptance_event` with the same `request_id`.

**Rationale**:

- **Per spec.md FR-ENGAGEMENT-014 verbatim**: "ZERO new SQL tables and ZERO new `Paths.*` getters in SP-008. The new `engagement.*` events live in the existing NDJSON telemetry log at `Paths.telemetry()`. The operator-attested acceptance state is a forward-only append; no new SQL table, no new column on `documents` or `taxonomy_terms`." Telemetry-only is the spec's explicit decision; this research entry RATIFIES the spec.
- **Telemetry already meets the durability requirement**: the SP-003 atomic-append discipline (Constitution VIII + IX; ≤ 4 KB per line) is the same write surface used by every other state-transition event in the substrate. Acceptance events are state-transition events; routing them through the same surface preserves the SP-003..SP-007 contract.
- **Sidecar files would introduce a new file-discovery requirement**: a `Paths.state()/engagement/<request_id>.json` layout would require the report aggregator to (a) enumerate the directory, (b) parse each file, (c) handle stale/orphaned files (acceptance for a request_id with no matching find event), (d) handle clock-skew across files. Telemetry-only has none of these problems — the file is the log, the order is timestamp-order, the duplicate-detection is a single-pass scan.
- **A new SQL table would violate the substrate-stability commitment**: per spec.md "the substrate schema is frozen post-SP-006"; per FR-ENGAGEMENT-014 verbatim. Adding `engagement_acceptance` would require a schema migration + a backfill story + a new lock-contention surface (the `corpus accept` would need to acquire `Paths.drainLock()` to write). Telemetry-only has none of these.
- **Append-atomicity + ≤ 4 KB-per-line preserved**: the `engagement.acceptance_event` payload is `{event, timestamp, request_id, acceptance_note?}` — well under 4 KB even with a 512-char note. The SP-003 atomic-append discipline handles concurrent writers correctly (the OS-level write atomicity guarantee for `O_APPEND` ≤ 4 KB writes).
- **The report's aggregator already needs to scan telemetry** — for `engagement.corpus_find_invoked` events. Adding `engagement.acceptance_event` to the same scan path is incremental, not net-new.

**Alternatives considered**:

- **Sidecar files at `Paths.state()/engagement/<request_id>.json`**: REJECTED. (i) Introduces a new write surface that needs Constitution VIII atomic-write discipline + a new directory creation step (probably needing a new `Paths.engagement()` getter, violating FR-ENGAGEMENT-020). (ii) The report aggregator would need to enumerate the directory in addition to scanning the telemetry log, doubling the IO surface. (iii) Stale/orphaned files would accumulate (acceptances with no matching find event); the aggregator would need a GC story. None of these problems exist with telemetry-only.
- **New SQL table `engagement_acceptance`**: REJECTED by spec.md FR-ENGAGEMENT-014 verbatim ("ZERO new SQL tables"). Adding it would also require schema migration tooling, a lock-contention surface for writes, and a `corpus accept` flow that depends on the daemon being up (vs. the current decoupled telemetry-write path that works even when the daemon is down).
- **Mixed (telemetry for queries + SQL table for acceptances)**: REJECTED. Splits the source-of-truth across two stores; the aggregator would need to join across them. Worse than either pure option.
- **External operator-managed file (e.g., `~/.acceptances.txt`)**: REJECTED by Constitution XIV (paths must route through `Paths.*`). Telemetry is the only legitimate option for v1.

**Source citations**:

- spec.md FR-ENGAGEMENT-014 verbatim
- spec.md FR-ENGAGEMENT-020 verbatim
- spec.md FR-ENGAGEMENT-002 verbatim ("appends a well-formed `engagement.acceptance_event` to `Paths.telemetry()`")
- spec.md Decision 3 verbatim ("Engagement instrumentation surface: ≥ 3 (effectively 4) new telemetry event classes, additive to TelemetryEvent")
- Constitution VIII (atomic writes)
- Constitution IX (concurrency-safe shared state ≤ 4 KB append atomicity)
- Constitution XIV (paths from resolver only)
- SP-003 atomic-append discipline (`packages/storage/src/telemetry-jsonl.ts`)

---

## Decision C — C-046 end-to-end smoke harness shape for the engagement layer

**Decision**: The C-046 smoke harness for SP-008 lives at `packages/cli/test/engagement-proxy-e2e.test.ts`. It **(a)** creates a tempdir HOME via `CORPUS_HOME=<tempdir>`; **(b)** builds the CLI via `pnpm build`; **(c)** spawns the built binary `node <dist>/bin/corpus.js init --smoke` (the SP-007 smoke gives us a working install + a seeded document + a known-good MCP setup); **(d)** spawns `corpus daemon` and waits for `daemon.started` telemetry; **(e)** spawns 5 separate `corpus mcp`-mediated `corpus.find({query: <fixture-queries>})` calls via real MCP-stdio (NOT library-level handler tests; the harness writes JSON-RPC `tools/call` messages to the spawned `corpus mcp` child's stdin and parses the responses from stdout); **(f)** for each call, captures the `request_id` by tailing the test's `Paths.telemetry()` mid-test for the most recent `engagement.corpus_find_invoked` event; **(g)** for ONE of the returned hits, runs `corpus accept <request-id>` via the production binary; **(h)** runs `corpus engagement-proxy report --format=json --since=<window-start>`; **(i)** parses the JSON output; **(j)** asserts the JSON matches `{verdict: "PASS", queries_in_window: 5, acceptance_events_in_window: 1, kill_signal: false, c028_threshold_met: true}`; **(k)** tears down daemon + MCP child; cleans the tempdir. Ollama-gated per the SP-007 `it.skipIf(!ollamaReachable)` pattern.

**Rationale**:

- **Per FR-ENGAGEMENT-006 verbatim**: the spec mandates the exact harness shape. This research entry RATIFIES the spec.
- **The SP-006 retrospective F-1 root cause is "library-handler tests are not sufficient"**: SP-006's library-level tests passed while the real MCP-stdio transport had a regression that was only caught after merge. SP-007 closed this gap with `packages/cli/test/smoke-e2e.test.ts` (the C-046 origin). SP-008's engagement layer has the same regression class — a library-level test of `acceptance-event-writer.ts` or `report-aggregator.ts` would not catch a real MCP-stdio find-handler instrumentation regression. The e2e harness MUST spawn the built binary + speak real MCP.
- **Spawning 5 real find calls + 1 real accept**: matches the C-028 PASS threshold (≥ 5 queries + ≥ 1 acceptance). Asserting the PASS verdict end-to-end means the entire chain works: find-handler emits `engagement.corpus_find_invoked` → telemetry log captures it → operator captures `request_id` → `corpus accept` finds the find event + appends acceptance event → report scanner reads both → aggregator computes verdict → CLI emits JSON.
- **Ollama-gated skip in CI is acceptable**: per SP-007 FR-INSTALL-024 pattern, CI without Ollama skips the test cleanly (no failure mode). Local dev machines with Ollama run the test unconditionally on every PR.
- **Time budget ≤ 60 s typical, ≤ 90 s ceiling**: matches the SP-007 `--smoke` budget; the 5 real find calls each take ~1-2 s (with Ollama embedding latency), the accept + report take ~50 ms each; teardown ~3 s. The total p95 is well under the SP-007 90-second budget per the dispatch prompt mandate.

**Alternatives considered**:

- **Library-only tests (`acceptance-event-writer.test.ts` + `report-aggregator.test.ts` + `verdict-computer.test.ts`)**: REJECTED as INSUFFICIENT per the SP-006 retrospective F-1 root cause. Library tests are PART OF the SP-008 test suite (per the tests/unit/ files enumerated in plan.md), but they do NOT replace the e2e smoke. Library tests catch logic bugs; the e2e catches transport-cutover-gap bugs.
- **Synthetic-telemetry-only e2e (skip the real MCP-find calls; just seed a tempdir log with synthetic events + run the report)**: REJECTED. Misses the SP-006 retrospective F-1 root cause: the find-handler's `engagement.corpus_find_invoked` emit is the load-bearing instrumentation that the e2e must exercise via real transport. A synthetic-only test would pass even if the find-handler emit were broken.
- **e2e via the existing SP-007 `smoke-e2e.test.ts` (extend it instead of adding a new file)**: REJECTED for test-file clarity — SP-007's smoke verifies install + first `corpus.find`; SP-008's e2e verifies the engagement layer end-to-end. Separate files keep failures attributable to the right sprint.
- **e2e with a real Claude Code agent invocation**: REJECTED for v1 — Claude Code is not deterministic in test contexts (the agent decides when to invoke `corpus.find`); the harness must simulate the agent flow via direct MCP-stdio writes. The "agent invokes corpus.find" scenario (FR-ENGAGEMENT-008) is asserted at the MCP-response level, not at the agent-natural-language level.

**Source citations**:

- spec.md FR-ENGAGEMENT-006 verbatim
- spec.md SC-008-027 verbatim
- SP-006 retrospective F-1 root cause ("transport cutover gap")
- SP-007 `packages/cli/test/smoke-e2e.test.ts` (the C-046 origin harness; SP-008 follows the same pattern)
- SP-007 FR-INSTALL-024 (Ollama-gated CI skip pattern)

---

## Decision D — `corpus accept` UX: explicit `<request-id>` positional only; `--last` rejected for v1

**Decision**: The `corpus accept` CLI subcommand requires an explicit `<request-id>` positional argument. **No `--last` flag for v1**. The operator captures `request_id` via `tail -f Paths.telemetry() | jq '. | select(.event == "engagement.corpus_find_invoked")'` (documented in the post-`/speckit-tasks` quickstart) and copy-pastes it into the `corpus accept <request-id>` invocation. Future-horizon: a `--last` flag could be added in v1.5+ if operator friction surfaces.

**Rationale**:

- **Spec.md Assumption #11 commits to `tail -f` + copy-paste as acceptable friction for v1**: "every `corpus.find` invocation emits an `engagement.corpus_find_invoked` event with `request_id`. The operator captures it via `tail -f Paths.telemetry()` or via a future agent-side affordance (e.g., the agent prints the `request_id` after invoking `corpus.find`). For v1, `tail -f` plus copy-paste is acceptable friction." This decision is consistent with the spec.
- **`--last` introduces stateful semantics the telemetry log doesn't natively support**: "most recent" requires (i) the CLI to know what "most recent" means (per-process? per-session? globally?), (ii) a sidecar tracking the last query (violates FR-ENGAGEMENT-014 + FR-ENGAGEMENT-020 — no new sidecars, no new `Paths.*` getters), or (iii) a scan of the entire telemetry log to find the most-recent `engagement.corpus_find_invoked` (correct semantically but couples `corpus accept` to scanner performance). None of these is good for v1.
- **Explicit `<request-id>` is forensically clean**: the operator's intent is auditable — the receipt of `corpus accept` is an explicit attestation for a specific query. `--last` would muddy the audit trail (which query was accepted? the one in the operator's head, or the one the CLI happened to pick?).
- **Future-horizon is real**: if operator friction surfaces during the 7-day dogfood window or in post-v1 use, a `--last` flag is a small additive change. Documented as future-horizon in spec.md Out of Scope ("`corpus engagement-proxy queries` subcommand (per-query telemetry detail) — out of scope for SP-008").

**Alternatives considered**:

- **`corpus accept --last`** (defaults to most-recent find): REJECTED for v1 per the rationale above. Future-horizon.
- **`corpus accept` with NO positional + auto-pick most recent**: REJECTED. Same problems as `--last` plus footgun (operator might accept an unintended query).
- **`corpus accept @<index>` referencing find events by ordinal in the dogfood-window log**: REJECTED. Operator-hostile (operator has to count); adds a new addressing syntax with no precedent in the CLI.
- **`corpus accept` opens an `$EDITOR` showing recent find events for operator selection**: REJECTED by AG-001 (no TUI / interactive surfaces).
- **`corpus accept` reads `request_id` from `STDIN`** (so the operator can `tail telemetry | jq '.request_id' | head -1 | xargs corpus accept`): NOT REJECTED — this is implicitly available via the shell pipeline; the CLI accepts the positional argument from any source. Documented in the quickstart as an operator-power-user idiom; no new flag needed.

**Source citations**:

- spec.md Assumption #11 verbatim
- spec.md FR-ENGAGEMENT-002 verbatim
- spec.md Out of Scope ("`corpus engagement-proxy queries` subcommand (per-query telemetry detail) — out of scope")
- AG-001 (no TUI / interactive surfaces)

---

## Resolved spec contradictions / drift surfaced at plan-stage

This section records contradictions or description drift in spec.md that plan-stage analysis surfaced. None blocks the plan — all are resolved by Decisions A-D — but they are documented here for the SP-008 PR description + the retrospective.

- **C1 (load-bearing description drift): `SearchOutput.request_id` does not exist.** spec.md FR-ENGAGEMENT-001 + spec.md Key Entities "EngagementCorpusFindInvokedEvent" both assert "request_id matches the SP-005 SearchOutput's request_id". Verification of `packages/contracts/src/search-schemas.ts` confirms SearchOutput has no `request_id` field. **Resolution**: Decision A — generate server-side at find-handler entry; emit in telemetry only; echo to stderr for CLI mediation. Spec.md is NOT amended (the contradiction is a description gap, not a decision blocker; the spec's intent — a per-invocation unique key — is preserved). Future-horizon: amend SP-005 SearchOutput in v1.5+ if cross-agent client-side capture surfaces are added.

- **C2 (minor): `search.query` event has `query_hash` but no `request_id`.** Verified at `packages/contracts/src/telemetry.ts` line 745-756. **Resolution**: Decision A — additively add an OPTIONAL `request_id?: string` field to `SearchQueryEvent` for forensic-join value (backward-compatible — existing emissions without the field still validate). The SP-008 emit path populates the field on every new emission; the engagement-proxy aggregator does NOT depend on the field being populated (it reads `engagement.corpus_find_invoked` directly).

- **C3 (resolved by Decision B): spec.md is internally consistent that NO new sidecar / SQL table is allowed.** FR-ENGAGEMENT-014 + FR-ENGAGEMENT-020 are clear. **Resolution**: telemetry-only persistence; this is not a contradiction, just an explicit confirmation.

- **C4 (minor description-only): spec.md US4 Acceptance Scenario 7 references `--since/--until` window filtering AND Acceptance Scenario 8 references the default window (`now - 7d` to `now`).** Both are unambiguous. **Resolution**: covered by ADR-017's aggregation contract (UTC-normalized `timestamp ∈ [since, until]` filter; defaults `now - 7d` to `now`). No drift.

- **C5 (minor): spec.md FR-ENGAGEMENT-001 caps `query` at 1024 chars + records `query_hash: SHA-256-hex` when truncated; FR-ENGAGEMENT-012 lists `distinct_query_hashes` as an informational aggregate; spec.md Edge Cases caps oversized queries at 1024 chars.** All consistent. **Resolution**: covered by ADR-017's schema definition + spec.md is internally consistent. Implementation note: `query_hash` is ALWAYS populated (whether truncation happened or not) — the field is the join key for grouping duplicate queries; `query_truncated: true` is set only when truncation happened. This matches spec.md Key Entities EngagementCorpusFindInvokedEvent: "`query_hash: SHA-256-hex` (always present, useful for grouping duplicate queries in the report)".

- **C6 (minor): SP-007's `--smoke` already drops a deterministic seed doc via the SP-007 `first-run-seed.md` fixture.** The SP-008 e2e smoke (Decision C) builds on this — it does NOT re-drop a new fixture, it uses the already-seeded smoke doc + queries against it. No drift; just a continuity note for the build.

---

## Decisions summary

| Decision | Choice | Spec contradiction resolved? | Future-horizon |
|---|---|---|---|
| A — request_id sourcing | Server-side `randomUUID()` at find-handler; stderr echo for CLI; telemetry-only emit | Yes (C1 + C2) | Cross-agent client-side capture in v1.5+ |
| B — Acceptance-record persistence | Telemetry-only NDJSON append | Confirms spec FR-ENGAGEMENT-014 | None |
| C — C-046 e2e smoke harness shape | Spawn binary + real MCP-stdio + 5 finds + 1 accept + report verdict | Ratifies spec FR-ENGAGEMENT-006 | None |
| D — `corpus accept` UX | Explicit `<request-id>` positional only; no `--last` | Confirms spec Assumption #11 | `--last` in v1.5+ if friction surfaces |

All decisions are additive to the SP-001..SP-007 substrate; ZERO existing ADRs are amended or superseded.
