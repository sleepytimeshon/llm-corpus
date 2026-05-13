// SP-005 US1 (T052) — Edges-build-stage orchestrator.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-008, FR-RETRIEVAL-011
//   - Edge case: "Edges-builder timeout"
//
// Wraps the index/edges-builder.buildEdges helper with a per-doc
// AbortController + setTimeout (per perDocEdgesBuildTimeoutMs).

import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  EdgesBuildTimeoutError,
  RetrievalError,
} from '@llm-corpus/contracts';
import {
  buildEdges,
  DEFAULT_EDGES_THRESHOLDS,
  type EdgesBuilderThresholds,
} from '@llm-corpus/index';
import type { EdgeRecord } from '@llm-corpus/storage';
import type { Policy } from './policies.js';

export interface EdgesBuildStageInput {
  newDocId: string;
  newDocTags: readonly string[];
  newDocEmbedding: Float32Array;
  newDocFrontmatterRelated: readonly string[];
  db: DatabaseType;
  thresholds?: EdgesBuilderThresholds;
  policy: Policy;
  signal: AbortSignal;
}

export async function edgesBuildStage(
  input: EdgesBuildStageInput,
): Promise<Result<EdgeRecord[], EdgesBuildTimeoutError | RetrievalError>> {
  input.signal.throwIfAborted();

  const localController = new AbortController();
  const onParent = (): void => localController.abort();
  input.signal.addEventListener('abort', onParent, { once: true });
  const handle = setTimeout(
    () => localController.abort(),
    input.policy.perDocEdgesBuildTimeoutMs,
  );
  const cleanup = (): void => {
    clearTimeout(handle);
    input.signal.removeEventListener('abort', onParent);
  };

  try {
    const edges = buildEdges({
      newDocId: input.newDocId,
      newDocTags: input.newDocTags,
      newDocEmbedding: input.newDocEmbedding,
      newDocFrontmatterRelated: input.newDocFrontmatterRelated,
      db: input.db,
      thresholds: input.thresholds ?? DEFAULT_EDGES_THRESHOLDS,
      signal: localController.signal,
    });
    return ok(edges);
  } catch (caught) {
    const e = caught as Error;
    if (e.name === 'AbortError' || localController.signal.aborted) {
      return err(
        new EdgesBuildTimeoutError({
          doc_id: input.newDocId,
          timeout_ms: input.policy.perDocEdgesBuildTimeoutMs,
        }),
      );
    }
    return err(
      new RetrievalError(
        {
          error_code: 'persist_failed',
          message: `edges build failed: ${e.message}`,
        },
        e,
      ),
    );
  } finally {
    cleanup();
  }
}
