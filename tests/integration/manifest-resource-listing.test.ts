// T034 — Integration test: corpus://manifest discovery via resources/list.
//
// References: FR-005, US1 AS1, US1 AS2, SC-002 partial (manifest discoverable),
// SC-003 (auto-load annotation attached), R7 (Constitution XVI — annotation
// attached, not enforced).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerManifestResource } from '../../packages/transport/src/resource-manifest-handler.js';
import { ensureIndexInitialized } from '../../packages/storage/src/sqlite-open.js';

describe('resources/list manifest entry (T034 / FR-005 / SC-002 / SC-003)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-manifest-listing-'),
    );
    process.env.CORPUS_HOME = tmpHome;
    ensureIndexInitialized();
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('lists corpus://manifest with the auto-load annotation', async () => {
    const built = buildMcpServer({ ready: false });
    registerManifestResource(built);
    built.markReady();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const listed = await client.listResources();
      const manifest = listed.resources.find(
        (r) => r.uri === 'corpus://manifest',
      );
      expect(manifest).toBeDefined();
      expect(manifest!.mimeType).toBe('application/json');
      expect(typeof manifest!.name).toBe('string');
      expect(typeof manifest!.description).toBe('string');
      // Auto-load annotation per the standard MCP shape.
      const ann = manifest!.annotations as
        | { audience?: string[]; priority?: number }
        | undefined;
      expect(ann).toBeDefined();
      expect(ann!.audience).toEqual(['assistant']);
      expect(ann!.priority).toBe(1.0);
    } finally {
      await client.close();
      await built.server.close();
    }
  });

  it('does NOT list non-canonical manifest URIs', async () => {
    const built = buildMcpServer({ ready: false });
    registerManifestResource(built);
    built.markReady();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const listed = await client.listResources();
      const uris = listed.resources.map((r) => r.uri);
      expect(uris).not.toContain('corpus://manifest.json');
      expect(uris).not.toContain('/manifest');
      expect(uris).not.toContain('manifest');
    } finally {
      await client.close();
      await built.server.close();
    }
  });

  it('listing is stable across two cold-starts of the server', async () => {
    const collect = async (): Promise<string[]> => {
      const built = buildMcpServer({ ready: false });
      registerManifestResource(built);
      built.markReady();
      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);
      try {
        const listed = await client.listResources();
        return listed.resources.map((r) => r.uri).sort();
      } finally {
        await client.close();
        await built.server.close();
      }
    };
    const first = await collect();
    const second = await collect();
    expect(first).toEqual(second);
  });
});
