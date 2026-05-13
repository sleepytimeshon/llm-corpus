// SP-005 US1 (T050) — Embed-stage orchestrator.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-005, FR-RETRIEVAL-006,
//     FR-RETRIEVAL-011, FR-RETRIEVAL-021
//   - Constitution Principle VII (Cancellable, Bounded IO)
//
// Per-document embed sub-stage:
//   1. Load body file via fs.readFile.
//   2. Parse frontmatter via parseMarkdownWithFrontmatter (Decision N).
//   3. Build the concatenated embedding text:
//        (title + summary + facet_topic + tags-joined + body_excerpt)
//      where body_excerpt is the first 500 words of the body section.
//   4. Call embeddingAdapter.embedDocument with a per-doc AbortController
//      + setTimeout(perDocEmbedTimeoutMs) (NEVER Promise.race(setTimeout)).
//   5. Return the Float32Array vector + the frontmatter for downstream
//      index-stage reuse.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  Paths,
  parseMarkdownWithFrontmatter,
  RetrievalError,
  EmbeddingUnavailableError,
} from '@llm-corpus/contracts';
import type { EmbeddingAdapter } from '@llm-corpus/inference';
import type { Policy } from './policies.js';

export interface EmbedStageInput {
  docId: string;
  db: DatabaseType;
  embeddingAdapter: EmbeddingAdapter;
  policy: Policy;
  signal: AbortSignal;
}

export interface EmbedStageOutput {
  vector: Float32Array;
  /** Parsed frontmatter (reused by the index-stage). */
  frontmatter: Record<string, unknown>;
  /** First 500 words of the body. */
  bodyExcerpt: string;
  /** Word count of the body excerpt (for telemetry). */
  bodyExcerptWordCount: number;
  /** The body_path the file was read from. */
  bodyPath: string;
  /** Title (cached for index-stage). */
  title: string;
  /** Tags (parsed JSON; cached for index-stage). */
  tags: string[];
}

/**
 * Codepoint-safe truncation to the first N words. Splits on Unicode
 * whitespace; preserves token boundaries; appends nothing on truncation
 * (the FTS5 tokenizer handles the implicit end-of-token).
 */
function firstNWords(text: string, n: number): { excerpt: string; count: number } {
  const tokens = text.split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length <= n) return { excerpt: tokens.join(' '), count: tokens.length };
  return { excerpt: tokens.slice(0, n).join(' '), count: n };
}

export async function embedStage(
  input: EmbedStageInput,
): Promise<Result<EmbedStageOutput, RetrievalError>> {
  const { docId, db, embeddingAdapter, policy, signal } = input;
  signal.throwIfAborted();

  // Per-doc abort plumbing — NEVER Promise.race(setTimeout) (Constitution VII).
  const localController = new AbortController();
  const onParent = (): void => localController.abort();
  signal.addEventListener('abort', onParent, { once: true });
  const timeoutHandle = setTimeout(
    () => localController.abort(),
    policy.perDocEmbedTimeoutMs,
  );
  const cleanup = (): void => {
    clearTimeout(timeoutHandle);
    signal.removeEventListener('abort', onParent);
  };

  try {
    const row = db
      .prepare(
        `SELECT title, body_path, tags_json FROM documents WHERE id = ?`,
      )
      .get(docId) as
      | { title: string; body_path: string; tags_json: string }
      | undefined;
    if (!row) {
      return err(
        new RetrievalError({
          error_code: 'persist_failed',
          message: `document ${docId} not found`,
        }),
      );
    }
    const fullPath = path.join(Paths.docs(), row.body_path);
    let fileContent: string;
    try {
      fileContent = await fsp.readFile(fullPath, 'utf8');
    } catch (caught) {
      return err(
        new RetrievalError(
          {
            error_code: 'persist_failed',
            message: `read body file failed: ${(caught as Error).message}`,
          },
          caught,
        ),
      );
    }
    let parsedFrontmatter: Record<string, unknown> = {};
    let body = fileContent;
    try {
      const parsed = parseMarkdownWithFrontmatter(fileContent);
      parsedFrontmatter = parsed.frontmatter;
      body = parsed.body;
    } catch {
      // Frontmatter parse failure → proceed with empty frontmatter; the
      // body is the full file content. The index-stage will populate
      // FTS5 columns with empty strings for summary / facet_topic.
    }

    const summary =
      typeof parsedFrontmatter['summary'] === 'string'
        ? (parsedFrontmatter['summary'] as string)
        : '';
    const facetTopic =
      typeof parsedFrontmatter['facet_topic'] === 'string'
        ? (parsedFrontmatter['facet_topic'] as string)
        : '';

    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags_json) as string[];
    } catch {
      tags = [];
    }

    const { excerpt: bodyExcerpt, count: bodyExcerptWordCount } = firstNWords(
      body,
      500,
    );

    const concatText = [
      row.title,
      summary,
      facetTopic,
      tags.join(' '),
      bodyExcerpt,
    ]
      .filter((s) => s.length > 0)
      .join('\n');

    const embedResult = await embeddingAdapter.embedDocument(
      concatText,
      localController.signal,
      docId,
    );
    if (!embedResult.ok) {
      // Surface the typed error unchanged so the orchestrator can branch
      // on instanceof EmbeddingUnavailableError / DimensionMismatch / etc.
      return err(embedResult.error);
    }

    return ok({
      vector: embedResult.value,
      frontmatter: parsedFrontmatter,
      bodyExcerpt,
      bodyExcerptWordCount,
      bodyPath: row.body_path,
      title: row.title,
      tags,
    });
  } finally {
    cleanup();
    void EmbeddingUnavailableError; // keep import live for type narrowing
  }
}
