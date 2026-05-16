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
  'corpus://failures', // SP-006 — Phase 4 carry-forward (Engineer #5)
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

// --- SP-004 — Classifier-stage event classes (11 additive variants) ---------
//
// References:
//   - specs/004-classifier/plan.md PREREQ-002
//   - specs/004-classifier/data-model.md §"Entity 6 — ClassifyTelemetryEvent"
//   - specs/004-classifier/spec.md FR-CLASSIFY-010
//   - Constitution Principle V (schema-enforced) + IX (≤ 4096 bytes)
//     + XIII (Telemetry-or-Die)
//
// Shared envelope: `event`, `timestamp`, `severity`, `outcome`. Discriminator
// is `event` (consistent with SP-001/SP-002/SP-003 union shape).
//
// String field bounds per data-model.md §"Entity 6" size-budget table —
// `message` capped at 1024 chars, `offending_value` / `term` capped at 256,
// `validation_errors` capped at 5 × 256-char strings. The worst plausible
// payload (`classify.schema_invalid` with full payload) stays under
// Constitution IX's 4096-byte append-atomic limit.

const Sp004Severity = z.enum(['info', 'warn', 'error']);
const Sp004Outcome = z.enum([
  'success',
  'rejected',
  'deduplicated',
  'failed',
  'aborted',
]);

const Sp004DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);
const Sp004BoundedMessage = z.string().max(1024);
const Sp004BoundedShortString = z.string().max(256);

const Sp004ModelName = z.string().max(128);
const Sp004FacetTypeEnum = z.enum([
  'entity',
  'concept',
  'tutorial',
  'analysis',
  'reference',
  'synthesis',
  'cheat-sheet',
]);
const Sp004ProposedAxis = z.enum(['domain', 'tag']);
const Sp004OffendingField = z.enum(['facet_domain', 'facet_type', 'tag']);
const Sp004ClassifyErrorCode = z.enum([
  'ollama_unavailable',
  'schema_invalid',
  'vocabulary_violation',
  'classify_aborted',
  'persist_failed',
  'telemetry_write_failed',
  'frontmatter_rewrite_failed',
]);
const Sp004ProposedOutcome = z.enum(['inserted', 'conflicted']);

const Sp004Confidence = z
  .object({
    domain: z.number().min(0).max(1),
    type: z.number().min(0).max(1),
    tags: z.number().min(0).max(1),
  })
  .strict();

export const ClassifyStartedEvent = z.object({
  event: z.literal('classify.started'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  model_name: Sp004ModelName,
  vocabulary_snapshot_id: z.string().uuid(),
});
export type ClassifyStartedEventType = z.infer<typeof ClassifyStartedEvent>;

export const ClassifyOllamaRequestEvent = z.object({
  event: z.literal('classify.ollama_request'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  model_name: Sp004ModelName,
  prompt_token_estimate: z.number().int().nonnegative(),
  schema_field_count: z.number().int().nonnegative(),
});
export type ClassifyOllamaRequestEventType = z.infer<
  typeof ClassifyOllamaRequestEvent
>;

export const ClassifyOllamaResponseEvent = z.object({
  event: z.literal('classify.ollama_response'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  response_token_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
});
export type ClassifyOllamaResponseEventType = z.infer<
  typeof ClassifyOllamaResponseEvent
>;

export const ClassifySchemaInvalidEvent = z.object({
  event: z.literal('classify.schema_invalid'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  validation_errors: z.array(Sp004BoundedShortString).max(5),
});
export type ClassifySchemaInvalidEventType = z.infer<
  typeof ClassifySchemaInvalidEvent
>;

export const ClassifyVocabularyViolationEvent = z.object({
  event: z.literal('classify.vocabulary_violation'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  offending_field: Sp004OffendingField,
  offending_value: Sp004BoundedShortString,
  established_count: z.number().int().nonnegative(),
});
export type ClassifyVocabularyViolationEventType = z.infer<
  typeof ClassifyVocabularyViolationEvent
>;

export const ClassifyTermProposedEvent = z.object({
  event: z.literal('classify.term_proposed'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  axis: Sp004ProposedAxis,
  term: Sp004BoundedShortString,
  inserted_or_conflicted: Sp004ProposedOutcome,
});
export type ClassifyTermProposedEventType = z.infer<
  typeof ClassifyTermProposedEvent
>;

export const ClassifyCompletedEvent = z.object({
  event: z.literal('classify.completed'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  facet_domain: Sp004BoundedShortString,
  facet_type: Sp004FacetTypeEnum,
  tag_count: z.number().int().min(3).max(10),
  confidence_summary: Sp004Confidence,
  retry_count: z.number().int().min(0).max(1),
  duration_ms: z.number().int().nonnegative(),
});
export type ClassifyCompletedEventType = z.infer<typeof ClassifyCompletedEvent>;

export const ClassifyFailedEvent = z.object({
  event: z.literal('classify.failed'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  error_code: Sp004ClassifyErrorCode,
  message: Sp004BoundedMessage,
  stage: z.literal('classify'),
});
export type ClassifyFailedEventType = z.infer<typeof ClassifyFailedEvent>;

export const ClassifyOllamaUnavailableEvent = z.object({
  event: z.literal('classify.ollama_unavailable'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId.optional(),
  errno: z.string().max(32),
  message: Sp004BoundedMessage,
});
export type ClassifyOllamaUnavailableEventType = z.infer<
  typeof ClassifyOllamaUnavailableEvent
>;

export const ClassifyBatchHaltedEvent = z.object({
  event: z.literal('classify.batch_halted'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  consecutive_failures: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  last_error_code: Sp004ClassifyErrorCode,
});
export type ClassifyBatchHaltedEventType = z.infer<
  typeof ClassifyBatchHaltedEvent
>;

export const ClassifyFrontmatterIncompleteEvent = z.object({
  event: z.literal('classify.frontmatter_incomplete'),
  timestamp: ISO8601,
  severity: Sp004Severity,
  outcome: Sp004Outcome,
  doc_id: Sp004DocId,
  missing_fields: z.array(z.string().max(64)).max(5),
});
export type ClassifyFrontmatterIncompleteEventType = z.infer<
  typeof ClassifyFrontmatterIncompleteEvent
>;

// Re-export SP-004 error_code enum so consumers (sidecar writer, classify
// stage error handler) bind against the same closed set.
export const Sp004ClassifyErrorCodeEnum = Sp004ClassifyErrorCode;
export type Sp004ClassifyErrorCodeType = z.infer<typeof Sp004ClassifyErrorCode>;

// --- SP-005 — Retrieval-stage event classes (14 additive variants) ----------
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-013, FR-RETRIEVAL-023
//   - specs/005-retrieval/data-model.md §"Entity 5 — RetrievalTelemetryEvent"
//   - Constitution Principle V (schema-enforced) + IX (≤ 4096 bytes)
//     + XIII (Telemetry-or-Die)
//
// Shared envelope: `event`, `timestamp`, `severity`, `outcome`. Discriminator
// is `event` (consistent with SP-001/SP-002/SP-003/SP-004 union shape).

const Sp005Severity = z.enum(['info', 'warn', 'error']);
const Sp005Outcome = z.enum([
  'success',
  'rejected',
  'deduplicated',
  'failed',
  'aborted',
]);
const Sp005DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);
const Sp005BoundedMessage = z.string().max(1024);
const Sp005BoundedShortString = z.string().max(256);
const Sp005ModelName = z.string().max(128);
const Sp005QueryHash = z.string().regex(/^[0-9a-f]{64}$/);
const Sp005SignalName = z.enum(['bm25', 'dense', 'graph', 'confidence']);

const Sp005EmbedErrorCode = z.enum([
  'embedding_unavailable',
  'embedding_dimension_mismatch',
  'embedding_validation_failed',
  'embed_aborted',
]);
const Sp005IndexErrorCode = z.enum([
  'persist_failed',
  'index_unavailable',
  'index_aborted',
]);
const Sp005EdgesErrorCode = z.enum([
  'edges_build_timeout',
  'invalid_explicit_related_target',
  'edges_aborted',
  'persist_failed',
]);
const Sp005SearchErrorCode = z.enum([
  'validation_error',
  'embedding_unavailable',
  'index_unavailable',
  'query_aborted',
  'all_signals_failed',
  'internal_error',
]);

// ---- embed.* events ----

export const EmbedStartedEvent = z.object({
  event: z.literal('embed.started'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  model_name: Sp005ModelName,
  input_token_estimate: z.number().int().nonnegative(),
});
export type EmbedStartedEventType = z.infer<typeof EmbedStartedEvent>;

export const EmbedCompletedEvent = z.object({
  event: z.literal('embed.completed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  model_name: Sp005ModelName,
  dimension: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
});
export type EmbedCompletedEventType = z.infer<typeof EmbedCompletedEvent>;

export const EmbedFailedEvent = z.object({
  event: z.literal('embed.failed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId.optional(),
  model_name: Sp005ModelName,
  error_code: Sp005EmbedErrorCode,
  message: Sp005BoundedMessage,
});
export type EmbedFailedEventType = z.infer<typeof EmbedFailedEvent>;

// ---- index.* events ----

export const IndexStartedEvent = z.object({
  event: z.literal('index.started'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  body_excerpt_word_count: z.number().int().nonnegative(),
  frontmatter_fields_present: z.array(z.string().max(64)).max(6),
});
export type IndexStartedEventType = z.infer<typeof IndexStartedEvent>;

export const IndexCompletedEvent = z.object({
  event: z.literal('index.completed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  fts5_inserted: z.boolean(),
  vec_inserted: z.boolean(),
  duration_ms: z.number().int().nonnegative(),
});
export type IndexCompletedEventType = z.infer<typeof IndexCompletedEvent>;

export const IndexFailedEvent = z.object({
  event: z.literal('index.failed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  error_code: Sp005IndexErrorCode,
  message: Sp005BoundedMessage,
});
export type IndexFailedEventType = z.infer<typeof IndexFailedEvent>;

// ---- edges.* events ----

export const EdgesStartedEvent = z.object({
  event: z.literal('edges.started'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  candidate_pool_size: z.number().int().nonnegative(),
});
export type EdgesStartedEventType = z.infer<typeof EdgesStartedEvent>;

export const EdgesCompletedEvent = z.object({
  event: z.literal('edges.completed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  tag_overlap_count: z.number().int().nonnegative(),
  summary_similarity_count: z.number().int().nonnegative(),
  explicit_related_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
});
export type EdgesCompletedEventType = z.infer<typeof EdgesCompletedEvent>;

export const EdgesFailedEvent = z.object({
  event: z.literal('edges.failed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id: Sp005DocId,
  error_code: Sp005EdgesErrorCode,
  message: Sp005BoundedMessage,
});
export type EdgesFailedEventType = z.infer<typeof EdgesFailedEvent>;

// ---- search.* events ----

export const SearchStartedEvent = z.object({
  event: z.literal('search.started'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  query_hash: Sp005QueryHash,
  has_filters: z.boolean(),
  limit: z.number().int().min(1).max(100),
});
export type SearchStartedEventType = z.infer<typeof SearchStartedEvent>;

// SP-006 PREREQ-002: tier_used widened from z.literal('hybrid') to the
// four-tier enum so the SP-006 tier-orchestrator can label per-tier events
// with the actual tier that produced them. SP-005 callers that emit
// `tier_used: 'hybrid'` continue to validate.
const Sp005TierUsedEnum = z.enum([
  'hybrid',
  'bm25-only',
  'catalog-grep',
  'fs-grep',
]);

export const SearchQueryEvent = z.object({
  event: z.literal('search.query'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  query_hash: Sp005QueryHash,
  tier_used: Sp005TierUsedEnum,
  result_count: z.number().int().nonnegative(),
  signals_used: z.array(Sp005SignalName),
  duration_ms: z.number().int().nonnegative(),
});
export type SearchQueryEventType = z.infer<typeof SearchQueryEvent>;

export const SearchCompletedEvent = z.object({
  event: z.literal('search.completed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  query_hash: Sp005QueryHash,
  result_count: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  // SP-006 PREREQ-002: tier_used + signals_used added per data-model Entity 4.
  // Optional with defaults so SP-005 emitters that only set the legacy three
  // fields continue to validate; SP-006-aware emitters populate them.
  tier_used: Sp005TierUsedEnum.optional(),
  signals_used: z.array(Sp005SignalName).optional(),
});
export type SearchCompletedEventType = z.infer<typeof SearchCompletedEvent>;

export const SearchDegradedEvent = z.object({
  event: z.literal('search.degraded'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  query_hash: Sp005QueryHash,
  degraded_signals: z.array(Sp005SignalName).min(1),
  error_codes: z.array(Sp005BoundedShortString).max(4),
});
export type SearchDegradedEventType = z.infer<typeof SearchDegradedEvent>;

export const SearchErrorEvent = z.object({
  event: z.literal('search.error'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  query_hash: Sp005QueryHash.optional(),
  error_code: Sp005SearchErrorCode,
  message: Sp005BoundedMessage,
});
export type SearchErrorEventType = z.infer<typeof SearchErrorEvent>;

// Constitution XIII (Telemetry-or-Die): snippet enrichment is a secondary
// step after hybrid retrieval succeeds. FTS5 read failure during snippet
// load is a partial-outcome warning (the search itself returned hits with
// valid scores; only display text fell back to empty strings).
export const SearchSnippetFetchFailedEvent = z.object({
  event: z.literal('search.snippet_fetch_failed'),
  timestamp: ISO8601,
  severity: Sp005Severity,
  outcome: Sp005Outcome,
  doc_id_count: z.number().int().nonnegative(),
  message: Sp005BoundedMessage,
});
export type SearchSnippetFetchFailedEventType = z.infer<
  typeof SearchSnippetFetchFailedEvent
>;

// Re-export SP-005 error_code enums so consumers bind against the same set.
export const Sp005EmbedErrorCodeEnum = Sp005EmbedErrorCode;
export type Sp005EmbedErrorCodeType = z.infer<typeof Sp005EmbedErrorCode>;
export const Sp005IndexErrorCodeEnum = Sp005IndexErrorCode;
export type Sp005IndexErrorCodeType = z.infer<typeof Sp005IndexErrorCode>;
export const Sp005EdgesErrorCodeEnum = Sp005EdgesErrorCode;
export type Sp005EdgesErrorCodeType = z.infer<typeof Sp005EdgesErrorCode>;
export const Sp005SearchErrorCodeEnum = Sp005SearchErrorCode;
export type Sp005SearchErrorCodeType = z.infer<typeof Sp005SearchErrorCode>;

// --- SP-006 — Production-hardening event classes (14 additive variants) ----
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-005, FR-HARDEN-019
//   - specs/006-hardening/data-model.md §"Entity 4" + §"Entity 5"
//   - Constitution Principles I, V, IX, XIII
//
// Shared envelope: `event`, `timestamp`, `severity`, `outcome`. Discriminator
// is `event` (consistent with SP-001..SP-005 union shape).
//
// Spec-drift note: SP-006 tasks.md T003/T010 said "13"; data-model.md plus
// failures.sidecar_parse_failed enumerate 14. Implemented as 14.

const Sp006Severity = z.enum(['info', 'warn', 'error']);
const Sp006Outcome = z.enum([
  'success',
  'rejected',
  'deduplicated',
  'failed',
  'aborted',
]);
const Sp006DocId = z.string().regex(/^doc-[0-9a-f]{8}$/);

const Sp006RecoveryStage = z.enum([
  'ingest',
  'classify',
  'embed',
  'index',
  'edges-build',
]);

const Sp006TierEnum = z.enum([
  'hybrid',
  'bm25-only',
  'catalog-grep',
  'fs-grep',
]);

const Sp006FromTier = z.enum(['hybrid', 'bm25-only', 'catalog-grep']);
const Sp006ToTier = z.enum(['bm25-only', 'catalog-grep', 'fs-grep']);
const Sp006SkippedTier = z.enum(['catalog-grep', 'fs-grep']);
const Sp006BoundedMessage = z.string().max(1024);
const Sp006SidecarPath = z.string().max(4096);

// ---- 9 recovery.* events ----

export const RecoveryScanStartedEvent = z.object({
  event: z.literal('recovery.scan_started'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  daemon_session_start_ts: ISO8601.nullable(),
});
export type RecoveryScanStartedEventType = z.infer<
  typeof RecoveryScanStartedEvent
>;

export const RecoveryScanCompletedEvent = z.object({
  event: z.literal('recovery.scan_completed'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  duration_ms: z.number().int().nonnegative(),
  resumed_count: z.number().int().nonnegative(),
  aborted_count: z.number().int().nonnegative(),
  daemon_session_start_ts: ISO8601.nullable(),
});
export type RecoveryScanCompletedEventType = z.infer<
  typeof RecoveryScanCompletedEvent
>;

export const RecoveryScanSkippedEvent = z.object({
  event: z.literal('recovery.scan_skipped'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  reason: z.enum(['no_prior_session', 'lock_contention']),
});
export type RecoveryScanSkippedEventType = z.infer<
  typeof RecoveryScanSkippedEvent
>;

export const RecoveryScanReentryEvent = z.object({
  event: z.literal('recovery.scan_reentry'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  prior_scan_start_ts: ISO8601,
});
export type RecoveryScanReentryEventType = z.infer<
  typeof RecoveryScanReentryEvent
>;

export const RecoveryOrphanFoundEvent = z.object({
  event: z.literal('recovery.orphan_found'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  doc_id: Sp006DocId.nullable(),
  stage: Sp006RecoveryStage,
  started_ts: ISO8601,
});
export type RecoveryOrphanFoundEventType = z.infer<
  typeof RecoveryOrphanFoundEvent
>;

export const RecoveryResumedEvent = z.object({
  event: z.literal('recovery.resumed'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  doc_id: Sp006DocId,
  stage: Sp006RecoveryStage,
});
export type RecoveryResumedEventType = z.infer<typeof RecoveryResumedEvent>;

export const RecoveryAbortedEvent = z.object({
  event: z.literal('recovery.aborted'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  doc_id: Sp006DocId.nullable(),
  stage: Sp006RecoveryStage,
  reason: Sp006BoundedMessage,
});
export type RecoveryAbortedEventType = z.infer<typeof RecoveryAbortedEvent>;

export const RecoveryTelemetryParseFailedEvent = z.object({
  event: z.literal('recovery.telemetry_parse_failed'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  line_offset: z.number().int().nonnegative(),
  error: Sp006BoundedMessage,
});
export type RecoveryTelemetryParseFailedEventType = z.infer<
  typeof RecoveryTelemetryParseFailedEvent
>;

export const RecoveryAbortedScanEvent = z.object({
  event: z.literal('recovery.aborted_scan'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  reason: z.enum(['abort_signal', 'timeout']),
});
export type RecoveryAbortedScanEventType = z.infer<
  typeof RecoveryAbortedScanEvent
>;

// ---- 1 failures.sidecar_parse_failed event ----

export const FailuresSidecarParseFailedEvent = z.object({
  event: z.literal('failures.sidecar_parse_failed'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  sidecar_path: Sp006SidecarPath,
  error: Sp006BoundedMessage,
});
export type FailuresSidecarParseFailedEventType = z.infer<
  typeof FailuresSidecarParseFailedEvent
>;

// ---- 4 search.tier_* events ----

export const SearchTierFallthroughEvent = z.object({
  event: z.literal('search.tier_fallthrough'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  from_tier: Sp006FromTier,
  to_tier: Sp006ToTier,
  reason: z.enum(['below_min_results', 'tier_failed']),
  hits_before_fallthrough: z.number().int().nonnegative(),
});
export type SearchTierFallthroughEventType = z.infer<
  typeof SearchTierFallthroughEvent
>;

export const SearchTierSkippedEvent = z.object({
  event: z.literal('search.tier_skipped'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  tier: Sp006SkippedTier,
  reason: z.enum(['catalog_missing', 'grep_unavailable']),
});
export type SearchTierSkippedEventType = z.infer<typeof SearchTierSkippedEvent>;

export const SearchTierFailedEvent = z.object({
  event: z.literal('search.tier_failed'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  tier: Sp006TierEnum,
  errno: z.string().max(32).optional(),
  error_code: z.string().max(128).optional(),
  duration_ms: z.number().int().nonnegative(),
});
export type SearchTierFailedEventType = z.infer<typeof SearchTierFailedEvent>;

export const SearchTierBudgetExceededEvent = z.object({
  event: z.literal('search.tier_budget_exceeded'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  budget_ms: z.number().int().nonnegative(),
  actual_ms: z.number().int().nonnegative(),
  tiers_attempted: z.array(Sp006TierEnum),
  final_hit_count: z.number().int().nonnegative(),
});
export type SearchTierBudgetExceededEventType = z.infer<
  typeof SearchTierBudgetExceededEvent
>;

// Re-export the SP-006 tier enum so downstream packages bind to it.
export const Sp006TierEnumSchema = Sp006TierEnum;
export type Sp006TierEnumType = z.infer<typeof Sp006TierEnum>;

// ---- 1 daemon.started session-boundary marker ----
//
// SP-006 FR-HARDEN-001 / FR-HARDEN-004: the recovery scanner uses
// `daemon.started` as the prior-session boundary. Emitted by the daemon's
// `startDaemon()` entry point BEFORE the recovery scanner runs. Bounded
// payload: just the pid for diagnostics.
export const DaemonStartedEvent = z.object({
  event: z.literal('daemon.started'),
  timestamp: ISO8601,
  severity: Sp006Severity,
  outcome: Sp006Outcome,
  pid: z.number().int().nonnegative(),
});
export type DaemonStartedEventType = z.infer<typeof DaemonStartedEvent>;

// --- SP-007 — Install / uninstall / taxonomy-promote event classes (12) ----
//
// References:
//   - specs/007-install-first-run/spec.md FR-INSTALL-021, SC-007-033
//   - specs/007-install-first-run/data-model.md §"Entity 7 — InstallTelemetry"
//   - Constitution Principles I, V, IX, XIII
//
// Shared envelope: `event`, `timestamp`, `severity`, `outcome`. Discriminator
// is `event` (consistent with SP-001..SP-006 union shape).
//
// SP-007 uses its own severity / outcome enums to match data-model.md exactly
// (`severity: 'info' | 'warning' | 'error'`; `outcome: 'success' | 'failure'`).
// The pre-existing SP-001..SP-006 events keep their own enum variants — Zod
// discriminated unions allow each variant to declare independent fields.
//
// Spec-drift note: SP-007 data-model.md spells severity `'warning'` and
// outcome `'failure'` (vs SP-001..SP-006 which spell them `'warn'` and
// `'failed'`). SP-007 adopts the data-model spellings verbatim; downstream
// emitters use the SP-007 enums.

const Sp007Severity = z.enum(['info', 'warning', 'error']);
const Sp007Outcome = z.enum(['success', 'failure']);

const Sp007InstallStep = z.enum([
  'preflight',
  'idempotency_check',
  'xdg_bringup',
  'sqlite_singlefile',
  'config_toml',
  'taxonomy_seed',
  'mcp_client_config',
  'firewall_provision',
  'auto_start_unit',
  'install_receipt',
  'next_step_output',
]);

const Sp007UninstallStep = z.enum([
  'preflight',
  'mcp_client_config_reverse',
  'firewall_reverse',
  'auto_start_unit_reverse',
  'xdg_subtree_purge',
  'receipt_finalize',
]);

const Sp007PreflightUnmet = z.enum([
  'node_version',
  'ollama_reachability',
  'ollama_models',
  'xdg_writable',
  'partial_install',
]);

const Sp007UninstallPreflightUnmet = z.enum([
  'receipt_missing',
  'receipt_malformed',
  'platform_mismatch',
]);

const Sp007SmokeFailureStep = z.enum([
  'daemon_spawn',
  'seed_traversal_timeout',
  'mcp_spawn',
  'corpus_find_zero_hits',
  'teardown',
]);

const Sp007InstalledVia = z.enum(['npx', 'global', 'local']);
const Sp007Os = z.enum(['macos', 'linux']);
const Sp007Axis = z.enum(['domain', 'type', 'tag', 'source_type']);

const Sp007BoundedShortString = z.string().max(256);

// ---- install.* (6 classes) ----

export const InstallPreflightFailedEvent = z.object({
  event: z.literal('install.preflight_failed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  unmet_requirement: Sp007PreflightUnmet,
  details: z
    .object({
      node_version: z.string().max(64).optional(),
      missing_models: z.array(Sp007BoundedShortString).max(8).optional(),
      partial_install_paths: z.array(z.string().max(4096)).max(32).optional(),
    })
    .strict()
    .optional(),
});
export type InstallPreflightFailedEventType = z.infer<
  typeof InstallPreflightFailedEvent
>;

export const InstallStepFailedEvent = z.object({
  event: z.literal('install.step_failed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  step: Sp007InstallStep,
  duration_ms: z.number().int().nonnegative(),
  error_code: Sp007BoundedShortString,
});
export type InstallStepFailedEventType = z.infer<typeof InstallStepFailedEvent>;

export const InstallCompletedEvent = z.object({
  event: z.literal('install.completed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  duration_ms: z.number().int().nonnegative(),
  installed_via: Sp007InstalledVia,
  os: Sp007Os,
  steps_skipped: z.array(Sp007BoundedShortString).max(16),
});
export type InstallCompletedEventType = z.infer<typeof InstallCompletedEvent>;

export const InstallSmokeStartedEvent = z.object({
  event: z.literal('install.smoke_started'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  seed_doc_path: z.string().max(4096),
});
export type InstallSmokeStartedEventType = z.infer<
  typeof InstallSmokeStartedEvent
>;

export const InstallSmokeCompletedEvent = z.object({
  event: z.literal('install.smoke_completed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  duration_ms: z.number().int().nonnegative(),
  hits_returned: z.number().int().nonnegative(),
});
export type InstallSmokeCompletedEventType = z.infer<
  typeof InstallSmokeCompletedEvent
>;

export const InstallSmokeFailedEvent = z.object({
  event: z.literal('install.smoke_failed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  duration_ms: z.number().int().nonnegative(),
  failure_step: Sp007SmokeFailureStep,
  error_code: Sp007BoundedShortString,
});
export type InstallSmokeFailedEventType = z.infer<
  typeof InstallSmokeFailedEvent
>;

// ---- uninstall.* (3 classes) ----

export const UninstallPreflightFailedEvent = z.object({
  event: z.literal('uninstall.preflight_failed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  unmet_requirement: Sp007UninstallPreflightUnmet,
  details: z
    .object({
      receipt_path: z.string().max(4096).optional(),
      install_os: z.string().max(64).optional(),
      current_os: z.string().max(64).optional(),
    })
    .strict()
    .optional(),
});
export type UninstallPreflightFailedEventType = z.infer<
  typeof UninstallPreflightFailedEvent
>;

export const UninstallStepFailedEvent = z.object({
  event: z.literal('uninstall.step_failed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  step: Sp007UninstallStep,
  duration_ms: z.number().int().nonnegative(),
  error_code: Sp007BoundedShortString,
});
export type UninstallStepFailedEventType = z.infer<
  typeof UninstallStepFailedEvent
>;

export const UninstallCompletedEvent = z.object({
  event: z.literal('uninstall.completed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  duration_ms: z.number().int().nonnegative(),
  purged: z.boolean(),
});
export type UninstallCompletedEventType = z.infer<
  typeof UninstallCompletedEvent
>;

// ---- taxonomy.* (3 classes) ----

export const TaxonomyPromoteCompletedEvent = z.object({
  event: z.literal('taxonomy.promote_completed'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  axis: Sp007Axis,
  term: Sp007BoundedShortString,
  was_already_established: z.boolean(),
});
export type TaxonomyPromoteCompletedEventType = z.infer<
  typeof TaxonomyPromoteCompletedEvent
>;

export const TaxonomyPromoteLockContentionEvent = z.object({
  event: z.literal('taxonomy.promote_lock_contention'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  lock_holder_hint: Sp007BoundedShortString.optional(),
});
export type TaxonomyPromoteLockContentionEventType = z.infer<
  typeof TaxonomyPromoteLockContentionEvent
>;

export const TaxonomyPromoteMissingTermEvent = z.object({
  event: z.literal('taxonomy.promote_missing_term'),
  timestamp: ISO8601,
  severity: Sp007Severity,
  outcome: Sp007Outcome,
  axis: Sp007Axis,
  term: Sp007BoundedShortString,
});
export type TaxonomyPromoteMissingTermEventType = z.infer<
  typeof TaxonomyPromoteMissingTermEvent
>;

// Re-export the SP-007 step + severity enums so downstream packages bind to
// the same closed set.
export const Sp007InstallStepEnum = Sp007InstallStep;
export type Sp007InstallStepType = z.infer<typeof Sp007InstallStep>;
export const Sp007UninstallStepEnum = Sp007UninstallStep;
export type Sp007UninstallStepType = z.infer<typeof Sp007UninstallStep>;
export const Sp007PreflightUnmetEnum = Sp007PreflightUnmet;
export type Sp007PreflightUnmetType = z.infer<typeof Sp007PreflightUnmet>;
export const Sp007UninstallPreflightUnmetEnum = Sp007UninstallPreflightUnmet;
export type Sp007UninstallPreflightUnmetType = z.infer<
  typeof Sp007UninstallPreflightUnmet
>;
export const Sp007SmokeFailureStepEnum = Sp007SmokeFailureStep;
export type Sp007SmokeFailureStepType = z.infer<typeof Sp007SmokeFailureStep>;

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
  // SP-004 additions (11 classify-stage event classes):
  ClassifyStartedEvent,
  ClassifyOllamaRequestEvent,
  ClassifyOllamaResponseEvent,
  ClassifySchemaInvalidEvent,
  ClassifyVocabularyViolationEvent,
  ClassifyTermProposedEvent,
  ClassifyCompletedEvent,
  ClassifyFailedEvent,
  ClassifyOllamaUnavailableEvent,
  ClassifyBatchHaltedEvent,
  ClassifyFrontmatterIncompleteEvent,
  // SP-005 additions (14 retrieval-stage event classes):
  EmbedStartedEvent,
  EmbedCompletedEvent,
  EmbedFailedEvent,
  IndexStartedEvent,
  IndexCompletedEvent,
  IndexFailedEvent,
  EdgesStartedEvent,
  EdgesCompletedEvent,
  EdgesFailedEvent,
  SearchStartedEvent,
  SearchQueryEvent,
  SearchCompletedEvent,
  SearchDegradedEvent,
  SearchErrorEvent,
  SearchSnippetFetchFailedEvent,
  // SP-006 additions (14 production-hardening event classes):
  RecoveryScanStartedEvent,
  RecoveryScanCompletedEvent,
  RecoveryScanSkippedEvent,
  RecoveryScanReentryEvent,
  RecoveryOrphanFoundEvent,
  RecoveryResumedEvent,
  RecoveryAbortedEvent,
  RecoveryTelemetryParseFailedEvent,
  RecoveryAbortedScanEvent,
  FailuresSidecarParseFailedEvent,
  SearchTierFallthroughEvent,
  SearchTierSkippedEvent,
  SearchTierFailedEvent,
  SearchTierBudgetExceededEvent,
  DaemonStartedEvent,
  // SP-007 additions (12 install / uninstall / taxonomy-promote event classes):
  InstallPreflightFailedEvent,
  InstallStepFailedEvent,
  InstallCompletedEvent,
  InstallSmokeStartedEvent,
  InstallSmokeCompletedEvent,
  InstallSmokeFailedEvent,
  UninstallPreflightFailedEvent,
  UninstallStepFailedEvent,
  UninstallCompletedEvent,
  TaxonomyPromoteCompletedEvent,
  TaxonomyPromoteLockContentionEvent,
  TaxonomyPromoteMissingTermEvent,
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
