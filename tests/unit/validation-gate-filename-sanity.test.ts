// T027 (SP-003) — RED contract test: filename sanity rejection BEFORE content read.
//
// References:
//   - specs/003-ingest-pipeline/spec.md SC-INGEST-009
//   - Constitution VII bounded IO

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/validation-gate.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('validateInboxFile filename sanity (T027 — Phase 2 RED)', () => {
  it('null-byte names rejected BEFORE any content read', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T058) required — null bytes, path-traversal sequences, control chars, zero-length names all rejected with error_code filename_sanity_failed',
    );
  });

  it('path-traversal sequences (..) rejected', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('control characters in name rejected', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('zero-length names rejected', async () => {
    expect.fail('Phase 3 (T058) required');
  });
});
