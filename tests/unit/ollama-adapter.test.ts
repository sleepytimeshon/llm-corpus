// T016 (SP-004 US1) — OllamaAdapter contract test.
//
// Verifies the OllamaAdapter:
//   - Constructs against {model, schema, baseUrl}; throws
//     ClassifierConfigurationError when schema is missing/empty.
//   - classify({systemMessage, userMessage, signal}) returns
//     Promise<Result<ClassifierOutput, OllamaError>>.
//   - On ECONNREFUSED returns Result.err(OllamaUnavailableError).
//   - HTTP POSTs to <baseUrl>/api/chat with the format parameter set to the
//     constructor schema, stream=false, options.temperature=0.1.
//   - AbortSignal propagates end-to-end (covered separately in T017).
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-003, FR-CLASSIFY-004,
//     FR-CLASSIFY-009
//   - specs/004-classifier/research.md Decision B
//   - Constitution Principle V (Schema-Enforced Structured Output)
//   - Constitution Principle VII (Cancellable, Bounded IO)
//
// TDD: this test MUST FAIL before T030 (the implementation) lands.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const SCHEMA = { type: 'object', additionalProperties: false } as const;

interface CapturedRequest {
  body: string;
  url: string | undefined;
}

interface MockServer {
  port: number;
  close: () => Promise<void>;
  captured: CapturedRequest[];
  setResponse: (response: object) => void;
}

async function startMockOllama(): Promise<MockServer> {
  let currentResponse: object = { message: { content: '{}' } };
  const captured: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      captured.push({
        url: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentResponse));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    captured,
    setResponse: (r) => {
      currentResponse = r;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe('US1 — OllamaAdapter (contract)', () => {
  let mock: MockServer;
  beforeAll(async () => {
    mock = await startMockOllama();
  });
  afterAll(async () => {
    await mock.close();
  });

  it('OllamaAdapter is exported from packages/inference', async () => {
    const mod = (await import(
      '../../packages/inference/src/ollama-adapter.js'
    )) as Record<string, unknown>;
    expect(typeof mod.OllamaAdapter).toBe('function');
  });

  it('constructor throws ClassifierConfigurationError when schema is missing', async () => {
    const { OllamaAdapter } = await import(
      '../../packages/inference/src/ollama-adapter.js'
    );
    const { ClassifierConfigurationError } = await import(
      '@llm-corpus/contracts'
    );
    expect(() => {
      new (OllamaAdapter as unknown as new (opts: object) => unknown)({
        model: 'qwen3.5:9b',
        baseUrl: `http://127.0.0.1:${mock.port}`,
      });
    }).toThrow(ClassifierConfigurationError);
  });

  it('classify posts to /api/chat with format=schema, stream=false, temperature=0.1', async () => {
    const { OllamaAdapter } = await import(
      '../../packages/inference/src/ollama-adapter.js'
    );
    mock.setResponse({
      message: {
        role: 'assistant',
        content: JSON.stringify({
          facet_domain: 'agent-systems',
          facet_type: 'tutorial',
          tags: ['memory', 'retrieval', 'tutorial'],
          summary: 'short.',
          confidence: { domain: 0.9, type: 0.9, tags: 0.9 },
        }),
      },
    });
    const adapter = new (OllamaAdapter as new (opts: {
      model: string;
      schema: object;
      baseUrl: string;
    }) => {
      classify: (input: {
        systemMessage: string;
        userMessage: string;
        signal: AbortSignal;
      }) => Promise<{ ok: boolean; value?: { content: string } }>;
    })({
      model: 'qwen3.5:9b',
      schema: SCHEMA,
      baseUrl: `http://127.0.0.1:${mock.port}`,
    });
    const before = mock.captured.length;
    const controller = new AbortController();
    const result = await adapter.classify({
      systemMessage: 'sys',
      userMessage: 'usr',
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    const capturedNow = mock.captured.slice(before);
    expect(capturedNow.length).toBe(1);
    const captured = capturedNow[0]!;
    expect(captured.url).toBe('/api/chat');
    const body = JSON.parse(captured.body) as Record<string, unknown>;
    expect(body['model']).toBe('qwen3.5:9b');
    expect(body['stream']).toBe(false);
    const options = body['options'] as Record<string, unknown>;
    expect(options['temperature']).toBe(0.1);
    expect(body['format']).toEqual(SCHEMA);
  });

  it('returns OllamaUnavailableError when target port is unreachable', async () => {
    const { OllamaAdapter } = await import(
      '../../packages/inference/src/ollama-adapter.js'
    );
    const { OllamaUnavailableError } = await import('@llm-corpus/contracts');
    // Pick a port unlikely to host anything.
    const adapter = new (OllamaAdapter as new (opts: {
      model: string;
      schema: object;
      baseUrl: string;
    }) => {
      classify: (input: {
        systemMessage: string;
        userMessage: string;
        signal: AbortSignal;
      }) => Promise<{ ok: boolean; error?: Error }>;
    })({
      model: 'qwen3.5:9b',
      schema: SCHEMA,
      baseUrl: 'http://127.0.0.1:1', // port 1 is privileged and typically closed
    });
    const controller = new AbortController();
    const result = await adapter.classify({
      systemMessage: 'sys',
      userMessage: 'usr',
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(OllamaUnavailableError);
    }
  });
});
