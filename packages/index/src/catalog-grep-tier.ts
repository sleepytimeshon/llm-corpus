// SP-006 T049 — Tier 2 in-process CATALOG.md grep retriever.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-014
//   - specs/006-hardening/contracts/adr-tier-fallthrough.md §"Tier 2"
//   - specs/006-hardening/data-model.md §"Entity 3 + 8"
//   - Constitution Principles V, VII
//
// Reads `Paths.data() + '/CATALOG.md'` line-by-line (in-process; NO
// subprocess), case-insensitive substring match against the query, parses
// each matching line back into a SearchHit. If CATALOG.md is absent,
// emits `search.tier_skipped` and returns outcome='skipped'.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  SearchHitZodSchema,
  emitTelemetry,
  type SearchInput,
  type SearchHit,
  type FacetType,
} from '@llm-corpus/contracts';
import type { TierResult } from './bm25-only-tier.js';

export interface CatalogGrepInput {
  input: SearchInput;
  signal: AbortSignal;
}

const PIPE_ESCAPE = '‖';

/**
 * Run Tier 2 — CATALOG.md grep. Reads the flat-file CATALOG.md and applies
 * case-insensitive substring match against the query terms. Each matching
 * line is parsed back into a SearchHit with `tier_used='catalog-grep'`.
 *
 * Skip-not-throw: if CATALOG.md is missing, returns `outcome='skipped'` and
 * emits `search.tier_skipped` with `reason='catalog_missing'`.
 */
export async function runCatalogGrepTier(
  input: CatalogGrepInput,
): Promise<TierResult> {
  const start = Date.now();
  if (input.signal.aborted) {
    return {
      tier: 'catalog-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'aborted',
    };
  }

  const catalog = path.join(Paths.data(), 'CATALOG.md');
  let raw: string;
  try {
    raw = await fsp.readFile(catalog, 'utf8');
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      await emitTelemetry({
        event: 'search.tier_skipped',
        timestamp: new Date().toISOString(),
        severity: 'warn',
        outcome: 'success',
        tier: 'catalog-grep',
        reason: 'catalog_missing',
      });
      return {
        tier: 'catalog-grep',
        hits: [],
        elapsed_ms: Date.now() - start,
        outcome: 'skipped',
      };
    }
    const message =
      caught instanceof Error ? caught.message : String(caught);
    return {
      tier: 'catalog-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'failed',
      error: message.slice(0, 256),
    };
  }

  if (input.signal.aborted) {
    return {
      tier: 'catalog-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'aborted',
    };
  }

  const query = input.input.query.trim().toLowerCase();
  if (query.length === 0) {
    return {
      tier: 'catalog-grep',
      hits: [],
      elapsed_ms: Date.now() - start,
      outcome: 'completed',
    };
  }

  const limit = input.input.limit ?? 20;
  const lines = raw.split('\n');
  const hits: SearchHit[] = [];
  for (const line of lines) {
    if (input.signal.aborted) {
      return {
        tier: 'catalog-grep',
        hits,
        elapsed_ms: Date.now() - start,
        outcome: 'aborted',
      };
    }
    if (line.length === 0) continue;
    if (!line.toLowerCase().includes(query)) continue;
    const parsed = parseCatalogLine(line);
    if (!parsed) continue;
    const candidate = {
      uri: `corpus://docs/${parsed.doc_id}` as const,
      score: 1,
      title: parsed.title,
      facet_domain: parsed.facet_domain,
      facet_type: parsed.facet_type as FacetType,
      tags: [] as string[],
      snippet: parsed.summary.slice(0, 200),
      tier_used: 'catalog-grep' as const,
    };
    const validated = SearchHitZodSchema.safeParse(candidate);
    if (validated.success) {
      hits.push(validated.data);
      if (hits.length >= limit) break;
    }
  }

  return {
    tier: 'catalog-grep',
    hits,
    elapsed_ms: Date.now() - start,
    outcome: 'completed',
  };
}

interface ParsedCatalogLine {
  doc_id: string;
  title: string;
  facet_domain: string;
  facet_type: string;
  summary: string;
}

/**
 * Parse a CATALOG.md line of the form:
 *   <doc-id> | <title> | <facet_domain> | <facet_type> | <summary>
 *
 * Returns null on malformed lines (insufficient fields, doc_id regex
 * mismatch). The "‖" U+2016 escape is restored to "|" for display fidelity.
 */
function parseCatalogLine(line: string): ParsedCatalogLine | null {
  const parts = line.split(' | ');
  if (parts.length < 5) return null;
  const docId = (parts[0] ?? '').trim();
  if (!/^doc-[0-9a-f]{8}$/.test(docId)) return null;
  const title = unescapePipe((parts[1] ?? '').trim());
  const facetDomain = unescapePipe((parts[2] ?? '').trim());
  const facetType = (parts[3] ?? '').trim();
  // Re-join any extra " | " in the summary that survived the spec format.
  const summary = unescapePipe(parts.slice(4).join(' | ').trim());
  if (!facetDomain || !facetType) return null;
  return {
    doc_id: docId,
    title,
    facet_domain: facetDomain,
    facet_type: facetType,
    summary,
  };
}

function unescapePipe(s: string): string {
  return s.split(PIPE_ESCAPE).join('|');
}
