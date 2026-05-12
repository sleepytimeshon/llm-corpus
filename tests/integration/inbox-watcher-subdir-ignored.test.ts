// T023 (SP-003) — subdirectory files NOT triggered (depth: 0).

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

describe('InboxWatcher subdir ignored (T023)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('files under inbox/subdir/ are NOT detected (depth: 0)', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(path.join(inboxPath, 'subdir'), { recursive: true });

    const detected: string[] = [];
    const controller = new AbortController();
    const watcher = InboxWatcher({
      inboxPath,
      signal: controller.signal,
      onDetected: (p) => detected.push(p),
    });
    await watcher.ready();

    await fsp.writeFile(path.join(inboxPath, 'subdir', 'buried.pdf'), 'data');

    // Wait 2s.
    await new Promise<void>((r) => setTimeout(r, 2000));

    expect(detected.some((p) => p.includes('subdir'))).toBe(false);

    controller.abort();
    await watcher.close();
  }, 10_000);
});
