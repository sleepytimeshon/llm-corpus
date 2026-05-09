// T054 — Integration test: corpus://docs/{id} URI template appears via
// resources/templates/list (R2 — SDK template-listing support verified).
//
// References: FR-008, US4 AS1 dispatch surface, SC-002 partial,
// plan.md Decision A.
//
// The template entry MUST live in resources/templates/list (NOT in
// resources/list which is for static URIs).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerDocumentResource } from '../../packages/transport/src/resource-document-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';

describe('corpus://docs/{id} template listing (T054 / SC-002 / Decision A)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-doc-template-'));
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('exposes corpus://docs/{id} via resources/templates/list', async () => {
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
      const tlist = await client.listResourceTemplates();
      expect(Array.isArray(tlist.resourceTemplates)).toBe(true);
      const docTemplate = tlist.resourceTemplates.find(
        (t) => t.uriTemplate === 'corpus://docs/{id}',
      );
      expect(docTemplate).toBeDefined();
      expect(docTemplate!.mimeType).toBe('application/json');
      expect(typeof docTemplate!.name).toBe('string');

      // The template URI MUST NOT also appear in the static list.
      const list = await client.listResources();
      const inStaticList = list.resources.find(
        (r) => r.uri === 'corpus://docs/{id}' || r.uri.startsWith('corpus://docs/'),
      );
      expect(inStaticList).toBeUndefined();
    } finally {
      await client.close();
      await built.server.close();
    }
  });
});
