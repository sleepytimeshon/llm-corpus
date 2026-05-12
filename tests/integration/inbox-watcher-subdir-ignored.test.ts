// T023 (SP-003) — RED integration test: subdirectory files NOT triggered.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001 v1 scope (depth: 0)
//   - specs/003-ingest-pipeline/contracts/inbox-watcher.feature

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/inbox-watcher.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('InboxWatcher subdir ignored (T023 — Phase 2 RED)', () => {
  it('files under Paths.inbox()/subdir/ are NOT detected (depth: 0)', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T070) required — drop buried.pdf under Paths.inbox()/subdir/ and assert NO add event fires; NO documents row created',
    );
  });
});
