// T039 (SP-003) — RED contract test: sentinel column values + CHECK constraints.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-008
//   - specs/003-ingest-pipeline/data-model.md Entity 9 row mapping

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/persister.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('persist sentinel columns (T039 — Phase 2 RED)', () => {
  it('documents row has facet_domain="", tags_json="[]", facet_type="unclassified", source_type="inbox-filesystem"', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail('Phase 3 (T068) required — assert row passes schema-migration CHECK constraints');
  });

  it('row passes the documents CHECK (id GLOB ...) constraint', async () => {
    expect.fail('Phase 3 (T068) required');
  });
});
