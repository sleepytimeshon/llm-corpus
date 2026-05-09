// T055 — Read-only adapter for corpus://docs/{id} (US4).
//
// References: FR-008, contracts/resource-document.md, Constitution VII
// (cancellable IO), VIII (URI ↔ frontmatter id integrity), XIV (Paths-only).
//
// Logic:
//   1. signal.throwIfAborted() at entry
//   2. SQLite SELECT body_path WHERE id = ? AND status = 'success'
//      - no row → DocumentNotFoundError (also covers failure-lane and trash
//        since they have status='failed' / 'trashed')
//   3. signal.throwIfAborted() between SQLite and FS
//   4. fs.readFile body file via Paths.docs() + body_path
//   5. parseMarkdownWithFrontmatter
//   6. assert frontmatter.id === requested id else IntegrityLossError
//   7. return Ok({uri, body, frontmatter})
//
// Defensive id validation: only ids matching /^doc-[0-9a-f]{8}$/ proceed to
// SQLite. Malformed ids short-circuit to DocumentNotFoundError (defense in
// depth — the mcp-server dispatch regex also rejects, but the adapter
// double-checks). Constitution VIII.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  err,
  ok,
  type Result,
  DocumentNotFoundError,
  IndexLockedError,
  IntegrityLossError,
  Paths,
  parseMarkdownWithFrontmatter,
  type DocumentPayloadType,
} from '@llm-corpus/contracts';
import { openIndexReadOnly, isSqliteBusyError } from './sqlite-open.js';

const DOC_ID_PATTERN = /^doc-[0-9a-f]{8}$/;

export async function fetchDocument(
  docId: string,
  signal: AbortSignal,
): Promise<
  Result<
    DocumentPayloadType,
    DocumentNotFoundError | IndexLockedError | IntegrityLossError
  >
> {
  signal.throwIfAborted();

  // Defensive validation — also short-circuits any non-canonical id before
  // hitting SQLite. Constitution VIII (no untrusted input to query).
  if (!DOC_ID_PATTERN.test(docId)) {
    return err(new DocumentNotFoundError({ docId }));
  }

  const db = openIndexReadOnly();
  try {
    const row = db
      .prepare(
        `SELECT body_path FROM documents WHERE id = ? AND status = 'success'`,
      )
      .get(docId) as { body_path: string } | undefined;
    if (!row) {
      return err(new DocumentNotFoundError({ docId }));
    }
    signal.throwIfAborted();

    const fullPath = path.join(Paths.docs(), row.body_path);
    const fileContent = await fsp.readFile(fullPath, 'utf8');
    const { body, frontmatter } = parseMarkdownWithFrontmatter(fileContent);

    const fmId =
      typeof frontmatter['id'] === 'string'
        ? (frontmatter['id'] as string)
        : '';
    if (fmId !== docId) {
      return err(
        new IntegrityLossError({
          requestedId: docId,
          frontmatterFoundId: fmId,
        }),
      );
    }

    return ok({
      uri: `corpus://docs/${docId}`,
      body,
      // The Zod DocumentFrontmatter.passthrough() accepts the parsed object;
      // cast preserves TS type without re-validation here (the handler does
      // safeParse(DocumentPayload) before serializing).
      frontmatter: frontmatter as DocumentPayloadType['frontmatter'],
    });
  } catch (caught) {
    if (isSqliteBusyError(caught)) {
      return err(
        new IndexLockedError({ uri: `corpus://docs/${docId}` }),
      );
    }
    throw caught;
  } finally {
    db.close();
  }
}
