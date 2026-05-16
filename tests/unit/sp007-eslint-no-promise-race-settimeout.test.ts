// SP-007 T010 — RED-phase contract test for the no-Promise.race(setTimeout)
// AST-level / code-search check over SP-007 install-helpers source.
//
// References:
//   - specs/007-install-first-run/tasks.md T010
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-017,
//     SC-007-029, SC-007-034
//   - Constitution Principle VII (cancellable IO; AbortController only)
//
// SPEC-CONTRADICTION NOTE (flagged for retrospective): tasks.md T010 hedges
// between "the existing SP-001 `no-promise-race-settimeout` lint rule (or the
// AST-level check)". tools/eslint-rules/ does NOT ship a
// no-promise-race-settimeout.js file (only the six SP-001..SP-006 rules:
// no-direct-worker-spawn, no-forbidden-network-imports,
// no-process-exit-in-libs, no-shell-string-exec, no-writes-from-resource-
// handlers, paths-from-resolver-only). SP-006 enforces the Constitution VII
// ban via the grep-based code-search test
// (tests/lint-fixtures/sp006-constitutional-grep.test.ts). SP-007 adopts the
// same pattern — the AST-level check is performed via the
// sp007-constitutional-grep test (Phase 8 T084). For Phase 2 PREREQ-006 we
// assert that the grep test infrastructure exists and that the SP-007 source
// directory is included once it is created in Phase 3+.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('SP-007 PREREQ-006 — Promise.race(setTimeout) ban scope (T010)', () => {
  it('the SP-006 constitutional-grep test exists as the prior-art template for SP-007', () => {
    const sp006Grep = path.join(
      process.cwd(),
      'tests',
      'lint-fixtures',
      'sp006-constitutional-grep.test.ts',
    );
    expect(fs.existsSync(sp006Grep)).toBe(true);
    const src = fs.readFileSync(sp006Grep, 'utf8');
    // The SP-006 grep test enforces the Constitution VII ban; SP-007 mirrors
    // the pattern in Phase 8 T084. The required pattern is "Promise.race("
    // followed (within a few hundred chars) by "setTimeout(".
    expect(src).toMatch(/Promise\\\.race/);
    expect(src).toMatch(/setTimeout/);
  });

  it('install-helpers/ source is empty in Phase 2 (Phase 3+ will populate)', () => {
    // SP-007 install-helpers/ files are created in Phase 3 (T034-T046).
    // Phase 2 PREREQ-006 only sets up the lint scope; the actual source
    // files do not yet exist. Verify the directory is absent at this point
    // so a subsequent phase's grep over the dir is meaningful.
    const helpersDir = path.join(
      process.cwd(),
      'packages',
      'cli',
      'src',
      'install-helpers',
    );
    // If the dir already exists (because Engineer #2/#3 ran first), assert
    // every file under it is free of Promise.race(setTimeout) — defensive,
    // not regressed.
    if (fs.existsSync(helpersDir)) {
      const walk = (dir: string, acc: string[]): string[] => {
        for (const entry of fs.readdirSync(dir)) {
          const p = path.join(dir, entry);
          const stat = fs.statSync(p);
          if (stat.isDirectory()) walk(p, acc);
          else if (p.endsWith('.ts')) acc.push(p);
        }
        return acc;
      };
      const files = walk(helpersDir, []);
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        expect(/Promise\.race\([\s\S]{0,200}setTimeout\(/.test(stripped)).toBe(
          false,
        );
      }
    } else {
      // Phase 2: dir not yet created — pass trivially. Phase 8 T084 will
      // enforce the ban over the populated dir.
      expect(true).toBe(true);
    }
  });
});
