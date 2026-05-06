// T028 — Integration test: tools/list response contract.
// Asserts that the SP-001 MCP server registers exactly one tool, named
// `corpus.find`, with valid input + output JSON Schemas.
//
// References: FR-001, US1 AS1, US1 AS3, SC-006, contracts/mcp-corpus-find.md

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';

describe('MCP tools/list contract (T028 / FR-001 / SC-006)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-mcp-tools-list-'));
    process.env.CORPUS_HOME = tmpHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('advertises exactly one tool named corpus.find with input + output JSON Schemas', async () => {
    // Build server in already-ready state (test seam — production goes through
    // bootstrap; here we want to verify the tools/list contract).
    const { server } = buildMcpServer({ ready: true });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const listed = await client.listTools();

      expect(listed.tools).toHaveLength(1);
      const tool = listed.tools[0];
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('corpus.find');
      expect(typeof tool!.description).toBe('string');
      expect(tool!.description!.length).toBeGreaterThan(0);

      // Input schema — must be a valid JSON Schema with `query` required.
      expect(tool!.inputSchema).toBeDefined();
      const input = tool!.inputSchema as Record<string, unknown>;
      expect(input['type']).toBe('object');
      const inputProps = input['properties'] as Record<string, unknown>;
      expect(inputProps).toHaveProperty('query');
      expect(input['required']).toEqual(expect.arrayContaining(['query']));

      // Output schema — must be a valid JSON Schema describing CorpusFindOutput.
      expect(tool!.outputSchema).toBeDefined();
      const output = tool!.outputSchema as Record<string, unknown>;
      expect(output['type']).toBe('object');
      const outputProps = output['properties'] as Record<string, unknown>;
      expect(outputProps).toHaveProperty('hits');
      expect(outputProps).toHaveProperty('query');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('tools/call corpus.find returns empty hits + echoed query (SP-001 placeholder)', async () => {
    const { server } = buildMcpServer({ ready: true });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.callTool({
        name: 'corpus.find',
        arguments: { query: 'hello world' },
      });

      // The MCP SDK delivers the JSON output as a `text` content block; payload
      // is the JSON-stringified CorpusFindOutput.
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBeGreaterThan(0);
      const textBlock = content.find((c) => c.type === 'text');
      expect(textBlock).toBeDefined();
      const payload = JSON.parse(textBlock!.text!);
      expect(payload.hits).toEqual([]);
      expect(payload.query).toBe('hello world');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
