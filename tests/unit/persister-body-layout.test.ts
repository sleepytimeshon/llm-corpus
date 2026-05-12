// T040 (SP-003) — RED contract test: body file layout under Paths.docsStore().
//
// References:
//   - specs/003-ingest-pipeline/plan.md Decision I (256-way sharding)
//   - SP-002 reader contract (documents.body_path relative to Paths.docs())

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/persister.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('persist body layout (T040 — Phase 2 RED)', () => {
  it('body file path is Paths.docsStore() + /<id-prefix>/<doc-id>.md', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T068) required — id-prefix = doc_id.slice(4, 6); body file at Paths.docsStore() + /<id-prefix>/<doc-id>.md',
    );
  });

  it('documents.body_path stores relative path store/<id-prefix>/<doc-id>.md', async () => {
    expect.fail('Phase 3 (T068) required');
  });

  it("SP-002 fetchDocument can dereference the row's body_path against Paths.docs()", async () => {
    expect.fail('Phase 3 (T068) required');
  });
});
