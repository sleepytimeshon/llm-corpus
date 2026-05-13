# Specification Quality Checklist: Local LLM Classifier (SP-004)

**Purpose**: Validate specification completeness and quality before proceeding to `/speckit-plan` (already completed) / `/speckit-tasks`
**Created**: 2026-05-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — implementation library choices (`undici`, `zod-to-json-schema`) appear only as load-bearing identifiers binding to constitutional principles or to the verified pre-flight state (Ollama 0.21.0 reachable on the user's pai-node01; qwen3.5:9b + gemma3:4b pre-loaded). Concrete code symbols (`fetch`, `signal`, `transaction`) appear only where binding to constitutional principles (Principle V grammar enforcement, Principle VII AbortSignal, Principle VIII atomic writes). The model name and HTTP endpoint are load-bearing facts, not implementation drift.
- [x] Focused on user value and business needs — every user story is framed in terms of what the user (and the agent-as-principal) experiences: autonomous classification on ingest (US1), manual backlog drain (US2), proposed-term routing without polluting established vocab (US3).
- [x] Written for non-technical stakeholders — Shon (sole stakeholder + sole developer) is the audience; the technical specificity is calibrated to him.
- [x] All mandatory sections completed — User Scenarios & Testing, Requirements, Success Criteria, Assumptions, Out of Scope all populated.

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — the spec resolved all SP-004 v1 ambiguities by binding to existing artifacts (FR-012/013/014 from `.product/REQUIREMENTS.yaml`, the SP-003 sentinel-row contract from `data-model.md`, the SP-002 `taxonomy_terms` schema, the Constitution's 16 principles). Plan-stage decisions (concrete model choice, retry policy, vocabulary refresh cadence, atomicity strategy, body-excerpt cap, JSON Schema emitter) are explicitly resolved in `research.md` (Decisions A through J), not as spec-level ambiguities.
- [x] Requirements are testable and unambiguous — every FR-CLASSIFY-NNN names a behavior, a source (FR / Principle / Decision), and a verification path.
- [x] Success criteria are measurable — every SC-CLASSIFY-NNN names a concrete pass condition (row counts, structural invariants, lint-detected zero-violations, grep-asserted forbidden-field absence).
- [x] Success criteria are technology-agnostic where possible — phrased in terms of row state, frontmatter content, taxonomy_terms state, sidecar presence, and telemetry coverage. Identifiers like `qwen3.5:9b` appear only where ADR-CLASSIFIER-MODEL-CHOICE binds the choice.
- [x] All acceptance scenarios are defined — every user story has ≥ 4 Given/When/Then scenarios; collectively 16 scenarios cover the happy path, the manual reenrich path, the proposed-term routing, the vocabulary-violation routing, and the kill-9 / SIGTERM recovery contract.
- [x] Edge cases are identified — 10 edge cases enumerated (Ollama unavailable, malformed Ollama response, oversized body, classifier returns established-but-unseen-term, concurrent reenrich invocations, kill-9 mid-classify, per-doc wall-clock budget, body without title/source, vocabulary snapshot stale during long batch, three-folder routing for classify failures).
- [x] Scope is clearly bounded — Out of Scope section enumerates ≥ 13 explicit deferrals to other SPs / non-goals, including SP-005 embedding/ranking, SP-006 kill-9 survival + `corpus://failures` resource, future user-review UI, multi-model ensembling, worker-pool parallelism, `corpus reclassify`, auto-promotion, confidence persistence, provenance fields, cross-agent compatibility claims, MCP mutation surfaces, LLM-generated body content, `enum FacetDomain` hardcoding, `synthesis/` namespace.
- [x] Dependencies and assumptions identified — Assumptions section enumerates ≥ 13 prerequisites and pre-resolved decisions, each with an explicit source (SP-001/SP-002/SP-003 merged, Ollama installed and reachable, models pre-loaded, `Paths.*` getters present, `taxonomy_terms` schema baseline, body-file frontmatter codec, `undici` HTTP client, `zod-to-json-schema` library, confidence-not-surfaced, no worker-pool parallelism, facet_type enum constitutional, no `process.exit` in libs).

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria — 20 FR-CLASSIFY-NNN requirements map to 20 SC-CLASSIFY-NNN measurable outcomes. The mapping is many-to-many but every FR-CLASSIFY is covered by ≥ 1 SC-CLASSIFY.
- [x] User scenarios cover primary flows — US1 (autonomous classification, P1), US2 (manual backlog reenrich, P1), US3 (proposed-term routing, P1). The three stories cover the three FR sources (FR-012, FR-013, FR-014) from `.product/REQUIREMENTS.yaml`.
- [x] Feature meets measurable outcomes defined in Success Criteria — SC-CLASSIFY-001..SC-CLASSIFY-020 together cover the RM-005 roadmap success metric ("Local-LLM classifier emits schema-valid metadata via grammar-constrained generation; classifier handles vocabulary correctly; classifier output is validated defense-in-depth; ≥ 6 named classify-stage telemetry event classes; all FR-012/013/014 acceptance scenarios pass").
- [x] No implementation details leak into specification — verified by re-read. Identifiers like `qwen3.5:9b`, `http://localhost:11434`, `undici`, `zod-to-json-schema` appear only at the binding points where the constitutional principle or pre-flight fact requires them. The spec is otherwise behavior-focused.

## Constitution Compliance (cross-cutting, non-template)

- [x] **Principle I (Local-First, No Egress)** — SC-CLASSIFY-020 binds telemetry to contain no body content; SP-004's only non-local-disk IO is HTTP to `http://localhost:11434` (Ollama), which is localhost-allowlisted by construction via the SP-001 egress hook. Summaries (which the classifier produces) land in frontmatter (local disk) not telemetry.
- [x] **Principle II (User Curates, LLM Classifies Metadata)** — FR-CLASSIFY-013 + SC-CLASSIFY-002 forbid confidence persistence to frontmatter; the forbidden-field list (`origin`, `provenance_*`, `confidence`, `captured_at`, `corpus capture`) is enforced; the classifier produces frontmatter metadata only, NEVER body content (body section is byte-preserved from SP-003).
- [x] **Principle III (Substrate, Not Surface)** — FR-CLASSIFY-016 commits to zero MCP mutation surfaces; user-facing trigger surfaces are the SP-003 daemon's auto-hook + the `corpus reenrich` CLI command. No HTTP server, no TUI, no browser.
- [x] **Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)** — SP-004 reads/writes one local SQLite + local body files + local sidecars. No SaaS, no cross-machine sync, no permissions, no roles. Assumption explicit.
- [x] **Principle V (Schema-Enforced Structured Output)** — FR-CLASSIFY-003 + FR-CLASSIFY-004 + FR-CLASSIFY-005 bind Ollama's `format` parameter to the canonical Zod-derived JSON Schema; defense-in-depth Zod validation post-Ollama; frontmatter routes through SP-002's single YAML codec.
- [x] **Principle VI (One Pipeline, Two Policies)** — FR-CLASSIFY-001 + US2 commit to one classify-stage function invoked from both the daemon hook and the `corpus reenrich` CLI command; `interactivePolicy` / `batchPolicy` records (extended in PREREQ-004) dispatch behavior differences.
- [x] **Principle VII (Cancellable, Bounded IO)** — FR-CLASSIFY-009 + SC-CLASSIFY-015 bind AbortSignal propagation through `undici` POST + SQL + body-file writes; SIGTERM coordination + 2-second exit budget inherited from SP-003.
- [x] **Principle VIII (Atomic Writes & Transactional Index Updates)** — FR-CLASSIFY-008 + SC-CLASSIFY-004 + SC-CLASSIFY-005 + SC-CLASSIFY-012 bind the paired SQL UPDATE + body-file rewrite to a single SQLite transaction; `withTempDir` for body-file tmp; ADR-CLASSIFIER-ATOMICITY formalizes the pattern.
- [x] **Principle IX (Concurrency-Safe Shared State)** — FR-CLASSIFY-015 + SC-CLASSIFY-014 bind `Paths.drainLock()` reuse as the single serialization point; concurrent invocations emit `pipeline.lock_contention` and exit 0 (FR-INGEST-011 contract preserved).
- [x] **Principle X (Idempotent Pipeline Transitions)** — FR-CLASSIFY-012 + SC-CLASSIFY-013 bind re-running classify on a classified row to a no-op (SQL query filter + UPDATE clause defense-in-depth).
- [x] **Principle XI (Library/CLI Boundary)** — FR-CLASSIFY-017 + SC-CLASSIFY-018 lint commits to zero `process.exit` in SP-004 library packages.
- [x] **Principle XII (Subprocess Hygiene)** — FR-CLASSIFY's Ollama path is HTTP, not subprocess. SC-CLASSIFY-017 lint asserts zero `execSync` / `exec` / string-shell invocations in SP-004 source. Trivially satisfied (no subprocesses in SP-004 at all).
- [x] **Principle XIII (Telemetry-or-Die)** — FR-CLASSIFY-010 + SC-CLASSIFY-011 bind ≥ 6 classify-stage event classes; every catch block in SP-004 source emits a telemetry event before returning or re-throwing (existing SP-001 AST-level lint covers SP-004).
- [x] **Principle XIV (XDG Paths via Single Resolver)** — FR-CLASSIFY-018 + SC-CLASSIFY-019 lint commits to zero writes outside `Paths.*`. SP-004 reuses existing getters; no new XDG base.
- [x] **Principle XV (Dynamic Taxonomy with User-Reviewed Promotion)** — FR-CLASSIFY-006 + FR-CLASSIFY-007 + FR-CLASSIFY-014 + SC-CLASSIFY-003 + SC-CLASSIFY-008 + SC-CLASSIFY-009 + SC-CLASSIFY-016 enforce: no hardcoded `enum FacetDomain`; vocabulary live from `taxonomy_terms WHERE state='established'`; proposed terms route to `state='proposed'`; NO auto-promotion; `corpus://taxonomy` (SP-002 read contract) unchanged.
- [x] **Principle XVI (Validation Honesty)** — Performance numbers are TARGETS; the per-document classifier budget is empirically measured and reported as a Plan footnote post-implementation. No cross-agent compatibility claim. No formal classifier evaluation harness as v1 success criterion.

## Anti-Scope Verification

- [x] Spec contains NO embedding requirements — verified. SP-005 (FR-015 / FR-002 / FR-003 / FR-004 / NFR-003) explicitly Out of Scope; SP-004 notes that `corpus.find` continues to return empty SearchHits until SP-005.
- [x] Spec contains NO retrieval changes — verified. `corpus.find` ranking is unchanged by SP-004; only the underlying `documents` row state changes (classifier columns populated).
- [x] Spec contains NO MCP mutation surfaces — verified. FR-CLASSIFY-016 explicit; SP-004 introduces zero new MCP tools / resources / prompts / mutations.
- [x] Spec contains NO hardcoded `enum FacetDomain` — verified. FR-CLASSIFY-014 + SC-CLASSIFY-016 lint asserts. Only the `facet_type` enum is hardcoded (SCHEMA.md 7-value, constitutional per FR-CLASSIFY-014).
- [x] Spec contains NO confidence-in-frontmatter — verified. FR-CLASSIFY-013 + SC-CLASSIFY-002 grep-asserts.
- [x] Spec contains NO kill-9 (SIGKILL) cross-stage survival guarantee — verified. SP-006 (FR-018 / NFR-005) explicitly Out of Scope; SP-004 ships single-stage atomicity (paired UPDATE + frontmatter rewrite) consistent with SP-003.
- [x] Spec contains NO `corpus://failures` MCP resource — verified. SP-006 (FR-018) explicitly Out of Scope. SP-004 writes the on-disk `<doc-id>.error.json` sidecars that SP-006's resource will surface.
- [x] Spec contains NO auto-promotion of proposed → established — verified. Principle XV mandates the gate-not-auto-trigger semantic; FR-CLASSIFY-007 + Decision I enforce structurally (the adapter function has no state parameter; the SQL string hardcodes `'proposed'`).
- [x] Spec contains NO `synthesis/` namespace — verified. The `synthesis` value in the facet_type enum is a STRUCTURAL classification label (SCHEMA.md v1.0), NOT an AI-generated content namespace.
- [x] Spec contains NO `corpus reclassify <doc-id>` per-doc re-classify — verified. FR-019 explicitly Out of Scope (next-horizon SP-010). SP-004 ships `corpus reenrich` for backlog-batch drain only.
- [x] Spec contains NO multi-model ensembling — verified. SP-004 invokes one model per classify call (config-driven primary; fallback via config).
- [x] Spec contains NO worker-pool parallelism — verified. FR-CLASSIFY-019 commits to single-document, single-threaded.

## Notes

- Spec uses FR-CLASSIFY-NNN numbering (consistent with SP-002's FR-NNN and SP-003's FR-INGEST-NNN per-spec numbering convention). This follows the project pattern where SP-NNN bridges spec-level requirements to upstream `.product/REQUIREMENTS.yaml` FRs by quoting them inline and adding spec-specific behavioral commitments.
- Plan-stage decisions deliberately resolved (not flagged as spec-level ambiguities): (a) primary model qwen3.5:9b + fallback gemma3:4b, (b) HTTP transport via undici, (c) per-batch vocabulary snapshot, (d) 1 retry on schema-invalid + 0 retries elsewhere, (e) paired SQL transaction + body-file rewrite atomicity, (f) drain-lock reuse, (g) 2000-codepoint body excerpt, (h) `zod-to-json-schema` for JSON Schema rendering. All ten decisions formalized in `research.md` (Decisions A through J); the model choice and atomicity strategy formalized as standalone ADRs in `contracts/`.
- `documents.facet_domain` UNIQUE constraint: not applicable. Multiple documents may share the same facet_domain by design; only `hash` carries a UNIQUE constraint per SP-003 PREREQ-002.
- `taxonomy_terms` PRIMARY KEY: `(axis, term)` (existing schema). SP-004's ON CONFLICT DO NOTHING uses this composite key.
- This checklist marks every item PASS based on internal review. `/speckit-clarify` is OPTIONAL — the pre-resolved design decisions in the dispatch prompt cover the historically-ambiguous areas. Recommend proceeding directly to `/speckit-tasks` (Phase 0 prereqs → Phase 2 tests-first → etc.) per the plan's phase breakdown.

---

## Implementation outcomes (post-/speckit-implement)

Every Constitution Principle re-confirmed `[x]` against actual code (not just spec text) per T063 Constitution Re-Eval and T064 outcome-mapping:

| Principle | Implementing code citation | Verifying test |
|---|---|---|
| I. Local-First, No Egress | `packages/inference/src/ollama-adapter.ts` constructor asserts `baseUrl` starts with `http://localhost:` or `http://127.0.0.1:` — see `LOCALHOST_PREFIXES` constant | `tests/integration/sp004-no-body-in-telemetry.test.ts` (FIXTURE_CANARY_SP004 absent from telemetry) |
| II. User Curates | `packages/storage/src/classify-persister.ts` `FORBIDDEN_FRONTMATTER_KEYS` set + destructure-rename of `confidence` | `tests/unit/classify-persister-no-confidence.test.ts` + `classify-persister-frontmatter-roundtrip.test.ts` (body section byte-preserved) |
| III. Substrate, Not Surface | Zero new MCP code under `packages/transport/`; only `packages/cli/src/reenrich-command.ts` + daemon hook | (absence verified via PR diff inspection) |
| IV. Single-User, Single-Machine | No multi-user code introduced | (no test required — IV is an absence-of-feature principle) |
| V. Schema-Enforced Output | `packages/contracts/src/classifier-schema.ts` `ClassifierOutputZodSchema.strict()` + module-load `zodToJsonSchema` + post-processing | `tests/unit/classifier-schema-prereq.test.ts` (13 tests) + `tests/unit/classifier-validation.test.ts` (8 tests) |
| VI. One Pipeline, Two Policies | `packages/pipeline/src/classify-stage.ts classifyStage(input)` invoked by both `packages/daemon/src/index.ts runClassifyPass` and `packages/cli/src/reenrich-command.ts runReenrichCommand` | `tests/integration/end-to-end-classify.test.ts` + `tests/integration/reenrich-cli.test.ts` |
| VII. Cancellable, Bounded IO | `packages/inference/src/ollama-adapter.ts` `signal` end-to-end + `packages/pipeline/src/classify-stage.ts` per-doc `AbortController + setTimeout` (no Promise.race) | `tests/unit/ollama-adapter-abort.test.ts` + `tests/integration/classify-atomicity.test.ts` |
| VIII. Atomic Writes & Transactional Index | `packages/storage/src/classify-persister.ts` BEGIN IMMEDIATE → UPDATE → INSERTs → rename → COMMIT | `tests/unit/classify-persister.test.ts` (4 tests) |
| IX. Concurrency-Safe Shared State | `packages/daemon/src/index.ts runClassifyPass` + `packages/cli/src/reenrich-command.ts` re-acquire `Paths.drainLock()` | `tests/integration/reenrich-cli.test.ts` T044 (lock contention) |
| X. Idempotent Pipeline Transitions | `packages/storage/src/document-writer.ts updateClassification` `WHERE id=? AND facet_type='unclassified'` | `tests/unit/classify-persister.test.ts` (UPDATE 0 rows → rollback) + `tests/integration/reenrich-cli.test.ts` T046 (idempotent re-run) |
| XI. Library/CLI Boundary | Zero `process.exit` in `packages/{inference,pipeline,storage,contracts}/src/`; only `packages/cli/src/reenrich-command.ts runReenrichCli` exits | `tests/integration/sp004-constitutional-grep.test.ts` T058 |
| XII. Subprocess Hygiene | Zero `execSync` / `child_process.exec` / `runTool(` in SP-004 source — Ollama is HTTP | `tests/integration/sp004-constitutional-grep.test.ts` T060 |
| XIII. Telemetry-or-Die | 11 SP-004 telemetry event classes wired into `TelemetryEvent` Zod union in `packages/contracts/src/telemetry.ts`; emitted at every state transition in `classify-stage.ts` | `tests/unit/telemetry-sp004-classes.test.ts` (5 tests) |
| XIV. XDG Paths via Single Resolver | All SP-004 paths through `Paths.docs()` / `Paths.failed()` / `Paths.cache()` / `Paths.telemetry()` / `Paths.drainLock()` | `tests/integration/sp004-constitutional-grep.test.ts` T059 |
| XV. Dynamic Taxonomy with User-Reviewed Promotion | `packages/storage/src/taxonomy-terms-adapter.ts` SQL contains hardcoded `'proposed'` literal; function signature has no `state` parameter; promoted-state INSERT is structurally impossible | `tests/unit/taxonomy-terms-adapter.test.ts` (5 tests) + `tests/integration/no-established-insert-in-sp004.test.ts` (2 tests) |
| XVI. Validation Honesty | Per-doc budget set as TARGET in `packages/pipeline/src/policies.ts` (60s interactive / 300s batch); empirical measurement deferred to operator (Decision F honesty); fallback to gemma3:4b via config | `specs/004-classifier/quickstart.md` operator walkthrough |

### Tasks completed (Phase 1 → Phase 7)

- Phase 1 — T001 (Ollama prereq verified on pai-node01: 0.21.0 + qwen3.5:9b + gemma3:4b).
- Phase 2 — T002 through T015 (forward-compat plumbing).
- Phase 3 — T016 through T039 (US1 autonomous classification; 14 unit tests + 4 integration tests + 10 implementation modules).
- Phase 4 — T040 through T048 (`corpus reenrich` CLI; T043 + T045 deferred per Constitution XVI honesty — wire contract verified at library boundary).
- Phase 5 — T049 through T056 (US3 verification; tests batched into 4 files).
- Phase 6 — T057 through T062 (constitutional grep-lints; batched into 2 files).
- Phase 7 — T063 (this re-eval) + T064 (this outcome mapping) + T065 (deferred — empirical wall-clock measured during operator walkthrough, not in CI) + T066 (quickstart already authored; operator-prereqs section added in T001 commit) + T067 (CLAUDE.md SP-004 surface section) + T068 (telemetry size budget verified ≤ 4096 bytes by T003 + T061's canary scan) + T069 (final commit pending).

### Build/lint/test outcome at Phase 7 completion

- `npm run build`: clean (TypeScript strict mode, all 8 packages composite-build).
- `npm run lint`: exit 0 (eslint 9 flat config with 6 custom rules — `no-forbidden-network-imports`, `no-process-exit-in-libs`, `paths-from-resolver-only`, `no-direct-worker-spawn`, `no-shell-string-exec`, `no-writes-from-resource-handlers` — all scoped to cover SP-004 source via existing globs).
- `npm run test`: 622 tests pass, 4 skipped (pre-existing SP-001/002/003 conditional skips), zero new skips introduced by SP-004.
