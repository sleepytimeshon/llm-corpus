// SP-003 T062 — Plain-text normalizer (wrap in minimal Markdown).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//   - specs/003-ingest-pipeline/data-model.md §"Entity 8 — Normalized Body"
//
// Reads UTF-8 plain text from pending/, wraps it in a minimal Markdown
// document with FR-008 frontmatter at the top. The body bytes (post-
// frontmatter) are byte-identical to the source.

import * as fsp from 'node:fs/promises';
import {
  NormalizeError,
  ok,
  err,
  type Result,
} from '@llm-corpus/contracts';
import type { NormalizeInput, NormalizedDoc } from './normalize-markdown.js';

export async function normalizeText(
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

  const frontmatter: Record<string, unknown> = {
    id: input.docId,
    source_path: input.sourcePath,
    ingest_timestamp: input.ingestTimestamp,
    mime_type: input.mimeType,
    hash: input.hash,
  };

  return ok({ body: raw, frontmatter });
}
