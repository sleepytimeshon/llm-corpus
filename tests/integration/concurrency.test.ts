// T043 (SP-003) — concurrent drain processes.
//
// We simulate concurrent drains by acquiring the lock with a foreign PID
// (current process's PID — which is by definition alive). A subsequent
// drain() call must emit pipeline.lock_contention + exit 0 with
// summary.lockContended === 1.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
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

describe('concurrent drain processes (T043)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('drain with held lock emits pipeline.lock_contention and exits 0 with lockContended=1', async () => {
    // Pre-create the lock file with current PID (always alive).
    const lockPath = Paths.drainLock();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));

    const r = await drain({}, batchPolicy, new AbortController().signal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lockContended).toBe(1);
    }

    // pipeline.lock_contention telemetry emitted.
    const tel = fs.readFileSync(Paths.telemetry(), 'utf8');
    expect(tel).toContain('pipeline.lock_contention');

    // Clean up.
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
  }, 15_000);
});
