// SP-005 US1 (T048) — Search orchestrator (the four-signal hybrid retriever).
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-001, FR-RETRIEVAL-002,
//     FR-RETRIEVAL-003, FR-RETRIEVAL-004, FR-RETRIEVAL-011,
//     FR-RETRIEVAL-013, FR-RETRIEVAL-020, FR-RETRIEVAL-023
//   - Constitution Principles I, V, VII, XIII, XVI
//
// Runs the four retrievers via Promise.allSettled with per-retriever
// AbortControllers chained off the master signal; collects RankingSignal[]
// including failures; computes confidence weights for the candidate
// union; runs fuseRrf; validates the SearchHit array; returns SearchOutput.
//
// Telemetry: search.started + search.query + search.completed | degraded |
// error per the FR-RETRIEVAL-013 contract.

import * as crypto from 'node:crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  emitTelemetry,
  SearchOutputZodSchema,
  SearchHitZodSchema,
  type SearchInput,
  type SearchOutput,
  type SearchHit,
  type SearchErrorEnvelope,
  type RankingSignalName,
} from '@llm-corpus/contracts';
import { Fts5Adapter, type RankingSignal } from './fts5-adapter.js';
import { VecAdapter } from './vec-adapter.js';
import { GraphAdapter } from './graph-adapter.js';
import {
  ConfidenceAdapter,
  confidenceWeightFor,
  DEFAULT_CONFIDENCE_WEIGHTS,
  type ConfidenceWeights,
} from './confidence-adapter.js';
import { fuseRrf } from './fusion.js';
import type { EmbeddingAdapter } from '@llm-corpus/inference';

export interface SearchOrchestratorInput {
  input: SearchInput;
  db: DatabaseType;
  embeddingAdapter: EmbeddingAdapter;
  weightsConfig?: ConfidenceWeights;
  /** Per-retriever top-K and per-call timeouts. */
  topKPerRetriever: number;
  /** Per-call SQL timeout (ms). */
  retrieverSqlTimeoutMs: number;
  /** Embedding HTTP timeout (ms). */
  embeddingHttpTimeoutMs: number;
  /** Whole-search budget (ms). */
  searchTotalTimeoutMs: number;
  /** Caller AbortSignal (e.g., MCP transport cancellation). */
  signal: AbortSignal;
  /**
   * Test-harness override — disable specific signals for the
   * SC-RETRIEVAL-003 fixture (signal-disable measurable-change check).
   */
  disabledSignals?: readonly RankingSignalName[];
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Build a child AbortSignal that fires when EITHER (a) the parent signal
 * fires, OR (b) `timeoutMs` elapses. Returns { signal, cleanup }; cleanup
 * MUST be called to clear the setTimeout and remove the parent listener
 * (Constitution VII forbids Promise.race(setTimeout)).
 */
export function abortChild(
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const child = new AbortController();
  const onParent = (): void => child.abort();
  if (parent.aborted) {
    child.abort();
  } else {
    parent.addEventListener('abort', onParent, { once: true });
  }
  const handle = setTimeout(() => child.abort(), timeoutMs);
  const cleanup = (): void => {
    clearTimeout(handle);
    parent.removeEventListener('abort', onParent);
  };
  return { signal: child.signal, cleanup };
}

/**
 * Fetch the SQL `documents` row for each doc_id; returns rows in the same
 * order as `docIds`. Missing rows are silently omitted (defense-in-depth
 * for race conditions during concurrent ingest).
 */
function loadDocumentsRows(
  db: DatabaseType,
  docIds: readonly string[],
): Array<{
  id: string;
  title: string;
  facet_domain: string;
  facet_type: string;
  tags_json: string;
  ingest_timestamp: string;
}> {
  if (docIds.length === 0) return [];
  const placeholders = docIds.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, title, facet_domain, facet_type, tags_json, ingest_timestamp
         FROM documents
        WHERE id IN (${placeholders}) AND status = 'success'`,
    )
    .all(...docIds) as Array<{
      id: string;
      title: string;
      facet_domain: string;
      facet_type: string;
      tags_json: string;
      ingest_timestamp: string;
    }>;
}

function loadFts5Snippets(
  db: DatabaseType,
  docIds: readonly string[],
): Map<string, string> {
  const map = new Map<string, string>();
  if (docIds.length === 0) return map;
  const placeholders = docIds.map(() => '?').join(', ');
  try {
    const rows = db
      .prepare(
        `SELECT doc_id, body_excerpt
           FROM documents_fts
          WHERE doc_id IN (${placeholders})`,
      )
      .all(...docIds) as Array<{ doc_id: string; body_excerpt: string }>;
    for (const r of rows) {
      const excerpt = (r.body_excerpt ?? '').slice(0, 200);
      map.set(r.doc_id, excerpt);
    }
  } catch (caught) {
    // Constitution XIII (Telemetry-or-Die): emit structured event before
    // falling through to empty-snippet defaults. Snippet failure is a
    // partial-outcome warning, not a search failure — BM25/dense/graph/
    // confidence retrievers already returned their hits successfully;
    // we're only enriching display text.
    const message = caught instanceof Error ? caught.message : String(caught);
    void emitTelemetry({
      event: 'search.snippet_fetch_failed',
      timestamp: new Date().toISOString(),
      severity: 'warn',
      outcome: 'failed',
      doc_id_count: docIds.length,
      message: message.slice(0, 512),
    });
  }
  return map;
}

function buildErrorEnvelope(
  code: SearchErrorEnvelope['error_code'],
  message: string,
  hint: string,
  echoQuery: string,
  filters?: SearchInput['filters'],
): SearchOutput {
  const envelope: SearchErrorEnvelope = {
    error_code: code,
    message: message.slice(0, 1024),
    hint: hint.slice(0, 1024),
  };
  return SearchOutputZodSchema.parse({
    hits: [],
    query: echoQuery,
    result_count: 0,
    tier_used: 'hybrid',
    signals_used: [],
    ...(filters ? { filters_applied: filters } : {}),
    error: envelope,
  });
}

const HINT_FOR: Record<SearchErrorEnvelope['error_code'], string> = {
  validation_error:
    'Check your input: query must be ≤ 2048 chars; filters keys must be one of facet_domain, facet_type, tags, since, until, source_type; limit must be in [1, 100].',
  embedding_unavailable:
    'Ollama embedding endpoint unreachable. Run `ollama pull nomic-embed-text` and ensure Ollama is running on http://localhost:11434.',
  index_unavailable:
    'SQLite index file unreadable. Check that `corpus drain` has run and the docs_fts / docs_vec tables exist.',
  query_aborted:
    'Query timed out. Consider tightening filters or retrying with a shorter query.',
  all_signals_failed:
    'Every retriever failed. Check Ollama and the index DB; the corpus may need re-indexing.',
  internal_error: 'Internal error in the retrieval orchestrator. See logs.',
};

export async function searchOrchestrator(
  input: SearchOrchestratorInput,
): Promise<SearchOutput> {
  const startedAt = Date.now();
  const echoQuery = input.input.query;
  const queryHash = sha256Hex(echoQuery);
  const weightsConfig = input.weightsConfig ?? DEFAULT_CONFIDENCE_WEIGHTS;
  const disabled = new Set<RankingSignalName>(input.disabledSignals ?? []);

  await emitTelemetry({
    event: 'search.started',
    timestamp: new Date().toISOString(),
    severity: 'info',
    outcome: 'success',
    query_hash: queryHash,
    has_filters: Boolean(input.input.filters),
    limit: input.input.limit,
  });

  // Master abort: parent signal + total budget.
  const total = abortChild(input.signal, input.searchTotalTimeoutMs);

  try {
    // ---- Embed the query (for dense retriever) ----
    let queryEmbedding: Float32Array | null = null;
    let denseError: string | undefined;
    if (!disabled.has('dense')) {
      const embedAbort = abortChild(total.signal, input.embeddingHttpTimeoutMs);
      try {
        const r = await input.embeddingAdapter.embedQuery(
          echoQuery,
          embedAbort.signal,
        );
        if (r.ok) {
          queryEmbedding = r.value;
        } else {
          denseError = r.error.message;
        }
      } finally {
        embedAbort.cleanup();
      }
    }

    // ---- Launch retrievers in parallel ----
    const fts5 = new Fts5Adapter(input.db);
    const vec = new VecAdapter(input.db);
    const graph = new GraphAdapter(input.db);
    const confidence = new ConfidenceAdapter(input.db);

    const childSignals: Array<{ cleanup: () => void }> = [];
    const makeChild = (): AbortSignal => {
      const c = abortChild(total.signal, input.retrieverSqlTimeoutMs);
      childSignals.push(c);
      return c.signal;
    };

    const bm25Promise: Promise<RankingSignal | string> = disabled.has('bm25')
      ? Promise.resolve({ kind: 'bm25', results: [], succeeded: true } as RankingSignal)
      : fts5
          .search({
            query: echoQuery,
            topK: input.topKPerRetriever,
            filters: input.input.filters,
            signal: makeChild(),
          })
          .then((r) =>
            r.ok
              ? r.value
              : ({ kind: 'bm25', results: [], succeeded: false, error: r.error.message } as RankingSignal),
          )
          .catch(
            (e) =>
              ({
                kind: 'bm25',
                results: [],
                succeeded: false,
                error: (e as Error).message,
              }) as RankingSignal,
          );

    const densePromise: Promise<RankingSignal> = disabled.has('dense')
      ? Promise.resolve({ kind: 'dense', results: [], succeeded: true })
      : queryEmbedding === null
        ? Promise.resolve({
            kind: 'dense',
            results: [],
            succeeded: false,
            error: denseError ?? 'embedding unavailable',
          })
        : vec
            .search({
              queryEmbedding,
              topK: input.topKPerRetriever,
              filters: input.input.filters,
              signal: makeChild(),
            })
            .then((r) =>
              r.ok
                ? r.value
                : ({
                    kind: 'dense',
                    results: [],
                    succeeded: false,
                    error: r.error.message,
                  } as RankingSignal),
            )
            .catch(
              (e) =>
                ({
                  kind: 'dense',
                  results: [],
                  succeeded: false,
                  error: (e as Error).message,
                }) as RankingSignal,
            );

    // BM25 + dense finish first → seed graph
    const [bm25, dense] = await Promise.all([bm25Promise, densePromise]);

    const bm25Sig = bm25 as RankingSignal;
    const denseSig = dense as RankingSignal;
    const seedIds = Array.from(
      new Set([
        ...bm25Sig.results.map((r) => r.doc_id),
        ...denseSig.results.map((r) => r.doc_id),
      ]),
    );

    const graphPromise: Promise<RankingSignal> = disabled.has('graph')
      ? Promise.resolve({ kind: 'graph', results: [], succeeded: true })
      : graph
          .search({
            seedDocIds: seedIds,
            topK: input.topKPerRetriever,
            filters: input.input.filters,
            signal: makeChild(),
          })
          .then((r) =>
            r.ok
              ? r.value
              : ({
                  kind: 'graph',
                  results: [],
                  succeeded: false,
                  error: r.error.message,
                } as RankingSignal),
          )
          .catch(
            (e) =>
              ({
                kind: 'graph',
                results: [],
                succeeded: false,
                error: (e as Error).message,
              }) as RankingSignal,
          );

    const graphSig = await graphPromise;

    // Build candidate union for the confidence retriever.
    const candidateUnion = Array.from(
      new Set([
        ...bm25Sig.results.map((r) => r.doc_id),
        ...denseSig.results.map((r) => r.doc_id),
        ...graphSig.results.map((r) => r.doc_id),
      ]),
    );

    const confidencePromise: Promise<RankingSignal> = disabled.has('confidence')
      ? Promise.resolve({ kind: 'confidence', results: [], succeeded: true })
      : confidence
          .score({
            docIds: candidateUnion,
            weightsConfig,
            signal: makeChild(),
          })
          .then((r) =>
            r.ok
              ? r.value
              : ({
                  kind: 'confidence',
                  results: [],
                  succeeded: false,
                  error: r.error.message,
                } as RankingSignal),
          )
          .catch(
            (e) =>
              ({
                kind: 'confidence',
                results: [],
                succeeded: false,
                error: (e as Error).message,
              }) as RankingSignal,
          );

    const confidenceSig = await confidencePromise;

    for (const c of childSignals) c.cleanup();

    const signalsArr: RankingSignal[] = [bm25Sig, denseSig, graphSig, confidenceSig];
    // Constitution XVI (Validation Honesty): disabled signals are
    // administratively off, NOT degraded. They appear in neither
    // `signals_used` (they didn't function) nor `degraded_signals`
    // (they weren't supposed to). The disabled-signal path through
    // `RankingSignal{succeeded: true, results: []}` keeps fusion
    // logic uniform; here we recategorize for honest reporting.
    const succeeded: RankingSignalName[] = signalsArr
      .filter((s) => s.succeeded && !disabled.has(s.kind))
      .map((s) => s.kind);
    const degraded: RankingSignalName[] = signalsArr
      .filter((s) => !s.succeeded && !disabled.has(s.kind))
      .map((s) => s.kind);

    // Total-failure envelope fires only when EVERY enabled signal failed —
    // if all 4 signals are disabled (degenerate test config), there are
    // 0 enabled signals; in that case fusion produces empty hits but
    // no error envelope is emitted.
    const enabledCount = 4 - disabled.size;
    if (enabledCount > 0 && degraded.length === enabledCount) {
      await emitTelemetry({
        event: 'search.error',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'failed',
        query_hash: queryHash,
        error_code: 'all_signals_failed',
        message: 'every retriever failed',
      });
      return buildErrorEnvelope(
        'all_signals_failed',
        'every retriever failed',
        HINT_FOR['all_signals_failed'],
        echoQuery,
        input.input.filters,
      );
    }

    // Compute the post-fusion confidence-multiplier map.
    const confidenceMap = new Map<string, number>();
    if (candidateUnion.length > 0) {
      const docRows = loadDocumentsRows(input.db, candidateUnion);
      for (const row of docRows) {
        confidenceMap.set(
          row.id,
          confidenceWeightFor(
            row.facet_type,
            row.ingest_timestamp,
            weightsConfig,
          ),
        );
      }
    }

    // ---- Run RRF fusion ----
    const fused = fuseRrf({
      signals: signalsArr,
      k: 60,
      confidenceWeights: confidenceMap,
      limit: input.input.limit,
    });

    // ---- Resolve to SearchHit shape ----
    const fusedDocIds = fused.map((f) => f.doc_id);
    const docRows = loadDocumentsRows(input.db, fusedDocIds);
    const docRowById = new Map(docRows.map((r) => [r.id, r]));
    const snippetMap = loadFts5Snippets(input.db, fusedDocIds);

    const hits: SearchHit[] = [];
    for (const f of fused) {
      const row = docRowById.get(f.doc_id);
      if (!row) continue; // race: doc deleted mid-query
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.tags_json) as string[];
      } catch {
        // leave empty
      }
      const candidate = {
        uri: `corpus://docs/${row.id}` as const,
        score: f.score,
        title: row.title,
        facet_domain: row.facet_domain,
        facet_type: row.facet_type,
        tags,
        snippet: snippetMap.get(row.id) ?? '',
        // SP-006: SearchHit.tier_used is REQUIRED. SP-005 retriever is the
        // Tier 0 hybrid implementation; all hits it produces carry this label.
        tier_used: 'hybrid' as const,
      };
      const parsed = SearchHitZodSchema.safeParse(candidate);
      if (parsed.success) {
        hits.push(parsed.data);
      }
      // Malformed candidate → silently drop; the search.completed event
      // result_count reflects only Zod-valid hits.
    }

    const elapsed = Date.now() - startedAt;

    // Emit search.query (FR-RETRIEVAL-013 — the canonical per-query event).
    await emitTelemetry({
      event: 'search.query',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      query_hash: queryHash,
      tier_used: 'hybrid',
      result_count: hits.length,
      signals_used: succeeded,
      duration_ms: elapsed,
    });

    // Partial degradation → emit search.degraded; full success → completed.
    if (degraded.length > 0) {
      await emitTelemetry({
        event: 'search.degraded',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'success',
        query_hash: queryHash,
        degraded_signals: degraded,
        error_codes: signalsArr
          .filter((s) => !s.succeeded)
          .map((s) => (s.error ?? 'unknown').slice(0, 256)),
      });
    } else {
      await emitTelemetry({
        event: 'search.completed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        query_hash: queryHash,
        result_count: hits.length,
        duration_ms: elapsed,
      });
    }

    const output: SearchOutput = SearchOutputZodSchema.parse({
      hits,
      query: echoQuery,
      result_count: hits.length,
      tier_used: 'hybrid',
      signals_used: succeeded,
      ...(degraded.length > 0 ? { degraded_signals: degraded } : {}),
      ...(input.input.filters ? { filters_applied: input.input.filters } : {}),
    });
    return output;
  } catch (caught) {
    const e = caught as Error;
    if (e.name === 'AbortError' || total.signal.aborted) {
      await emitTelemetry({
        event: 'search.error',
        timestamp: new Date().toISOString(),
        severity: 'error',
        outcome: 'aborted',
        query_hash: queryHash,
        error_code: 'query_aborted',
        message: 'search aborted',
      });
      return buildErrorEnvelope(
        'query_aborted',
        'search aborted',
        HINT_FOR['query_aborted'],
        echoQuery,
        input.input.filters,
      );
    }
    await emitTelemetry({
      event: 'search.error',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failed',
      query_hash: queryHash,
      error_code: 'internal_error',
      message: e.message.slice(0, 1024),
    });
    return buildErrorEnvelope(
      'internal_error',
      e.message,
      HINT_FOR['internal_error'],
      echoQuery,
      input.input.filters,
    );
  } finally {
    total.cleanup();
  }
}
