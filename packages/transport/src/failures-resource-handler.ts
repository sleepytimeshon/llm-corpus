// SP-006 T034 + T037 — MCP resource handler for corpus://failures.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-008, FR-HARDEN-010
//   - specs/006-hardening/contracts/adr-failures-resource.md
//   - Constitution Principles III (Substrate / read-only), V, VII, XIII
//
// READ-ONLY by construction (Constitution III). The ESLint rule
// `no-writes-from-resource-handlers` is scoped over this file
// (eslint.config.js).
//
// Behavior (per adr-failures-resource.md "Read Algorithm"):
//   1. Parse the URI's query string (?stage=, ?since=, ?limit=, ?offset=).
//   2. Validate via FailuresQueryZodSchema. On failure, return a
//      FailuresErrorEnvelope `{error_code:'validation_error', ...}` as a
//      SUCCESSFUL MCP resource read (NOT a transport error).
//   3. On success, delegate to readFailuresEntries(query, signal).
//   4. Validate the response via FailuresResourceResponseZodSchema before
//      serialization.
//   5. Return the MCP resource read result `{contents:[{uri,mimeType,text}]}`.

import * as crypto from 'node:crypto';
import {
  FailuresQueryZodSchema,
  FailuresErrorEnvelopeZodSchema,
  FailuresResourceResponseZodSchema,
  type FailuresErrorEnvelope,
  type FailuresQuery,
} from '@llm-corpus/contracts';
import { readFailuresEntries } from '@llm-corpus/storage';
import { emitResourceRead } from './resource-telemetry.js';
import type { BuiltMcpServer } from './mcp-server.js';

interface ResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

const RESOURCE_URI = 'corpus://failures';

interface QueryParseSuccess {
  readonly ok: true;
  readonly value: FailuresQuery;
}
interface QueryParseFailure {
  readonly ok: false;
  readonly envelope: FailuresErrorEnvelope;
}
type QueryParseResult = QueryParseSuccess | QueryParseFailure;

function parseIntegerOrEnvelope(
  field: 'limit' | 'offset',
  raw: string,
): { ok: true; value: number } | { ok: false; envelope: FailuresErrorEnvelope } {
  // Reject any non-integer literal at the URI boundary so the user sees a
  // validation_error envelope rather than a Zod-numeric coercion failure
  // bubbling up as an internal error.
  if (!/^-?\d+$/.test(raw)) {
    return {
      ok: false,
      envelope: FailuresErrorEnvelopeZodSchema.parse({
        error_code: 'validation_error' as const,
        message: `Invalid ${field}: '${raw}' is not an integer`.slice(0, 1024),
        hint:
          field === 'limit'
            ? 'limit must be an integer in [1, 1000]'
            : 'offset must be a non-negative integer',
      }),
    };
  }
  return { ok: true, value: Number.parseInt(raw, 10) };
}

function parseQueryFromUri(uri: string): QueryParseResult {
  // Best-effort URI parse — corpus://failures is non-hierarchical, so we
  // normalise to a relative URL against a synthetic base for URLSearchParams.
  let search: URLSearchParams;
  try {
    const q = uri.indexOf('?');
    search = new URLSearchParams(q === -1 ? '' : uri.slice(q + 1));
  } catch (caught) {
    return {
      ok: false,
      envelope: FailuresErrorEnvelopeZodSchema.parse({
        error_code: 'validation_error' as const,
        message: `Malformed query string: ${(caught as Error).message}`.slice(
          0,
          1024,
        ),
        hint: 'Expected ?stage=<stage>&since=<ISO-8601>&limit=<int>&offset=<int>',
      }),
    };
  }

  const candidate: Record<string, unknown> = {};
  for (const [key, value] of search.entries()) {
    if (key === 'limit' || key === 'offset') {
      const parsed = parseIntegerOrEnvelope(key, value);
      if (!parsed.ok) return { ok: false, envelope: parsed.envelope };
      candidate[key] = parsed.value;
    } else {
      candidate[key] = value;
    }
  }

  const parsed = FailuresQueryZodSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => i.message);
    return {
      ok: false,
      envelope: FailuresErrorEnvelopeZodSchema.parse({
        error_code: 'validation_error' as const,
        message: `Invalid query: ${issues.join('; ')}`.slice(0, 1024),
        hint: 'Accepted: stage (closed enum), since (ISO-8601), limit (1-1000), offset (>=0).',
      }),
    };
  }
  return { ok: true, value: parsed.data };
}

function asContent(uri: string, payload: unknown): ResourceReadResult {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload),
      },
    ],
  };
}

/**
 * MCP resource handler for corpus://failures. Receives the full request URI
 * (including any `?stage=...&limit=...` query string) plus an AbortSignal
 * from the MCP transport.
 *
 * Read-only by construction. The handler:
 *   - Returns FailuresErrorEnvelope on validation failure (as success-shape).
 *   - Returns FailuresResourceResponse on success.
 *   - Never throws on validation failure (the envelope is the contract).
 */
export async function failuresResourceHandler(
  uri: string,
  signal: AbortSignal,
): Promise<ResourceReadResult> {
  // SP-006 — Engineer #5 carry-forward: emit `resource.read` telemetry at
  // every completion path (mirrors SP-002 manifest/taxonomy/recent/docs
  // handler pattern). Constitution XIII (Telemetry-or-Die).
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  try {
    signal.throwIfAborted();
    const parsed = parseQueryFromUri(uri);
    if (!parsed.ok) {
      await emitResourceRead({
        resource_uri: 'corpus://failures',
        result: 'success',
        duration_ms: Date.now() - startTime,
        request_id: requestId,
      });
      return asContent(uri, parsed.envelope);
    }
    const response = await readFailuresEntries(parsed.value, signal);
    // Defensive — readFailuresEntries already validates its own output, but
    // the handler enforces the Zod boundary at the MCP edge too.
    const validated = FailuresResourceResponseZodSchema.parse(response);
    await emitResourceRead({
      resource_uri: 'corpus://failures',
      result: 'success',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    return asContent(uri, validated);
  } catch (caught) {
    await emitResourceRead({
      resource_uri: 'corpus://failures',
      result: 'error',
      duration_ms: Date.now() - startTime,
      request_id: requestId,
    });
    throw caught;
  }
}

/**
 * SP-006 T037 — register corpus://failures alongside the four SP-002
 * read-only resources. Mirrors the SP-002 registerStaticResource pattern.
 */
export function registerFailuresResource(built: BuiltMcpServer): void {
  built.registerStaticResource(
    {
      uri: RESOURCE_URI,
      name: 'Failure lane (read-only)',
      description:
        'Paginated, filtered view of the failure-lane sidecars at Paths.failed(). ' +
        'Supports ?stage=<stage>&since=<ISO-8601>&limit=<int>&offset=<int>. ' +
        'Read-only by construction (Constitution III). schema_version: 1.',
      mimeType: 'application/json',
    },
    failuresResourceHandler,
  );
}
