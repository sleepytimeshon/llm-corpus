// SP-003 T061 — Markdown normalizer (passthrough + frontmatter injection).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006, SC-INGEST-003
//   - specs/003-ingest-pipeline/contracts/normalize.feature
//   - specs/003-ingest-pipeline/data-model.md §"Entity 8 — Normalized Body"
//
// Markdown is the canonical body format. The normalizer:
//   1. Reads the inbox Markdown file.
//   2. Parses any existing frontmatter (passthrough — user keys preserved).
//   3. Overlays the FR-008 minimum surface (id, source_path,
//      ingest_timestamp, mime_type, hash).
//   4. Returns Result.ok({ body_md, frontmatter }) where body_md is the
//      original body bytes (post-frontmatter, byte-identical).

import * as fsp from 'node:fs/promises';
import {
  NormalizeError,
  ok,
  err,
  type Result,
  parseMarkdownWithFrontmatter,
} from '@llm-corpus/contracts';

export interface NormalizeInput {
  /** Absolute path to the inbox source file (already in Paths.pending()). */
  pendingPath: string;
  /** The pre-computed doc_id (e.g., `doc-ab12cd34`). */
  docId: string;
  /** The absolute source path as originally dropped (for forensics). */
  sourcePath: string;
  /** ISO-8601 UTC timestamp at the moment of ingest. */
  ingestTimestamp: string;
  /** Detected MIME type from validation gate. */
  mimeType: 'application/pdf' | 'text/markdown' | 'text/plain' | 'text/html';
  /** Full-file SHA-256 lowercase hex. */
  hash: string;
}

export interface NormalizedDoc {
  /** The body text WITHOUT frontmatter delimiters — caller wraps with stringifyMarkdownWithFrontmatter. */
  body: string;
  /** The FR-008 minimum surface frontmatter merged with user-provided keys. */
  frontmatter: Record<string, unknown>;
}

export async function normalizeMarkdown(
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
  let parsed: { body: string; frontmatter: Record<string, unknown> };
  try {
    parsed = parseMarkdownWithFrontmatter(raw);
  } catch (caught) {
    return err(
      new NormalizeError({
        error_code: 'normalize_failed',
        message: `Frontmatter parse failed: ${(caught as Error).message}`,
        retriable: false,
      }),
    );
  }

  // Overlay FR-008 minimum surface; user keys take precedence ONLY where they
  // do not conflict with the canonical keys we must control. For SP-003 the
  // canonical keys ARE overwritten with our values so the corpus is the
  // authoritative source (per data-model.md Entity 8 invariants).
  const merged: Record<string, unknown> = {
    ...parsed.frontmatter,
    id: input.docId,
    source_path: input.sourcePath,
    ingest_timestamp: input.ingestTimestamp,
    mime_type: input.mimeType,
    hash: input.hash,
  };

  return ok({ body: parsed.body, frontmatter: merged });
}
