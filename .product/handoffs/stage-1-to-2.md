---
artifact: HANDOFF
project_slug: llm-corpus
stage: 1-frame
from_stage: 1-frame
to_stage: 2-spec
charter_ref: ../CHARTER.md
template_version: 3.0.0
generated: 2026-04-26T01:55:00-07:00
generated_by: ProductDevelopment Skill v1.0
tier: deep
size_budget_bytes: 3072
size_budget_mode: soft_warn
ledger_snapshot:
  decisions: 0
  concerns: 7 (6 mitigated post-PM-Review, 1 still open at medium); sources — 3 redteam, 3 persona-adversary, 1 council
  questions: 0
gate_status: approved
gate_decision: conditional_go
gate_decision_recorded_at: 2026-04-26T02:05:00-07:00
gate_decided_by: Shon
kill_criteria_triggered: none
next_stage_focus:
  - "Refine A-006: add retrieval-quality parity test (top-3 Jaccard on shared queries), not just protocol parity (C-004)"
  - "Refine A-007: promote runtime egress audit to required for SOL-005-A privileged-data path (C-005)"
  - "Refine A-008: redefine threshold as absolute, not relative-to-cloud-baseline (C-006)"
  - "Spec SUCCESS-METRICS: add per-opportunity hard metrics for OPP-003, OPP-005, OPP-008"
  - "Confirm AG-004 honored — no cross-agent claims as must-haves in REQUIREMENTS.yaml"
---

## PM-Review resolutions (2026-04-26T02:05:00-07:00)

- **C-002 (knowledge≠memory boundary):** mitigated. Reframed: memory = "personality problem" (preferences, observations); corpus = "experience problem" (user-domain knowledge the LLM lacks). AG-003 rationale updated.
- **C-004 / C-005 (cross-agent quality, lint-only egress):** Shon accepted the proposed Stage 2 mitigations; both marked mitigated with carry-forward as the resolution.
- **C-006 (cloud-baseline tolerance):** confirmed invalid. Stage 2 MUST redefine A-008 threshold as absolute, not relative-to-baseline. Cloud-baseline framing rejected outright.
- **C-007 (Council conditions):** accepted as part of conditional_go approval.

## What changed

Frame delivered 4 artifacts: OPPORTUNITY-TREE.yaml (1 outcome, 8 opportunities, 8 solutions, 13 assumptions across all 4 Torres quadrants), PERSONAS.md (3 named — Maya R., David Okafor, Priya; bidirectional refs lint-clean), ANTI-GOALS.md (5 anti-goals), SUCCESS-METRICS.md (M-001 = ≥5 corpus.find/wk + ≥1 acceptance; SM-001 paired).

RedTeam, persona-adversary, and Council surfaced 7 concerns; 6 mitigated at PM-Review (see resolutions above), 1 medium open (C-001 — accepted as honestly fenced by AG-004). All 10 must_meet pass; all 8 should_meet pass.

## Open questions

None blocking.

---

*Charter: [`../CHARTER.md`](../CHARTER.md). Ledgers: [`../ledgers/`](../ledgers/).*
