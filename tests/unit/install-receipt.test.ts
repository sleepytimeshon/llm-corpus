// SP-007 T027 — RED-phase contract test for receipt writer + reader.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeInstallReceipt,
  installReceiptPath,
} from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { readInstallReceipt } from '../../packages/cli/src/install-helpers/install-receipt-reader.js';
import { Paths, type InstallReceipt } from '@llm-corpus/contracts';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-receipt-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

function makeReceipt(): InstallReceipt {
  return {
    schema_version: 1,
    installed_at: '2026-05-16T12:00:00.000Z',
    installed_via: 'npx',
    corpus_binary_path: '/usr/local/bin/corpus',
    created_paths: ['/home/x'],
    mcp_client_configs: [
      { path: '/home/x/.claude.json', key_added: 'mcpServers.corpus' },
    ],
    firewall_rules: [],
    auto_start_units: [],
    seeded_taxonomy_terms: [
      {
        axis: 'domain',
        term: 'engineering',
        established_at: '2026-05-16T12:00:00.000Z',
      },
    ],
    os: 'linux',
    os_version: '6.19.0',
    node_version: '20.18.1',
  };
}

describe('SP-007 T027 — install-receipt writer + reader', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('writes + reads back a Zod-valid receipt', async () => {
    await tempdir();
    const r = makeReceipt();
    await writeInstallReceipt(r, new AbortController().signal);
    const got = await readInstallReceipt(new AbortController().signal);
    expect(got.schema_version).toBe(1);
    expect(got.installed_via).toBe('npx');
    expect(installReceiptPath()).toMatch(/install-receipt\.json$/);
  });

  it('reader throws UninstallReceiptMissingError on missing file', async () => {
    await tempdir();
    await expect(
      readInstallReceipt(new AbortController().signal),
    ).rejects.toMatchObject({ name: 'UninstallReceiptMissingError' });
  });

  it('reader throws UninstallReceiptMissingError on malformed JSON', async () => {
    await tempdir();
    await fs.writeFile(installReceiptPath(), 'not json at all', 'utf8');
    await expect(
      readInstallReceipt(new AbortController().signal),
    ).rejects.toMatchObject({ name: 'UninstallReceiptMissingError' });
  });

  it('reader throws UninstallReceiptMissingError on Zod failure (schema_version: 2)', async () => {
    await tempdir();
    const bad = { ...makeReceipt(), schema_version: 2 };
    await fs.writeFile(installReceiptPath(), JSON.stringify(bad), 'utf8');
    await expect(
      readInstallReceipt(new AbortController().signal),
    ).rejects.toMatchObject({ name: 'UninstallReceiptMissingError' });
  });
});
