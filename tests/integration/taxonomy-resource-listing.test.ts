// T043 — Integration test: corpus://taxonomy in resources/list (no auto-load).
//
// References: FR-006, contracts/resource-taxonomy.md "Registration",
// SC-002 partial. Taxonomy is read-on-demand — NOT auto-loaded; only the
// manifest carries the auto-load annotation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerTaxonomyResource } from '../../packages/transport/src/resource-taxonomy-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';

describe('resources/list taxonomy entry (T043 / FR-006 / SC-002)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-taxonomy-listing-'),
    );
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('lists corpus://taxonomy with NO auto-load annotation', async () => {
    const built = buildMcpServer({ ready: false });
    registerTaxonomyResource(built);
    built.markReady();

    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([built.server.connect(s), client.connect(c)]);

    try {
      const listed = await client.listResources();
      const tx = listed.resources.find((r) => r.uri === 'corpus://taxonomy');
      expect(tx).toBeDefined();
      expect(tx!.mimeType).toBe('application/json');
      // No annotations object — taxonomy is NOT auto-loaded.
      expect(tx!.annotations).toBeUndefined();
    } finally {
      await client.close();
      await built.server.close();
    }
  });
});
