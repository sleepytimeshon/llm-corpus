// SP-005 US1 (T051) — Index-stage orchestrator.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-005, FR-RETRIEVAL-007,
//     FR-RETRIEVAL-021
//   - Constitution Principles VII, VIII
//
// Per-document index sub-stage. Runs INSIDE the caller's open transaction
// (BEGIN IMMEDIATE owned by the orchestrator). Renders the FTS5-row fields
// from the precomputed frontmatter + body excerpt; the caller has the
// EmbedStageOutput in hand.

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  RetrievalError,
  IndexPersistError,
} from '@llm-corpus/contracts';
import {
  persistIndex,
  type Fts5Fields,
  type EdgeRecord,
} from '@llm-corpus/storage';

export interface IndexStageInput {
  docId: string;
  vector: Float32Array;
  /** Pre-extracted frontmatter from embed-stage (avoid double-parse). */
  frontmatter: Record<string, unknown>;
  /** First 500 words of body. */
  bodyExcerpt: string;
  /** Title (from documents.title). */
  title: string;
  /** Tags array (parsed from documents.tags_json). */
  tags: readonly string[];
  /** Pre-computed edges (caller built via edges-build-stage). */
  edges: readonly EdgeRecord[];
  db: DatabaseType;
  signal: AbortSignal;
}

export async function indexStage(
  input: IndexStageInput,
): Promise<Result<void, RetrievalError>> {
  input.signal.throwIfAborted();
  const summary =
    typeof input.frontmatter['summary'] === 'string'
      ? (input.frontmatter['summary'] as string)
      : '';
  const facetTopic =
    typeof input.frontmatter['facet_topic'] === 'string'
      ? (input.frontmatter['facet_topic'] as string)
      : '';

  const ftsFields: Fts5Fields = {
    title: input.title,
    summary,
    tags: input.tags.join(', '),
    facet_topic: facetTopic,
    body_excerpt: input.bodyExcerpt,
  };

  const r = await persistIndex(
    {
      docId: input.docId,
      ftsFields,
      vector: input.vector,
      edges: input.edges,
      signal: input.signal,
    },
    input.db,
  );
  if (!r.ok) {
    return err(r.error);
  }
  void IndexPersistError; // type narrow
  return ok(undefined);
}
