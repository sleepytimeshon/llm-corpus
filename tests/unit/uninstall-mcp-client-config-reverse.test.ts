// SP-007 T056 — MCP-client config reverser (delete `mcpServers.corpus`,
// preserve all other entries + top-level keys).
//
// References:
//   - specs/007-install-first-run/tasks.md T056
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, SC-007-013
//   - Constitution V, VIII

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { reverseMcpClientConfig } from '../../packages/cli/src/install-helpers/mcp-client-config-reverser.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-mcp-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

describe('SP-007 T056 — reverseMcpClientConfig', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('deletes mcpServers.corpus; preserves other mcpServers entries and other top-level keys', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    await fs.writeFile(
      target,
      JSON.stringify({
        $schema: 'https://x.invalid/schema.json',
        mcpServers: {
          corpus: { command: '/corpus', args: ['mcp'] },
          other: { command: '/other', args: ['serve'] },
          third: { command: '/third', args: ['run'] },
        },
        someOther: 'preserved',
      }),
      'utf8',
    );

    await reverseMcpClientConfig({ path: target }, new AbortController().signal);

    const post = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(post.mcpServers.corpus).toBeUndefined();
    expect(post.mcpServers.other.command).toBe('/other');
    expect(post.mcpServers.third.command).toBe('/third');
    expect(post.someOther).toBe('preserved');
    expect(post.$schema).toBe('https://x.invalid/schema.json');
  });

  it('is a no-op when the corpus entry is already gone', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    await fs.writeFile(
      target,
      JSON.stringify({ mcpServers: { other: { command: '/other', args: [] } } }),
      'utf8',
    );

    await reverseMcpClientConfig({ path: target }, new AbortController().signal);

    const post = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(post.mcpServers.other.command).toBe('/other');
  });

  it('tolerates a missing config file without throwing', async () => {
    const d = await tempdir();
    const missing = path.join(d, 'never-existed.json');
    await expect(
      reverseMcpClientConfig({ path: missing }, new AbortController().signal),
    ).resolves.toBeUndefined();
  });
});
