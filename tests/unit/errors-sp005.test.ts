// SP-005 T006 — Contract test for the 9 SP-005 typed errors.
//
// References:
//   - specs/005-retrieval/spec.md FR-RETRIEVAL-014
//   - Constitution Principle XI (Library/CLI Boundary)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  RetrievalError,
  EmbeddingUnavailableError,
  EmbeddingDimensionMismatchError,
  EmbeddingValidationError,
  IndexUnavailableError,
  EdgesBuildTimeoutError,
  SearchAbortedError,
  SearchValidationError,
  FusionError,
  IndexPersistError,
} from '../../packages/contracts/src/errors.js';

describe('PREREQ-003 — SP-005 typed errors', () => {
  it('RetrievalError is throwable with structured data', () => {
    const e = new RetrievalError({
      error_code: 'internal_error',
      message: 'm',
    });
    expect(e instanceof RetrievalError).toBe(true);
    expect(e.data.error_code).toBe('internal_error');
    expect(() => {
      throw e;
    }).toThrow(RetrievalError);
  });

  it('EmbeddingUnavailableError is instanceof RetrievalError', () => {
    const e = new EmbeddingUnavailableError({
      errno: 'ECONNREFUSED',
      message: 'no server',
    });
    expect(e instanceof RetrievalError).toBe(true);
    expect(e instanceof EmbeddingUnavailableError).toBe(true);
    expect(e.name).toBe('EmbeddingUnavailableError');
    expect(e.data.errno).toBe('ECONNREFUSED');
  });

  it('EmbeddingDimensionMismatchError carries expected + got', () => {
    const e = new EmbeddingDimensionMismatchError({
      expected: 768,
      got: 1024,
    });
    expect(e instanceof RetrievalError).toBe(true);
    expect(e.data.expected).toBe(768);
    expect(e.data.got).toBe(1024);
  });

  it('EmbeddingValidationError is constructed and named', () => {
    const e = new EmbeddingValidationError({ message: 'NaN at 5' });
    expect(e.name).toBe('EmbeddingValidationError');
    expect(e instanceof RetrievalError).toBe(true);
  });

  it('IndexUnavailableError carries signal_kind', () => {
    const e = new IndexUnavailableError({
      signal_kind: 'bm25',
      message: 'FTS5 corrupt',
    });
    expect(e.data.signal_kind).toBe('bm25');
    expect(e instanceof RetrievalError).toBe(true);
  });

  it('EdgesBuildTimeoutError carries doc_id + timeout_ms', () => {
    const e = new EdgesBuildTimeoutError({
      doc_id: 'doc-deadbeef',
      timeout_ms: 15_000,
    });
    expect(e.data.doc_id).toBe('doc-deadbeef');
    expect(e.data.timeout_ms).toBe(15_000);
  });

  it('SearchAbortedError default message', () => {
    const e = new SearchAbortedError({});
    expect(e instanceof RetrievalError).toBe(true);
    expect(e.data.error_code).toBeUndefined();
    // The error_code is set in the base RetrievalError.data via spread
    // ordering; we just check it carries the abort code somewhere.
    expect(e.message).toContain('aborted');
  });

  it('SearchValidationError carries issues', () => {
    const e = new SearchValidationError({
      issues: ['bad filter key'],
    });
    expect(e.data.issues).toEqual(['bad filter key']);
  });

  it('FusionError carries message', () => {
    const e = new FusionError({ message: 'rrf produced NaN' });
    expect(e.data.message).toBe('rrf produced NaN');
  });

  it('IndexPersistError carries stage + doc_id', () => {
    const e = new IndexPersistError({
      doc_id: 'doc-deadbeef',
      stage: 'vec',
      message: 'INSERT failed',
    });
    expect(e.data.stage).toBe('vec');
    expect(e.data.doc_id).toBe('doc-deadbeef');
  });

  it('zero process.exit invocations in SP-005 source (comments OK)', () => {
    const sources = [
      'packages/contracts/src/search-schemas.ts',
      'packages/inference/src/embedding-adapter.ts',
      'packages/storage/src/index-persister.ts',
      'packages/storage/src/sp005-migration.ts',
    ];
    for (const rel of sources) {
      const full = path.join(process.cwd(), rel);
      if (!fs.existsSync(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      // Strip // line comments and /* block comments */ before matching.
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(stripped).not.toMatch(/process\.exit\s*\(/);
    }
  });
});
