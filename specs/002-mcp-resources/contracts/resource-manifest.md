# Contract — Resource: `corpus://manifest`

**Feature**: 002-mcp-resources
**Maps to**: FR-005 ("`corpus://manifest` resource (auto-loaded)")
**Spec acceptance scenarios**: US1 AS1, AS2, AS3, AS4
**Schema**: `packages/contracts/src/resource-schemas.ts` → `ManifestPayload`

This contract defines the wire shape, payload, and behavior of the `corpus://manifest` resource.

## Registration

Registered via `resources/list`. Carries the standard MCP auto-load annotation:

```json
{
  "uri": "corpus://manifest",
  "name": "Corpus manifest",
  "description": "Structural snapshot: doc count, established domains, established tags, last ingest timestamp, schema version, taxonomy version.",
  "mimeType": "application/json",
  "annotations": {
    "audience": ["assistant"],
    "priority": 1.0
  }
}
```

The annotation indicates client-side auto-load eligibility per the MCP protocol. The server attaches it; client honoring is the client's responsibility (Constitution XVI).

The URI MUST appear at this canonical form ONLY. No `corpus://manifest.json`, no `/manifest`, no aliases (FR-005 + US1 AS2).

## Payload schema (Zod intent)

```ts
import { z } from 'zod';

const ISO_8601 = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

export const ManifestPayload = z.object({
  doc_count:             z.number().int().nonneg(),
  established_domains:   z.array(z.string()),
  established_tags:      z.array(z.string()),
  last_ingest_timestamp: ISO_8601.nullable(),
  schema_version:        z.string(),
  taxonomy_version:      z.string(),
});

export type ManifestPayloadType = z.infer<typeof ManifestPayload>;
```

## Field semantics

- **`doc_count`** — integer count of documents in the canonical store with `status = 'success'`. Excludes failure-lane and trash. Empty corpus: `0`.
- **`established_domains`** — sorted-ascending array of domain strings where `taxonomy_terms.axis = 'domain'` AND `taxonomy_terms.state = 'established'`. Empty corpus: `[]`.
- **`established_tags`** — sorted-ascending array of tag strings where `taxonomy_terms.axis = 'tag'` AND `taxonomy_terms.state = 'established'`. Empty corpus: `[]`.
- **`last_ingest_timestamp`** — `MAX(ingest_timestamp)` across `documents WHERE status = 'success'`. ISO-8601 UTC string. Empty corpus: `null`.
- **`schema_version`** — frontmatter schema version. Hardcoded to `'v1.0.0'` in SP-002 (`packages/contracts/src/version.ts`). Updates accompany schema migrations in future SPs.
- **`taxonomy_version`** — taxonomy registry version. Hardcoded to `'v1.0.0'` in SP-002. Updates accompany taxonomy registry migrations.

## Wire envelope

Read request:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/read",
  "params": {"uri": "corpus://manifest"}
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
        "uri": "corpus://manifest",
        "mimeType": "application/json",
        "text": "{\"doc_count\":0,\"established_domains\":[],\"established_tags\":[],\"last_ingest_timestamp\":null,\"schema_version\":\"v1.0.0\",\"taxonomy_version\":\"v1.0.0\"}"
      }
    ]
  }
}
```

Read response (populated):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "contents": [
      {
        "uri": "corpus://manifest",
        "mimeType": "application/json",
        "text": "{\"doc_count\":247,\"established_domains\":[\"devops\",\"linux\",\"writing\"],\"established_tags\":[\"ansible\",\"buddhism\",\"nfs\",\"rhel-9\",\"systemd\"],\"last_ingest_timestamp\":\"2026-05-15T14:30:00Z\",\"schema_version\":\"v1.0.0\",\"taxonomy_version\":\"v1.0.0\"}"
      }
    ]
  }
}
```

## Adapter behavior

`packages/storage/src/manifest-adapter.ts` exposes:

```ts
export type ManifestAdapter = (
  signal: AbortSignal,
) => Promise<Result<ManifestPayloadType, IndexLockedError>>;
```

Adapter logic (pseudocode):

```ts
async function buildManifest(signal: AbortSignal): Promise<Result<ManifestPayloadType, IndexLockedError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();   // sqlite-open.ts; WAL, busy_timeout=5000ms, readonly:true
  try {
    const docCount = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'success'`).get().n;
    signal.throwIfAborted();
    const lastTs = db.prepare(`SELECT MAX(ingest_timestamp) AS ts FROM documents WHERE status = 'success'`).get().ts;
    signal.throwIfAborted();
    const domains = db.prepare(`SELECT term FROM taxonomy_terms WHERE axis = 'domain' AND state = 'established' ORDER BY term ASC`).all().map(r => r.term);
    const tags    = db.prepare(`SELECT term FROM taxonomy_terms WHERE axis = 'tag'    AND state = 'established' ORDER BY term ASC`).all().map(r => r.term);
    return Result.ok({
      doc_count: docCount,
      established_domains: domains,
      established_tags: tags,
      last_ingest_timestamp: lastTs ?? null,
      schema_version: SCHEMA_VERSION,
      taxonomy_version: TAXONOMY_VERSION,
    });
  } catch (err) {
    if (isSqliteBusyError(err)) return Result.err(new IndexLockedError({uri: 'corpus://manifest'}));
    throw err;   // Constitution XIII: catch-block-emits-telemetry covered upstream by handler
  } finally {
    db.close();
  }
}
```

Note: `Result.err` returns happen WITHOUT emitting telemetry from the adapter — the handler emits the `resource.read` event with the correct outcome. This avoids double-emit and centralizes the event-shape policy in the handler. Constitution XIII is satisfied because every catch site is covered by either the adapter return path (which the handler maps to telemetry) or a direct re-throw which the handler's catch site emits.

## Empty-corpus invariant

Adapter MUST satisfy this empty-state invariant (asserted by unit test):

```
(doc_count == 0)
  ⇒ (last_ingest_timestamp == null)
  ∧ (established_domains == [])
  ∧ (established_tags == [])
```

Reverse implication does not hold: a populated corpus can have `doc_count > 0` while `established_domains == []` (if no domains have been promoted yet — proposed-only state).

## Error paths

- **`index_locked`** — `PRAGMA busy_timeout` exhausts before SQLite acquires the read lock. Adapter returns `Result.err(IndexLockedError)`; handler maps to MCP error code `-32011` with `retriable: true`.
- **`server_initializing`** — caught at the request-handler level (in `mcp-server.ts`), not at the adapter. Mirrors SP-001's `tools/list` cold-start.
- **Schema validation failure** — `ManifestPayload.safeParse(adapterResult)` fails. Handler maps to MCP error code `-32603` with the Zod issues in `data.validation_issues`. Should NEVER happen if adapter logic is correct; tests assert this is unreachable.

## Telemetry

Every read emits a `resource.read` event with:

- `resource_uri: 'corpus://manifest'`
- `doc_id`: absent
- `result`: `'success'` | `'index_locked'` | `'server_initializing'` | `'error'`
- `severity`: `'info'` for success; `'warn'` for index_locked / server_initializing; `'error'` for error.
- `duration_ms`: integer milliseconds from handler entry to response/error emit.
- `request_id`: UUID v7.

Per Constitution XIII, telemetry is emitted on success AND failure paths uniformly.
