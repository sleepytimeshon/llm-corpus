// T068 — SC-010: programmatic eslint over the resource-handler call graph
// + runtime row-count smoke. Read-only-by-construction, not by reviewer
// vigilance.
//
// Two layers:
//   1. ESLint smoke — run the project's lint config against a synthetic
//      module containing a forbidden write pattern; assert the rule fires.
//      (This proves the rule's detection logic is intact; the absence of
//      violations on the real handlers is verified via `npm run lint`.)
//   2. Runtime row-count smoke — issue 50 mixed resource reads against a
//      fixture corpus, assert COUNT(*) on documents and taxonomy_terms is
//      unchanged. Read handlers must not write, ever.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ESLint } from 'eslint';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerManifestResource } from '../../packages/transport/src/resource-manifest-handler.js';
import { registerTaxonomyResource } from '../../packages/transport/src/resource-taxonomy-handler.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

describe('SC-010 read-only enforcement (T068)', () => {
  describe('ESLint rule fires on forbidden writes', () => {
    let tmpFile: string | null = null;

    afterEach(() => {
      if (tmpFile && fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });

    it('no-writes-from-resource-handlers flags an INSERT in adapter scope', async () => {
      // Synthesize a fake adapter file containing a forbidden write.
      const target = path.join(
        REPO_ROOT,
        'packages',
        'storage',
        'src',
        'manifest-adapter.ts',
      );
      // Don't actually mutate the real file — write a NEW file in the same
      // scope, lint it, then delete.
      const fakeName = 'manifest-adapter-test-violator.ts';
      const fakePath = path.join(path.dirname(target), fakeName);
      // Use the real adapter file path is in scope; we lint a file that
      // pretends to be in the adapter scope. We'll write the test file at
      // the adapter directory but then rely on inline ESLint configuration.
      tmpFile = fakePath;
      const offendingSrc = [
        'import type { Database as DatabaseType } from "better-sqlite3";',
        'export function writeOps(db: DatabaseType): void {',
        '  db.exec("INSERT INTO documents (id) VALUES (\\\'doc-aaaaaaaa\\\')");',
        '}',
        '',
      ].join('\n');
      fs.writeFileSync(fakePath, offendingSrc, 'utf8');

      // Run the project's eslint config over the synthetic file. The rule
      // is scoped to manifest-adapter.ts in eslint.config.js — so we add
      // an override that scopes the rule to OUR temp file too. We do this
      // by creating an ESLint instance with overrideConfig that mirrors
      // the SC-010 override.
      const localRulesPlugin = (
        await import('../../tools/eslint-rules/no-writes-from-resource-handlers.js')
      ).default;
      const eslint = new ESLint({
        cwd: REPO_ROOT,
        overrideConfigFile: true,
        overrideConfig: [
          {
            files: [`packages/storage/src/${fakeName}`],
            plugins: {
              'llm-corpus': { rules: { 'no-writes-from-resource-handlers': localRulesPlugin } },
            },
            languageOptions: {
              parser: (await import('@typescript-eslint/parser')).default,
              parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
            },
            rules: {
              'llm-corpus/no-writes-from-resource-handlers': 'error',
            },
          },
        ],
      });
      const results = await eslint.lintFiles([fakePath]);
      const messages = results.flatMap((r) => r.messages);
      const violation = messages.find(
        (m) => m.ruleId === 'llm-corpus/no-writes-from-resource-handlers',
      );
      expect(violation).toBeDefined();
      expect(violation!.message).toMatch(/SC-010/);
      expect(violation!.message).toMatch(/INSERT/);
    });
  });

  describe('Runtime row-count smoke (50-read mixed workload)', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let osTmpDir: string;

    beforeEach(() => {
      originalEnv = { ...process.env };
      osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-readonly-'));
      process.env.CORPUS_HOME = osTmpDir;
    });

    afterEach(() => {
      process.env = originalEnv;
      fs.rmSync(osTmpDir, { recursive: true, force: true });
    });

    it(
      '50 mixed reads do not change documents or taxonomy_terms row counts',
      async () => {
        const handle = await loadFixture('readonly-smoke', 'documents');
        try {
          process.env.CORPUS_HOME = handle.rootDir;
          // Add some taxonomy_terms rows so taxonomy reads have something to
          // exercise.
          handle.db.exec(`
            INSERT INTO taxonomy_terms (axis, term, state, established_at) VALUES
            ('domain', 'devops', 'established', '2026-05-01T00:00:00Z'),
            ('domain', 'linux',  'established', '2026-05-01T00:00:00Z'),
            ('tag',    'ansible','established', '2026-05-01T00:00:00Z')
          `);
          // Write body files for the 5 fixture documents so doc reads succeed.
          const docsDir = path.join(handle.rootDir, 'data', 'docs');
          fs.mkdirSync(docsDir, { recursive: true });
          const ids = [
            'doc-ab12cd34',
            'doc-cd34ef56',
            'doc-ef567890',
            'doc-12345678',
            'doc-87654321',
          ];
          for (const id of ids) {
            fs.writeFileSync(
              path.join(docsDir, `${id}.md`),
              [
                '---',
                `id: ${id}`,
                'source_path: /inbox/example.md',
                "ingest_timestamp: '2026-05-15T14:30:00Z'",
                'mime_type: text/markdown',
                'hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                '---',
                '',
                `# ${id}\n`,
              ].join('\n'),
              'utf8',
            );
          }
          const docCountBefore = (
            handle.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as {
              n: number;
            }
          ).n;
          const taxCountBefore = (
            handle.db
              .prepare('SELECT COUNT(*) AS n FROM taxonomy_terms')
              .get() as { n: number }
          ).n;

          const built = buildMcpServer({ ready: false });
          registerManifestResource(built);
          registerTaxonomyResource(built);
          registerRecentResource(built);
          registerDocumentResource(built);
          built.markReady();

          const [c, s] = InMemoryTransport.createLinkedPair();
          const client = new Client(
            { name: 'test-client', version: '0.0.0' },
            { capabilities: {} },
          );
          await Promise.all([built.server.connect(s), client.connect(c)]);

          try {
            // 50 mixed reads: 4 statics × 10 each = 40, + 10 doc reads
            // mixed across the 5 fixture ids.
            for (let i = 0; i < 10; i++) {
              await client.readResource({ uri: 'corpus://manifest' });
              await client.readResource({ uri: 'corpus://taxonomy' });
              await client.readResource({ uri: 'corpus://recent' });
              await client.readResource({
                uri: `corpus://docs/${ids[i % ids.length]}`,
              });
              // 1 doc-not-found read each loop to exercise the failure path.
              try {
                await client.readResource({ uri: 'corpus://docs/doc-deadbeef' });
              } catch {
                /* expected -32010 */
              }
            }
          } finally {
            await client.close();
            await built.server.close();
          }

          const docCountAfter = (
            handle.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as {
              n: number;
            }
          ).n;
          const taxCountAfter = (
            handle.db
              .prepare('SELECT COUNT(*) AS n FROM taxonomy_terms')
              .get() as { n: number }
          ).n;
          expect(docCountAfter).toBe(docCountBefore);
          expect(taxCountAfter).toBe(taxCountBefore);
        } finally {
          handle.cleanup();
        }
      },
      30000,
    );
  });
});
