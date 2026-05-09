// T041 — Integration test: corpus://taxonomy against empty corpus.
//
// References: FR-006, US2 AS3, SC-004 partial.
// Asserts the empty-state envelope: all four axes are empty arrays;
// types/source_types are NOT pre-populated with their fixed-enum values.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerTaxonomyResource } from '../../packages/transport/src/resource-taxonomy-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';
import { TaxonomyPayload } from '../../packages/contracts/src/index.js';

describe('corpus://taxonomy empty corpus (T041 / FR-006 / SC-004 partial)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-taxonomy-empty-'));
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns 4-axis empty envelope', async () => {
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
      const result = await client.readResource({ uri: 'corpus://taxonomy' });
      expect(result.contents.length).toBe(1);
      const c0 = result.contents[0]!;
      expect(c0.mimeType).toBe('application/json');
      const payload = TaxonomyPayload.parse(JSON.parse(c0.text as string));
      expect(payload).toEqual({
        domains: [],
        tags: [],
        types: [],
        source_types: [],
      });
    } finally {
      await client.close();
      await built.server.close();
    }
  });
});
