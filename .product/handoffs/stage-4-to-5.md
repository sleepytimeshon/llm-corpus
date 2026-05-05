---
artifact: HANDOFF
project_slug: llm-corpus
stage: 4-plan
from_stage: 4-plan
to_stage: 5-build-test
charter_ref: ../CHARTER.md
charter_sha256: e88c35cf18803a93574b6637000d7abcfe42f28e49422147c6553dc7d2c8b045
template_version: 3.0.0
generated: 2026-04-26T00:40:00Z
generated_by: ProductDevelopment Skill v1.0
tier: deep
size_budget_bytes: 3072
size_budget_mode: soft_warn
ledger_snapshot:
  decisions: 16 total (D-001..D-016); D-016 records Stage 4 gate
  concerns: 37 total; 7 high open carry-forward (C-027/028/029/030/032/033/034/036); 4 medium open (C-031/035/037 + others)
  questions: 5 (Q-001/003/004/005 answered by ADR-005/006/007/008; Q-002 answered by D-008)
gate_status: passed
gate_decision: conditional_go
gate_decision_recorded_at: 2026-04-26T00:35:00Z
gate_decided_by: Shon
kill_criteria_triggered: none
generator_evaluator_separation: enforced (Architect audit + 4-perspective Council + Persona Adversary all on claude-sonnet-4-6; Plan generator on claude-opus-4-7)
roadmap_horizon_now_items: 9
critical_path_adr_status: all_accepted
sprint_plan_count: 9
artifacts_produced:
  - ./ROADMAP.yaml (Bastow Now/Next/Later, 9 now / 4 next / 4 later, critical_path = 8 items)
  - ./SPRINT-PLAN.yaml (SP-000 NFR-008 pilot + SP-001..SP-008 build, 32 musts in scope)
  - ./ADRs/ADR-001..ADR-008.md (all status: accepted 2026-04-26)
next_stage_focus:
  - "SP-000 NFR-008 pilot must run BEFORE SP-001; ADR-005 gates entry; final N or downgrade decision recorded in ledgers"
  - "C-033: add @adversary @f-5/@f-8/@f-10 Gherkin scenarios to ACCEPTANCE-CRITERIA.feature BEFORE SP-003 entry; correct frontmatter scenarios_total"
  - "C-034: create build_environment.yaml with tcpdump CAP_NET_RAW recipe BEFORE SP-001 entry"
  - "C-035: define sprint-ledger.jsonl schema OR confirm pm-review-history.jsonl + execution-journal.jsonl serve the role"
  - "C-037: add SP-005.5 informal dogfood checkpoint after SP-005 to de-risk SP-008 engagement-proxy cliff"
  - "TR-001 install must provision OS firewall rule (pf macOS / iptables Linux); SP-007 exit verifies (per ADR-001 + C-036 path b)"
---

## Stage 4 Plan summary

Architect (sonnet-4-6) audit found 10 machine-checkability violations across 6 sprints — all fixed inline. 4-perspective sonnet Council (Architect/QA/PM/DevEx) all conditional_go. Persona Adversary 1 blocking (David NFR-002) closed via path (b): TR-001 install provisions OS firewall rule.

8 ADRs accepted: ADR-001 egress+firewall / ADR-002 full-file SHA-256 / ADR-003 UPSERT / ADR-004 250ms / ADR-005 NFR-008 pilot / ADR-006 URL sub-pkg / ADR-007 MIME allowlist / ADR-008 manifest schema.

Stage 5 entry prerequisites: C-033/034/035 fixes + SP-000 pilot run. SP-001 gated on SP-000 exit + tcpdump recipe.

---
*Charter: [`../CHARTER.md`](../CHARTER.md). Ledgers (16 D / 37 C / 5 Q). ADRs: [`../ADRs/`](../ADRs/).*
