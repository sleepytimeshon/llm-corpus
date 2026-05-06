// T056 — Lint-fixture test: all six in-scope packages enforce NFR-001.
//
// NFR-001 scope per data-model.md / eslint.config.js:
//   pipeline, storage, index, inference, extract, cli
//
// US3 AS3: adding a forbidden import to a file in EACH in-scope package MUST
// produce 6 violations (one per package). Uses the real project config —
// that's the contract under test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESLint } from 'eslint';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const IN_SCOPE_PACKAGES: ReadonlyArray<string> = [
  'pipeline',
  'storage',
  'index',
  'inference',
  'extract',
  'cli',
];

const FIXTURE_BODY = `// Fixture for T056 — all-in-scope verification.
// This file lives under packages/{pkg}/ which IS in NFR-001 lint scope.
// The forbidden import below MUST trigger the rule.
import 'node:http';
export {};
`;

const fixturePaths: string[] = IN_SCOPE_PACKAGES.map((pkg) =>
  path.join(
    repoRoot,
    'packages',
    pkg,
    'src',
    '__nfr001-all-in-scope-fixture.ts',
  ),
);

describe('T056 — NFR-001 enforced in all 6 in-scope packages', () => {
  beforeAll(() => {
    for (const p of fixturePaths) {
      fs.writeFileSync(p, FIXTURE_BODY);
    }
  });
  afterAll(() => {
    for (const p of fixturePaths) {
      if (fs.existsSync(p)) fs.rmSync(p);
    }
  });

  it('forbidden import flagged in every in-scope package', async () => {
    const linter = new ESLint({ cwd: repoRoot });
    const results = await linter.lintFiles(fixturePaths);
    expect(results.length).toBe(IN_SCOPE_PACKAGES.length);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nfr001 = r.messages.filter(
        (m) => m.ruleId === 'llm-corpus/no-forbidden-network-imports',
      );
      expect(
        nfr001.length,
        `expected NFR-001 violation in ${r.filePath}`,
      ).toBeGreaterThan(0);
    }
  });
});
