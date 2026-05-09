// T036 — Read-only adapter for corpus://manifest (US1).
//
// References: FR-005, contracts/resource-manifest.md "Adapter behavior",
// data-model.md "Validation rules", Constitution VII (Cancellable IO),
// IX (Concurrency-safe), XV (Dynamic Taxonomy — promoted-only).
//
// Reads:
//   - documents.count(WHERE status='success')
//   - MAX(ingest_timestamp) WHERE status='success'
//   - taxonomy_terms WHERE axis='domain' AND state='established' ORDER BY term
//   - taxonomy_terms WHERE axis='tag'    AND state='established' ORDER BY term
//
// Returns ManifestPayload-shaped Result.ok or IndexLockedError on busy.

import {
  err,
  ok,
  type Result,
  IndexLockedError,
  SCHEMA_VERSION,
  TAXONOMY_VERSION,
  type ManifestPayloadType,
} from '@llm-corpus/contracts';
import { openIndexReadOnly, isSqliteBusyError } from './sqlite-open.js';

/**
 * Compose the structural-snapshot manifest from the SQLite index.
 * Read-only by construction; the SC-010 lint rule enforces this in CI.
 */
export async function buildManifest(
  signal: AbortSignal,
): Promise<Result<ManifestPayloadType, IndexLockedError>> {
  signal.throwIfAborted();
  const db = openIndexReadOnly();
  try {
    const docCountRow = db
      .prepare(`SELECT COUNT(*) AS n FROM documents WHERE status = 'success'`)
      .get() as { n: number };
    signal.throwIfAborted();

    const lastTsRow = db
      .prepare(
        `SELECT MAX(ingest_timestamp) AS ts FROM documents WHERE status = 'success'`,
      )
      .get() as { ts: string | null };
    signal.throwIfAborted();

    const domainsRows = db
      .prepare(
        `SELECT term FROM taxonomy_terms WHERE axis = 'domain' AND state = 'established' ORDER BY term ASC`,
      )
      .all() as Array<{ term: string }>;
    signal.throwIfAborted();

    const tagsRows = db
      .prepare(
        `SELECT term FROM taxonomy_terms WHERE axis = 'tag' AND state = 'established' ORDER BY term ASC`,
      )
      .all() as Array<{ term: string }>;

    const payload: ManifestPayloadType = {
      doc_count: docCountRow.n,
      established_domains: domainsRows.map((r) => r.term),
      established_tags: tagsRows.map((r) => r.term),
      last_ingest_timestamp: lastTsRow.ts ?? null,
      schema_version: SCHEMA_VERSION,
      taxonomy_version: TAXONOMY_VERSION,
    };
    return ok(payload);
  } catch (caught) {
    if (isSqliteBusyError(caught)) {
      return err(new IndexLockedError({ uri: 'corpus://manifest' }));
    }
    throw caught;
  } finally {
    db.close();
  }
}
