// T061 — Integration test: corpus://recent failure-lane exclusion (SC-006).
//
// References: FR-007, US3 AS2, SC-006.
// Loads the recent-mixed-failure fixture (5 success + 5 failed); asserts
// only the 5 success ids appear in the response.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { RecentPayload } from '@llm-corpus/contracts';

describe('corpus://recent failure-lane exclusion (T061 / SC-006)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-recent-fail-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('excludes failed status rows from the response', async () => {
    const handle = await loadFixture(
      'recent-failure-int',
      'recent-mixed-failure',
    );
    try {
      process.env.CORPUS_HOME = handle.rootDir;
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
        const payload = RecentPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        expect(payload.entries.length).toBe(5);
        for (const e of payload.entries) {
          expect(e.id.startsWith('doc-aa')).toBe(true);
          expect(e.id.startsWith('doc-ff')).toBe(false);
        }
        // Strict descending order.
        const ts = payload.entries.map((e) => e.ingest_timestamp);
        for (let i = 1; i < ts.length; i++) {
          expect(ts[i] < ts[i - 1]).toBe(true);
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
