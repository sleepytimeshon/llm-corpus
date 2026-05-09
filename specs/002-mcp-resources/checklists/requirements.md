# Specification Quality Checklist: MCP Resources — Manifest, Taxonomy, Recent Ingests, Per-Document

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-05
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- ~~Three [NEEDS CLARIFICATION] markers remain~~ — **all three resolved 2026-05-05 per Shon's review pass**:
  - **CLAR-1 (FR-005 manifest field set) → Option B (architecture-aligned)**: v1 ships `doc_count`, `established_domains`, `established_tags`, `last_ingest_timestamp`, `schema_version`, `taxonomy_version`. Rationale: makes schema/taxonomy migration debugging tractable from SP-005 onward.
  - **CLAR-2 (FR-006 taxonomy axes) → Option B (filter-axis-complete)**: v1 ships flat per-axis envelope covering all four SP-001 SearchFilter axes (`domains`, `tags`, `types`, `source_types`). Rationale: taxonomy is the vocabulary contract for filter values; partial coverage forces agents to guess.
  - **CLAR-3 (FR-007 recent-window semantics) → Option A (count-only)**: v1 is count-based with default N deferred to `/speckit-plan`; time-based and hybrid windowing explicitly out of scope. Rationale: deterministic, halves test surface, future SPs can extend.
- The MCP-protocol choice for these surfaces — `resources` (URI-addressable, subscribable) rather than `tools` (RPC-invocable with arguments) — is RESOLVED, not a clarification. The FR text uses canonical `corpus://`-scheme URIs throughout (FR-005 "corpus://manifest", FR-006 "corpus://taxonomy", FR-007 "corpus://recent", FR-008 "corpus://docs/{id}"), and ARCHITECTURE-FINAL §6 (lines 283–289) catalogs them as resources. Tool-vs-resource is not legitimately open.
- Validation iteration 1: spec passed all Content Quality + Feature Readiness checks. Three [NEEDS CLARIFICATION] markers are intentional per the spec's "limit 3" rule and represent genuine FR-text ambiguity, not under-specification. Items marked incomplete require clarification answers before `/speckit-clarify` or `/speckit-plan` can run cleanly.
