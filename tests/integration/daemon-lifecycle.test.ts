// T056 (SP-003) — daemon lifecycle + SIGTERM wiring.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { main as daemonMain } from '../../packages/daemon/src/index.js';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('daemon lifecycle (T056)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('daemon main(): starts, processes inbox, exits cleanly on abort', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    await fsp.writeFile(path.join(inboxPath, 'pre.md'), '# pre\n');

    const controller = new AbortController();
    // Abort after 1 second so daemon has time to do initial drain.
    setTimeout(() => controller.abort(), 1000);

    const exitCode = await daemonMain({ noExit: true, controller });
    expect(exitCode).toBe(0);

    // The pre-existing file was ingested.
    const db = openIndexReadWrite();
    const count = (db
      .prepare(`SELECT COUNT(*) AS c FROM documents WHERE status = 'success'`)
      .get() as { c: number }).c;
    db.close();
    expect(count).toBeGreaterThanOrEqual(1);
  }, 10_000);
});
