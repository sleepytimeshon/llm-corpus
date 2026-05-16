// SP-007 T008 — RED-phase contract test for the no-process-exit-in-libs lint
// rule scope over SP-007 source.
//
// References:
//   - specs/007-install-first-run/tasks.md T008 / T019
//   - specs/007-install-first-run/spec.md FR-INSTALL-019, SC-007-032
//   - Constitution Principle XI (Library/CLI Boundary)
//
// The rule itself is shipped in
// tools/eslint-rules/no-process-exit-in-libs.js. SP-007 extends the rule's
// `files:` globs to scope packages/cli/src/install-helpers/* + the
// smoke-e2e harness, while EXEMPTING the three CLI command entry points
// (install-command, uninstall-command, taxonomy-promote-command), per
// Constitution XI's library-vs-CLI boundary.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const ESLINT_CONFIG_PATH = path.join(process.cwd(), 'eslint.config.js');

describe('SP-007 PREREQ-006 — no-process-exit-in-libs scope (T008 / T019)', () => {
  it('eslint.config.js scopes no-process-exit-in-libs over packages/cli/src/install-helpers/', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(
      /'packages\/cli\/src\/install-helpers\/\*\*\/\*\.ts'/,
    );
  });

  it('eslint.config.js exempts the three SP-007 CLI command entry points', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toContain('install-command.ts');
    expect(src).toContain('uninstall-command.ts');
    expect(src).toContain('taxonomy-promote-command.ts');
  });

  it('the no-process-exit-in-libs rule remains armed at error level', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(/'llm-corpus\/no-process-exit-in-libs':\s*'error'/);
  });
});
