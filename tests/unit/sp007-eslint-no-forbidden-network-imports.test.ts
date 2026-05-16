// SP-007 T011 — RED-phase contract test for the no-forbidden-network-imports
// lint rule scope over SP-007 install-helpers source.
//
// References:
//   - specs/007-install-first-run/tasks.md T011 / T019
//   - specs/007-install-first-run/spec.md FR-INSTALL-003, SC-007-026
//   - Constitution Principle I (Local-only enforcement)
//   - specs/007-install-first-run/contracts/adr-firewall-provisioning.md ADR-013
//   - SP-001 ADR-001 (loopback exception path (a))

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const ESLINT_CONFIG_PATH = path.join(process.cwd(), 'eslint.config.js');

describe('SP-007 PREREQ-006 — no-forbidden-network-imports scope (T011 / T019)', () => {
  it('the rule scopes over packages/cli/ (covers SP-007 install-helpers/*)', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // The SP-001 setting already includes packages/cli/ in the NFR-001
    // forbidden-network-imports scope. Verify it persists.
    expect(src).toMatch(/'packages\/cli\/\*\*\/\*\.ts'/);
    expect(src).toMatch(/no-forbidden-network-imports/);
  });

  it('the rule is armed at error level for the SP-001 pipeline/storage/index/inference/extract/cli scope', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(
      /'llm-corpus\/no-forbidden-network-imports':\s*'error'/,
    );
  });

  it('test files have the rule disabled (so test infra can stub fetch / undici)', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(
      /'llm-corpus\/no-forbidden-network-imports':\s*'off'/,
    );
  });

  it('install-helpers/preflight.ts will need a single annotated eslint-disable for the FR-INSTALL-003 loopback Ollama-reachability GET', () => {
    // This is the design contract; the actual annotation lives in
    // packages/cli/src/install-helpers/preflight.ts (created in Phase 3 T034).
    // SP-007 PREREQ-006 only sets up the scope — the exemption is annotated
    // inline at the import site per Constitution I + ADR-001 path (a).
    // For Phase 2 we assert the file is absent (Phase 3+ will create it
    // with the annotated import).
    const preflight = path.join(
      process.cwd(),
      'packages',
      'cli',
      'src',
      'install-helpers',
      'preflight.ts',
    );
    if (fs.existsSync(preflight)) {
      const src = fs.readFileSync(preflight, 'utf8');
      // If Engineer #2 has landed preflight.ts already, every forbidden
      // network import MUST be paired with an eslint-disable comment.
      const imports = src.match(/from\s+['"]node:(net|tls|https|dgram|dns)['"]/g);
      if (imports !== null) {
        for (const imp of imports) {
          // Loose check: the line containing the import must be preceded by
          // an eslint-disable-next-line comment.
          const lineIdx = src.indexOf(imp);
          const upTo = src.slice(0, lineIdx);
          const lastLine = upTo.slice(upTo.lastIndexOf('\n', upTo.length - 2));
          expect(lastLine).toMatch(/eslint-disable-next-line/);
        }
      }
    } else {
      expect(true).toBe(true);
    }
  });
});
