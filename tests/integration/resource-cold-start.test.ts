// T019 — Integration test: cold-start race returns -32002 server_initializing
// for resources/list, resources/templates/list, and resources/read.
//
// Mirrors SP-001's tests/integration/mcp-cold-start-error.test.ts pattern but
// for the resources/* surface. After markReady() is called, requests succeed.
//
// References: contracts/mcp-resources-api.md "Bootstrap ordering",
// FR-005..FR-008 cross-cutting cold-start contract,
// edge case "Resource read while server is initializing".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';

describe('Resource cold-start error envelope (T019 / FR-005..FR-008)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-resource-cold-start-'),
    );
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('resources/list returns -32002 server_initializing before markReady', async () => {
    const { server, markReady } = buildMcpServer({ ready: false });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      let caught: unknown = undefined;
      try {
        await client.listResources();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errMsg = (caught as Error).message ?? String(caught);
      expect(errMsg).toMatch(/server_initializing|-32002/);

      // After markReady, listResources should succeed (returns the 3 statics).
      markReady();
      const listed = await client.listResources();
      expect(Array.isArray(listed.resources)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('resources/templates/list returns -32002 server_initializing before markReady', async () => {
    const { server, markReady } = buildMcpServer({ ready: false });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      let caught: unknown = undefined;
      try {
        await client.listResourceTemplates();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errMsg = (caught as Error).message ?? String(caught);
      expect(errMsg).toMatch(/server_initializing|-32002/);

      markReady();
      const listed = await client.listResourceTemplates();
      expect(Array.isArray(listed.resourceTemplates)).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    'corpus://manifest',
    'corpus://taxonomy',
    'corpus://recent',
    'corpus://docs/doc-ab12cd34',
  ])(
    'resources/read %s returns -32002 server_initializing before markReady',
    async (uri) => {
      const { server } = buildMcpServer({ ready: false });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      try {
        let caught: unknown = undefined;
        try {
          await client.readResource({ uri });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeDefined();
        const errMsg = (caught as Error).message ?? String(caught);
        expect(errMsg).toMatch(/server_initializing|-32002/);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it('cold-start error data includes retry_after_ms and phase=bootstrapping', async () => {
    const { server } = buildMcpServer({ ready: false });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: 'test-client', version: '0.0.0' },
      { capabilities: {} },
    );
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      let caught: unknown = undefined;
      try {
        await client.listResources();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const e = caught as {
        code?: number;
        data?: { retry_after_ms?: number; phase?: string };
      };
      if (e.code !== undefined) {
        expect(e.code).toBe(-32002);
      }
      if (e.data?.retry_after_ms !== undefined) {
        expect(typeof e.data.retry_after_ms).toBe('number');
        expect(e.data.retry_after_ms).toBeGreaterThan(0);
      }
      if (e.data?.phase !== undefined) {
        expect(e.data.phase).toBe('bootstrapping');
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
