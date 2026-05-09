# Contract — MCP Resources Protocol Surface

**Feature**: 002-mcp-resources
**Status**: SP-002 ships full registration + handlers for the four canonical resources.
**Inherits from**: `specs/001-local-only-mcp-foundation/contracts/mcp-corpus-find.md` (cold-start error envelope, JSON-RPC conventions, SDK usage pattern).

This contract defines the protocol surface SP-002 adds to the MCP server: registration shape, request/response envelopes, error contracts, handler signatures, and bootstrap discipline. Per-resource payload contracts live in companion files (`resource-manifest.md`, `resource-taxonomy.md`, `resource-recent.md`, `resource-document.md`). The new telemetry event class lives in `telemetry-resource-events.md`.

---

## Registration shape

The MCP server registers four canonical resources distributed across two list endpoints:

| URI | List endpoint | Registration mechanism |
|---|---|---|
| `corpus://manifest`        | `resources/list`            | Static URI, auto-load annotation |
| `corpus://taxonomy`        | `resources/list`            | Static URI |
| `corpus://recent`          | `resources/list`            | Static URI |
| `corpus://docs/{id}`       | `resources/templates/list`  | RFC 6570 URI template, `id` is the path-component variable |

Decision A (in `research.md`) settles the static-vs-template split: static URIs go in `resources/list`; URI templates go in `resources/templates/list`. SC-002 verification covers BOTH endpoints.

**Implementation guidance (per `research.md` Decision A)**: At implementation time, verify whether the pinned `@modelcontextprotocol/sdk ^1.0.0` exposes a high-level `server.registerResource()` helper analogous to `registerTool`. If it does, prefer it. Otherwise, register manually:

```ts
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => {
  if (!ready) {
    throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', { retry_after_ms: 1000 });
  }
  return {
    resources: [
      {
        uri: 'corpus://manifest',
        name: 'Corpus manifest',
        description: 'Structural snapshot of the corpus...',
        mimeType: 'application/json',
        annotations: { audience: ['assistant'], priority: 1.0 },  // auto-load semantics
      },
      {
        uri: 'corpus://taxonomy',
        name: 'Corpus taxonomy',
        description: 'Promoted vocabulary across all SearchFilter axes...',
        mimeType: 'application/json',
      },
      {
        uri: 'corpus://recent',
        name: 'Recent ingests',
        description: 'Last N successfully ingested documents...',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request, extra) => {
  if (!ready) {
    throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', { retry_after_ms: 1000 });
  }
  return {
    resourceTemplates: [
      {
        uriTemplate: 'corpus://docs/{id}',
        name: 'Document by ID',
        description: 'Full Markdown body and frontmatter for one ingested document...',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
  if (!ready) {
    throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', { retry_after_ms: 1000 });
  }
  const { uri } = request.params;
  const signal = extra.signal as AbortSignal | undefined;
  // Dispatch table — exact match on the three static URIs first, template match last.
  if (uri === 'corpus://manifest')   return manifestHandler(uri, signal);
  if (uri === 'corpus://taxonomy')   return taxonomyHandler(uri, signal);
  if (uri === 'corpus://recent')     return recentHandler(uri, signal);
  const docMatch = uri.match(/^corpus:\/\/docs\/(doc-[0-9a-f]{8})$/);
  if (docMatch) return documentHandler(uri, docMatch[1], signal);
  throw new McpError(-32602, 'Unknown resource URI', { uri });
});
```

The dispatch table prefers exact-match (static URIs) over template-match — same behavior the SDK's auto-dispatch would provide if the high-level helper exists.

---

## Auto-load annotation

The `corpus://manifest` resource carries the standard MCP `annotations` object indicating eligibility for auto-load at session start:

```ts
{
  uri: 'corpus://manifest',
  /* ... */
  annotations: {
    audience: ['assistant'],
    priority: 1.0,
  },
}
```

The exact annotation shape MUST be the standard one supported by `@modelcontextprotocol/sdk`. SC-003 verifies the annotation is *attached* to the manifest entry on every cold-start of the server. Per Constitution XVI, client-side honoring is the client's responsibility, not a v1 server guarantee.

The other three resources MUST NOT carry the auto-load annotation — they are read-on-demand.

---

## Request/response envelopes

### `resources/list` request

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/list",
  "params": {}
}
```

### `resources/list` response (ready, populated)

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "resources": [
      {"uri": "corpus://manifest", "name": "Corpus manifest", "mimeType": "application/json", "annotations": {...}},
      {"uri": "corpus://taxonomy", "name": "Corpus taxonomy", "mimeType": "application/json"},
      {"uri": "corpus://recent",   "name": "Recent ingests",  "mimeType": "application/json"}
    ]
  }
}
```

### `resources/templates/list` response (ready)

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "resourceTemplates": [
      {"uriTemplate": "corpus://docs/{id}", "name": "Document by ID", "mimeType": "application/json"}
    ]
  }
}
```

### `resources/read` request

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "resources/read",
  "params": {
    "uri": "corpus://manifest"
  }
}
```

### `resources/read` response (manifest, populated example)

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

The `contents` array follows the MCP SDK's `ResourceContents` convention: each entry has a `uri` echoing the requested URI, a `mimeType`, and either `text` (UTF-8) or `blob` (base64). SP-002 always returns `text` with `mimeType: "application/json"` for JSON resources; the per-document resource also returns `text` but with `mimeType: "text/markdown"` for the Markdown body — see below.

### `resources/read` response (per-document)

The `corpus://docs/{id}` handler returns TWO content entries: one for the JSON envelope (with frontmatter), and one for the Markdown body. (Alternatively, a single content entry whose JSON `text` includes the body inline — see `resource-document.md` for the chosen shape; the contract there is authoritative.)

---

## Error contracts

SP-002 defines four MCP error codes (in addition to inheriting SP-001's `-32002` for `server_initializing`):

| Code | Message | Retriable | When |
|---|---|---|---|
| `-32002` | `server_initializing` | Yes | `resources/list`, `resources/templates/list`, or `resources/read` arrives before `markReady()` |
| `-32010` | `document_not_found` | No  | `corpus://docs/{id}` for an unknown id |
| `-32011` | `index_locked` | Yes | SQLite WAL writer lock contention during a read |
| `-32602` | `Invalid params` | No  | Malformed `uri` parameter or unknown resource URI |
| `-32603` | `Internal error` | No  | Schema validation failure on output payload, taxonomy parse error |

The `-32010` and `-32011` codes are in the JSON-RPC 2.0 server-defined error range (`-32099` to `-32000`), the same range SP-001 uses for `-32002`.

### `server_initializing` envelope

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "error": {
    "code": -32002,
    "message": "server_initializing",
    "data": {
      "retry_after_ms": 1000,
      "phase": "bootstrapping"
    }
  }
}
```

`phase` is `"bootstrapping"` while the egress hook + index open are in flight. Mirrors SP-001 verbatim plus the `phase` field for forward observability.

### `document_not_found` envelope

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

### `index_locked` envelope

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

The `retry_after_ms` advisory is informed by SQLite `PRAGMA busy_timeout` (default 5000 ms in SP-002) — adapter retries the busy-wait window before returning `index_locked`; the advisory is what the client SHOULD wait before its own retry. The `retriable: true` field is explicit per spec edge-case "Index lock contention."

---

## Handler signatures

All resource handlers conform to the same shape (Constitution VII — Cancellable IO):

```ts
import type { Result } from '@llm-corpus/contracts';
import type { z } from 'zod';

export type ResourceReadResult = {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
};

export type ResourceHandler<TPayload> = (
  uri: string,
  signal: AbortSignal,
) => Promise<ResourceReadResult>;

// Per-resource handlers narrow this signature:
export type ManifestHandler   = (uri: string,                     signal: AbortSignal) => Promise<ResourceReadResult>;
export type TaxonomyHandler   = (uri: string,                     signal: AbortSignal) => Promise<ResourceReadResult>;
export type RecentHandler     = (uri: string,                     signal: AbortSignal) => Promise<ResourceReadResult>;
export type DocumentHandler   = (uri: string, docId: string,      signal: AbortSignal) => Promise<ResourceReadResult>;
```

Each handler:

1. `signal.throwIfAborted()` at entry.
2. Capture `timestamp_start` and `request_id` for telemetry.
3. Invoke the corresponding storage adapter, propagating the `signal`.
4. Adapter returns `Result<TPayload, ResourceError>` where `ResourceError` is the typed-error union (`DocumentNotFoundError`, `IndexLockedError`, `TaxonomyParseError`, etc.).
5. On `Result.ok`: validate the payload through the Zod schema; serialize to JSON; emit `resource.read` event with `result: 'success'` and `severity: 'info'`; return the `ResourceReadResult` envelope.
6. On `Result.err`: map the typed error to an `McpError`; emit `resource.read` event with the matching `result` outcome and severity; throw `McpError` (the SDK serializes it to the JSON-RPC error envelope).

Handlers MUST NOT call `process.exit` (Constitution XI). Handlers MUST NOT swallow errors (Constitution XIII). Handlers MUST NOT take any parameter that mutates corpus state (Constitution III — read-only).

---

## Bootstrap ordering

SP-002 extends the SP-001 bootstrap discipline:

```ts
// packages/transport/src/index.ts (entry-point) — SP-001 contract preserved
import './egress-hook-bootstrap.js';   // FIRST IMPORT — registers patches before anything else

export { startMcpServer, buildMcpServer } from './mcp-server.js';
```

SP-002 does NOT change the order of imports in `index.ts`. The four resource handlers are registered inside `buildMcpServer` AFTER the egress hook is live; any accidental network call from a handler is hard-blocked by the hook.

The `bootstrapping → ready` transition expands:

```text
bootstrapping = {egress hook installed} ∧ {SQLite read connection opened} ∧ {schema migration run if needed} ∧ {tools registered} ∧ {resources registered}

ready = bootstrapping ∧ markReady() called
```

`markReady()` MUST NOT be called until ALL of the above complete. SP-002's `tests/integration/resource-cold-start.test.ts` asserts that `resources/list` issued during `bootstrapping` returns `server_initializing`.

---

## Read-only enforcement (SC-010)

SC-010 demands "read-only-ness is enforced by construction, not by reviewer vigilance." Three layers:

1. **eslint rule `no-writes-from-resource-handlers`** — AST scan over `packages/transport/src/resource-{manifest,taxonomy,recent,document}-handler.ts` and the imported call graph in `packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts`. Forbidden patterns: `.exec()` with INSERT/UPDATE/DELETE/CREATE/DROP/ALTER, `.run()` with same, `fs.writeFile*`, `fs.appendFile*` (except via the telemetry helper allowlist), `fs.mkdir*` (except the telemetry helper). Build fails on violation.
2. **better-sqlite3 read-only mode** — `sqlite-open.ts` opens with `{ readonly: true }` for resource handlers. Attempting a write throws `SQLITE_READONLY`.
3. **Integration test `resource-read-only-lint.test.ts`** — runs the eslint rule against the resource-handler call graph and asserts zero violations. Also runs a fixture-driven smoke that opens the SQLite in WAL mode, attempts each of the four resource reads against fixture data, and asserts the fixture row count is unchanged after all reads complete.

---

## Validation gates

- **At registration (cold-start)**: SDK validates that no two resources share a URI. Defensive check in `mcp-server.ts` asserts the URI list matches the canonical four.
- **Per `resources/read`**: SDK validates the `uri` parameter is a string. SP-002's dispatch validates the URI is one of the four canonical forms; mismatch returns `-32602` "Invalid params" with the offending URI in `data.uri`.
- **Per handler return**: Zod parses the payload before serialization. `safeParse` failure returns `-32603` "Internal error" and emits a `resource.read` event with `result: 'error'`, `severity: 'error'`. The Zod error's `issues[]` go into `error.data.validation_issues` for debugging.
- **Output size**: Resource payloads have NO inherent size cap (per-document body can be large). Telemetry events do — Constitution IX 4 KB cap. Different concerns; size guards live at the right layer.

---

## Out of scope (downstream features)

- **`notifications/resources/updated` change-notification stream** — SP-NNN TBD.
- **`subscribe`/`unsubscribe` resource methods** — not in any current SP.
- **Server-side resource caching** — clients handle their own caching per the auto-load annotation; server is stateless across reads.
- **Authentication/authorization** — single-user, single-machine (Constitution IV); no auth surface.
