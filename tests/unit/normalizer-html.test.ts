// T030 (SP-003) — RED contract test for normalize-html.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//   - specs/003-ingest-pipeline/plan.md Decision G (turndown)

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/extract/src/normalize-html.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('normalizeHtml (T030 — Phase 2 RED)', () => {
  it('exports normalizeHtml', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect(typeof mod?.normalizeHtml).toBe('function');
  });

  it('turndown invoked with frozen rule set (no plugins, no custom rules)', async () => {
    expect.fail('Phase 3 (T063) required — TurndownService({ headingStyle: atx, codeBlockStyle: fenced }); no service.use; no service.addRule');
  });

  it('deterministic output across two runs on same input', async () => {
    expect.fail('Phase 3 (T063) required');
  });

  it('in-process (no subprocess)', async () => {
    expect.fail('Phase 3 (T063) required');
  });
});
