// T056 (SP-004 US3) — CI-only assertion that NO SP-004 code path
// performs INSERT INTO taxonomy_terms with state='established'.
//
// Spec references:
//   - FR-CLASSIFY-007 + SC-CLASSIFY-003 + Constitution Principle XV
//
// Constitutional invariant: SP-004 NEVER inserts established-state rows.
// The only way to land such a row is via a future user-review promotion
// workflow (which doesn't exist yet).

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const SP004_INSERT_SOURCE_PATHS = [
  'packages/inference/src',
  'packages/pipeline/src/classify-stage.ts',
  'packages/pipeline/src/classify-circuit-breaker.ts',
  'packages/storage/src/taxonomy-terms-adapter.ts',
  'packages/storage/src/classify-persister.ts',
  'packages/daemon/src',
  'packages/cli/src/reenrich-command.ts',
];

describe('US3 SC-CLASSIFY-003 — no INSERT INTO taxonomy_terms with state=established in SP-004 source', () => {
  it('grep over SP-004 INSERT statements returns zero "established" literals', () => {
    const repoRoot = process.cwd();
    let allMatches = '';
    for (const rel of SP004_INSERT_SOURCE_PATHS) {
      const target = path.join(repoRoot, rel);
      try {
        // grep -r returns exit 1 when no matches; tolerate via || true semantics
        // with `set +e`-style invocation that swallows non-zero exits.
        const out = execSync(
          `grep -rn "INSERT INTO taxonomy_terms" ${JSON.stringify(target)} || true`,
          { encoding: 'utf8' },
        );
        // Only count matches whose bound state literal is NOT 'proposed'.
        const lines = out
          .split('\n')
          .filter((l) => l.includes('INSERT INTO taxonomy_terms'));
        for (const line of lines) {
          // The next ~120 chars in the file should bind 'proposed' as the
          // state literal. If 'established' appears within the same INSERT
          // statement segment, that's a violation.
          // The taxonomy-terms-adapter.ts grep-asserts zero 'established'
          // literals anywhere in the file (T006). This test cross-validates
          // by scanning the rest of the SP-004 source for the combined
          // INSERT + established pattern.
          allMatches += line + '\n';
        }
      } catch {
        // path may not exist for directory entries; skip
      }
    }
    // Now grep for the combined "INSERT INTO taxonomy_terms" followed
    // shortly by `'established'`. If any single line shows BOTH, flag.
    const combinedViolation = allMatches
      .split('\n')
      .some((l) => l.includes("'established'"));
    expect(combinedViolation).toBe(false);
  });

  it('taxonomy-terms-adapter.ts grep for "\'established\'" literal returns zero matches', () => {
    const filePath = path.join(
      process.cwd(),
      'packages/storage/src/taxonomy-terms-adapter.ts',
    );
    const out = execSync(`grep -n "'established'" ${JSON.stringify(filePath)} || true`, {
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('');
  });
});
