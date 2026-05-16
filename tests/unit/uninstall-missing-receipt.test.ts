// SP-007 T052 — RED-phase contract test for missing / malformed install-receipt.
//
// References:
//   - specs/007-install-first-run/tasks.md T052
//   - specs/007-install-first-run/spec.md FR-INSTALL-015, SC-007-016
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { runUninstallCommand } from '../../packages/cli/src/uninstall-command.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-missing-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

describe('SP-007 T052 — uninstall preflight (missing / malformed receipt)', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('exits non-zero when receipt is missing; ZERO destructive operations', async () => {
    const d = await tempdir();
    // Sentinel file in data/ — uninstall must NOT remove it.
    const sentinel = path.join(Paths.data(), 'sentinel.txt');
    await fs.mkdir(Paths.data(), { recursive: true });
    await fs.writeFile(sentinel, 'preserved', 'utf8');

    const stderrBuf: string[] = [];
    const result = await runUninstallCommand({
      argv: ['--purge'],
      signal: new AbortController().signal,
      stderr: (m) => stderrBuf.push(m),
    });
    expect(result.exit).not.toBe(0);
    // Sentinel preserved.
    await expect(fs.access(sentinel)).resolves.not.toThrow();
    // Stderr names the receipt path so operator can manually clean up.
    expect(stderrBuf.join('')).toContain('install-receipt.json');
    void d;
  });

  it('exits non-zero on malformed JSON receipt; ZERO destructive ops', async () => {
    await tempdir();
    const sentinel = path.join(Paths.data(), 'sentinel.txt');
    await fs.mkdir(Paths.data(), { recursive: true });
    await fs.writeFile(sentinel, 'preserved', 'utf8');

    await fs.writeFile(
      path.join(Paths.state(), 'install-receipt.json'),
      'not json at all',
      'utf8',
    );

    const result = await runUninstallCommand({
      argv: ['--purge'],
      signal: new AbortController().signal,
    });
    expect(result.exit).not.toBe(0);
    await expect(fs.access(sentinel)).resolves.not.toThrow();
  });

  it('exits non-zero on schema_version: 2 (future-version receipt); ZERO destructive ops', async () => {
    await tempdir();
    const sentinel = path.join(Paths.data(), 'sentinel.txt');
    await fs.mkdir(Paths.data(), { recursive: true });
    await fs.writeFile(sentinel, 'preserved', 'utf8');

    const bad = {
      schema_version: 2,
      installed_at: '2026-05-16T12:00:00.000Z',
      installed_via: 'npx',
      corpus_binary_path: '/usr/local/bin/corpus',
      created_paths: [],
      mcp_client_configs: [],
      firewall_rules: [],
      auto_start_units: [],
      seeded_taxonomy_terms: [],
      os: 'linux',
      os_version: '6.19.0',
      node_version: '20.18.1',
    };
    await fs.writeFile(
      path.join(Paths.state(), 'install-receipt.json'),
      JSON.stringify(bad),
      'utf8',
    );

    const result = await runUninstallCommand({
      argv: ['--purge'],
      signal: new AbortController().signal,
    });
    expect(result.exit).not.toBe(0);
    await expect(fs.access(sentinel)).resolves.not.toThrow();
  });
});
