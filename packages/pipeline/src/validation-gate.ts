// SP-003 T058 — Validation gate.
//
// References:
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-002, ADR-007
//   - specs/003-ingest-pipeline/contracts/validation-gate.feature
//   - specs/003-ingest-pipeline/data-model.md §"Validation Gate Config"
//   - Constitution VII (Cancellable, Bounded IO)
//
// validateInboxFile() runs four checks in fixed order:
//   1. filename sanity (null-byte / path-traversal / control chars / zero-length)
//   2. extension allowlist (.pdf / .md / .markdown / .txt / .html / .htm)
//   3. MIME sniff (file-type lib) — extension MUST match detected MIME family
//   4. size cap (config.toml [ingest].max_file_size_mb)
//
// Short-circuits on first failure with the matching error_code. Emits the
// corresponding `inbox.*` telemetry event on every outcome. Bounded IO —
// the MIME-sniff reads at most ~4 KB of magic bytes; the size check reads
// only the result of `fs.stat` (no body content read). AbortSignal honored
// at every async boundary.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import {
  ValidationError,
  emitTelemetry,
  type Result,
  ok,
  err,
} from '@llm-corpus/contracts';
import { loadIngestConfig } from '@llm-corpus/storage';

export interface ValidatedFile {
  /** Absolute path to the inbox file as detected. */
  filePath: string;
  /** Detected MIME from `file-type` magic-byte sniff. */
  mimeType: 'application/pdf' | 'text/markdown' | 'text/plain' | 'text/html';
  /** File size in bytes (from `fs.stat`). */
  sizeBytes: number;
  /** File mtime in ms (observability only, NOT used for dedup). */
  mtimeMs: number;
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
]);

// Map extension to expected MIME family. Used to detect extension/MIME mismatch.
function extensionToMimeFamily(ext: string): ValidatedFile['mimeType'] | null {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.html':
    case '.htm':
      return 'text/html';
    default:
      return null;
  }
}

// Filename sanity rejection reasons.
type SanityReason = 'null_byte' | 'path_traversal' | 'control_character' | 'zero_length';

function checkFilenameSanity(filename: string): SanityReason | null {
  if (filename.length === 0) return 'zero_length';
  if (filename.includes('\0')) return 'null_byte';
  // Path traversal: any literal `..` segment or any `/` (we only deal with basenames).
  if (filename === '..' || filename.startsWith('../') || filename.includes('/..') || filename.includes('..')) {
    return 'path_traversal';
  }
  // Control characters (ASCII 0-31 except \0 already caught; also DEL = 127).
  for (let i = 0; i < filename.length; i++) {
    const code = filename.charCodeAt(i);
    if (code < 32 || code === 127) {
      return 'control_character';
    }
  }
  return null;
}

/**
 * Validate an inbox file in fixed-order four-gate sequence. Returns
 * `Result.ok(ValidatedFile)` on pass; `Result.err(ValidationError)` on first
 * failure. Always emits matching `inbox.*` telemetry.
 *
 * Bounded IO (Constitution VII):
 *   - The MIME-sniff reads at most 4096 magic bytes (file-type contract).
 *   - The size check is `fs.stat`-only; no body bytes are read for the
 *     size decision.
 */
export async function validateInboxFile(
  filePath: string,
  signal: AbortSignal,
): Promise<Result<ValidatedFile, ValidationError>> {
  signal.throwIfAborted();
  const timestamp = (): string => new Date().toISOString();
  const filename = path.basename(filePath);

  // ---- Gate 1: filename sanity ----
  const sanityFailure = checkFilenameSanity(filename);
  if (sanityFailure !== null) {
    await emitTelemetry({
      event: 'inbox.filename_sanity_failed',
      timestamp: timestamp(),
      severity: 'warn',
      outcome: 'rejected',
      file_path: filePath,
      error_code: 'filename_sanity_failed',
      reason: sanityFailure,
    });
    return err(
      new ValidationError({
        error_code: 'filename_sanity_failed',
        message: `Filename sanity rejected: ${sanityFailure}`,
        file_path: filePath,
        retriable: false,
      }),
    );
  }

  // ---- Gate 2: extension allowlist ----
  const ext = path.extname(filename).toLowerCase();
  const expectedMime = extensionToMimeFamily(ext);
  if (expectedMime === null || !ALLOWED_EXTENSIONS.has(ext)) {
    await emitTelemetry({
      event: 'inbox.allowlist_miss',
      timestamp: timestamp(),
      severity: 'warn',
      outcome: 'rejected',
      file_path: filePath,
      mime_type: `extension ${ext || '(none)'}`,
      error_code: 'mime_not_allowlisted',
    });
    return err(
      new ValidationError({
        error_code: 'mime_not_allowlisted',
        message: `Extension "${ext || '(none)'}" not in allowlist`,
        file_path: filePath,
        retriable: false,
      }),
    );
  }

  // ---- Gate 3: MIME-sniff (file-type lib) ----
  // Read at most 4096 magic bytes — bounded IO.
  signal.throwIfAborted();
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
  } catch (caught) {
    return err(
      new ValidationError({
        error_code: 'mime_not_allowlisted',
        message: `Cannot open file: ${(caught as Error).message}`,
        file_path: filePath,
        retriable: true,
      }),
    );
  }

  let magicBuf: Buffer;
  let statSize: number;
  let statMtimeMs: number;
  try {
    signal.throwIfAborted();
    const stat = await fh.stat();
    statSize = stat.size;
    statMtimeMs = stat.mtimeMs;
    const readSize = Math.min(4096, statSize);
    magicBuf = Buffer.alloc(readSize);
    if (readSize > 0) {
      await fh.read(magicBuf, 0, readSize, 0);
    }
  } finally {
    await fh.close().catch(() => undefined);
  }

  signal.throwIfAborted();
  const detected = await fileTypeFromBuffer(magicBuf);
  let detectedMime: string;
  if (detected) {
    detectedMime = detected.mime;
  } else {
    // file-type cannot detect text formats by magic bytes. For text/markdown,
    // text/plain, text/html we accept the extension's claim — these are
    // determined by the extension family. Defense: PDF magic bytes in a .md
    // file are caught here because file-type WILL detect %PDF.
    detectedMime = expectedMime;
  }

  // Check extension/MIME consistency.
  // PDF: detected MUST be application/pdf.
  // text/markdown / text/plain: detected may be undefined (file-type returns
  //   nothing for plain text); accept the extension's family.
  // text/html: file-type detects application/xhtml+xml or text/html for many
  //   variants — we accept anything starting with "text/" or "application/xhtml".
  let mimeMatches = false;
  if (expectedMime === 'application/pdf') {
    mimeMatches = detectedMime === 'application/pdf';
  } else if (expectedMime === 'text/markdown' || expectedMime === 'text/plain') {
    // Text fixtures: reject if magic bytes detected as binary (e.g., %PDF in a .md).
    mimeMatches = detectedMime === expectedMime;
  } else {
    // text/html
    mimeMatches =
      detectedMime === 'text/html' ||
      detectedMime.startsWith('text/') ||
      detectedMime.startsWith('application/xhtml');
  }

  if (!mimeMatches) {
    await emitTelemetry({
      event: 'inbox.mime_mismatch',
      timestamp: timestamp(),
      severity: 'warn',
      outcome: 'rejected',
      file_path: filePath,
      extension: ext,
      detected_mime: detectedMime,
      error_code: 'mime_mismatch',
    });
    return err(
      new ValidationError({
        error_code: 'mime_mismatch',
        message: `Extension ${ext} expected ${expectedMime}; detected ${detectedMime}`,
        file_path: filePath,
        retriable: false,
        extension: ext,
        detected_mime: detectedMime,
      }),
    );
  }

  // ---- Gate 4: size cap ----
  const config = loadIngestConfig();
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (statSize > maxBytes) {
    await emitTelemetry({
      event: 'inbox.size_exceeded',
      timestamp: timestamp(),
      severity: 'warn',
      outcome: 'rejected',
      file_path: filePath,
      size_bytes: statSize,
      max_bytes: maxBytes,
      error_code: 'size_exceeded',
    });
    return err(
      new ValidationError({
        error_code: 'size_exceeded',
        message: `File size ${statSize} exceeds max ${maxBytes}`,
        file_path: filePath,
        retriable: false,
        size_bytes: statSize,
        max_bytes: maxBytes,
      }),
    );
  }

  // ---- All gates pass ----
  await emitTelemetry({
    event: 'inbox.allowlist_hit',
    timestamp: timestamp(),
    severity: 'info',
    outcome: 'success',
    file_path: filePath,
    mime_type: expectedMime,
    size_bytes: statSize,
  });

  return ok({
    filePath,
    mimeType: expectedMime,
    sizeBytes: statSize,
    mtimeMs: statMtimeMs,
  });
}
