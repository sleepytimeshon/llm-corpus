# ADR — `corpus://failures` Read-Only MCP Resource: URI, Schema, Pagination

**Feature**: 006-hardening
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

Since SP-003, the failure-lane writer (`packages/pipeline/src/failure-lane.ts`) has been writing `<doc-id>.error.json` sidecars to `Paths.failed()` for every pipeline-stage failure (validation, hash, normalize, persist, classify, embed, index, edges-build). The on-disk shape (SP-003 verbatim):

```json
{
  "doc_id": "doc-XXXXXXXX | null",
  "stage": "validation|hash|normalize|persist|classify|embed|index|edges-build",
  "error_code": "<enum>",
  "message": "<bounded string>",
  "timestamp": "<ISO-8601>",
  "retriable": true|false
}
```

The SP-006 recovery scanner additionally writes `<doc-id>.recovery.error.json` sidecars for non-resumable orphans (same schema; `error_code='unrecoverable_orphan'`).

These sidecars are operator-visible via `ls Paths.failed()/*.error.json` + `cat`, but agents (the principal substrate consumers per WHITEPAPER-FINAL.md) have NO MCP-exposed surface to inspect them. The WHITEPAPER-FINAL.md "corpus is queryable for what's broken" principle is unfulfilled.

SP-005 spec.md Out-of-Scope explicitly deferred `corpus://failures` to SP-006: "SP-005 writes `<doc-id>.error.json` sidecars consistent with SP-003 / SP-004; the MCP resource exposing them is SP-006."

This ADR codifies the URI, response schema, query parameters, pagination semantics, and per-sidecar graceful degradation.

## Decision

**Resource URI**: `corpus://failures` (registered alongside SP-002's four resources via `BuiltMcpServer.registerStaticResource()`).

**Query Parameters** (all optional):

- `stage=<stage>` — closed enum filter. Allowed values: `validation`, `hash`, `normalize`, `persist`, `classify`, `embed`, `index`, `edges-build`, `unrecoverable_orphan`.
- `since=<ISO-8601>` — only include entries with `timestamp >= since`.
- `limit=<int>` — pagination size; default 50; range [1, 1000].
- `offset=<int>` — pagination offset; default 0; range [0, ∞).

**Response Shape** (Zod-validated via `FailuresResourceResponseZodSchema`):

```typescript
{
  entries: FailureEntry[],
  total_count: number,    // post-filter, pre-pagination count
  returned_count: number, // min(total_count - offset, limit)
  schema_version: 1,      // literal; future SP-007+ may ship version 2
}
```

**FailureEntry Shape** (Zod-validated via `FailureEntryZodSchema`):

```typescript
{
  doc_id: string | null,
  stage: 'validation' | 'hash' | 'normalize' | 'persist' | 'classify' | 'embed' | 'index' | 'edges-build' | 'unrecoverable_orphan',
  error_code: string,
  message: string,        // ≤ 1024 chars
  timestamp: ISO-8601,
  retriable: boolean,
  sidecar_path: string,   // SP-006-added: absolute path under Paths.failed()
}
```

**Read Algorithm**:

1. **Validate query parameters** via `FailuresQueryZodSchema`. Unknown keys → `{error_code: 'validation_error', message, hint}` envelope returned as a successful MCP resource response (NOT a transport error).
2. **Check `Paths.failed()` directory existence**. If absent (clean install, no failures yet), return `{entries: [], total_count: 0, returned_count: 0, schema_version: 1}`.
3. **Glob both patterns** — `Paths.failed() + '/*.error.json'` AND `Paths.failed() + '/*.recovery.error.json'`.
4. **For each sidecar**:
   - Read via `fs.readFile`.
   - Parse as JSON.
   - Validate against `FailureEntryZodSchema` (without the `sidecar_path` field — that's added by the adapter).
   - On validation failure: SKIP the entry; emit `failures.sidecar_parse_failed` event with the sidecar path. Continue with remaining sidecars (per-sidecar graceful degradation).
   - On validation success: add the `sidecar_path` field; include in the result list.
5. **Apply filters**:
   - If `stage` parameter present, retain only entries where `entry.stage === stage`.
   - If `since` parameter present, retain only entries where `entry.timestamp >= since`.
6. **Sort descending by `timestamp`** (most-recent failure first).
7. **Apply pagination**: `entries = filtered.slice(offset, offset + limit)`. Set `total_count = filtered.length`, `returned_count = entries.length`.
8. **Validate response** via `FailuresResourceResponseZodSchema.parse()` before serialization. On internal validation failure, return `{error_code: 'internal_error', message, hint}` envelope.
9. **Emit `resource.read` telemetry** (existing SP-002 telemetry class; outcome=success/failure; query-parameter values).

**Read-Only Enforcement**: The handler is gated by the `no-writes-from-resource-handlers` ESLint rule (introduced in SP-002 + extended in SP-006 to cover the new handler + adapter). Zero `fs.write*`, `fs.append*`, `fs.mkdir*`, `fs.unlink*`, INSERT/UPDATE/DELETE/CREATE/DROP/ALTER calls.

**Cancellable**: `failures-resource-handler.ts` accepts AbortSignal from the MCP transport. `signal.throwIfAborted()` between sidecar reads.

## Consequences

**Positive**:

- Agents can now inspect the failure backlog via MCP without operator intervention.
- The READ-ONLY by construction enforcement (ESLint rule) prevents accidental mutation.
- Per-sidecar graceful degradation means a single malformed file doesn't break the whole read.
- Pagination + filters keep the read bounded.
- `schema_version: 1` enables future schema evolution.

**Negative**:

- The resource doesn't OFFER mutation surfaces (rm sidecar, retry doc). Operators must use `rm` + manual re-ingest. Future sprint may add a CLI surface.
- Large backlogs (10k+ sidecars) take O(N) to parse on each read; mitigated by default limit=50 + hard cap limit=1000.

**Risk mitigations**:

- **R1 (low) — sidecar parse cost on huge backlogs**: Mitigation: hard cap limit=1000; documented < 100 ms p95 at 1000-sidecar backlog. Beyond that, operators should triage some sidecars (`rm`).
- **R2 (low) — Stage enum drift**: Mitigation: the `FailureEntryZodSchema` defines the closed enum centrally; new stages (e.g., a future `validate-attachments` stage) require schema extension + tests. Defensive: malformed stage values are skipped with `failures.sidecar_parse_failed`.

## Implementation Notes

- `packages/contracts/src/failures-resource-schema.ts` (NEW) — `FailureEntryZodSchema`, `FailuresQueryZodSchema`, `FailuresResourceResponseZodSchema`.
- `packages/storage/src/failures-resource-adapter.ts` (NEW) — `readFailuresEntries(query, signal): Promise<{entries, total_count, returned_count, schema_version}>`. Globbing + parsing + filter + sort + paginate.
- `packages/transport/src/failures-resource-handler.ts` (NEW) — MCP resource handler delegating to the adapter; Zod-validates input + output; emits `resource.read` telemetry.
- `packages/transport/src/mcp-server.ts` (EXTENDED) — registers `corpus://failures` via `BuiltMcpServer.registerStaticResource()` inside `startMcpServer()`.
- `eslint.config.js` (EXTENDED) — `no-writes-from-resource-handlers` rule scoped over the new handler + adapter files.

## Status

Accepted. Implementation in `tasks.md` Phase 4 (US2 P1).
