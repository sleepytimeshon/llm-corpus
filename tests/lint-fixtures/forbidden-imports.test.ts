// T053 — Lint-fixture test: NFR-001 forbidden-import detection.
//
// For every entry in `data-model.md` ForbiddenImportSet (mirrored in
// tools/eslint-rules/no-forbidden-network-imports.js), create a fixture file
// containing that import and assert the rule reports a violation that names
// the offending file and the import.
//
// Per US3 AS2 / SC-001: lint must fail with a clear diagnostic naming the
// file + import.

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import noForbiddenNetworkImports from '../../tools/eslint-rules/no-forbidden-network-imports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'forbidden');

// Mirrors data-model.md §ForbiddenImportSet. Adding a forbidden import here
// requires a corresponding entry in `tools/eslint-rules/no-forbidden-network-imports.js`.
const FORBIDDEN_IMPORTS: ReadonlyArray<{ name: string; importStatement: string }> = [
  // Node built-in network modules
  { name: 'node-http', importStatement: "import 'node:http';" },
  { name: 'node-https', importStatement: "import 'node:https';" },
  { name: 'node-fetch-builtin', importStatement: "import 'node:fetch';" },
  { name: 'node-net', importStatement: "import 'node:net';" },
  { name: 'http-bare', importStatement: "import 'http';" },
  { name: 'https-bare', importStatement: "import 'https';" },
  { name: 'net-bare', importStatement: "import 'net';" },
  // Cloud SDK families (prefix-matched)
  { name: 'aws-sdk-client-s3', importStatement: "import '@aws-sdk/client-s3';" },
  { name: 'azure-storage', importStatement: "import '@azure/storage-blob';" },
  { name: 'google-cloud-storage', importStatement: "import '@google-cloud/storage';" },
  { name: 'anthropic-sdk', importStatement: "import '@anthropic-ai/sdk';" },
  { name: 'openai', importStatement: "import 'openai';" },
  { name: 'cohere-ai', importStatement: "import 'cohere-ai';" },
  // HTTP clients
  { name: 'axios', importStatement: "import 'axios';" },
  { name: 'got', importStatement: "import 'got';" },
  { name: 'node-fetch', importStatement: "import 'node-fetch';" },
  { name: 'cross-fetch', importStatement: "import 'cross-fetch';" },
];

/**
 * Build an ESLint instance configured to enforce the forbidden-imports rule
 * on a fixture file regardless of its on-disk location.
 */
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

describe('T053 — NFR-001 forbidden-import lint detection', () => {
  beforeAll(() => {
    // Materialize the fixture files. ESLint reads from disk for accurate
    // path reporting in the diagnostic.
    for (const { name, importStatement } of FORBIDDEN_IMPORTS) {
      const fixturePath = path.join(fixturesDir, `${name}.ts`);
      fs.writeFileSync(
        fixturePath,
        `// Fixture for T053 — forbidden-import detection (${name}).\n${importStatement}\nexport {};\n`,
      );
    }
  });

  for (const { name, importStatement } of FORBIDDEN_IMPORTS) {
    it(`detects forbidden import "${name}" and names file + import`, async () => {
      const fixturePath = path.join(fixturesDir, `${name}.ts`);
      const linter = await makeLinter();
      const results = await linter.lintFiles([fixturePath]);
      expect(results.length).toBe(1);
      const r = results[0];
      // Diagnostic names the file
      expect(r.filePath).toBe(fixturePath);
      // At least one violation
      expect(r.errorCount).toBeGreaterThan(0);
      // Diagnostic names the forbidden import source
      const violation = r.messages.find(
        (m) => m.ruleId === 'llm-corpus/no-forbidden-network-imports',
      );
      expect(violation).toBeDefined();
      const sourceMatch = importStatement.match(/import ['"](.+?)['"];/);
      expect(sourceMatch).not.toBeNull();
      const source = sourceMatch![1];
      expect(violation!.message).toContain(source);
    });
  }
});
