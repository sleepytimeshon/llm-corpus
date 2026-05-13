// SP-005 US1 (T046) — Edges materialization.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-008
//   - specs/005-retrieval/research.md Decision E
//   - specs/005-retrieval/data-model.md §"Entity 4 — Edge"
//   - Constitution Principles V, VII
//
// For a newly-indexed document D_new, compute three classes of edges to
// existing classified documents:
//   1. tag_overlap — Jaccard similarity over the two tag sets; emit edge
//      if ≥ tagOverlapThreshold (default 0.3).
//   2. summary_similarity — cosine similarity between the two embeddings
//      via sqlite-vec's vec_distance_cosine; emit edge if ≥
//      summarySimilarityThreshold (default 0.7).
//   3. explicit_related — for every entry in D_new.frontmatter.related,
//      unconditionally emit edge (weight 1.0).
//
// Edges are stored ONE-WAY (src=D_new, dst=D_existing); the graph
// retriever traverses both directions via UNION.

import type { Database as DatabaseType } from 'better-sqlite3';
import { encodeEmbeddingForVec0 } from '@llm-corpus/storage';
import type { EdgeRecord } from '@llm-corpus/storage';

export interface EdgesBuilderThresholds {
  /** Jaccard threshold for tag_overlap. Default 0.3 (per §10.4). */
  tagOverlapThreshold: number;
  /** Cosine threshold for summary_similarity. Default 0.7 (per §10.4). */
  summarySimilarityThreshold: number;
}

export const DEFAULT_EDGES_THRESHOLDS: EdgesBuilderThresholds = Object.freeze({
  tagOverlapThreshold: 0.3,
  summarySimilarityThreshold: 0.7,
});

export interface BuildEdgesInput {
  newDocId: string;
  newDocTags: readonly string[];
  newDocEmbedding: Float32Array;
  newDocFrontmatterRelated: readonly string[];
  db: DatabaseType;
  thresholds: EdgesBuilderThresholds;
  signal: AbortSignal;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Compute the candidate edges for newDocId without mutating the database.
 * Caller (index-stage / orchestrator) batches the returned edges into the
 * persistIndex call within its transaction.
 */
export function buildEdges(input: BuildEdgesInput): EdgeRecord[] {
  const {
    newDocId,
    newDocTags,
    newDocEmbedding,
    newDocFrontmatterRelated,
    db,
    thresholds,
    signal,
  } = input;
  signal.throwIfAborted();

  const edges: EdgeRecord[] = [];
  const newTagSet = new Set(newDocTags);

  // ---- 1. tag_overlap (Jaccard ≥ threshold) ----
  // Pull every classified doc's tags_json. For N ≤ 10k this is acceptable
  // (per Decision E O(N) per new doc → O(N²) cumulative bound).
  if (newTagSet.size > 0) {
    const tagRows = db
      .prepare(
        `SELECT id, tags_json FROM documents
           WHERE status = 'success'
             AND id != ?
             AND facet_type != 'unclassified'`,
      )
      .all(newDocId) as Array<{ id: string; tags_json: string }>;
    for (const row of tagRows) {
      signal.throwIfAborted();
      let existingTags: string[];
      try {
        existingTags = JSON.parse(row.tags_json) as string[];
      } catch {
        continue;
      }
      const existingSet = new Set(existingTags);
      const j = jaccard(newTagSet, existingSet);
      if (j >= thresholds.tagOverlapThreshold) {
        edges.push({
          src_id: newDocId,
          dst_id: row.id,
          kind: 'tag_overlap',
          weight: j,
        });
      }
    }
  }

  // ---- 2. summary_similarity (cosine ≥ threshold) ----
  // Use sqlite-vec's vec_distance_cosine to score every existing
  // documents_vec row against the new embedding.
  try {
    const encoded = encodeEmbeddingForVec0(newDocEmbedding);
    const simRows = db
      .prepare(
        `SELECT v.doc_id, vec_distance_cosine(v.embedding, ?) AS dist
           FROM documents_vec AS v
          WHERE v.doc_id != ?`,
      )
      .all(encoded, newDocId) as Array<{ doc_id: string; dist: number }>;
    for (const row of simRows) {
      signal.throwIfAborted();
      // cosine similarity = 1 - distance (sqlite-vec returns distance ∈ [0, 2])
      const sim = 1 - row.dist;
      if (sim >= thresholds.summarySimilarityThreshold) {
        edges.push({
          src_id: newDocId,
          dst_id: row.doc_id,
          kind: 'summary_similarity',
          weight: sim,
        });
      }
    }
  } catch {
    // vec table absent or unreadable — skip the similarity edge class
    // gracefully. tag_overlap + explicit_related still contribute.
  }

  // ---- 3. explicit_related (verbatim from frontmatter) ----
  for (const entry of newDocFrontmatterRelated) {
    if (entry === newDocId) continue;
    // Validate the format defensively; FK constraint in the schema would
    // also reject a malformed id, but we filter upstream to avoid
    // surfacing an INSERT failure on bad input.
    if (!/^doc-[0-9a-f]{8}$/.test(entry)) continue;
    edges.push({
      src_id: newDocId,
      dst_id: entry,
      kind: 'explicit_related',
      weight: 1.0,
    });
  }

  return edges;
}
