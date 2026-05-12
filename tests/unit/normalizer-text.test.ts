// T029 (SP-003) — RED contract test for normalize-text.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-text.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizeText (T029 — Phase 2 RED)', () => {
  it('exports normalizeText', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.normalizeText).toBe('function');
  });

  it('wraps plain text in minimal Markdown structure', async () => {
    expect.fail('Phase 3 (T062) required — wrap UTF-8 plain text in ---<frontmatter>--- minimal Markdown');
  });

  it('body bytes (post-frontmatter) are byte-identical to source', async () => {
    expect.fail('Phase 3 (T062) required');
  });
});
