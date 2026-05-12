// SP-003 T064 — PDF normalizer (invokes vendored CLI shim via runTool).
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-006
//   - specs/003-ingest-pipeline/plan.md Decision F (vendored shim)
//   - specs/003-ingest-pipeline/plan.md R2 (timeout + heap cap)
//   - Constitution VII (cancellable), XII (subprocess hygiene)
//
// Spawns `node tools/pdf-extractor/extract.mjs --in <pdf> --out <text>` via
// runTool (the only allowed subprocess primitive in the project). Reads the
// extracted text from the output file. AbortSignal propagated. Timeout
// configured by caller (per-stage policy).

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  NormalizeError,
  ok,
  err,
  type Result,
  runTool,
  Paths,
} from '@llm-corpus/contracts';
import type { NormalizeInput, NormalizedDoc } from './normalize-markdown.js';

/** Resolve the absolute path to the vendored pdf-extractor CLI shim. */
function resolveExtractorPath(): string {
  // The shim lives at <repo>/tools/pdf-extractor/extract.mjs. In test +
  // production we cwd to repo root, so a process-relative path works. For
  // safety we resolve against process.cwd().
  return path.resolve(process.cwd(), 'tools/pdf-extractor/extract.mjs');
}

export interface NormalizePdfOptions {
  /** Per-doc timeout in milliseconds (from policy). */
  timeoutMs?: number;
}

export async function normalizePdf(
  input: NormalizeInput,
  signal: AbortSignal,
  options: NormalizePdfOptions = {},
): Promise<Result<NormalizedDoc, NormalizeError>> {
  signal.throwIfAborted();

  // Allocate an output path under Paths.cache() for the extractor to write to.
  const cacheRoot = path.join(Paths.cache(), 'pdf-extractor');
  await fsp.mkdir(cacheRoot, { recursive: true });
  const outPath = path.join(
    cacheRoot,
    `${input.docId}.${crypto.randomBytes(2).toString('hex')}.txt`,
  );

  const extractor = resolveExtractorPath();
  const args = [extractor, '--in', input.pendingPath, '--out', outPath];

  const toolResult = await runTool('node', args, {
    signal,
    timeoutMs: options.timeoutMs,
  });

  if (!toolResult.ok) {
    // Clean up any partial output.
    await fsp.rm(outPath, { force: true }).catch(() => undefined);
    return err(
      new NormalizeError({
        error_code: 'extract_failed',
        message: `pdf-extractor: ${toolResult.error.code}: ${toolResult.error.stderr.slice(0, 256)}`,
        retriable: toolResult.error.code === 'TIMEOUT',
      }),
    );
  }

  let text: string;
  try {
    text = await fsp.readFile(outPath, 'utf8');
  } catch (caught) {
    return err(
      new NormalizeError({
        error_code: 'extract_failed',
        message: `Cannot read extractor output: ${(caught as Error).message}`,
        retriable: true,
      }),
    );
  } finally {
    await fsp.rm(outPath, { force: true }).catch(() => undefined);
  }

  const frontmatter: Record<string, unknown> = {
    id: input.docId,
    source_path: input.sourcePath,
    ingest_timestamp: input.ingestTimestamp,
    mime_type: input.mimeType,
    hash: input.hash,
  };

  return ok({ body: text, frontmatter });
}
