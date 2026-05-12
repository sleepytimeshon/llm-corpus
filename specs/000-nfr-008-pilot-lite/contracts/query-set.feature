# SP-000-Lite Contract: Query Set Authoring and Stratification
#
# Scenarios cover the 50-query YAML set committed to
# `specs/000-nfr-008-pilot-lite/queries.yaml`: bucket counts, retrieval-pattern
# coverage, worked-example verbatim verification, and substrate/source provenance.
#
# Mappings: FR-PILOT-002 (60/30/10 stratification), FR-PILOT-003 (3 retrieval
# patterns + definitions + worked examples), FR-PILOT-010 (32-PDF curated
# substrate), FR-PILOT-011 (query mining + hand-crafted buckets),
# FR-PILOT-012 (Q3 DRAFT ratification gate), SC-002 (lint passes).

Feature: SP-000-Lite query set stratification rubric

  Background:
    Given the query set is committed to `specs/000-nfr-008-pilot-lite/queries.yaml`
    And the stratification linter is implemented in `packages/pipeline/src/pilot-harness/stratification.ts`

  # ── FR-PILOT-002 bucket counts ──

  Scenario: Bucket counts are exactly 30/15/5
    When the stratification linter inspects `queries.yaml`
    Then the count of queries with `query_bucket == "knowledge_grounded"` equals exactly 30
    And the count of queries with `query_bucket == "general"` equals exactly 15
    And the count of queries with `query_bucket == "adversarial"` equals exactly 5
    And the total query count equals 50

  Scenario: Bucket count deviation blocks the pilot run
    Given the query set has 29 knowledge-grounded queries (one short)
    When the stratification linter runs
    Then the linter exits non-zero with an error citing FR-PILOT-002
    And the harness refuses to start the pilot

  # ── FR-PILOT-003 retrieval patterns + definitions ──

  Scenario: All three retrieval-pattern labels appear in the KG bucket
    When the stratification linter inspects the 30 KG queries
    Then at least 1 query carries `retrieval_pattern == "factual_lookup"`
    And at least 1 query carries `retrieval_pattern == "recall_by_context"`
    And at least 1 query carries `retrieval_pattern == "multi_doc_synthesis"`

  Scenario: General and adversarial buckets carry NULL retrieval_pattern
    When the stratification linter inspects the 15 general + 5 adversarial queries
    Then every query in those buckets carries `retrieval_pattern == null`

  Scenario: Each retrieval pattern has 2 worked examples whose text appears verbatim in the query set
    Given the spec carries operational definitions and worked examples for the three retrieval patterns
    When the stratification linter cross-references spec.md `## Retrieval Pattern Operational Definitions` against `queries.yaml`
    Then each retrieval pattern has exactly 2 worked-example queries with `worked_example_for == <that pattern>`
    And the `query_text` of each worked-example query matches verbatim the text published in the spec section

  Scenario: Each retrieval-pattern operational definition is exactly one sentence
    When a reviewer inspects spec.md `## Retrieval Pattern Operational Definitions`
    Then the `factual_lookup` definition consists of exactly one sentence
    And the `recall_by_context` definition consists of exactly one sentence
    And the `multi_doc_synthesis` definition consists of exactly one sentence

  # ── FR-PILOT-012 Q3 ratification gate ──

  Scenario: Unratified DRAFT definitions block the pilot run
    Given Q3 DRAFT definitions are present but have NOT been ratified in PR walkthrough
    When Shon attempts to run `corpus pilot run`
    Then the harness exits non-zero with an error citing FR-PILOT-012
    And no telemetry file is created

  Scenario: Ratified definitions unlock the pilot run
    Given Q3 DRAFT definitions have been ratified in PR walkthrough (recorded as an in-spec `<!-- ratified: true -->` HTML-comment marker on each of the three pattern sub-sections in spec.md, authored by Shon at PR-walkthrough time per tasks.md T019/T021)
    And the stratification linter passes
    When Shon runs `corpus pilot run --variant v1 --iteration 1`
    Then the harness starts the 50-query loop

  # ── FR-PILOT-010 substrate + FR-PILOT-011 query provenance ──

  Scenario: Substrate is the curated 32-PDF sampler enumerated in spec
    When the harness reads the seed corpus
    Then the corpus consists of exactly the 32 documents enumerated in spec.md `## Substrate File List`
    And all extracted text comes via `pdftotext` (PDFs) or `docx2txt`/`pandoc` (DOCX) per Q1 quality bar
    And no document from `~/Documents/Personal/Modeling/Aircraft/` is included (image-only subtree)
    And no Russian-language material is included
    And no self-written content (Practical Dharma, theravada-eightfold-path, The Long Shout, Tank & AFV Enthusiast) is included
    And no `.azw.md` Kindle artifact is included

  Scenario: Knowledge-grounded queries are mined from MEMORY/WORK PRD bodies
    When the stratification linter inspects the 30 KG queries
    Then each query carries `provenance == "mined-from-MEMORY-WORK"`
    And topic coverage has been cross-checked against Shon's bookmarks file (audit trail in PR review)

  Scenario: General and adversarial queries are hand-crafted (NOT corpus-mined)
    When the stratification linter inspects the 15 general + 5 adversarial queries
    Then each general query carries `provenance == "hand-crafted-general"`
    And each adversarial query carries `provenance == "hand-crafted-adversarial"`
    And no general query is paraphrased from substrate body text
    And no adversarial query is paraphrased from substrate body text

  # ── Stable query identification ──

  Scenario: query_id values are unique across the 50
    When the stratification linter inspects `queries.yaml`
    Then every `query_id` is unique
    And bucket-prefix convention is honored (e.g., `kg-001`, `g-001`, `adv-001`)
