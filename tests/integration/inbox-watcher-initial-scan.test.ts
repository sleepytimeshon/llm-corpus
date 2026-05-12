// T022 (SP-003) — RED integration test for InboxWatcher initial-scan.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001 "Drop-during-init"
//   - specs/003-ingest-pipeline/contracts/inbox-watcher.feature
//
// Pre-populate Paths.inbox() with 2 files BEFORE starting the watcher;
// assert both are detected on initial-scan within 5 seconds.

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/inbox-watcher.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('InboxWatcher initial-scan (T022 — Phase 2 RED)', () => {
  it('detects pre-existing files within 5s of watcher start', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    expect.fail(
      'Phase 3 (T070) required — InboxWatcher not yet implemented; ' +
        'integration test pre-populates Paths.inbox() and asserts initial-scan detection',
    );
  });

  it('no file is silently skipped on initial scan', async () => {
    expect.fail('Phase 3 (T070) required');
  });
});
