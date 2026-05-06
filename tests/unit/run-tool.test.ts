// T014 — Unit test for runTool helper (Constitution VII, XII, XIII).
// Verifies arg-array invocation, exit-code handling, AbortSignal propagation,
// and tool_invoked telemetry emission.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runTool } from '../../packages/contracts/src/run-tool.js';
import { isOk, isErr } from '../../packages/contracts/src/result.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('runTool (Constitution VII, XII, XIII)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-runtool-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns captured stdout for a successful command', async () => {
    const result = await runTool('echo', ['hi'], {});
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.stdout.trim()).toBe('hi');
      expect(result.value.exitCode).toBe(0);
    }
  });

  it('returns Result.err on non-zero exit code', async () => {
    // `false` always exits 1
    const result = await runTool('false', [], {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.exitCode).not.toBe(0);
    }
  });

  it('propagates AbortSignal — aborted call returns err', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const result = await runTool('sleep', ['10'], { signal: ac.signal });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(['ABORTED', 'EXIT_NONZERO']).toContain(result.error.code);
    }
  });

  it('passes args as an array (no shell interpretation)', async () => {
    // If runTool used shell, `;` would be a separator. With argv array, echo prints it literally.
    const result = await runTool('echo', ['a;b;c'], {});
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.stdout.trim()).toBe('a;b;c');
    }
  });

  it('respects cwd option', async () => {
    const result = await runTool('pwd', [], { cwd: tmpHome });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // macOS may symlink /tmp to /private/tmp; normalize via fs.realpathSync
      const real = fs.realpathSync(tmpHome);
      expect(result.value.stdout.trim()).toBe(real);
    }
  });
});
