// T032 (SP-003) — RED contract test for normalize-pdf (subprocess invocation).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//   - specs/003-ingest-pipeline/plan.md Decision F
//   - Constitution XII (subprocess hygiene)

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-pdf.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizePdf (T032 — Phase 2 RED)', () => {
  it('exports normalizePdf', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.normalizePdf).toBe('function');
  });

  it('invokes runTool(node, [tools/pdf-extractor/extract.mjs, --in, --out])', async () => {
    expect.fail('Phase 3 (T064) required — propagate AbortSignal; emit tool_invoked telemetry with binary "node" not full args');
  });

  it('propagates AbortSignal to the subprocess', async () => {
    expect.fail('Phase 3 (T064) required');
  });

  it('on subprocess success reads stdout-written body file', async () => {
    expect.fail('Phase 3 (T064) required');
  });
});
