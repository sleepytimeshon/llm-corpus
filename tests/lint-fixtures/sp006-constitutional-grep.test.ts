// T057 (SP-006 Phase 6) — Constitutional grep-lint integration suite.
//
// Mirrors the SP-004 pattern (tests/integration/sp004-constitutional-grep.test.ts):
// one file covering all grep-based constitutional assertions over SP-006 source.
//   - No `process.exit` in SP-006 library packages (Constitution XI; SC-HARDEN-018).
//   - Subprocess hygiene: only `runTool(...)` is allowed (Constitution XII; SC-HARDEN-019).
//   - Paths-from-resolver-only: no hardcoded `/tmp/`, `os.tmpdir()`, `/var/`
//     literals in SP-006 source (Constitution XIV; SC-HARDEN-017).
//   - No `Promise.race(setTimeout)` (Constitution VII).
//   - No `fs.write*` / `fs.append*` / `fs.mkdir*` / `fs.unlink*` in the
//     failures-resource handler + adapter (Constitution III; SC-HARDEN-018).
//   - `npm run lint` exits 0 over the SP-006 surface.
//
// References:
//   - specs/006-hardening/tasks.md T057
//   - specs/006-hardening/spec.md SC-HARDEN-017..019
//   - Constitution Principles III, VII, XI, XII, XIII, XIV

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// SP-006 source paths to lint over.
const SP006_SOURCES = [
  // pipeline (recovery)
  'packages/pipeline/src/recovery-scanner.ts',
  'packages/pipeline/src/recovery-resumability.ts',
  // storage (failures + catalog)
  'packages/storage/src/failures-resource-adapter.ts',
  'packages/storage/src/catalog-md-generator.ts',
  // index (tier cascade)
  'packages/index/src/tier-orchestrator.ts',
  'packages/index/src/bm25-only-tier.ts',
  'packages/index/src/catalog-grep-tier.ts',
  'packages/index/src/fs-grep-tier.ts',
  // transport (failures handler)
  'packages/transport/src/failures-resource-handler.ts',
  // contracts (failures schema)
  'packages/contracts/src/failures-resource-schema.ts',
];

// Library-package SP-006 sources — process.exit FORBIDDEN here (Constitution XI).
// Transport is intentionally excluded — it bridges the egress / MCP boundary.
const SP006_LIB_SOURCES = [
  'packages/pipeline/src/recovery-scanner.ts',
  'packages/pipeline/src/recovery-resumability.ts',
  'packages/storage/src/failures-resource-adapter.ts',
  'packages/storage/src/catalog-md-generator.ts',
  'packages/index/src/tier-orchestrator.ts',
  'packages/index/src/bm25-only-tier.ts',
  'packages/index/src/catalog-grep-tier.ts',
  'packages/index/src/fs-grep-tier.ts',
  'packages/contracts/src/failures-resource-schema.ts',
];

// Read-only MCP resource handler + adapter (Constitution III; SC-HARDEN-018).
const SP006_READONLY_SOURCES = [
  'packages/transport/src/failures-resource-handler.ts',
  'packages/storage/src/failures-resource-adapter.ts',
];

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
      // grep returned non-zero (no matches) — fine
    }
  }
  return total;
}

describe('Phase 6 — SP-006 constitutional grep-lints (T057)', () => {
  it('no `process.exit` in SP-006 library source (Principle XI / SC-HARDEN-018)', () => {
    expect(grepCount('process\\.exit', SP006_LIB_SOURCES)).toBe(0);
  });

  it('subprocess hygiene: no `execSync` / `child_process.exec` in SP-006 source (Principle XII / SC-HARDEN-019)', () => {
    expect(grepCount('execSync', SP006_SOURCES)).toBe(0);
    expect(grepCount('execFileSync', SP006_SOURCES)).toBe(0);
    // child_process.exec( (the function form — fs-grep-tier uses runTool, never raw exec)
    expect(grepCount('child_process\\.exec\\(', SP006_SOURCES)).toBe(0);
  });

  it('no `Promise.race(setTimeout)` in SP-006 source (Constitution VII)', () => {
    // Note: comments referencing the forbidden pattern by name are allowed
    // (they document the contract). We grep for the actual code pattern.
    // Tightened to "Promise.race(" followed (within a few chars) by a
    // setTimeout reference — the lint regexp can't span lines via plain
    // grep, but the per-call setTimeout-as-an-arg form is what we forbid.
    // The orchestrators use the abortChild() pattern instead, which calls
    // setTimeout standalone (NOT inside Promise.race), and that is allowed.
    const repo = process.cwd();
    for (const rel of SP006_SOURCES) {
      const p = path.join(repo, rel);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf8');
      // strip line comments (// ...) and block comments (/* ... */) so the
      // documentation references don't trigger.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // Look for "Promise.race(" then within 200 chars "setTimeout(".
      const pattern = /Promise\.race\([\s\S]{0,200}setTimeout\(/;
      expect(pattern.test(stripped), `${rel} contains Promise.race(setTimeout) pattern`).toBe(
        false,
      );
    }
  });

  it('no `/tmp/`, `os.tmpdir()`, `/var/` literals in SP-006 source (Principle XIV / SC-HARDEN-017)', () => {
    expect(grepCount('os\\.tmpdir\\(', SP006_SOURCES)).toBe(0);
    expect(grepCount('"/tmp/"', SP006_SOURCES)).toBe(0);
    expect(grepCount("'/tmp/'", SP006_SOURCES)).toBe(0);
    expect(grepCount('"/var/"', SP006_SOURCES)).toBe(0);
    expect(grepCount("'/var/'", SP006_SOURCES)).toBe(0);
  });

  it('no `fs.write*`/`fs.append*`/`fs.mkdir*`/`fs.unlink*` in failures handler + adapter (Constitution III / SC-HARDEN-018)', () => {
    // The ESLint no-writes-from-resource-handlers rule enforces this at lint
    // time. Grep is the belt-and-suspenders sanity check.
    // Adapter strips frontmatter/parses sidecars — read-only operations only.
    // Allowed: fsp.readFile, fsp.readdir, fsp.stat, await fsp.access.
    const writeMembers = [
      'fsp?\\.writeFile',
      'fsp?\\.appendFile',
      'fsp?\\.mkdir',
      'fsp?\\.unlink',
      'fs?\\.writeFile',
      'fs?\\.appendFile',
      'fs?\\.mkdir',
      'fs?\\.unlink',
    ];
    for (const member of writeMembers) {
      const count = grepCount(member, SP006_READONLY_SOURCES);
      expect(count, `${member} should not appear in read-only sources`).toBe(0);
    }
  });

  it('`npm run lint` exits 0 over SP-006 surface', () => {
    // Full repo lint runs as a separate CI test; this is a SP-006 smoke test
    // verifying the new files don't trip any existing rule. We invoke lint
    // scoped to the SP-006 source paths only.
    const args = SP006_SOURCES.map((p) => JSON.stringify(p)).join(' ');
    const out = execSync(`npx eslint ${args} 2>&1 || true`, {
      encoding: 'utf8',
    });
    // ESLint emits "✖ N problems" on failure; we expect a clean run.
    const hasErrors = /✖\s+\d+\s+problem/.test(out);
    if (hasErrors) {
      process.stderr.write(out);
    }
    expect(hasErrors).toBe(false);
  });
});
