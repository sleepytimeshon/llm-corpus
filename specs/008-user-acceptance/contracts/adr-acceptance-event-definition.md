# ADR-016 — Acceptance Event Definition: Operator-Attested (D2) via `corpus accept <request-id>` CLI

**Feature**: 008-user-acceptance
**Date**: 2026-05-17
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none
**Related ADRs**: ADR-017 (engagement-proxy aggregation contract); SP-005 SearchOutput contract (unchanged); SP-007 ADR-012 (install/uninstall surface — for the dispatcher integration); ADR-001 (local-first egress hook — engagement events are local-only)

## Context

The C-028 mitigation (recorded verbatim in `.product/CHALLENGES.yaml` and re-cited in `.product/SPRINT-PLAN.yaml` SP-008 line 248) requires "≥ 5 corpus.find queries in first 7 days of dogfooding + ≥ 1 acceptance event before Stage 6 gate opens". The mitigation does NOT define what an **acceptance event** IS.

The SP-008 dispatch prompt enumerated three viable definitions:

- **D1 (auto-detected)** — instrument the client (Claude Code / Gemini CLI / Codex CLI) to detect "client read resource X after tool call Y" or "agent emitted text containing a SearchHit snippet".
- **D2 (operator-attested)** — explicit `corpus accept <request-id>` CLI subcommand invoked by the operator after observing a useful result.
- **D3 (proxy/result-count)** — every `corpus.find` with `result_count ≥ 1` automatically counts as an acceptance event.

Spec.md Clarifications Block Decision 1 records the choice: **D2 (operator-attested)**. This ADR formalizes that decision, the rejection rationale for D1 and D3, the `corpus accept` CLI contract, and the relationship to future cross-agent telemetry surfaces.

Without ADR-016:

- The acceptance-event definition is not bound to a specific surface.
- The duplicate-detection contract for `corpus accept` is undocumented.
- The zero-result-query refusal contract is undocumented.
- The relationship between the D2 choice and future cross-agent surfaces (AG-004 future-horizon) is undocumented.
- The "friction is acceptable per Principle IV" rationale is not contract-level.

This ADR codifies all of the above.

## Decision

**Acceptance-event definition for SP-008 v1**: D2 — operator-attested via the `corpus accept <request-id> [--note <text>]` CLI subcommand. The operator EXPLICITLY marks `corpus.find` results that were useful; no implicit detection.

**`corpus accept` CLI contract**:

- **Subcommand**: `corpus accept`. Registered as a verb on the existing `packages/cli/src/index.ts` dispatcher (alongside `mcp`, `daemon`, `drain`, `reenrich`, `reindex`, `init`, `uninstall`, `taxonomy promote`, `failures`).
- **Argument shape**:
  - `<request-id>` — positional, required. UUID v4 format. Validated against `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
  - `--note <text>` — optional. Free-text rationale ≤ 512 chars. Trimmed. Truncation NOT silently applied — Zod rejects oversize at parse time per Constitution V.
- **Validation flow** (Constitution V + X + XI + XIII):
  1. Zod-parse argv against `AcceptArgsZodSchema`. On failure: non-zero exit + clear-remediation stderr; emit `engagement.report_telemetry_parse_failed`-equivalent (or a future-added `accept.args_invalid` event — TBD at build time; the existing telemetry-or-die catch-all covers v1).
  2. Scan `Paths.telemetry()` for the matching `engagement.corpus_find_invoked` event by `request_id` (line-by-line; Zod-parse each line; bounded by AbortSignal + per-invocation timeout). On absent: throw `AcceptUnknownRequestIdError` → non-zero exit + stderr names the unknown `request_id`.
  3. Verify `result_count ≥ 1` on the found event. On zero: throw `AcceptZeroResultQueryError` → non-zero exit + stderr names "cannot accept zero-result query".
  4. Scan for a prior `engagement.acceptance_event` with the same `request_id`. On present: throw `AcceptDuplicateRequestIdError` (informational, NOT a failure) → CLI catches + prints `"already accepted: <request-id> at <ts>"` + exits 0 + NO new event appended (idempotent per Constitution X).
  5. Emit `engagement.acceptance_event` via `emitTelemetry()` with `{event: 'engagement.acceptance_event', timestamp: now(), request_id, acceptance_note?: <note if supplied>}`. Per Constitution VIII + IX (atomic-append; ≤ 4 KB per line).
  6. Print confirmation line to stdout (`"accepted: <request-id> at <ts>"`). Exit 0.

**Rejection of D1 (auto-detected)**:

- D1 would require cross-process visibility into the MCP client's post-response behavior. The MCP protocol does not surface client-side message-handling — the corpus MCP server cannot observe whether the client (Claude Code / Gemini CLI / Codex CLI) read resource X after tool call Y, or whether the agent emitted text containing a SearchHit snippet.
- Detecting "agent emitted text containing a SearchHit snippet" requires either (a) parsing the agent's response (which lives outside the corpus server's process boundary, outside the MCP protocol surface, in the client's session) or (b) instrumenting the client itself (which requires per-client integrations — Claude Code, Gemini CLI, Codex CLI all behave differently and each would need its own affordance).
- Per AG-004 (cross-agent registration is out of scope for v1) + OOS-011 (cross-agent surface is out of scope for v1), per-client instrumentation is FORBIDDEN for v1.
- D1 is therefore not implementable for v1.

**Rejection of D3 (proxy/result-count)**:

- D3 would count every `corpus.find` with `result_count ≥ 1` as an acceptance event.
- This conflates "got results" with "results were useful". A corpus that returns 5 irrelevant SearchHits for a poorly-worded query would inflate the metric.
- The C-028 mitigation literally requires "**acceptance** event" — a quality filter, not a recall filter.
- D3 is therefore semantically wrong for the C-028 mitigation.

**Why D2 is correct for v1**:

- Friction-bearing but trustworthy. The operator is the SOLE authority on usefulness, per Principle IV (single-user, single-machine).
- The friction (operator explicit attestation) is acceptable for a Stage-5 early-signal gate on a single-user, single-machine substrate; the operator has no incentive to game on themselves.
- D2 may evolve in v1.5+ as cross-agent surfaces ship per AG-004; D1's feasibility may improve once a per-client telemetry surface exists. For v1, D2 is correct.

**Forward compatibility with future cross-agent surfaces** (AG-004 future-horizon):

- The `corpus accept` CLI is additive to whatever future auto-detection might exist. If v1.5+ ships a per-client telemetry surface, D1-style auto-detection events could be added as a NEW event class (`engagement.auto_detected_acceptance`); the aggregator would count both classes toward `acceptance_events_in_window`. The aggregator's deduplication by `request_id` would handle overlap (if both D1 and D2 fire for the same query, only the first counts).
- The `corpus accept` CLI does NOT need to be deprecated when D1 ships; operators retain explicit attestation as the authoritative path.

**No MCP exposure** (Constitution III + spec.md FR-ENGAGEMENT-013):

The `corpus accept` is a CLI subcommand, NOT an MCP tool. ZERO new MCP mutation surfaces. The substrate's existing SP-002 four resources + SP-006 `corpus://failures` are read-only and unchanged.

**Local-only** (Constitution I + spec.md FR-ENGAGEMENT-015):

The `corpus accept` flow operates exclusively on `Paths.telemetry()` and is local-only. ZERO outbound network calls. ZERO telemetry shipping.

## Consequences

**Positive**:

- Closes the C-028 mitigation requirement with a concrete, implementable contract.
- Preserves Constitution III (substrate, not surface) — no new MCP mutation surface.
- Preserves Constitution I (local-first, no egress) — local-only file IO.
- Preserves Constitution IV (single-user, single-machine) — the operator is the trust boundary.
- Preserves Constitution X (idempotent transitions) — duplicate accept is a no-op.
- Preserves Constitution V (schema-enforced output) — every event Zod-validates.
- The audit trail is permanent + forensically clean (telemetry NDJSON append-only).
- Friction is documented honestly per Constitution XVI; the operator chooses when to attest.

**Negative**:

- Operator must capture `request_id` via `tail -f Paths.telemetry()` (per spec.md Assumption #11). The friction is acceptable but real.
- The metric is gameable by the operator (5 fake queries + 1 fake accept clears the gate); documented honestly per Constitution XVI as a Stage-5 early-signal proxy, NOT a fraud-resistant adoption measurement.
- D1-style auto-detection cannot ship in v1 (cross-agent surface gate per AG-004).

**Neutral**:

- The acceptance-event surface is CLI-only by Constitution III; agents querying `corpus://taxonomy` or other read-only resources see the substrate state independent of acceptance events (which live in telemetry only).
- The `acceptance_note` field is for the operator's own forensic value — it does NOT influence the metric.

## Alternatives considered

- **D1 (auto-detected)**: REJECTED per the rejection rationale above. Cross-process / cross-agent visibility is out of scope for v1.
- **D3 (proxy/result-count)**: REJECTED per the rejection rationale above. Conflates recall with usefulness.
- **D2 + D3 hybrid (D3 as the default; D2 as an opt-in override)**: REJECTED. The C-028 mitigation requires a quality filter; defaulting to recall undermines the gate.
- **`corpus accept --last`** (defaults to most-recent find): REJECTED for v1 (research.md Decision D). Stateful semantics that the telemetry log doesn't natively support. Future-horizon.
- **`corpus accept` opens an `$EDITOR` showing recent finds for selection**: REJECTED by AG-001 (no TUI / interactive surfaces).
- **`corpus accept` as an MCP tool (agent can self-attest)**: REJECTED by Constitution III + spec.md FR-ENGAGEMENT-013 (no new MCP mutation surfaces) + the trust model (the operator is the authority, not the agent).
- **No `--note` flag (acceptance is binary; no rationale)**: REJECTED — the operator's free-text note has forensic value at RETROSPECTIVE.md time + costs nothing (≤ 512 chars; Zod-validated).
- **`acceptance_note` influences the metric (e.g., weighted acceptance)**: REJECTED — the metric is a flat count; weighting introduces footgun + operator-cognitive-load with no clear benefit for the Stage-5 early-signal gate.

## Compliance / verification

- **Tests**:
  - `tests/unit/engagement-accept-args.test.ts` (Zod parsing + UUID validation + note-length cap)
  - `tests/unit/engagement-accept-writer.test.ts` (find-event match + unknown-request_id error + zero-result error + duplicate-detection idempotency + emit path)
  - `packages/cli/test/engagement-proxy-e2e.test.ts` (the C-046 end-to-end smoke; real `corpus accept` invocation against the production binary; verdict assertion)
- **Telemetry**: 2 event classes (`engagement.acceptance_event` — success path; the existing `engagement.report_telemetry_parse_failed` / future `accept.args_invalid` for failure paths). Each Zod-validated against the `TelemetryEvent` discriminated union.
- **Lint**: `no-process-exit-in-libs` (Constitution XI) over `packages/cli/src/engagement/acceptance-event-writer.ts`; `process.exit` only in `packages/cli/src/accept-command.ts`.
- **Trigger to revisit**: operator demand for `--last` flag, or for `corpus reject` (out-of-scope per spec.md), or shipping of per-client telemetry surfaces (AG-004 future-horizon — would enable D1-style auto-detection as an additive event class), or operator demand for negative attestations (rejected useful query) would open an ADR-016 superseder or a sibling ADR.
