# Contract — MCP Tool: `corpus.find`

**Feature**: 001-local-only-mcp-foundation
**Status**: SP-001 ships the *registration* and *empty-result handler*; ranking/SearchHit construction lands in SP-005.

## Tool registration

The MCP server registers exactly one tool, named `corpus.find`, advertised via the standard `tools/list` handshake.

## Input schema (Zod source)

```ts
import { z } from 'zod';

export const SearchFilter = z.object({
  domain:      z.string().optional(),               // facet_domain (kebab-case)
  type:        z.enum([
    'entity', 'concept', 'tutorial', 'analysis',
    'reference', 'synthesis', 'cheat-sheet',
  ]).optional(),
  source_type: z.enum([
    'article', 'research-paper', 'manual', 'form',
    'video', 'podcast', 'book', 'notes', 'transcript', 'reference',
  ]).optional(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // ISO date
  limit: z.number().int().min(1).max(50).default(10),
  mode:  z.enum(['hybrid', 'keyword', 'vector']).default('hybrid'),
});

export const CorpusFindInput = z.object({
  query:  z.string().min(1).max(2000),
  filter: SearchFilter.optional(),
});
```

## Output schema (Zod source)

```ts
export const SearchHit = z.object({
  id:             z.string().regex(/^doc-[0-9a-f]{8}$/),
  title:          z.string(),
  source:         z.string(),
  source_type:    z.string(),
  facet_domain:   z.string(),
  facet_type:     z.string(),
  summary:        z.string(),
  score:          z.number(),                                 // RRF-merged rank
  matched_fields: z.array(z.string()),
  matched_tier:   z.enum(['hybrid', 'keyword', 'grep_catalog', 'grep_body']),
});

export const CorpusFindOutput = z.object({
  hits:  z.array(SearchHit),
  query: z.string(),                                          // echoed for client correlation
  tier_used: z.enum(['hybrid', 'keyword', 'grep_catalog', 'grep_body']).optional(),
});
```

## SP-001 handler behavior

```ts
async function corpusFindHandler(input: z.infer<typeof CorpusFindInput>): Promise<z.infer<typeof CorpusFindOutput>> {
  return {
    hits: [],                  // empty in SP-001 — no documents indexed yet
    query: input.query,
    tier_used: undefined,
  };
}
```

**Why empty?** SP-001's scope is the security primitive + the agent surface, not the search ranking. SP-005 implements the real handler with FTS5 + sqlite-vec + RRF. The empty-result handler is a contract placeholder that satisfies FR-001's "tool MUST be invokable" requirement; downstream features replace the handler body.

## JSON-RPC envelope

`tools/list` response payload includes:

```json
{
  "tools": [
    {
      "name": "corpus.find",
      "description": "Search the local corpus with optional facet filters. Returns ranked SearchHit list.",
      "inputSchema":  <JSON Schema derived from CorpusFindInput via zod-to-json-schema>,
      "outputSchema": <JSON Schema derived from CorpusFindOutput>
    }
  ]
}
```

`tools/call` request:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "method": "tools/call",
  "params": {
    "name": "corpus.find",
    "arguments": {
      "query": "...",
      "filter": { "domain": "..." }
    }
  }
}
```

`tools/call` response (SP-001 — empty hits):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"hits\":[],\"query\":\"...\"}"
      }
    ]
  }
}
```

The `content` array follows the MCP SDK's tool-result convention; the JSON payload is delivered as a `text` content block. Clients deserialize with the advertised `outputSchema`.

## Cold-start error envelope

When `tools/list` arrives during the bootstrapping phase (egress hook registered but index not yet open):

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "error": {
    "code": -32002,
    "message": "server_initializing",
    "data": { "retry_after_ms": 1000 }
  }
}
```

`code: -32002` is in the JSON-RPC 2.0 server-defined error range. Clients implementing the MCP spec are expected to retry on this code per the SDK's reconnection policy.

## Validation gates

- **At registration**: the SDK validates that `inputSchema` and `outputSchema` are valid JSON Schemas; failure prevents server startup.
- **Per `tools/call`**: the SDK runs `CorpusFindInput.parse(arguments)` before invoking the handler; rejection produces a `code: -32602` ("Invalid params") response without invoking the handler.
- **Per handler return**: the SDK runs `CorpusFindOutput.parse(result)` before serializing; rejection produces a `code: -32603` ("Internal error") response and emits a telemetry event.

## Out of scope (downstream features)

- **Ranking algorithm** (RRF over BM25 + dense + graph + confidence) — SP-005 (FR-002, FR-003, FR-004).
- **Filter implementation** — schema is locked here; semantics land in SP-005.
- **`tools/call` for any tool other than `corpus.find`** — none in v1; the architecture explicitly limits the tool surface to `corpus.find` plus future resources/prompts.
