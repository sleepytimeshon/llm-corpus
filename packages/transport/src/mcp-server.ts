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
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import { CorpusFindInput, CorpusFindOutput } from './schemas.js';
import {
  corpusFindHandler,
  createCorpusFindHandler,
  type CorpusFindHandler,
  type CorpusFindHandlerDeps,
} from './corpus-find-tool.js';

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
  /**
   * SP-005: dependency-injection slot for the corpus.find handler. When
   * provided, the server wires the real SearchOrchestrator-backed handler
   * via createCorpusFindHandler(deps). When omitted, tests fall back to
   * the placeholder handler that throws on invocation (mirrors the SP-001
   * empty-stub behavior — tests that don't exercise the tool can still
   * register).
   */
  corpusFindDeps?: CorpusFindHandlerDeps;
  /**
   * SP-005: alternative override — supply a pre-built handler directly.
   * Mutually exclusive with corpusFindDeps; if both are supplied,
   * corpusFindHandlerOverride wins. Tests use this to inject mocks.
   */
  corpusFindHandlerOverride?: CorpusFindHandler;
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
  /**
   * SP-002 — register a static MCP resource (e.g. `corpus://manifest`).
   * Called by Phases 3/4/6 wiring tasks (T038, T046, T066).
   */
  registerStaticResource: (
    descriptor: {
      uri: string;
      name: string;
      description: string;
      mimeType: string;
      annotations?: { audience: string[]; priority: number };
    },
    handler: (
      uri: string,
      signal: AbortSignal,
    ) => Promise<{
      contents: Array<{ uri: string; mimeType: string; text: string }>;
    }>,
  ) => void;
  /**
   * SP-002 — register an RFC-6570 URI template (e.g. `corpus://docs/{id}`)
   * with a regex-matched read handler. Called by Phase 5 wiring (T057).
   */
  registerResourceTemplate: (
    descriptor: {
      uriTemplate: string;
      name: string;
      description: string;
      mimeType: string;
    },
    pattern: RegExp,
    handler: (
      uri: string,
      captured: string,
      signal: AbortSignal,
    ) => Promise<{
      contents: Array<{ uri: string; mimeType: string; text: string }>;
    }>,
  ) => void;
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
        resources: {},
      },
      instructions:
        'Local-only corpus knowledge base. The corpus.find tool searches the user-curated document index. ' +
        'No data ever leaves the user machine — runtime egress hook enforces this.',
    },
  );

  // SP-005: resolve the corpus.find handler from the options.
  const effectiveHandler: CorpusFindHandler =
    opts.corpusFindHandlerOverride ??
    (opts.corpusFindDeps
      ? createCorpusFindHandler(opts.corpusFindDeps)
      : corpusFindHandler);

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
      // input shape, but we re-parse for defaults like limit).
      const parsed = CorpusFindInput.parse(rawInput);
      const signal = extra.signal as AbortSignal | undefined;
      const effectiveSignal = signal ?? new AbortController().signal;
      const result = await effectiveHandler(parsed, effectiveSignal);
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
          phase: 'bootstrapping',
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

  // ============================================================================
  // T031 — SP-002: resources/list, resources/templates/list, resources/read
  // ============================================================================
  // Cold-start gate mirrors tools/list (per SP-001 contract).
  // Resource registration in Phases 3-6 (T038, T046, T057, T066) populates
  // the static resource list, the templates list, and the read dispatch
  // table. T031 wires the request handlers with empty content; Phase 3+
  // tasks insert their respective handlers via the registry below.

  const staticResources: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    annotations?: { audience: string[]; priority: number };
  }> = [];
  const resourceTemplates: Array<{
    uriTemplate: string;
    name: string;
    description: string;
    mimeType: string;
  }> = [];
  // The dispatch table is populated by Phase 3-6 wiring. It maps either:
  //   - exact-match URI → handler(uri, signal)
  //   - regex match → handler(uri, captureGroup1, signal)
  // The execution order is: static exact-match first, then templates.
  type StaticResourceHandler = (
    uri: string,
    signal: AbortSignal,
  ) => Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }>;
  type TemplateResourceHandler = (
    uri: string,
    captured: string,
    signal: AbortSignal,
  ) => Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }>;

  const exactDispatch = new Map<string, StaticResourceHandler>();
  const templateDispatch: Array<{
    pattern: RegExp;
    handler: TemplateResourceHandler;
  }> = [];

  underlying.setRequestHandler(
    ListResourcesRequestSchema,
    async () => {
      if (!ready) {
        throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', {
          retry_after_ms: COLD_START_RETRY_AFTER_MS,
          phase: 'bootstrapping',
        });
      }
      return { resources: staticResources };
    },
  );

  underlying.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async () => {
      if (!ready) {
        throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', {
          retry_after_ms: COLD_START_RETRY_AFTER_MS,
          phase: 'bootstrapping',
        });
      }
      return { resourceTemplates };
    },
  );

  underlying.setRequestHandler(
    ReadResourceRequestSchema,
    async (request, extra) => {
      if (!ready) {
        throw new McpError(SERVER_INITIALIZING_CODE, 'server_initializing', {
          retry_after_ms: COLD_START_RETRY_AFTER_MS,
          phase: 'bootstrapping',
        });
      }
      const { uri } = request.params;
      const signal =
        ((extra as { signal?: AbortSignal })?.signal as AbortSignal | undefined) ??
        new AbortController().signal;

      // SP-006 — split URI on '?' so static resources can carry query
      // parameters (e.g., `corpus://failures?stage=classify&limit=10`). The
      // four SP-002 resources don't use query strings; the exact-match key
      // is preserved for them. The full URI (with query) is passed through
      // to the handler so resources like corpus://failures can parse it.
      const qIdx = uri.indexOf('?');
      const exactKey = qIdx === -1 ? uri : uri.slice(0, qIdx);
      const exact = exactDispatch.get(exactKey);
      if (exact) {
        return exact(uri, signal);
      }
      // Template dispatch (corpus://docs/{id} regex).
      for (const { pattern, handler } of templateDispatch) {
        const match = pattern.exec(uri);
        if (match && match[1] !== undefined) {
          return handler(uri, match[1], signal);
        }
      }
      throw new McpError(-32602, 'Unknown resource URI', { uri });
    },
  );

  const markReady = (): void => {
    ready = true;
  };

  const isReady = (): boolean => ready;

  /**
   * SP-002 — register a static resource alongside its read handler.
   * Called by the per-resource registration tasks in Phases 3, 4, 6
   * (T038, T046, T066).
   */
  const registerStaticResource = (
    descriptor: {
      uri: string;
      name: string;
      description: string;
      mimeType: string;
      annotations?: { audience: string[]; priority: number };
    },
    handler: StaticResourceHandler,
  ): void => {
    staticResources.push(descriptor);
    exactDispatch.set(descriptor.uri, handler);
  };

  /**
   * SP-002 — register a URI template (resources/templates/list) alongside
   * its regex-matched read handler. Called by the per-resource template
   * task in Phase 5 (T057).
   */
  const registerResourceTemplate = (
    descriptor: {
      uriTemplate: string;
      name: string;
      description: string;
      mimeType: string;
    },
    pattern: RegExp,
    handler: TemplateResourceHandler,
  ): void => {
    resourceTemplates.push(descriptor);
    templateDispatch.push({ pattern, handler });
  };

  return {
    server,
    markReady,
    isReady,
    registerStaticResource,
    registerResourceTemplate,
  };
}

/**
 * Start the MCP server on stdio. Production entry point — wires the egress
 * hook (already installed at module load), the McpServer, and the stdio
 * transport, then transitions to ready.
 *
 * NEVER bind HTTP/SSE/TCP from this package — local-only enforcement
 * requires stdio only (US1 AS2, NFR-002).
 *
 * SP-002 wires the four read-only resources here (T038, T046, T057, T066)
 * AFTER the egress hook installs (the `./egress-hook-bootstrap.js` import
 * at the top of `index.ts` runs first) and BEFORE markReady(). Any
 * accidental network call from a resource handler is therefore hard-blocked
 * by the hook.
 */
export async function startMcpServer(): Promise<BuiltMcpServer> {
  // Bootstrap: not-ready yet.
  const built = buildMcpServer({ ready: false });

  // SP-002 — register the four read-only resources. The wiring helpers are
  // imported lazily to keep the bootstrap-ordering invariant: index.ts
  // imports `./egress-hook-bootstrap.js` first and `./mcp-server.js` second;
  // dynamic-import here defers the resource-handler module loads until the
  // egress hook is fully installed.
  // T038 — manifest registered (US1).
  // T046, T057, T066 land taxonomy/document/recent in Phases 4-6.
  const { registerManifestResource } = await import(
    './resource-manifest-handler.js'
  );
  registerManifestResource(built);
  const { registerTaxonomyResource } = await import(
    './resource-taxonomy-handler.js'
  );
  registerTaxonomyResource(built);
  const { registerDocumentResource } = await import(
    './resource-document-handler.js'
  );
  registerDocumentResource(built);
  const { registerRecentResource } = await import(
    './resource-recent-handler.js'
  );
  registerRecentResource(built);

  // SP-006 T037 — register the fifth read-only resource, corpus://failures.
  // Read-only by construction (Constitution III); the
  // `no-writes-from-resource-handlers` lint rule covers both the handler and
  // the storage adapter.
  const { registerFailuresResource } = await import(
    './failures-resource-handler.js'
  );
  registerFailuresResource(built);

  const transport = new StdioServerTransport();
  await built.server.connect(transport);

  // SP-002 ensures the SQLite index file + baseline schema exist before
  // ready transition (so the first resource read finds a queryable file).
  // The `ensureIndexInitialized` call is idempotent.
  const { ensureIndexInitialized } = await import('@llm-corpus/storage');
  ensureIndexInitialized();

  // SP-002 also gates ready on config validity: out-of-range config values
  // surface as a startup error, NOT a per-read failure.
  const { loadResourceConfig } = await import('@llm-corpus/storage');
  loadResourceConfig();

  built.markReady();

  return built;
}
