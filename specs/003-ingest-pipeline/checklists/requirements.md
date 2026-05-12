# Specification Quality Checklist: Inbox Watcher + Ingest Pipeline (SP-003)

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit-clarify` or `/speckit-plan`
**Created**: 2026-05-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — implementation library choices (PDF extractor, HTML-to-Markdown converter, watcher backend) are deferred to `/speckit-plan`; spec names the *behavioral* contract, not the *code* contract. Node-specific identifiers (`crypto.createHash('sha256').update(stream)`, `runTool`, `flock(LOCK_EX | LOCK_NB)`) appear only when binding to constitutional principles or ADR-002's explicit algorithm commitment, where they are *load-bearing* identifiers, not implementation drift.
- [x] Focused on user value and business needs — every user story is framed in terms of what the user (and the agent-as-principal) experiences, not what the code does.
- [x] Written for non-technical stakeholders — Shon (sole stakeholder + sole developer) is the audience; the technical specificity is calibrated to him.
- [x] All mandatory sections completed — User Scenarios & Testing, Requirements, Success Criteria, Assumptions, Out of Scope all populated.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the spec resolved all SP-003 v1 ambiguities by binding to existing artifacts (ADR-002, ADR-007, SP-002's FR-008 frontmatter contract, the schema-migration.ts canonical column list, the Constitution's 16 principles). Plan-stage decisions (per-document budget number, normalizer library selection, watcher backend, default size limit, default `processed/` uniquification scheme) are explicitly tagged as `/speckit-plan` scope, not as spec-level ambiguities.
- [x] Requirements are testable and unambiguous — every FR-INGEST-NNN names a behavior, a source (FR-NNN / ADR / Principle), and a verification path.
- [x] Success criteria are measurable — every SC-INGEST-NNN names a concrete pass condition (counts, structural invariants, lint-detected zero-violations).
- [x] Success criteria are technology-agnostic — phrased in terms of file state, row state, telemetry contents, and structural invariants; not framework names. Node identifiers (`fs.createReadStream`, `crypto`) appear only where ADR-002 binds the algorithm choice.
- [x] All acceptance scenarios are defined — every user story has ≥3 Given/When/Then scenarios; collectively 21 scenarios cover the happy path, the dedup contract, the rejection contract, and the telemetry contract.
- [x] Edge cases are identified — 11 edge cases enumerated (fast-write race, file-modified-during-hash, torn write, hash collision, mtime independence, empty file, filename collision in processed/, inotify resource limits, subdirectory traversal non-scope, drop-during-init, three-folder routing invariants).
- [x] Scope is clearly bounded — Out of Scope section enumerates 16 explicit deferrals to other SPs / non-goals, including the 4 critical scope cuts called out in the dispatch (no classifier, no embedding/ranking, no retrieval prompt template, no `corpus://failures` MCP resource).
- [x] Dependencies and assumptions identified — Assumptions section enumerates 12 prerequisites and Plan-stage-deferred decisions, each with an explicit source (Paths resolver verification, schema-migration.ts, SP-001 + SP-002 merged, Principle XII for `runTool`).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — 14 FR-INGEST-NNN requirements map to 20 SC-INGEST-NNN measurable outcomes. The mapping is many-to-many but every FR-INGEST is covered by ≥1 SC-INGEST.
- [x] User scenarios cover primary flows — US1 (happy path, P1), US2 (idempotency, P1), US3 (validation rejection, P1), US4 (telemetry coverage, P2). The four stories cover the four FR sources (FR-010, FR-011, FR-017, NFR-016) called out in the dispatch.
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-INGEST-001..SC-INGEST-020 together cover the RM-004 roadmap success metric ("Filesystem watcher enqueues new docs; pipeline normalizes to Markdown+YAML frontmatter; SHA-256 full-file content hash deduplicates correctly; ≥6 named telemetry event classes emitted; all Gherkin scenarios pass including F-5 MIME-sniff and F-10 full-file-hash adversary scenarios"). F-5 is covered by SC-INGEST-007 and US3.2. F-10 is covered by SC-INGEST-006 and US2.3.
- [x] No implementation details leak into specification — verified by re-read. The only specificity beyond behavior is the algorithm binding (full-file SHA-256 from ADR-002) and the schema constraints (from schema-migration.ts), both of which are upstream commitments the spec is *honoring*, not *introducing*.

## Constitution Compliance (cross-cutting, non-template)

- [x] Principle I (Local-First, No Egress) — SC-INGEST-014 binds telemetry to contain no body content; SP-003 introduces zero network IO; PDF / HTML extractors selected at Plan must satisfy "no network egress" (called out in Assumptions).
- [x] Principle II (User Curates, LLM Classifies Metadata) — SC-INGEST-020 binds canonical-store body files to be byte-identical to deterministic normalization of inbox source bytes; no LLM in the SP-003 loop.
- [x] Principle III (Substrate, Not Surface) — FR-INGEST-012 commits to zero MCP mutation surfaces; inbox filesystem operation is the user's only write path.
- [x] Principle V (Schema-Enforced Output) — FR-INGEST-009 + SC-INGEST-012 bind every telemetry event to validate against the Zod schema with zero failures; FR-INGEST-008 binds documents rows to the schema-migration.ts canonical constraints.
- [x] Principle VII (Cancellable IO) — FR-INGEST-010 + SC-INGEST-016 bind SIGTERM behavior; explicit `AbortController` mandate; explicit `Promise.race(setTimeout)` prohibition.
- [x] Principle VIII (Atomic Writes) — FR-INGEST-003 + SC-INGEST-004 bind body-file writes and three-folder moves to atomic semantics.
- [x] Principle IX (Concurrency-Safe Shared State) — FR-INGEST-011 + SC-INGEST-015 bind the `Paths.drainLock()` flock contract; lock contention emits `lock_contention` and exits clean.
- [x] Principle X (Idempotent Pipeline Transitions; Three-Folder Routing) — FR-INGEST-003 + SC-INGEST-002 + the "Three-folder routing invariants" edge case bind the `pending/` empty post-drain invariant and the `processed/` ↔ documents-row 1:1 correspondence.
- [x] Principle XI (Library/CLI Boundary) — FR-INGEST-013 + SC-INGEST-017 lint commits to zero `process.exit` in library packages.
- [x] Principle XII (Subprocess Hygiene) — FR-INGEST-006 + SC-INGEST-019 bind subprocess invocation to `runTool`; explicit `execSync` / string-shell prohibition.
- [x] Principle XIII (Telemetry-or-Die) — FR-INGEST-009 + US4 + SC-INGEST-012 + SC-INGEST-013 cover the ≥6 event class minimum, the no-silent-swallow contract, the honest-failure on telemetry-write-failure contract.
- [x] Principle XIV (XDG Paths via Single Resolver) — FR-INGEST-014 + SC-INGEST-018 lint commits to zero writes outside `Paths.*`.
- [x] Principle XVI (Validation Honesty) — SP-003 ships only the structural failure-lane primitive (`failed/` + `.error.json`); the `corpus://failures` MCP resource is honestly deferred to SP-006.

## Anti-Scope Verification

- [x] Spec contains NO classifier requirements — verified. Classifier-owned columns are populated with documented sentinel values; SP-004 (FR-012/FR-013/FR-014) is explicitly Out of Scope.
- [x] Spec contains NO embedding/ranking/retrieval requirements — verified. SP-005 (FR-015/FR-002/FR-003/FR-004) explicitly Out of Scope; SC-INGEST notes that `corpus.find` continues to return empty SearchHits until SP-005.
- [x] Spec contains NO retrieval prompt template requirements — verified. FR-009 / RM-003 are SP-002-adjacent or already-shipped scope; explicitly not present.
- [x] Spec contains NO "user queries the inbox" flow — verified. The user's only inbox interaction is drop (filesystem-write); the agent reads via SP-002's resources and (post-SP-005) via `corpus.find`. No inbox-query surface introduced.
- [x] Spec contains NO `corpus://failures` MCP resource — verified. The on-disk `.error.json` sidecar is the SP-003 deliverable; the MCP resource is SP-006 (FR-018) Out of Scope.
- [x] Spec does NOT add MCP mutation surfaces — verified. FR-INGEST-012 explicit.

## Notes

- Spec uses FR-INGEST-NNN numbering (consistent with SP-002's per-spec FR-008 / FR-007 / etc. reuse of upstream FR identifiers, but extended with the -INGEST infix to disambiguate SP-003-introduced requirements from upstream FR-NNN sources). This follows the existing project pattern where SP-002 also bridged spec-level requirements to upstream `.product/REQUIREMENTS.yaml` FRs by quoting them inline and adding spec-specific behavioral commitments.
- Plan-stage open items deliberately deferred (not flagged as spec-level ambiguities): (a) concrete PDF extractor library, (b) concrete HTML-to-Markdown converter, (c) watcher backend (inotify vs polling vs hybrid), (d) default max file size, (e) `processed/` filename uniquification scheme, (f) sentinel values for classifier-owned columns, (g) per-document ingest wall-clock budget.
- `documents.hash` UNIQUE constraint: spec asserts it as a Plan-stage commitment with defense-in-depth justification. If the existing schema lacks it, Plan adds it forward-compatibly. SP-002's schema-migration.ts inspection (lines 55-72) confirms the current `hash` column is `NOT NULL` but unconstrained for uniqueness; Plan formalizes this.
- This checklist marks every item PASS based on internal review. `/speckit-clarify` is OPTIONAL given the small number of genuine ambiguities (all Plan-stage-scoped). Recommend proceeding directly to `/speckit-plan` unless Shon prefers a clarify pass on (a)–(g) above.
