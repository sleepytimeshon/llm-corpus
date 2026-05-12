# Phase 1 Data Model: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)
**Date**: 2026-05-11

This document formalizes the four entities enumerated in spec.md `## Key Entities`. For each: field types, invariants, lifecycle, and the file/path where instances are persisted. All on-disk artifacts route through `Paths.*` per Constitution Principle XIV; the new `Paths.pilotTelemetry()` resolver key (PREREQ-001 in plan.md) is the load-bearing dependency.

---

## Entity 1 — Pilot Run

A single end-to-end execution of the SP-000-lite harness — one operator action, one iteration (1 or 2 per FR-PILOT-004), one prompt variant.

### Fields

| Field | Type | Notes |
|---|---|---|
| `run_id` | `string` (UUIDv4) | Generated at harness start; stable for the run's lifetime. |
| `model` | `string` literal `"qwen3:8b"` | Constitution-bound (ADR-010 §Decision). Pilot halts cleanly if a different model is detected. |
| `prompt_variant` | `string` | Identifier like `"v1"` (iteration 1 default) or `"v2-revised"` (iteration 2 if invoked). Free-form but stable per run. |
| `iteration` | `1 \| 2` | Integer. iteration ≥ 3 is FORBIDDEN by ADR-010 scope and rejected at harness CLI argument validation. |
| `started_at` | `string` (ISO-8601 UTC) | Set at harness start. |
| `completed_at` | `string \| null` (ISO-8601 UTC) | Set at harness completion. `null` if the run aborted (SIGTERM/SIGINT) before completion. |
| `query_set_id` | `string` | Hash of `specs/000-nfr-008-pilot-lite/queries.yaml` at run time (SHA-256, hex-encoded, first 16 chars). Ties the run's results to a specific authored query set. |
| `query_set_path` | `string` | Repo-relative path to `queries.yaml` at run time. |
| `substrate_id` | `string` literal `"personal-curated-32pdf-sampler"` | Frozen identifier for the substrate enumerated in spec.md `## Substrate File List`. Future SP-000-extended runs use a different `substrate_id`. |
| `terminal_artifact_id` | `string \| null` | Set post-pilot when Shon writes the D-NNN entry that closes the binary exit gate. Format: `"D-NNN"` matching the `decisions.jsonl` ledger entry. `null` until the entry is committed. |
| `personal_scale_qualifier` | `string` | Free-text qualifier preserved verbatim in downstream artifacts. Seeded by the harness with: `"Shon's workflow on qwen3:8b against his personal-curated-32pdf-sampler substrate; NOT an industry-standard floor."` Editable by Shon before D-NNN commit. |

### Invariants

- `iteration == 2` is only valid if a Pilot Run with `iteration == 1` and the same `query_set_id` exists and produced `N < 15` (FR-PILOT-004 escalation gate).
- `terminal_artifact_id` MAY remain `null` indefinitely (in case of the binary exit being discharged via NFR-008 downgrade or full SP-000 escalation, the corresponding D-NNN entry IDs still apply but the field is updated post-hoc to point to whichever entry closed the gate).
- `model == "qwen3:8b"` is hard-bound; harness rejects any other model identifier per ADR-010 §Decision and the spec Edge Case `qwen3:8b unavailable on build environment at pilot time`.

### Lifecycle

1. Harness CLI invocation parses `--variant` + `--iteration` flags; constructs the `Pilot Run` instance in memory.
2. Harness emits a `pilot_run_started` telemetry event (production telemetry stream `Paths.telemetry()`).
3. Harness loops through 50 queries (one Query Event per turn — see Entity 3).
4. Harness writes Pilot Summary (Entity 4) on completion or persists partial summary on graceful abort.
5. Harness emits `pilot_run_completed` (success) or `pilot_run_aborted` (SIGTERM/SIGINT/MCP-crash) telemetry event.
6. Pilot Run instance is fully realized in the per-iteration summary JSON; no standalone "run record" file is written — the summary IS the run record.

### Persistence

- The Pilot Run is embodied in `Paths.pilotTelemetry()/pilot-iter{iteration}-summary.json` (one file per iteration). Both iteration 1 and iteration 2 files coexist per FR-PILOT-014.
- A summary cross-references the 50 telemetry events in `Paths.pilotTelemetry()/pilot-iter{iteration}.jsonl`.

---

## Entity 2 — Query

One of the 50 stratified queries authored for the pilot. Queries live in `specs/000-nfr-008-pilot-lite/queries.yaml` (per spec.md US2 Independent Test) and are loaded by the harness at run start. The query set is curated once and held stable across iteration 1 and iteration 2.

### Fields

| Field | Type | Notes |
|---|---|---|
| `query_id` | `string` | Stable identifier, e.g., `"kg-001"`, `"g-007"`, `"adv-003"`. Bucket prefix encodes `query_bucket`. |
| `query_text` | `string` | The actual user-style prompt sent to `qwen3:8b`. |
| `query_bucket` | `"knowledge_grounded" \| "general" \| "adversarial"` | Per FR-PILOT-002 (30/15/5 stratification). |
| `retrieval_pattern` | `"factual_lookup" \| "recall_by_context" \| "multi_doc_synthesis" \| null` | Non-null ONLY for `query_bucket == "knowledge_grounded"`. Per FR-PILOT-003, all three values MUST appear at least once across the 30 KG queries. |
| `expected_corpus_relevance` | `boolean` | `true` for `knowledge_grounded`; `false` for `general` + `adversarial`. Used in analysis only; NOT used by harness decision logic (per Edge Case "retrieval-quality measurement is OOS-012"). |
| `provenance` | `string` | Where the query came from. Per FR-PILOT-011: `"mined-from-MEMORY-WORK"` for the 30 KG; `"hand-crafted-general"` for the 15 G; `"hand-crafted-adversarial"` for the 5 A. |
| `worked_example_for` | `string \| null` | Set to the retrieval-pattern label IF this query is one of the 2 worked examples committed in spec.md `## Retrieval Pattern Operational Definitions`; null otherwise. Used by the stratification linter (FR-PILOT-003 worked-example-verbatim check). |

### Invariants

- Exactly 30 queries with `query_bucket == "knowledge_grounded"`, 15 with `general`, 5 with `adversarial` (FR-PILOT-002). Stratification linter (`packages/pipeline/src/pilot-harness/stratification.ts`) enforces.
- All three `retrieval_pattern` values appear at least once among the 30 KG queries (FR-PILOT-003).
- Each `retrieval_pattern` has at least 2 queries with `worked_example_for == <that pattern>`, and those queries' `query_text` matches the verbatim text in spec.md `## Retrieval Pattern Operational Definitions` (FR-PILOT-003 worked-example verbatim verification).
- `query_id` is unique across the 50.

### Lifecycle

- Curated once by Shon (with Engineer assist on the 30 KG mining per FR-PILOT-011); committed to `specs/000-nfr-008-pilot-lite/queries.yaml`.
- Q3 DRAFT ratification (per FR-PILOT-012) gates the linter's pattern-definitions check — the linter cannot pass until the DRAFT is ratified in the PR walkthrough.
- Reused verbatim across iteration 1 and iteration 2 (per FR-PILOT-004 — only the prompt variant changes, not the query set).

### Persistence

- `specs/000-nfr-008-pilot-lite/queries.yaml` (NOT under `Paths.*` because this is per-feature spec content, not runtime state — repo-tracked alongside spec.md). The harness reads this file at run start and hashes it into `Pilot Run.query_set_id`.

---

## Entity 3 — Pilot Telemetry Event

One event emitted per query turn during a Pilot Run. Conforms to Constitution Principle XIII (structured fields, severity-correct, no swallowing). Schema is registered as event class `nfr_008_pilot` in `packages/contracts/src/telemetry.ts` (PREREQ-002 in plan.md).

### Fields (per FR-PILOT-005)

| Field | Type | Notes |
|---|---|---|
| `event_class` | `string` literal `"nfr_008_pilot"` | Registered Zod-validated event class. |
| `severity` | `"info" \| "warn" \| "error"` | Constitution XIII: severity matches actual outcome. Successful turn = `info`; malformed call = `warn`; MCP crash = `error`. |
| `timestamp` | `string` (ISO-8601 UTC) | Emit time. |
| `run_id` | `string` | Cross-reference to Pilot Run. |
| `iteration` | `1 \| 2` | Cross-reference to Pilot Run. |
| `model` | `string` literal `"qwen3:8b"` | Frozen per ADR-010. |
| `prompt_variant` | `string` | E.g., `"v1"`. |
| `query_id` | `string` | Cross-reference to Query. |
| `query_bucket` | `"knowledge_grounded" \| "general" \| "adversarial"` | Cross-reference to Query. |
| `retrieval_pattern` | `"factual_lookup" \| "recall_by_context" \| "multi_doc_synthesis" \| null` | Cross-reference to Query. Null for non-KG buckets. |
| `tool_invoked` | `boolean` | `true` if the LLM emitted a tool call to `corpus.find`, regardless of argument validity; `false` if the LLM answered without invoking the tool. |
| `tool_arguments_valid` | `boolean` | `true` if the emitted tool call had schema-valid arguments per the SP-002 `corpus.find` Zod schema; `false` if malformed. Defined only when `tool_invoked == true`; default `false` when `tool_invoked == false`. |
| `malformed_call_payload` | `string \| null` | Raw malformed arguments string captured when `tool_arguments_valid == false`. `null` otherwise. Bounded to ≤ 2 KB to keep the event line ≤ 4 KB (Principle IX POSIX-atomic append). |
| `retrieval_outcome` | `string` | Opaque to this pilot per spec (AG-005 binding). Records the SP-002 `corpus.find` response summary (count of hits, first hit doc_id) or `"not_invoked"` if `tool_invoked == false`. Not used by binary exit logic. |
| `duration_ms` | `integer` | Wall-clock time from LLM prompt-send to event-emit. |

### Invariants

- Exactly 50 events per iteration (one per query). SC-003 verifies zero are dropped or downgraded.
- Each line of the JSONL file is one valid JSON object conforming to this schema.
- Each event line ≤ 4 KB so `O_APPEND` is POSIX-atomic per Constitution Principle IX. The `malformed_call_payload` field is bounded specifically to keep the line under budget.
- `tool_invoked == false` implies `tool_arguments_valid == false` and `malformed_call_payload == null` and `retrieval_outcome == "not_invoked"`.
- `tool_invoked == true` AND `tool_arguments_valid == false` implies `malformed_call_payload` is a non-null bounded string capturing the raw payload for later prompt-template diagnosis.

### Lifecycle

- Emitted exactly once per query turn during the harness's 50-query loop.
- Persisted via append-only POSIX-atomic write to `Paths.pilotTelemetry()/pilot-iter{iteration}.jsonl`.
- Read post-run by the summary writer to produce the per-iteration summary.
- Retained indefinitely (FR-PILOT-014); the harness MUST NOT delete or overwrite. Manual user cleanup permitted after D-NNN commit.

### Persistence

- `Paths.pilotTelemetry()/pilot-iter{iteration}.jsonl` — newline-delimited JSON, one event per line. Both `pilot-iter1.jsonl` and (if produced) `pilot-iter2.jsonl` coexist for the lifetime of the pilot.

---

## Entity 4 — Pilot Summary

One summary written per Pilot Run on completion. Captures the headline N value, per-bucket invocation counts and rates, per-retrieval-pattern invocation counts, the malformed-call rate, the soft-threshold flag, and the free-text qualitative section seeded for the D-NNN ledger entry.

### Fields (per FR-PILOT-013)

| Field | Type | Notes |
|---|---|---|
| `summary_schema_version` | `string` literal `"1.0.0"` | Pinned at SP-000-lite ship; bumped on amendment. |
| `run_id` | `string` | Cross-reference to Pilot Run. |
| `iteration` | `1 \| 2` | Cross-reference. |
| `model` | `string` literal `"qwen3:8b"` | Frozen. |
| `prompt_variant` | `string` | E.g., `"v1"` / `"v2-revised"`. |
| `query_set_id` | `string` | Hash of `queries.yaml` at run time. |
| `substrate_id` | `string` literal `"personal-curated-32pdf-sampler"` | Frozen. |
| `started_at` | `string` (ISO-8601 UTC) | From Pilot Run. |
| `completed_at` | `string \| null` (ISO-8601 UTC) | From Pilot Run. |
| `headline_n` | `integer` | Count of KG queries where `tool_invoked == true`. Range `[0, 30]`. THIS is the value committed to the D-NNN ledger entry. |
| `bucket_counts` | `{ knowledge_grounded: 30, general: 15, adversarial: 5 }` | Static per FR-PILOT-002; emitted for cross-check. |
| `bucket_invocations` | `{ knowledge_grounded: integer, general: integer, adversarial: integer }` | Per-bucket count where `tool_invoked == true`. |
| `bucket_rates` | `{ knowledge_grounded: float, general: float, adversarial: float }` | Per-bucket invocation rate (count/total). |
| `pattern_invocations` | `{ factual_lookup: integer, recall_by_context: integer, multi_doc_synthesis: integer }` | Per-retrieval-pattern count of `tool_invoked == true` within the KG bucket. |
| `malformed_call_count_kg` | `integer` | Count of KG queries where `tool_invoked == true` AND `tool_arguments_valid == false`. Range `[0, 30]`. |
| `malformed_call_rate_kg` | `float` | `malformed_call_count_kg / 30`. |
| `soft_threshold_flag` | `boolean` | `true` IFF `malformed_call_count_kg > 10`. Per FR-PILOT-013 the flag is informational ONLY — does NOT force escalation. |
| `personal_scale_qualifier` | `string` | Verbatim copy of `Pilot Run.personal_scale_qualifier`. Inherited by the D-NNN ledger entry. |
| `qualitative_notes` | `string` | Free-text section captured during/after the run for inclusion in the D-NNN entry's rationale (per spec.md Pilot Summary entity definition). Edited by Shon before D-NNN commit. |

### Invariants

- `headline_n` equals `bucket_invocations.knowledge_grounded`.
- `bucket_counts` exactly matches the spec'd stratification (30/15/5) — any deviation indicates a stratification linter failure that should have blocked the run.
- `malformed_call_count_kg` ≤ `bucket_invocations.knowledge_grounded` (an event can't be malformed without first being invoked).
- `soft_threshold_flag` is set deterministically from `malformed_call_count_kg`; the harness MUST NOT manually toggle it.
- `personal_scale_qualifier` is non-empty and contains explicit reference to `qwen3:8b` AND to the substrate identifier — verified by a contract test (`tests/contract/sp000-lite/qualifier-presence.test.ts`).

### Lifecycle

1. Constructed at harness completion by reading back the per-iteration JSONL stream.
2. Written atomically (`tmp + fsync + rename + dirsync`) to `Paths.pilotTelemetry()/pilot-iter{iteration}-summary.json` per Constitution Principle VIII.
3. Read by Shon during the binary-exit-discharge step (manual): summary contents inform the D-NNN ledger entry that closes the gate.

### Persistence

- `Paths.pilotTelemetry()/pilot-iter{iteration}-summary.json` (one file per iteration; both retained per FR-PILOT-014).

---

## Cross-entity dependency graph

```text
specs/.../queries.yaml  (Query[50], curated; ratifies Q3 in PR walkthrough)
        │
        │  hashed at run start
        ▼
Pilot Run  ──emits 50──▶  Pilot Telemetry Event[]
        │                       │
        │                       │  read back at run end
        │                       ▼
        └────────────────▶ Pilot Summary
                                │
                                │  inspected by Shon
                                ▼
                    decisions.jsonl D-NNN entry  (terminal artifact; closes ADR-010 binary exit)
                                │
                                │  back-fills
                                ▼
              Pilot Run.terminal_artifact_id (= "D-NNN")
```

## Path summary (all routed via `Paths.*` per Principle XIV)

| Artifact | Path | Resolver |
|---|---|---|
| 50-query set | `specs/000-nfr-008-pilot-lite/queries.yaml` | Repo-relative (per-feature spec content; NOT runtime state). |
| Telemetry stream (per iteration) | `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` | `Paths.pilotTelemetry()` (NEW resolver key — PREREQ-001). |
| Summary (per iteration) | `Paths.pilotTelemetry()/pilot-iter{N}-summary.json` | Same. |
| Harness-level error telemetry | `Paths.telemetry()` | Existing resolver. |
| D-NNN ledger entry | `.product/ledgers/decisions.jsonl` | Existing project ledger (NOT routed via `Paths.*` because it is repo-tracked, NOT runtime state). |

The `Paths.pilotTelemetry()` resolver key resolves to `{state}/pilot-telemetry/` (a directory), composing from `Paths.state()` and introducing no new XDG base. Its addition to `packages/contracts/src/paths.ts` is the load-bearing PREREQ-001 captured in plan.md for `/speckit-tasks` — NOT performed here per the anti-scope constraint on this `/speckit-plan` invocation.
