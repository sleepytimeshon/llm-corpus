// SP-007 T054 — Re-running uninstall over an already-uninstalled receipt is a no-op.
//
// References:
//   - specs/007-install-first-run/tasks.md T054
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, FR-INSTALL-017, SC-007-017
//   - Constitution X (idempotent)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths, type InstallReceipt } from '@llm-corpus/contracts';
import { writeInstallReceipt } from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { runUninstallCommand } from '../../packages/cli/src/uninstall-command.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-resume-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  return d;
}

describe('SP-007 T054 — uninstall idempotent resumption', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('re-running uninstall after success is a no-op (already-reversed entries skipped)', async () => {
    const d = await tempdir();
    const claudeJson = path.join(d, 'claude.json');
    await fs.writeFile(
      claudeJson,
      JSON.stringify({
        mcpServers: { corpus: { command: '/corpus', args: ['mcp'] } },
      }),
      'utf8',
    );

    const r: InstallReceipt = {
      schema_version: 1,
      installed_at: '2026-05-16T12:00:00.000Z',
      installed_via: 'npx',
      corpus_binary_path: '/corpus',
      created_paths: [],
      mcp_client_configs: [{ path: claudeJson, key_added: 'mcpServers.corpus' }],
      firewall_rules: [
        {
          os: os.platform() === 'darwin' ? 'macos' : 'linux',
          corpus_uid: 1000,
          anchor_or_chain: 'OUTPUT',
          rule_text: 'placeholder',
          provision_command: { cmd: 'true', args: [] },
          reverse_command: { cmd: 'true', args: [] },
        },
      ],
      auto_start_units: [],
      seeded_taxonomy_terms: [],
      os: os.platform() === 'darwin' ? 'macos' : 'linux',
      os_version: 'x.y',
      node_version: '20.18.1',
    };
    await writeInstallReceipt(r, new AbortController().signal);

    // First uninstall — succeeds; receipt marked uninstalled.
    const first = await runUninstallCommand({
      argv: [],
      signal: new AbortController().signal,
    });
    expect(first.exit).toBe(0);

    // Second uninstall — already-uninstalled receipt; treated as no-op.
    const second = await runUninstallCommand({
      argv: [],
      signal: new AbortController().signal,
    });
    expect(second.exit).toBe(0);
  });
});
