# Contract — Resource: `corpus://recent`

**Feature**: 002-mcp-resources
**Maps to**: FR-007 ("`corpus://recent` resource")
**Spec acceptance scenarios**: US3 AS1, AS2, AS3, AS4
**Schema**: `packages/contracts/src/resource-schemas.ts` → `RecentPayload`

This contract defines the wire shape, payload, and behavior of the `corpus://recent` resource.

## Registration

Registered via `resources/list`. No auto-load annotation:

```json
{
  "uri": "corpus://recent",
  "name": "Recent ingests",
  "description": "Last N successfully ingested documents in descending ingest_timestamp order; failure-lane and trash excluded.",
  "mimeType": "application/json"
}
```

## Window size N

**Default N = 10** (Decision C in `research.md`). Configurable via `config.toml`:

```toml
[resources.recent]
window_size = 10   # int, range 1-100 inclusive
```

The `recent-adapter.ts` reads the configured value at handler-init time. Per Constitution III (read-only), the resource itself takes NO arguments — N is server config, not request parameter.

If `config.toml` is missing the key, default 10 is used. If the key is out of range (< 1 or > 100), startup fails with a configuration error (caught at server boot, before `markReady()` — same surface as any startup misconfiguration).

## Payload schema (Zod intent)

```ts
import { z } from 'zod';

const ISO_8601 = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const DOC_ID = z.string().regex(/^doc-[0-9a-f]{8}$/);

export const RecentEntry = z.object({
  id:               DOC_ID,
  title:            z.string(),
  domain:           z.string(),
  tags:             z.array(z.string()),
  ingest_timestamp: ISO_8601,
});

export const RecentPayload = z.object({
  entries: z.array(RecentEntry),
});

export type RecentPayloadType = z.infer<typeof RecentPayload>;
```

## Field semantics

- **`entries`** — array of at most N entries, ordered by `ingest_timestamp` descending. Failure-lane (`status = 'failed'`) and trash (`status = 'trashed'`) excluded.
- Each entry's fields come directly from the `documents` table:
  - `id`: PRIMARY KEY
  - `title`: from frontmatter (stored in the `title` column at ingest)
  - `domain`: `facet_domain` column
  - `tags`: `tags_json` column parsed as `string[]`
  - `ingest_timestamp`: `ingest_timestamp` column

## Behavioral contracts

**Length**: `entries.length ≤ N`. When fewer than N successful ingests exist, `entries` MUST contain ALL of them — no padding (per US3 edge case "When fewer than N documents exist"). When zero successful ingests exist, `entries` is `[]` (NOT omitted, NOT null).

**Order**: strictly descending by `ingest_timestamp`. Ties broken by `id` ascending lexicographic (deterministic).

**Failure-lane exclusion**: documents with `status = 'failed'` MUST NOT appear (Constitution X — three-folder routing semantics; the user has not endorsed those documents). Verified in SC-006 against fixtures with both `success` and `failed` rows.

**Trash exclusion**: documents with `status = 'trashed'` MUST NOT appear. Trash is a soft-delete state; trashed documents reappear in `recent` only if restored.

## Wire envelope

Read request:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/read",
  "params": {"uri": "corpus://recent"}
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
        "uri": "corpus://recent",
        "mimeType": "application/json",
        "text": "{\"entries\":[]}"
      }
    ]
  }
}
```

Read response (populated; N=10, 25 successful ingests + 5 failure-lane fixture):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "contents": [
      {
        "uri": "corpus://recent",
        "mimeType": "application/json",
        "text": "{\"entries\":[{\"id\":\"doc-ab12cd34\",\"title\":\"Hybrid Search with FTS5 and sqlite-vec\",\"domain\":\"devops\",\"tags\":[\"sqlite\",\"search\",\"fts5\"],\"ingest_timestamp\":\"2026-05-15T14:30:00Z\"}]}"
      }
    ]
  }
}
```

(The example shows one entry for brevity; SC-005 fixture exercises 10.)

## Adapter behavior

`packages/storage/src/recent-adapter.ts` exposes:

```ts
export type RecentAdapter = (
  signal: AbortSignal,
) => Promise<Result<RecentPayloadType, IndexLockedError>>;
```

Adapter logic (pseudocode):

```ts
async function buildRecent(signal: AbortSignal): Promise<Result<RecentPayloadType, IndexLockedError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();
  const N = getConfiguredWindowSize();   // from config.toml; default 10
  try {
    const rows = db.prepare(`
      SELECT id, title, facet_domain AS domain, tags_json, ingest_timestamp
      FROM documents
      WHERE status = 'success'
      ORDER BY ingest_timestamp DESC, id ASC
      LIMIT ?
    `).all(N);
    const entries = rows.map(r => ({
      id: r.id,
      title: r.title,
      domain: r.domain,
      tags: JSON.parse(r.tags_json),
      ingest_timestamp: r.ingest_timestamp,
    }));
    return Result.ok({entries});
  } catch (err) {
    if (isSqliteBusyError(err)) return Result.err(new IndexLockedError({uri: 'corpus://recent'}));
    throw err;
  } finally {
    db.close();
  }
}
```

The `idx_documents_status_ingest_ts` index (defined in `data-model.md` and created by `schema-migration.ts`) makes this query O(N log D) where D is the document count — efficient even on populated corpora.

## Tag-array shape stability

The `tags` field is the array stored in frontmatter, NOT filtered through the `taxonomy_terms` promoted-terms set. Rationale: this resource shows what's *in* the documents (raw curation state), while `corpus://taxonomy` shows the *promoted vocabulary*. They are deliberately different views of the same underlying data.

Per Constitution Principle XV, taxonomy promotion governs which terms appear in `corpus://taxonomy`; it does NOT retroactively filter document frontmatter. A document tagged `proposed-tag-foo` continues to carry that tag in its frontmatter even if `proposed-tag-foo` has not been promoted to `established`.

## Error paths

- **`index_locked`** — same as manifest. Adapter returns `IndexLockedError`; handler maps to `-32011`.
- **`server_initializing`** — caught at request-handler level.
- **Schema validation failure** — handler maps to `-32603`. Tags-array JSON parse failure on a malformed row would surface as a `RecentPayload.safeParse` failure; SP-002 treats this as an integrity-loss bug (SP-003's ingest writer is contracted to write valid JSON tag arrays).
- **Configuration failure (N out of range)** — caught at server boot, NOT at read time. The server fails to start with a `config_error` if `window_size` is outside [1, 100].

## Telemetry

Every read emits a `resource.read` event with `resource_uri: 'corpus://recent'`, no `doc_id`, outcome and severity per the standard mapping.
