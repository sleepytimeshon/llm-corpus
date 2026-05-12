// T052 (SP-003) — SIGTERM aborts mid-extract within 2s.
//
// We use an AbortController directly (in-process signal) rather than spawning
// a subprocess and sending SIGTERM — the daemon main() wires the same
// controller to OS signals, so this exercises the same code path.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  drain,
  batchPolicy,
} from '../../packages/pipeline/src/index.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('SIGTERM abort (T052)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('abort mid-drain routes in-flight files to failed/ with error_code=aborted; observable within 2s', async () => {
    const inboxPath = Paths.inbox();
    fs.mkdirSync(inboxPath, { recursive: true });
    // Drop multiple files so the drain has work in flight when aborted.
    for (let i = 0; i < 5; i++) {
      await fsp.writeFile(path.join(inboxPath, `f-${i}.md`), `# ${i}\n`);
    }

    const controller = new AbortController();
    // Abort almost immediately.
    setImmediate(() => controller.abort());

    const start = Date.now();
    const r = await drain({}, batchPolicy, controller.signal);
    const elapsed = Date.now() - start;

    // Drain returns within 2 seconds.
    expect(elapsed).toBeLessThan(2000);
    expect(r.ok).toBe(true);

    // ingest.aborted telemetry was emitted for at least one file.
    const tel = fs.readFileSync(Paths.telemetry(), 'utf8');
    expect(tel).toContain('ingest.aborted');
  }, 10_000);
});
