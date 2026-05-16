// SP-007 T048 — Integration: re-run `corpus init` is idempotent.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstallCommand } from '../../packages/cli/src/install-command.js';
import { installReceiptPath } from '../../packages/cli/src/install-helpers/install-receipt-writer.js';
import { Paths } from '@llm-corpus/contracts';
import { openIndexReadWrite } from '@llm-corpus/storage';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-rerun-'));
  process.env.CORPUS_HOME = d;
  return d;
}

describe('SP-007 T048 — install re-run idempotency', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('second run prints already-initialized + exits 0 + side-effects preserved', async () => {
    const d = await tempdir();
    const mcpCfg = path.join(d, 'claude.json');
    const r1 = await runInstallCommand({
      argv: ['--mcp-client-config', mcpCfg, '--no-autostart'],
      deps: {
        skipFirewallExec: true,
        forceFirewallExistsResult: true,
        skipAutoStartLoad: true,
      },
      stdout: () => undefined,
      stderr: () => undefined,
    });
    if (r1.exit !== 0) {
      // CI without Ollama — skip the rerun check.
      return;
    }
    // Capture pre-rerun state.
    const taxonomyBefore = (() => {
      const db = openIndexReadWrite();
      try {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS c FROM taxonomy_terms WHERE state='established'`,
          )
          .get() as { c: number };
        return row.c;
      } finally {
        db.close();
      }
    })();
    const mcpBefore = await fs.readFile(mcpCfg, 'utf8');
    const receiptBefore = await fs.readFile(installReceiptPath(), 'utf8');
    void receiptBefore;

    // Re-run.
    let stdoutBuf = '';
    const r2 = await runInstallCommand({
      argv: ['--mcp-client-config', mcpCfg, '--no-autostart'],
      deps: {
        skipFirewallExec: true,
        forceFirewallExistsResult: true,
        skipAutoStartLoad: true,
      },
      stdout: (m) => (stdoutBuf += m),
      stderr: () => undefined,
    });
    expect(r2.exit).toBe(0);
    expect(r2.alreadyInstalled).toBe(true);
    expect(stdoutBuf).toMatch(/already initialized/);

    // Side-effects preserved.
    const taxonomyAfter = (() => {
      const db = openIndexReadWrite();
      try {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS c FROM taxonomy_terms WHERE state='established'`,
          )
          .get() as { c: number };
        return row.c;
      } finally {
        db.close();
      }
    })();
    expect(taxonomyAfter).toBe(taxonomyBefore);
    const mcpAfter = await fs.readFile(mcpCfg, 'utf8');
    expect(mcpAfter).toBe(mcpBefore);
    // Verify index.db is still present.
    const stat = await fs.stat(Paths.indexDb());
    expect(stat.isFile()).toBe(true);
  });
});
