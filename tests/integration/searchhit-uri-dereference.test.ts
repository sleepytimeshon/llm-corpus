// T053 — Integration test: SC-007 SearchHit URI integrity dereferencing.
//
// References: FR-008, US4 AS3, SC-007.
//
// Loads documents.sql + searchhit-fixture-uris.json, dereferences each
// SearchHit URI through corpus://docs/{id}, asserts every payload's
// frontmatter.id matches the SearchHit id.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { DocumentPayload } from '@llm-corpus/contracts';

const FRONTMATTER = (id: string) =>
  [
    '---',
    `id: ${id}`,
    'source_path: /inbox/example.md',
    "ingest_timestamp: '2026-05-15T14:30:00Z'",
    'mime_type: text/markdown',
    'hash: 203a252f81339c49f99ae0d484e45842ade66621d0844e8caabbecfb90b77d70',
    '---',
    '',
  ].join('\n');

function findFixtureFile(relName: string): string {
  let dir = new URL('.', import.meta.url).pathname;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(
      dir,
      'tests',
      'fixtures',
      'sp002-populated',
      relName,
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`fixture ${relName} not found`);
}

describe('SearchHit URI integrity (T053 / SC-007)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-searchhit-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('dereferences every fixture SearchHit URI to the matching document', async () => {
    const handle = await loadFixture('searchhit-int', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Write body files for the 5 fixture documents.
      const docsDir = path.join(handle.rootDir, 'data', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      const fixtureIds = [
        'doc-ab12cd34',
        'doc-cd34ef56',
        'doc-ef567890',
        'doc-12345678',
        'doc-87654321',
      ];
      for (const id of fixtureIds) {
        fs.writeFileSync(
          path.join(docsDir, `${id}.md`),
          FRONTMATTER(id) + `# ${id}\n\nbody for ${id}\n`,
          'utf8',
        );
      }

      const searchHitsRaw = fs.readFileSync(
        findFixtureFile('searchhit-fixture-uris.json'),
        'utf8',
      );
      const searchHits = JSON.parse(searchHitsRaw) as Array<{
        id: string;
        uri: string;
      }>;

      const built = buildMcpServer({ ready: false });
      registerDocumentResource(built);
      built.markReady();
      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);

      try {
        for (const hit of searchHits) {
          expect(hit.uri).toMatch(/^corpus:\/\/docs\/doc-[0-9a-f]{8}$/);
          const result = await client.readResource({ uri: hit.uri });
          const parsed = DocumentPayload.parse(
            JSON.parse(result.contents[0]!.text as string),
          );
          // URI ↔ document integrity.
          expect(parsed.frontmatter.id).toBe(hit.id);
          expect(parsed.uri).toBe(hit.uri);
        }
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });
});
