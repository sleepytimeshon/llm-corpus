// T064 — Read-only adapter for corpus://recent (US3).
//
// References: FR-007, contracts/resource-recent.md, Constitution X
// (failure-lane exclusion), Decision C (N from config.toml).
//
// Single prepared statement:
//   SELECT id, title, facet_domain AS domain, tags_json, ingest_timestamp
//     FROM documents
//    WHERE status = 'success'
//    ORDER BY ingest_timestamp DESC, id ASC
//    LIMIT ?
//
// N is read from loadResourceConfig() at handler invocation time.
// Constitution III: read-only. The adapter takes NO request-time arguments
// (signal only) — N is server config, not a per-request parameter.

import {
  err,
  ok,
  type Result,
  IndexLockedError,
  type RecentEntryType,
  type RecentPayloadType,
} from '@llm-corpus/contracts';
import { openIndexReadOnly, isSqliteBusyError } from './sqlite-open.js';
import { loadResourceConfig } from './config-loader.js';

export async function buildRecent(
  signal: AbortSignal,
): Promise<Result<RecentPayloadType, IndexLockedError>> {
  signal.throwIfAborted();
  const N = loadResourceConfig().recent.window_size;
  const db = openIndexReadOnly();
  try {
    const rows = db
      .prepare(
        `SELECT id, title, facet_domain AS domain, tags_json, ingest_timestamp
           FROM documents
          WHERE status = 'success'
          ORDER BY ingest_timestamp DESC, id ASC
          LIMIT ?`,
      )
      .all(N) as Array<{
      id: string;
      title: string;
      domain: string;
      tags_json: string;
      ingest_timestamp: string;
    }>;
    const entries: RecentEntryType[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      domain: r.domain,
      tags: JSON.parse(r.tags_json) as string[],
      ingest_timestamp: r.ingest_timestamp,
    }));
    return ok({ entries });
  } catch (caught) {
    if (isSqliteBusyError(caught)) {
      return err(new IndexLockedError({ uri: 'corpus://recent' }));
    }
    throw caught;
  } finally {
    db.close();
  }
}
