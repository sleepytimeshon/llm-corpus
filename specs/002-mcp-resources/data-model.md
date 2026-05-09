# Phase 1 — Data Model: MCP Resources

**Feature**: 002-mcp-resources
**Date**: 2026-05-05

This document describes the *operational* entities SP-002 introduces. SP-002 also introduces persistent state for the first time in the project — the `documents` and `taxonomy_terms` tables in the SQLite index file (created by SP-002, populated by SP-003+) — and the per-document YAML frontmatter shape exposed by `corpus://docs/{id}`.

The schemas below are TypeScript-pseudocode + Zod intent. Actual Zod source code lives in `packages/contracts/src/resource-schemas.ts` (created at implementation time, not by `/speckit-plan`).

## Operational entities

### ManifestPayload

The structural snapshot returned by `corpus://manifest`. Schema is identical on the empty-corpus baseline and on populated corpora — only field values differ.

**Schema** (Zod intent):

```ts
ManifestPayload = z.object({
  doc_count:                z.number().int().nonneg(),
  established_domains:      z.array(z.string()),
  established_tags:         z.array(z.string()),
  last_ingest_timestamp:    z.string().regex(ISO_8601_REGEX).nullable(),
  schema_version:           z.string(),     // e.g. "v1.0.0"
  taxonomy_version:         z.string(),     // e.g. "v1.0.0"
})
```

**Field semantics**:

- `doc_count`: integer count of documents in the canonical store (the `documents` table where `status = 'success'`). Excludes failure-lane and trash. On empty corpus: `0`.
- `established_domains`: array of domain strings the user has promoted (Constitution XV). Sorted lexicographically for deterministic snapshots. On empty corpus: `[]`.
- `established_tags`: array of tag strings the user has promoted. Sorted lexicographically. On empty corpus: `[]`.
- `last_ingest_timestamp`: ISO-8601 UTC timestamp of the most recent successful ingest. `null` on empty corpus.
- `schema_version`: the active frontmatter schema version. Hardcoded in `packages/contracts/` as `'v1.0.0'` for SP-002; updates accompany schema migrations in future SPs.
- `taxonomy_version`: the active taxonomy registry version. Hardcoded as `'v1.0.0'` for SP-002; updates accompany taxonomy registry migrations.

**Validation rules**:

1. `doc_count` MUST equal the number of rows in `documents` where `status = 'success'`. Verified by manifest-adapter unit test.
2. `established_domains` and `established_tags` MUST contain only terms with `state = 'established'` in the `taxonomy_terms` table; `state = 'proposed'` terms are excluded (Constitution XV).
3. `last_ingest_timestamp` is the MAX(`ingest_timestamp`) over `documents` where `status = 'success'`; `null` when zero matching rows.
4. Empty-state coherence: `(doc_count == 0)` implies `(last_ingest_timestamp == null)` and `(established_domains == [])` and `(established_tags == [])`. Adapter asserts this.

**Empty-corpus example**:

```json
{
  "doc_count": 0,
  "established_domains": [],
  "established_tags": [],
  "last_ingest_timestamp": null,
  "schema_version": "v1.0.0",
  "taxonomy_version": "v1.0.0"
}
```

**Populated example** (post-SP-003/004):

```json
{
  "doc_count": 247,
  "established_domains": ["devops", "linux", "writing"],
  "established_tags": ["ansible", "buddhism", "nfs", "rhel-9", "systemd"],
  "last_ingest_timestamp": "2026-05-15T14:30:00Z",
  "schema_version": "v1.0.0",
  "taxonomy_version": "v1.0.0"
}
```

---

### TaxonomyPayload

The user-promoted vocabulary returned by `corpus://taxonomy`. Flat per-axis envelope covering all four `SearchFilter` axes.

**Schema** (Zod intent):

```ts
TaxonomyTerm = z.object({
  term:           z.string(),
  document_count: z.number().int().nonneg(),
})

TaxonomyPayload = z.object({
  domains:      z.array(TaxonomyTerm),
  tags:         z.array(TaxonomyTerm),
  types:        z.array(TaxonomyTerm),
  source_types: z.array(TaxonomyTerm),
})
```

**Field semantics**:

- `domains`: list of `{term, document_count}` for every promoted domain. `term` matches the `facet_domain` field in document frontmatter; `document_count` is the number of documents (status = 'success') with that domain. Sorted by `term` lexicographically.
- `tags`: same shape, for promoted tags. `document_count` counts documents that include the tag in their `tags` array.
- `types`: same shape, for promoted types. Maps to the `facet_type` axis of `SearchFilter` (SP-001 schema enum: `entity`, `concept`, `tutorial`, `analysis`, `reference`, `synthesis`, `cheat-sheet`). NOTE: the SP-001 `SearchFilter.type` enum is fixed at the schema layer; SP-002's `corpus://taxonomy` returns the *subset* of those values with `document_count > 0` (or all 7 if empty-state, see "Empty-state semantics" below).
- `source_types`: same shape, for promoted source types. Maps to `SearchFilter.source_type` enum (`article`, `research-paper`, `manual`, `form`, `video`, `podcast`, `book`, `notes`, `transcript`, `reference`).

**Validation rules**:

1. Every `term` in every axis MUST have `state = 'established'` in `taxonomy_terms`. Adapter filters before serialization.
2. `document_count >= 0`. Zero is valid only when an established term currently has no matching documents (post-document-deletion edge case); on the empty corpus, ALL fields are empty arrays.
3. `types` and `source_types` axes are bounded by SP-001's `SearchFilter` enum (closed sets); only enum members may appear. Domains and tags are open vocabularies.
4. Sort order: `term` ascending. Tie-breaker: stable.

**Empty-state semantics** (Edge Case clarification):

On an empty corpus, ALL four arrays are `[]`. The `types` and `source_types` axes are NOT pre-populated with all enum values at zero count — they remain empty arrays. Rationale: the contract is "promoted terms with documents," and an empty-state corpus has no promoted terms in any axis (the `taxonomy_terms` table is empty). When the first document with `facet_type = 'tutorial'` is ingested AND the user promotes that type, then `types: [{term: "tutorial", document_count: 1}]` appears.

**Empty-corpus example**:

```json
{
  "domains": [],
  "tags": [],
  "types": [],
  "source_types": []
}
```

**Populated example**:

```json
{
  "domains": [
    {"term": "devops", "document_count": 87},
    {"term": "linux", "document_count": 64},
    {"term": "writing", "document_count": 23}
  ],
  "tags": [
    {"term": "ansible", "document_count": 45},
    {"term": "buddhism", "document_count": 12},
    {"term": "rhel-9", "document_count": 31}
  ],
  "types": [
    {"term": "tutorial", "document_count": 102},
    {"term": "reference", "document_count": 88}
  ],
  "source_types": [
    {"term": "article", "document_count": 145},
    {"term": "manual", "document_count": 67}
  ]
}
```

---

### RecentPayload

The descending list of recently successfully ingested documents returned by `corpus://recent`.

**Schema** (Zod intent):

```ts
RecentEntry = z.object({
  id:               z.string().regex(/^doc-[0-9a-f]{8}$/),
  title:            z.string(),
  domain:           z.string(),
  tags:             z.array(z.string()),
  ingest_timestamp: z.string().regex(ISO_8601_REGEX),
})

RecentPayload = z.object({
  entries: z.array(RecentEntry),
})
```

**Field semantics**:

- `entries`: at most N entries (default N = 10, configurable via `config.toml` per Decision C). Ordered by `ingest_timestamp` descending. Excludes failure-lane (`status != 'success'`) and trash (`status = 'trashed'`) documents.
- Each entry: `id` is the SP-001 doc-id format; `title`, `domain`, `tags` come from frontmatter; `ingest_timestamp` is the SQLite-stored timestamp.

**Validation rules**:

1. Length of `entries` ≤ N. When fewer than N successful ingests exist, `entries` MUST contain ALL of them — no padding.
2. Order: strictly descending by `ingest_timestamp`. Ties broken by `id` lexicographic ascending (deterministic).
3. Every entry's `id` corresponds to a document with `status = 'success'`. Failure-lane and trash excluded by adapter `WHERE` clause.
4. `tags` is the array stored in frontmatter, NOT filtered by `state = 'established'` (the recent resource shows what's *in* the documents; the taxonomy resource shows the *promoted vocabulary*).

**Empty-corpus example**:

```json
{
  "entries": []
}
```

**Populated example** (N=10, with 25 successful ingests in the last 24h, 5 in failure lane):

```json
{
  "entries": [
    {
      "id": "doc-ab12cd34",
      "title": "Hybrid Search with FTS5 and sqlite-vec",
      "domain": "devops",
      "tags": ["sqlite", "search", "fts5"],
      "ingest_timestamp": "2026-05-15T14:30:00Z"
    },
    /* ... 9 more, descending ... */
  ]
}
```

The 5 failure-lane documents do NOT appear; the 15 older successful ingests do NOT appear (truncated at N=10).

---

### DocumentPayload

The full body + frontmatter returned by `corpus://docs/{id}`.

**Schema** (Zod intent):

```ts
DocumentFrontmatter = z.object({
  id:                z.string().regex(/^doc-[0-9a-f]{8}$/),
  source_path:       z.string(),
  ingest_timestamp:  z.string().regex(ISO_8601_REGEX),
  mime_type:         z.string(),
  hash:              z.string().regex(/^[a-f0-9]{64}$/),  // SHA-256
}).passthrough()  // SP-004 will add more fields; SP-002 commits to the minimum

DocumentPayload = z.object({
  uri:         z.string(),                                  // echoed: "corpus://docs/{id}"
  body:        z.string(),                                  // normalized Markdown
  frontmatter: DocumentFrontmatter,
})
```

**Field semantics**:

- `uri`: the full URI requested (e.g. `corpus://docs/doc-ab12cd34`). Echoed for client correlation.
- `body`: the normalized Markdown body of the document. As stored in the canonical document file (under `Paths.docs() + '/<id>.md'` minus its frontmatter), verbatim — no rewriting, no synthesis (Constitution II).
- `frontmatter`: parsed YAML frontmatter with the v1 minimum field set. The Zod schema uses `.passthrough()` to accept additional fields SP-004 will add (full classification metadata) without breaking SP-002's minimum contract.

**Frontmatter v1 minimum field set**:

| Field | Type | Source | SP added |
|---|---|---|---|
| `id` | `doc-[0-9a-f]{8}` | Generated at ingest | SP-003 |
| `source_path` | string | The user-supplied input path / URL | SP-003 |
| `ingest_timestamp` | ISO-8601 UTC | Recorded at ingest | SP-003 |
| `mime_type` | string | Detected at extraction | SP-003 |
| `hash` | SHA-256 hex | Computed at ingest from canonical body | SP-003 |

**Future fields (SP-004+, not in SP-002 contract)**: `title`, `summary`, `facet_domain`, `facet_type`, `source_type`, `tags`, `confidence` (NOT permitted — Constitution II), `origin` (NOT permitted), `provenance_*` (NOT permitted), `captured_at` (NOT permitted), `corpus capture` (NOT permitted).

**Validation rules**:

1. The URI's `{id}` path component MUST match the frontmatter's `id` field (one URI ↔ one document; integrity-loss bug if mismatched per Constitution VIII).
2. `body` MUST be valid UTF-8.
3. `frontmatter.hash` MUST be a SHA-256 hex string (64 lowercase hex chars).
4. The MCP `result` envelope wraps the payload as a single `text` content block (per the SDK convention used by SP-001's `corpus.find`).

**Example** (populated):

```json
{
  "uri": "corpus://docs/doc-ab12cd34",
  "body": "# Hybrid Search with FTS5 and sqlite-vec\n\nThis document explores...",
  "frontmatter": {
    "id": "doc-ab12cd34",
    "source_path": "/home/shonrs/inbox/hybrid-search.md",
    "ingest_timestamp": "2026-05-15T14:30:00Z",
    "mime_type": "text/markdown",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

---

### ResourceReadEvent

The new telemetry event class shipped by SP-002. Emitted on every resource read (success or failure path) per Constitution XIII.

**Schema** (Zod intent):

```ts
ResourceUri = z.enum([
  'corpus://manifest',
  'corpus://taxonomy',
  'corpus://recent',
  'corpus://docs/*',     // template form — exact URI lives in the doc_id field
])

ResourceReadOutcome = z.enum([
  'success',
  'document_not_found',
  'index_locked',
  'server_initializing',
  'error',
])

ResourceReadEvent = z.object({
  event:        z.literal('resource.read'),
  timestamp:    ISO_8601,
  resource_uri: ResourceUri,
  doc_id:       z.string().regex(/^doc-[0-9a-f]{8}$/).optional(),  // present for corpus://docs/* reads
  result:       ResourceReadOutcome,
  duration_ms:  z.number().int().nonneg(),
  request_id:   z.string().uuid(),
  severity:     z.enum(['info', 'warn', 'error']).default('info'),
})
```

**Field semantics**:

- `event`: literal discriminator `'resource.read'`. Joins the discriminated union alongside `egress.attempted`, `egress.blocked`, `egress.checkpoint`.
- `timestamp`: ISO-8601 UTC, captured at handler-completion time (whether success or failure).
- `resource_uri`: from a closed enum of the four canonical resource URIs. For per-doc reads, this is `'corpus://docs/*'` (the template form); the specific doc ID lives in `doc_id`.
- `doc_id`: present only for `corpus://docs/*` reads. Absent for the three static URIs.
- `result`: outcome enum. `success` for normal reads. `document_not_found` for unknown ids. `index_locked` for SQLite WAL contention. `server_initializing` for cold-start before `markReady()`. `error` for any other failure (schema validation, parse error).
- `duration_ms`: integer milliseconds from request receipt to response emit (or error throw).
- `request_id`: UUID v7 (preferred for monotonic ordering — same convention as SP-001 egress events).
- `severity`: `'info'` for `success`. `'warn'` for `document_not_found`, `index_locked`, `server_initializing` (recoverable). `'error'` for `error` (real failure). Per Constitution XIII: severity matches actual error severity, no downgrading.

**Size budget verification**:

Worst-case serialization: a `corpus://docs/*` read with `result: 'error'` and a UUID v7 request_id and a 4-digit duration:

```json
{"event":"resource.read","timestamp":"2026-05-15T14:30:00.123Z","resource_uri":"corpus://docs/*","doc_id":"doc-ab12cd34","result":"error","duration_ms":1234,"request_id":"019099d4-78f0-7e61-a37c-8c2a9b5d2e10","severity":"error"}
```

≈ 230 bytes. Well under the 4096-byte append-atomic ceiling. Same per-event `assert(serialized.length <= TELEMETRY_MAX_BYTES)` guard from SP-001 telemetry helper covers the new event class for free (it's union-aware).

**Lifecycle**:

- Handler entry: capture `timestamp_start` and `request_id`.
- Handler completion (success or failure): compute `duration_ms = Date.now() - timestamp_start`, classify outcome, emit event.
- One event per resource-read invocation. `tools/list` and `resources/list` calls do NOT emit `resource.read` events — they emit no telemetry events themselves (SP-001 doesn't emit on `tools/list` either; the read of a resource is the telemetry-bearing event, not the discovery handshake).

---

## Persistent state (SQLite tables)

SP-002 creates two empty tables on fresh init via `packages/storage/src/schema-migration.ts`. These tables are populated by SP-003 (documents) and SP-004 (taxonomy_terms); SP-002 ships only the empty-table migration so resource handlers have a query target on the empty baseline.

### Table: `documents`

```sql
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY        NOT NULL,  -- 'doc-[0-9a-f]{8}'
  title             TEXT                    NOT NULL,
  body_path         TEXT                    NOT NULL,  -- relative to Paths.docs()
  source_path       TEXT                    NOT NULL,
  facet_domain      TEXT                    NOT NULL,
  tags_json         TEXT                    NOT NULL,  -- JSON array of strings
  facet_type        TEXT                    NOT NULL,
  source_type       TEXT                    NOT NULL,
  mime_type         TEXT                    NOT NULL,
  hash              TEXT                    NOT NULL,  -- SHA-256 hex
  ingest_timestamp  TEXT                    NOT NULL,  -- ISO-8601 UTC
  status            TEXT                    NOT NULL,  -- 'success' | 'failed' | 'trashed'
  CHECK (id GLOB 'doc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  CHECK (status IN ('success', 'failed', 'trashed'))
);

CREATE INDEX IF NOT EXISTS idx_documents_status_ingest_ts
  ON documents(status, ingest_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_documents_facet_domain
  ON documents(facet_domain) WHERE status = 'success';
```

The `idx_documents_status_ingest_ts` index supports `corpus://recent`'s descending-order LIMIT N query. The `idx_documents_facet_domain` partial index supports manifest's domain aggregation.

**SP-003 contract**: SP-003's ingest writer MUST use these column names and the `status` value `'success'` for successful ingests. SP-002's adapters depend on this column shape; column changes between SP-002 and SP-003 require coordinated planning.

### Table: `taxonomy_terms`

```sql
CREATE TABLE IF NOT EXISTS taxonomy_terms (
  axis              TEXT NOT NULL,            -- 'domain' | 'tag' | 'type' | 'source_type'
  term              TEXT NOT NULL,
  state             TEXT NOT NULL,            -- 'proposed' | 'established'
  established_at    TEXT,                     -- ISO-8601 UTC, set when state transitions to 'established'
  CHECK (axis IN ('domain', 'tag', 'type', 'source_type')),
  CHECK (state IN ('proposed', 'established')),
  PRIMARY KEY (axis, term)
);

CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_state_axis
  ON taxonomy_terms(state, axis);
```

The `idx_taxonomy_terms_state_axis` index supports `corpus://taxonomy`'s "promoted-only by axis" query.

**SP-004 contract**: SP-004 ships the proposed→established state machine. SP-002 reads only `state = 'established'` rows; the `proposed` state is invisible to `corpus://taxonomy` per Constitution XV.

**Note on `Paths.taxonomy()`**: SP-001 deployed `Paths.taxonomy()` as a `taxonomy.json` file. SP-002 carries forward that path but moves the *authoritative* taxonomy state into the SQLite `taxonomy_terms` table. The `taxonomy.json` file becomes a snapshot/export artifact (SP-004 will define its role). For SP-002, `corpus://taxonomy` reads the SQLite table — NOT the JSON file. The plan's `taxonomy-adapter.ts` reads SQLite. This is a clarification of SP-001's `Paths.taxonomy()` semantic, not a breaking change.

---

## State Transitions

SP-002 introduces two state machines:

### MCP server lifecycle (extension of SP-001's)

```text
              ┌──────────────┐
              │   stopped    │
              └──────┬───────┘
                     │ corpus mcp
                     ▼
              ┌──────────────┐
              │ bootstrapping│  egress hook + index opens here
              └──────┬───────┘
                     │ markReady()
                     ▼
              ┌──────────────┐
              │    ready     │  tools/list + resources/list both return their listings
              └──────┬───────┘
                     │ stdin EOF or SIGTERM
                     ▼
              ┌──────────────┐
              │  shutting    │
              │   down       │
              └──────┬───────┘
                     │
                     ▼
                  stopped
```

SP-002 extends the `bootstrapping` phase: in addition to opening the egress hook, SP-002 opens the SQLite read connection. `markReady()` is called only after both the hook and the SQLite open succeed. Cold-start failures of the SQLite open emit a telemetry event; `markReady()` is not called and `resources/*` requests continue to return `server_initializing`.

### Per-document state (forward-looking, owned by SP-003+)

```text
            (file in inbox/)
                  │
                  │ ingest
                  ▼
              ┌─────────┐
              │ success │── (visible to corpus://recent, corpus://docs/{id})
              └─────────┘
                  │
                  │ corpus remove
                  ▼
              ┌─────────┐
              │ trashed │── (NOT visible to corpus://recent or corpus://docs/{id})
              └─────────┘
                  │
                  │ corpus restore
                  ▼
                  success

            (ingest fails)
                  │
                  ▼
              ┌─────────┐
              │ failed  │── (NOT visible to corpus://recent; corpus://docs/{id} returns document_not_found)
              └─────────┘
```

SP-002 honors this state machine *by contract* — the `status` column controls visibility. SP-003 owns the `success ↔ failed` transitions; SP-006 owns failure-lane operations; future `corpus remove/restore` features own `success ↔ trashed`. SP-002 never writes to the `status` column.

---

## Cross-references

- Resource payload Zod schemas: `packages/contracts/src/resource-schemas.ts` (created at implementation time).
- Telemetry helpers: `packages/contracts/src/telemetry.ts` (extended).
- SQLite schema migration: `packages/storage/src/schema-migration.ts` (created at implementation time).
- Resource handlers: `packages/transport/src/resource-{manifest,taxonomy,recent,document}-handler.ts`.
- Adapters: `packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts`.
- Per-resource contract files in this feature directory: `contracts/resource-{manifest,taxonomy,recent,document}.md`.
- New telemetry contract: `contracts/telemetry-resource-events.md`.
- Protocol surface contract: `contracts/mcp-resources-api.md`.
