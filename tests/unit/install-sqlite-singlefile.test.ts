// SP-007 T023 — RED-phase contract test for `setupSingleFileSqlite`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { setupSingleFileSqlite } from '../../packages/cli/src/install-helpers/sqlite-singlefile.js';
import { Paths } from '@llm-corpus/contracts';

async function makeCorpusHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-sqlite-'));
  process.env.CORPUS_HOME = dir;
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  await fs.mkdir(Paths.state(), { recursive: true });
  return dir;
}

describe('SP-007 T023 — setupSingleFileSqlite', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('produces single-file index with no -wal / -shm sidecars', async () => {
    await makeCorpusHome();
    await setupSingleFileSqlite({}, new AbortController().signal);

    const stat = await fs.stat(Paths.indexDb());
    expect(stat.isFile()).toBe(true);

    await expect(fs.access(Paths.indexDb() + '-wal')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(Paths.indexDb() + '-shm')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('aborts when signal is pre-aborted', async () => {
    await makeCorpusHome();
    const c = new AbortController();
    c.abort('test');
    await expect(
      setupSingleFileSqlite({}, c.signal),
    ).rejects.toMatchObject({ name: 'InstallReceiptWriteError' });
  });
});
