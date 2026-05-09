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

- [ ] No [NEEDS CLARIFICATION] markers remain  *(3 markers DELIBERATELY present: Q1 seed corpus, Q2 query mining, Q3 retrieval-pattern definitions; resolution via `/speckit-clarify` per SKILL.md workflow)*
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

- The 3 [NEEDS CLARIFICATION] markers (Q1, Q2, Q3) are intentional and within the SKILL.md limit (max 3). They are not blocking spec validation; they are the inputs to the next phase (`/speckit-clarify`).
- ADR-010 supersedes ADR-005 — see `.product/ADRs/ADR-010-sp000-lite-supersedes-005.md`. The spec inherits ADR-010's binding constraints (50 queries, qwen3:8b, single variant + ≤1 iteration, binary exit) without re-deriving them.
- AG-005 is invoked explicitly in FR-PILOT-009 and Assumptions: SP-000-lite is NOT the deferred labeled retrieval evaluation harness (OOS-012); the pilot measures *tool invocation rate*, not *retrieval quality*.
- Constitution Principle XIII (telemetry-or-die) is invoked in FR-PILOT-005 and SC-003.
- Constitution Principle XVI (validation honesty / personal-scale floor framing) is invoked in FR-PILOT-008, SC-004, US3, and Assumptions.
- Items marked incomplete (the [NEEDS CLARIFICATION] line above) require user resolution via `/speckit-clarify` before `/speckit-plan` may proceed.
