// SP-005 US1 (T053) — Retrieval orchestrator: post-classify hook chain.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-006, FR-RETRIEVAL-007,
//     FR-RETRIEVAL-008, FR-RETRIEVAL-018, R6
//   - Constitution Principles VIII, IX
//
// Per-document orchestration: SP-004 classify-stage has already
// committed its UPDATE + frontmatter rename. This orchestrator then runs:
//
//   1. embed-stage (OUTSIDE any SQL transaction — embedding is HTTP IO).
//   2. edges-build-stage (computes edges; no DB writes here).
//   3. BEGIN IMMEDIATE → index-stage (FTS5 + vec + edges INSERTs) → COMMIT.
//   4. On any failure between BEGIN and COMMIT: ROLLBACK + error sidecar.
//
// Per R6 in plan.md, the embedding HTTP call cannot live inside a SQLite
// transaction (would block the writer for seconds). The atomicity claim in
// Constitution VIII / FR-RETRIEVAL-007 is over the three INDEX writes
// (FTS5 + vec + edges) — those commit together OR none commit. The
// embedding is recoverable via `corpus reindex` if the transaction fails.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  type Result,
  Paths,
  emitTelemetry,
  withTempDir,
  RetrievalError,
  EmbeddingUnavailableError,
  EmbeddingDimensionMismatchError,
  EmbeddingValidationError,
  EdgesBuildTimeoutError,
  IndexPersistError,
  type Sp005EmbedErrorCodeType,
  type Sp005IndexErrorCodeType,
  type Sp005EdgesErrorCodeType,
} from '@llm-corpus/contracts';
import type { EmbeddingAdapter } from '@llm-corpus/inference';
import type { Policy } from './policies.js';
import { embedStage } from './embed-stage.js';
import { indexStage } from './index-stage.js';
import { edgesBuildStage } from './edges-build-stage.js';

export interface RetrievalOrchestratorInput {
  docId: string;
  db: DatabaseType;
  embeddingAdapter: EmbeddingAdapter;
  policy: Policy;
  signal: AbortSignal;
}

export type RetrievalOrchestratorOutcome =
  | 'indexed'
  | 'skipped'
  | 'failed';

export interface RetrievalOrchestratorResult {
  outcome: RetrievalOrchestratorOutcome;
  errorCode?:
    | Sp005EmbedErrorCodeType
    | Sp005IndexErrorCodeType
    | Sp005EdgesErrorCodeType;
}

async function writeErrorSidecar(
  docId: string,
  errorCode: string,
  message: string,
  retriable: boolean,
  stage: 'embed' | 'index' | 'edges',
): Promise<void> {
  const failedRoot = Paths.failed();
  await fsp.mkdir(failedRoot, { recursive: true });
  const sidecarPath = path.join(failedRoot, `${docId}.error.json`);
  const sidecar = {
    error_code: errorCode,
    message: message.slice(0, 1024),
    retriable,
    doc_id: docId,
    stage,
    timestamp: new Date().toISOString(),
  };
  try {
    await withTempDir(async (tmpDir) => {
      const tmp = path.join(tmpDir, `${docId}.error.json`);
      const fh = await fsp.open(tmp, 'w');
      try {
        await fh.writeFile(JSON.stringify(sidecar, null, 2), 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fsp.rename(tmp, sidecarPath);
    });
  } catch {
    // best effort
  }
}

function isIdempotentSkip(db: DatabaseType, docId: string): boolean {
  try {
    const row = db
      .prepare(`SELECT 1 AS n FROM documents_vec WHERE doc_id = ? LIMIT 1`)
      .get(docId) as { n: number } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

export async function retrievalOrchestrator(
  input: RetrievalOrchestratorInput,
): Promise<Result<RetrievalOrchestratorResult, RetrievalError>> {
  const { docId, db, embeddingAdapter, policy, signal } = input;

  signal.throwIfAborted();

  // Idempotency check — already indexed? Skip silently (Constitution X).
  if (isIdempotentSkip(db, docId)) {
    return ok({ outcome: 'skipped' });
  }

  // ---- Step 1: embed (OUTSIDE SQL transaction) ----
  const embedResult = await embedStage({
    docId,
    db,
    embeddingAdapter,
    policy,
    signal,
  });
  if (!embedResult.ok) {
    const e = embedResult.error;
    const code: Sp005EmbedErrorCodeType =
      e instanceof EmbeddingUnavailableError
        ? 'embedding_unavailable'
        : e instanceof EmbeddingDimensionMismatchError
          ? 'embedding_dimension_mismatch'
          : e instanceof EmbeddingValidationError
            ? 'embedding_validation_failed'
            : 'embedding_unavailable';
    await writeErrorSidecar(
      docId,
      code,
      e.message,
      e.data.retriable ?? true,
      'embed',
    );
    return ok({ outcome: 'failed', errorCode: code });
  }
  const embed = embedResult.value;

  // ---- Step 2: edges-build (no DB writes; just compute) ----
  const relatedRaw = embed.frontmatter['related'];
  const related: string[] = Array.isArray(relatedRaw)
    ? (relatedRaw as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  await emitTelemetry({
    event: 'edges.started',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    candidate_pool_size: related.length,
  });

  const edgesResult = await edgesBuildStage({
    newDocId: docId,
    newDocTags: embed.tags,
    newDocEmbedding: embed.vector,
    newDocFrontmatterRelated: related,
    db,
    policy,
    signal,
  });
  if (!edgesResult.ok) {
    const e = edgesResult.error;
    const code: Sp005EdgesErrorCodeType =
      e instanceof EdgesBuildTimeoutError
        ? 'edges_build_timeout'
        : 'persist_failed';
    await emitTelemetry({
      event: 'edges.failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      doc_id: docId,
      error_code: code,
      message: (e.data.message ?? e.message ?? 'edges build failed').slice(0, 1024),
    });
    await writeErrorSidecar(docId, code, e.message, true, 'edges');
    return ok({ outcome: 'failed', errorCode: code });
  }
  const edges = edgesResult.value;

  // ---- Step 3: BEGIN IMMEDIATE → index-stage → COMMIT ----
  const indexStart = Date.now();
  await emitTelemetry({
    event: 'index.started',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    body_excerpt_word_count: embed.bodyExcerptWordCount,
    frontmatter_fields_present: Object.keys(embed.frontmatter).slice(0, 6),
  });

  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const indexed = await indexStage({
        docId,
        vector: embed.vector,
        frontmatter: embed.frontmatter,
        bodyExcerpt: embed.bodyExcerpt,
        title: embed.title,
        tags: embed.tags,
        edges,
        db,
        signal,
      });
      if (!indexed.ok) {
        db.exec('ROLLBACK');
        const code: Sp005IndexErrorCodeType =
          indexed.error instanceof IndexPersistError
            ? 'persist_failed'
            : 'persist_failed';
        await emitTelemetry({
          event: 'index.failed',
          timestamp: new Date().toISOString(),
          severity: 'error',
          outcome: 'failed',
          doc_id: docId,
          error_code: code,
          message: indexed.error.message.slice(0, 1024),
        });
        await writeErrorSidecar(
          docId,
          code,
          indexed.error.message,
          true,
          'index',
        );
        return ok({ outcome: 'failed', errorCode: code });
      }
      db.exec('COMMIT');
    } catch (caught) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw caught;
    }
  } catch (caught) {
    const message = (caught as Error).message;
    await emitTelemetry({
      event: 'index.failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      doc_id: docId,
      error_code: 'persist_failed',
      message: message.slice(0, 1024),
    });
    await writeErrorSidecar(docId, 'persist_failed', message, true, 'index');
    return ok({ outcome: 'failed', errorCode: 'persist_failed' });
  }

  // ---- Success — emit completion events ----
  const indexDuration = Date.now() - indexStart;
  await emitTelemetry({
    event: 'index.completed',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    fts5_inserted: true,
    vec_inserted: true,
    duration_ms: indexDuration,
  });
  await emitTelemetry({
    event: 'edges.completed',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    doc_id: docId,
    tag_overlap_count: edges.filter((e) => e.kind === 'tag_overlap').length,
    summary_similarity_count: edges.filter(
      (e) => e.kind === 'summary_similarity',
    ).length,
    explicit_related_count: edges.filter((e) => e.kind === 'explicit_related')
      .length,
    duration_ms: indexDuration,
  });

  return ok({ outcome: 'indexed' });
}
