// T052 — Integration test: corpus://docs/{id} integrity-loss surfaces -32603.
//
// References: FR-008, contracts/resource-document.md "URI integrity contract",
// Constitution VIII.
//
// When the body file's frontmatter id ≠ requested URI id, the adapter returns
// IntegrityLossError. The handler maps it to MCP error code -32603 with
// severity='error' telemetry — this is a corpus-bug surface, not user error.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { Paths } from '@llm-corpus/contracts';

describe('corpus://docs integrity-loss (T052)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-doc-integrity-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('returns -32603 Internal error and severity=error telemetry on id mismatch', async () => {
    const handle = await loadFixture('doc-integrity-int', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Body file declares a DIFFERENT id in its frontmatter.
      const docsDir = path.join(handle.rootDir, 'data', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      const wrongFrontmatter = [
        '---',
        'id: doc-99999999',
        'source_path: /inbox/x.md',
        "ingest_timestamp: '2026-05-15T14:30:00Z'",
        'mime_type: text/markdown',
        'hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        '---',
        '',
        'body content',
      ].join('\n');
      fs.writeFileSync(
        path.join(docsDir, 'doc-ab12cd34.md'),
        wrongFrontmatter,
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

      const tFile = Paths.telemetry();
      const before = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8') : '';

      try {
        let caught: unknown;
        try {
          await client.readResource({ uri: 'corpus://docs/doc-ab12cd34' });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeDefined();
        const err = caught as { code?: number; message?: string };
        const msg = err.message ?? String(caught);
        expect(msg).toMatch(/Internal error|-32603|integrity/i);
        if (err.code !== undefined) expect(err.code).toBe(-32603);
      } finally {
        await client.close();
        await built.server.close();
      }

      const after = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8') : '';
      const newLines = after
        .slice(before.length)
        .trim()
        .split('\n')
        .filter(Boolean);
      const events = newLines.map((l) => JSON.parse(l));
      const reads = events.filter(
        (e) => (e as { event?: string }).event === 'resource.read',
      );
      expect(reads.length).toBe(1);
      expect(reads[0].result).toBe('error');
      expect(reads[0].severity).toBe('error');
      expect(reads[0].doc_id).toBe('doc-ab12cd34');
    } finally {
      handle.cleanup();
    }
  });
});
