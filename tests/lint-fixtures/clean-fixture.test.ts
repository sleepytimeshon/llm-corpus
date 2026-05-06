// T054 — Lint-fixture test: clean (no forbidden imports) passes lint.
//
// US3 AS1 / SC-001: a clean repo MUST report a forbidden-imports count of 0.
// Negative-case proof that the rule does NOT false-positive on benign imports.

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import noForbiddenNetworkImports from '../../tools/eslint-rules/no-forbidden-network-imports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'clean');
const fixturePath = path.join(fixturesDir, 'clean.ts');

// Imports that the lint MUST NOT flag. node:fs, node:path, node:os, node:crypto
// are pure compute / FS modules; zod is a benign dependency. undici is
// permitted (the egress hook patches it; the lint rule has no entry for it).
const CLEAN_FIXTURE = `// Fixture for T054 — clean import surface (must pass NFR-001 lint).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const _schema = z.object({ id: z.string() });
export const _used = { fs, path, os, randomUUID, _schema };
`;

async function makeLinter(): Promise<ESLint> {
  const tseslint = await import('typescript-eslint');
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
          },
        },
        plugins: {
          'llm-corpus': {
            rules: {
              'no-forbidden-network-imports': noForbiddenNetworkImports,
            },
          },
        },
        rules: {
          'llm-corpus/no-forbidden-network-imports': 'error',
        },
      },
    ],
  });
}

describe('T054 — clean fixture passes NFR-001 lint', () => {
  beforeAll(() => {
    fs.writeFileSync(fixturePath, CLEAN_FIXTURE);
  });

  it('reports zero forbidden-imports violations on a clean fixture', async () => {
    const linter = await makeLinter();
    const results = await linter.lintFiles([fixturePath]);
    expect(results.length).toBe(1);
    const r = results[0];
    const violations = r.messages.filter(
      (m) => m.ruleId === 'llm-corpus/no-forbidden-network-imports',
    );
    expect(violations).toEqual([]);
    expect(r.errorCount).toBe(0);
  });
});
