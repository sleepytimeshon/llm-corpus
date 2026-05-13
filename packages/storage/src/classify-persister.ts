// SP-004 US1 (T036) — Classify-persister: paired SQL UPDATE + body-file
// frontmatter rewrite in a single SQLite transaction.
//
// References:
//   - specs/004-classifier/spec.md FR-CLASSIFY-007, FR-CLASSIFY-008,
//     FR-CLASSIFY-011, FR-CLASSIFY-012, FR-CLASSIFY-013
//   - specs/004-classifier/research.md Decision F (atomicity strategy)
//   - specs/004-classifier/contracts/adr-classifier-atomicity.md
//   - specs/004-classifier/data-model.md §"Entity 4" (post-classify
//     frontmatter shape) + §"Entity 5" (post-UPDATE documents row)
//   - Constitution Principle II (no LLM-derived body)
//   - Constitution Principle VIII (Atomic Writes & Transactional Index Updates)
//
// Per-doc persist flow:
//
//   1. Read the current body file via fs.readFile.
//   2. Parse the SP-003-written frontmatter; strip forbidden keys
//      (confidence, origin, provenance_*, captured_at, corpus capture,
//      facet_domain_proposed, facet_tags_proposed) defensively.
//   3. Merge the classifier output's allowed fields (facet_domain,
//      facet_type, tags, summary) into the frontmatter — destructure-rename
//      pattern makes the confidence omission lint-visible.
//   4. Serialize the new (frontmatter + body-section-byte-preserved) content
//      via stringifyMarkdownWithFrontmatter.
//   5. Write the content to a tmp path under Paths.cache() via withTempDir.
//   6. BEGIN TRANSACTION on the better-sqlite3 write-side connection.
//   7. updateClassification — affected_rows MUST be 1; if 0, ROLLBACK +
//      Result.err (idempotency defense per FR-CLASSIFY-012).
//   8. For each proposed term in facet_domain_proposed / facet_tags_proposed
//      not already in the established vocab snapshot:
//      insertProposedTerm(db, axis, term, signal).
//   9. Atomic rename tmp → canonical body path (the LAST step before COMMIT).
//   10. COMMIT.
//
// On any failure between step 6 and step 10: ROLLBACK, clean up tmp file.
// The caller's error handler writes the <doc-id>.error.json sidecar.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  ok,
  err,
  type Result,
  Paths,
  ClassifyPersistError,
  withTempDir,
  parseMarkdownWithFrontmatter,
  stringifyMarkdownWithFrontmatter,
  type ClassifierOutput,
} from '@llm-corpus/contracts';
import { updateClassification } from './document-writer.js';
import { insertProposedTerm } from './taxonomy-terms-adapter.js';

// Forbidden frontmatter keys (Principle II). Stripped defensively before
// writing the post-classify frontmatter, regardless of whether SP-003 wrote
// them in the first place.
const FORBIDDEN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'confidence',
  'origin',
  'provenance',
  'provenance_kind',
  'provenance_uri',
  'captured_at',
  'corpus capture',
  'facet_domain_proposed',
  'facet_tags_proposed',
]);

export interface VocabularySnapshot {
  readonly domains: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

export interface PersistClassificationInput {
  /** The doc-XXXXXXXX id of the row to update. */
  docId: string;
  /** The classifier's structured output. */
  classifierOutput: ClassifierOutput;
  /** The SP-003 body_path (relative to Paths.docs()). */
  bodyPath: string;
  /** Established-vocabulary snapshot for proposed-term routing. */
  vocabulary: VocabularySnapshot;
  /** The write-side better-sqlite3 connection. Caller-owned. */
  db: DatabaseType;
}

export interface PersistedClassification {
  /** Number of proposed terms recorded for telemetry observability. */
  proposedTermCount: number;
  /** True if the body file's frontmatter was rewritten (always true on ok). */
  frontmatterRewritten: boolean;
}

/**
 * Persist a classifier output to BOTH the SQL row AND the body-file YAML
 * frontmatter inside a single SQLite transaction.
 *
 * On success, the documents row's facet_domain / tags_json / facet_type
 * carry classifier values, the body file's frontmatter mirrors them, and
 * 0..N taxonomy_terms rows at state='proposed' have been INSERTed.
 *
 * On failure: ROLLBACK; tmp body file removed; row stays sentinel; no
 * orphan proposed-terms rows.
 */
export async function persistClassification(
  input: PersistClassificationInput,
  signal: AbortSignal,
): Promise<Result<PersistedClassification, ClassifyPersistError>> {
  signal.throwIfAborted();

  const { docId, classifierOutput, bodyPath, vocabulary, db } = input;

  // ---- Step 1: read body file ----
  const fullBodyPath = path.join(Paths.docs(), bodyPath);
  let originalText: string;
  try {
    originalText = await fsp.readFile(fullBodyPath, 'utf8');
  } catch (caught) {
    return err(
      new ClassifyPersistError({
        error_code: 'persist_failed',
        message: `read body file failed (${fullBodyPath}): ${(caught as Error).message}`,
      }),
    );
  }

  // ---- Step 2: parse + strip forbidden keys ----
  let parsed;
  try {
    parsed = parseMarkdownWithFrontmatter(originalText);
  } catch (caught) {
    return err(
      new ClassifyPersistError({
        error_code: 'frontmatter_rewrite_failed',
        message: `parse frontmatter failed: ${(caught as Error).message}`,
        retriable: false,
      }),
    );
  }

  // ---- Step 3: merge — destructure-rename pattern for confidence omission ----
  // Pulling `confidence` and the optional `facet_*_proposed` out separately
  // makes it lint-visible that those values do NOT land in the persisted
  // frontmatter (FR-CLASSIFY-013 + Principle II forbidden-list).
  const {
    confidence: _confidence,
    facet_domain_proposed,
    facet_tags_proposed,
    ...persistedClassifierFields
  } = classifierOutput;
  // confidence intentionally discarded — never persisted to frontmatter.
  void _confidence;

  const cleanedExisting: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.frontmatter)) {
    if (!FORBIDDEN_FRONTMATTER_KEYS.has(k)) {
      cleanedExisting[k] = v;
    }
  }
  const newFrontmatter: Record<string, unknown> = {
    ...cleanedExisting,
    facet_domain: persistedClassifierFields.facet_domain,
    facet_type: persistedClassifierFields.facet_type,
    tags: [...persistedClassifierFields.tags],
    summary: persistedClassifierFields.summary,
  };

  // ---- Step 4: serialize ----
  const newContent = stringifyMarkdownWithFrontmatter({
    frontmatter: newFrontmatter,
    body: parsed.body,
  });

  // ---- Steps 5–10: tmp write outside txn, then SQL txn + atomic rename ----
  let proposedTermCount = 0;
  try {
    await withTempDir(
      async (tmpDir) => {
        const tmpFile = path.join(tmpDir, `${docId}.md`);
        // Write + fsync the tmp body file.
        const fh = await fsp.open(tmpFile, 'w');
        try {
          await fh.writeFile(newContent, 'utf8');
          await fh.sync();
        } finally {
          await fh.close();
        }

        signal.throwIfAborted();

        // ---- SQL transaction ----
        db.exec('BEGIN IMMEDIATE');
        try {
          const updated = updateClassification(db, {
            docId,
            facetDomain: persistedClassifierFields.facet_domain,
            tagsJson: JSON.stringify([...persistedClassifierFields.tags]),
            facetType: persistedClassifierFields.facet_type,
          });
          if (updated.affectedRows === 0) {
            db.exec('ROLLBACK');
            throw new ClassifyPersistError({
              error_code: 'persist_failed',
              message: `UPDATE affected 0 rows — row ${docId} not in sentinel state (FR-CLASSIFY-012 idempotency)`,
              retriable: false,
            });
          }

          // Proposed-term INSERTs (state='proposed' baked into adapter SQL).
          if (facet_domain_proposed) {
            const inDomain = vocabulary.domains.has(facet_domain_proposed);
            if (!inDomain) {
              const r = await insertProposedTerm(
                db,
                'domain',
                facet_domain_proposed,
                signal,
              );
              if (!r.ok) {
                db.exec('ROLLBACK');
                throw new ClassifyPersistError({
                  error_code: 'persist_failed',
                  message: `proposed domain INSERT failed: ${r.error.message}`,
                });
              }
              proposedTermCount += 1;
            }
          }
          if (facet_tags_proposed) {
            for (const tag of facet_tags_proposed) {
              if (vocabulary.tags.has(tag)) continue;
              const r = await insertProposedTerm(db, 'tag', tag, signal);
              if (!r.ok) {
                db.exec('ROLLBACK');
                throw new ClassifyPersistError({
                  error_code: 'persist_failed',
                  message: `proposed tag INSERT failed (${tag}): ${r.error.message}`,
                });
              }
              proposedTermCount += 1;
            }
          }

          // COMMIT FIRST. better-sqlite3 db.exec is synchronous; if COMMIT
          // throws (WAL write failure, disk full), we ROLLBACK before any
          // file-system mutation. Once COMMIT returns, the SQL state is
          // durable and the row is no longer sentinel — idempotency (FR-CLASSIFY-012)
          // protects future drains from re-classifying it.
          db.exec('COMMIT');
        } catch (caughtInner) {
          // SQL not yet committed: ROLLBACK; tmp file is cleaned by withTempDir.
          try {
            db.exec('ROLLBACK');
          } catch {
            // already rolled back
          }
          throw caughtInner;
        }

        // Atomic rename — AFTER COMMIT. Constitution VIII: SQL is the
        // authoritative row state; if this rename throws, the SQL row is
        // already classified and the body file's frontmatter is stale
        // (sentinel-state). That divergence is forward-recoverable: doctor
        // / future reenrich pass detects (SQL non-sentinel, frontmatter
        // sentinel) and repairs. The REVERSE direction (rename succeeded,
        // SQL rolled back) would be unrecoverable — the LLM is probabilistic,
        // so re-classification might produce different output and leave a
        // permanent fingerprint mismatch. Hence: COMMIT first, rename second.
        await fsp.rename(tmpFile, fullBodyPath);
      },
      { signal },
    );
  } catch (caught) {
    if (caught instanceof ClassifyPersistError) {
      return err(caught);
    }
    return err(
      new ClassifyPersistError({
        error_code: 'persist_failed',
        message: `classify persist failed: ${(caught as Error).message}`,
      }),
    );
  }

  return ok({
    proposedTermCount,
    frontmatterRewritten: true,
  });
}
