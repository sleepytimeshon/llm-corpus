// SP-003 T068 — Persister (single-transaction commit).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-008
//   - specs/003-ingest-pipeline/data-model.md §"Entity 8/9"
//   - specs/003-ingest-pipeline/plan.md Decision I (256-way sharding)
//   - Constitution VIII (transactional index updates), V (schema-enforced)
//
// Per-document persist flow:
//   1. Build the documents-row payload from inputs (sentinel columns for
//      classifier-owned fields).
//   2. Open write-side SQLite connection.
//   3. Write body file atomically via withTempDir (tmp + fsync + rename).
//   4. BEGIN TRANSACTION → INSERT documents → rename pending→processed →
//      COMMIT. On any step failure: ROLLBACK + remove body file.
//   5. Emit ingest.normalized + ingest.completed telemetry.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  PersistError,
  ok,
  err,
  type Result,
  withTempDir,
  emitTelemetry,
  stringifyMarkdownWithFrontmatter,
} from '@llm-corpus/contracts';
import {
  openIndexReadWrite,
  insertDocument,
  type InsertDocumentInput,
} from '@llm-corpus/storage';
import type { NormalizedDoc } from '@llm-corpus/extract';

export interface PersistInput {
  /** Pre-computed doc_id (doc-XXXXXXXX). */
  docId: string;
  /** Full-file SHA-256 lowercase hex. */
  hash: string;
  /** Detected MIME from the validation gate. */
  mimeType: 'application/pdf' | 'text/markdown' | 'text/plain' | 'text/html';
  /** Absolute path of the file in Paths.pending(). */
  pendingPath: string;
  /** Absolute path as originally dropped (for sidecar / forensics). */
  sourcePath: string;
  /** Normalized body + frontmatter. */
  normalizedDoc: NormalizedDoc;
  /** Original filename (for processed/ uniquified target). */
  originalFilename: string;
  /** ISO-8601 UTC timestamp at INSERT. */
  ingestTimestamp: string;
}

export interface PersistedDoc {
  docId: string;
  bodyPath: string;
  processedPath: string;
}

/** Compute the body file's path components per Decision I (256-way sharding). */
function bodyPathParts(docId: string): { idPrefix: string; absDir: string; absFile: string; relPath: string } {
  // doc-XXXXXXXX — slice(4, 6) takes the first 2 hex of the random part.
  const idPrefix = docId.slice(4, 6);
  const absDir = path.join(Paths.docsStore(), idPrefix);
  const absFile = path.join(absDir, `${docId}.md`);
  const relPath = path.join('store', idPrefix, `${docId}.md`);
  return { idPrefix, absDir, absFile, relPath };
}

export async function persist(
  input: PersistInput,
  signal: AbortSignal,
): Promise<Result<PersistedDoc, PersistError>> {
  signal.throwIfAborted();

  const { absDir, absFile, relPath } = bodyPathParts(input.docId);

  // Title heuristic: filename basename without extension.
  const title = path.basename(input.originalFilename, path.extname(input.originalFilename));

  // Serialize body + frontmatter via the existing SP-002 helper.
  const serialized = stringifyMarkdownWithFrontmatter({
    body: input.normalizedDoc.body,
    frontmatter: input.normalizedDoc.frontmatter,
  });

  // Ensure the body shard dir exists.
  try {
    await fsp.mkdir(absDir, { recursive: true });
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `Cannot mkdir body shard: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  // Atomic body-file write via withTempDir + rename.
  try {
    await withTempDir(
      async (tmpDir) => {
        const tmpFile = path.join(tmpDir, `${input.docId}.md`);
        const fh = await fsp.open(tmpFile, 'w');
        try {
          await fh.writeFile(serialized, 'utf8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        await fsp.rename(tmpFile, absFile);
      },
      { signal },
    );
  } catch (caught) {
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: `Body file write failed: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  signal.throwIfAborted();

  // SQLite single transaction: INSERT + rename pending→processed.
  const row: InsertDocumentInput = {
    id: input.docId,
    title,
    body_path: relPath,
    source_path: input.sourcePath,
    facet_domain: '',
    tags_json: '[]',
    facet_type: 'unclassified',
    source_type: 'inbox-filesystem',
    mime_type: input.mimeType,
    hash: input.hash,
    ingest_timestamp: input.ingestTimestamp,
    status: 'success',
  };

  const db = openIndexReadWrite();

  // Processed path — uniquified by doc_id__originalFilename.
  const processedRoot = Paths.processed();
  await fsp.mkdir(processedRoot, { recursive: true });
  const processedPath = path.join(
    processedRoot,
    `${input.docId}__${input.originalFilename}`,
  );

  try {
    db.exec('BEGIN IMMEDIATE');
    const insertResult = insertDocument(db, row);
    if (!insertResult.ok) {
      db.exec('ROLLBACK');
      // Body file is orphaned — clean up.
      await fsp.rm(absFile, { force: true }).catch(() => undefined);
      // Persist telemetry.
      await emitTelemetry({
        event: 'persist.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        file_path: input.pendingPath,
        error_code: 'persist_failed',
        message: insertResult.error.data.message ?? 'INSERT failed',
        stage: 'persist',
      });
      return err(insertResult.error);
    }

    // Atomic rename pending → processed/.
    try {
      await fsp.rename(input.pendingPath, processedPath);
    } catch (caught) {
      db.exec('ROLLBACK');
      await fsp.rm(absFile, { force: true }).catch(() => undefined);
      const msg = `pending→processed rename failed: ${(caught as Error).message}`;
      await emitTelemetry({
        event: 'persist.failed',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        file_path: input.pendingPath,
        error_code: 'persist_failed',
        message: msg,
        stage: 'persist',
      });
      return err(
        new PersistError({
          error_code: 'persist_failed',
          message: msg,
          retriable: true,
        }),
      );
    }

    db.exec('COMMIT');
  } catch (caught) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // best-effort
    }
    await fsp.rm(absFile, { force: true }).catch(() => undefined);
    const msg = `Persist transaction failed: ${(caught as Error).message}`;
    await emitTelemetry({
      event: 'persist.failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      file_path: input.pendingPath,
      error_code: 'persist_failed',
      message: msg,
      stage: 'persist',
    });
    return err(
      new PersistError({
        error_code: 'persist_failed',
        message: msg,
        retriable: true,
      }),
    );
  } finally {
    db.close();
  }

  // Success telemetry.
  await emitTelemetry({
    event: 'ingest.normalized',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    file_path: input.sourcePath,
    doc_id: input.docId,
    mime_type: input.mimeType,
    body_path: relPath,
  });

  return ok({
    docId: input.docId,
    bodyPath: relPath,
    processedPath,
  });
}
