// T004 (SP-004 PREREQ-003) — Contract test for the 6 new SP-004 typed errors.
//
// Verifies that ClassifierError (base), OllamaUnavailableError,
// SchemaInvalidError, VocabularyViolationError, ClassifyPersistError, and
// ClassifierConfigurationError:
//   - Instantiate with structured `data`
//   - Are throwable (subclass of Error)
//   - Carry distinct `name` values
//   - The four domain-specific subclasses are recognized as
//     `instanceof ClassifierError`
//   - None invoke `process.exit` (Constitution XI library boundary)
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-003
//   - specs/004-classifier/spec.md FR-CLASSIFY-017
//   - Constitution Principle XI (Library/CLI Boundary)
//
// TDD: this test MUST FAIL before T010 (the implementation) lands.

import { describe, it, expect } from 'vitest';

describe('PREREQ-003 — SP-004 typed errors (contract)', () => {
  it('ClassifierError is exported and is a subclass of Error', async () => {
    const { ClassifierError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    expect(typeof ClassifierError).toBe('function');
    const err = new (ClassifierError as new (data: object) => Error)({
      message: 'base',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClassifierError');
  });

  it('OllamaUnavailableError is throwable, has data, is instanceof ClassifierError', async () => {
    const { OllamaUnavailableError, ClassifierError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (OllamaUnavailableError as new (data: {
      errno: string;
      message: string;
    }) => Error & { data: { errno: string } })({
      errno: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:11434',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClassifierError as new (...args: unknown[]) => Error);
    expect(err.name).toBe('OllamaUnavailableError');
    expect(err.data.errno).toBe('ECONNREFUSED');
  });

  it('SchemaInvalidError is throwable, has data, is instanceof ClassifierError', async () => {
    const { SchemaInvalidError, ClassifierError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (SchemaInvalidError as new (data: object) => Error)({
      validation_errors: ['facet_domain: required'],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClassifierError as new (...args: unknown[]) => Error);
    expect(err.name).toBe('SchemaInvalidError');
  });

  it('VocabularyViolationError is throwable, has data, is instanceof ClassifierError', async () => {
    const { VocabularyViolationError, ClassifierError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (VocabularyViolationError as new (data: object) => Error)({
      offending_field: 'facet_domain',
      offending_value: 'hallucinated-domain',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClassifierError as new (...args: unknown[]) => Error);
    expect(err.name).toBe('VocabularyViolationError');
  });

  it('ClassifyPersistError is throwable, has data, is instanceof ClassifierError', async () => {
    const { ClassifyPersistError, ClassifierError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (ClassifyPersistError as new (data: object) => Error)({
      error_code: 'persist_failed',
      message: 'ROLLBACK due to body-file rename failure',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClassifierError as new (...args: unknown[]) => Error);
    expect(err.name).toBe('ClassifyPersistError');
  });

  it('ClassifierConfigurationError is throwable (boot-time error)', async () => {
    const { ClassifierConfigurationError } = await import(
      '../../packages/contracts/src/errors.js'
    );
    const err = new (ClassifierConfigurationError as new (data: object) => Error)({
      key: 'format',
      reason: 'missing JSON Schema for Ollama format parameter',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClassifierConfigurationError');
  });

  it('all six SP-004 errors carry distinct `name` values', async () => {
    const errors = await import('../../packages/contracts/src/errors.js');
    const instances = [
      new errors.ClassifierError({ message: 'm' }),
      new errors.OllamaUnavailableError({ errno: 'E', message: 'm' }),
      new errors.SchemaInvalidError({ validation_errors: ['x'] }),
      new errors.VocabularyViolationError({
        offending_field: 'facet_domain',
        offending_value: 'x',
      }),
      new errors.ClassifyPersistError({
        error_code: 'persist_failed',
        message: 'm',
      }),
      new errors.ClassifierConfigurationError({ key: 'k', reason: 'r' }),
    ];
    const names = instances.map((e) => e.name);
    expect(new Set(names).size).toBe(6);
  });

  it('errors do NOT invoke process.exit (Constitution XI library boundary)', async () => {
    const errors = await import('../../packages/contracts/src/errors.js');
    const _ = [
      new errors.ClassifierError({ message: 'm' }),
      new errors.OllamaUnavailableError({ errno: 'E', message: 'm' }),
      new errors.SchemaInvalidError({ validation_errors: ['x'] }),
      new errors.VocabularyViolationError({
        offending_field: 'facet_domain',
        offending_value: 'x',
      }),
      new errors.ClassifyPersistError({
        error_code: 'persist_failed',
        message: 'm',
      }),
      new errors.ClassifierConfigurationError({ key: 'k', reason: 'r' }),
    ];
    expect(_.length).toBe(6);
  });
});
