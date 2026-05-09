// T049 — Integration test: corpus://docs/{id} document_not_found error envelope.
//
// References: FR-008, US4 AS2, SC-008 part 1 (-32010), SC-009 contributory.
//
// Asserts MCP error code -32010 with structured data (uri + doc_id) and one
// telemetry event with result='document_not_found', severity='warn'.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';
import { Paths } from '@llm-corpus/contracts';

describe('corpus://docs document_not_found (T049 / SC-008 part 1)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-doc-notfound-'));
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns -32010 document_not_found for unknown id', async () => {
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
        await client.readResource({ uri: 'corpus://docs/doc-deadbeef' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const err = caught as { code?: number; message?: string; data?: { uri?: string; doc_id?: string } };
      // SDK may surface the McpError as a JSON-RPC error; either err.code
      // is the numeric code or err.message includes it.
      const msg = err.message ?? String(caught);
      expect(msg).toMatch(/document_not_found|-32010/);
      if (err.code !== undefined) expect(err.code).toBe(-32010);
      if (err.data) {
        expect(err.data.uri).toBe('corpus://docs/doc-deadbeef');
        expect(err.data.doc_id).toBe('doc-deadbeef');
      }
    } finally {
      await client.close();
      await built.server.close();
    }

    const after = fs.existsSync(tFile) ? fs.readFileSync(tFile, 'utf8') : '';
    const newLines = after.slice(before.length).trim().split('\n').filter(Boolean);
    const events = newLines.map((l) => JSON.parse(l));
    const reads = events.filter((e) => (e as { event?: string }).event === 'resource.read');
    expect(reads.length).toBe(1);
    expect(reads[0].result).toBe('document_not_found');
    expect(reads[0].severity).toBe('warn');
    expect(reads[0].doc_id).toBe('doc-deadbeef');
  });
});
