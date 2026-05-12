// T028 (SP-003) — normalize-markdown.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { normalizeMarkdown } from '../../packages/extract/src/normalize-markdown.js';

describe('normalizeMarkdown (T028)', () => {
  it('exports normalizeMarkdown', () => {
    expect(typeof normalizeMarkdown).toBe('function');
  });

  it('passes body verbatim and injects FR-008 minimum frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-md-'));
    const file = path.join(dir, 'doc.md');
    const body = '# Title\n\nBody content.\n';
    await fsp.writeFile(file, body);

    const result = await normalizeMarkdown(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: '/inbox/doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/markdown',
        hash: 'a'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toBe(body);
      expect(result.value.frontmatter['id']).toBe('doc-12345678');
      expect(result.value.frontmatter['source_path']).toBe('/inbox/doc.md');
      expect(result.value.frontmatter['ingest_timestamp']).toBe('2026-05-12T00:00:00.000Z');
      expect(result.value.frontmatter['mime_type']).toBe('text/markdown');
      expect(result.value.frontmatter['hash']).toBe('a'.repeat(64));
    }
  });

  it('preserves user frontmatter keys via passthrough', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-md-'));
    const file = path.join(dir, 'doc.md');
    await fsp.writeFile(
      file,
      '---\ntitle: User Title\nauthor: Alice\n---\n# Body\n',
    );

    const result = await normalizeMarkdown(
      {
        pendingPath: file,
        docId: 'doc-12345678',
        sourcePath: '/inbox/doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/markdown',
        hash: 'a'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.frontmatter['title']).toBe('User Title');
      expect(result.value.frontmatter['author']).toBe('Alice');
      // Canonical keys override.
      expect(result.value.frontmatter['id']).toBe('doc-12345678');
    }
  });

  it('output frontmatter id matches the input doc_id', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'norm-md-'));
    const file = path.join(dir, 'doc.md');
    await fsp.writeFile(file, '---\nid: doc-wrong000\n---\nbody\n');

    const result = await normalizeMarkdown(
      {
        pendingPath: file,
        docId: 'doc-abcd1234',
        sourcePath: '/inbox/doc.md',
        ingestTimestamp: '2026-05-12T00:00:00.000Z',
        mimeType: 'text/markdown',
        hash: 'b'.repeat(64),
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Canonical id wins.
      expect(result.value.frontmatter['id']).toBe('doc-abcd1234');
    }
  });
});
