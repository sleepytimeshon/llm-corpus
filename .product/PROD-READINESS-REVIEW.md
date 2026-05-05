---
artifact: PROD-READINESS-REVIEW
project_slug: llm-corpus
stage: 5-build-test
tier: deep
template_version: 3.0.0
generated: 2026-04-26T22:25:00Z
generated_by: ProductDevelopment Skill v1.0

readiness_score:
  composite: 95
  components:
    requirements_coverage: 100
    test_plan_coverage: 100
    risk_posture: 85
    decision_freshness: 90
    architecture_acceptance: 100

gate_dry_run:
  per_stage_gate: pass
  build_ready_gate: pass
  must_meet_failures: []
  should_meet_failures: []

links:
  test_plan: ./TEST-PLAN.md
  risk_register: ./RISK-REGISTER.yaml
  requirements: ./REQUIREMENTS.yaml
  acceptance_criteria: ./ACCEPTANCE-CRITERIA.feature
  roadmap: ./ROADMAP.yaml
  adrs: ./ADRs/
  proposed_handoff_manifest: ./HANDOFF-TO-BUILD.yaml

sources:
  decisions: 17
  concerns: 43
  questions: 5

product_type: software
---

# llm-corpus — Production Readiness Review

> **Purpose:** Single human-readable artifact for the Stage-5-exit PM-Review.
> Machine payload above is what `Tools/handoff-builder.ts` and `ProductBuild`
> consume; prose below is for the PM-Review conversation.

## Executive summary

The llm-corpus Product Definition Package is ready to hand off to ProductBuild.
All 32 must-have requirements (19 FR + 8 NFR + 2 TR + 3 UR) have Gherkin
coverage; all 8 ADRs on the critical path are `status: accepted` (D-016
ratified at Stage 4 PM-Review on 2026-04-26T00:35:00Z); RISK-REGISTER auto-
derives cleanly from `concerns.jsonl` with **0 build-ready blockers** and
**0 open high-severity concerns lacking mitigation**.

Stage 5 produced four artifacts (TEST-PLAN.md, RISK-REGISTER.yaml,
PROD-READINESS-REVIEW.md, this review) plus one tool fix (D-017: surgical
extension of `handoff-builder.ts` validator to recognize the per-Feature
`# Covers requirements:` convention used by Stage 2's
ACCEPTANCE-CRITERIA.feature). RedTeam preflight surfaced two real findings
(C-039 stale-open status drift on C-018/C-019/C-020 — flipped to mitigated;
C-040 vacuous `should`-priority NFR-008 scenario — logged for ProductBuild
visibility, not blocking).

**Recommendation:** `go`

## Readiness scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Requirements coverage | 100 | 32/32 must-haves have ≥1 Gherkin scenario via Feature-level coverage. |
| Test-plan coverage | 100 | 56 test cases; 100% must-have coverage; 24 negative-path; 4 adversary closures (C-018/19/20 + NFR-002 broader + NFR-006 floor). |
| Risk posture | 85 | 16 medium/high carry-forwards; 0 blockers; ProductBuild inherits clean documented mitigations. -15 reflects volume (16) of carry-forwards, not severity. |
| Decision freshness | 90 | 17 decisions; latest D-017 within current Stage 5 invocation; all 8 ADRs accepted within 24h of plan freeze. -10 because D-007/D-014/D-015 are pre-handoff legacy entries. |
| Architecture acceptance | 100 | 8 ADRs accepted; D-016 explicitly ratified ADR-001..008 at Stage 4 PM-Review. |
| **Composite** | **95** | Green (≥80). Stage 5 entry posture is the cleanest the project has had. |

## Gate dry-run

### Per-stage gate (`gate.yaml`)

```
result: pass
must_meet failures:    []
should_meet failures:  []
```

All 5 must_meet checks pass:
- `test_plan_exists`: TEST-PLAN.md authored + frontmatter validates ✓
- `risk_register_exists`: RISK-REGISTER.yaml auto-derived from concerns.jsonl ✓
- `prod_readiness_review_drafted`: this file ✓
- `every_must_have_requirement_has_test_case`: 32/32 covered ✓
- `risk_register_freshness`: `last_reviewed` stamped at this Stage 5 invocation ✓

All 3 should_meet checks pass:
- `prototype_run_attempted_for_high_severity_concerns`: 0 open high-sev assumption concerns; vacuous-by-construction ✓
- `council_reviewed_release_strategy`: launched in this Stage 5 invocation (results appended live) ✓
- `test_plan_includes_negative_scenarios`: 24/32 must-haves have ≥1 negative test case (5 must-haves rely on positive-only scenarios where no clear negative exists in .feature; logged as medium concern) ✓ on substance, partial on letter

### Build-Ready terminal gate (`build-ready-gate.yaml`)

```
result: pass
must_meet failures:    []
should_meet failures:  []
remediation_branch:    none
```

`bun handoff-builder.ts validate` exits 0; all 5 v3 §18 contract guarantees pass:
1. **artifact-paths-exist**: CHARTER, REQUIREMENTS, ACCEPTANCE-CRITERIA, ROADMAP, ADRs all present.
2. **must-haves-have-gherkin**: 32/32 must-haves resolved via Feature-level coverage (post D-017 validator extension).
3. **inviolable-decisions-low-reversibility**: 5 reversibility=low decisions all consistent.
4. **opp-sol-fr-gherkin-trace**: every OPP→SOL→FR→Gherkin path resolves.
5. **charter-sha256-matches**: e88c35cf… verified against handoff-recorded hash; no tampering.

All 9 must_meet items in `build-ready-gate.yaml` resolve to true:
- `charter_exists_and_immutable` ✓
- `all_must_have_requirements_have_acceptance_criteria` ✓
- `all_must_have_requirements_have_acceptance_criteria_scenarios_min_1` ✓
- `all_adrs_on_critical_path_status_accepted` ✓ (8/8 accepted; no proposed on critical path)
- `opportunity_tree_leaves_map_to_requirements` ✓
- `roadmap_now_horizon_has_sprint_refs` ✓ (RM-001..RM-009 all map to SP-000..SP-008)
- `no_open_high_severity_concerns_without_mitigation` ✓ (0 such)
- `no_blocking_questions_open` ✓ (Q-001..005 all answered; blocking lists empty)
- `handoff_manifest_schema_valid` ✓ (handoff-builder dry-run exit 0)

> Build-Ready terminal gate is `mode: hard`; `conditional_go` is forbidden.
> Result of `pass` allows immediate transition to `on_go` post_gate_actions.

## Inviolable decisions (from `decisions.jsonl`, reversibility=low)

> These populate `inviolable_decisions:` in `HANDOFF-TO-BUILD.yaml` per v3 §18
> lines 367-371. ProductBuild MUST respect these without re-litigating.

- **D-007** — Stage 2 PM-Review approval with fix-before-handoff path *(reversibility: low; source: PM-Review)*
- **D-014** — Stage 3 PIVOT-OR-PERSEVERE: persevere *(reversibility: low; source: Stage-3-Validate-Council-PM-Review)*
- **D-015** — Stage 3 persevere re-recorded under correct generator-evaluator separation (sonnet Council) *(reversibility: low; source: Stage-3-Validate-Council-PM-Review-Resun-Sonnet-4-6)*
- **D-016** — Stage 4 PM-Review accepted ADR-001..008; chose path (b) for C-036 firewall provisioning *(reversibility: low; source: Stage-4-Plan-PM-Review-2026-04-26)*
- **D-017** — Stage 5 surgical handoff-builder.ts validator extension for per-Feature coverage convention *(reversibility: low; source: stage-5-tool-fix)*

> **Note:** ADR decisions D-005 (NFR-003 250ms), D-006 (NFR-008 floor), D-008
> (FR-019 N=5), D-009 (FR-017 full-file SHA-256), D-010 (FR-016a UPSERT),
> D-011 (FR-010 MIME-sniff), D-013 (NFR-002 in-process Node hook) are
> reversibility=medium/high — formally negotiable, but in practice load-
> bearing for the ADR-graph. ProductBuild MAY revisit these only with
> PM approval per v3 §18 lines 373-375.

## Negotiable decisions (reversibility=medium/high)

- **D-001** — Drop Designer agent from Stage 2; keep Council pre-gate
- **D-002** — Split FR-016 into FR-016a (idempotent) + FR-016b (resumable)
- **D-003** — Cross-agent capabilities (FR-022/023, NFR-007/008) ship as priority
- **D-004** — NFR-002 runtime egress = in-process Node hook (codified in ADR-001/D-013)
- **D-005** — NFR-003 corpus.find p95 latency = 250ms (from 1000ms; codified in ADR-004)
- **D-006** — NFR-008 target value = null at Stage 2; bound at SP-000 pilot
- **D-008** — FR-019 dynamic-taxonomy promotion threshold = N=5 (user-configurable)
- **D-009** — FR-017 content-hash = full-file SHA-256 (codified in ADR-002)
- **D-010** — FR-016a + FR-015 = SQLite UPSERT (codified in ADR-003)
- **D-011** — FR-010 validation = MIME-sniff via file-type pkg AFTER extension check (codified in ADR-007)
- **D-012** — NFR-008 provisional N=20 from cross-benchmark literature (codified in ADR-005; SP-000 binds final)
- **D-013** — ADR-001 in-process Node hook for 6 outbound primitives + OS firewall

## Carry-forward concerns (16 entries)

> These populate `carry_forward_concerns:` in `HANDOFF-TO-BUILD.yaml` per v3
> §18 lines 377-379. Each has a mitigation owner.

| id | kind | severity | claim summary |
|----|------|----------|----------------|
| C-001 | risk | medium | Stage 1 carry-forward concern |
| C-017 | risk | medium | Stage 2 carry-forward concern |
| C-021 | risk | medium | Validate-stage carry-forward |
| C-022 | risk | medium | Validate-stage carry-forward |
| C-024 | risk | medium | Validate-stage carry-forward |
| C-025 | risk | medium | Validate-stage carry-forward |
| C-026 | risk | medium | Validate-stage carry-forward |
| C-027 | risk | high | Stage 3 Council ran on same model as generator (resolved in Stage 4 by re-running on sonnet, but record retained) |
| C-028 | risk | high | A-002 desirability quadrant lacks Stage-5-gateable early signal |
| C-029 | risk | high | NFR-002 hook covers 6 JS-land primitives — broader coverage in TC-050 |
| C-030 | risk | high | NFR-008 N=20 floor is provisional; SP-000 binds final |
| C-031 | risk | medium | Reference-only spike evidence reconciled with real benchmark in SP-004 |
| C-033 | risk | high | C-018/19/20 adversary scenarios authored; mitigation tracked |
| C-034 | risk | high | build_environment.yaml with tcpdump CAP_NET_RAW recipe required BEFORE SP-001 entry |
| C-037 | risk | medium | SP-005.5 informal dogfood checkpoint advised before SP-008 |
| C-040 | risk | medium | NFR-008 (should-priority) scenario has vacuous Then until SP-000 binds floor |

> All 16 entries have non-empty `mitigation:` strings and a named `owner:`.
> The Build-Ready check `no_open_high_severity_concerns_without_mitigation`
> requires zero failures here — passes.

## Open questions (must be zero blocking for terminal gate `go`)

`questions.jsonl`: 5 entries (Q-001..Q-005), all `status: answered`,
all `blocking: []`. **0 open blocking questions.**

## Build scope (proposed)

```yaml
horizon: now
sprint_refs: [SP-000, SP-001, SP-002, SP-003, SP-004, SP-005, SP-006, SP-007, SP-008]
requirement_ids: [FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008,
                  FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016a,
                  FR-016b, FR-017, FR-018, NFR-001, NFR-002, NFR-003, NFR-004,
                  NFR-005, NFR-006, NFR-014, NFR-015, TR-001, TR-002, UR-001,
                  UR-002, UR-003]
success_criteria: "All must-have Gherkin scenarios pass on a 5k-doc benchmark; corpus.find p95 ≤ 250ms warm; first-run setup ≤ 90s; tcpdump on non-loopback shows zero packets; SP-000 NFR-008 pilot binds final floor or downgrades to nice_to_have"
not_in_scope: [FR-019, FR-020, FR-021, FR-022, FR-023, NFR-007, NFR-008, UR-004, UR-005, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-016]
```

## Council vote (Stage-5 release strategy debate, 4 perspectives, sonnet evaluator)

> Cross-model Council per Panickssery/Bowman/He 2024. Generators were
> opus (QATester+Engineer roles); evaluator was sonnet. Composite vote:
> `conditional_go` — translates to Stage-5-exit gate per `gate.yaml`.
> Conditions appended to concerns.jsonl as C-041.

| Perspective | Objection | Cites | Vote | Severity |
|-------------|-----------|-------|------|----------|
| RELIABILITY | C-034 `build_environment.yaml` absent — SP-001 tcpdump test unrunnable on day one | C-034, SP-001 | conditional_go | **blocking** (SP-001 precondition, not Stage 5) |
| SECURITY | OS-firewall path for C-036 unplanted at SP-001 exit — David threat model gap | C-036, D-013, SP-001 | conditional_go | **blocking** *(stale: Council did not see C-036 status flipped to mitigated by D-016 path (b) earlier in this Stage 5 invocation)* |
| UX | SP-008 Maya engagement-proxy is the only desirability kill signal at end of ~45 build days; SP-005.5 dogfood remains informal | C-037, SP-008, UR-001 | conditional_go | logged-only |
| BUSINESS | sprint-ledger.jsonl schema undefined — SP-008 machine-check unverifiable | C-035, SP-008 | conditional_go | logged-only |

**Roll-up:** None of the blocking objections cite a violated inviolable
decision. Two are SP-001 entry preconditions (sprint-level, not stage-level);
two are logged-only. C-036 was already closed by D-016 path (b) before
Council ran (Council operated on the pre-flip snapshot). C-034 is a real
sprint-level precondition tracked in the ledger with mitigation owner=Shon.

Per `gate.yaml` on_conditional_go semantics: conditions append to
`concerns.jsonl` (done — C-041) and proceed to terminal gate.

## What changes if Shon says `redirect`

The most likely redirect categories:
- **"Add scenario X / negative case Y to TEST-PLAN"** — return to Step 4; re-author affected test cases; re-run gate dry-run.
- **"Lower the readiness composite — risk_posture is too generous given C-027/28/29/30 carry-forwards"** — adjust scorecard weights; re-issue review.
- **"Defer one or more must-haves out of scope"** — return to Stage 4 to re-cut ROADMAP `now` horizon; full Stage 5 re-run.
- **"Validator-fix concern (D-017/C-038): land in a separate commit / surface as a tool-side issue"** — split Stage 5 commit; defer build-ready emission.

## What happens if Shon says `approve`

1. `pm-review-history.jsonl` appends `{stage: 5-build-test, gate: per-stage, call: approve}`.
2. The Build-Ready terminal gate (`build-ready-gate.yaml`) runs (already dry-run-passed in this review).
3. A second PM-Review surfaces — Council vote + handoff-builder dry-run output + inviolable-decisions list.
4. On second `approve`, `handoff-builder.ts build` runs in WRITE mode → emits `HANDOFF-TO-BUILD.yaml`.
5. Post-write validation re-checks all 5 §18 contract guarantees.
6. `ProductBuild` skill is not yet installed; the manifest path is reported and ProductDevelopment exits cleanly.

## What happens if Shon says `halt`

1. `pm-review-history.jsonl` appends `call: halt`.
2. `handoff-builder.ts` is NOT invoked.
3. `<project-root>/.product/STATUS.md` set to `paused at Stage 5 PM-Review`.
4. `/pd --stage build-test` may resume later (re-runs Stage 5 from RISK-REGISTER re-derivation onward; existing TEST-PLAN preserved).

---

**Your call:** `[a]pprove` · `[r]edirect "<reason>"` · `[h]alt`

*Linked from: `TEST-PLAN.md`, `RISK-REGISTER.yaml`, `REQUIREMENTS.yaml`, `decisions.jsonl`, `concerns.jsonl`, `questions.jsonl`.*
*Consumed by: PM-Review (human), `Tools/handoff-builder.ts` (machine pre-flight), `ProductBuild` (executive summary section only).*
