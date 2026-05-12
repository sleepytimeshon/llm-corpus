// T005 (SP-003 PREREQ-005) — Contract test for withTempDir export from
// packages/contracts/.
//
// Verifies that withTempDir is exported from the contracts package's index;
// creates a tmp dir under Paths.cache() (NEVER os.tmpdir()); cleans up on
// success, exception, and abort signal. Tmp suffix matches the documented
// pattern `.tmp.<pid>.<rand4hex>`.
//
// Spec references:
//   - specs/003-ingest-pipeline/plan.md PREREQ-005
//   - Constitution Principle VIII (atomic writes) + XIV (XDG paths)
//
// TDD: this test MUST FAIL before T011 (the implementation) lands.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';

describe('PREREQ-005 — withTempDir re-export (contract)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testCorpusHome: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Use a CORPUS_HOME under $HOME (NOT os.tmpdir()) so we can prove
    // Paths.cache() does not point at /tmp.
    testCorpusHome = path.join(
      os.homedir(),
      '.cache',
      'sp003-tmp-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    );
    fs.mkdirSync(testCorpusHome, { recursive: true });
    process.env.CORPUS_HOME = testCorpusHome;
  });

  afterEach(() => {
    fs.rmSync(testCorpusHome, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it('withTempDir is exported from packages/contracts (re-export)', async () => {
    const mod = (await import(
      '../../packages/contracts/src/index.js'
    )) as Record<string, unknown>;
    expect(typeof mod.withTempDir).toBe('function');
  });

  it('creates a tmp dir under Paths.cache() (NOT os.tmpdir())', async () => {
    const { withTempDir, Paths } = (await import(
      '../../packages/contracts/src/index.js'
    )) as unknown as {
      withTempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
      Paths: { cache: () => string };
    };
    const observed: string[] = [];
    await withTempDir(async (dir) => {
      observed.push(dir);
    });
    expect(observed.length).toBe(1);
    expect(observed[0].startsWith(Paths.cache())).toBe(true);
    expect(observed[0].startsWith(os.tmpdir())).toBe(false);
  });

  it('tmp suffix matches `.tmp.<pid>.<rand4hex>` pattern', async () => {
    const { withTempDir } = (await import(
      '../../packages/contracts/src/index.js'
    )) as unknown as {
      withTempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
    };
    let observed = '';
    await withTempDir(async (dir) => {
      observed = dir;
    });
    const basename = path.basename(observed);
    // Pattern: .tmp.<pid>.<rand4hex>
    expect(basename).toMatch(/^\.tmp\.\d+\.[0-9a-f]{4}$/);
  });

  it('cleans up the tmp dir on success', async () => {
    const { withTempDir } = (await import(
      '../../packages/contracts/src/index.js'
    )) as unknown as {
      withTempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
    };
    let observed = '';
    await withTempDir(async (dir) => {
      observed = dir;
      // Write a file to confirm dir exists
      await fsp.writeFile(path.join(dir, 'foo.txt'), 'bar');
    });
    expect(observed.length).toBeGreaterThan(0);
    expect(fs.existsSync(observed)).toBe(false);
  });

  it('cleans up the tmp dir on exception inside the callback', async () => {
    const { withTempDir } = (await import(
      '../../packages/contracts/src/index.js'
    )) as unknown as {
      withTempDir: <T>(fn: (dir: string) => Promise<T>) => Promise<T>;
    };
    let observed = '';
    await expect(
      withTempDir(async (dir) => {
        observed = dir;
        throw new Error('synthetic');
      }),
    ).rejects.toThrow(/synthetic/);
    expect(observed.length).toBeGreaterThan(0);
    expect(fs.existsSync(observed)).toBe(false);
  });

  it('cleans up on abort signal (SIGTERM simulation)', async () => {
    const { withTempDir } = (await import(
      '../../packages/contracts/src/index.js'
    )) as unknown as {
      withTempDir: <T>(
        fn: (dir: string) => Promise<T>,
        opts?: { signal?: AbortSignal },
      ) => Promise<T>;
    };
    const controller = new AbortController();
    let observed = '';
    const promise = withTempDir(
      async (dir) => {
        observed = dir;
        // Wait long enough for the abort to trigger
        await new Promise((_resolve, reject) => {
          const onAbort = (): void => {
            reject(new Error('aborted'));
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      { signal: controller.signal },
    );
    // Trigger abort after the callback starts
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(observed.length).toBeGreaterThan(0);
    // Cleanup must have happened
    expect(fs.existsSync(observed)).toBe(false);
  });
});
