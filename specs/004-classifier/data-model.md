# Phase 1 — Data Model: Local LLM Classifier

**Feature**: 004-classifier
**Date**: 2026-05-13

This document formalizes the SP-004 entities, their fields, invariants, lifecycle, persistence paths, and their mapping into the existing SP-002 `documents` SQLite table + the body-file YAML frontmatter (per SP-002's SP-003-populated `body_path` layout from Decision I). It also enumerates the new telemetry event-class Zod schemas added to the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (PREREQ-002).

SP-004 does NOT change the SQL schema column shape — the existing `documents` and `taxonomy_terms` columns are preserved verbatim. SP-004 only changes VALUES (sentinel → classified) on the documents side, and ADDS proposed-state rows on the taxonomy_terms side.

---

## Entity 1 — ClassifierOutput

The Zod-typed shape returned by Ollama's structured-output endpoint. Defined in `packages/contracts/src/classifier-schema.ts` (PREREQ-001). Bound to Ollama's `format` parameter at module-load time via `zod-to-json-schema` (Decision J).

**Required fields**:

```typescript
const ClassifierOutputZodSchema = z.object({
  facet_domain: z.string().min(1),               // must be in EstablishedVocabulary.domains (FR-CLASSIFY-006 defense-in-depth)
  facet_type: z.enum(FACET_TYPE_VALUES),         // SCHEMA.md 7-value: entity | concept | tutorial | analysis | reference | synthesis | cheat-sheet
  tags: z.array(z.string().min(1)).min(3).max(10), // each tag must be in EstablishedVocabulary.tags OR in facet_tags_proposed
  summary: z.string().min(1).max(500),           // 15-25 words target per SCHEMA.md; bounded for size-budget
  confidence: z.object({
    domain: z.number().min(0).max(1),
    type: z.number().min(0).max(1),
    tags: z.number().min(0).max(1),
  }),
  facet_domain_proposed: z.string().optional(),    // present iff classifier proposes a new domain (FR-CLASSIFY-007)
  facet_tags_proposed: z.array(z.string()).optional(), // present iff classifier proposes new tags (FR-CLASSIFY-007)
}).strict();  // strict mode — no extra fields accepted; coerces nothing
```

**Field invariants**:
- `facet_domain`: MUST be present in `EstablishedVocabulary.domains` at validation time (FR-CLASSIFY-006). If absent, defense-in-depth routes the row to failure lane with `error_code='vocabulary_violation'`.
- `facet_type`: MUST be one of `FACET_TYPE_VALUES` — enforced by Zod enum at parse time (FR-CLASSIFY-014).
- `tags`: each tag MUST be present in `EstablishedVocabulary.tags` OR present in this same response's `facet_tags_proposed` array. Mixed established-and-proposed tags are permitted; a tag in `tags` but NOT in either set → failure-lane routing.
- `summary`: bounded to 500 chars. Lands in body-file frontmatter (FR-CLASSIFY-008); NEVER in telemetry payloads (Principle I + SC-CLASSIFY-020).
- `confidence`: sub-scores ∈ [0, 1]. NEVER persisted to disk (FR-CLASSIFY-013). Lands in telemetry's `classify.completed` event under `confidence_summary` (rounded to 2 decimal places). Used in-memory for retry-decision logic (deferred to a future low-confidence-review surface).
- `facet_domain_proposed`: OPTIONAL. If present, the value is INSERTed into `taxonomy_terms` with `axis='domain', state='proposed'` (FR-CLASSIFY-007). NEVER persisted to document frontmatter (the proposed field is metadata about the proposal, not the document's classification).
- `facet_tags_proposed`: OPTIONAL. Each entry INSERTed into `taxonomy_terms` with `axis='tag', state='proposed'` (FR-CLASSIFY-007). Same constraints as `facet_domain_proposed`.

**Lifecycle**:
- Produced by Ollama via structured-output generation against the `CLASSIFIER_OUTPUT_JSON_SCHEMA` (rendered once at module-load time via `zodToJsonSchema(ClassifierOutputZodSchema)`).
- Parsed by `validate.ts` via `ClassifierOutputZodSchema.parse(jsonText)` (FR-CLASSIFY-005).
- Cross-checked against `EstablishedVocabulary` snapshot (FR-CLASSIFY-006).
- Mapped to SQL UPDATE columns (`facet_domain`, `tags_json`, `facet_type`) + body-file frontmatter mirror + `taxonomy_terms` proposed-state INSERTs (FR-CLASSIFY-008).
- Confidence retained in-memory + telemetry only.

**Persistence target**:
- `documents.facet_domain` ← `facet_domain` (string)
- `documents.facet_type` ← `facet_type` (enum value)
- `documents.tags_json` ← `JSON.stringify(tags)` (compact JSON array)
- Body-file YAML frontmatter at `Paths.docs() + '/' + row.body_path` — keys: `facet_domain`, `facet_type`, `tags`, `summary` (mirror of SQL + summary).
- `taxonomy_terms` (zero or more rows) — `axis='domain', term=<facet_domain_proposed>` and/or `axis='tag', term=<facet_tags_proposed[i]>`, both with `state='proposed', established_at=NULL`.

---

## Entity 2 — EstablishedVocabulary

An in-memory snapshot of `taxonomy_terms WHERE state='established'`, grouped by axis. Loaded once per classify-stage invocation (Decision E in research.md — per-batch refresh).

**Fields**:

```typescript
type EstablishedVocabulary = {
  domains: Set<string>;   // SELECT term FROM taxonomy_terms WHERE axis='domain' AND state='established'
  tags: Set<string>;      // SELECT term FROM taxonomy_terms WHERE axis='tag' AND state='established'
  types: Set<string>;     // SELECT term FROM taxonomy_terms WHERE axis='type' AND state='established'  (informational only; facet_type is constitutional FACET_TYPE_VALUES)
  snapshot_id: string;    // UUID v4 generated at load time; used as a stable identifier in classify.started telemetry
  loaded_at: string;      // ISO-8601 UTC at load time
};
```

**Invariants**:
- `domains` / `tags` / `types` Sets are read-only after construction (cast to `ReadonlySet<string>` in TypeScript). Mutation is FORBIDDEN.
- Loaded via `loadEstablishedVocabulary(db, signal): Promise<Result<EstablishedVocabulary, StorageError>>` in `packages/inference/src/vocabulary.ts`.
- The `types` axis is informational. SP-004 does NOT validate the `facet_type` field against `types` — the validation is against `FACET_TYPE_VALUES` (constitutional enum, FR-CLASSIFY-014). The `types` axis exists to give SP-002's `corpus://taxonomy` a fourth axis surface; SP-004 reads it for completeness but doesn't use it for validation.

**Lifecycle**:
- Loaded: at the start of each classify-stage invocation (single-doc from daemon hook OR batch from `corpus reenrich`).
- Lifetime: the invocation. Subsequent invocations re-load. No global cache.
- Stale: by design — newly-proposed terms inserted mid-batch by the same drain-lock-holding process do NOT appear in the current snapshot (Decision E rationale).

**Persistence**: not persisted — purely in-memory. The underlying data lives in the `taxonomy_terms` SQLite table.

---

## Entity 3 — ProposedTerm

A row in `taxonomy_terms` with `state='proposed'`, inserted by SP-004 when the classifier emits a `facet_domain_proposed` or `facet_tags_proposed` value.

**Schema** (existing `taxonomy_terms` columns, unchanged):

```sql
CREATE TABLE IF NOT EXISTS taxonomy_terms (
  axis             TEXT NOT NULL,
  term             TEXT NOT NULL,
  state            TEXT NOT NULL,
  established_at   TEXT,                              -- NULL for proposed; ISO-8601 UTC when promoted
  PRIMARY KEY (axis, term),
  CHECK (axis IN ('domain', 'tag', 'type', 'source_type')),
  CHECK (state IN ('proposed', 'established'))
);
```

**SP-004 INSERT contract**:

```sql
INSERT INTO taxonomy_terms (axis, term, state, established_at)
VALUES (?, ?, 'proposed', NULL)
ON CONFLICT(axis, term) DO NOTHING;
```

**Field-by-field**:

| Column | Value source | Notes |
|---|---|---|
| `axis` | `'domain'` (from `facet_domain_proposed`) OR `'tag'` (from `facet_tags_proposed[i]`) | SP-004 only writes domain + tag axes. The `type` and `source_type` axes are NOT written by SP-004 (type is constitutional; source_type is SP-003-owned per data-model.md). |
| `term` | The classifier-emitted proposed value (raw string) | NO normalization (no lowercase, no kebab-case enforcement); the user-review workflow will normalize at promotion. |
| `state` | `'proposed'` literally — baked into the SQL string in `taxonomy-terms-adapter.ts` (PREREQ-005 — the adapter function takes only axis + term parameters; the state literal is not parameterized) | Defense-in-depth: there is no SP-004 code path that can INSERT `state='established'`. The only way to land an established-state row is via a future user-review promotion workflow. |
| `established_at` | `NULL` literally | Set to ISO-8601 UTC by the future user-review promotion workflow; SP-004 never writes this column non-NULL. |

**Invariants**:
- `state='proposed'` rows are invisible to SP-002's `corpus://taxonomy` MCP resource (that resource filters on `state='established'` per its SP-002 contract).
- Duplicate proposals (same axis, same term) collapse to a single row via `ON CONFLICT DO NOTHING`.
- Promotion: out of SP-004's scope. Principle XV's `N ≥ 3 in 30 days` is a GATE for a future user-review workflow, not an auto-trigger.

**Telemetry**: each insert-or-conflict emits a `classify.term_proposed` event with `axis`, `term`, `doc_id`. (Conflicted inserts also emit the event — observability of repeated proposals helps the future user-review surface prioritize popular suggestions.)

---

## Entity 4 — Body-File Frontmatter (post-SP-004 shape)

The body file at `Paths.docs() + '/' + row.body_path` (SP-003's Decision I layout: `'store/<id-prefix>/<doc-id>.md'`). SP-003 wrote it with the FR-008 minimum frontmatter; SP-004 rewrites the frontmatter section to mirror the classifier output. The body section (post-frontmatter Markdown) is byte-preserved (FR-CLASSIFY-013 + Principle II).

**SP-004 post-classify frontmatter shape**:

```yaml
---
id: doc-ab12cd34                                  # PRESERVED from SP-003
source_path: /home/.../inbox/foo.pdf              # PRESERVED from SP-003
ingest_timestamp: 2026-05-12T14:23:45.123Z        # PRESERVED from SP-003
mime_type: application/pdf                        # PRESERVED from SP-003
hash: a1b2c3...64hexchars                         # PRESERVED from SP-003
title: foo                                        # PRESERVED from SP-003 (filename basename)
facet_domain: agent-systems                       # SP-004 — from ClassifierOutput.facet_domain
facet_type: tutorial                              # SP-004 — from ClassifierOutput.facet_type
tags: [agent-memory, retrieval, tutorial]         # SP-004 — from ClassifierOutput.tags
summary: One-sentence insight here.               # SP-004 — from ClassifierOutput.summary (if produced)
---

<Markdown body — byte-preserved from SP-003 — Principle II>
```

**Forbidden fields in persisted frontmatter** (Principle II + FR-CLASSIFY-013):
- `confidence` — confidence sub-scores never appear in frontmatter
- `origin`, `provenance_*`, `captured_at`, `corpus capture` — Principle II forbidden-list
- `facet_domain_proposed`, `facet_tags_proposed` — proposed-term metadata lives in `taxonomy_terms`, not in document frontmatter
- `facet_topic`, `facet_stage` — present in SCHEMA.md v1.0 but NOT in scope for SP-004 (would need a future ADR to add)
- `date_ingested`, `source`, `related` — SCHEMA.md v1.0 fields that SP-003 doesn't write and SP-004 doesn't add

**Codec contract**: SP-004's classify-persister calls `stringifyMarkdownWithFrontmatter({frontmatter: {...allowed}, body: <byte-preserved>})` from `packages/contracts/src/markdown-frontmatter.ts` (SP-002 single YAML routing per Principle V). The function is called with an object whose keys are EXACTLY the allowed-fields list — passing any forbidden key is a programming error that the unit-test surface catches.

**Atomicity**: written via `withTempDir` (`tmp + fsync + rename + dirsync`) per Principle VIII. The tmp file is created outside the SQLite transaction; the atomic rename is the LAST step before the SQL COMMIT (FR-CLASSIFY-008 + Decision F).

---

## Entity 5 — `documents` Row (post-SP-004 UPDATE)

The `documents` SQLite row whose `facet_type='unclassified'` sentinel transitions to a populated `facet_type` value via SP-004's UPDATE statement. The COLUMN SHAPE is unchanged from SP-003's data-model — SP-004 only changes VALUES.

**Schema (unchanged from SP-003)**:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY        NOT NULL,
  title             TEXT                    NOT NULL,
  body_path         TEXT                    NOT NULL,
  source_path       TEXT                    NOT NULL,
  facet_domain      TEXT                    NOT NULL,    -- SP-004 OVERWRITES
  tags_json         TEXT                    NOT NULL,    -- SP-004 OVERWRITES
  facet_type        TEXT                    NOT NULL,    -- SP-004 OVERWRITES
  source_type       TEXT                    NOT NULL,    -- SP-003-OWNED, untouched by SP-004
  mime_type         TEXT                    NOT NULL,
  hash              TEXT                    NOT NULL,    -- UNIQUE per SP-003 PREREQ-002
  ingest_timestamp  TEXT                    NOT NULL,
  status            TEXT                    NOT NULL,
  CHECK (id GLOB 'doc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  CHECK (status IN ('success', 'failed', 'trashed'))
);
```

**SP-004 UPDATE statement** (FR-CLASSIFY-008):

```sql
UPDATE documents
SET facet_domain = ?,
    tags_json = ?,
    facet_type = ?
WHERE id = ?
  AND facet_type = 'unclassified';
```

The `AND facet_type='unclassified'` clause is defense-in-depth idempotency (FR-CLASSIFY-012): if the row was already classified by a concurrent run (extremely unlikely given the drain-lock, but possible if the lock were ever bypassed), the UPDATE affects 0 rows and the transaction rolls back without writing the body-file frontmatter mirror.

**Field-by-field mapping (SP-004 → SQL)**:

| Column | SP-004 writes? | Source | Notes |
|---|---|---|---|
| `id` | No | Preserved | SP-003-owned. |
| `title` | No | Preserved | SP-003 wrote filename basename; SP-004 doesn't overwrite (a future heuristic-title-from-body sprint could). |
| `body_path` | No | Preserved | SP-003 wrote `'store/<id-prefix>/<doc-id>.md'`; SP-004 doesn't change the path, only the frontmatter content. |
| `source_path` | No | Preserved | Forensics. |
| `facet_domain` | **Yes** | `ClassifierOutput.facet_domain` | MUST be in `EstablishedVocabulary.domains` (FR-CLASSIFY-006). |
| `tags_json` | **Yes** | `JSON.stringify(ClassifierOutput.tags)` | Compact JSON; each tag MUST be in `EstablishedVocabulary.tags` OR in this response's `facet_tags_proposed`. |
| `facet_type` | **Yes** | `ClassifierOutput.facet_type` | Must be in `FACET_TYPE_VALUES`. |
| `source_type` | No | Preserved | SP-003 wrote `'inbox-filesystem'`; SP-004 does NOT touch (source identity is stable). |
| `mime_type` | No | Preserved | SP-003-owned. |
| `hash` | No | Preserved | UNIQUE constraint. |
| `ingest_timestamp` | No | Preserved | SP-003-owned. |
| `status` | No | Preserved at `'success'` | SP-003 writes `'success'`; SP-004 doesn't change. Classify failures route to the failure-lane sidecar, NOT to a `status='failed'` row update. |

**Invariants**:
- One UPDATE per successfully classified document.
- The UPDATE + 0..N taxonomy_terms INSERTs + body-file frontmatter rewrite atomic-rename commit in a single SQLite transaction (Constitution VIII).
- All NOT NULL columns remain populated (the UPDATE replaces values, not nullables).
- `source_type='inbox-filesystem'` is preserved (SP-003 producer pathway).

---

## Entity 6 — ClassifyTelemetryEvent (≥ 11 new SP-004 classes)

All SP-004 telemetry events extend the existing `TelemetryEvent` discriminated union in `packages/contracts/src/telemetry.ts` (additive — no breaking change to SP-001/SP-002/SP-003 events).

**Shared envelope fields**:
- `event: string` (z.literal-narrowed per class) — matches the SP-001/SP-002 + SP-003 ingest events' discriminator convention.
- `timestamp: ISO8601`.
- `severity: z.enum(['info', 'warn', 'error'])`.
- `outcome: z.enum(['success', 'rejected', 'deduplicated', 'failed', 'aborted'])`.

**Class-specific fields** (one Zod object per class; size-budget verified per Constitution IX ≤ 4096 bytes):

| Event class | `severity` | `outcome` | Extra fields | Size budget |
|---|---|---|---|---|
| `classify.started` | info | success | `doc_id: string`, `model_name: string`, `vocabulary_snapshot_id: string` | ~300 B |
| `classify.ollama_request` | info | success | `doc_id`, `model_name`, `prompt_token_estimate: int`, `schema_field_count: int` | ~300 B |
| `classify.ollama_response` | info | success | `doc_id`, `response_token_count: int`, `duration_ms: int` | ~250 B |
| `classify.schema_invalid` | warn | rejected | `doc_id`, `validation_errors: string[]` (each max 256 B; max 5 entries) | ~1.5 KB |
| `classify.vocabulary_violation` | warn | rejected | `doc_id`, `offending_field: enum`, `offending_value: string (max 256)`, `established_count: int` | ~500 B |
| `classify.term_proposed` | info | success | `axis: enum`, `term: string (max 256)`, `doc_id`, `inserted_or_conflicted: enum` | ~300 B |
| `classify.completed` | info | success | `doc_id`, `facet_domain: string`, `facet_type: enum`, `tag_count: int`, `confidence_summary: {domain: number, type: number, tags: number}` (rounded to 2dp), `retry_count: int`, `duration_ms: int` | ~600 B |
| `classify.failed` | error | failed | `doc_id`, `error_code: enum`, `message: string (max 1024)`, `stage: 'classify'` | ~1.5 KB |
| `classify.ollama_unavailable` | error | failed | `doc_id` (optional — may be batch-level), `errno: string`, `message: string (max 1024)` | ~1.5 KB |
| `classify.batch_halted` | error | failed | `consecutive_failures: int`, `threshold: int`, `last_error_code: enum` | ~300 B |
| `classify.frontmatter_incomplete` | warn | success | `doc_id`, `missing_fields: string[]` (max 5; each max 64 B) | ~500 B |

**Discriminator**: `event` (string-literal per class). Matches SP-001/SP-002 + SP-003 `event` discriminator convention.

**Size-budget verification**: The worst plausible payload (`classify.schema_invalid` with 5 × 256-char validation errors + envelope) is ~1.5 KB. All SP-004 events sit comfortably under 4 KB. The Zod schemas enforce the bounds.

**Invariants**:
- One event per state transition per document (FR-CLASSIFY-010).
- Schema-validated before serialization (Constitution V).
- Append atomic to `Paths.telemetry()` (Constitution IX).
- NO body content in any payload (Principle I + SC-CLASSIFY-020) — summaries land in frontmatter only.
- Confidence sub-scores MAY appear in `classify.completed.confidence_summary` (Principle II permits telemetry retention of classifier metadata; only PERSISTED-frontmatter persistence is forbidden).

---

## Entity 7 — ClassifyErrorSidecar (`<doc-id>.error.json` at `Paths.failed()`)

Per-classify-failure structured-data record at `Paths.failed() + '/<doc-id>.error.json'`. Mirrors SP-003's `.error.json` shape but is keyed by doc-id (not original filename) because the document is already ingested — the doc-id is the stable forensic identifier for classify-stage failures.

**Schema (Zod-validated; FR-CLASSIFY-011)**:

```typescript
const ClassifyErrorSidecarSchema = z.object({
  error_code: z.enum([
    'ollama_unavailable',
    'schema_invalid',
    'vocabulary_violation',
    'classify_aborted',
    'persist_failed',
    'telemetry_write_failed',
    'frontmatter_rewrite_failed',
  ]),
  message: z.string().max(1024),
  retriable: z.boolean(),
  doc_id: z.string().regex(/^doc-[0-9a-f]{8}$/),
  stage: z.literal('classify'),
  timestamp: ISO8601,
  retry_count: z.number().int().min(0).max(1),    // FR-CLASSIFY-005 retry-once policy
});
```

**Invariants**:
- Exactly one sidecar per failed classify-attempt (per doc-id). On a second failure of the same doc-id (e.g., reenrich re-attempts a previously-failed row), the sidecar is overwritten atomically.
- Sidecar file is valid JSON (FR-CLASSIFY-011 + SP-003 SC-INGEST-010 pattern).
- Sidecar write is atomic (`tmp + fsync + rename + dirsync`; Constitution VIII).
- `error_code` is a member of the closed enum.
- `retriable=true` indicates that a future `corpus drain --retry-failed` (SP-006) SHOULD re-attempt; `retriable=false` indicates a structural error that retry won't fix.

**Lifecycle**:
- Created: by the classify-persister or the classify-stage orchestrator on failure.
- Updated: overwritten on subsequent failure of the same doc-id.
- Removed: by a future `corpus drain --retry-failed` (SP-006) after a successful retry.

**Persistence path**:
- `Paths.failed() + '/<doc-id>.error.json'`.

**Retriable matrix**:

| error_code | retriable | Notes |
|---|---|---|
| `ollama_unavailable` | true | Network blip / Ollama restart |
| `schema_invalid` | true | 1 retry was attempted before sidecar write; reenrich may try again |
| `vocabulary_violation` | true | Vocabulary may have grown via user-review promotion; retry against fresh snapshot |
| `classify_aborted` | true | User SIGTERM'd; retry on next run |
| `persist_failed` | true | DB lock contention, disk transient |
| `telemetry_write_failed` | true | Telemetry FS issue — retry once telemetry path heals |
| `frontmatter_rewrite_failed` | false | The body file may be malformed or unreadable; structural issue requiring user attention |

---

## Entity 8 — Drain Lock (reused from SP-003)

Advisory `flock(LOCK_EX | LOCK_NB)` file-lock at `Paths.drainLock()`. SP-004 reuses SP-003's existing lock contract verbatim — no new lock primitive (Decision G + FR-CLASSIFY-015).

**SP-004 contract**:
- The SP-003 daemon's post-persist hook reuses the already-held lock (the daemon acquired it at drain start). No nested acquire.
- The `corpus reenrich` CLI command acquires the lock independently. If contention, emits `pipeline.lock_contention` and exits 0 (FR-INGEST-011 contract preserved).
- The lock is the SINGLE write-serialization point across SP-003 ingest + SP-004 classify + (future) SP-006 retry.

**No SP-004 changes** to `Paths.drainLock()` semantics. The SP-003 implementation in `packages/pipeline/src/drain-lock.ts` is consumed verbatim.

---

## Persistent state summary

What SP-004 writes (atomically, transactionally):

| Path | What | When |
|---|---|---|
| `Paths.indexDb()` (table `documents`) | UPDATE: facet_domain, tags_json, facet_type | Classify-persister commit (in same transaction as taxonomy_terms INSERTs + body-file rename) |
| `Paths.indexDb()` (table `taxonomy_terms`) | INSERT (axis, term, state='proposed', established_at=NULL) ON CONFLICT DO NOTHING | Same transaction as documents UPDATE |
| `Paths.docs() + '/' + body_path` | Body file with REWRITTEN frontmatter (body section byte-preserved) | Atomic rename at COMMIT time |
| `Paths.failed() + '/<doc-id>.error.json'` | Classify-failure sidecar | Classify-stage error handler |
| `Paths.telemetry()` (JSONL append) | SP-004 telemetry events | Every state transition |

What SP-004 does NOT write:
- `documents.source_type` — SP-003-owned, preserved.
- `documents.title` — SP-003 wrote filename basename; SP-004 doesn't overwrite.
- `taxonomy_terms` rows with `state='established'` — FORBIDDEN by Principle XV / FR-CLASSIFY-007.
- New columns in either table — SP-004 doesn't extend the schema.
- Any file under `Paths.pending()` or `Paths.processed()` — SP-003-owned subtrees.
- Any `corpus://failures` resource state — SP-006 adds this.

---

## State transitions (cross-entity)

```
   SP-003 ingest completes
       │
       ▼
   [documents row, sentinel: facet_type='unclassified']
       │
       ▼  daemon post-persist hook OR `corpus reenrich`
   acquire Paths.drainLock()
       │
       ▼  load EstablishedVocabulary snapshot
   [EstablishedVocabulary in-memory]
       │
       ▼  render prompt (vocab block + rules + doc title/source/2000-codepoints body)
   POST http://localhost:11434/api/chat with format param
       │
       ┌───┴────────────────────────────┐
       │ Ollama unavailable             │ Ollama responds
       ▼                                ▼
   [sidecar: ollama_unavailable]    parse + Zod-validate
                                        │
                                        ┌───┴──────────────────┐
                                        │ schema_invalid       │ schema_valid
                                        ▼                      ▼
                                  retry once             vocabulary cross-check
                                        │                      │
                                        ▼                      ┌───┴──────────────┐
                                  still invalid →              │ violation        │ valid
                                  [sidecar: schema_invalid]    ▼                  ▼
                                                          [sidecar:           [persist transaction]
                                                           vocabulary_violation]    │
                                                                                    ▼
                                                                              BEGIN TRANSACTION
                                                                                    │
                                                                                    ▼
                                                                              UPDATE documents
                                                                                    │
                                                                                    ▼
                                                                              INSERT 0..N taxonomy_terms (state='proposed')
                                                                                    │
                                                                                    ▼
                                                                              ATOMIC RENAME tmp body-file → canonical
                                                                                    │
                                                                                    ▼
                                                                              COMMIT
                                                                                    │
                                                                                    ▼
                                                                              [row classified; frontmatter mirrored; proposed terms recorded]
                                                                                    │
                                                                                    ▼ telemetry: classify.completed
                                                                                  end
```

The classify-stage transition function is `(sentinel_row, established_vocab, signal) → classified_row | failure_sidecar` — pure modulo IO. Re-running on a classified row is a no-op (the `WHERE facet_type='unclassified'` filter + the UPDATE-clause defense-in-depth idempotency).

---

## Field-level mapping recap (SP-004 contract for downstream sprints)

SP-005 (embedding/ranking) will consume SP-004's classified rows. The forward-compatible contract:

| Column | SP-004 writes | SP-005 reads? | SP-005 overwrites? |
|---|---|---|---|
| `id` | preserved | yes (embedding key) | no |
| `title` | preserved | maybe (for re-ranking signal) | no |
| `body_path` | preserved | yes (embedding input) | no |
| `source_path` | preserved | no | no |
| `facet_domain` | **populated from classifier** | yes (faceted re-ranking) | no |
| `tags_json` | **populated from classifier** | yes (faceted re-ranking) | no |
| `facet_type` | **populated from classifier** | yes (faceted re-ranking) | no |
| `source_type` | preserved | yes (source-typed ranking) | no |
| `mime_type` | preserved | yes (MIME-aware embedding) | no |
| `hash` | preserved | yes (idempotency key) | no |
| `ingest_timestamp` | preserved | yes (recency ranking) | no |
| `status` | preserved at `'success'` | yes (filter) | no |

SP-005 will ADD: an `embeddings` table (or `sqlite-vec` virtual table) keyed by `documents.id`. SP-005 does NOT modify any `documents` column shape; the SP-004 → SP-005 boundary is clean.
