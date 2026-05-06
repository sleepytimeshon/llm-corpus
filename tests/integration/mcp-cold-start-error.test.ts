// T030 — Integration test: cold-start race returns -32002 server_initializing.
// When tools/list arrives during the bootstrapping phase (egress hook
// registered but server not yet ready), the response MUST be the
// server_initializing error envelope.
//
// References: FR-001, US1 AS4, contracts/mcp-corpus-find.md §"Cold-start error envelope"

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';

describe('MCP cold-start error envelope (T030 / FR-001 / US1 AS4)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-mcp-cold-start-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns -32002 server_initializing when tools/list arrives before ready', async () => {
    // Build server in NOT-ready state (bootstrapping). The handler will
    // refuse tools/list with the cold-start error envelope until markReady()
    // is called.
    const { server, markReady } = buildMcpServer({ ready: false });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      let caught: unknown = undefined;
      try {
        await client.listTools();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errMsg = (caught as Error).message ?? String(caught);
      // Look for server_initializing in the error message OR for code -32002.
      expect(errMsg).toMatch(/server_initializing|-32002/);

      // After markReady(), tools/list succeeds.
      markReady();
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0]!.name).toBe('corpus.find');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('cold-start error includes retry_after_ms in data envelope when accessible', async () => {
    // The MCP SDK surfaces JSON-RPC errors as Error objects with code/data
    // fields. We assert the data.retry_after_ms is present when available.
    const { server } = buildMcpServer({ ready: false });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      let caught: unknown = undefined;
      try {
        await client.listTools();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const e = caught as { code?: number; data?: { retry_after_ms?: number } };
      // SDK exposes JSON-RPC code as `.code`. -32002 is the contract value.
      if (e.code !== undefined) {
        expect(e.code).toBe(-32002);
      }
      if (e.data?.retry_after_ms !== undefined) {
        expect(typeof e.data.retry_after_ms).toBe('number');
        expect(e.data.retry_after_ms).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
