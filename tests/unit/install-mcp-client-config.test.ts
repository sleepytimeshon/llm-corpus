// SP-007 T026 — RED-phase contract test for `mutateMcpClientConfig`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  mutateMcpClientConfig,
  resolveMcpClientConfigPath,
} from '../../packages/cli/src/install-helpers/mcp-client-config-mutator.js';
import { Paths } from '@llm-corpus/contracts';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-mcp-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

describe('SP-007 T026 — mutateMcpClientConfig', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
    delete process.env.CLAUDE_CONFIG_PATH;
  });

  it('precedence: --mcp-client-config arg overrides env overrides default', async () => {
    expect(resolveMcpClientConfigPath('/tmp/forced.json')).toBe(
      '/tmp/forced.json',
    );
    process.env.CLAUDE_CONFIG_PATH = '/tmp/from-env.json';
    expect(resolveMcpClientConfigPath(undefined)).toBe('/tmp/from-env.json');
    delete process.env.CLAUDE_CONFIG_PATH;
    expect(resolveMcpClientConfigPath(undefined)).toBe(
      path.join(os.homedir(), '.claude.json'),
    );
  });

  it('creates config when missing; mcpServers.corpus present', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    const r = await mutateMcpClientConfig(
      { configPathOverride: target, corpusBinaryPath: '/usr/local/bin/corpus' },
      new AbortController().signal,
    );
    expect(r.path).toBe(target);
    expect(r.key_added).toBe('mcpServers.corpus');
    const body = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(body.mcpServers.corpus.command).toBe('/usr/local/bin/corpus');
    expect(body.mcpServers.corpus.args).toEqual(['mcp']);
  });

  it('preserves prior mcpServers entries and other top-level keys', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    const prior = {
      $schema: 'https://x.invalid/schema.json',
      mcpServers: {
        other: { command: '/bin/other', args: ['serve'] },
      },
      someOther: 'preserved',
    };
    await fs.writeFile(target, JSON.stringify(prior), 'utf8');
    await mutateMcpClientConfig(
      { configPathOverride: target, corpusBinaryPath: '/abs/corpus' },
      new AbortController().signal,
    );
    const post = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(post.mcpServers.other.command).toBe('/bin/other');
    expect(post.mcpServers.corpus.command).toBe('/abs/corpus');
    expect(post.someOther).toBe('preserved');
    expect(post.$schema).toBe('https://x.invalid/schema.json');
  });

  it('throws InstallMCPClientConfigError on malformed JSON', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    await fs.writeFile(target, '{ this is not json', 'utf8');
    await expect(
      mutateMcpClientConfig(
        { configPathOverride: target, corpusBinaryPath: '/abs/corpus' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: 'InstallMCPClientConfigError',
    });
    // No write occurred (file content unchanged).
    const body = await fs.readFile(target, 'utf8');
    expect(body).toBe('{ this is not json');
  });
});
