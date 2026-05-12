// T033 (SP-003) — RED contract test: PDF subprocess timeout → SIGKILL.
//
// References:
//   - specs/003-ingest-pipeline/plan.md R2
//   - Constitution VII bounded IO

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-pdf.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizePdf timeout (T033 — Phase 2 RED)', () => {
  it('malicious PDF that hangs → 60s timeout → SIGKILL → Result.err(ToolInvocationError(TIMEOUT))', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T064/T066) required — subprocess timeout returns error_code extract_failed',
    );
  });
});
