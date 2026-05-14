// SP-006 T035 — Read-only adapter for the corpus://failures MCP resource.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-008, FR-HARDEN-009, FR-HARDEN-011,
//     FR-HARDEN-012
//   - specs/006-hardening/contracts/adr-failures-resource.md "Read Algorithm"
//   - specs/006-hardening/data-model.md §"Entity 2 / 6 / 7"
//   - Constitution Principles III (Substrate, Not Surface), V, VII, XIII
//
// READ-ONLY by construction (Constitution III). The ESLint rule
// `no-writes-from-resource-handlers` is scoped over this file
// (eslint.config.js) — any filesystem write primitive (writeFile, appendFile,
// mkdir, unlink, etc.) or SQL INSERT / UPDATE / DELETE / CREATE / DROP /
// ALTER call here is a hard lint failure.
//
// The adapter:
//   1. Reads `Paths.failed()` via readdir (ENOENT → graceful empty).
//   2. Filters names to `*.error.json` AND `*.recovery.error.json`.
//   3. Reads each file via readFile, parses JSON, validates against
//      FailureEntryZodSchema (without sidecar_path; that field is added by
//      this adapter).
//   4. On per-sidecar parse/validation failure: emits
//      `failures.sidecar_parse_failed` telemetry and skips the file.
//   5. Applies optional `stage` + `since` filters.
//   6. Sorts descending by `timestamp`.
//   7. Paginates by `limit` + `offset`.
//   8. Validates the final response shape against
//      FailuresResourceResponseZodSchema before return.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  FailureEntryZodSchema,
  FailuresResourceResponseZodSchema,
  emitTelemetry,
  type FailuresQuery,
  type FailureEntry,
  type FailuresResourceResponse,
} from '@llm-corpus/contracts';

// FailureEntry without the SP-006-added sidecar_path field — the on-disk
// shape produced by the SP-003 failure-lane writer + the SP-006 recovery
// scanner. Strict (no unknown keys allowed in the persisted sidecar).
const SidecarPayloadSchema = FailureEntryZodSchema.omit({ sidecar_path: true });

const SIDECAR_PATTERN_PRIMARY = /\.error\.json$/;
const SIDECAR_PATTERN_RECOVERY = /\.recovery\.error\.json$/;

interface SidecarFile {
  readonly filename: string;
  readonly absolutePath: string;
}

async function listSidecarFiles(
  failedDir: string,
  signal: AbortSignal,
): Promise<SidecarFile[]> {
  signal.throwIfAborted();
  let names: string[];
  try {
    names = await fsp.readdir(failedDir);
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return [];
    }
    throw caught;
  }
  const out: SidecarFile[] = [];
  for (const n of names) {
    if (
      SIDECAR_PATTERN_RECOVERY.test(n) ||
      SIDECAR_PATTERN_PRIMARY.test(n)
    ) {
      out.push({ filename: n, absolutePath: path.join(failedDir, n) });
    }
  }
  return out;
}

async function emitParseFailed(
  sidecar_path: string,
  errorMessage: string,
): Promise<void> {
  // Best-effort — never mask the read by a telemetry-write failure.
  try {
    await emitTelemetry({
      event: 'failures.sidecar_parse_failed',
      timestamp: new Date().toISOString(),
      severity: 'warn',
      outcome: 'failed',
      sidecar_path,
      error: errorMessage.slice(0, 1024),
    });
  } catch {
    // Swallow — Constitution XIII expects emission, but read-only correctness
    // must dominate. The malformed-sidecar skip path is the user-visible
    // contract; telemetry is best-effort here.
  }
}

async function parseSidecar(
  file: SidecarFile,
  signal: AbortSignal,
): Promise<FailureEntry | null> {
  signal.throwIfAborted();
  let raw: string;
  try {
    raw = await fsp.readFile(file.absolutePath, 'utf8');
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    await emitParseFailed(
      file.absolutePath,
      `read failed: ${e.code ?? ''} ${e.message}`,
    );
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (caught) {
    await emitParseFailed(
      file.absolutePath,
      `JSON parse failed: ${(caught as Error).message}`,
    );
    return null;
  }
  const parsed = SidecarPayloadSchema.safeParse(json);
  if (!parsed.success) {
    await emitParseFailed(
      file.absolutePath,
      `schema validation failed: ${parsed.error.message}`,
    );
    return null;
  }
  return { ...parsed.data, sidecar_path: file.absolutePath };
}

function applyFilters(
  entries: readonly FailureEntry[],
  query: FailuresQuery,
): FailureEntry[] {
  let out = entries.slice();
  if (query.stage !== undefined) {
    const wanted = query.stage;
    out = out.filter((e) => e.stage === wanted);
  }
  if (query.since !== undefined) {
    const sinceMs = Date.parse(query.since);
    out = out.filter((e) => Date.parse(e.timestamp) >= sinceMs);
  }
  return out;
}

function sortDescByTimestamp(entries: FailureEntry[]): FailureEntry[] {
  return entries.sort((a, b) => {
    // Lexicographic comparison of ISO-8601 strings is order-preserving when
    // both timestamps use the same offset format; fall back to Date.parse for
    // safety against mixed offsets.
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (tb !== ta) return tb - ta;
    return (a.doc_id ?? '').localeCompare(b.doc_id ?? '');
  });
}

/**
 * Read the failure-lane sidecars and return a paginated, filtered, sorted
 * FailuresResourceResponse. Read-only by construction — never writes to disk
 * or SQLite (Constitution III; `no-writes-from-resource-handlers` ESLint
 * rule covers this file).
 *
 * @param query  Already-Zod-validated FailuresQuery. The handler validates
 *               the raw query string at the MCP boundary; this adapter
 *               trusts its caller and applies the parsed filters.
 * @param signal AbortSignal — checked at the directory-listing boundary and
 *               between sidecar reads.
 */
export async function readFailuresEntries(
  query: FailuresQuery,
  signal: AbortSignal,
): Promise<FailuresResourceResponse> {
  signal.throwIfAborted();
  const failedDir = Paths.failed();
  const files = await listSidecarFiles(failedDir, signal);
  // Parse sidecars in parallel — independent fs.readFile per file. Each
  // parseSidecar performs its own signal.throwIfAborted() at entry, so
  // an abort mid-batch still surfaces as a rejection.
  const parsed = await Promise.all(files.map((file) => parseSidecar(file, signal)));
  const entries: FailureEntry[] = parsed.filter((e): e is FailureEntry => e !== null);
  const filtered = applyFilters(entries, query);
  const sorted = sortDescByTimestamp(filtered);
  const page = sorted.slice(query.offset, query.offset + query.limit);
  const response: FailuresResourceResponse = {
    entries: page,
    total_count: filtered.length,
    returned_count: page.length,
    schema_version: 1 as const,
  };
  return FailuresResourceResponseZodSchema.parse(response);
}
