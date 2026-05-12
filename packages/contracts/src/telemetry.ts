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

// --- SP-003 — Ingest-pipeline event classes (14 additive variants) ----------
//
// References:
//   - specs/003-ingest-pipeline/plan.md PREREQ-003
//   - specs/003-ingest-pipeline/data-model.md §"Entity 10 — Telemetry Event"
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-009
//
// Shared envelope: `event`, `timestamp`, `severity`, `outcome`. Discriminator
// is `event` (consistent with SP-001/SP-002 union shape; the PILOT family's
// `event_class` discriminator lives in its own standalone union).
//
// String field bounds per data-model.md size-budget table — `message` is
// capped to 1024 chars, `file_path` to 4096 chars, so the worst-case
// `persist.failed` payload (longest variant) stays under Constitution IX's
// 4096-byte append-atomic limit when serialized as JSON. Total payload bound
// is enforced at emitTelemetry() time via TelemetrySizeExceededError.

const Sp003Severity = z.enum(['info', 'warn', 'error']);
const Sp003Outcome = z.enum([
  'success',
  'rejected',
  'deduplicated',
  'failed',
  'aborted',
]);
const Sp003Stage = z.enum(['validate', 'normalize', 'persist']);

const FilePath = z.string().max(4096);
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const Sp003DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);
const BoundedMessage = z.string().max(1024);

const Sp003MimeType = z.enum([
  'application/pdf',
  'text/markdown',
  'text/plain',
  'text/html',
]);

const Sp003ErrorCode = z.enum([
  'filename_sanity_failed',
  'mime_not_allowlisted',
  'mime_mismatch',
  'size_exceeded',
  'file_unstable',
  'extract_failed',
  'normalize_failed',
  'persist_failed',
  'telemetry_write_failed',
  'aborted',
]);

const FilenameSanityReason = z.enum([
  'null_byte',
  'path_traversal',
  'control_character',
  'zero_length',
]);

const WatcherLimitKind = z.enum(['inotify_watches', 'open_files', 'unknown']);

// ---- inbox.* validation-gate events ----

export const InboxAllowlistHitEvent = z.object({
  event: z.literal('inbox.allowlist_hit'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  mime_type: Sp003MimeType,
  size_bytes: z.number().int().nonnegative(),
});
export type InboxAllowlistHitEventType = z.infer<typeof InboxAllowlistHitEvent>;

export const InboxAllowlistMissEvent = z.object({
  event: z.literal('inbox.allowlist_miss'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  mime_type: z.string().max(256),
  error_code: z.literal('mime_not_allowlisted'),
});
export type InboxAllowlistMissEventType = z.infer<typeof InboxAllowlistMissEvent>;

export const InboxMimeMismatchEvent = z.object({
  event: z.literal('inbox.mime_mismatch'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  extension: z.string().max(32),
  detected_mime: z.string().max(256),
  error_code: z.literal('mime_mismatch'),
});
export type InboxMimeMismatchEventType = z.infer<typeof InboxMimeMismatchEvent>;

export const InboxSizeExceededEvent = z.object({
  event: z.literal('inbox.size_exceeded'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  size_bytes: z.number().int().nonnegative(),
  max_bytes: z.number().int().nonnegative(),
  error_code: z.literal('size_exceeded'),
});
export type InboxSizeExceededEventType = z.infer<typeof InboxSizeExceededEvent>;

export const InboxFilenameSanityFailedEvent = z.object({
  event: z.literal('inbox.filename_sanity_failed'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  error_code: z.literal('filename_sanity_failed'),
  reason: FilenameSanityReason,
});
export type InboxFilenameSanityFailedEventType = z.infer<
  typeof InboxFilenameSanityFailedEvent
>;

export const InboxWatcherResourceExhaustedEvent = z.object({
  event: z.literal('inbox.watcher_resource_exhausted'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  errno: z.string().max(32),
  limit_kind: WatcherLimitKind,
  message: BoundedMessage,
});
export type InboxWatcherResourceExhaustedEventType = z.infer<
  typeof InboxWatcherResourceExhaustedEvent
>;

// ---- ingest.* pipeline events ----

export const IngestDedupHitEvent = z.object({
  event: z.literal('ingest.dedup_hit'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  hash: Sha256Hex,
  existing_doc_id: Sp003DocId,
});
export type IngestDedupHitEventType = z.infer<typeof IngestDedupHitEvent>;

export const IngestDedupMissEvent = z.object({
  event: z.literal('ingest.dedup_miss'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  hash: Sha256Hex,
});
export type IngestDedupMissEventType = z.infer<typeof IngestDedupMissEvent>;

export const IngestNormalizedEvent = z.object({
  event: z.literal('ingest.normalized'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  doc_id: Sp003DocId,
  mime_type: Sp003MimeType,
  body_path: z.string().max(4096),
});
export type IngestNormalizedEventType = z.infer<typeof IngestNormalizedEvent>;

export const IngestCompletedEvent = z.object({
  event: z.literal('ingest.completed'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  doc_id: Sp003DocId,
  hash: Sha256Hex,
  duration_ms: z.number().int().nonnegative(),
  mime_type: Sp003MimeType,
});
export type IngestCompletedEventType = z.infer<typeof IngestCompletedEvent>;

export const IngestFileUnstableEvent = z.object({
  event: z.literal('ingest.file_unstable'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  error_code: z.literal('file_unstable'),
  stat_before: z.number().int().nonnegative(),
  stat_after: z.number().int().nonnegative(),
});
export type IngestFileUnstableEventType = z.infer<typeof IngestFileUnstableEvent>;

export const IngestAbortedEvent = z.object({
  event: z.literal('ingest.aborted'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  doc_id: Sp003DocId.optional(),
  stage: Sp003Stage,
});
export type IngestAbortedEventType = z.infer<typeof IngestAbortedEvent>;

// ---- pipeline / persist events ----

export const PipelineLockContentionEvent = z.object({
  event: z.literal('pipeline.lock_contention'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  lock_path: z.string().max(4096),
  requesting_pid: z.number().int().nonnegative(),
});
export type PipelineLockContentionEventType = z.infer<
  typeof PipelineLockContentionEvent
>;

export const PersistFailedEvent = z.object({
  event: z.literal('persist.failed'),
  timestamp: ISO8601,
  severity: Sp003Severity,
  outcome: Sp003Outcome,
  file_path: FilePath,
  error_code: Sp003ErrorCode,
  message: BoundedMessage,
  stage: Sp003Stage,
});
export type PersistFailedEventType = z.infer<typeof PersistFailedEvent>;

// Re-export error_code enum so consumers (e.g., sidecar writer) bind against
// the same closed set.
export const Sp003ErrorCodeEnum = Sp003ErrorCode;
export type Sp003ErrorCodeType = z.infer<typeof Sp003ErrorCode>;

// --- Discriminated union (renamed in SP-002 — additive) ---

/**
 * The full telemetry-event discriminated union. SP-001 shipped this as
 * `EgressEvent` with three variants; SP-002 renames it and adds the
 * `resource.read` variant. SP-003 (PREREQ-003) extends it additively with
 * 14 ingest-pipeline event classes. The legacy `EgressEvent` name is
 * exported below as a deprecated alias so SP-001 callers continue to compile.
 */
export const TelemetryEvent = z.discriminatedUnion('event', [
  EgressAttemptedEvent,
  EgressBlockedEvent,
  EgressCheckpointEvent,
  ResourceReadEvent,
  // SP-003 additions:
  InboxAllowlistHitEvent,
  InboxAllowlistMissEvent,
  InboxMimeMismatchEvent,
  InboxSizeExceededEvent,
  InboxFilenameSanityFailedEvent,
  InboxWatcherResourceExhaustedEvent,
  IngestDedupHitEvent,
  IngestDedupMissEvent,
  IngestNormalizedEvent,
  IngestCompletedEvent,
  IngestFileUnstableEvent,
  IngestAbortedEvent,
  PipelineLockContentionEvent,
  PersistFailedEvent,
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

// --- PREREQ-002 (SP-000-lite) — nfr_008_pilot event class ---------------------
//
// Standalone event family, distinct from the SP-001/SP-002 egress + resource
// union. Discriminator is `event_class` (not `event`) per the FR-PILOT-005
// envelope convention. The pilot harness emits one of these per query turn to
// `Paths.pilotTelemetry()/pilot-iter{N}.jsonl`.
//
// References:
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-005
//   - Architect AUDIT-001: retrieval_outcome capped at 1024 chars
//   - Constitution Principle XIII (schema-enforced telemetry)

export const PilotSeverity = z.enum(['info', 'warn', 'error']);
export type PilotSeverityType = z.infer<typeof PilotSeverity>;

export const PilotQueryBucket = z.enum([
  'knowledge_grounded',
  'general',
  'adversarial',
]);
export type PilotQueryBucketType = z.infer<typeof PilotQueryBucket>;

export const PilotRetrievalPattern = z.enum([
  'factual_lookup',
  'recall_by_context',
  'multi_doc_synthesis',
]);
export type PilotRetrievalPatternType = z.infer<typeof PilotRetrievalPattern>;

export const NfrPilotEvent = z.object({
  event_class: z.literal('nfr_008_pilot'),
  severity: PilotSeverity,
  timestamp: ISO8601,
  run_id: z.string().uuid(),
  iteration: z.union([z.literal(1), z.literal(2)]),
  model: z.literal('qwen3:8b'),
  prompt_variant: z.string(),
  query_id: z.string(),
  query_bucket: PilotQueryBucket,
  retrieval_pattern: PilotRetrievalPattern.nullable(),
  tool_invoked: z.boolean(),
  tool_arguments_valid: z.boolean(),
  malformed_call_payload: z.string().max(2048).nullable(),
  retrieval_outcome: z.string().max(1024),
  duration_ms: z.number().int().nonnegative(),
});
export type NfrPilotEventType = z.infer<typeof NfrPilotEvent>;

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
