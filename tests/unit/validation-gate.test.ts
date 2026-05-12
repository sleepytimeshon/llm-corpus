// T024 (SP-003) — RED contract test for validateInboxFile.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-002
//   - specs/003-ingest-pipeline/contracts/validation-gate.feature
//   - SC-INGEST-007/008/009

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/validation-gate.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('validateInboxFile (T024 — Phase 2 RED)', () => {
  it('exports validateInboxFile', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.validateInboxFile).toBe('function');
  });

  it('runs filename sanity → extension → MIME-sniff → size in fixed order', async () => {
    expect.fail('Phase 3 (T058) required — validateInboxFile not yet implemented');
  });

  it('short-circuits on first failure', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('error_code matches the gate that fired first', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('emits inbox.* telemetry on every outcome', async () => {
    expect.fail('Phase 3 (T058) required');
  });

  it('bounded IO — no content read past max-size cutoff', async () => {
    expect.fail('Phase 3 (T058) required');
  });
});
