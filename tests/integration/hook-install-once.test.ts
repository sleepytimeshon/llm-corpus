// T041 — Integration test: hook installs exactly once per process.
// Source of truth: contracts/egress-hook-api.md §"installEgressHook"
//
// Calling installEgressHook() twice in the same process MUST throw
// EgressHookAlreadyInstalledError.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { installEgressHook } from '../../packages/transport/src/egress-hook.js';
import { EgressHookAlreadyInstalledError } from '@llm-corpus/contracts/errors';

describe('Hook install-once defense (T041)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-hook-once-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('first installEgressHook call succeeds; second throws EgressHookAlreadyInstalledError', () => {
    const handle1 = installEgressHook();
    dispose = () => handle1[Symbol.dispose]();

    let error: unknown;
    try {
      installEgressHook();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EgressHookAlreadyInstalledError);
  });

  it('after dispose, installEgressHook can be called again (test seam)', () => {
    const handle1 = installEgressHook();
    handle1[Symbol.dispose]();

    const handle2 = installEgressHook();
    dispose = () => handle2[Symbol.dispose]();
    // No error is the assertion
    expect(handle2).toBeDefined();
  });
});
