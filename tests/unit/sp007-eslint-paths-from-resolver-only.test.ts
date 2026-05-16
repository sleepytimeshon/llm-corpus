// SP-007 T007 — RED-phase contract test for the paths-from-resolver-only
// lint rule's scope over SP-007 source.
//
// References:
//   - specs/007-install-first-run/tasks.md T007 / T019
//   - specs/007-install-first-run/spec.md FR-INSTALL-005, SC-007-006, SC-007-031
//   - Constitution Principle XIV (Paths via single resolver)
//
// The rule itself is shipped by SP-001 in
// tools/eslint-rules/paths-from-resolver-only.js. SP-007 extends the rule's
// `files:` globs to cover the SP-007 source paths so the rule actually fires
// over the install / uninstall / taxonomy-promote / install-helpers source.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const ESLINT_CONFIG_PATH = path.join(process.cwd(), 'eslint.config.js');

describe('SP-007 PREREQ-006 — paths-from-resolver-only scope (T007 / T019)', () => {
  it('eslint.config.js exists', () => {
    expect(fs.existsSync(ESLINT_CONFIG_PATH)).toBe(true);
  });

  it('the paths-from-resolver-only rule scopes over packages/** (covers SP-007 source automatically)', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // The SP-001 setting `files: ['packages/**/*.ts']` already covers every
    // SP-007 source path under packages/cli/. SP-007's contribution is the
    // ESLint-rule-extension verb — making sure the rule continues to apply
    // and is not accidentally narrowed.
    expect(src).toMatch(/paths-from-resolver-only/);
    expect(src).toMatch(/files: \['packages\/\*\*\/\*\.ts'\]/);
  });

  it('the paths-from-resolver-only rule excludes only the resolver source itself', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(
      /ignores:\s*\['packages\/contracts\/src\/paths\.ts'\]/,
    );
  });

  it('SP-007 source paths are not added to the paths-from-resolver-only ignore list', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // The paths-from-resolver-only rule block contains `ignores: [...]`
    // BEFORE `'llm-corpus/paths-from-resolver-only': 'error'`. Locate the
    // block via a non-greedy `ignores:` capture immediately followed by
    // the rule activation, then assert SP-007 paths are absent.
    const match = src.match(
      /ignores:\s*\[([^\]]*)\][\s\S]*?llm-corpus\/paths-from-resolver-only/,
    );
    expect(match).not.toBeNull();
    if (match !== null) {
      const ignoreBody = match[1];
      expect(ignoreBody).not.toMatch(/install-command/);
      expect(ignoreBody).not.toMatch(/uninstall-command/);
      expect(ignoreBody).not.toMatch(/taxonomy-promote-command/);
      expect(ignoreBody).not.toMatch(/install-helpers/);
    }
  });
});
