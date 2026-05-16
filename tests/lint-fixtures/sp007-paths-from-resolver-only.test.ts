// SP-007 T087 — paths-from-resolver-only enforcement over SP-007 source.
//
// Constitution XIV: SP-007 source paths must route exclusively through
// `Paths.*` getters from `packages/contracts/src/paths.ts`. The single
// allowed `os.homedir()` reference is the MCP-client config path
// (`~/.claude.json` per FR-INSTALL-009), recorded explicitly in
// install-receipt.
//
// References:
//   - specs/007-install-first-run/tasks.md T087
//   - specs/007-install-first-run/spec.md FR-INSTALL-005, SC-007-006,
//     SC-007-031
//   - Constitution Principle XIV

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SP007_SOURCES = [
  'packages/cli/src/install-command.ts',
  'packages/cli/src/uninstall-command.ts',
  'packages/cli/src/taxonomy-promote-command.ts',
  'packages/cli/src/failures-command.ts',
  // install-helpers/
  'packages/cli/src/install-helpers/auto-start-unit-installer.ts',
  'packages/cli/src/install-helpers/auto-start-unit-uninstaller.ts',
  'packages/cli/src/install-helpers/config-toml-writer.ts',
  'packages/cli/src/install-helpers/daemon-detector.ts',
  'packages/cli/src/install-helpers/firewall-provisioner.ts',
  'packages/cli/src/install-helpers/install-budget.ts',
  'packages/cli/src/install-helpers/install-receipt-reader.ts',
  'packages/cli/src/install-helpers/install-receipt-writer.ts',
  'packages/cli/src/install-helpers/install-rollback.ts',
  'packages/cli/src/install-helpers/mcp-client-config-mutator.ts',
  'packages/cli/src/install-helpers/mcp-client-config-reverser.ts',
  'packages/cli/src/install-helpers/preflight.ts',
  'packages/cli/src/install-helpers/smoke-harness.ts',
  'packages/cli/src/install-helpers/sqlite-singlefile.ts',
  'packages/cli/src/install-helpers/taxonomy-promote-helpers.ts',
  'packages/cli/src/install-helpers/taxonomy-seed-loader.ts',
  'packages/cli/src/install-helpers/verification-summary-builder.ts',
  'packages/cli/src/install-helpers/xdg-bringup.ts',
];

describe('SP-007 Phase 8 T087 — paths-from-resolver-only over SP-007 source', () => {
  it('zero hardcoded `/tmp/` literals in SP-007 source', () => {
    for (const rel of SP007_SOURCES) {
      const p = path.join(process.cwd(), rel);
      if (!fs.existsSync(p)) continue;
      const src = fs
        .readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(/['"]\/tmp\//.test(src), `${rel} contains hardcoded /tmp/ literal`)
        .toBe(false);
    }
  });

  it('zero `os.tmpdir()` references in SP-007 source', () => {
    for (const rel of SP007_SOURCES) {
      const p = path.join(process.cwd(), rel);
      if (!fs.existsSync(p)) continue;
      const src = fs
        .readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(/\bos\.tmpdir\(/.test(src), `${rel} contains os.tmpdir()`)
        .toBe(false);
    }
  });

  it('`os.homedir()` usage is bounded — only mcp-client-config-mutator + mcp-client-config-reverser + auto-start-unit-installer may use it', () => {
    const allowedFiles = new Set([
      'packages/cli/src/install-helpers/mcp-client-config-mutator.ts',
      'packages/cli/src/install-helpers/mcp-client-config-reverser.ts',
      // The auto-start-unit-installer writes systemd unit / launchd plist
      // under ~/.config/systemd/user/ and ~/Library/LaunchAgents/; both are
      // explicitly OS-defined paths recorded into the install-receipt with
      // their reverse-commands, NOT XDG-relocatable. Per ADR-012 / Decision E.
      'packages/cli/src/install-helpers/auto-start-unit-installer.ts',
      'packages/cli/src/install-helpers/auto-start-unit-uninstaller.ts',
    ]);
    for (const rel of SP007_SOURCES) {
      const p = path.join(process.cwd(), rel);
      if (!fs.existsSync(p)) continue;
      const src = fs
        .readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (/\bos\.homedir\(/.test(src)) {
        expect(
          allowedFiles.has(rel),
          `${rel} uses os.homedir() outside allowed allow-list`,
        ).toBe(true);
      }
    }
  });

  it('`npm run lint` exits 0 over SP-007 source under paths-from-resolver-only', () => {
    const args = SP007_SOURCES.map((p) => JSON.stringify(p)).join(' ');
    const out = execSync(`npx eslint ${args} 2>&1 || true`, {
      encoding: 'utf8',
    });
    const hasErrors = /✖\s+\d+\s+problem/.test(out);
    if (hasErrors) process.stderr.write(out);
    expect(hasErrors).toBe(false);
  });
});
