// SP-000-Lite Phase 2 (T012 + T013) — contract tests for the queries.yaml
// stratification linter (FR-PILOT-002/003/010/011/012, SC-002) and the
// Q3 ratification gate.
//
// TDD: `lintQuerySet`, `verifyQ3Ratified`, and `LinterError` exports do
// not exist in Phase 1; assertions fail at runtime until Phase 3 (T018, T019)
// lands.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T012, T013
//   - specs/000-nfr-008-pilot-lite/spec.md FR-PILOT-002/003/010/011/012
//   - specs/000-nfr-008-pilot-lite/contracts/query-set.feature

import { describe, it, expect } from 'vitest';

async function loadHarness(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import('@llm-corpus/pipeline')) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Build a well-formed in-memory queries.yaml object (50 entries). */
function buildValidQuerySet(): Record<string, unknown> {
  const queries: Array<Record<string, unknown>> = [];
  // 30 KG queries, all three patterns appear; 2 worked-examples per pattern.
  const patterns = ['factual_lookup', 'recall_by_context', 'multi_doc_synthesis'] as const;
  for (let i = 0; i < 30; i += 1) {
    const pattern = patterns[i % 3]!;
    const isWorked = i < 6; // first six (2 per pattern) are worked examples
    queries.push({
      query_id: `kg-${String(i + 1).padStart(3, '0')}`,
      query_text: `kg query ${i + 1}`,
      bucket: 'knowledge_grounded',
      retrieval_pattern: pattern,
      provenance: 'mined-from-MEMORY-WORK',
      worked_example_for: isWorked ? pattern : null,
    });
  }
  for (let i = 0; i < 15; i += 1) {
    queries.push({
      query_id: `g-${String(i + 1).padStart(3, '0')}`,
      query_text: `general query ${i + 1}`,
      bucket: 'general',
      retrieval_pattern: null,
      provenance: 'hand-crafted-general',
      worked_example_for: null,
    });
  }
  for (let i = 0; i < 5; i += 1) {
    queries.push({
      query_id: `adv-${String(i + 1).padStart(3, '0')}`,
      query_text: `adversarial query ${i + 1}`,
      bucket: 'adversarial',
      retrieval_pattern: null,
      provenance: 'hand-crafted-adversarial',
      worked_example_for: null,
    });
  }
  return { schema_version: '1.0.0', queries };
}

describe('SP-000-Lite T012 — queries.yaml stratification linter (FR-PILOT-002/003/010/011)', () => {
  it('lintQuerySet is exported from @llm-corpus/pipeline (Phase 3 T018)', async () => {
    const mod = await loadHarness();
    expect(mod).toBeDefined();
    expect(mod?.lintQuerySet).toBeDefined();
    expect(typeof mod?.lintQuerySet).toBe('function');
  });

  it('accepts a well-formed 30/15/5 query set with all three retrieval patterns', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    expect(lint).toBeDefined();
    if (!lint) return;
    const result = lint(buildValidQuerySet());
    expect(result.ok).toBe(true);
  });

  it('rejects a query set with 29 KG queries (FR-PILOT-002 deviation)', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    if (!lint) {
      expect(lint).toBeDefined();
      return;
    }
    const broken = buildValidQuerySet();
    (broken.queries as unknown[]).pop(); // drop one — KG count becomes 29? No: last is adversarial
    // Drop a KG specifically.
    broken.queries = (broken.queries as Array<Record<string, unknown>>).filter(
      (q, i) => !(q.bucket === 'knowledge_grounded' && i === 29),
    );
    const result = lint(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects a query set missing one of the three retrieval patterns', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    if (!lint) {
      expect(lint).toBeDefined();
      return;
    }
    const broken = buildValidQuerySet();
    // Rewrite all multi_doc_synthesis queries to factual_lookup.
    broken.queries = (broken.queries as Array<Record<string, unknown>>).map((q) =>
      q.retrieval_pattern === 'multi_doc_synthesis'
        ? { ...q, retrieval_pattern: 'factual_lookup' }
        : q,
    );
    const result = lint(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects a general-bucket query with non-null retrieval_pattern', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    if (!lint) {
      expect(lint).toBeDefined();
      return;
    }
    const broken = buildValidQuerySet();
    const qs = broken.queries as Array<Record<string, unknown>>;
    const firstGeneral = qs.find((q) => q.bucket === 'general')!;
    firstGeneral.retrieval_pattern = 'factual_lookup';
    const result = lint(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate query_id', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    if (!lint) {
      expect(lint).toBeDefined();
      return;
    }
    const broken = buildValidQuerySet();
    const qs = broken.queries as Array<Record<string, unknown>>;
    qs[1]!.query_id = qs[0]!.query_id;
    const result = lint(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects KG query with wrong provenance', async () => {
    const mod = await loadHarness();
    const lint = mod?.lintQuerySet as ((y: unknown) => Record<string, unknown>) | undefined;
    if (!lint) {
      expect(lint).toBeDefined();
      return;
    }
    const broken = buildValidQuerySet();
    const qs = broken.queries as Array<Record<string, unknown>>;
    qs[0]!.provenance = 'hand-crafted-general';
    const result = lint(broken);
    expect(result.ok).toBe(false);
  });
});

