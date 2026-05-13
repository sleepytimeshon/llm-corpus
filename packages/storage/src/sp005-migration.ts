// SP-005 PREREQ-005 — Schema migration for retrieval tables.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-019
//   - specs/005-retrieval/data-model.md §"Schema migration delta"
//   - Constitution Principle X (Idempotent Pipeline Transitions)
//   - Constitution Principle XIV (XDG Paths via Single Resolver)
//
// Idempotent migration adding the three SP-005 tables:
//   1. documents_fts — FTS5 virtual table for BM25 retrieval.
//   2. documents_vec — sqlite-vec vec0 virtual table for dense cosine.
//   3. edges        — plain table for graph-traversal retrieval.
//
// Each DDL uses `CREATE [VIRTUAL] TABLE IF NOT EXISTS` (idempotent on
// re-invocation). Existing SP-002/SP-003/SP-004 tables are preserved
// verbatim.
//
// CALLER CONTRACT: the `db` connection MUST have `sqliteVec.load(db)`
// invoked BEFORE this function is called (the vec0 virtual table type is
// only available after the sqlite-vec extension is loaded). The
// `openIndexReadWrite()` helper does this transparently for SP-005+.

import type { Database as DatabaseType } from 'better-sqlite3';

const DOCUMENTS_FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  doc_id UNINDEXED,
  title,
  summary,
  tags,
  facet_topic,
  body_excerpt,
  tokenize='porter unicode61'
);
`;

const DOCUMENTS_VEC_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec USING vec0(
  doc_id TEXT PRIMARY KEY,
  embedding float[768]
);
`;

const EDGES_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS edges (
  src_id  TEXT NOT NULL,
  dst_id  TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('tag_overlap','summary_similarity','explicit_related')),
  weight  REAL NOT NULL,
  PRIMARY KEY (src_id, dst_id, kind),
  FOREIGN KEY (src_id) REFERENCES documents(id),
  FOREIGN KEY (dst_id) REFERENCES documents(id)
);
`;

const EDGES_INDEX_SRC_DDL = `
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
`;

const EDGES_INDEX_DST_DDL = `
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
`;

/**
 * Idempotently create the SP-005 retrieval tables.
 *
 * @param db An open better-sqlite3 connection that already has
 *           `sqliteVec.load(db)` invoked against it.
 */
export function runSp005Migration(db: DatabaseType): void {
  db.exec(DOCUMENTS_FTS_DDL);
  db.exec(DOCUMENTS_VEC_DDL);
  db.exec(EDGES_TABLE_DDL);
  db.exec(EDGES_INDEX_SRC_DDL);
  db.exec(EDGES_INDEX_DST_DDL);
}
