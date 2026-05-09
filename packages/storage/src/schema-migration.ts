// T026 — Empty-baseline SQLite schema migration (SP-002).
//
// References: data-model.md §"Persistent state", plan.md R4 (column-shape
// contract) + R6 (fixture drift mitigation).
//
// SP-002 creates two empty tables on fresh init: `documents` and
// `taxonomy_terms`. SP-003 will populate `documents`; SP-004 will populate
// `taxonomy_terms`. SP-002 ships ONLY the empty tables so the resource
// adapters have a query target on the empty baseline.
//
// Canonical column lists are EXPORTED from this module so fixture SQL
// imports them — any column-shape drift between SP-003's real ingest writer
// and the SP-002 fixtures surfaces as a fixture-load failure with a clear
// error, NOT as silent test rot (R6).

import type { Database as DatabaseType } from 'better-sqlite3';

// --- Canonical column lists (R6) ---

/**
 * The full ordered column list of the `documents` table. Fixtures MUST
 * import this constant rather than hardcoding column ordering. Drift =
 * fixture-load failure.
 */
export const DOCUMENTS_COLUMN_LIST = [
  'id',
  'title',
  'body_path',
  'source_path',
  'facet_domain',
  'tags_json',
  'facet_type',
  'source_type',
  'mime_type',
  'hash',
  'ingest_timestamp',
  'status',
] as const;
export type DocumentsColumn = (typeof DOCUMENTS_COLUMN_LIST)[number];

/**
 * The full ordered column list of the `taxonomy_terms` table. Same R6
 * discipline as documents.
 */
export const TAXONOMY_TERMS_COLUMN_LIST = [
  'axis',
  'term',
  'state',
  'established_at',
] as const;
export type TaxonomyTermsColumn = (typeof TAXONOMY_TERMS_COLUMN_LIST)[number];

// --- Migration ---

const DOCUMENTS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS documents (
  id                TEXT PRIMARY KEY        NOT NULL,
  title             TEXT                    NOT NULL,
  body_path         TEXT                    NOT NULL,
  source_path       TEXT                    NOT NULL,
  facet_domain      TEXT                    NOT NULL,
  tags_json         TEXT                    NOT NULL,
  facet_type        TEXT                    NOT NULL,
  source_type       TEXT                    NOT NULL,
  mime_type         TEXT                    NOT NULL,
  hash              TEXT                    NOT NULL,
  ingest_timestamp  TEXT                    NOT NULL,
  status            TEXT                    NOT NULL,
  CHECK (id GLOB 'doc-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  CHECK (status IN ('success', 'failed', 'trashed'))
);
`;

const DOCUMENTS_INDEX_STATUS_INGEST_TS_DDL = `
CREATE INDEX IF NOT EXISTS idx_documents_status_ingest_ts
  ON documents(status, ingest_timestamp DESC);
`;

const DOCUMENTS_INDEX_FACET_DOMAIN_DDL = `
CREATE INDEX IF NOT EXISTS idx_documents_facet_domain
  ON documents(facet_domain) WHERE status = 'success';
`;

const TAXONOMY_TERMS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS taxonomy_terms (
  axis              TEXT NOT NULL,
  term              TEXT NOT NULL,
  state             TEXT NOT NULL,
  established_at    TEXT,
  CHECK (axis IN ('domain', 'tag', 'type', 'source_type')),
  CHECK (state IN ('proposed', 'established')),
  PRIMARY KEY (axis, term)
);
`;

const TAXONOMY_TERMS_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS idx_taxonomy_terms_state_axis
  ON taxonomy_terms(state, axis);
`;

/**
 * Idempotently create the SP-002 baseline schema (`documents` +
 * `taxonomy_terms` tables, three indices).
 *
 * Called by:
 *   - The fixture loader (per-test isolated DB initialization)
 *   - Future SP-003 daemon boot (real index initialization)
 */
export function runSchemaMigration(db: DatabaseType): void {
  db.exec(DOCUMENTS_TABLE_DDL);
  db.exec(DOCUMENTS_INDEX_STATUS_INGEST_TS_DDL);
  db.exec(DOCUMENTS_INDEX_FACET_DOMAIN_DDL);
  db.exec(TAXONOMY_TERMS_TABLE_DDL);
  db.exec(TAXONOMY_TERMS_INDEX_DDL);
}
