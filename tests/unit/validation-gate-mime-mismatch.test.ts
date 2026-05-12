// T025 (SP-003) — RED contract test: mime-mismatch detection.
//
// References:
//   - specs/003-ingest-pipeline/spec.md ADR-007, C-018 F-5
//   - specs/003-ingest-pipeline/contracts/validation-gate.feature

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/validation-gate.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('validateInboxFile MIME mismatch (T025 — Phase 2 RED)', () => {
  it('.md extension with %PDF magic bytes -> error_code mime_mismatch', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T058) required — assert sidecar records both .md extension and detected application/pdf MIME',
    );
  });

  it('sidecar records extension AND detected_mime', async () => {
    expect.fail('Phase 3 (T058/T059) required');
  });
});
