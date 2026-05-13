// SP-005 T029 — Contract test for edges materialization.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-008
//   - specs/005-retrieval/research.md Decision E

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { runSp005Migration } from '../../packages/storage/src/sp005-migration.js';
import { encodeEmbeddingForVec0 } from '../../packages/storage/src/index-persister.js';
import {
  buildEdges,
  DEFAULT_EDGES_THRESHOLDS,
} from '../../packages/index/src/edges-builder.js';

let db: Database.Database;
const sig = new AbortController().signal;

beforeEach(() => {
  db = new Database(':memory:');
  sqliteVec.load(db);
  db.exec(`CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    facet_type TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    status TEXT NOT NULL
  )`);
  runSp005Migration(db);
});

afterEach(() => {
  db.close();
});

function seedDoc(
  id: string,
  tags: string[],
  embedding: Float32Array | null,
  facetType = 'concept',
): void {
  db.prepare(
    `INSERT INTO documents (id, facet_type, tags_json, status)
     VALUES (?, ?, ?, 'success')`,
  ).run(id, facetType, JSON.stringify(tags));
  if (embedding) {
    db.prepare(
      `INSERT INTO documents_vec (doc_id, embedding) VALUES (?, ?)`,
    ).run(id, encodeEmbeddingForVec0(embedding));
  }
}

describe('buildEdges — tag_overlap + summary_similarity + explicit_related', () => {
  it('emits tag_overlap edge when Jaccard ≥ threshold (0.3)', () => {
    seedDoc('doc-aaaaaaaa', ['a', 'b', 'c'], null);
    seedDoc('doc-bbbbbbbb', ['a', 'b', 'd'], null);
    // jaccard({a,b,c}, {a,b,d}) = 2/4 = 0.5 ≥ 0.3
    const edges = buildEdges({
      newDocId: 'doc-newxxxxx'.slice(0, 12),
      newDocTags: ['a', 'b', 'c'],
      newDocEmbedding: new Float32Array(768),
      newDocFrontmatterRelated: [],
      db,
      thresholds: DEFAULT_EDGES_THRESHOLDS,
      signal: sig,
    });
    const tagEdges = edges.filter((e) => e.kind === 'tag_overlap');
    expect(tagEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT emit tag_overlap edge when Jaccard < threshold', () => {
    seedDoc('doc-aaaaaaaa', ['xx', 'yy', 'zz'], null);
    seedDoc('doc-bbbbbbbb', ['aa', 'bb', 'cc'], null);
    const edges = buildEdges({
      newDocId: 'doc-new00001',
      newDocTags: ['xx', 'yy', 'zz'],
      newDocEmbedding: new Float32Array(768),
      newDocFrontmatterRelated: [],
      db,
      thresholds: DEFAULT_EDGES_THRESHOLDS,
      signal: sig,
    });
    // doc-aaaaaaaa has full overlap; doc-bbbbbbbb has none.
    const targets = edges
      .filter((e) => e.kind === 'tag_overlap')
      .map((e) => e.dst_id);
    expect(targets).toContain('doc-aaaaaaaa');
    expect(targets).not.toContain('doc-bbbbbbbb');
  });

  it('emits explicit_related edges verbatim from frontmatter.related', () => {
    seedDoc('doc-aaaaaaaa', [], null);
    seedDoc('doc-bbbbbbbb', [], null);
    const edges = buildEdges({
      newDocId: 'doc-new00002',
      newDocTags: [],
      newDocEmbedding: new Float32Array(768),
      newDocFrontmatterRelated: ['doc-aaaaaaaa', 'doc-bbbbbbbb'],
      db,
      thresholds: DEFAULT_EDGES_THRESHOLDS,
      signal: sig,
    });
    const explicit = edges.filter((e) => e.kind === 'explicit_related');
    expect(explicit.length).toBe(2);
    expect(explicit.every((e) => e.weight === 1.0)).toBe(true);
  });

  it('skips malformed explicit_related entries', () => {
    seedDoc('doc-aaaaaaaa', [], null);
    const edges = buildEdges({
      newDocId: 'doc-new00003',
      newDocTags: [],
      newDocEmbedding: new Float32Array(768),
      newDocFrontmatterRelated: ['doc-aaaaaaaa', 'malformed', 'doc-NOTHEX!!'],
      db,
      thresholds: DEFAULT_EDGES_THRESHOLDS,
      signal: sig,
    });
    const explicit = edges.filter((e) => e.kind === 'explicit_related');
    expect(explicit.length).toBe(1);
    expect(explicit[0].dst_id).toBe('doc-aaaaaaaa');
  });

  it('edges are directional (src=newDocId)', () => {
    seedDoc('doc-aaaaaaaa', ['a', 'b'], null);
    const edges = buildEdges({
      newDocId: 'doc-new00004',
      newDocTags: ['a', 'b'],
      newDocEmbedding: new Float32Array(768),
      newDocFrontmatterRelated: [],
      db,
      thresholds: DEFAULT_EDGES_THRESHOLDS,
      signal: sig,
    });
    for (const e of edges) {
      expect(e.src_id).toBe('doc-new00004');
    }
  });

  it('respects signal abort', () => {
    seedDoc('doc-aaaaaaaa', ['a', 'b'], null);
    const c = new AbortController();
    c.abort();
    expect(() =>
      buildEdges({
        newDocId: 'doc-new00005',
        newDocTags: ['a', 'b'],
        newDocEmbedding: new Float32Array(768),
        newDocFrontmatterRelated: [],
        db,
        thresholds: DEFAULT_EDGES_THRESHOLDS,
        signal: c.signal,
      }),
    ).toThrow();
  });
});
