---
artifact: HANDOFF
project_slug: llm-corpus
stage: 2-spec
from_stage: 2-spec
to_stage: 3-validate
charter_ref: ../CHARTER.md
template_version: 3.0.0
generated: 2026-04-27T02:25:00Z
generated_by: ProductDevelopment Skill v1.0
tier: deep
size_budget_bytes: 3072
size_budget_mode: soft_warn
ledger_snapshot:
  decisions: 7 (D-001..D-007); 0 low-reversibility, 1 medium (D-007 PM-Review approval)
  concerns: 23 total (10 mitigated, 13 open carry-forward); sources — 3 stage-2 redteam (C-008..C-010), 6 qatester adversary mitigated inline (C-011..C-016), 4 qatester adversary deferred (C-017..C-020), 1 council (C-023), 1 persona-adversary Priya (C-022)
  questions: 5 (Q-001..Q-005); all carry-forward dependencies on Validate or Plan, none gate-blocking
gate_status: approved
gate_decision: conditional_go
gate_decision_recorded_at: 2026-04-27T02:25:00Z
gate_decided_by: Shon
kill_criteria_triggered: none
next_stage_focus:
  - "Validate A-008 / NFR-008 absolute floor — Ollama+MCP integration spike to set local-LLM tool-use rate target (Q-001 + C-022)"
  - "Validate F-5 / C-018 — MIME-sniff scenario for FR-010 (binary file with allowed extension rejected)"
  - "Validate F-8 / C-019 — concurrent stage-invocation scenario for FR-016a (UPSERT or unique-constraint enforced)"
  - "Validate F-10 / C-020 — content-hash full-file scenario for FR-017 (60MB files identical-prefix-different-tail)"
  - "Validate A-010 / Q-002 — false-promotion-rate spike for FR-019 taxonomy promotion threshold N"
---

## PM-Review resolutions (2026-04-27T02:25:00Z)

- **Council conditional_go** (C-023): user chose fix-before-handoff path (option b)
- **Condition 1 (all should-haves get ACs):** mitigated. 11 should-have scenarios authored inline; `all_shoulds_have_ac=true` now satisfies S-05
- **Condition 2 (high-severity QATester):** partially mitigated inline — F-1, F-6, F-12, F-13, F-15 closed via 6 new adversary scenarios (C-011..C-015). F-5, F-8, F-10 deferred to Validate as C-018/019/020 with explicit Validate-stage scenarios
- **Condition 3 (NFR-002 always-on per David):** mitigated. New scenario asserts in-process hook active during ALL operations on ALL documents (50-doc mixed-workload telemetry checkpoint; C-016)

## What changed

Stage 2 produced 4 canonical artifacts: REQUIREMENTS.yaml (50 reqs: 32 must + 13 should + 5 nice; all_musts_have_ac=true; all_shoulds_have_ac=true), ACCEPTANCE-CRITERIA.feature (128 Gherkin scenarios across 16 Features), PRD.md (human-readable derived view), REQUIREMENTS-MATRIX.md (deep-tier traceability matrix). Extended SUCCESS-METRICS.md to Spec edition adding M-002 (OPP-003 classifier autonomy), M-003 (OPP-005 local-only invariant), M-004 (OPP-008 pipeline autonomy) per CF-4.

All 5 Stage-1 carry-forwards landed: CF-1 → NFR-007 + @cf-1 scenario; CF-2 → NFR-002 + @cf-2 scenario; CF-3 → NFR-008 + @cf-3 scenario (target null pending Validate); CF-4 → M-002/003/004 in SUCCESS-METRICS; CF-5 → AG-004 enforced (FR-022/023 + NFR-007/008 all priority:should + quality_flag:conflicts-anti-goal; OOS-011 explicit boundary).

Gate evaluation: 8/8 must_meet PASS (M-01..M-08 verified with frontmatter validate, drift-lint requirements-to-opportunities, AG-004 grep audit). 6/7 should_meet PASS (S-07 nominally fails on questions-with-blocking-field, by-design carry-forward — not gate-blocking). Recipe.yaml deep tier ran: RedTeam pre-flight (C-008/009/010), Architect (50 candidates), Research (NFR baselines), Gherkin author (128 scenarios), QATester adversary (15 findings — 5 closed, 10 carry-forward), Council pre-gate (conditional_go).

## Open questions

5 questions in questions.jsonl, all carry-forward to Validate or Plan: Q-001 (NFR-008 absolute floor — depends on Validate spike), Q-002 (FR-019 promotion threshold N — depends on A-010 spike), Q-003 (FR-020 URL-fetch adapter packaging — Plan ADR), Q-004 (FR-010 MIME allowlist — consult MEDIA-INGESTION-SPEC), Q-005 (FR-005 manifest schema scope — Plan). None block Stage 3 entry.

---

*Charter: [`../CHARTER.md`](../CHARTER.md) — referenced, not copied.*
*Ledgers: [`../ledgers/`](../ledgers/) — append-only (23 concerns, 7 decisions, 5 questions).*
