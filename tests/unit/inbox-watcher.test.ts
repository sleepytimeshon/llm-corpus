// T021 (SP-003) — RED contract test for InboxWatcher.
//
// References:
//   - specs/003-ingest-pipeline/contracts/inbox-watcher.feature
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-001
//   - specs/003-ingest-pipeline/plan.md Decision E (chokidar)
//
// Module under test: packages/pipeline/src/inbox-watcher.ts — does NOT yet
// exist. This test imports lazily and fails-by-design at the import or
// assertion level until Dispatch B implements T070.

import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../packages/pipeline/src/inbox-watcher.js';

async function loadModule(): Promise<Record<string, unknown> | null> {
  try {
    return (await import(MODULE_PATH)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe('InboxWatcher (T021 — Phase 2 RED, Dispatch A scaffolding)', () => {
  it('exports InboxWatcher constructor', async () => {
    const mod = await loadModule();
    // RED by design — module does not exist until Dispatch B (T070).
    expect(mod).not.toBeNull();
    expect(typeof mod?.InboxWatcher).toBe('function');
  });

  it('honors awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }', async () => {
    const mod = await loadModule();
    expect(mod).not.toBeNull();
    // Constructor signature contract: accepts { inboxPath, signal, policy, onDetected }
    // Verified properly once T070 lands.
    expect.fail('Phase 3 (T070) required — InboxWatcher not yet implemented');
  });

  it('depth: 0 — subdirectory files do NOT trigger', async () => {
    expect.fail('Phase 3 (T070) required — InboxWatcher not yet implemented');
  });

  it('on inotify ENOSPC emits inbox.watcher_resource_exhausted + throws WatcherError', async () => {
    expect.fail('Phase 3 (T070) required — InboxWatcher not yet implemented');
  });
});
