// SP-005 PREREQ-006 — Index persister (FTS5 + vec + edges INSERTs).
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-007
//   - specs/005-retrieval/data-model.md §"Entity 2 / 3 / 4"
//   - Constitution Principle VII (Cancellable, Bounded IO)
//   - Constitution Principle VIII (Atomic Writes & Transactional Index)
//
// CALLER CONTRACT: the caller opens the SQLite transaction (BEGIN IMMEDIATE).
// This module only writes rows; the caller commits or rolls back. This
// preserves Constitution VIII's atomic-index-write contract — FTS5 row +
// vec row + edges-for-this-doc commit together OR none commit.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  emitTelemetry,
  type Result,
  IndexPersistError,
} from '@llm-corpus/contracts';
import {
  appendCatalogLine,
  type CatalogLineInput,
} from './catalog-md-generator.js';

/**
 * Encode a Float32Array as a SQLite BLOB binding suitable for the vec0
 * virtual table's `embedding float[N]` column. sqlite-vec accepts either
 * a raw little-endian float32 byte sequence (which is what `Buffer.from(
 * view.buffer, view.byteOffset, view.byteLength)` yields on x86-64 / arm64)
 * or a JSON-encoded array. We use the byte form for performance.
 */
export function encodeEmbeddingForVec0(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export interface Fts5Fields {
  /** Document title (from documents.title; SP-003-owned). */
  title: string;
  /** Summary text from body-file frontmatter (empty string if absent). */
  summary: string;
  /** CSV-joined tag list (e.g., "agent, memory, retrieval"). */
  tags: string;
  /** Facet topic from body-file frontmatter (empty string if absent). */
  facet_topic: string;
  /** First 500 words of body section, codepoint-safe. */
  body_excerpt: string;
}

export interface EdgeRecord {
  src_id: string;
  dst_id: string;
  kind: 'tag_overlap' | 'summary_similarity' | 'explicit_related';
  weight: number;
}

export interface PersistIndexInput {
  /** doc-XXXXXXXX id of the row being indexed. */
  docId: string;
  /** FTS5 column values to INSERT. */
  ftsFields: Fts5Fields;
  /** Dense embedding vector (Float32Array, length matches schema dim). */
  vector: Float32Array;
  /** Zero-or-more edges to INSERT (this doc as src_id). */
  edges: readonly EdgeRecord[];
  /** Caller-owned AbortSignal. */
  signal: AbortSignal;
}

/**
 * Write the three SP-005 index entries for one document within a
 * CALLER-OPENED transaction.
 *
 * The caller is responsible for `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
 * This function executes:
 *   1. INSERT INTO documents_fts (...)
 *   2. INSERT INTO documents_vec (...)
 *   3. For each edge: INSERT OR IGNORE INTO edges (...)
 *
 * On any SQL exception, returns Result.err — caller MUST ROLLBACK.
 * On success, returns Result.ok — caller MUST COMMIT.
 *
 * `signal.throwIfAborted()` is invoked between rows to honor Constitution
 * VII bounded IO.
 */
export async function persistIndex(
  input: PersistIndexInput,
  db: DatabaseType,
): Promise<Result<void, IndexPersistError>> {
  const { docId, ftsFields, vector, edges, signal } = input;

  try {
    signal.throwIfAborted();

    // 1. FTS5 row.
    try {
      const fts5Stmt = db.prepare(
        `INSERT INTO documents_fts
           (doc_id, title, summary, tags, facet_topic, body_excerpt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      fts5Stmt.run(
        docId,
        ftsFields.title,
        ftsFields.summary,
        ftsFields.tags,
        ftsFields.facet_topic,
        ftsFields.body_excerpt,
      );
    } catch (caught) {
      return err(
        new IndexPersistError(
          {
            doc_id: docId,
            stage: 'fts5',
            message: `FTS5 INSERT failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }

    signal.throwIfAborted();

    // 2. vec0 row. sqlite-vec accepts a raw little-endian float32 byte
    // sequence as the BLOB binding — encodeEmbeddingForVec0 wraps the
    // Float32Array's underlying buffer in a Node Buffer without copying.
    try {
      const vecStmt = db.prepare(
        `INSERT INTO documents_vec (doc_id, embedding) VALUES (?, ?)`,
      );
      vecStmt.run(docId, encodeEmbeddingForVec0(vector));
    } catch (caught) {
      return err(
        new IndexPersistError(
          {
            doc_id: docId,
            stage: 'vec',
            message: `vec0 INSERT failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }

    // 3. Edges (zero-or-more). INSERT OR IGNORE silently de-duplicates.
    if (edges.length > 0) {
      try {
        const edgeStmt = db.prepare(
          `INSERT OR IGNORE INTO edges (src_id, dst_id, kind, weight)
           VALUES (?, ?, ?, ?)`,
        );
        for (const edge of edges) {
          signal.throwIfAborted();
          edgeStmt.run(edge.src_id, edge.dst_id, edge.kind, edge.weight);
        }
      } catch (caught) {
        return err(
          new IndexPersistError(
            {
              doc_id: docId,
              stage: 'edges',
              message: `edges INSERT failed: ${(caught as Error).message}`,
            },
            caught,
          ),
        );
      }
    }

    return ok(undefined);
  } catch (caught) {
    // throwIfAborted or unknown — surface as persist error.
    return err(
      new IndexPersistError(
        {
          doc_id: docId,
          stage: 'fts5',
          message: `persist aborted: ${(caught as Error).message}`,
        },
        caught,
      ),
    );
  }
}

// ============================================================================
// SP-006 T052 — persistIndexWithCatalog: SP-005 persist + CATALOG.md append
// ============================================================================
//
// Wraps the SP-005 caller-owned transaction protocol with:
//   1. BEGIN IMMEDIATE
//   2. persistIndex(...)      ← SP-005 FTS5 + vec + edges INSERTs
//   3. COMMIT (or ROLLBACK on failure)
//   4. appendCatalogLine(...) ← SP-006 flat-file mirror (post-COMMIT)
//
// Constitution VIII: the SQL writes are the transactional unit. CATALOG.md
// is a flat-file MIRROR (similar to the SP-004 body-file frontmatter
// rewrite) — append failure does NOT roll back the SQL transaction.
// CATALOG.md append failure emits `catalog.append.failed` telemetry but
// surfaces a non-fatal Result.ok (the index transaction succeeded).

export interface CatalogPersistInput extends PersistIndexInput {
  /** Catalog line metadata. Title / facets / summary used to materialize the line. */
  catalog: CatalogLineInput;
}

/**
 * Persist the SP-005 index entries in a CALLER-MANAGED transaction wrapped
 * by this function, then append the SP-006 CATALOG.md line. On SQL failure,
 * the transaction is rolled back and CATALOG.md is NOT touched.
 */
export async function persistIndexWithCatalog(
  input: CatalogPersistInput,
  db: DatabaseType,
): Promise<Result<void, IndexPersistError>> {
  if (input.signal.aborted) {
    return err(
      new IndexPersistError({
        doc_id: input.docId,
        stage: 'fts5',
        message: 'persist aborted before BEGIN',
      }),
    );
  }

  db.exec('BEGIN IMMEDIATE');
  let persistResult: Result<void, IndexPersistError>;
  try {
    persistResult = await persistIndex(input, db);
  } catch (caught) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* best-effort */
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    return err(
      new IndexPersistError(
        {
          doc_id: input.docId,
          stage: 'fts5',
          message: `persist crashed: ${message}`,
        },
        caught,
      ),
    );
  }

  if (!persistResult.ok) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* best-effort */
    }
    return persistResult;
  }

  try {
    db.exec('COMMIT');
  } catch (caught) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* best-effort */
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    return err(
      new IndexPersistError(
        {
          doc_id: input.docId,
          stage: 'fts5',
          message: `commit failed: ${message}`,
        },
        caught,
      ),
    );
  }

  // Post-COMMIT — CATALOG.md flat-file mirror. Failure is NON-fatal per
  // Constitution VIII (SQL is the transactional unit). Telemetry-or-die per
  // Constitution XIII.
  try {
    await appendCatalogLine(input.catalog, input.signal);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await emitTelemetry({
      event: 'search.tier_failed',
      timestamp: new Date().toISOString(),
      severity: 'warn',
      outcome: 'failed',
      tier: 'catalog-grep',
      error_code: 'catalog_append_failed',
      duration_ms: 0,
    }).catch(() => {
      // never crash on telemetry failure
    });
    // Don't fail the persist — CATALOG.md is a mirror.
    void message;
  }

  return ok(undefined);
}
