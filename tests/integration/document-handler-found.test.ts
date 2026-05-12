// T050 — Integration test: corpus://docs/{id} happy path.
//
// References: FR-008, US4 AS1, contracts/resource-document.md.
//
// Loads documents.sql fixture + writes body files; reads via MCP; asserts
// payload validates against DocumentPayload with all 5 frontmatter fields.

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

const FRONTMATTER_PREFIX = (id: string) =>
  [
    '---',
    `id: ${id}`,
    'source_path: /inbox/hybrid-search.md',
    "ingest_timestamp: '2026-05-15T14:30:00Z'",
    'mime_type: text/markdown',
    'hash: 203a252f81339c49f99ae0d484e45842ade66621d0844e8caabbecfb90b77d70',
    '---',
    '',
  ].join('\n');

describe('corpus://docs found (T050 / FR-008 / US4 AS1)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-doc-found-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('reads doc-ab12cd34 with stripped body and parsed frontmatter', async () => {
    const handle = await loadFixture('doc-found-int', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Write body file for doc-ab12cd34.
      const docsDir = path.join(handle.rootDir, 'data', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      const body = '# Hybrid Search with FTS5 and sqlite-vec\n\nThis document explores...\n';
      fs.writeFileSync(
        path.join(docsDir, 'doc-ab12cd34.md'),
        FRONTMATTER_PREFIX('doc-ab12cd34') + body,
        'utf8',
      );

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
        const result = await client.readResource({
          uri: 'corpus://docs/doc-ab12cd34',
        });
        expect(result.contents.length).toBe(1);
        const payload = DocumentPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        expect(payload.uri).toBe('corpus://docs/doc-ab12cd34');
        expect(payload.body).toBe(body);
        expect(payload.frontmatter.id).toBe('doc-ab12cd34');
        expect(payload.frontmatter.mime_type).toBe('text/markdown');
        expect(payload.frontmatter.hash).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });
});
