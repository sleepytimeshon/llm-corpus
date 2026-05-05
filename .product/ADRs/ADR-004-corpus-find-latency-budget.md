---
artifact: ADR
adr_id: ADR-004
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
  decisions_jsonl_id: D-005
  requirements_gated: [NFR-003, FR-002, FR-003]
  roadmap_items_gated: [RM-006]
  related_adrs: []

reversibility: medium
tags: [performance, retrieval, sqlite-vec]
---

# ADR-004: corpus.find p95 Latency Budget = 250ms at 5k Docs

## Status

accepted

## Context

NFR-003 commits a corpus.find latency target. The number anchors the architectural choices for index, retrieval fusion, and caching policy.

**Forces / constraints:**
- Smart-Connections-style "responsive without a third-party vector DB" UX bar
- sqlite-vec exhaustive KNN benchmarked at 8-25 ms on 5 k 384-dim vectors per Stage 2 Research
- FTS5 BM25 single-digit-ms at this scale per Stage 2 Research
- Hybrid fusion (BM25 + dense + graph + confidence) adds overhead per FR-003
- NFR-014 90 s first-run budget bounds setup, not query-time

**Alternatives considered:**

1. **p95 ≤ 1000 ms** — Stage 2 Architect candidate baseline; safer to commit but overly loose given Research data.
2. **p95 ≤ 500 ms** — Comfortable margin above measured latency; conservative.
3. **p95 ≤ 250 ms with p50 ≤ 100 ms** — Aggressive but achievable per measured 8-25 ms KNN + BM25; total fusion overhead estimated ≤180 ms per Stage 2 Research.
4. **p95 ≤ 100 ms** — Below measured KNN + BM25 baseline at 5 k; would force ANN index (sqlite-vec roadmap, not available now); too aggressive for v1.

**Origin of these alternatives:** Stage 2 Research baselines + Stage 2 Architect candidates + D-005 rationale.

## Decision

We will commit **p95 ≤ 250 ms** at 5 k documents for corpus.find, with **p50 ≤ 100 ms** as a soft target. Measurement: harness runs 100 representative queries against a 5 k-doc corpus snapshot; p95 measured at the corpus.find tool boundary (post-MCP-handshake, pre-result-serialization).

A hard ceiling is also committed: at 25 k docs, latency is allowed to degrade visibly but must not exceed 750 ms p95 (3× budget). At 50 k docs, NFR-003 is no longer guaranteed; corpus.health (FR-021) emits a warning when crossing 25 k. ANN index (sqlite-vec roadmap) is the documented remediation if growth continues past 25 k.

## Consequences

**Positive:**
- Aligns architecture with measured Research baselines, not a guess
- Drives concrete sprint exit criteria (latency harness in SP-005)
- Forces hybrid-fusion overhead budget to be tracked, not treated as free

**Negative:**
- Aggressive enough that any unexpected fusion overhead (e.g., graph-edge lookup at scale) could fail the gate; mitigation requires re-architecting fusion order or falling back to a cached result
- Commits us to sqlite-vec exhaustive KNN as the v1 retrieval backend; switching to ANN before 25 k would be a v1 scope change
- Stage 2 Research data was at 5 k; p95 at 25 k is extrapolated, not measured

**Neutral:**
- The hard ceiling at 25 k → 750 ms gives a graceful degradation path
- Future ADR will be needed if NFR-003 is consistently missed at 5 k; rollback_criteria in SP-005 fires the recycle

## Compliance / verification

- **Tests**: SP-005 exit criteria include "100-query latency harness on 5 k-doc snapshot p95 ≤ 250 ms p50 ≤ 100 ms"; CI re-runs on each release
- **Telemetry**: `query.latency_ms` event per NFR-016; aggregated to p50/p95 in corpus.health resource (FR-021)
- **Trigger to revisit**: corpus growth past 25 k AND p95 > 750 ms in operation → open ADR-004-superseder choosing ANN backend
