// T065 — corpus://recent read handler (US3).
//
// References: FR-007, contracts/resource-recent.md, contracts/telemetry-resource-events.md
// "Caller contract".

import * as crypto from 'node:crypto';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { RecentPayload } from '@llm-corpus/contracts';
import { buildRecent } from '@llm-corpus/storage';
import { emitResourceRead, MCP_ERROR_CODES } from './resource-telemetry.js';
import type { BuiltMcpServer } from './mcp-server.js';

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

export async function recentHandler(
  uri: string,
  signal: AbortSignal,
): Promise<ResourceReadResult> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  signal.throwIfAborted();

  const result = await buildRecent(signal);

  if (result.ok) {
    const validated = RecentPayload.safeParse(result.value);
    if (!validated.success) {
      await emitResourceRead({
        resource_uri: 'corpus://recent',
        result: 'error',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(-32603, 'Internal error', {
        validation_issues: validated.error.issues,
      });
    }
    await emitResourceRead({
      resource_uri: 'corpus://recent',
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
    resource_uri: 'corpus://recent',
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
 * T066 — register `corpus://recent` (no auto-load annotation).
 */
export function registerRecentResource(built: BuiltMcpServer): void {
  built.registerStaticResource(
    {
      uri: 'corpus://recent',
      name: 'Recent ingests',
      description:
        'Last N successfully ingested documents in descending ingest_timestamp order. Failure-lane and trash documents excluded. N defaults to 10; configurable via [resources.recent].window_size in config.toml (range 1-100).',
      mimeType: 'application/json',
    },
    recentHandler,
  );
}
