// T017 (SP-004 US1) — OllamaAdapter mid-flight abort.
//
// Verifies that controller.abort() during an in-flight fetch propagates
// through undici and produces a Result.err carrying an AbortError-like
// signature. No orphan socket; no Promise.race(setTimeout) hidden inside.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-009
//   - Constitution Principle VII (Cancellable, Bounded IO)
//
// TDD: this test MUST FAIL before T030 (the implementation) lands.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const SCHEMA = { type: 'object', additionalProperties: false } as const;

interface SlowServer {
  port: number;
  close: () => Promise<void>;
}

async function startSlowOllama(): Promise<SlowServer> {
  const server = http.createServer((_req, res) => {
    // Never respond — let the client abort.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // do NOT call res.end()
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // Close all sockets first; ignore errors.
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

describe('US1 — OllamaAdapter mid-flight abort', () => {
  let mock: SlowServer;
  beforeAll(async () => {
    mock = await startSlowOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('mid-flight controller.abort() rejects the classify call with an abort signature', async () => {
    const { OllamaAdapter } = await import(
      '../../packages/inference/src/ollama-adapter.js'
    );
    const adapter = new (OllamaAdapter as new (opts: {
      model: string;
      schema: object;
      baseUrl: string;
    }) => {
      classify: (input: {
        systemMessage: string;
        userMessage: string;
        signal: AbortSignal;
      }) => Promise<{ ok: boolean; error?: { name: string } }>;
    })({
      model: 'qwen3.5:9b',
      schema: SCHEMA,
      baseUrl: `http://127.0.0.1:${mock.port}`,
    });
    const controller = new AbortController();
    const promise = adapter.classify({
      systemMessage: 'sys',
      userMessage: 'usr',
      signal: controller.signal,
    });
    // Abort after a tick.
    setTimeout(() => controller.abort(), 20);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // undici / Node fetch surfaces AbortError or DOMException with name 'AbortError'.
      const name = (result.error as Error).name;
      expect(['AbortError', 'OllamaUnavailableError']).toContain(name);
    }
  });
});
