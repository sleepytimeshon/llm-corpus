// T034 (SP-003) — RED contract test for normalize dispatcher.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalize dispatcher (T034 — Phase 2 RED)', () => {
  it('exports normalize(pendingPath, mimeType, signal)', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.normalize).toBe('function');
  });

  it('dispatches application/pdf to normalizePdf', async () => {
    expect.fail('Phase 3 (T065) required — per-MIME dispatcher');
  });

  it('dispatches text/markdown to normalizeMarkdown', async () => {
    expect.fail('Phase 3 (T065) required');
  });

  it('dispatches text/plain to normalizeText', async () => {
    expect.fail('Phase 3 (T065) required');
  });

  it('dispatches text/html to normalizeHtml', async () => {
    expect.fail('Phase 3 (T065) required');
  });
});
