// SP-007 T051 — RED-phase contract test for `runUninstallCommand` happy path.
//
// References:
//   - specs/007-install-first-run/tasks.md T051
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, FR-INSTALL-016
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths, type InstallReceipt } from '@llm-corpus/contracts';
import { writeInstallReceipt } from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { runUninstallCommand } from '../../packages/cli/src/uninstall-command.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-receipt-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.config(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

async function seedReceipt(claudeJsonPath: string): Promise<InstallReceipt> {
  // Write a paired MCP-client config file with corpus + a prior entry.
  await fs.writeFile(
    claudeJsonPath,
    JSON.stringify(
      {
        mcpServers: {
          corpus: { command: '/usr/local/bin/corpus', args: ['mcp'] },
          other: { command: '/usr/bin/other', args: ['serve'] },
        },
        $otherKey: 'preserved',
      },
      null,
      2,
    ),
    'utf8',
  );

  const r: InstallReceipt = {
    schema_version: 1,
    installed_at: '2026-05-16T12:00:00.000Z',
    installed_via: 'npx',
    corpus_binary_path: '/usr/local/bin/corpus',
    created_paths: [Paths.data(), Paths.state()],
    mcp_client_configs: [{ path: claudeJsonPath, key_added: 'mcpServers.corpus' }],
    // The fake reverse_command targets `true` (always-succeed) so we don't
    // need real iptables; we only verify it gets invoked via runTool.
    firewall_rules: [
      {
        os: 'linux',
        corpus_uid: 1000,
        anchor_or_chain: 'OUTPUT',
        rule_text: 'placeholder',
        provision_command: { cmd: 'true', args: [] },
        reverse_command: { cmd: 'true', args: [] },
      },
    ],
    auto_start_units: [],
    seeded_taxonomy_terms: [],
    os: 'linux',
    os_version: '6.19.0',
    node_version: '20.18.1',
  };
  await writeInstallReceipt(r, new AbortController().signal);
  return r;
}

describe('SP-007 T051 — runUninstallCommand receipt-driven reverse', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('without --purge: reverses MCP-client + firewall; preserves XDG; marks receipt uninstalled', async () => {
    const d = await tempdir();
    const claudeJson = path.join(d, 'claude.json');
    await seedReceipt(claudeJson);

    const result = await runUninstallCommand({
      argv: [],
      signal: new AbortController().signal,
    });

    expect(result.exit).toBe(0);

    // MCP-client config: corpus removed, other preserved.
    const post = JSON.parse(await fs.readFile(claudeJson, 'utf8'));
    expect(post.mcpServers.corpus).toBeUndefined();
    expect(post.mcpServers.other).toBeDefined();
    expect(post.$otherKey).toBe('preserved');

    // XDG subtree still present.
    await expect(fs.access(Paths.data())).resolves.not.toThrow();
    await expect(fs.access(Paths.state())).resolves.not.toThrow();

    // Receipt marked uninstalled.
    const receiptPath = path.join(Paths.state(), 'install-receipt.json');
    const body = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    expect(body.uninstalled).toBe(true);
    expect(body.uninstalled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('with --purge: removes XDG subtree and deletes receipt', async () => {
    const d = await tempdir();
    const claudeJson = path.join(d, 'claude.json');
    await seedReceipt(claudeJson);

    const result = await runUninstallCommand({
      argv: ['--purge'],
      signal: new AbortController().signal,
    });

    expect(result.exit).toBe(0);
    // XDG subtree removed.
    await expect(fs.access(Paths.data())).rejects.toThrow();
    await expect(fs.access(Paths.state())).rejects.toThrow();
  });
});
