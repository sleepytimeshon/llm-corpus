// SP-007 T022 — RED-phase contract test for `bringUpXdgSubtree`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { bringUpXdgSubtree } from '../../packages/cli/src/install-helpers/xdg-bringup.js';
import { Paths } from '@llm-corpus/contracts';

async function makeCorpusHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-xdg-'));
  process.env.CORPUS_HOME = dir;
  return dir;
}

describe('SP-007 T022 — bringUpXdgSubtree', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('creates every Paths.* derivable XDG path; returns sorted list', async () => {
    await makeCorpusHome();
    const result = await bringUpXdgSubtree({}, new AbortController().signal);
    expect(result.length).toBeGreaterThanOrEqual(12);
    const sortedCopy = [...result].sort((a, b) => a.localeCompare(b));
    expect(result).toEqual(sortedCopy);

    // Every Paths.* getter referenced must now exist on disk.
    for (const p of [
      Paths.config(),
      Paths.data(),
      Paths.state(),
      Paths.cache(),
      Paths.docs(),
      Paths.inbox(),
      Paths.pending(),
      Paths.processed(),
      Paths.failed(),
      Paths.trash(),
      Paths.docsStore(),
      Paths.pilotTelemetry(),
    ]) {
      const stat = await fs.stat(p);
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('idempotent — re-running on existing tree is a no-op', async () => {
    await makeCorpusHome();
    const first = await bringUpXdgSubtree({}, new AbortController().signal);
    const second = await bringUpXdgSubtree({}, new AbortController().signal);
    expect(first).toEqual(second);
  });

  it('aborts when signal is pre-aborted', async () => {
    await makeCorpusHome();
    const c = new AbortController();
    c.abort('test');
    await expect(bringUpXdgSubtree({}, c.signal)).rejects.toMatchObject({
      name: 'InstallPreflightError',
    });
  });

  it('source has zero hardcoded path literals (paths-from-resolver-only)', async () => {
    const src = await fs.readFile(
      new URL(
        '../../packages/cli/src/install-helpers/xdg-bringup.ts',
        import.meta.url,
      ),
      'utf8',
    );
    // No `~/...` and no `/tmp` and no absolute `/home/...` literals.
    expect(src).not.toMatch(/['"`]\/tmp\//);
    expect(src).not.toMatch(/['"`]\/home\//);
    expect(src).not.toMatch(/['"`]~\//);
  });
});
