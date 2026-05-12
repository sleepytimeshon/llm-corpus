// T022 (SP-003) — InboxWatcher initial-scan.

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

describe('InboxWatcher initial-scan (T022)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('detects pre-existing files within 5s of watcher start', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });

    // Pre-populate.
    await fsp.writeFile(path.join(inboxPath, 'pre-a.md'), '# a\n');
    await fsp.writeFile(path.join(inboxPath, 'pre-b.md'), '# b\n');

    const detected: string[] = [];
    const controller = new AbortController();
    const watcher = InboxWatcher({
      inboxPath,
      signal: controller.signal,
      onDetected: (p) => detected.push(p),
    });
    await watcher.ready();

    // Wait up to 5s for the initial-scan detections.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && detected.length < 2) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    expect(detected.length).toBeGreaterThanOrEqual(2);
    const names = detected.map((p) => path.basename(p)).sort();
    expect(names).toContain('pre-a.md');
    expect(names).toContain('pre-b.md');

    controller.abort();
    await watcher.close();
  }, 10_000);
});
