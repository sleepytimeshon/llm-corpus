// T045 — corpus://taxonomy read handler (US2).
//
// References: FR-006, contracts/resource-taxonomy.md, contracts/telemetry-resource-events.md
// "Caller contract", contracts/mcp-resources-api.md "Handler signatures".
//
// Mirrors T037 (manifest handler) — same emit-then-throw discipline.

import * as crypto from 'node:crypto';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { TaxonomyPayload } from '@llm-corpus/contracts';
import { buildTaxonomy } from '@llm-corpus/storage';
import { emitResourceRead, MCP_ERROR_CODES } from './resource-telemetry.js';
import type { BuiltMcpServer } from './mcp-server.js';

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

export async function taxonomyHandler(
  uri: string,
  signal: AbortSignal,
): Promise<ResourceReadResult> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  signal.throwIfAborted();

  const result = await buildTaxonomy(signal);

  if (result.ok) {
    const validated = TaxonomyPayload.safeParse(result.value);
    if (!validated.success) {
      await emitResourceRead({
        resource_uri: 'corpus://taxonomy',
        result: 'error',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(-32603, 'Internal error', {
        validation_issues: validated.error.issues,
      });
    }
    await emitResourceRead({
      resource_uri: 'corpus://taxonomy',
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

  await emitResourceRead({
    resource_uri: 'corpus://taxonomy',
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
 * T046 — register `corpus://taxonomy` (no auto-load annotation per
 * contracts/resource-taxonomy.md "Registration").
 */
export function registerTaxonomyResource(built: BuiltMcpServer): void {
  built.registerStaticResource(
    {
      uri: 'corpus://taxonomy',
      name: 'Corpus taxonomy',
      description:
        'Promoted vocabulary across all SearchFilter axes (domains, tags, types, source_types) with per-term document counts. Promoted terms only — proposed terms are excluded (Constitution XV).',
      mimeType: 'application/json',
    },
    taxonomyHandler,
  );
}
