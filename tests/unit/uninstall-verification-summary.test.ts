// SP-007 T058 — Post-uninstall verification summary (filesystem diff + MCP-client diff).
//
// References:
//   - specs/007-install-first-run/tasks.md T058
//   - specs/007-install-first-run/spec.md FR-INSTALL-016, SC-007-013, SC-007-014, SC-007-015

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Paths } from '@llm-corpus/contracts';
import { buildVerificationSummary } from '../../packages/cli/src/install-helpers/verification-summary-builder.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-uninstall-summary-'));
  process.env.CORPUS_HOME = d;
  await fs.mkdir(Paths.state(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return d;
}

describe('SP-007 T058 — buildVerificationSummary', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('emits present/absent status lines for paths in receipt.created_paths', async () => {
    await tempdir();
    const present = path.join(Paths.state(), 'present.txt');
    const absent = path.join(Paths.state(), 'absent.txt');
    await fs.writeFile(present, 'still here', 'utf8');

    const summary = await buildVerificationSummary({
      created_paths: [present, absent],
      mcp_client_configs: [],
      firewall_rules: [],
    });

    // Paste-friendly single block — no ANSI CSI sequences.
    const ESC = String.fromCharCode(27);
    expect(summary.includes(ESC + '[')).toBe(false);
    expect(summary).toContain(present);
    expect(summary).toContain('present');
    expect(summary).toContain(absent);
    expect(summary).toContain('absent');
  });

  it('emits MCP-client diff lines (corpus absent / present)', async () => {
    const d = await tempdir();
    const target = path.join(d, 'claude.json');
    await fs.writeFile(
      target,
      JSON.stringify({ mcpServers: { other: { command: '/other', args: [] } } }),
      'utf8',
    );

    const summary = await buildVerificationSummary({
      created_paths: [],
      mcp_client_configs: [{ path: target }],
      firewall_rules: [],
    });
    expect(summary).toContain(target);
    expect(summary).toMatch(/mcpServers\.corpus.*absent/i);
  });
});
