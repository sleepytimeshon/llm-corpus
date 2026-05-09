# Contract — Resource: `corpus://taxonomy`

**Feature**: 002-mcp-resources
**Maps to**: FR-006 ("`corpus://taxonomy` resource")
**Spec acceptance scenarios**: US2 AS1, AS2, AS3, AS4
**Schema**: `packages/contracts/src/resource-schemas.ts` → `TaxonomyPayload`

This contract defines the wire shape, payload, and behavior of the `corpus://taxonomy` resource. Per Constitution XV, this resource exposes ONLY user-promoted (`state = 'established'`) terms. Proposed-but-unreviewed terms are deliberately hidden.

## Registration

Registered via `resources/list`. No auto-load annotation:

```json
{
  "uri": "corpus://taxonomy",
  "name": "Corpus taxonomy",
  "description": "Promoted vocabulary across all SearchFilter axes (domains, tags, types, source_types) with per-term document counts.",
  "mimeType": "application/json"
}
```

## Payload schema (Zod intent)

Flat per-axis envelope covering all four `SearchFilter` axes (CLAR-2 Option B, resolved at spec time):

```ts
import { z } from 'zod';

export const TaxonomyTerm = z.object({
  term:           z.string(),
  document_count: z.number().int().nonneg(),
});

export const TaxonomyPayload = z.object({
  domains:      z.array(TaxonomyTerm),
  tags:         z.array(TaxonomyTerm),
  types:        z.array(TaxonomyTerm),
  source_types: z.array(TaxonomyTerm),
});

export type TaxonomyPayloadType = z.infer<typeof TaxonomyPayload>;
```

## Field semantics

- **`domains`** — list of `{term, document_count}` for every `taxonomy_terms.axis = 'domain'` AND `state = 'established'` term. `document_count` = COUNT of `documents` where `status = 'success'` AND `facet_domain = term`. Sorted by `term` ascending.
- **`tags`** — same shape, for established tags. `document_count` = COUNT of `documents` where `status = 'success'` AND `tags_json` (parsed) contains `term`.
- **`types`** — same shape, for established types. `term` ∈ SP-001 `SearchFilter.type` enum (`entity`, `concept`, `tutorial`, `analysis`, `reference`, `synthesis`, `cheat-sheet`). `document_count` = COUNT where `status = 'success'` AND `facet_type = term`.
- **`source_types`** — same shape, for established source types. `term` ∈ SP-001 `SearchFilter.source_type` enum (`article`, `research-paper`, `manual`, `form`, `video`, `podcast`, `book`, `notes`, `transcript`, `reference`).

## Constitutional contract — promoted-only

Per Constitution Principle XV: ONLY established terms appear in the response. Proposed-but-unpromoted terms in the `taxonomy_terms` table are filtered out by the adapter's `WHERE state = 'established'` clause.

This is the agent-visible boundary of the dynamic-taxonomy state machine: agents see what the user has ratified, never what the classifier has proposed but not yet been reviewed (auto-promotion remains forbidden — the SP-004 promotion workflow is separate).

US2 AS2 verifies the exclusion contract against fixture taxonomy state with both `proposed` and `established` rows.

## Empty-state semantics

On the empty corpus (no rows in `taxonomy_terms`, no documents), the response is:

```json
{
  "domains": [],
  "tags": [],
  "types": [],
  "source_types": []
}
```

The `types` and `source_types` axes are NOT pre-populated with their fixed enum values at zero count — they remain empty arrays. The contract is "promoted terms with documents," and the empty state has no promoted terms.

## Wire envelope

Read request:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/read",
  "params": {"uri": "corpus://taxonomy"}
}
```

Read response (empty corpus):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "contents": [
      {
        "uri": "corpus://taxonomy",
        "mimeType": "application/json",
        "text": "{\"domains\":[],\"tags\":[],\"types\":[],\"source_types\":[]}"
      }
    ]
  }
}
```

Read response (populated, fixture-driven):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "contents": [
      {
        "uri": "corpus://taxonomy",
        "mimeType": "application/json",
        "text": "{\"domains\":[{\"term\":\"devops\",\"document_count\":87},{\"term\":\"linux\",\"document_count\":64}],\"tags\":[{\"term\":\"ansible\",\"document_count\":45}],\"types\":[{\"term\":\"tutorial\",\"document_count\":102}],\"source_types\":[{\"term\":\"article\",\"document_count\":145}]}"
      }
    ]
  }
}
```

## Adapter behavior

`packages/storage/src/taxonomy-adapter.ts` exposes:

```ts
export type TaxonomyAdapter = (
  signal: AbortSignal,
) => Promise<Result<TaxonomyPayloadType, IndexLockedError | TaxonomyParseError>>;
```

Adapter logic (pseudocode):

```ts
async function buildTaxonomy(signal: AbortSignal): Promise<Result<TaxonomyPayloadType, IndexLockedError | TaxonomyParseError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();
  try {
    const buildAxis = (axis: 'domain' | 'tag' | 'type' | 'source_type'): TaxonomyTermType[] => {
      // Established terms only — Constitution XV
      const terms = db.prepare(
        `SELECT term FROM taxonomy_terms WHERE axis = ? AND state = 'established' ORDER BY term ASC`
      ).all(axis).map(r => r.term);
      // Per-term document_count
      return terms.map(term => ({
        term,
        document_count: countDocsForAxis(db, axis, term),
      }));
    };
    return Result.ok({
      domains:      buildAxis('domain'),
      tags:         buildAxis('tag'),
      types:        buildAxis('type'),
      source_types: buildAxis('source_type'),
    });
  } catch (err) {
    if (isSqliteBusyError(err)) return Result.err(new IndexLockedError({uri: 'corpus://taxonomy'}));
    throw err;
  } finally {
    db.close();
  }
}

function countDocsForAxis(db, axis, term) {
  switch (axis) {
    case 'domain':      return db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND facet_domain = ?`).get(term).n;
    case 'tag':         return countDocsWithTag(db, term);   // JSON-array membership; uses json_each() in SQLite
    case 'type':        return db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND facet_type = ?`).get(term).n;
    case 'source_type': return db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'success' AND source_type = ?`).get(term).n;
  }
}

function countDocsWithTag(db, tag) {
  // SQLite JSON1 extension is built into better-sqlite3 by default.
  return db.prepare(`
    SELECT COUNT(DISTINCT d.id) AS n
    FROM documents d, json_each(d.tags_json) AS j
    WHERE d.status = 'success' AND j.value = ?
  `).get(tag).n;
}
```

## Sort order

Within each axis, terms are sorted by `term` ascending (lexicographic, case-sensitive). Tie-breaker: stable; SQLite's `ORDER BY` preserves insertion order for equal terms (irrelevant since `(axis, term)` is the primary key — unique).

## Error paths

- **`index_locked`** — same as manifest. Adapter returns `IndexLockedError`; handler maps to `-32011`.
- **`taxonomy_parse_error`** — historically reserved for the `Paths.taxonomy()` JSON file parse failure. SP-002 reads taxonomy from SQLite (`taxonomy_terms` table), not the JSON file (per `data-model.md`). The error class remains exported for forward compatibility with SP-004; SP-002 does NOT trip it. Tests assert this is unreachable in SP-002.
- **`server_initializing`** — caught at request-handler level.
- **Schema validation failure** — handler maps to `-32603`.

## Telemetry

Every read emits a `resource.read` event with `resource_uri: 'corpus://taxonomy'`, no `doc_id`, outcome and severity per the standard mapping. See `telemetry-resource-events.md`.
