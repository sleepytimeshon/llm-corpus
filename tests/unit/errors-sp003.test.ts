// T004 (SP-003 PREREQ-004) — Contract test for the 6 new SP-003 typed errors.
//
// Verifies that IngestError, ValidationError (with error_code field),
// NormalizeError, PersistError, WatcherError, LockContentionError:
//   - Instantiate with structured `data`
//   - Are throwable (subclass of Error)
//   - Carry distinct `name` values
//   - Are instanceof their parent error class
//
// Spec references:
//   - specs/003-ingest-pipeline/plan.md PREREQ-004
//   - specs/003-ingest-pipeline/spec.md FR-INGEST-007
//   - Constitution Principle XI (Library/CLI Boundary: typed errors only)
//
// TDD: this test MUST FAIL before T010 (the implementation) lands.

import { describe, it, expect } from 'vitest';

describe('PREREQ-004 — SP-003 typed errors (contract)', () => {
  it('IngestError is exported from packages/contracts/src/errors.ts', async () => {
    const mod = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, unknown>;
    expect(typeof mod.IngestError).toBe('function');
  });

  it('IngestError instantiates with structured data and is throwable', async () => {
    const { IngestError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (IngestError as new (data: object) => Error)({
      stage: 'normalize',
      retriable: true,
      message: 'test',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IngestError');
    let caught: Error | null = null;
    try {
      throw err;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.name).toBe('IngestError');
  });

  it('ValidationError carries an error_code from the FR-INGEST-007 enum', async () => {
    const { ValidationError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (ValidationError as new (data: {
      error_code: string;
      message: string;
    }) => Error & { data: { error_code: string } })({
      error_code: 'mime_mismatch',
      message: 'extension says md but bytes say pdf',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ValidationError');
    expect(err.data.error_code).toBe('mime_mismatch');
  });

  it('NormalizeError instantiates and is throwable', async () => {
    const { NormalizeError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (NormalizeError as new (data: object) => Error)({
      error_code: 'extract_failed',
      message: 'pdf-parse timed out',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NormalizeError');
  });

  it('PersistError instantiates and is throwable', async () => {
    const { PersistError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (PersistError as new (data: object) => Error)({
      error_code: 'persist_failed',
      message: 'UNIQUE constraint violation on documents.hash',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PersistError');
  });

  it('WatcherError instantiates and is throwable', async () => {
    const { WatcherError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (WatcherError as new (data: object) => Error)({
      errno: 'ENOSPC',
      limit_kind: 'inotify_watches',
      message: 'inotify watch limit exceeded',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WatcherError');
  });

  it('LockContentionError instantiates and is throwable', async () => {
    const { LockContentionError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (LockContentionError as new (data: object) => Error)({
      lock_path: '/state/drain.lock',
      message: 'another drain process holds the lock',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LockContentionError');
  });

  it('all six errors carry distinct `name` values', async () => {
    const errors = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: object) => Error>;
    const instances = [
      new errors.IngestError({ stage: 'normalize' }),
      new errors.ValidationError({
        error_code: 'mime_mismatch',
        message: 'm',
      }),
      new errors.NormalizeError({ error_code: 'extract_failed' }),
      new errors.PersistError({ error_code: 'persist_failed' }),
      new errors.WatcherError({ errno: 'ENOSPC' }),
      new errors.LockContentionError({ lock_path: '/state/drain.lock' }),
    ];
    const names = instances.map((e) => e.name);
    expect(new Set(names).size).toBe(6);
  });

  it('all six errors are instanceof Error (parent class)', async () => {
    const errors = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: object) => Error>;
    const instances = [
      new errors.IngestError({ stage: 'normalize' }),
      new errors.ValidationError({
        error_code: 'mime_mismatch',
        message: 'm',
      }),
      new errors.NormalizeError({ error_code: 'extract_failed' }),
      new errors.PersistError({ error_code: 'persist_failed' }),
      new errors.WatcherError({ errno: 'ENOSPC' }),
      new errors.LockContentionError({ lock_path: '/state/drain.lock' }),
    ];
    for (const e of instances) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('errors do NOT invoke process.exit (Constitution XI library boundary)', async () => {
    // Sanity: instantiating these errors must be pure — no side effects.
    const errors = (await import(
      '../../packages/contracts/src/errors.js'
    )) as Record<string, new (data: object) => Error>;
    // If any constructor called process.exit the test runner would terminate.
    const _ = [
      new errors.IngestError({ stage: 'normalize' }),
      new errors.ValidationError({
        error_code: 'mime_mismatch',
        message: 'm',
      }),
      new errors.NormalizeError({ error_code: 'extract_failed' }),
      new errors.PersistError({ error_code: 'persist_failed' }),
      new errors.WatcherError({ errno: 'ENOSPC' }),
      new errors.LockContentionError({ lock_path: '/state/drain.lock' }),
    ];
    expect(_.length).toBe(6);
  });
});
