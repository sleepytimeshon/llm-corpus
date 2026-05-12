// T028 (SP-003) — RED contract test for normalize-markdown.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006, SC-INGEST-003
//   - specs/003-ingest-pipeline/contracts/normalize.feature

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-markdown.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizeMarkdown (T028 — Phase 2 RED)', () => {
  it('exports normalizeMarkdown', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.normalizeMarkdown).toBe('function');
  });

  it('passes body verbatim', async () => {
    expect.fail('Phase 3 (T061) required — pure passthrough + frontmatter injection');
  });

  it('preserves user frontmatter via passthrough', async () => {
    expect.fail('Phase 3 (T061) required');
  });

  it('injects FR-008 minimum frontmatter (id, source_path, ingest_timestamp, mime_type, hash)', async () => {
    expect.fail('Phase 3 (T061) required');
  });

  it('output frontmatter id matches the input doc_id', async () => {
    expect.fail('Phase 3 (T061) required');
  });
});
