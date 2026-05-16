// SP-007 T029 — RED-phase contract test for `rollbackPartialInstall`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { rollbackPartialInstall } from '../../packages/cli/src/install-helpers/install-rollback.js';
import { Paths } from '@llm-corpus/contracts';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-rollback-'));
  process.env.CORPUS_HOME = d;
  return d;
}

describe('SP-007 T029 — rollbackPartialInstall', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('removes created_paths in reverse order', async () => {
    const d = await tempdir();
    const a = path.join(d, 'a');
    const b = path.join(d, 'b', 'inner');
    await fs.mkdir(b, { recursive: true });
    await fs.mkdir(a, { recursive: true });
    await rollbackPartialInstall(
      { created_paths: [a, b] },
      {},
      new AbortController().signal,
    );
    await expect(fs.access(a)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(b)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes mcpServers.corpus from existing config; preserves others', async () => {
    const d = await tempdir();
    const cfg = path.join(d, 'claude.json');
    await fs.writeFile(
      cfg,
      JSON.stringify({
        mcpServers: {
          corpus: { command: '/x', args: ['mcp'] },
          other: { command: '/y', args: ['serve'] },
        },
      }),
      'utf8',
    );
    await rollbackPartialInstall(
      { mcp_client_configs: [{ path: cfg }] },
      {},
      new AbortController().signal,
    );
    const post = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(post.mcpServers.corpus).toBeUndefined();
    expect(post.mcpServers.other).toBeDefined();
  });

  it('deletes config.toml when config_toml_written=true', async () => {
    await tempdir();
    await fs.mkdir(Paths.config(), { recursive: true });
    await fs.writeFile(Paths.configFile(), 'x', 'utf8');
    await rollbackPartialInstall(
      { config_toml_written: true },
      {},
      new AbortController().signal,
    );
    await expect(fs.access(Paths.configFile())).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('idempotent re-run is a no-op', async () => {
    const d = await tempdir();
    const a = path.join(d, 'a');
    await fs.mkdir(a, { recursive: true });
    await rollbackPartialInstall(
      { created_paths: [a] },
      {},
      new AbortController().signal,
    );
    // Run again — must not throw.
    await rollbackPartialInstall(
      { created_paths: [a] },
      {},
      new AbortController().signal,
    );
  });
});
