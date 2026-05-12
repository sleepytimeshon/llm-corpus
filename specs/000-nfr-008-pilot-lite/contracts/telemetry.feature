# SP-000-Lite Contract: Telemetry Schema, Retention, and Constitutional Compliance
#
# Scenarios cover the per-query telemetry event surface, summary-event
# composition, retention discipline across iterations, and the Constitution
# Principle XIII / XIV / XVI bindings that the telemetry stream embodies.
#
# Mappings: FR-PILOT-005 (event schema + path), FR-PILOT-013 (summary fields
# + soft threshold), FR-PILOT-014 (retention), SC-003 (50 events per iteration,
# zero dropped), SC-006 (Paths.* discipline), Constitution Principle XIII
# (telemetry-or-die), Principle XIV (single resolver), Principle XVI
# (validation honesty / personal-scale qualifier).

Feature: SP-000-Lite telemetry schema and retention

  Background:
    Given `Paths.pilotTelemetry()` resolver key is merged on main
    And the `nfr_008_pilot` event class is registered in `packages/contracts/src/telemetry.ts` Zod schema
    And a pilot run is in flight or has completed

  # ── FR-PILOT-005 schema + SC-003 event count ──

  Scenario: Each telemetry event conforms to the FR-PILOT-005 schema
    When the harness emits a telemetry event for a query turn
    Then the event line is valid JSON
    And the event line is ≤ 4 KB so `O_APPEND` is POSIX-atomic
    And the event carries `event_class == "nfr_008_pilot"`
    And the event carries all of: `severity`, `timestamp`, `run_id`, `iteration`, `model`, `prompt_variant`, `query_id`, `query_bucket`, `retrieval_pattern`, `tool_invoked`, `tool_arguments_valid`, `malformed_call_payload`, `retrieval_outcome`, `duration_ms`
    And the event passes the registered Zod schema validation

  Scenario: Each iteration emits exactly 50 events with zero dropped
    Given the harness has completed an iteration
    When the JSONL file is read back
    Then the file contains exactly 50 lines
    And each line is a valid `nfr_008_pilot` event
    And no event has `severity` downgraded below the actual error severity

  Scenario: Successful turn emits info-severity event
    Given a query turn completes without error
    When the telemetry event is emitted
    Then `severity == "info"`

  Scenario: Malformed tool call emits warn-severity event with payload capture
    Given a query turn produces `tool_invoked == true` AND `tool_arguments_valid == false`
    When the telemetry event is emitted
    Then `severity == "warn"`
    And `malformed_call_payload` is non-null and contains the raw malformed arguments
    And `malformed_call_payload` is bounded to ≤ 2 KB

  Scenario: Non-invocation emits info-severity event with null malformed payload
    Given a query turn produces `tool_invoked == false`
    When the telemetry event is emitted
    Then `severity == "info"`
    And `tool_arguments_valid == false`
    And `malformed_call_payload == null`
    And `retrieval_outcome == "not_invoked"`

  Scenario: Harness-level error (MCP crash, Ollama failure) emits error-severity event to production telemetry
    Given the MCP server crashes mid-run
    When the harness catches the failure
    Then a structured event is emitted to `Paths.telemetry()` (production stream) with `severity == "error"`
    And the event includes hashes (not raw content) of in-flight prompts
    And the catch block does NOT swallow the exception before emitting

  # ── SC-006 / Constitution Principle XIV path discipline ──

  Scenario: Telemetry stream resolves through Paths.pilotTelemetry()
    When the harness writes a telemetry event
    Then the file path equals `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + ".jsonl")`
    And no hardcoded path literal appears in the harness source

  Scenario: Summary file resolves through the same resolver
    When the harness writes the per-iteration summary
    Then the file path equals `path.join(Paths.pilotTelemetry(), "pilot-iter" + iteration + "-summary.json")`

  Scenario: `Paths.pilotTelemetry()` resolves to a directory under state, not under tmp
    When `Paths.pilotTelemetry()` is evaluated
    Then the resolved path equals `path.join(Paths.state(), "pilot-telemetry")`
    And the resolved path is under `$HOME`
    And the resolved path is NOT under `/tmp/`, `/var/`, or `os.tmpdir()`

  Scenario: `Paths.pilotTelemetry()` is distinct from `Paths.telemetry()`
    When both resolvers are evaluated
    Then `Paths.telemetry()` resolves to a single file `{state}/telemetry.jsonl`
    And `Paths.pilotTelemetry()` resolves to a directory `{state}/pilot-telemetry/`
    And the two paths share `Paths.state()` as a common ancestor

  # ── FR-PILOT-014 retention ──

  Scenario: Iteration 2 does NOT delete or overwrite iteration 1 artifacts
    Given iteration 1 has produced `pilot-iter1.jsonl` and `pilot-iter1-summary.json`
    When iteration 2 runs to completion
    Then `pilot-iter1.jsonl` still exists with unchanged content
    And `pilot-iter1-summary.json` still exists with unchanged content
    And `pilot-iter2.jsonl` and `pilot-iter2-summary.json` are newly created
    And all four files coexist under `Paths.pilotTelemetry()`

  Scenario: Harness MUST NOT clean up iteration artifacts on its own
    Given the pilot has resolved via a D-NNN ledger entry
    When inspecting the harness implementation
    Then no code path deletes files under `Paths.pilotTelemetry()`
    And cleanup is documented in quickstart.md as a user-driven manual operation

  # ── FR-PILOT-013 summary fields ──

  Scenario: Summary fields populated correctly
    When the per-iteration summary is written
    Then `headline_n` equals `bucket_invocations.knowledge_grounded`
    And `bucket_counts` equals `{knowledge_grounded: 30, general: 15, adversarial: 5}`
    And `malformed_call_rate_kg` equals `malformed_call_count_kg / 30`
    And `soft_threshold_flag` equals `(malformed_call_count_kg > 10)`
    And `pattern_invocations` carries integer counts for all three retrieval patterns

  # ── Constitution Principle XVI personal-scale qualifier ──

  Scenario: Summary carries personal-scale qualifier identifying model and substrate
    When the per-iteration summary is written
    Then `personal_scale_qualifier` is non-empty
    And `personal_scale_qualifier` contains the literal substring "qwen3:8b"
    And `personal_scale_qualifier` contains the literal substring "personal" OR "Shon"
    And `personal_scale_qualifier` does NOT contain industry-generalization phrasing (e.g., "industry-standard", "benchmark floor", "cross-model")

  Scenario: D-NNN ledger entry inherits the qualifier verbatim
    Given a per-iteration summary exists with a populated `personal_scale_qualifier`
    When Shon writes the D-NNN ledger entry
    Then the entry's `rationale` field contains the qualifier text verbatim (or a strict superset preserving the model + substrate identifiers)

  # ── Constitution Principle XIII no-swallow + severity-correct ──

  Scenario: No wrapper, decorator, or middleware swallows exceptions
    When inspecting the harness source under `packages/cli/src/pilot/` and `packages/pipeline/src/pilot-harness/`
    Then every catch block emits a structured telemetry event before throwing or returning
    And no `try { ... } catch { /* ignore */ }` block exists
    And no severity field is hardcoded to `"info"` or `"debug"` in an error-emission path
