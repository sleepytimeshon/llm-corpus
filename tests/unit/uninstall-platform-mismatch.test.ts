// SP-007 T053 — RED-phase contract test for platform mismatch (macos receipt on linux host).
//
// References:
//   - specs/007-install-first-run/tasks.md T053
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, SC-007-016
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths, type InstallReceipt } from '@llm-corpus/contracts';
import { writeInstallReceipt } from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { runUninstallCommand } from '../../packages/cli/src/uninstall-command.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-platform-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  await fs.mkdir(Paths.data(), { recursive: true });
  return d;
}

describe('SP-007 T053 — uninstall platform-mismatch preflight', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('exits non-zero when receipt.os does not match current platform; ZERO destructive ops', async () => {
    await tempdir();
    const sentinel = path.join(Paths.data(), 'sentinel.txt');
    await fs.writeFile(sentinel, 'preserved', 'utf8');

    // Fabricate a receipt with the OPPOSITE platform of the test host.
    const current: 'macos' | 'linux' =
      os.platform() === 'darwin' ? 'macos' : 'linux';
    const opposite: 'macos' | 'linux' = current === 'linux' ? 'macos' : 'linux';

    const r: InstallReceipt = {
      schema_version: 1,
      installed_at: '2026-05-16T12:00:00.000Z',
      installed_via: 'npx',
      corpus_binary_path: '/usr/local/bin/corpus',
      created_paths: [],
      mcp_client_configs: [],
      firewall_rules: [],
      auto_start_units: [],
      seeded_taxonomy_terms: [],
      os: opposite,
      os_version: 'x.y',
      node_version: '20.18.1',
    };
    await writeInstallReceipt(r, new AbortController().signal);

    const result = await runUninstallCommand({
      argv: ['--purge'],
      signal: new AbortController().signal,
    });
    expect(result.exit).not.toBe(0);
    // ZERO destructive operations: sentinel preserved.
    await expect(fs.access(sentinel)).resolves.not.toThrow();
  });
});
