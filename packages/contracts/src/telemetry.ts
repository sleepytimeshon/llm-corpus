// T017 — Zod schemas + emit helper for the egress telemetry surface.
// Constitution V (schema-enforced output), IX (≤4 KB append atomicity),
// XIII (Telemetry-or-Die).
//
// Schemas mirror `specs/001-local-only-mcp-foundation/contracts/telemetry-egress-events.md`.

import { z } from 'zod';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Paths } from './paths.js';

const ISO8601 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const RequestId = z.string().uuid();
const DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);

export const Primitive = z.enum([
  'net.Socket.connect',
  'undici.Dispatcher',
  'dgram.send',
  'dns.lookup',
  'http2.connect',
  'tls.connect',
]);
export type PrimitiveType = z.infer<typeof Primitive>;

export const PipelineStage = z.enum([
  'ingest',
  'classify',
  'embed',
  'index',
  'find',
]);
export type PipelineStageType = z.infer<typeof PipelineStage>;

export const BlockedAt = z.enum([
  'in_process_hook',
  'os_firewall',
  'native_addon_allowlist',
]);
export type BlockedAtType = z.infer<typeof BlockedAt>;

export const EgressAttemptedEvent = z.object({
  event: z.literal('egress.attempted'),
  timestamp: ISO8601,
  primitive: Primitive,
  destination_host: z.string(),
  destination_port: z.number().int().min(0).max(65535),
  request_id: RequestId,
  doc_id: DocId.optional(),
});
export type EgressAttemptedEventType = z.infer<typeof EgressAttemptedEvent>;

export const EgressBlockedEvent = z.object({
  event: z.literal('egress.blocked'),
  timestamp: ISO8601,
  primitive: Primitive,
  destination_host: z.string(),
  destination_port: z.number().int().min(0).max(65535),
  result: z.literal('blocked'),
  blocked_at: BlockedAt,
  request_id: RequestId,
  doc_id: DocId.optional(),
});
export type EgressBlockedEventType = z.infer<typeof EgressBlockedEvent>;

export const EgressCheckpointEvent = z.object({
  event: z.literal('egress.checkpoint'),
  timestamp: ISO8601,
  doc_id: DocId,
  pipeline_stage: PipelineStage,
  request_id: RequestId,
});
export type EgressCheckpointEventType = z.infer<typeof EgressCheckpointEvent>;

// --- SP-002 — ResourceReadEvent (Constitution XIII per-read telemetry) ---
// References: contracts/telemetry-resource-events.md, data-model.md.

export const ResourceUri = z.enum([
  'corpus://manifest',
  'corpus://taxonomy',
  'corpus://recent',
  'corpus://docs/*', // template form — exact id lives in doc_id
]);
export type ResourceUriType = z.infer<typeof ResourceUri>;

export const ResourceReadOutcome = z.enum([
  'success',
  'document_not_found',
  'index_locked',
  'server_initializing',
  'error',
]);
export type ResourceReadOutcomeType = z.infer<typeof ResourceReadOutcome>;

export const ResourceReadSeverity = z.enum(['info', 'warn', 'error']);
export type ResourceReadSeverityType = z.infer<typeof ResourceReadSeverity>;

export const ResourceReadEvent = z.object({
  event: z.literal('resource.read'),
  timestamp: ISO8601,
  resource_uri: ResourceUri,
  doc_id: DocId.optional(),
  result: ResourceReadOutcome,
  duration_ms: z.number().int().nonnegative(),
  request_id: RequestId,
  severity: ResourceReadSeverity,
});
export type ResourceReadEventType = z.infer<typeof ResourceReadEvent>;

// --- Discriminated union (renamed in SP-002 — additive) ---

/**
 * The full telemetry-event discriminated union. SP-001 shipped this as
 * `EgressEvent` with three variants; SP-002 renames it and adds the
 * `resource.read` variant. The legacy `EgressEvent` name is exported below
 * as a deprecated alias so SP-001 callers continue to compile.
 */
export const TelemetryEvent = z.discriminatedUnion('event', [
  EgressAttemptedEvent,
  EgressBlockedEvent,
  EgressCheckpointEvent,
  ResourceReadEvent,
]);
export type TelemetryEventType = z.infer<typeof TelemetryEvent>;

/**
 * @deprecated Renamed to `TelemetryEvent` in SP-002. Imports of `EgressEvent`
 * continue to work — both names point at the same schema. Callers should
 * migrate to `TelemetryEvent` for clarity.
 */
export const EgressEvent = TelemetryEvent;
/** @deprecated use TelemetryEventType */
export type EgressEventType = TelemetryEventType;

/** POSIX PIPE_BUF on Linux. Append-atomic ceiling. */
export const TELEMETRY_MAX_BYTES = 4096;

export class TelemetrySizeExceededError extends Error {
  override readonly name = 'TelemetrySizeExceededError';
  constructor(
    readonly serializedLength: number,
    readonly limit: number = TELEMETRY_MAX_BYTES,
  ) {
    super(
      `Telemetry record (${serializedLength} bytes) exceeds ${limit}-byte append-atomic limit (Constitution IX).`,
    );
  }
}

export class TelemetryValidationError extends Error {
  override readonly name = 'TelemetryValidationError';
  constructor(
    readonly issue: z.ZodError,
  ) {
    super(`Telemetry event failed schema validation: ${issue.message}`);
  }
}

/**
 * Validate, serialize, and append an egress telemetry event to Paths.telemetry().
 *
 * Constitution IX: every record MUST be ≤ TELEMETRY_MAX_BYTES so `fs.appendFile`
 * with O_APPEND is atomic at the POSIX kernel level.
 *
 * Throws `TelemetryValidationError` if the event fails schema validation.
 * Throws `TelemetrySizeExceededError` if the serialized record exceeds the cap.
 */
export async function emitTelemetry(event: TelemetryEventType): Promise<void> {
  const parsed = TelemetryEvent.safeParse(event);
  if (!parsed.success) {
    throw new TelemetryValidationError(parsed.error);
  }
  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > TELEMETRY_MAX_BYTES) {
    throw new TelemetrySizeExceededError(serialized.length);
  }
  const targetFile = Paths.telemetry();
  await ensureDir(path.dirname(targetFile));
  await fsp.appendFile(targetFile, serialized + '\n', { flag: 'a' });
}

/** Synchronous variant — used by hot-path patches that cannot await. */
export function emitTelemetrySync(event: TelemetryEventType): void {
  const parsed = TelemetryEvent.safeParse(event);
  if (!parsed.success) {
    throw new TelemetryValidationError(parsed.error);
  }
  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > TELEMETRY_MAX_BYTES) {
    throw new TelemetrySizeExceededError(serialized.length);
  }
  const targetFile = Paths.telemetry();
  ensureDirSync(path.dirname(targetFile));
  fs.appendFileSync(targetFile, serialized + '\n', { flag: 'a' });
}

/**
 * Convenience helper used by pipeline-stage entry points to emit
 * `egress.checkpoint` proving the guard is registered for that stage
 * (Constitution XIII, SC-008 partial).
 */
export async function emitCheckpoint(
  doc_id: string,
  pipeline_stage: PipelineStageType,
  request_id: string,
): Promise<void> {
  await emitTelemetry({
    event: 'egress.checkpoint',
    timestamp: new Date().toISOString(),
    doc_id,
    pipeline_stage,
    request_id,
  });
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
