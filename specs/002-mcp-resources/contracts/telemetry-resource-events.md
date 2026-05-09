# Contract — Telemetry Resource-Read Events

**Feature**: 002-mcp-resources
**Stream**: `Paths.telemetry()` — append-only JSONL (shared with SP-001 egress events; same file)
**Constitution**: Principle XIII (Telemetry-or-Die), Principle IX (≤4 KB append atomicity), Principle V (schema-enforced)
**Inherits from**: `specs/001-local-only-mcp-foundation/contracts/telemetry-egress-events.md` (size discipline, append API, JSONL format)

This contract defines the `resource.read` event class shipped by SP-002. SP-002 introduces this as a new, additive variant of the existing telemetry discriminated union — it does NOT modify the SP-001 egress event classes.

## Event class shipped in SP-002

| Event | Emitted when | Required fields |
|---|---|---|
| `resource.read` | A resource handler (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, or `corpus://docs/{id}`) completes — on success AND on every failure path | event, timestamp, resource_uri, result, duration_ms, request_id, severity |

## Schema (Zod source)

```ts
import { z } from 'zod';

const ISO_8601 = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const RequestId = z.string().uuid();
const DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);

export const ResourceUri = z.enum([
  'corpus://manifest',
  'corpus://taxonomy',
  'corpus://recent',
  'corpus://docs/*',     // template form — exact URI fully recoverable as `corpus://docs/${doc_id}`
]);

export const ResourceReadOutcome = z.enum([
  'success',
  'document_not_found',
  'index_locked',
  'server_initializing',
  'error',
]);

export const ResourceReadSeverity = z.enum(['info', 'warn', 'error']);

export const ResourceReadEvent = z.object({
  event:        z.literal('resource.read'),
  timestamp:    ISO_8601,
  resource_uri: ResourceUri,
  doc_id:       DocId.optional(),
  result:       ResourceReadOutcome,
  duration_ms:  z.number().int().nonneg(),
  request_id:   RequestId,
  severity:     ResourceReadSeverity,
});

export type ResourceReadEventType = z.infer<typeof ResourceReadEvent>;
```

## Discriminated union extension

SP-002 extends `packages/contracts/src/telemetry.ts`. The existing discriminated union renames from `EgressEvent` to `TelemetryEvent`; the rename is additive:

```ts
// AFTER SP-002:
export const TelemetryEvent = z.discriminatedUnion('event', [
  EgressAttemptedEvent,    // from SP-001
  EgressBlockedEvent,      // from SP-001
  EgressCheckpointEvent,   // from SP-001
  ResourceReadEvent,       // NEW in SP-002
]);

// Backward-compat alias for SP-001 callers:
/** @deprecated use TelemetryEvent — renamed in SP-002 */
export const EgressEvent = TelemetryEvent;
```

The rename is one-time; future SPs (SP-003 pipeline events, SP-004 classify events) extend the same union without further renames.

## Severity mapping

Per Constitution XIII: severity matches actual error severity, no downgrading.

| `result` | `severity` | Rationale |
|---|---|---|
| `success` | `info` | Normal operation |
| `document_not_found` | `warn` | Recoverable client error; agent should handle |
| `index_locked` | `warn` | Recoverable transient contention; client retries |
| `server_initializing` | `warn` | Recoverable cold-start race; client retries |
| `error` | `error` | Real failure (schema validation, integrity loss, parse error); investigation needed |

## Field semantics

- **`event`** — literal discriminator `'resource.read'`. Distinguishes from the three SP-001 egress events in the same JSONL stream.
- **`timestamp`** — ISO-8601 UTC, captured at handler-completion time (success or failure path).
- **`resource_uri`** — closed enum of the four canonical resource URIs (template form for per-doc). For per-doc reads, `doc_id` carries the specific id; full URI is recoverable as `corpus://docs/${doc_id}`.
- **`doc_id`** — present only for `corpus://docs/*` reads (success AND failure, including `document_not_found` where the value is the missing-id the agent requested). Absent for the three static URI reads.
- **`result`** — outcome enum. See Severity mapping table.
- **`duration_ms`** — integer milliseconds from handler entry to response/error emit.
- **`request_id`** — UUID v7 (preferred for monotonic ordering — same convention as SP-001 egress events). Correlates the resource-read event with any related egress events that fired during the same request.
- **`severity`** — derived from `result` per the mapping table. Stored explicitly so downstream consumers (alert filters, dashboards) don't need to re-derive.

## Size constraint

Every serialized event MUST be ≤ `TELEMETRY_MAX_BYTES` (4096 bytes — POSIX `PIPE_BUF` on Linux) so `fs.appendFile()` with `O_APPEND` is atomic at the kernel level (Constitution IX).

The schema is bounded: enum-only `result`/`severity`/`resource_uri`, fixed-format `doc_id`/`request_id`/`timestamp`, integer `duration_ms`. Worst-case serialization ≈ 230 bytes — well under the cap. The existing `assert(serialized.length <= TELEMETRY_MAX_BYTES)` guard in `emitTelemetry` covers the new event class for free.

## Append discipline

Inherits SP-001 verbatim:

```ts
fs.appendFile(Paths.telemetry(), serialized + '\n', { flag: 'a' });
```

Single-process atomic at the kernel level for writes ≤ `PIPE_BUF`. SP-002's MCP server is single-process; multi-process appends (when SP-003 introduces the daemon) remain atomic at the per-record level.

## Emit helper

`packages/transport/src/resource-telemetry.ts` exposes the typed wrapper:

```ts
import { emitTelemetry } from '@llm-corpus/contracts';
import type { ResourceReadEventType, ResourceUri, ResourceReadOutcome } from '@llm-corpus/contracts';

export interface EmitResourceReadInput {
  resource_uri: z.infer<typeof ResourceUri>;
  doc_id?:      string;
  result:       z.infer<typeof ResourceReadOutcome>;
  duration_ms:  number;
  request_id:   string;
}

const SEVERITY_MAP: Record<z.infer<typeof ResourceReadOutcome>, 'info' | 'warn' | 'error'> = {
  success:             'info',
  document_not_found:  'warn',
  index_locked:        'warn',
  server_initializing: 'warn',
  error:               'error',
};

export async function emitResourceRead(input: EmitResourceReadInput): Promise<void> {
  await emitTelemetry({
    event: 'resource.read',
    timestamp: new Date().toISOString(),
    resource_uri: input.resource_uri,
    doc_id: input.doc_id,
    result: input.result,
    duration_ms: input.duration_ms,
    request_id: input.request_id,
    severity: SEVERITY_MAP[input.result],
  });
}
```

## Caller contract (handler emit pattern)

```ts
async function manifestHandler(uri, signal): Promise<ResourceReadResult> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  signal.throwIfAborted();
  const result = await buildManifest(signal);
  if (result.ok) {
    const validated = ManifestPayload.safeParse(result.value);
    if (!validated.success) {
      await emitResourceRead({
        resource_uri: 'corpus://manifest',
        result: 'error',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(-32603, 'Internal error', { validation_issues: validated.error.issues });
    }
    await emitResourceRead({
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(validated.data) }] };
  }
  // result.err — IndexLockedError
  await emitResourceRead({
    resource_uri: 'corpus://manifest',
    result: 'index_locked',
    duration_ms: Date.now() - startTime,
    request_id: requestId,
  });
  throw new McpError(-32011, 'index_locked', { retriable: true, retry_after_ms: 250 });
}
```

The pattern: emit telemetry BEFORE throwing the `McpError`. This ensures the event is recorded even if the SDK's error-serialization path fails downstream. Per Constitution XIII, every catch block emits a structured event; the handler's emit-then-throw is the SP-002 surface for that rule.

## Examples (one line each, matching the JSONL format on disk)

```json
{"event":"resource.read","timestamp":"2026-05-15T14:30:00.123Z","resource_uri":"corpus://manifest","result":"success","duration_ms":12,"request_id":"019099d4-78f0-7e61-a37c-8c2a9b5d2e10","severity":"info"}
{"event":"resource.read","timestamp":"2026-05-15T14:30:01.456Z","resource_uri":"corpus://taxonomy","result":"success","duration_ms":8,"request_id":"019099d4-79b0-7e61-b48d-9d3aa6c7e312","severity":"info"}
{"event":"resource.read","timestamp":"2026-05-15T14:30:02.789Z","resource_uri":"corpus://docs/*","doc_id":"doc-ab12cd34","result":"success","duration_ms":34,"request_id":"019099d4-7a40-7e61-c59e-ae4bb7d8f414","severity":"info"}
{"event":"resource.read","timestamp":"2026-05-15T14:30:03.012Z","resource_uri":"corpus://docs/*","doc_id":"doc-missing","result":"document_not_found","duration_ms":3,"request_id":"019099d4-7b00-7e61-d6af-bf5cc8e9f516","severity":"warn"}
{"event":"resource.read","timestamp":"2026-05-15T14:30:04.345Z","resource_uri":"corpus://docs/*","doc_id":"doc-ab12cd34","result":"index_locked","duration_ms":5018,"request_id":"019099d4-7bc0-7e61-e7b0-d06dd9faf618","severity":"warn"}
```

The first three are success cases; the fourth is a not-found; the fifth is a busy-timeout. All five flow through the same `Paths.telemetry()` JSONL stream alongside SP-001's egress events.

## Test coverage (SC-009)

`tests/integration/resource-telemetry.test.ts` runs a 50-read mixed workload:
- 10 reads of each of the four resources (40 reads total, success path against fixtures)
- 5 reads of `corpus://docs/doc-missing-*` (5 not-found reads)
- 5 reads of any resource while a synchronous test fixture holds the SQLite writer lock (5 index_locked reads)

Asserts:
- exactly 50 `resource.read` events appended to `Paths.telemetry()`
- every event passes `ResourceReadEvent.parse()`
- per-event sizes ≤ `TELEMETRY_MAX_BYTES`
- outcome distribution matches workload (40 success, 5 not_found, 5 index_locked)
- per-event `request_id` is unique
- per-event `duration_ms` ≥ 0

This is SC-009's pass criterion: zero reads produce no telemetry event.
