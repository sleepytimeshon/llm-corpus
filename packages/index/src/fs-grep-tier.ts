// SP-006 T050 — Tier 3 fs-grep retriever (Constitution XII subprocess hygiene).
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-015
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 3"
//   - Constitution Principles V, VII, XII
//
// Invokes POSIX `grep` over `Paths.docs()` via `runTool('grep', [argArray])`
// — NEVER a shell-string exec (Constitution XII). Matched file paths are
// reverse-mapped to doc_ids via `SELECT id FROM documents WHERE body_path=?`.
// Returns hits with `tier_used='fs-grep'`. On ENOENT (grep absent), emits
// `search.tier_skipped` (reason='grep_unavailable') and returns empty. On
// non-zero exit with stderr, emits `search.tier_failed` and returns empty.

import * as fsp from 'node:fs/promises';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  Paths,
  SearchHitZodSchema,
  emitTelemetry,
  runTool,
  type SearchInput,
  type SearchHit,
  type FacetType,
} from '@llm-corpus/contracts';
import type { TierResult } from './bm25-only-tier.js';

export interface FsGrepInput {
  input: SearchInput;
  db: DatabaseType;
  timeoutMs: number;
  signal: AbortSignal;
}

/**
 * BRE escape for grep — backslash-escape characters that have BRE semantics.
 * Keep it minimal: meta characters \ [ ^ $ . | * + ( ) ? { }.
 */
function escapeBre(pattern: string): string {
  return pattern.replace(/([\\[\]^$.|*+(){}?])/g, '\\$1');
}

/**
 * Run Tier 3 — POSIX grep subprocess over `Paths.docs()`. Maps matched file
 * paths to doc_ids via the documents.body_path SQL lookup.
 */
export async function runFsGrepTier(input: FsGrepInput): Promise<TierResult> {
  const start = Date.now();
  if (input.signal.aborted) {
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'aborted',
    };
  }

  // If the docs root doesn't exist there's nothing to grep — emit skipped.
  const docsRoot = Paths.docs();
  try {
    await fsp.stat(docsRoot);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      await emitTelemetry({
        event: 'search.tier_skipped',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'success',
        tier: 'fs-grep',
        reason: 'grep_unavailable',
      });
      return {
        tier: 'fs-grep',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'skipped',
      };
    }
  }

  const queryTrimmed = input.input.query.trim();
  if (queryTrimmed.length === 0) {
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'completed',
    };
  }

  // Use the docsStore root if present (SP-005 canonical layout); else fall
  // back to Paths.docs() which is the umbrella.
  const grepTarget = Paths.docsStore();
  try {
    await fsp.stat(grepTarget);
  } catch {
    // docsStore may not exist on legacy corpora; fall back to docs() root.
  }

  const pattern = escapeBre(queryTrimmed);
  const grepArgs = [
    '-r', // recursive
    '-l', // list filenames only
    '-i', // case-insensitive
    '--include=*.md',
    pattern,
    grepTarget,
  ];

  const r = await runTool('grep', grepArgs, {
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });

  if (input.signal.aborted) {
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'aborted',
    };
  }

  if (!r.ok) {
    const e = r.error;
    if (e.code === 'SPAWN_FAILED') {
      // grep binary absent → skip telemetry + empty hits.
      await emitTelemetry({
        event: 'search.tier_skipped',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'success',
        tier: 'fs-grep',
        reason: 'grep_unavailable',
      });
      return {
        tier: 'fs-grep',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'skipped',
      };
    }
    // grep exits with code 1 when no lines matched — that's "no hits", not
    // an error. Code ≥ 2 is a genuine failure (per POSIX grep).
    if (e.code === 'EXIT_NONZERO' && e.exitCode === 1) {
      return {
        tier: 'fs-grep',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'completed',
      };
    }
    if (e.code === 'ABORTED' || e.code === 'TIMEOUT') {
      return {
        tier: 'fs-grep',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'aborted',
      };
    }
    // Non-zero exit ≥ 2 with stderr → failed.
    await emitTelemetry({
      event: 'search.tier_failed',
      timestamp: new Date().toISOString(),
      severity: 'warn',
      outcome: 'failed',
      tier: 'fs-grep',
      errno: e.code,
      error_code: 'grep_subprocess_error',
      duration_ms: Date.now() - start,
    });
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'failed',
      error: e.message.slice(0, 256),
    };
  }

  const stdoutLines = r.value.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (stdoutLines.length === 0) {
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'completed',
    };
  }

  // Reverse-map file paths → doc_ids via documents.body_path lookup.
  const placeholders = stdoutLines.map(() => '?').join(', ');
  type DocRow = {
    id: string;
    title: string;
    facet_domain: string;
    facet_type: string;
    tags_json: string;
    body_path: string;
  };
  let rows: DocRow[];
  try {
    rows = input.db
      .prepare(
        `SELECT id, title, facet_domain, facet_type, tags_json, body_path
           FROM documents
          WHERE body_path IN (${placeholders})
            AND status = 'success'`,
      )
      .all(...stdoutLines) as DocRow[];
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return {
      tier: 'fs-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'failed',
      error: message.slice(0, 256),
    };
  }

  const limit = input.input.limit ?? 20;
  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (hits.length >= limit) break;
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // empty
    }
    const candidate = {
      uri: `corpus://docs/${row.id}` as const,
      score: 1,
      title: row.title,
      facet_domain: row.facet_domain,
      facet_type: row.facet_type as FacetType,
      tags,
      snippet: queryTrimmed.slice(0, 200),
      tier_used: 'fs-grep' as const,
    };
    const validated = SearchHitZodSchema.safeParse(candidate);
    if (validated.success) {
      hits.push(validated.data);
    }
  }

  return {
    tier: 'fs-grep',
    hits,
    elapsed_ms: Date.now() - start,
    outcome: 'completed',
  };
}
