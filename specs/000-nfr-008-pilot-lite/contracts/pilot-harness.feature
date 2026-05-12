# SP-000-Lite Contract: Pilot Harness Behavior
#
# Scenarios cover the end-to-end harness invocation surface: starting,
# iterating, halting, and producing the terminal artifacts that discharge
# ADR-010's binary exit gate.
#
# Mappings: FR-PILOT-001 (50-query drive), FR-PILOT-004 (single-variant
# + ≤1 iteration), FR-PILOT-005 (telemetry emission — partial coverage;
# fuller coverage in telemetry.feature), FR-PILOT-006 (path discipline),
# FR-PILOT-007 (terminal artifact), FR-PILOT-008 (personal-scale qualifier),
# FR-PILOT-013 (summary fields + soft threshold), FR-PILOT-014 (retention),
# SC-001 (binary exit closure), SC-004 (personal-scale qualifier in terminal),
# SC-005 (SP-003 unblock sequencing).

Feature: SP-000-Lite pilot harness end-to-end behavior

  Background:
    Given `qwen3:8b` is pulled on the build environment
    And the SP-001/SP-002 MCP server is operational over stdio
    And the `corpus.find` tool and four `corpus://` resources are advertised
    And `Paths.pilotTelemetry()` resolver key is merged on main and resolves to "{state}/pilot-telemetry/"
    And the 50-query set in `specs/000-nfr-008-pilot-lite/queries.yaml` passes the stratification linter
    And Q3 retrieval-pattern DRAFT definitions are ratified per FR-PILOT-012

  # ── FR-PILOT-001, FR-PILOT-004, FR-PILOT-005, SC-003 ──

  Scenario: Iteration 1 runs cleanly and produces a summary with headline N
    When Shon runs `corpus pilot run --variant v1 --iteration 1`
    Then the harness drives exactly 50 query turns through `qwen3:8b`
    And the harness emits exactly 50 `nfr_008_pilot` telemetry events to `Paths.pilotTelemetry()/pilot-iter1.jsonl`
    And the harness writes `Paths.pilotTelemetry()/pilot-iter1-summary.json` atomically
    And the summary contains `headline_n` ∈ [0, 30]
    And the summary contains `bucket_counts == {knowledge_grounded: 30, general: 15, adversarial: 5}`
    And the summary `model` field equals `"qwen3:8b"`
    And the summary `prompt_variant` field equals `"v1"`

  # ── FR-PILOT-004 escalation gate ──

  Scenario: Iteration 1 lands at N ≥ 15; iteration 2 is NOT required
    Given iteration 1 has completed with `headline_n` ≥ 15
    When Shon writes a D-NNN entry committing the iteration-1 headline N
    Then ADR-010's binary exit gate closes at iteration 1
    And iteration 2 is NOT invoked

  Scenario: Iteration 1 lands at N < 15; iteration 2 with revised variant is permitted
    Given iteration 1 has completed with `headline_n` < 15
    When Shon runs `corpus pilot run --variant v2-revised --iteration 2`
    Then the harness drives exactly 50 query turns with the revised variant
    And the iteration-1 artifacts `pilot-iter1.jsonl` and `pilot-iter1-summary.json` are NOT deleted or overwritten
    And the harness writes `Paths.pilotTelemetry()/pilot-iter2.jsonl` and `pilot-iter2-summary.json`

  Scenario: Iteration 3+ is rejected at CLI argument validation
    When Shon runs `corpus pilot run --variant v3 --iteration 3`
    Then the harness exits non-zero with a clear error message citing ADR-010 scope
    And no telemetry file is created for iteration 3

  # ── FR-PILOT-013 soft threshold (informational only) ──

  Scenario: Malformed-call rate exceeds 10/30 on KG bucket; soft threshold flag fires
    Given an iteration's KG bucket has 12 queries with `tool_invoked == true` AND `tool_arguments_valid == false`
    When the summary is written
    Then the summary `malformed_call_count_kg` equals 12
    And the summary `soft_threshold_flag` equals `true`
    And the binary exit decision remains parameterized on `headline_n` alone (no auto-escalation)

  Scenario: Malformed-call rate at or below 10/30; soft threshold flag does not fire
    Given an iteration's KG bucket has 10 queries with `tool_invoked == true` AND `tool_arguments_valid == false`
    When the summary is written
    Then the summary `malformed_call_count_kg` equals 10
    And the summary `soft_threshold_flag` equals `false`

  # ── FR-PILOT-006 path discipline ──

  Scenario: Harness writes ONLY under `Paths.*` resolved paths
    When Shon runs `corpus pilot run --variant v1 --iteration 1`
    Then no write occurs to `/tmp/`, `/var/`, `os.tmpdir()`, or any path outside `$HOME`
    And no hardcoded path literal appears in the harness implementation under `packages/cli/src/pilot/` or `packages/pipeline/src/pilot-harness/`
    And every artifact file resolves through either `Paths.pilotTelemetry()` or `Paths.telemetry()`

  # ── FR-PILOT-007, FR-PILOT-008, SC-001, SC-004 ──

  Scenario: Pilot resolves via D-NNN commit-final-N entry (terminal artifact A)
    Given the pilot has completed iteration 1 with `headline_n == 18`
    When Shon writes a `decisions.jsonl` D-NNN entry committing `N=18` as the personal-scale floor for NFR-008
    Then the entry's rationale field contains an explicit personal-scale qualifier identifying `qwen3:8b` AND the substrate
    And the entry does NOT contain unqualified industry-standard phrasing
    And `Pilot Run.terminal_artifact_id` is updated to `"D-NNN"`
    And ADR-010's binary exit gate is closed

  Scenario: Pilot resolves via NFR-008 downgrade entry (terminal artifact B)
    Given the pilot has completed iteration 2 with `headline_n == 11`
    When Shon writes a `decisions.jsonl` D-NNN entry downgrading NFR-008 from `priority: should` to `priority: nice_to_have`
    Then the entry cites ADR-010 §Decision and the iteration-1 + iteration-2 telemetry files as evidence
    And the entry's rationale contains the personal-scale qualifier
    And ADR-010's binary exit gate is closed

  Scenario: Pilot resolves via full-SP-000 escalation entry (terminal artifact C)
    Given both iterations completed but produced ambiguous signal Shon judges insufficient
    When Shon writes a `decisions.jsonl` D-NNN entry escalating to full SP-000 per ADR-005 alternative 1
    Then the entry cites ADR-010 §Decision AND ADR-005 §Decision
    And the entry triggers a follow-up SP-000-extended spec (Llama family + Qwen2.5 family)
    And ADR-010's binary exit gate is closed by the escalation commitment

  # ── SC-005 sequencing ──

  Scenario: SP-003 (ingest) is blocked until binary exit closes
    Given ADR-010's binary exit gate is open
    When the SP-003 spec PR is opened
    Then CI rejects the PR with a clear pointer to ADR-010 §Sequencing
    And the SP-003 PR may only re-open after a terminal D-NNN entry exists

  # ── Failure modes ──

  Scenario: `qwen3:8b` is not loadable; pilot halts cleanly
    Given Ollama is running but `qwen3:8b` is not pulled (or disk full)
    When Shon runs `corpus pilot run --variant v1 --iteration 1`
    Then the harness emits a structured telemetry event to `Paths.telemetry()` with severity `error`
    And the harness exits non-zero without substituting a different model
    And no `pilot-iter*.jsonl` file is created

  Scenario: MCP server crash mid-pilot
    Given the harness is mid-run after emitting 22 events
    When the MCP server process exits unexpectedly
    Then the harness emits a structured `error`-severity telemetry event capturing the crash
    And any partial JSONL records already written remain on disk
    And the harness exits non-zero within 2 seconds
    And resumption from the partial state is NOT attempted (a re-run starts from query 1)
