// T063 — Integration test: corpus://recent in resources/list (no auto-load).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';

describe('resources/list recent entry (T063 / FR-007 / SC-002)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-recent-listing-'));
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('lists corpus://recent with NO auto-load annotation', async () => {
    const built = buildMcpServer({ ready: false });
    registerRecentResource(built);
    built.markReady();

    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([built.server.connect(s), client.connect(c)]);

    try {
      const listed = await client.listResources();
      const r = listed.resources.find((x) => x.uri === 'corpus://recent');
      expect(r).toBeDefined();
      expect(r!.mimeType).toBe('application/json');
      expect(r!.annotations).toBeUndefined();
    } finally {
      await client.close();
      await built.server.close();
    }
  });
});
