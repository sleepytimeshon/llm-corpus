---
artifact: TEST-PLAN
project_slug: llm-corpus
stage: 5-build-test
tier: deep
template_version: 3.0.0
generated: 2026-04-26T22:10:00Z
generated_by: ProductDevelopment Skill v1.0

counts:
  test_cases_total: 56
  test_cases_with_gherkin_ref: 56
  test_cases_negative_path: 24
  test_cases_blocked_pending_data: 0

coverage:
  must_have_requirements_total: 32
  must_have_requirements_covered: 32
  coverage_ratio_must: 1.0
  uncovered_must_haves: []

links:
  requirements: ./REQUIREMENTS.yaml
  acceptance_criteria: ./ACCEPTANCE-CRITERIA.feature
  risk_register: ./RISK-REGISTER.yaml
  decisions_in_scope: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, D-013, D-014, D-015, D-016, D-017]
  concerns_in_scope: [C-018, C-019, C-020, C-027, C-028, C-029, C-030, C-031, C-032, C-033, C-034, C-035, C-036, C-037, C-038]

sources:
  decisions: 17
  concerns: 38
  questions: 5

ieee_829_sections_present:
  - test_plan_identifier
  - introduction
  - test_items
  - features_to_be_tested
  - features_not_to_be_tested
  - approach
  - pass_fail_criteria
  - suspension_criteria
  - test_deliverables

product_type: software
---

# llm-corpus — Test Plan

> **Authority:** IEEE 829-2008 (Standard for Software and System Test Documentation),
> compressed to the seven essential sections per `SKILL-DESIGN-v2.md` §4 line 196.
> Every test case below links to ≥1 requirement (`covers_requirements:`) and ≥1
> Gherkin scenario (`gherkin_ref:`), making the plan ProductBuild-consumable per
> `SKILL-DESIGN-v3.md` §4 line 114.

## 1. Test Plan Identifier

`TP-llm-corpus-stage5`

## 2. Introduction

This plan covers all 32 must-have requirements (19 FR + 8 NFR + 2 TR + 3 UR)
in the `now` horizon of `ROADMAP.yaml`. The system under test is the build
that ProductBuild will produce by consuming `HANDOFF-TO-BUILD.yaml`. Test
items map 1:1 to FR/NFR/TR/UR identifiers in `REQUIREMENTS.yaml`. Each test
case below is a thin wrapper around an existing Gherkin scenario in
`ACCEPTANCE-CRITERIA.feature` — execution is delegated to a
cucumber-compatible runner; this plan establishes coverage and the smoke /
negative / adversary mix.

Test cases are partitioned into:
- **smoke**: positive happy path, one per must-have FR/NFR/TR/UR.
- **negative**: explicit failure path (rejected input, error response,
  enforcement check), one per must-have where a clear negative scenario
  exists in the .feature file.
- **adversary**: Stage-3 carry-forward closures (C-018/C-019/C-020) and
  Council-condition adversary scenarios (NFR-002 broader egress, NFR-006
  denominator floor).

Out-of-scope items (priority `should` and `nice` from REQUIREMENTS.yaml,
plus exclusions listed in §5) populate `build_scope.not_in_scope` of
`HANDOFF-TO-BUILD.yaml`.

## 3. Test Items

The system under test is the build that `ProductBuild` will produce by
consuming `HANDOFF-TO-BUILD.yaml`. Test items map 1:1 to FR-NNN / NFR-NNN /
TR-NNN / UR-NNN identifiers in `REQUIREMENTS.yaml`.

## 4. Features to Be Tested

| FR-id | Feature | Priority | Linked Gherkin file |
|-------|---------|----------|---------------------|
| FR-001..FR-004 | corpus.find tool surface | must | ACCEPTANCE-CRITERIA.feature |
| FR-005..FR-008 | MCP resources for corpus state | must | ACCEPTANCE-CRITERIA.feature |
| FR-009 | MCP prompt templates | must | ACCEPTANCE-CRITERIA.feature |
| FR-010, FR-011, FR-017 | Inbox watcher and ingest pipeline | must | ACCEPTANCE-CRITERIA.feature |
| FR-012, FR-013, FR-014 | Local LLM classification | must | ACCEPTANCE-CRITERIA.feature |
| FR-015 | Embedding and indexing | must | ACCEPTANCE-CRITERIA.feature |
| FR-016a, FR-016b | Pipeline idempotency and resumability | must | ACCEPTANCE-CRITERIA.feature |
| FR-018 | Failure lane | must | ACCEPTANCE-CRITERIA.feature |
| UR-001, UR-002, UR-003 | User workflows | must | ACCEPTANCE-CRITERIA.feature |
| TR-001, TR-002 | Install and uninstall | must | ACCEPTANCE-CRITERIA.feature |
| NFR-001, NFR-002 | Local-only enforcement | must | ACCEPTANCE-CRITERIA.feature |
| NFR-003, NFR-014, NFR-015 | Performance baselines | must | ACCEPTANCE-CRITERIA.feature |
| NFR-004, NFR-005 | Pipeline reliability | must | ACCEPTANCE-CRITERIA.feature |
| NFR-006 | Failure lane usability | must | ACCEPTANCE-CRITERIA.feature |

## 5. Features NOT to Be Tested

These map to `build_scope.not_in_scope` in `HANDOFF-TO-BUILD.yaml`:

- **FR-019** — Backup/restore — *reason: priority=should; deferred to post-MVP*
- **FR-020** — URL fetch packaging sub-package — *reason: ADR-006 packaged separately; smoke scenario exists but full coverage out of scope for MVP*
- **FR-021** — corpus.health diagnostic — *reason: priority=should; one smoke scenario tracked, full coverage deferred*
- **FR-022, FR-023** — Cross-agent portability — *reason: priority=should; verified via spot-check, not full integration matrix*
- **NFR-007, NFR-008** — Cross-agent retrieval/tool-use parity — *reason: ADR-005 pilot first, then absolute floor; full benchmark out of MVP*

## 6. Approach

Per-requirement coverage is the unit of measurement. A requirement is
"covered" iff at least one Gherkin scenario in
`ACCEPTANCE-CRITERIA.feature` exercises it AND that scenario has a
non-trivial `Then` clause (RedTeam-pre-flight check). Negative paths are
explicit per the should-meet gate criterion `test_plan_includes_negative_scenarios`.

Execution is delegated to a cucumber-compatible runner that ProductBuild
will instantiate. This plan does not pre-judge the runner — only the
mapping between FR-NNN ids and scenario titles.

## 7. Pass/Fail Criteria

A test case passes iff its Gherkin scenario evaluates `Then` clauses true.
A test case fails iff any `Then` clause evaluates false OR any `Given`
precondition is unmet at runtime.

Aggregate gates:
- **Build-Ready exit (per build-ready-gate.yaml)**: 100% of must-have
  smoke tests must pass on first run.
- **Sprint exit (per SPRINT-PLAN.yaml)**: 100% of in-sprint must-have
  test cases pass before sprint marked done.

## 8. Suspension Criteria

Testing suspends and gate downgrades to `recycle` if:

- `>20%` of must-have test cases fail on first run (indicates spec
  incoherence, not implementation bugs — Stage 5 returns to Stage 2/4 to
  fix).
- Any test case targeting an `inviolable_decision` (per
  `HANDOFF-TO-BUILD.yaml`) fails — these decisions can't be re-litigated
  inside the sprint.
- Any prototype invocation in `execution-journal.jsonl` reports
  `status: error` for a test scenario, indicating the build environment
  itself is broken (per C-034 build-env recipe pre-condition).

## 9. Test Deliverables

This file (`TEST-PLAN.md`) plus the `test_cases:` YAML block below.
ProductBuild iterates this block to generate test stubs.

---

## test_cases (YAML payload)

> ProductBuild iterates this block to generate test stubs. Each entry has
> `id`, `covers_requirements` (non-empty), `gherkin_ref` (file + scenario name),
> `kind` (positive | negative | edge | smoke | regression | adversary), and
> `expected_outcome`.

```yaml
test_cases:
  # ── FR-001..FR-004: corpus.find tool surface ──────────────────────────
  - id: TC-001
    covers_requirements: [FR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find tool is discoverable via MCP tool-listing handshake"
    kind: smoke
    given: "MCP server is initialized and tools/list is requested"
    when: "client performs MCP tool-listing handshake"
    then: "corpus.find appears in the returned tools list with stable id"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-002
    covers_requirements: [FR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "tools/list during server cold-start returns retriable error"
    kind: negative
    given: "MCP server is starting up (pre-ready state)"
    when: "client requests tools/list"
    then: "server returns retriable error envelope (not crash, not silent empty)"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-003
    covers_requirements: [FR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find returns a ranked SearchHit list for a structured query"
    kind: smoke
    given: "corpus contains at least 5 indexed documents matching the query"
    when: "client invokes corpus.find with a structured query"
    then: "response is a non-empty SearchHit list ordered by relevance score"
    expected_outcome: pass
    fixtures: ["seed-5doc-corpus"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-004
    covers_requirements: [FR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find with empty query returns structured error envelope"
    kind: negative
    given: "MCP server is ready"
    when: "client invokes corpus.find with empty query string"
    then: "server returns structured error envelope with error_code=invalid_query"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-005
    covers_requirements: [FR-003]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find ranking fuses BM25, dense, graph, and confidence signals"
    kind: smoke
    given: "corpus contains documents that score differently across the four signals"
    when: "client invokes corpus.find"
    then: "ranking is deterministic AND each of the four signals contributes measurably"
    expected_outcome: pass
    fixtures: ["seed-multisignal-corpus"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-006
    covers_requirements: [FR-003]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "dense-vector signal failure does not silently disable ranking"
    kind: negative
    given: "dense-vector signal source is configured to fail"
    when: "client invokes corpus.find"
    then: "server reports degraded-ranking diagnostic; does NOT silently fall back to BM25-only"
    expected_outcome: pass
    fixtures: ["broken-dense-signal"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-007
    covers_requirements: [FR-004]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find non-success returns structured error envelope as MCP tool response"
    kind: smoke
    given: "corpus.find is invoked with input that produces a known error path"
    when: "the error condition triggers"
    then: "response is wrapped in MCP tool-result error envelope with code, message, retriable"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-008
    covers_requirements: [FR-004]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "error envelope error_code values come from a stable enumerated set"
    kind: negative
    given: "MCP server is exercised across all known error paths"
    when: "errors are emitted"
    then: "every error_code value is from the documented enumeration; no ad-hoc strings"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── FR-005..FR-008: MCP resources for corpus state ────────────────────
  - id: TC-009
    covers_requirements: [FR-005]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "manifest resource is registered at corpus://manifest with auto-load annotation"
    kind: smoke
    given: "MCP server is initialized"
    when: "client requests resources/list"
    then: "corpus://manifest appears with auto-load annotation set"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-010
    covers_requirements: [FR-005]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "manifest resource is not exposed at any non-canonical URI"
    kind: negative
    given: "MCP server is initialized"
    when: "client requests resources at corpus://man, corpus://manifest.json, corpus://Manifest"
    then: "all non-canonical URIs return not-found; only corpus://manifest dereferences"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-011
    covers_requirements: [FR-006]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "taxonomy resource enumerates established domains and tags with counts"
    kind: smoke
    given: "corpus contains documents tagged with established taxonomy terms"
    when: "client reads corpus://taxonomy"
    then: "response lists each established domain and tag with count > 0"
    expected_outcome: pass
    fixtures: ["seed-tagged-corpus"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-012
    covers_requirements: [FR-006]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "taxonomy resource excludes proposed-only terms"
    kind: negative
    given: "corpus contains documents with both established and proposed-only tags"
    when: "client reads corpus://taxonomy"
    then: "proposed-only terms are absent from the established taxonomy view"
    expected_outcome: pass
    fixtures: ["seed-mixed-taxonomy-corpus"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-013
    covers_requirements: [FR-007]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "recent-ingests resource lists most recent successful ingests"
    kind: smoke
    given: "corpus has recent successful ingests in the last 24h"
    when: "client reads corpus://recent-ingests"
    then: "response lists the most recent N successful ingests in descending time order"
    expected_outcome: pass
    fixtures: ["seed-recent-ingests"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-014
    covers_requirements: [FR-007]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "recent-ingests resource excludes failure-lane documents"
    kind: negative
    given: "corpus has both successful ingests and failure-lane entries in last 24h"
    when: "client reads corpus://recent-ingests"
    then: "failure-lane entries are not present; only successful ingests appear"
    expected_outcome: pass
    fixtures: ["seed-mixed-success-and-failures"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-015
    covers_requirements: [FR-008]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "per-document resource at corpus://docs/{id} returns normalized body and frontmatter"
    kind: smoke
    given: "a document with id D-EXAMPLE exists in the corpus"
    when: "client reads corpus://docs/D-EXAMPLE"
    then: "response contains normalized markdown body AND structured YAML frontmatter"
    expected_outcome: pass
    fixtures: ["seed-doc-D-EXAMPLE"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-016
    covers_requirements: [FR-008]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "per-document resource for unknown id returns structured not-found error"
    kind: negative
    given: "corpus is initialized"
    when: "client reads corpus://docs/UNKNOWN-ID"
    then: "response is structured not-found error envelope with retriable=false"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── FR-009: MCP prompt templates ──────────────────────────────────────
  - id: TC-017
    covers_requirements: [FR-009]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "server registers at least one retrieval prompt template"
    kind: smoke
    given: "MCP server is initialized"
    when: "client requests prompts/list"
    then: "response contains at least one prompt template tagged for retrieval"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-018
    covers_requirements: [FR-009]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "prompts/list never returns an empty list when retrieval template is required"
    kind: negative
    given: "MCP server is initialized in a config that disables custom prompts"
    when: "client requests prompts/list"
    then: "response still includes at least one default retrieval template (never empty)"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── FR-010, FR-011, FR-017: Inbox watcher and ingest pipeline ─────────
  - id: TC-019
    covers_requirements: [FR-010]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "file dropped into inbox is enqueued for ingest after passing validation"
    kind: smoke
    given: "inbox watcher is running"
    when: "a valid document is dropped into the inbox"
    then: "file is enqueued for ingest with a queue id"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-020
    covers_requirements: [FR-010]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "file with disallowed extension is rejected at validation gate"
    kind: negative
    given: "inbox watcher is running with MIME allowlist active (ADR-007)"
    when: "a file with disallowed extension is dropped"
    then: "file is rejected at validation gate; not enqueued; failure-lane entry created"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-021
    covers_requirements: [FR-010]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "binary file with allowlisted extension rejected at MIME-sniff (FR-010 mime_mismatch)"
    kind: adversary
    given: "inbox watcher is running with MIME-sniff active per ADR-007"
    when: "a binary file with .pdf extension but PNG magic bytes is dropped"
    then: "MIME-sniff detects mismatch; file is rejected before normalization; closes C-018"
    expected_outcome: pass
    fixtures: ["adversary-mime-mismatch-pdf-as-png"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-022
    covers_requirements: [FR-011]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "PDF document is normalized to Markdown body with structured YAML frontmatter"
    kind: smoke
    given: "inbox accepts a valid PDF document"
    when: "normalization stage runs"
    then: "output is Markdown body with structured YAML frontmatter (title, tags, source)"
    expected_outcome: pass
    fixtures: ["seed-pdf-doc"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-023
    covers_requirements: [FR-011]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "HTML document with unsupported encoding is routed to failure lane"
    kind: negative
    given: "inbox accepts an HTML document with EBCDIC encoding"
    when: "normalization stage runs"
    then: "document is routed to failure lane with encoding-mismatch error_code"
    expected_outcome: pass
    fixtures: ["adversary-html-ebcdic"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-024
    covers_requirements: [FR-017]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "identical content under different filenames is detected as duplicate"
    kind: smoke
    given: "corpus contains a document with content C and filename A"
    when: "the same content C is dropped with filename B"
    then: "second drop is detected as duplicate via content-hash; no new document created"
    expected_outcome: pass
    fixtures: ["seed-content-C-as-A"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-025
    covers_requirements: [FR-017]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "60MB files identical in first 1MB but differing in tail are ingested as separate documents"
    kind: adversary
    given: "ADR-002 (full-file SHA-256) is active"
    when: "two 60MB files identical in first 1MB but differing past the 1MB boundary are ingested"
    then: "both are ingested as distinct documents (full-file hash differs); closes C-020"
    expected_outcome: pass
    fixtures: ["adversary-60mb-prefix-collide"]
    blocked_by: null
    owner: ProductBuild

  # ── FR-012, FR-013, FR-014: Local LLM classification ──────────────────
  - id: TC-026
    covers_requirements: [FR-012]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "classifier emits schema-valid metadata via grammar-constrained generation"
    kind: smoke
    given: "classifier is configured with grammar-constrained generation"
    when: "a document is submitted for classification"
    then: "output validates against the documented schema on first generation attempt"
    expected_outcome: pass
    fixtures: ["seed-document-classifiable"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-027
    covers_requirements: [FR-012]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "classifier without grammar constraint configuration refuses to start"
    kind: negative
    given: "classifier config has grammar constraint disabled"
    when: "service start is attempted"
    then: "service refuses to start with diagnostic naming the missing grammar config"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-028
    covers_requirements: [FR-013]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "schema-validated classifier output is written to frontmatter"
    kind: smoke
    given: "classifier produces schema-valid metadata for a document"
    when: "frontmatter merge stage runs"
    then: "validated fields are written into the document's YAML frontmatter"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-029
    covers_requirements: [FR-013]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "schema-invalid classifier output routes document to failure lane (no silent coercion)"
    kind: negative
    given: "classifier emits output that fails schema validation"
    when: "validation gate runs"
    then: "document is routed to failure lane; NO silent coercion of fields"
    expected_outcome: pass
    fixtures: ["adversary-schema-invalid-output"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-030
    covers_requirements: [FR-014]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "classifier accepts established vocabulary and emits established values directly"
    kind: smoke
    given: "established taxonomy includes domain D and tag T"
    when: "classifier produces output for a doc matching D and T"
    then: "output uses D and T directly (no rephrasing)"
    expected_outcome: pass
    fixtures: ["seed-taxonomy-with-D-and-T"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-031
    covers_requirements: [FR-014]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "classifier MUST NOT silently introduce a never-seen term into established field"
    kind: negative
    given: "established taxonomy is finite and known"
    when: "classifier produces output that includes a never-seen term"
    then: "term is routed to proposed facet, NOT silently merged into established field"
    expected_outcome: pass
    fixtures: ["adversary-novel-term-injection"]
    blocked_by: null
    owner: ProductBuild

  # ── FR-015: Embedding and indexing ────────────────────────────────────
  - id: TC-032
    covers_requirements: [FR-015]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "classifier produces schema-valid output on 100% of 100-document benchmark"
    kind: smoke
    given: "100-document classification benchmark fixture exists"
    when: "classifier processes the full 100-doc set"
    then: "100 of 100 outputs validate against schema (per NFR-004; embedding stage proceeds for all)"
    expected_outcome: pass
    fixtures: ["benchmark-100doc"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-033
    covers_requirements: [FR-015]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "index storage is exactly one SQLite file"
    kind: negative
    given: "post-ingest filesystem is inspected"
    when: "index storage layout is verified"
    then: "exactly one SQLite file holds the index; no auxiliary index stores"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── FR-016a, FR-016b: Pipeline idempotency and resumability ───────────
  - id: TC-034
    covers_requirements: [FR-016a]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "identical file dropped twice short-circuits via content-hash idempotency"
    kind: smoke
    given: "ADR-003 (SQLite UPSERT) is active"
    when: "the same file is dropped twice"
    then: "second drop is short-circuited; only one document record exists"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-035
    covers_requirements: [FR-016a]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "concurrent invocations of the same pipeline stage on the same document produce exactly one row"
    kind: adversary
    given: "ADR-003 UPSERT semantics are active"
    when: "two concurrent stage runs target the same document"
    then: "exactly one row exists in stage table; closes C-019"
    expected_outcome: pass
    fixtures: ["adversary-concurrent-stage-runs"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-036
    covers_requirements: [FR-016b]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "same logical file with modified content produces a new document"
    kind: smoke
    given: "corpus contains document A with content C1"
    when: "file at same path is updated to content C2 and re-ingested"
    then: "new document exists with content C2; original is preserved or superseded per spec"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-037
    covers_requirements: [FR-016b]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "pipeline survives SIGKILL at each of 5 stages on 50-doc run with no duplicate ingest"
    kind: negative
    given: "50-doc fixture is ingesting through all 5 pipeline stages"
    when: "SIGKILL fires at each stage in turn during the run"
    then: "post-restart, no duplicate documents exist; all 50 reach completion or are flagged"
    expected_outcome: pass
    fixtures: ["sigkill-injection-50doc"]
    blocked_by: null
    owner: ProductBuild

  # ── FR-018: Failure lane ──────────────────────────────────────────────
  - id: TC-038
    covers_requirements: [FR-018]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "every failure-lane entry contains stage, error_code, message, source pointer, retriable flag"
    kind: smoke
    given: "pipeline has produced N>0 failure-lane entries during a run"
    when: "failure-lane is inspected"
    then: "every entry has all five fields populated; no missing field"
    expected_outcome: pass
    fixtures: ["seed-mixed-failures"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-039
    covers_requirements: [FR-018]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "failure-lane entries that lack a source pointer are detected by validation"
    kind: negative
    given: "a malformed failure-lane entry is injected"
    when: "validation pass runs"
    then: "validation flags the missing source pointer and refuses to mark the entry as valid"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── UR-001..UR-003: User workflows ────────────────────────────────────
  - id: TC-040
    covers_requirements: [UR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "install once, available across new agent sessions via auto-loaded resources"
    kind: smoke
    given: "corpus init has run once"
    when: "a new agent session starts"
    then: "corpus resources are auto-loaded; no re-install needed"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-041
    covers_requirements: [UR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "opening a new session does not duplicate corpus state"
    kind: smoke
    given: "corpus is initialized with content"
    when: "a second concurrent agent session starts"
    then: "both sessions see the same single corpus state; no duplication"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-042
    covers_requirements: [UR-003]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "agent session started before corpus init returns a clear unavailable error"
    kind: negative
    given: "corpus init has not yet run"
    when: "an agent attempts corpus.find"
    then: "response is a clear unavailable error pointing to corpus init remediation"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── TR-001, TR-002: Install and uninstall ─────────────────────────────
  - id: TC-043
    covers_requirements: [TR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "single `corpus init` command provisions server, index, and inbox in XDG layout"
    kind: smoke
    given: "fresh machine with Node 18+ and write access to XDG dirs"
    when: "`corpus init` is run once"
    then: "server registered, index initialized, inbox created — all in XDG layout"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-044
    covers_requirements: [TR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "re-running `corpus init` on existing install does not destroy user data"
    kind: negative
    given: "corpus init has run once and user data exists"
    when: "`corpus init` is re-run"
    then: "user data is preserved; only missing pieces are provisioned (idempotent)"
    expected_outcome: pass
    fixtures: ["existing-install-with-data"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-045
    covers_requirements: [TR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "`corpus uninstall` removes server registration but preserves user data by default"
    kind: smoke
    given: "corpus is installed and user data exists"
    when: "`corpus uninstall` is run without flags"
    then: "server registration removed; user data preserved on disk"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-046
    covers_requirements: [TR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "`corpus uninstall` does NOT remove user data without explicit destructive flag"
    kind: negative
    given: "corpus is installed and user data exists"
    when: "`corpus uninstall` is run without --purge"
    then: "user data is preserved; uninstall completes successfully"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  # ── NFR-001, NFR-002: Local-only enforcement ──────────────────────────
  - id: TC-047
    covers_requirements: [NFR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "CI lint passes when no forbidden network imports exist in pipeline or adapter packages"
    kind: smoke
    given: "pipeline and adapter packages contain no forbidden network imports"
    when: "CI lint runs"
    then: "lint passes; build proceeds"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-048
    covers_requirements: [NFR-001]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "CI lint fails the build when a forbidden network import is added to pipeline package"
    kind: negative
    given: "pipeline package is edited to add a forbidden network import"
    when: "CI lint runs"
    then: "lint fails the build with diagnostic naming the forbidden import"
    expected_outcome: pass
    fixtures: ["adversary-forbidden-net-import"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-049
    covers_requirements: [NFR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "integration test fires HTTP to disallowed host and asserts blocking + audit"
    kind: smoke
    given: "ADR-001 in-process egress hook is active"
    when: "integration test fires HTTP to a disallowed host"
    then: "request is blocked AND audit log records the attempt"
    expected_outcome: pass
    fixtures: ["adversary-egress-attempt-disallowed-host"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-050
    covers_requirements: [NFR-002]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "in-process egress hook is active during ALL operations on ALL documents (not sentinel-only)"
    kind: adversary
    given: "ADR-001 hook is active and Council Condition #2 (David objection) requires broad coverage"
    when: "broad workload exercises every doc-handling code path"
    then: "egress hook is invoked on every path; no sentinel-only escape; closes C-029"
    expected_outcome: pass
    fixtures: ["adversary-broad-egress-coverage"]
    blocked_by: null
    owner: ProductBuild

  # ── NFR-003, NFR-014, NFR-015: Performance baselines ──────────────────
  - id: TC-051
    covers_requirements: [NFR-003]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "corpus.find p95 latency at 5k docs is at most 250 ms"
    kind: smoke
    given: "corpus contains 5000 indexed docs (per ADR-004 budget)"
    when: "100 corpus.find calls are run from warm cache"
    then: "p95 latency ≤ 250 ms"
    expected_outcome: pass
    fixtures: ["benchmark-5k-doc-warm"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-052
    covers_requirements: [NFR-003]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "cold-cache run is reported separately and does not satisfy the warm-cache budget"
    kind: negative
    given: "corpus contains 5000 indexed docs and process is freshly started"
    when: "1 corpus.find call is run cold"
    then: "cold-cache result is labeled as such; does not count toward warm-cache p95 budget"
    expected_outcome: pass
    fixtures: ["benchmark-5k-doc-cold"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-053
    covers_requirements: [NFR-014]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "first-run setup completes in at most 90 seconds end-to-end"
    kind: smoke
    given: "fresh machine with Node 18+ and required deps"
    when: "first-run setup is invoked"
    then: "setup completes in ≤ 90 s; service is ready"
    expected_outcome: pass
    fixtures: []
    blocked_by: null
    owner: ProductBuild

  - id: TC-054
    covers_requirements: [NFR-015]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "SQLite WAL recovery on reopen completes in at most 2 seconds for WAL <100 MB"
    kind: smoke
    given: "SQLite WAL file is ≤ 100 MB after a crash"
    when: "process is restarted"
    then: "WAL recovery completes in ≤ 2 s; database is consistent"
    expected_outcome: pass
    fixtures: ["sqlite-wal-100mb"]
    blocked_by: null
    owner: ProductBuild

  # ── NFR-004, NFR-005: Pipeline reliability ────────────────────────────
  - id: TC-055
    covers_requirements: [NFR-004]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "a single schema-invalid classifier response in benchmark fails the NFR"
    kind: negative
    given: "classifier benchmark of 100 docs is running"
    when: "any single response fails schema validation"
    then: "NFR-004 is reported as failed (no partial-credit averaging)"
    expected_outcome: pass
    fixtures: ["benchmark-100doc-with-injected-bad"]
    blocked_by: null
    owner: ProductBuild

  - id: TC-056
    covers_requirements: [NFR-005, NFR-006]
    gherkin_ref:
      feature: ACCEPTANCE-CRITERIA.feature
      scenario: "NFR-006 metric requires minimum N=10 failure-lane events before computing rate"
    kind: adversary
    given: "denominator-floor mechanism is active per Council Condition #2 (F-15 / C-031)"
    when: "fewer than 10 failure-lane events have occurred"
    then: "NFR-006 metric is reported as 'insufficient data' (not a misleadingly perfect rate); closes C-031"
    expected_outcome: pass
    fixtures: ["adversary-low-N-failure-lane"]
    blocked_by: null
    owner: ProductBuild
```

## Negative-path test cases (REQUIRED for every must-have FR)

> Stage-5-exit gate `should_meet.test_plan_includes_negative_scenarios`
> requires every must-have FR to have at least one `kind: negative` test
> case. Build-Ready terminal gate logs failures here as `severity: medium`
> concerns (not blocking). Coverage table below.

```yaml
negative_coverage:
  - fr_id: FR-001
    negative_test_ids: [TC-002]
  - fr_id: FR-002
    negative_test_ids: [TC-004]
  - fr_id: FR-003
    negative_test_ids: [TC-006]
  - fr_id: FR-004
    negative_test_ids: [TC-008]
  - fr_id: FR-005
    negative_test_ids: [TC-010]
  - fr_id: FR-006
    negative_test_ids: [TC-012]
  - fr_id: FR-007
    negative_test_ids: [TC-014]
  - fr_id: FR-008
    negative_test_ids: [TC-016]
  - fr_id: FR-009
    negative_test_ids: [TC-018]
  - fr_id: FR-010
    negative_test_ids: [TC-020, TC-021]
  - fr_id: FR-011
    negative_test_ids: [TC-023]
  - fr_id: FR-012
    negative_test_ids: [TC-027]
  - fr_id: FR-013
    negative_test_ids: [TC-029]
  - fr_id: FR-014
    negative_test_ids: [TC-031]
  - fr_id: FR-015
    negative_test_ids: [TC-033]
  - fr_id: FR-016a
    negative_test_ids: [TC-035]
  - fr_id: FR-016b
    negative_test_ids: [TC-037]
  - fr_id: FR-017
    negative_test_ids: [TC-025]
  - fr_id: FR-018
    negative_test_ids: [TC-039]
  - fr_id: TR-001
    negative_test_ids: [TC-044]
  - fr_id: TR-002
    negative_test_ids: [TC-046]
  - fr_id: NFR-001
    negative_test_ids: [TC-048]
  - fr_id: NFR-002
    negative_test_ids: [TC-050]
  - fr_id: NFR-003
    negative_test_ids: [TC-052]
  - fr_id: NFR-004
    negative_test_ids: [TC-055]
  - fr_id: NFR-005
    negative_test_ids: [TC-037, TC-056]
  - fr_id: NFR-006
    negative_test_ids: [TC-056]
  # Note: UR-001/002 lack dedicated negative scenarios in .feature; UR-003 IS a negative-mode scenario (TC-042).
  - fr_id: UR-001
    negative_test_ids: []
  - fr_id: UR-002
    negative_test_ids: []
  - fr_id: UR-003
    negative_test_ids: [TC-042]
  - fr_id: NFR-014
    negative_test_ids: []
  - fr_id: NFR-015
    negative_test_ids: []
```

## Traceability matrix (auto-derived view)

| FR-id | Test cases | Gherkin scenarios | Negative coverage |
|-------|-----------|-------------------|-------------------|
| FR-001 | TC-001, TC-002 | 2 | yes |
| FR-002 | TC-003, TC-004 | 2 | yes |
| FR-003 | TC-005, TC-006 | 2 | yes |
| FR-004 | TC-007, TC-008 | 2 | yes |
| FR-005 | TC-009, TC-010 | 2 | yes |
| FR-006 | TC-011, TC-012 | 2 | yes |
| FR-007 | TC-013, TC-014 | 2 | yes |
| FR-008 | TC-015, TC-016 | 2 | yes |
| FR-009 | TC-017, TC-018 | 2 | yes |
| FR-010 | TC-019, TC-020, TC-021 | 3 | yes (incl. adversary) |
| FR-011 | TC-022, TC-023 | 2 | yes |
| FR-012 | TC-026, TC-027 | 2 | yes |
| FR-013 | TC-028, TC-029 | 2 | yes |
| FR-014 | TC-030, TC-031 | 2 | yes |
| FR-015 | TC-032, TC-033 | 2 | yes |
| FR-016a | TC-034, TC-035 | 2 | yes (adversary) |
| FR-016b | TC-036, TC-037 | 2 | yes |
| FR-017 | TC-024, TC-025 | 2 | yes (adversary) |
| FR-018 | TC-038, TC-039 | 2 | yes |
| UR-001 | TC-040 | 1 | no |
| UR-002 | TC-041 | 1 | no |
| UR-003 | TC-042 | 1 | yes (TC-042 is negative) |
| TR-001 | TC-043, TC-044 | 2 | yes |
| TR-002 | TC-045, TC-046 | 2 | yes |
| NFR-001 | TC-047, TC-048 | 2 | yes |
| NFR-002 | TC-049, TC-050 | 2 | yes (adversary) |
| NFR-003 | TC-051, TC-052 | 2 | yes |
| NFR-004 | TC-032, TC-055 | 2 | yes |
| NFR-005 | TC-037, TC-056 | 2 | yes |
| NFR-006 | TC-056 | 1 | yes (adversary) |
| NFR-014 | TC-053 | 1 | no |
| NFR-015 | TC-054 | 1 | no |

---

*Linked from: `OPPORTUNITY-TREE.yaml` (leaves), `REQUIREMENTS.yaml` (must-have), `ACCEPTANCE-CRITERIA.feature` (scenarios), `RISK-REGISTER.yaml` (mitigations under test).*
*Consumed by: `Tools/handoff-builder.ts` (verifies coverage before emitting `HANDOFF-TO-BUILD.yaml`), `ProductBuild` (generates test stubs from `test_cases` YAML block).*
