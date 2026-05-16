// SP-007 T009 — RED-phase contract test for the no-shell-string-exec lint
// rule scope over SP-007 install-helpers source.
//
// References:
//   - specs/007-install-first-run/tasks.md T009 / T019
//   - specs/007-install-first-run/spec.md FR-INSTALL-018, SC-007-030
//   - Constitution Principle XII (subprocess hygiene via runTool only)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const ESLINT_CONFIG_PATH = path.join(process.cwd(), 'eslint.config.js');

describe('SP-007 PREREQ-006 — no-shell-string-exec scope (T009 / T019)', () => {
  it('the no-shell-string-exec rule is armed at error level (covers packages/** by default)', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    expect(src).toMatch(/'llm-corpus\/no-shell-string-exec':\s*'error'/);
  });

  it('the rule scopes over packages/cli/** including install-helpers/', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // The SP-001 setting applies the rule globally across packages/**/*.ts;
    // SP-007 source paths (packages/cli/src/install-helpers/) are covered.
    expect(src).toMatch(/packages\/\*\*\/\*\.ts/);
    expect(src).toMatch(/'llm-corpus\/no-shell-string-exec'/);
  });

  it('no-shell-string-exec is not narrowed via an ignore list excluding install-helpers/', () => {
    const src = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf8');
    // The rule activates globally on packages/**/*.ts. Verify no future
    // config block carves install-helpers/ out of it via an `ignores:`
    // adjacent to a `no-shell-string-exec: 'off'`.
    const offBlock = src.match(
      /ignores:\s*\[([^\]]*)\][\s\S]{0,400}?'llm-corpus\/no-shell-string-exec':\s*'off'/,
    );
    if (offBlock !== null) {
      expect(offBlock[1]).not.toMatch(/install-helpers/);
    } else {
      expect(true).toBe(true);
    }
  });
});
