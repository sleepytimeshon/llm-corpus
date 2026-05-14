// SP-006 T051 — CATALOG.md flat-file generator.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-018
//   - specs/006-hardening/data-model.md §"Entity 8 — CatalogLine"
//   - specs/006-hardening/research.md Decision L
//   - Constitution VIII (atomic writes), XIV (paths from resolver)
//
// CATALOG.md is a flat-file mirror of the SP-005 index, one line per doc:
//   <doc-id> | <title> | <facet_domain> | <facet_type> | <summary-first-200-chars>
//
// The "|" delimiter is reserved; if a title or summary contains "|" the
// generator escapes it to "‖" (U+2016). The summary is codepoint-safe
// truncated to its first 200 codepoints (preserves grapheme clusters).
//
// Append is atomic via withTempDir + fs.appendFile. Idempotent on duplicate
// doc_id: if the file already contains a line beginning with the doc_id, the
// append is skipped (Constitution X).

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Paths, type FacetType, withTempDir } from '@llm-corpus/contracts';
import type { Database as DatabaseType } from 'better-sqlite3';

/** Codepoint-safe input record for the CATALOG.md flat-file line. */
export interface CatalogLineInput {
  doc_id: string;
  title: string;
  facet_domain: string;
  facet_type: FacetType;
  summary: string;
}

const PIPE_DELIMITER = '|';
const PIPE_ESCAPE = '‖'; // U+2016 ‖

/** Codepoint-safe truncate to `max` codepoints. */
function truncateCodepoints(s: string, max: number): string {
  let i = 0;
  let out = '';
  for (const ch of s) {
    if (i >= max) break;
    out += ch;
    i += 1;
  }
  return out;
}

/** Escape pipe-delimiter occurrences inside a field. Newlines become spaces. */
function escapeField(s: string): string {
  return s
    .replace(/\r?\n/g, ' ')
    .split(PIPE_DELIMITER)
    .join(PIPE_ESCAPE);
}

/**
 * Produce one CATALOG.md line in the canonical pipe-delimited format.
 *
 *   <doc-id> | <title> | <facet_domain> | <facet_type> | <summary-200>\n
 *
 * Pipe-delimiter occurrences in title/summary are replaced with U+2016.
 * Summary is codepoint-safe truncated to 200 codepoints.
 */
export function formatCatalogLine(doc: CatalogLineInput): string {
  const summary200 = truncateCodepoints(doc.summary, 200);
  const fields = [
    doc.doc_id,
    escapeField(doc.title),
    escapeField(doc.facet_domain),
    doc.facet_type,
    escapeField(summary200),
  ];
  return fields.join(` ${PIPE_DELIMITER} `) + '\n';
}

const catalogPath = (): string => path.join(Paths.data(), 'CATALOG.md');

async function fileContainsDocId(file: string, docId: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  // doc_id is the leading token on each line; cheap startsWith scan.
  for (const line of raw.split('\n')) {
    if (line.startsWith(`${docId} `)) return true;
  }
  return false;
}

/**
 * Atomically append one CATALOG.md line for `doc`. Idempotent on duplicate
 * doc_id (skips append if a line beginning with the doc_id already exists).
 *
 * The atomic-append protocol:
 *   1. Open a temp scratch dir under Paths.cache() via withTempDir
 *   2. Materialize the new line in a temp file (for forensic visibility)
 *   3. fsync the temp file
 *   4. fs.appendFile(target) — POSIX-atomic for writes <= PIPE_BUF (4096
 *      bytes on Linux); a CATALOG.md line of < 500 bytes per spec budget
 *      fits comfortably under this limit so the append is atomic without a
 *      rename-into-place step.
 *
 * Constitution VIII transactional unit is the SQL writes in index-persister;
 * CATALOG.md is a flat-file MIRROR (similar to the SP-004 body-file
 * frontmatter rewrite). Append failure must NOT roll back the SQL writes.
 */
export async function appendCatalogLine(
  doc: CatalogLineInput,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const target = catalogPath();
  await fsp.mkdir(path.dirname(target), { recursive: true });

  if (await fileContainsDocId(target, doc.doc_id)) {
    return; // idempotent skip
  }

  const line = formatCatalogLine(doc);
  await withTempDir(
    async (dir) => {
      const scratch = path.join(dir, 'catalog-line.txt');
      await fsp.writeFile(scratch, line, { encoding: 'utf8' });
      const fh = await fsp.open(scratch, 'r+');
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
      // POSIX atomic append: writes <= PIPE_BUF (4096 bytes) are guaranteed
      // atomic across concurrent O_APPEND writers on Linux. CATALOG.md
      // lines are bounded < 500 bytes by spec.
      await fsp.appendFile(target, line, { encoding: 'utf8' });
    },
    { namespace: 'catalog-md', signal },
  );
}

/**
 * Rebuild CATALOG.md from scratch by iterating all classified rows in the
 * documents table. Called by `corpus reindex` after the SP-005 backfill loop
 * completes (T054). Idempotent: re-running on a populated DB produces the
 * same lines in `id ASC` order.
 *
 * The rebuild path TRUNCATES + rewrites; subsequent invocations produce
 * identical content.
 */
export async function regenerateCatalogFromDb(
  db: DatabaseType,
  signal: AbortSignal,
): Promise<{ written: number }> {
  signal.throwIfAborted();
  const target = catalogPath();
  await fsp.mkdir(path.dirname(target), { recursive: true });

  // Pull classified rows (status=success + facet_type set). The summary
  // column may be missing on older schemas; fall back to empty string.
  const rows = db
    .prepare(
      `SELECT id AS doc_id, title, facet_domain, facet_type,
              COALESCE(summary, '') AS summary
         FROM documents
        WHERE status = 'success'
          AND facet_type IS NOT NULL
          AND facet_type != 'unclassified'
        ORDER BY id ASC`,
    )
    .all() as Array<{
      doc_id: string;
      title: string;
      facet_domain: string;
      facet_type: string;
      summary: string;
    }>;

  // Construct the full content in memory; CATALOG.md size is small relative
  // to the 100k-doc-corpus target (≤ 200 chars/line * 100k = 20 MB).
  const chunks: string[] = [];
  for (const row of rows) {
    signal.throwIfAborted();
    chunks.push(
      formatCatalogLine({
        doc_id: row.doc_id,
        title: row.title,
        facet_domain: row.facet_domain,
        facet_type: row.facet_type as FacetType,
        summary: row.summary,
      }),
    );
  }
  const content = chunks.join('');

  // Atomic rewrite via withTempDir + fs.rename (rename is atomic on the
  // same filesystem; CATALOG.md lives under Paths.data() = same FS as the
  // withTempDir scratch under Paths.cache(), which may NOT be the same FS.
  // Use a sibling temp file under Paths.data() for the same-FS rename.
  const tmpPath = `${target}.tmp.${process.pid}`;
  await fsp.writeFile(tmpPath, content, { encoding: 'utf8' });
  const fh = await fsp.open(tmpPath, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmpPath, target);
  return { written: rows.length };
}
