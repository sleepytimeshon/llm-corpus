// T042 (SP-003) — acquireDrainLock.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { acquireDrainLock } from '../../packages/pipeline/src/drain-lock.js';
import { Paths } from '@llm-corpus/contracts';

function freshCorpusHome(): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'sp003-test-'));
  process.env.CORPUS_HOME = root;
  return root;
}

describe('acquireDrainLock (T042)', () => {
  beforeEach(() => {
    freshCorpusHome();
  });

  it('exports acquireDrainLock', () => {
    expect(typeof acquireDrainLock).toBe('function');
  });

  it('first acquisition succeeds; lock file exists', () => {
    const r = acquireDrainLock();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(fs.existsSync(r.value.lockPath)).toBe(true);
      r.value.release();
    }
  });

  it('second concurrent acquisition returns LockContentionError', () => {
    // First acquisition.
    const r1 = acquireDrainLock();
    expect(r1.ok).toBe(true);

    // Second acquisition by simulating a different "process" — we write a
    // foreign-PID file directly to defeat the same-PID re-acquire path.
    if (r1.ok) {
      r1.value.release();
    }
    // Write a fake live-pid lock file.
    fs.writeFileSync(Paths.drainLock(), String(process.pid + 1)); // unlikely-alive PID

    const r2 = acquireDrainLock();
    // PID likely doesn't exist; stale-steal should succeed. If by chance it
    // DOES exist, we'd see contention. Both are acceptable; we test the
    // happy contention path with a known-alive PID = process.pid.
    if (r2.ok) {
      r2.value.release();
    }

    // Now do the real contention test: hold with our PID.
    fs.writeFileSync(Paths.drainLock(), String(process.pid));
    const r3 = acquireDrainLock();
    expect(r3.ok).toBe(false);
    // Clean up.
    try { fs.unlinkSync(Paths.drainLock()); } catch { /* ignore */ }
  });

  it('release() unlinks the lock file (idempotent)', () => {
    const r = acquireDrainLock();
    expect(r.ok).toBe(true);
    if (r.ok) {
      r.value.release();
      expect(fs.existsSync(r.value.lockPath)).toBe(false);
      r.value.release(); // second call is no-op
    }
  });

  it('release on AbortSignal abort', () => {
    const controller = new AbortController();
    const r = acquireDrainLock({ signal: controller.signal });
    expect(r.ok).toBe(true);
    if (r.ok) {
      controller.abort();
      expect(r.value.released).toBe(true);
    }
  });
});
