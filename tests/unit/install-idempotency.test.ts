// SP-007 T032 — RED-phase contract test for idempotent re-install.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstallCommand } from '../../packages/cli/src/install-command.js';
import { installReceiptPath } from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { Paths } from '@llm-corpus/contracts';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-idemp-'));
  process.env.CORPUS_HOME = d;
  return d;
}

describe('SP-007 T032 — install idempotency', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('detects pre-existing install + receipt; prints already-initialized + exit 0', async () => {
    await tempdir();
    // Synthesize a "completed install" by creating index.db + a valid receipt.
    await fs.mkdir(Paths.data(), { recursive: true });
    await fs.mkdir(Paths.state(), { recursive: true });
    await fs.writeFile(Paths.indexDb(), '', 'utf8');
    const receipt = {
      schema_version: 1,
      installed_at: '2026-05-16T12:00:00.000Z',
      installed_via: 'npx',
      corpus_binary_path: '/abs/corpus',
      created_paths: [],
      mcp_client_configs: [],
      firewall_rules: [],
      auto_start_units: [],
      seeded_taxonomy_terms: [],
      os: 'linux',
      os_version: '6.0.0',
      node_version: '20.0.0',
    };
    await fs.writeFile(
      installReceiptPath(),
      JSON.stringify(receipt),
      'utf8',
    );

    let stdoutBuf = '';
    const result = await runInstallCommand({
      argv: [],
      stdout: (m) => (stdoutBuf += m),
      stderr: () => undefined,
    });
    expect(result.exit).toBe(0);
    expect(result.alreadyInstalled).toBe(true);
    expect(stdoutBuf).toMatch(/already initialized/);
  });
});
