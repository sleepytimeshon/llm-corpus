// T021 (SP-003) — InboxWatcher.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { InboxWatcher } from '../../packages/pipeline/src/inbox-watcher.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('InboxWatcher (T021)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports InboxWatcher constructor', () => {
    expect(typeof InboxWatcher).toBe('function');
  });

  it('detects a newly dropped file', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    const detected: string[] = [];
    const controller = new AbortController();
    const watcher = InboxWatcher({
      inboxPath,
      signal: controller.signal,
      onDetected: (p) => detected.push(p),
    });
    await watcher.ready();

    const file = path.join(inboxPath, 'new.md');
    await fsp.writeFile(file, '# fresh\n');

    // Wait up to 5s for awaitWriteFinish (stabilityThreshold=500ms).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && detected.length === 0) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    expect(detected.length).toBeGreaterThanOrEqual(1);
    expect(detected[0]).toContain('new.md');

    controller.abort();
    await watcher.close();
  }, 10_000);
});
