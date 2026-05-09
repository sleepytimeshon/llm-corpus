// T047 — Unit test: document-adapter (US4).
//
// References: FR-008, US4 AS1, US4 AS2, US4 AS4, Constitution VII, VIII,
// contracts/resource-document.md.
//
// Coverage:
//   - found: Result.ok({uri, body, frontmatter}) with body stripped of frontmatter
//   - not-found: Result.err(DocumentNotFoundError)
//   - integrity-loss: Result.err(IntegrityLossError) when frontmatter id ≠ requested id
//   - trash + failure-lane rows return DocumentNotFoundError (excluded by status='success')
//   - signal.throwIfAborted() between SQLite read and file read

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import { fetchDocument } from '../../packages/storage/src/document-adapter.js';
// Import from the same package-resolved path as the adapter so the
// `instanceof <ErrorClass>` checks use the same class identity.
import {
  DocumentNotFoundError,
  IntegrityLossError,
  Paths,
} from '@llm-corpus/contracts';

function writeBodyFile(corpusHome: string, bodyRel: string, contents: string) {
  const docsDir = path.join(corpusHome, 'data', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, bodyRel), contents, 'utf8');
}

function frontmatterFor(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'source_path: /inbox/example.md',
    "ingest_timestamp: '2026-05-15T14:30:00Z'",
    'mime_type: text/markdown',
    'hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '---',
    '',
  ].join('\n');
}

describe('fetchDocument() (T047 / FR-008)', () => {
  it('returns ok with stripped body and parsed frontmatter for known id', async () => {
    const handle = await loadFixture('doc-found-1', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Write body file matching `doc-ab12cd34` row's body_path.
      const body = '# Hybrid Search\n\nThis document explores...\n';
      writeBodyFile(
        handle.rootDir,
        'doc-ab12cd34.md',
        frontmatterFor('doc-ab12cd34') + body,
      );
      const ac = new AbortController();
      const result = await fetchDocument('doc-ab12cd34', ac.signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.uri).toBe('corpus://docs/doc-ab12cd34');
      expect(result.value.body).toBe(body);
      expect(result.value.frontmatter.id).toBe('doc-ab12cd34');
      expect(result.value.frontmatter.mime_type).toBe('text/markdown');
      expect(typeof result.value.frontmatter.hash).toBe('string');
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns DocumentNotFoundError for unknown id', async () => {
    const handle = await loadFixture('doc-missing-1', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const ac = new AbortController();
      const result = await fetchDocument('doc-deadbeef', ac.signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(DocumentNotFoundError);
      expect((result.error as DocumentNotFoundError).data.docId).toBe(
        'doc-deadbeef',
      );
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns IntegrityLossError when frontmatter id ≠ requested id', async () => {
    const handle = await loadFixture('doc-integrity-1', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      // Body file for doc-ab12cd34 with WRONG frontmatter id.
      const body = '# Wrong\n\nbody.\n';
      writeBodyFile(
        handle.rootDir,
        'doc-ab12cd34.md',
        frontmatterFor('doc-99999999') + body,
      );
      const ac = new AbortController();
      const result = await fetchDocument('doc-ab12cd34', ac.signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(IntegrityLossError);
      const e = result.error as IntegrityLossError;
      expect(e.data.requestedId).toBe('doc-ab12cd34');
      expect(e.data.frontmatterFoundId).toBe('doc-99999999');
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns DocumentNotFoundError for failure-lane (status=failed) row', async () => {
    const handle = await loadFixture('doc-failed-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-fa110001', 'Failed', 'doc-fa110001.md', '/inbox/f.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:00:00Z', 'failed')
      `);
      const ac = new AbortController();
      const result = await fetchDocument('doc-fa110001', ac.signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(DocumentNotFoundError);
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('returns DocumentNotFoundError for trashed row (status=trashed)', async () => {
    const handle = await loadFixture('doc-trashed-1', null);
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      handle.db.exec(`
        INSERT INTO documents (id, title, body_path, source_path, facet_domain,
          tags_json, facet_type, source_type, mime_type, hash, ingest_timestamp, status)
        VALUES ('doc-7a570001', 'Trashed', 'doc-7a570001.md', '/inbox/t.md', 'devops', '[]', 'tutorial', 'article', 'text/markdown',
         'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '2026-05-15T14:00:00Z', 'trashed')
      `);
      const ac = new AbortController();
      const result = await fetchDocument('doc-7a570001', ac.signal);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(DocumentNotFoundError);
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('throws on aborted signal before invocation', async () => {
    const handle = await loadFixture('doc-abort-1', 'documents');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const ac = new AbortController();
      ac.abort();
      await expect(fetchDocument('doc-ab12cd34', ac.signal)).rejects.toThrow();
    } finally {
      delete process.env.CORPUS_HOME;
      handle.cleanup();
    }
  });

  it('uses Paths.docs() to locate the body file', async () => {
    // Sanity: Paths.docs() resolves under CORPUS_HOME/data/docs.
    process.env.CORPUS_HOME = '/tmp/corpus-paths-check';
    try {
      expect(Paths.docs()).toBe('/tmp/corpus-paths-check/data/docs');
    } finally {
      delete process.env.CORPUS_HOME;
    }
  });
});
