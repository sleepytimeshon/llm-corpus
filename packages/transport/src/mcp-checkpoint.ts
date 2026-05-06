// T052 — MCP checkpoint helper for the find-path (SC-008 partial).
// Source of truth: contracts/telemetry-egress-events.md §EgressCheckpointEvent
//
// SP-001 ships only the find-path. SP-003+ wires ingest/classify/embed/index
// stages, each calling their own emitCheckpoint helper.
//
// The helper proves the egress guard is installed-and-active for the find
// stage by emitting one `egress.checkpoint` event per find call.

import { emitCheckpoint } from '@llm-corpus/contracts/telemetry';
import { randomUUID } from 'node:crypto';

/**
 * Emit one `egress.checkpoint` event with `pipeline_stage: 'find'`. Called
 * from the find-path entry point (e.g., the `corpus.find` tool handler in
 * SP-005).
 *
 * Generates a fresh request_id when none is supplied so callers without
 * correlation tracking can still emit valid events.
 */
export async function emitFindCheckpoint(
  doc_id: string,
  request_id?: string,
): Promise<void> {
  await emitCheckpoint(doc_id, 'find', request_id ?? randomUUID());
}
