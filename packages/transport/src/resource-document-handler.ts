// T056 — corpus://docs/{id} read handler (US4).
//
// References: FR-008, contracts/resource-document.md, contracts/telemetry-resource-events.md
// "Caller contract", contracts/mcp-resources-api.md "Handler signatures",
// Constitution VII, VIII, XIII.
//
// Outcome map:
//   ok            → result='success',         severity='info'
//   not-found     → result='document_not_found', severity='warn'
//   index-locked  → result='index_locked',    severity='warn'
//   integrity-loss → result='error',           severity='error'
//   safeParse fail → result='error',           severity='error'
//
// Per contracts/telemetry-resource-events.md, every emit carries
// resource_uri='corpus://docs/*' and the doc_id (success AND every failure,
// including not_found where doc_id is the missing id agents requested —
// forensically useful).

import * as crypto from 'node:crypto';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  DocumentPayload,
  DocumentNotFoundError,
  IndexLockedError,
  IntegrityLossError,
} from '@llm-corpus/contracts';
import { fetchDocument } from '@llm-corpus/storage';
import { emitResourceRead, MCP_ERROR_CODES } from './resource-telemetry.js';
import type { BuiltMcpServer } from './mcp-server.js';

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/**
 * Read handler for `corpus://docs/{id}`. The dispatch table in mcp-server.ts
 * matches the URI via regex `^corpus:\/\/docs\/(doc-[0-9a-f]{8})$` and passes
 * the captured id as the second argument.
 */
export async function documentHandler(
  uri: string,
  docId: string,
  signal: AbortSignal,
): Promise<ResourceReadResult> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  try {
    signal.throwIfAborted();

    const result = await fetchDocument(docId, signal);

    if (result.ok) {
      const validated = DocumentPayload.safeParse(result.value);
      if (!validated.success) {
        await emitResourceRead({
          resource_uri: 'corpus://docs/*',
          doc_id: docId,
          result: 'error',
          duration_ms: Date.now() - startTime,
          request_id: requestId,
        });
        throw new McpError(-32603, 'Internal error', {
          validation_issues: validated.error.issues,
          uri,
        });
      }
      await emitResourceRead({
        resource_uri: 'corpus://docs/*',
        doc_id: docId,
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

    // Failure paths — emit telemetry then throw McpError.
    const e = result.error;
    if (e instanceof DocumentNotFoundError) {
      await emitResourceRead({
        resource_uri: 'corpus://docs/*',
        doc_id: docId,
        result: 'document_not_found',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(
        MCP_ERROR_CODES.document_not_found,
        'document_not_found',
        { uri, doc_id: docId },
      );
    }
    if (e instanceof IndexLockedError) {
      await emitResourceRead({
        resource_uri: 'corpus://docs/*',
        doc_id: docId,
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
    if (e instanceof IntegrityLossError) {
      await emitResourceRead({
        resource_uri: 'corpus://docs/*',
        doc_id: docId,
        result: 'error',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      throw new McpError(-32603, 'Internal error', {
        reason: 'integrity_loss',
        requested_id: e.data.requestedId,
        frontmatter_id: e.data.frontmatterFoundId,
        uri,
      });
    }
    // Defensive — adapter contract precludes other error types.
    await emitResourceRead({
      resource_uri: 'corpus://docs/*',
      doc_id: docId,
      result: 'error',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    throw new McpError(-32603, 'Internal error', { uri });
  } catch (caught) {
    // McpError throws have already emitted their own telemetry on the path
    // that produced them — re-throw without double-emitting.
    if (caught instanceof McpError) {
      throw caught;
    }
    // Constitution XIII (telemetry-or-die): any other throw — adapter
    // re-throwing a non-busy error (JSON.parse on tags_json, fsp.readFile on
    // missing/unreadable body, frontmatter parse error, etc.), AbortError, or
    // any unexpected exception — must emit a resource.read event before
    // propagating.
    await emitResourceRead({
      resource_uri: 'corpus://docs/*',
      doc_id: docId,
      result: 'error',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    const message =
      caught instanceof Error ? caught.message : String(caught);
    throw new McpError(
      -32603,
      'Internal error reading resource: ' + message,
      { uri, doc_id: docId },
    );
  }
}

/**
 * T057 — register `corpus://docs/{id}` template + dispatch handler.
 * Per contracts/mcp-resources-api.md "Registration shape", the regex uses
 * the SP-001 SearchHit doc-id format `doc-[0-9a-f]{8}`.
 */
export function registerDocumentResource(built: BuiltMcpServer): void {
  built.registerResourceTemplate(
    {
      uriTemplate: 'corpus://docs/{id}',
      name: 'Document by ID',
      description:
        'Full Markdown body and structured YAML frontmatter for one ingested document. The id matches the SearchHit URI returned by corpus.find.',
      mimeType: 'application/json',
    },
    /^corpus:\/\/docs\/(doc-[0-9a-f]{8})$/,
    documentHandler,
  );
}
