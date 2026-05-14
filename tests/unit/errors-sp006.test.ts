// SP-006 T004 — Contract test for the 6 SP-006 typed errors.
//
// References:
//   - specs/006-hardening/spec.md FR-HARDEN-021
//   - Constitution Principle XI (Library/CLI Boundary)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  RecoveryScanError,
  RecoveryOrphanUnresumableError,
  FailuresResourceError,
  TierFallthroughError,
  CatalogMissingError,
  GrepSubprocessError,
} from '../../packages/contracts/src/errors.js';

describe('PREREQ-003 — SP-006 typed errors', () => {
  it('RecoveryScanError is throwable with structured data and stable name', () => {
    const e = new RecoveryScanError({
      reason: 'lock_contention',
      message: 'flock contention',
    });
    expect(e instanceof RecoveryScanError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(e.name).toBe('RecoveryScanError');
    expect(e.data.reason).toBe('lock_contention');
    expect(() => {
      throw e;
    }).toThrow(RecoveryScanError);
  });

  it('RecoveryOrphanUnresumableError extends RecoveryScanError', () => {
    const e = new RecoveryOrphanUnresumableError({
      doc_id: 'doc-deadbeef',
      stage: 'ingest',
      reason: 'inbox file missing',
    });
    expect(e instanceof RecoveryOrphanUnresumableError).toBe(true);
    expect(e instanceof RecoveryScanError).toBe(true);
    expect(e.name).toBe('RecoveryOrphanUnresumableError');
    expect(e.data.doc_id).toBe('doc-deadbeef');
    expect(e.data.stage).toBe('ingest');
  });

  it('FailuresResourceError is throwable with structured data', () => {
    const e = new FailuresResourceError({
      error_code: 'sidecar_parse_failed',
      message: 'JSON parse failure',
      sidecar_path: '/var/lib/corpus/failed/doc-x.error.json',
    });
    expect(e instanceof FailuresResourceError).toBe(true);
    expect(e.name).toBe('FailuresResourceError');
    expect(e.data.error_code).toBe('sidecar_parse_failed');
  });

  it('TierFallthroughError is throwable with structured data', () => {
    const e = new TierFallthroughError({
      tier: 'catalog-grep',
      reason: 'budget_exceeded',
      message: 'budget exceeded',
    });
    expect(e instanceof TierFallthroughError).toBe(true);
    expect(e.name).toBe('TierFallthroughError');
    expect(e.data.tier).toBe('catalog-grep');
  });

  it('CatalogMissingError carries the catalog path', () => {
    const e = new CatalogMissingError({
      catalog_path: '/var/lib/corpus/data/CATALOG.md',
    });
    expect(e instanceof CatalogMissingError).toBe(true);
    expect(e.name).toBe('CatalogMissingError');
    expect(e.data.catalog_path).toContain('CATALOG.md');
  });

  it('GrepSubprocessError carries errno + message', () => {
    const e = new GrepSubprocessError({
      errno: 'ENOENT',
      message: 'grep: command not found',
    });
    expect(e instanceof GrepSubprocessError).toBe(true);
    expect(e.name).toBe('GrepSubprocessError');
    expect(e.data.errno).toBe('ENOENT');
  });

  it('all six SP-006 errors have distinct names', () => {
    const names = new Set([
      new RecoveryScanError({ reason: 'lock_contention', message: 'm' }).name,
      new RecoveryOrphanUnresumableError({
        doc_id: 'doc-deadbeef',
        stage: 'ingest',
        reason: 'r',
      }).name,
      new FailuresResourceError({
        error_code: 'sidecar_parse_failed',
        message: 'm',
        sidecar_path: '/x',
      }).name,
      new TierFallthroughError({
        tier: 'hybrid',
        reason: 'budget_exceeded',
        message: 'm',
      }).name,
      new CatalogMissingError({ catalog_path: '/x' }).name,
      new GrepSubprocessError({ errno: 'ENOENT', message: 'm' }).name,
    ]);
    expect(names.size).toBe(6);
  });
});

describe('PREREQ-003 — no process.exit() CALLS in errors module', () => {
  it('errors.ts contains zero process.exit(...) invocations', () => {
    const errorsPath = path.resolve(
      __dirname,
      '../../packages/contracts/src/errors.ts',
    );
    const raw = fs.readFileSync(errorsPath, 'utf8');
    // Strip single-line and block comments so the assertion targets code,
    // not the // references in module-banner comments.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\/])\/\/.*$/gm, '$1');
    expect(stripped).not.toMatch(/process\.exit\s*\(/);
  });
});
