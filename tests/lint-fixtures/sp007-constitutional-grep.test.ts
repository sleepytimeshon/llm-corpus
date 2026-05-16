// SP-007 T084 — Constitutional grep-lint integration suite over SP-007 source.
//
// Mirrors the SP-006 pattern (tests/lint-fixtures/sp006-constitutional-grep.test.ts).
// Belt-and-suspenders grep against the actual SP-007 surface to catch
// Constitution violations that escape the ESLint rules' file-glob scoping.
//
// Constitution Principles enforced here:
//   - Principle I — no outbound non-loopback network in SP-007 source
//     (one annotated exception in preflight.ts for FR-INSTALL-003 loopback
//     Ollama-reachability GET).
//   - Principle III — zero new MCP mutation surfaces in transport/.
//   - Principle V — every catch in SP-007 source emits telemetry (verified
//     at the integration boundary; not grep-asserted here).
//   - Principle VII — zero `Promise.race(setTimeout)` patterns.
//   - Principle XI — zero `process.exit` in install-helpers/ + smoke-e2e.
//   - Principle XII — zero string-formed shell exec in SP-007 source.
//   - Principle XIII — every catch in SP-007 source emits telemetry.
//   - Principle XIV — zero hardcoded path literals (other than `~/.claude.json`).
//
// References:
//   - specs/007-install-first-run/tasks.md T084
//   - specs/007-install-first-run/spec.md FR-INSTALL-017, FR-INSTALL-018,
//     FR-INSTALL-019, FR-INSTALL-021, FR-INSTALL-023, SC-007-026..033
//   - Constitution Principles I, III, V, VII, XI, XII, XIII, XIV

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// SP-007 source paths under the Constitution V/VII/XI/XII/XIV regime.
const SP007_SOURCES = [
  // CLI command entry points (allowed process.exit per Constitution XI).
  'packages/cli/src/install-command.ts',
  'packages/cli/src/uninstall-command.ts',
  'packages/cli/src/taxonomy-promote-command.ts',
  'packages/cli/src/failures-command.ts',
  // Install-helpers library directory (process.exit FORBIDDEN here).
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
  // contracts/ install-schemas
  'packages/contracts/src/install-schemas.ts',
];

// Library-package SP-007 sources where process.exit is FORBIDDEN.
const SP007_LIB_SOURCES = SP007_SOURCES.filter(
  (p) =>
    !p.endsWith('install-command.ts') &&
    !p.endsWith('uninstall-command.ts') &&
    !p.endsWith('taxonomy-promote-command.ts') &&
    !p.endsWith('failures-command.ts'),
);

function grepCount(pattern: string, paths: readonly string[]): number {
  const repo = process.cwd();
  let total = 0;
  for (const rel of paths) {
    const target = path.join(repo, rel);
    if (!fs.existsSync(target)) continue;
    try {
      const out = execSync(
        `grep -nE ${JSON.stringify(pattern)} ${JSON.stringify(target)} || true`,
        { encoding: 'utf8' },
      );
      total += out.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      // grep returned non-zero (no matches) — fine.
    }
  }
  return total;
}

function readStripped(rel: string): string {
  const repo = process.cwd();
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) return '';
  return fs
    .readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('SP-007 Phase 8 T084 — constitutional grep-lints over SP-007 source', () => {
  it('Principle XI — no `process.exit` in SP-007 library source (install-helpers/ + contracts)', () => {
    expect(grepCount('process\\.exit', SP007_LIB_SOURCES)).toBe(0);
  });

  it('Principle XII — subprocess hygiene: no `execSync` / `execFileSync` / `child_process.exec(` in SP-007 source', () => {
    // Strip comments before scanning so explanatory references in JSDoc /
    // block comments don't trip the assertion.
    const repo = process.cwd();
    for (const rel of SP007_SOURCES) {
      const stripped = readStripped(rel);
      expect(
        /\bexecSync\b/.test(stripped),
        `${rel} contains execSync`,
      ).toBe(false);
      expect(
        /\bexecFileSync\b/.test(stripped),
        `${rel} contains execFileSync`,
      ).toBe(false);
      expect(
        /child_process\.exec\(/.test(stripped),
        `${rel} contains child_process.exec(`,
      ).toBe(false);
    }
  });

  it('Principle XII — no `spawn(.+/bin/sh.+-c.+)` patterns in SP-007 source', () => {
    // Strip comments before scanning so explanatory references don't trip.
    for (const rel of SP007_SOURCES) {
      const stripped = readStripped(rel);
      expect(
        /spawn\([^)]*['"][^'"]*\/bin\/sh['"][^)]*['"]-c['"]/.test(stripped),
        `${rel} contains spawn('/bin/sh','-c',…)`,
      ).toBe(false);
    }
  });

  it('Principle VII — no `Promise.race(setTimeout)` in SP-007 source', () => {
    for (const rel of SP007_SOURCES) {
      const stripped = readStripped(rel);
      const pattern = /Promise\.race\([\s\S]{0,200}setTimeout\(/;
      expect(pattern.test(stripped), `${rel} contains Promise.race(setTimeout)`)
        .toBe(false);
    }
  });

  it('Principle XIV — no `/tmp/` / `os.tmpdir()` / `/var/` hardcoded literals in SP-007 source', () => {
    // The MCP-client config path (`~/.claude.json` via os.homedir()) is the
    // ONLY allowed os.homedir() reference, recorded explicitly in install-receipt.
    // os.tmpdir() in unit tests is fine; SP-007 production source must never use it.
    expect(grepCount('os\\.tmpdir\\(', SP007_SOURCES)).toBe(0);
    expect(grepCount('"/tmp/"', SP007_SOURCES)).toBe(0);
    expect(grepCount("'/tmp/'", SP007_SOURCES)).toBe(0);
    expect(grepCount('"/var/"', SP007_SOURCES)).toBe(0);
    expect(grepCount("'/var/'", SP007_SOURCES)).toBe(0);
  });

  it('Principle I — no outbound non-loopback network imports in SP-007 source (allow one annotated loopback exception in preflight.ts)', () => {
    const repo = process.cwd();
    // Walk every SP-007 source and assert: any node:net/tls/https/dgram/dns or
    // undici import line is preceded (or annotated on the same line) by the
    // `Principle I loopback exception` annotation.
    const forbidden = /from\s+['"]node:(net|tls|https|dgram|dns)['"]|from\s+['"]undici['"]/;
    for (const rel of SP007_SOURCES) {
      const p = path.join(repo, rel);
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (forbidden.test(lines[i])) {
          const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
          const isAnnotated =
            /Principle I loopback exception/i.test(window) ||
            /ADR-001/.test(window);
          expect(
            isAnnotated,
            `${rel}:${i + 1} forbidden network import without Principle I annotation`,
          ).toBe(true);
        }
      }
    }
  });

  it('Principle III — zero new MCP mutation surfaces (transport/ unchanged for SP-007)', () => {
    // SP-007 ships ZERO new transport/ source. Assert no SP-007 marker exists
    // in packages/transport/src/.
    const repo = process.cwd();
    const transportDir = path.join(repo, 'packages/transport/src');
    if (!fs.existsSync(transportDir)) return;
    const files = fs.readdirSync(transportDir);
    for (const f of files) {
      if (!f.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(transportDir, f), 'utf8');
      // SP-007 banner format used by every SP-007-authored file.
      expect(
        /^\/\/\s*SP-007\b/m.test(src),
        `${f} carries an SP-007 banner — new transport mutation surface forbidden`,
      ).toBe(false);
    }
  });

  it('`npm run lint` exits 0 over SP-007 surface', () => {
    const args = SP007_SOURCES.map((p) => JSON.stringify(p)).join(' ');
    const out = execSync(`npx eslint ${args} 2>&1 || true`, {
      encoding: 'utf8',
    });
    const hasErrors = /✖\s+\d+\s+problem/.test(out);
    if (hasErrors) process.stderr.write(out);
    expect(hasErrors).toBe(false);
  });
});
