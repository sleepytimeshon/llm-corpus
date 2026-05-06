// T033 — MCP server (stdio-only) registering the corpus.find tool.
// Implements the bootstrapping → ready transition: tools/list returns
// `code: -32002, message: "server_initializing"` until markReady() is called.
//
// References: FR-001, US1 AS1-AS4, contracts/mcp-corpus-find.md
//
// Constitution VII (Cancellable IO), V (Schema-enforced), XI (Result types).
//
// SP-001 ships:
//   - exactly one tool named `corpus.find` advertised via tools/list
//   - the cold-start error envelope until ready
//   - stdio-only — no HTTP/SSE/TCP exports from this package
//
// SP-005+ replaces the corpusFindHandler body with real ranking.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import { CorpusFindInput, CorpusFindOutput } from './schemas.js';
import { corpusFindHandler } from './corpus-find-tool.js';

/**
 * JSON-RPC server-defined error code for "still bootstrapping".
 * Per contracts/mcp-corpus-find.md §"Cold-start error envelope".
 */
export const SERVER_INITIALIZING_CODE = -32002;
const COLD_START_RETRY_AFTER_MS = 1000;

export interface BuildMcpServerOptions {
  /**
   * If true, the server is "ready" immediately and tools/list returns the
   * tool list. If false (default), tools/list returns the cold-start error
   * envelope until markReady() is called.
   *
   * Tests use `ready: true` to bypass bootstrapping when they only want to
   * verify the tools/list contract; production starts with `ready: false`
   * and calls markReady() after the egress hook + index are open.
   */
  ready?: boolean;
}

export interface BuiltMcpServer {
  /** The high-level McpServer instance (also has `.server` for low-level access). */
  server: McpServer;
  /**
   * Transition the server from bootstrapping → ready. Idempotent: subsequent
   * calls are no-ops. Production calls this exactly once after the egress
   * hook + (placeholder) index open complete.
   */
  markReady: () => void;
  /** Read current readiness — primarily for tests. */
  isReady: () => boolean;
}

/**
 * Build (but do not connect) the MCP server. Use this from tests to attach an
 * in-memory transport, or from `startMcpServer` to attach the stdio transport.
 */
export function buildMcpServer(opts: BuildMcpServerOptions = {}): BuiltMcpServer {
  let ready = opts.ready === true;

  const server = new McpServer(
    { name: 'llm-corpus', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'Local-only corpus knowledge base. The corpus.find tool searches the user-curated document index. ' +
        'No data ever leaves the user machine — runtime egress hook enforces this.',
    },
  );

  // Register the single tool. The McpServer high-level API uses Zod raw shapes
  // (extracted from `.shape`) for input/output validation. We pass the zod
  // shapes directly so the SDK builds JSON Schemas + per-call validators.
  server.registerTool(
    'corpus.find',
    {
      title: 'Search the local corpus',
      description:
        'Search the local corpus with optional facet filters. Returns ranked SearchHit list. ' +
        'SP-001 returns empty hits — ranking lands in SP-005.',
      inputSchema: CorpusFindInput.shape,
      outputSchema: CorpusFindOutput.shape,
    },
    async (rawInput, extra) => {
      // Parse input through Zod (the SDK already validates against the
      // input shape, but we re-parse for defaults like limit + mode).
      const parsed = CorpusFindInput.parse(rawInput);
      const signal = extra.signal as AbortSignal | undefined;
      const effectiveSignal = signal ?? new AbortController().signal;
      const result = await corpusFindHandler(parsed, effectiveSignal);
      return {
        // SDK requires structured `content` for tool results. Return the JSON
        // payload as a single text block per contracts/mcp-corpus-find.md.
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        structuredContent: result as Record<string, unknown>,
      };
    },
  );

  // Override the tools/list handler to inject the cold-start error envelope.
  // The McpServer registers its own tools/list handler when registerTool() is
  // called; setRequestHandler on the underlying server replaces it. We grab
  // the previously-registered handler so we can delegate to it once ready.
  const underlying = server.server;
  type RawHandler = (request: unknown, extra: unknown) => Promise<ListToolsResult>;
  const previousListHandler = (
    underlying as unknown as {
      _requestHandlers: Map<string, RawHandler>;
    }
  )._requestHandlers.get('tools/list');

  underlying.setRequestHandler(
    ListToolsRequestSchema,
    async (request, extra): Promise<ListToolsResult> => {
      if (!ready) {
        throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', {
          retry_after_ms: COLD_START_RETRY_AFTER_MS,
        });
      }
      if (!previousListHandler) {
        // Defensive — if the high-level API ever changes its registration
        // strategy, surface a clear internal error rather than silently
        // returning an empty list.
        throw new McpError(-32603, 'tools/list handler not initialized');
      }
      return previousListHandler(request, extra);
    },
  );

  const markReady = (): void => {
    ready = true;
  };

  const isReady = (): boolean => ready;

  return { server, markReady, isReady };
}

/**
 * Start the MCP server on stdio. Production entry point — wires the egress
 * hook (already installed at module load), the McpServer, and the stdio
 * transport, then transitions to ready.
 *
 * NEVER bind HTTP/SSE/TCP from this package — local-only enforcement
 * requires stdio only (US1 AS2, NFR-002).
 */
export async function startMcpServer(): Promise<BuiltMcpServer> {
  // Bootstrap: not-ready yet.
  const built = buildMcpServer({ ready: false });

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // SP-001 has no real index to open; transition to ready immediately after
  // the transport is connected. SP-003+ adds the index-open precondition.
  built.markReady();

  return built;
}
