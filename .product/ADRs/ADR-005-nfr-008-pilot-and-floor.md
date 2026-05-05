---
artifact: ADR
adr_id: ADR-005
project_slug: llm-corpus
stage: 4-plan
tier: deep
template_version: 3.0.0
generated: 2026-04-26T00:11:00Z
generated_by: ProductDevelopment Skill v3.0
status: accepted
supersedes: null
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-04-26T00:11:00Z
date_accepted: 2026-04-26T00:35:00Z
product_type: software

links:
  decisions_jsonl_id: D-012
  requirements_gated: [NFR-008]
  roadmap_items_gated: [RM-001, RM-013]
  related_adrs: []
  answers_questions: [Q-001]

reversibility: medium
tags: [nfr, local-llm, pilot, ollama]
---

# ADR-005: NFR-008 Pre-Build Pilot Sprint with Provisional N=20 Floor

## Status

accepted

## Context

NFR-008 (priority: should per AG-004) commits an ABSOLUTE local-LLM tool-use floor: ≥ N corpus.find invocations per 100 mixed queries. CF-3 from Stage 1 forbids relative-to-cloud benchmarking. Stage 3 SP-006 deferred the actual N because live Ollama+MCP integration data was not buildable as a paper spike.

**Forces / constraints:**
- Priya persona's value proposition is isomorphic with NFR-008 — if local-LLMs do not call corpus.find reliably, the local-only RAG promise fails
- AG-004 caps NFR-008 as priority: should — it cannot become a v1 must-have; but should ≠ optional
- Berkeley Function Calling Leaderboard data shows 40-70% tool-use compliance on 7B-class models; FR-009 prompt template can move that number meaningfully
- C-030 (Sonnet-4-6 Council, Priya perspective): provisional N=20 without prompt-iteration budget is "guess dressed as floor"

**Alternatives considered:**

1. **Set N=20 in v1 spec, validate post-ship** — Lowest cost; risks shipping a flabby NFR. Original Stage 3 D-012 framing.
2. **Defer NFR-008 entirely to post-v1; downgrade to nice_to_have** — Removes the load-bearing Priya value proposition from v1. Not acceptable while AG-004 caps it as should.
3. **Pre-build pilot sprint (SP-000) with FR-009 prompt iteration on 2 model families before Sprint 1** — Highest signal pre-build; budgets prompt-engineering as a first-class deliverable. Per C-030 mitigation.
4. **Pilot sprint after Sprint 1 (foundation built first, then pilot)** — Pragmatic but late: by then sprint budget is committed, and a low-N result forces mid-build re-scoping.

**Origin of these alternatives:** Stage 3 SP-006 + Sonnet-4-6 Council Priya perspective (C-030 explicit mitigation language) + AG-004 enforcement.

## Decision

We will run **SP-000 as a pre-build pilot sprint** before Sprint 1 (RM-002 foundation), with the following minimum scope:

1. FR-009 retrieval prompt template authored and version-controlled
2. 100-query benchmark run on **both** Llama 3.1 8B Instruct and Qwen 2.5 7B Instruct via live Ollama+MCP integration
3. **At least 2 prompt-template iteration cycles** if the first run achieves <N=25 (margin above the N=20 provisional floor before declaring the floor met)
4. **Hard gate**: if no prompt variant achieves ≥20 on either model family after 2 iterations, NFR-008 is downgraded from `priority: should` to `priority: nice_to_have` BEFORE Sprint 1 of build, not after. Decision recorded in decisions.jsonl as a new D-NNN.

The provisional N=20 (D-012) remains in REQUIREMENTS.yaml as the working floor; SP-000 either confirms or supersedes it.

## Consequences

**Positive:**
- Closes C-030 (Priya Council objection) by elevating NFR-008 pilot work to a first-class sprint
- Forces FR-009 prompt template authoring before retrieval-bearing code locks the prompt surface
- Two-model coverage catches model-family-specific tool-use behavior before it surprises us mid-build
- Explicit downgrade path eliminates "drift through Stage 5 with NFR-008 quietly missed"

**Negative:**
- SP-000 adds an extra sprint to the v1 schedule before user-facing functionality ships
- Requires Ollama + Llama 3.1 8B Instruct + Qwen 2.5 7B Instruct downloads (~9 GB) on the build environment
- Prompt-template iteration is an empirical loop; budget is two iteration cycles, but real-world prompt engineering can be path-dependent

**Neutral:**
- The pilot output (final N or downgrade decision) is recorded in decisions.jsonl; future model upgrades may surface a higher N and trigger re-pilot
- AG-004 priority cap means even a great pilot result does not move NFR-008 to must

## Compliance / verification

- **Tests**: SP-000 exit criteria include "Both model families benchmarked, ≥2 prompt iteration cycles recorded, final N committed to ledgers"
- **Telemetry**: pilot run produces a structured record in `${PROJECT_ROOT}/.product/ledgers/decisions.jsonl` with prompt variants tested and per-model results
- **Trigger to revisit**: NFR-008 in production observed substantially below pilot N AND user (Priya persona) reports loss of value → open ADR-005-superseder
