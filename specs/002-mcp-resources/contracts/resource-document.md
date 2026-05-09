# Contract — Resource: `corpus://docs/{id}`

**Feature**: 002-mcp-resources
**Maps to**: FR-008 ("`corpus://docs/{id}` resource")
**Spec acceptance scenarios**: US4 AS1, AS2, AS3, AS4, AS5
**Schema**: `packages/contracts/src/resource-schemas.ts` → `DocumentPayload`

This contract defines the wire shape, payload, and behavior of the `corpus://docs/{id}` URI template. This is the *dereferencing target* of every `corpus.find` SearchHit URI — the load-bearing read for every knowledge-grounded answer the agent ever produces.

## Registration

Registered via `resources/templates/list` (Decision A in `research.md`):

```json
{
  "uriTemplate": "corpus://docs/{id}",
  "name": "Document by ID",
  "description": "Full Markdown body and structured YAML frontmatter for one ingested document. The id matches the SearchHit URI returned by corpus.find.",
  "mimeType": "application/json"
}
```

The URI template conforms to RFC 6570 Level 1 (single path-component variable `{id}`).

The dispatch table in `mcp-server.ts`'s `ReadResourceRequestSchema` handler matches incoming reads via regex `^corpus:\/\/docs\/(doc-[0-9a-f]{8})$`; mismatched URIs return `-32602` (Invalid params).

## Payload schema (Zod intent)

```ts
import { z } from 'zod';

const ISO_8601 = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const DOC_ID = z.string().regex(/^doc-[0-9a-f]{8}$/);
const SHA256_HEX = z.string().regex(/^[a-f0-9]{64}$/);

export const DocumentFrontmatter = z.object({
  id:               DOC_ID,
  source_path:      z.string(),
  ingest_timestamp: ISO_8601,
  mime_type:        z.string(),
  hash:             SHA256_HEX,
}).passthrough();   // SP-004 will add fields; SP-002 commits to the minimum

export const DocumentPayload = z.object({
  uri:         z.string(),
  body:        z.string(),
  frontmatter: DocumentFrontmatter,
});

export type DocumentPayloadType = z.infer<typeof DocumentPayload>;
```

`.passthrough()` allows future SP-004 frontmatter fields without breaking the SP-002 contract — any additional fields the YAML parser produces are passed through verbatim.

## Field semantics

- **`uri`** — the full URI requested, echoed for client correlation. E.g. `"corpus://docs/doc-ab12cd34"`.
- **`body`** — the normalized Markdown body of the document, verbatim from the canonical store. The frontmatter block is stripped — `body` contains only the post-frontmatter Markdown content.
- **`frontmatter`** — parsed YAML frontmatter with the v1 minimum field set (`id`, `source_path`, `ingest_timestamp`, `mime_type`, `hash`). Additional fields are passed through.

## URI integrity contract

US4 AS3 + Constitution VIII contract: the URI's `{id}` path component MUST match the frontmatter's `id` field. Adapter asserts:

```ts
assert(parsedFrontmatter.id === requestedId,
  `Integrity loss: URI id "${requestedId}" does not match frontmatter id "${parsedFrontmatter.id}"`);
```

A mismatch is an integrity-loss bug, NOT a "missing document" — the search index and the document store are the same SQLite file (Constitution VIII transactional index). The adapter throws (the handler maps to `-32603` Internal error and emits `severity: 'error'` telemetry); this signals a corpus integrity bug that requires manual reconciliation.

SP-005's `corpus.find` SearchHit URIs MUST agree on this id format (`doc-[0-9a-f]{8}` per the SP-001 SearchHit schema — verified in SC-007).

## Wire envelope

Read request (existing document):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/read",
  "params": {"uri": "corpus://docs/doc-ab12cd34"}
}
```

Read response:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "contents": [
      {
        "uri": "corpus://docs/doc-ab12cd34",
        "mimeType": "application/json",
        "text": "{\"uri\":\"corpus://docs/doc-ab12cd34\",\"body\":\"# Hybrid Search with FTS5 and sqlite-vec\\n\\nThis document explores...\",\"frontmatter\":{\"id\":\"doc-ab12cd34\",\"source_path\":\"/home/shonrs/inbox/hybrid-search.md\",\"ingest_timestamp\":\"2026-05-15T14:30:00Z\",\"mime_type\":\"text/markdown\",\"hash\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"}}"
      }
    ]
  }
}
```

The single content entry packs the full payload (URI, body, frontmatter) as JSON. Rationale: the MCP `contents[]` array allows multi-block returns, but a single JSON content entry keeps the contract simple and matches SP-001's `corpus.find` convention. Clients deserialize the `text` field as `DocumentPayload`.

Read response (document not found):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "error": {
    "code": -32010,
    "message": "document_not_found",
    "data": {
      "uri": "corpus://docs/doc-missing",
      "doc_id": "doc-missing"
    }
  }
}
```

Read response (index locked):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "error": {
    "code": -32011,
    "message": "index_locked",
    "data": {
      "retry_after_ms": 250,
      "uri": "corpus://docs/doc-ab12cd34",
      "retriable": true
    }
  }
}
```

## Adapter behavior

`packages/storage/src/document-adapter.ts` exposes:

```ts
export type DocumentAdapter = (
  docId: string,
  signal: AbortSignal,
) => Promise<Result<DocumentPayloadType, DocumentNotFoundError | IndexLockedError | IntegrityLossError>>;
```

Adapter logic (pseudocode):

```ts
async function fetchDocument(
  docId: string,
  signal: AbortSignal,
): Promise<Result<DocumentPayloadType, DocumentNotFoundError | IndexLockedError | IntegrityLossError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();
  try {
    const row = db.prepare(`
      SELECT body_path FROM documents WHERE id = ? AND status = 'success'
    `).get(docId);
    if (!row) {
      return Result.err(new DocumentNotFoundError({docId}));
    }
    signal.throwIfAborted();
    const fullPath = path.join(Paths.docs(), row.body_path);
    const fileContent = await fs.readFile(fullPath, 'utf8');
    const { body, frontmatter } = parseMarkdownWithFrontmatter(fileContent);   // uses js-yaml
    if (frontmatter.id !== docId) {
      return Result.err(new IntegrityLossError({
        requestedId: docId,
        frontmatterFoundId: frontmatter.id,
      }));
    }
    return Result.ok({
      uri: `corpus://docs/${docId}`,
      body,
      frontmatter,
    });
  } catch (err) {
    if (isSqliteBusyError(err)) return Result.err(new IndexLockedError({uri: `corpus://docs/${docId}`}));
    throw err;
  } finally {
    db.close();
  }
}
```

The frontmatter parser uses `js-yaml` (the project's single YAML library per Constitution V). `parseMarkdownWithFrontmatter` is a small helper exported from `packages/contracts/src/markdown-frontmatter.ts` (alongside `parseYaml`/`stringifyYaml`); it splits on the standard `---` frontmatter delimiters, parses the YAML block, and returns `{body, frontmatter}`.

## Error paths

| Outcome | MCP code | Severity | When |
|---|---|---|---|
| `success` | — | info | Document found, frontmatter parsed, integrity check passed |
| `document_not_found` | `-32010` | warn | No `documents` row matches the requested id with `status = 'success'` |
| `index_locked` | `-32011` | warn | SQLite WAL contention exhausts `busy_timeout` |
| `integrity_loss` | `-32603` | error | Frontmatter id ≠ requested id (corpus bug, NOT user error) |
| `frontmatter_parse_error` | `-32603` | error | YAML parse failure on the frontmatter block |
| `body_read_error` | `-32603` | error | Filesystem read failure on the body file |
| `server_initializing` | `-32002` | warn | Cold-start (caught at request-handler level) |

The `document_not_found` outcome is non-retriable (`retriable: false` is implicit; the client should not retry an unknown id). The `index_locked` outcome is retriable (`retriable: true` in the error envelope).

A document in trash (`status = 'trashed'`) is NOT visible — adapter's `WHERE status = 'success'` clause excludes it, and the read returns `document_not_found`. A document in failure lane (`status = 'failed'`) is similarly hidden. Per spec edge-case "Document-id determinism": failure-lane documents do not have stable IDs that an agent should be referencing.

## Telemetry

Every read emits a `resource.read` event:

```ts
{
  event: 'resource.read',
  timestamp: '2026-05-15T14:30:00.123Z',
  resource_uri: 'corpus://docs/*',          // template form — exact URI lives in doc_id
  doc_id: 'doc-ab12cd34',                   // the requested id, present for ALL doc reads (success + failure)
  result: 'success' | 'document_not_found' | 'index_locked' | 'server_initializing' | 'error',
  duration_ms: 12,
  request_id: '019099d4-...',
  severity: 'info' | 'warn' | 'error',
}
```

For `document_not_found`, `doc_id` is the requested-but-missing id. This is forensically useful — it records WHICH unknown ids agents are asking for. SC-009 verifies one event per read across a 50-read mixed workload including success + not-found + index-locked outcomes.

## SearchHit URI dereferencing (forward-looking)

US4 AS3: the `uri` field returned by `corpus.find` SearchHits MUST be of the form `corpus://docs/{id}` AND MUST dereference here. SP-002 verifies this contract against fixture SearchHits (SC-007); SP-005 (search ranking) re-verifies against real `corpus.find` output.

The fixture-based test:

```ts
// tests/integration/resource-populated-fixtures.test.ts (SC-007 portion)
const fixtureSearchHits = loadFixture('searchhit-fixture-uris.json');   // 5 hits
for (const hit of fixtureSearchHits) {
  expect(hit.uri).toMatch(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/);
  const result = await mcpClient.readResource(hit.uri);
  const parsed = DocumentPayload.parse(JSON.parse(result.contents[0].text));
  expect(parsed.frontmatter.id).toBe(hit.id);    // URI ↔ document integrity
}
```

Zero dereference mismatches across the fixture set is SC-007's pass criterion.
