// T060 — Integration test: corpus://recent against empty corpus.
//
// References: FR-007, US3 AS3, SC-004 partial.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';
import { RecentPayload } from '@llm-corpus/contracts';

describe('corpus://recent empty corpus (T060 / FR-007 / SC-004 partial)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-recent-empty-'));
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns {entries: []} on empty corpus', async () => {
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
      const result = await client.readResource({ uri: 'corpus://recent' });
      expect(result.contents.length).toBe(1);
      const c0 = result.contents[0]!;
      expect(c0.mimeType).toBe('application/json');
      const payload = RecentPayload.parse(JSON.parse(c0.text as string));
      expect(payload).toEqual({ entries: [] });
    } finally {
      await client.close();
      await built.server.close();
    }
  });
});
