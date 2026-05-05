---
artifact: ADR
adr_id: ADR-003
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
  decisions_jsonl_id: D-010
  requirements_gated: [FR-015, FR-016a]
  roadmap_items_gated: [RM-007]
  related_adrs: [ADR-002]

reversibility: medium
tags: [idempotency, sqlite, concurrency]
---

# ADR-003: SQLite UPSERT (INSERT ON CONFLICT) for Per-Stage Idempotency

## Status

accepted

## Context

FR-016a requires pipeline stages to be idempotent: re-running a stage produces the same result without duplicating rows. C-019 / QATester F-8 raised concurrent-write safety: two invocations of the same stage on the same document running in parallel must NOT produce duplicate rows.

**Forces / constraints:**
- SQLite is the storage layer (NFR-010 single-file constraint)
- Pipeline must survive kill -9 mid-stage (NFR-005); resume must not duplicate
- C-019 mitigation requires a concurrent-stage attack to leave exactly one row post-completion
- WAL mode is already required for performance (Stage 2 Research); compatible with chosen pattern

**Alternatives considered:**

1. **Application-level lock + INSERT** — Holds an in-process lock around the INSERT. Race-prone across processes (though MCP server is one process per session); breaks under kill -9; brittle.
2. **DELETE-then-INSERT inside transaction** — Atomic if wrapped in `BEGIN IMMEDIATE`. More verbose; loses any pre-existing fields the INSERT does not set (fragile to schema evolution).
3. **INSERT ... ON CONFLICT DO NOTHING / DO UPDATE SET ... (UPSERT)** — Atomic in a single statement (SQLite docs). WAL serializes commits. Unique constraint on `(doc_id, stage)` makes duplicates structurally impossible.
4. **Optimistic-version + retry loop** — Handles concurrent writers via `version` column + retry on stale version. More complex; adequate but over-engineered for the use case.

**Origin of these alternatives:** Stage 3 SP-004 + SQLite UPSERT documentation + C-019 mitigation. D-010 rationale cites SQLite WAL semantics specifically.

## Decision

We will use **SQLite UPSERT** (`INSERT ... ON CONFLICT(<unique-cols>) DO NOTHING | DO UPDATE SET ...`) as the idempotency primitive for FR-015 (index inserts) and FR-016a (per-stage checkpoint inserts). Specifically:

- **Per-stage checkpoint table**: UNIQUE constraint on `(doc_id, stage)`. Stage transitions use `INSERT ... ON CONFLICT(doc_id, stage) DO NOTHING`. The unique constraint makes duplicates structurally impossible.
- **Index doc_id**: UNIQUE constraint on `documents.doc_id`. Re-classification (UR-004) uses `INSERT ... ON CONFLICT(doc_id) DO UPDATE SET classification=excluded.classification, classified_at=excluded.classified_at`.
- **WAL mode**: enabled at first connection (`PRAGMA journal_mode=WAL`) with `synchronous=NORMAL`; per Stage 2 Research and NFR-015 (≤2s WAL recovery cap).

## Consequences

**Positive:**
- Closes C-019 / QATester F-8 concurrent-stage attack at the storage layer; no application-level locking required
- Single-statement atomicity is simpler to reason about than DELETE-then-INSERT or optimistic-version
- Pattern is the documented SQLite recommendation; well-understood
- WAL mode + UPSERT survives kill -9 with at-most-once semantics (NFR-005)

**Negative:**
- UPSERT semantics differ subtly between SQL dialects; if we ever migrate off SQLite (NFR-010 forbids this in v1), the pattern would not port directly to MySQL
- DO UPDATE SET clauses require careful column listing; missing column → silent stale data on re-classification. Schema migrations must extend DO UPDATE SET clauses correspondingly. CI lint rule recommended.
- WAL mode requires reader-writer separation in code paths; one connection cannot be both unless careful

**Neutral:**
- Future move to a different storage layer would require this ADR be superseded; current scope limits this concern

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for FR-016a include the C-019 concurrent-stage adversary case (same stage invoked twice in parallel for same document → exactly one row exists post-completion)
- **Telemetry**: `pipeline.upsert_no_op` / `pipeline.upsert_update` events per NFR-016
- **Trigger to revisit**: schema migration that extends `documents` table with column not included in DO UPDATE SET → CI lint flag → ADR amendment
