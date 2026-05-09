// T030 — Typed wrapper for emitting `resource.read` telemetry events.
//
// References: contracts/telemetry-resource-events.md §"Emit helper",
// contracts/mcp-resources-api.md §"Error codes" (canonical MCP_ERROR_CODES).
//
// The four resource handlers (T037, T045, T056, T065 in Phases 3-6) call
// emitResourceRead() on every completion path — success AND every failure
// outcome. The severity-mapping table from the contract is inlined as
// SEVERITY_MAP and applied automatically.

import {
  emitTelemetry,
  type ResourceUriType,
  type ResourceReadOutcomeType,
  type ResourceReadSeverityType,
} from '@llm-corpus/contracts';

export interface EmitResourceReadInput {
  resource_uri: ResourceUriType;
  doc_id?: string;
  result: ResourceReadOutcomeType;
  duration_ms: number;
  request_id: string;
}

/**
 * Severity mapping per contracts/telemetry-resource-events.md.
 * Constitution XIII: severity matches actual error severity, no downgrading.
 */
export const SEVERITY_MAP: Record<
  ResourceReadOutcomeType,
  ResourceReadSeverityType
> = {
  success: 'info',
  document_not_found: 'warn',
  index_locked: 'warn',
  server_initializing: 'warn',
  error: 'error',
};

/**
 * Canonical MCP error codes for the four SP-002 resource error envelopes.
 * Inherited from `mcp-server.ts` SERVER_INITIALIZING_CODE for SP-001 parity.
 *
 * See contracts/mcp-resources-api.md §"Error contracts".
 */
export const MCP_ERROR_CODES = {
  server_initializing: -32002,
  document_not_found: -32010,
  index_locked: -32011,
} as const;

/**
 * Emit a `resource.read` telemetry event. Captures `timestamp` at emit;
 * derives `severity` from `result` per SEVERITY_MAP. Delegates to the
 * existing `emitTelemetry` helper from contracts.
 */
export async function emitResourceRead(
  input: EmitResourceReadInput,
): Promise<void> {
  await emitTelemetry({
    event: 'resource.read',
    timestamp: new Date().toISOString(),
    resource_uri: input.resource_uri,
    ...(input.doc_id !== undefined ? { doc_id: input.doc_id } : {}),
    result: input.result,
    duration_ms: input.duration_ms,
    request_id: input.request_id,
    severity: SEVERITY_MAP[input.result],
  });
}
