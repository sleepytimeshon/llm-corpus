// SP-003 T065 — Normalizer dispatcher.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//
// Routes a NormalizeInput to the correct per-MIME normalizer based on its
// mimeType field. Returns Result<NormalizedDoc, NormalizeError>.

import {
  NormalizeError,
  err,
  type Result,
} from '@llm-corpus/contracts';
import {
  normalizeMarkdown,
  type NormalizeInput,
  type NormalizedDoc,
} from './normalize-markdown.js';
import { normalizeText } from './normalize-text.js';
import { normalizeHtml } from './normalize-html.js';
import { normalizePdf, type NormalizePdfOptions } from './normalize-pdf.js';

export type NormalizeOptions = NormalizePdfOptions;

export async function normalize(
  input: NormalizeInput,
  signal: AbortSignal,
  options: NormalizeOptions = {},
): Promise<Result<NormalizedDoc, NormalizeError>> {
  signal.throwIfAborted();
  switch (input.mimeType) {
    case 'text/markdown':
      return normalizeMarkdown(input, signal);
    case 'text/plain':
      return normalizeText(input, signal);
    case 'text/html':
      return normalizeHtml(input, signal);
    case 'application/pdf':
      return normalizePdf(input, signal, options);
    default:
      return err(
        new NormalizeError({
          error_code: 'normalize_failed',
          message: `No normalizer for MIME type: ${String(input.mimeType)}`,
          retriable: false,
        }),
      );
  }
}

export type { NormalizeInput, NormalizedDoc };
