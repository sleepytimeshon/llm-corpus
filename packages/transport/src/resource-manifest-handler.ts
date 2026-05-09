// T037 — corpus://manifest read handler (US1).
//
// References: FR-005, contracts/resource-manifest.md, contracts/telemetry-resource-events.md
// "Caller contract", contracts/mcp-resources-api.md "Handler signatures".
//
// Pattern (mirrored across the four resource handlers):
//   1. capture startTime + requestId
//   2. signal.throwIfAborted()
//   3. invoke storage adapter
//   4. on Result.ok → safeParse payload → emit success → return contents
//   5. on Result.err(IndexLockedError) → emit index_locked → throw McpError(-32011)
//   6. on safeParse failure → emit error → throw McpError(-32603)
//
// Telemetry is emitted on every completion path (Constitution XIII).

import * as crypto from 'node:crypto';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ManifestPayload } from '@llm-corpus/contracts';
import { buildManifest } from '@llm-corpus/storage';
import { emitResourceRead, MCP_ERROR_CODES } from './resource-telemetry.js';
import type { BuiltMcpServer } from './mcp-server.js';

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/**
 * Read handler for `corpus://manifest`.
 *
 * The handler shape matches the BuiltMcpServer.registerStaticResource signature
 * (uri, signal) — kept narrow per Constitution III (no mutation parameters).
 */
export async function manifestHandler(
  uri: string,
  signal: AbortSignal,
): Promise<ResourceReadResult> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  signal.throwIfAborted();

  const result = await buildManifest(signal);

  if (result.ok) {
    const validated = ManifestPayload.safeParse(result.value);
    if (!validated.success) {
      await emitResourceRead({
        resource_uri: 'corpus://manifest',
        result: 'error',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(-32603, 'Internal error', {
        validation_issues: validated.error.issues,
      });
    }
    await emitResourceRead({
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(validated.data),
        },
      ],
    };
  }

  // result is Err(IndexLockedError) — adapter contract limits the error union
  // to IndexLockedError per contracts/resource-manifest.md.
  await emitResourceRead({
    resource_uri: 'corpus://manifest',
    result: 'index_locked',
    duration_ms: Date.now() - startTime,
    request_id: requestId,
  });
  throw new McpError(MCP_ERROR_CODES.index_locked, 'index_locked', {
    retriable: true,
    retry_after_ms: 250,
    uri,
  });
}

/**
 * T038 — register `corpus://manifest` on a built MCP server. Called from
 * `startMcpServer()` and from tests that exercise the resource directly.
 *
 * The auto-load annotation is the standard MCP `audience` + `priority` shape
 * (per contracts/resource-manifest.md "Registration"); the other three
 * resources MUST NOT carry this annotation.
 */
export function registerManifestResource(built: BuiltMcpServer): void {
  built.registerStaticResource(
    {
      uri: 'corpus://manifest',
      name: 'Corpus manifest',
      description:
        'Structural snapshot of the local corpus: doc count, established domains, established tags, last ingest timestamp, schema version, taxonomy version.',
      mimeType: 'application/json',
      annotations: { audience: ['assistant'], priority: 1.0 },
    },
    manifestHandler,
  );
}
