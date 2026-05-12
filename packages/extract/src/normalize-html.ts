// SP-003 T063 — HTML normalizer (turndown with frozen rule set).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//   - specs/003-ingest-pipeline/plan.md Decision G (turndown)
//   - specs/003-ingest-pipeline/plan.md R5 (golden test for rule-set drift)
//
// Turndown is invoked in-process (no subprocess) with a FROZEN rule set:
//   - headingStyle: 'atx' (uses `#` not Setext)
//   - codeBlockStyle: 'fenced'
//   - No service.use(...) — no plugins.
//   - No service.addRule(...) — no custom rules.
//
// Output is deterministic across runs on the same input.

import * as fsp from 'node:fs/promises';
import TurndownService from 'turndown';
import {
  NormalizeError,
  ok,
  err,
  type Result,
} from '@llm-corpus/contracts';
import type { NormalizeInput, NormalizedDoc } from './normalize-markdown.js';

export async function normalizeHtml(
  input: NormalizeInput,
  signal: AbortSignal,
): Promise<Result<NormalizedDoc, NormalizeError>> {
  signal.throwIfAborted();
  let raw: string;
  try {
    raw = await fsp.readFile(input.pendingPath, 'utf8');
  } catch (caught) {
    return err(
      new NormalizeError({
        error_code: 'normalize_failed',
        message: `Cannot read source: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  }

  signal.throwIfAborted();
  let body: string;
  try {
    const service = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    body = service.turndown(raw);
  } catch (caught) {
    return err(
      new NormalizeError({
        error_code: 'normalize_failed',
        message: `Turndown failed: ${(caught as Error).message}`,
        retriable: false,
      }),
    );
  }

  const frontmatter: Record<string, unknown> = {
    id: input.docId,
    source_path: input.sourcePath,
    ingest_timestamp: input.ingestTimestamp,
    mime_type: input.mimeType,
    hash: input.hash,
  };

  return ok({ body, frontmatter });
}
