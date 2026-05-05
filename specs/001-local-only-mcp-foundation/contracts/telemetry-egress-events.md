# Contract — Telemetry Egress Events

**Feature**: 001-local-only-mcp-foundation
**Stream**: `Paths.telemetry()` — append-only JSONL, one event per line.
**Constitution**: Principle XIII (Telemetry-or-Die), Principle IX (Concurrency-Safe Shared State — append-atomic JSONL ≤4 KB).

## Event classes shipped in SP-001

This feature ships three event classes; they are a *subset* of NFR-016's full ≥6-class set. SP-003 expands telemetry to validate/ingest/transform/classify/index/search.

| Event | Emitted when | Required fields |
|---|---|---|
| `egress.attempted` | The runtime hook intercepts an outbound primitive call, BEFORE deciding to block or allow | event, timestamp, primitive, destination_host, destination_port, request_id |
| `egress.blocked` | The runtime hook decides to block (destination is non-loopback) — fired AFTER `egress.attempted` for the same call | event, timestamp, primitive, destination_host, destination_port, result, request_id, blocked_at |
| `egress.checkpoint` | At every pipeline-stage transition, proves the guard is registered and active for that stage | event, timestamp, doc_id, pipeline_stage, request_id |

## Schemas (Zod source)

```ts
import { z } from 'zod';

const ISO8601 = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const RequestId = z.string().uuid();   // uuid v7 preferred for monotonic ordering

const Primitive = z.enum([
  'net.Socket.connect',
  'undici.Dispatcher',
  'dgram.send',
  'dns.lookup',
  'http2.connect',
  'tls.connect',
]);

const PipelineStage = z.enum([
  'ingest', 'classify', 'embed', 'index', 'find',
]);

export const EgressAttemptedEvent = z.object({
  event:            z.literal('egress.attempted'),
  timestamp:        ISO8601,
  primitive:        Primitive,
  destination_host: z.string(),
  destination_port: z.number().int().min(0).max(65535),
  request_id:       RequestId,
  doc_id:           z.string().regex(/^doc-[0-9a-f]{8}$/).optional(),
});

export const EgressBlockedEvent = z.object({
  event:            z.literal('egress.blocked'),
  timestamp:        ISO8601,
  primitive:        Primitive,
  destination_host: z.string(),
  destination_port: z.number().int().min(0).max(65535),
  result:           z.literal('blocked'),
  blocked_at:       z.enum(['in_process_hook', 'os_firewall', 'native_addon_allowlist']),
  request_id:       RequestId,
  doc_id:           z.string().regex(/^doc-[0-9a-f]{8}$/).optional(),
});

export const EgressCheckpointEvent = z.object({
  event:          z.literal('egress.checkpoint'),
  timestamp:      ISO8601,
  doc_id:         z.string().regex(/^doc-[0-9a-f]{8}$/),
  pipeline_stage: PipelineStage,
  request_id:     RequestId,
});

export const EgressEvent = z.discriminatedUnion('event', [
  EgressAttemptedEvent,
  EgressBlockedEvent,
  EgressCheckpointEvent,
]);
```

## Size constraint

Every serialized event MUST be ≤ 4096 bytes (POSIX `PIPE_BUF` on Linux) so that `fs.appendFile()` with `O_APPEND` is atomic at the kernel level. The schemas above are deliberately small (no free-form text fields, fixed enum vocabularies); enforced by an `assert(serialized.length <= 4096)` before each append.

## Loopback exclusion (egress hook policy)

The hook does NOT block loopback destinations:

- IPv4: `127.0.0.0/8` (all of `127.x.x.x`)
- IPv6: `::1`
- DNS resolution: hostnames that resolve to loopback only

Loopback connections MAY emit `egress.attempted` events for forensic completeness, but MUST NOT emit `egress.blocked` events. This carve-out is necessary for the MCP stdio transport (it doesn't use TCP) AND for Ollama-bound calls in future features (which connect to `localhost:11434`).

## Append discipline

Telemetry writes use `fs.appendFile(Paths.telemetry(), serialized + '\n', { flag: 'a' })`. The `O_APPEND` flag guarantees atomic appends at the kernel level for writes ≤ `PIPE_BUF`. No file lock is needed for single-process appends.

For SP-001, only the MCP server process writes to `Paths.telemetry()`. Future features that add the daemon process will use the same append-only API; multi-process appends remain atomic at the per-record level.

## Caller error contract

When the hook decides to block an `egress.attempted`, the patched primitive MUST throw a typed error to its caller:

```ts
class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  constructor(
    readonly primitive: string,
    readonly destination: string,
  ) {
    super(`Egress to ${destination} via ${primitive} blocked by local-only enforcement (NFR-002)`);
  }
}
```

Callers (e.g., a future cloud-SDK adapter) MUST handle this error like any other I/O failure — log, return `Result.err`, do NOT crash. The Constitution Principle XIII catch-block-emits-telemetry rule covers downstream catch sites. The hook itself emits the `egress.blocked` event; callers should NOT re-emit.

## Examples (one line each, matching the JSONL format on disk)

```json
{"event":"egress.attempted","timestamp":"2026-05-15T14:30:00.123Z","primitive":"undici.Dispatcher","destination_host":"localhost","destination_port":11434,"request_id":"019099d4-78f0-7e61-a37c-8c2a9b5d2e10"}
{"event":"egress.attempted","timestamp":"2026-05-15T14:30:01.456Z","primitive":"net.Socket.connect","destination_host":"8.8.8.8","destination_port":53,"request_id":"019099d4-79b0-7e61-b48d-9d3aa6c7e312"}
{"event":"egress.blocked","timestamp":"2026-05-15T14:30:01.456Z","primitive":"net.Socket.connect","destination_host":"8.8.8.8","destination_port":53,"result":"blocked","blocked_at":"in_process_hook","request_id":"019099d4-79b0-7e61-b48d-9d3aa6c7e312"}
{"event":"egress.checkpoint","timestamp":"2026-05-15T14:30:02.789Z","doc_id":"doc-c8cf6ea2","pipeline_stage":"find","request_id":"019099d4-7a40-7e61-c59e-ae4bb7d8f414"}
```

The first event is loopback (Ollama on localhost) — emitted as `attempted`, NOT followed by `blocked`. The second/third pair is a non-loopback attempt — `attempted` then `blocked`. The fourth is a per-stage checkpoint proving always-on enforcement.
