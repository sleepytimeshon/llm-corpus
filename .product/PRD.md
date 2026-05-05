---
artifact: PRD
project_slug: llm-corpus
stage: 2-spec
tier: deep
template_version: 3.0.0
generated: 2026-04-27T02:12:10Z
generated_by: ProductDevelopment Skill v1.0
supersedes: null
product_type: software

counts:
  requirements_total: 50
  must_have: 32
  should_have: 13
  nice_to_have: 5

completeness:
  all_musts_have_ac: true
  all_musts_have_owner: true
  all_shoulds_have_ac: true
  no_blocking_questions: true

links:
  requirements_canonical: ./REQUIREMENTS.yaml
  acceptance_criteria: ./ACCEPTANCE-CRITERIA.feature
  opportunity_tree: ./OPPORTUNITY-TREE.yaml
  charter: ./CHARTER.md
  success_metrics: ./SUCCESS-METRICS.md
  anti_goals: ./ANTI-GOALS.md
  personas: ./PERSONAS.md

sources:
  decisions: ./ledgers/decisions.jsonl
  concerns: ./ledgers/concerns.jsonl
  questions: ./ledgers/questions.jsonl
---

# PRD — llm-corpus

> **Canonical artifact note.** This PRD is the human-readable derived view of
> [`./REQUIREMENTS.yaml`](./REQUIREMENTS.yaml). The YAML file is the single source
> of truth that `ProductBuild` consumes. Discrepancies resolve in favor of the YAML.

## 1. Overview

llm-corpus is a local-first knowledge substrate for AI terminal agents. The user
supplies documents (file drop, URL, inbox watcher, direct command); the system
normalizes them to Markdown with structured YAML frontmatter, classifies them
through a local LLM whose output is constrained at the token-generation level by
a Zod-derived JSON Schema, and indexes them under hybrid retrieval (BM25 + dense
+ knowledge-graph + confidence) inside a single SQLite file. A read-only Model
Context Protocol server exposes the corpus to any MCP-aware agent.

**Outcome (from CHARTER.md):** Knowledge workers using AI terminal agents (or
local LLMs) get answers grounded in the documents they have actually chosen to
keep, every session, without sending those documents to the cloud or hand-tagging
them.

**Success signal (M-001):** ≥5 corpus.find calls per week with ≥1 hit accepted by
Shon, sustained over a 4-week rolling window.

**Tier:** deep · **Stage:** 2-spec · **Generated:** 2026-04-27T02:12:10Z

## 2. Users & Personas

Three personas drive Stage 2 requirements (full detail in
[`./PERSONAS.md`](./PERSONAS.md)):

- **Maya R.** (P-001) — Knowledge worker on Claude Code; primary user of inbox
  drop + agent-grounded queries (UR-001, UR-002).
- **David Okafor** (P-002) — Privacy-conscious technical writer; primary user of
  cross-document grounding + local-only invariant (UR-002, NFR-001/002).
- **Priya** (P-003) — ML researcher running local LLMs (Ollama-served);
  validates portability properties (FR-023, NFR-008) — should-priority per AG-004.

## 3. Goals & Non-Goals

**Goals (what success looks like at end of build):**

- corpus.find tool returns ranked, grounded SearchHits to any MCP-aware agent
  within p95 ≤ 250 ms at 5k docs (NFR-003).
- Inbox drop → searchable in ≤ 90 seconds end-to-end on first-run setup (NFR-014).
- Local-only invariant verified by both compile-time lint (NFR-001) and runtime
  egress audit (NFR-002, refines A-007 per CF-2).
- Pipeline survives kill -9 at any stage with no duplicate ingest (NFR-005).
- Classifier emits 100% schema-valid output via grammar-constrained generation
  (NFR-004).
- 32 must-have requirements, each with ≥2 Gherkin acceptance scenarios.

**Non-Goals (deliberately not in scope; full list in REQUIREMENTS.yaml `out_of_scope:`):**

- Human-facing UI for browsing, editing, or chatting with documents (AG-001 →
  OOS-001..004).
- LLM-generated or LLM-rewritten content in the document store (AG-002 →
  OOS-005..007).
- Conversation memory, SaaS connectors, multi-user model (AG-003 → OOS-008..010).
- Cross-agent USER-VALIDATED capability claim in v1 (AG-004 → OOS-011); cross-agent
  ships as portability property only (FR-022, FR-023, NFR-007, NFR-008 are all
  should-priority per AG-004).
- 50-query labeled retrieval evaluation harness (AG-005 → OOS-012; v1.5+ work).

## 4. Scope & Out-of-Scope

In-scope for v1: 32 must-have requirements (see Section 5) covering MCP server
core surface (corpus.find tool + 4 resources + prompt template), ingest pipeline
(inbox watcher → normalize → classify → embed → index), 5 reliability NFRs
(local-only static + runtime, kill -9 survival, schema-valid 100%, WAL recovery),
2 performance NFRs (corpus.find latency, first-run setup), 3 stakeholder workflows
(Maya/David), 2 transition requirements (install/uninstall).

Out-of-scope for v1: 12 OOS items (see REQUIREMENTS.yaml `out_of_scope:`); cross-agent
must-have promotion (AG-004 enforced); all UI surfaces (AG-001 enforced).

## 5. Requirements

The canonical requirements live in [`./REQUIREMENTS.yaml`](./REQUIREMENTS.yaml).
This section summarizes the 32 must-have requirements grouped by category. Each
must-have requirement has at least 2 Gherkin acceptance scenarios in
[`./ACCEPTANCE-CRITERIA.feature`](./ACCEPTANCE-CRITERIA.feature).

### 5.1 Solution requirements (MCP server core surface) — 9 must-haves

- **FR-001..004** — corpus.find tool (discoverable over stdio, structured query
  in / SearchHit list out, hybrid ranking via BM25+dense+graph+confidence,
  deterministic structured error envelope on failure)
- **FR-005..008** — MCP resources (manifest auto-loaded, taxonomy of established
  domains+tags, recent-ingests, per-document URI)
- **FR-009** — Reusable MCP prompt template instructing agents to invoke
  corpus.find before answering knowledge-grounded questions

### 5.2 Solution requirements (Ingest pipeline) — 10 must-haves

- **FR-010..011** — Inbox watcher with validation gate; pipeline normalizes
  documents to Markdown + YAML frontmatter
- **FR-012..014** — Local-LLM classifier with grammar-constrained output (FR-012);
  defense-in-depth schema validation (FR-013); vocabulary validation against
  established taxonomy (FR-014)
- **FR-015** — Embedding + indexing into single SQLite file (BM25 via FTS5 +
  sqlite-vec for dense)
- **FR-016a/016b** — Pipeline idempotency (re-running stage = no duplicates) and
  resumability (kill survives, resumes from per-stage checkpoint) — split per
  Splitting Test
- **FR-017** — Content-hash idempotency keys prevent duplicate ingest
- **FR-018** — Failure lane with structured diagnostics (stage, error_code,
  retriable flag, source pointer) — inspectable via filesystem AND MCP resource

### 5.3 Stakeholder requirements — 3 must-haves

- **UR-001** — Maya drops file → queryable without further action
- **UR-002** — Maya/David ask agent → grounded answer with traceable corpus://docs/
  URIs
- **UR-003** — Single install → corpus available across new agent sessions
  (auto-loaded resources)

### 5.4 Transition requirements — 2 must-haves

- **TR-001** — Single `corpus init` provisions XDG layout + index + inbox + MCP
  client registration; no multi-step manual config
- **TR-002** — Reversible uninstall: removes server registration, preserves user
  data by default (destructive only with explicit flag)

### 5.5 Non-functional requirements — 8 must-haves

- **NFR-001** — Compile-time local-only enforcement via lint of forbidden network
  imports in pipeline+adapter packages
- **NFR-002** — Runtime egress audit on privileged-data path: zero outbound
  non-loopback packets observed by tcpdump on sentinel doc cycle (refines A-007
  per CF-2; in-process Node hook + OS-level pf/iptables defense-in-depth per
  Stage 2 Research)
- **NFR-003** — corpus.find p95 ≤ 250 ms at 5k docs (Research-baselined; Smart
  Connections "responsive without third-party vector DB" UX bar)
- **NFR-004** — Classifier 100% schema-valid on 100-doc benchmark (validates A-004)
- **NFR-005** — Pipeline survives SIGKILL at all 5 stages on 50-doc set; SQLite
  PRAGMA integrity_check passes
- **NFR-006** — Failure-lane diagnostics actionable without UI (100% on 30-day use)
- **NFR-014** — First-run setup ≤ 90 sec npx-init to first corpus.find result
  (Research-baselined; Letta sub-min, Mem0 2-5 min comparison)
- **NFR-015** — SQLite WAL recovery ≤ 2 sec for WAL <100 MB (Research-baselined;
  SQLite WAL docs)

### 5.6 Should-have requirements — 13 total

Detailed in REQUIREMENTS.yaml. Highlights:

- **FR-019..021** — Dynamic-taxonomy promotion mechanism, URL inbox source,
  corpus.health diagnostic resource
- **FR-022..023** — Cross-agent portability surfaces (Gemini CLI, Codex CLI,
  Ollama-served local LLMs) — TAGGED `quality_flag: conflicts-anti-goal` per
  AG-004 to enforce should-priority cap
- **NFR-007** — Cross-agent retrieval-quality parity (top-3 Jaccard ≥ 0.7;
  refines A-006 per CF-1; AG-004 → should-priority)
- **NFR-008** — Local-LLM tool-use rate ≥ N corpus.find / 100 llama queries —
  ABSOLUTE target, not relative-to-cloud-baseline (refines A-008 per CF-3;
  PM-Review confirmed C-006 invalid; AG-004 → should-priority); N TBD by
  Validate spike
- **NFR-009..011, NFR-016** — Classifier wall-clock budget, single SQLite file,
  structured event log, ≥6 telemetry event classes (Research-baselined)

### 5.7 Nice-to-have requirements — 5 total

FR-024 (email/inbox-watcher source), FR-025 (corpus.related tool over
knowledge-graph edges), FR-026 (user feedback channel for SearchHit
accept/reject), NFR-012 (zero paid-API marginal cost), NFR-013 (qualitative
30-day taxonomy-growth satisfaction).

## 6. Open Questions

5 open questions surfaced during decomposition (also in
[`./ledgers/questions.jsonl`](./ledgers/questions.jsonl)):

- **Q-001** (blocks NFR-008) — Absolute floor for corpus.find / 100 local-LLM
  queries; depends on Validate spike data
- **Q-002** (blocks FR-019) — Adoption threshold N for taxonomy promotion;
  depends on A-010 spike (false-promotion rate at varying N)
- **Q-003** (blocks FR-020, NFR-001) — URL-fetch adapter packaging vs lint
  per-file allowlist annotations; deferred to Plan-stage ADR
- **Q-004** (blocks FR-010, FR-011) — MIME types/extensions accepted by
  validation gate in v1; Plan finalizes allowlist (consult MEDIA-INGESTION-SPEC)
- **Q-005** (blocks FR-005) — Manifest resource schema (statistics + freshness
  surface vs minimal); Plan stage decides

None block Stage 3 entry.

## 7. Stage 1 carry-forwards (CF-1..CF-5) — disposition

| CF | Source (Stage 1 handoff) | Stage 2 disposition |
|---|---|---|
| **CF-1** | Refine A-006: cross-agent retrieval-quality parity | NFR-007 + Gherkin scenario `@should @cf-1 @refines-a-006` (top-3 Jaccard ≥ 0.7) |
| **CF-2** | Refine A-007: runtime egress audit on privileged-data path | NFR-002 + Gherkin scenario `@must @cf-2 @refines-a-007` (zero non-loopback packets) |
| **CF-3** | Refine A-008: absolute threshold (NOT cloud-relative) | NFR-008 + Gherkin scenario `@should @cf-3 @refines-a-008` (absolute, N from Validate); cloud-baseline framing rejected per PM-Review C-006 invalidation |
| **CF-4** | Per-opportunity hard metrics for OPP-003/005/008 | M-002 (OPP-003 classifier autonomy), M-003 (OPP-005 local-only invariant), M-004 (OPP-008 pipeline autonomy) added to SUCCESS-METRICS.md (edition: spec) |
| **CF-5** | Honor AG-004: no cross-agent must-haves | Enforced — FR-022/023, NFR-007/008 are all `priority: should`; tagged `quality_flag: conflicts-anti-goal`; OOS-011 documents the boundary explicitly |

All 5 carry-forwards landed in Stage 2 outputs. Gate post-check verifies presence
(see `gate.yaml` Stage 2 must_meet rules + orchestrator-added checks).

---

*Canonical: [`./REQUIREMENTS.yaml`](./REQUIREMENTS.yaml) · Acceptance criteria: [`./ACCEPTANCE-CRITERIA.feature`](./ACCEPTANCE-CRITERIA.feature) · Charter: [`./CHARTER.md`](./CHARTER.md) · Opportunity tree: [`./OPPORTUNITY-TREE.yaml`](./OPPORTUNITY-TREE.yaml)*
