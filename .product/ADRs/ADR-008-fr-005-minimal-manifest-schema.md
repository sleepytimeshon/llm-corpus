---
artifact: ADR
adr_id: ADR-008
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
  decisions_jsonl_id: null            # answers Q-005 directly
  requirements_gated: [FR-005]
  roadmap_items_gated: [RM-003]
  related_adrs: []
  answers_questions: [Q-005]

reversibility: medium
tags: [mcp, manifest, schema]
---

# ADR-008: FR-005 v1 Manifest Resource — Minimal Schema

## Status

accepted

## Context

FR-005 exposes a `corpus://manifest` MCP resource that auto-loads at session start so agents can ground their reasoning in corpus context. Q-005 raised the scope: what fields does v1 include? Adding statistics (token counts, classifier-model versions) gives agents richer freshness reasoning but expands the resource surface.

**Forces / constraints:**
- Resource is auto-loaded on every session — cost is per-agent-session
- MCP resource size cap (per spec): keep under typical context-window-friendly size
- Agents (Claude Code, Gemini CLI) can call back to richer resources (taxonomy, recent-ingests) on demand if manifest doesn't carry every field
- v1 is primary tool surface for OPP-002 ("session resumption"); manifest must be enough for an agent to know what it has

**Alternatives considered:**

1. **Maximal manifest (corpus stats, classifier-model versions, ingest health, recent activity)** — Richest agent context; high recompute cost on every session start; resource size grows with corpus.
2. **Minimal manifest (just identity + counts)** — Lightest weight; agent must call corpus.find or other resources to learn anything specific; may force per-session probing.
3. **Identity + counts + last-classifier-model + last-ingest-timestamp** — Middle path: enough freshness signals for agent reasoning without becoming a stats dashboard.
4. **Configurable manifest (user picks fields)** — Maximum flexibility; complicates v1; YAGNI for v1.

**Origin of these alternatives:** Q-005 (Stage 2 Architect-raised); MCP resource design conventions; OPP-002 use case analysis.

## Decision

We will commit the **v1 manifest schema as identity + counts + freshness**:

```json
{
  "corpus_name": "string",                 // user-configurable corpus name
  "corpus_version": "string",              // build version of llm-corpus
  "doc_count": "integer",                  // total documents in corpus
  "established_domain_count": "integer",   // count of established domains in taxonomy
  "proposed_domain_count": "integer",      // count of proposed (not-yet-promoted) domains
  "last_ingest_at": "ISO-8601 string",     // timestamp of most recent successful ingest
  "last_classifier_model": "string",       // model identifier (e.g., "qwen2.5:7b") of most recent classification
  "tools_available": ["corpus.find"],      // names of registered MCP tools
  "resources_available": [                 // URIs of other auto-loadable resources
    "corpus://taxonomy",
    "corpus://recent-ingests",
    "corpus://docs/{id}"
  ]
}
```

Excluded from v1 (deferred to post-v1 ADR amendments if needed): total token count, embedding model identifier, per-domain document counts, ingest queue depth, failure-lane count.

## Consequences

**Positive:**
- Closes Q-005; FR-005 has shipable scope
- Manifest is small (≤500 bytes typical) — auto-loaded resource is cheap
- All listed fields are O(1) to compute (no full-corpus traversal at session start)
- Freshness fields (`last_ingest_at`, `last_classifier_model`) give agents enough signal to reason about staleness without a stats dump

**Negative:**
- Excludes some signals (token count) that agents could in principle use for context-budget reasoning
- Future field additions are per-field ADRs (proper, but small overhead)
- Agents must call corpus.health (FR-021) for richer diagnostic info

**Neutral:**
- The `tools_available` and `resources_available` lists are static for v1 (no plugin system); v2 dynamic discovery would extend this
- `last_classifier_model` field couples the manifest to the classifier; if classifier changes mid-corpus, freshness narrative remains coherent

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for FR-005 cover "manifest auto-loads on session start" + "manifest contains all 9 required fields" + "manifest excludes deferred fields (token count, etc.)"
- **Telemetry**: `manifest.served` event per NFR-016; emits manifest size byte count
- **Trigger to revisit**: agent feedback or telemetry shows ≥30% of sessions probe corpus.health within 5 s of session start → manifest is missing a freshness signal → ADR-008 amendment
