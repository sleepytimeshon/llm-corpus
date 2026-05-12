# Specification Quality Checklist: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit-clarify` and planning
**Created**: 2026-05-09
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)  *(spec describes WHAT the pilot measures and WHY; harness implementation is deferred to plan/tasks phase)*
- [x] Focused on user value and business needs  *(user value here = ADR-010 binary exit gate closure, SP-003 unblock)*
- [x] Written for non-technical stakeholders  *(spec is readable by Shon-as-product-owner; the technical FR-PILOT-* requirements are necessarily structured but not language-specific)*
- [x] All mandatory sections completed  *(User Scenarios, Requirements, Success Criteria, Assumptions all populated)*

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain  *(Round 1 resolved 2026-05-09: Q1 substrate=curated sampler ~32 PDFs; Q2 query mining=B+C blend with bookmarks cross-check; Q3 retrieval-pattern defs=Engineer DRAFT pending Shon's PR-review ratification. Round 2 resolved 2026-05-11: Q4=Option C single-shot + secondary diagnostic + soft threshold; Q5=Option B JSONL + new `Paths.pilotTelemetry()` + iteration-suffixed retention.)*
- [x] Requirements are testable and unambiguous  *(FR-PILOT-001 through FR-PILOT-012 each name a verifiable artifact or behavior)*
- [x] Success criteria are measurable  *(SC-001 through SC-006 all reference verifiable artifacts: ledger entries, query-set lint, telemetry log inspection, filesystem audit)*
- [x] Success criteria are technology-agnostic  *(SC-* frame outcomes in terms of artifacts and constraints, not specific languages or frameworks)*
- [x] All acceptance scenarios are defined  *(US1, US2, US3 each carry Given/When/Then scenarios)*
- [x] Edge cases are identified  *(6 edge cases enumerated covering iteration exhaustion, model unavailability, MCP server crash, malformed tool calls, retrieval-quality scope creep, adversarial false-positives)*
- [x] Scope is clearly bounded  *(AG-005 binding stated explicitly; OOS-012 retrieval-quality measurement explicitly excluded; iteration ≤ 2 cap stated)*
- [x] Dependencies and assumptions identified  *(Assumptions section enumerates: qwen3:8b availability, SP-002 substrate operational, NFR-008 current state, AG-004/AG-005 bindings, Constitution IV/XIII/XVI bindings, sequencing)*

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria  *(FR-PILOT-* requirements map to US1/US2/US3 acceptance scenarios and to SC-001 through SC-006)*
- [x] User scenarios cover primary flows  *(US1 = pilot runs and discharges binary exit; US2 = stratification rubric guards against query-set skew; US3 = personal-scale framing preserved end-to-end)*
- [x] Feature meets measurable outcomes defined in Success Criteria  *(each SC-NNN is reachable from the FR-PILOT-* requirements)*
- [x] No implementation details leak into specification  *(spec mentions Ollama and MCP at the integration level — these are inherited substrate, not new implementation choices; no language/framework/library prescription appears)*

## Notes

- **Round 1 clarify (2026-05-09) — RESOLVED**: Q1 (seed corpus substrate), Q2 (query mining source), Q3 (retrieval-pattern operational definitions) integrated into spec. See `## Clarifications → Session 2026-05-09` and the new sections `## Retrieval Pattern Operational Definitions` + `## Substrate File List`.
- **Round 2 clarify (2026-05-11) — RESOLVED**: Q4 (malformed-tool-call semantics → Option C) and Q5 (telemetry on-disk format + `Paths.*` + retention → Option B) integrated into spec. See `## Clarifications → Session 2026-05-11`. Spec amendments: FR-PILOT-005 (added `malformed_call_payload` field + telemetry path), FR-PILOT-006 (telemetry + summary paths), new FR-PILOT-013 (summary fields + soft threshold), new FR-PILOT-014 (retention), new Assumption (`Paths.pilotTelemetry()` resolver prerequisite), SC-003 + SC-006 amended, Edge Cases malformed-tool-call bullet rewritten. Q5 introduces a follow-up task for `/speckit-tasks` Phase 2: add `Paths.pilotTelemetry()` to `packages/contracts/src/paths.ts`.
- **Q3 ratification still pending**: DRAFT operational definitions for `factual_lookup` / `recall_by_context` / `multi_doc_synthesis` authored by Engineer. Shon reviews + ratifies in PR review walkthrough; ratification is non-delegable per FR-PILOT-012.
- ADR-010 supersedes ADR-005 — see `.product/ADRs/ADR-010-sp000-lite-supersedes-005.md`. The spec inherits ADR-010's binding constraints (50 queries, qwen3:8b, single variant + ≤1 iteration, binary exit) without re-deriving them.
- AG-005 is invoked explicitly in FR-PILOT-009 and Assumptions: SP-000-lite is NOT the deferred labeled retrieval evaluation harness (OOS-012); the pilot measures *tool invocation rate*, not *retrieval quality*.
- Constitution Principle XIII (telemetry-or-die) is invoked in FR-PILOT-005, FR-PILOT-013, FR-PILOT-014, and SC-003.
- Constitution Principle XIV (single resolver) is invoked in FR-PILOT-006, SC-006, and the new `Paths.pilotTelemetry()` Assumption.
- Constitution Principle XVI (validation honesty / personal-scale floor framing) is invoked in FR-PILOT-008, SC-004, US3, and Assumptions.
- **Sequencing reminder**: `/speckit-plan` is now UNBLOCKED at the spec level. The only outstanding gate is Q3 DRAFT ratification, which happens in PR-walkthrough (does NOT block `/speckit-plan`). For `/speckit-implement`, the `Paths.pilotTelemetry()` resolver-key task must land first; `/speckit-tasks` is responsible for capturing it.
