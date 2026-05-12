// T001 (SP-003 PREREQ-001) — Contract test for Paths.docsStore() getter.
//
// Verifies that Paths.docsStore() exists, returns path.join(Paths.docs(), 'store'),
// composes from Paths.docs() (no new XDG base), and honors CORPUS_HOME override.
// Idempotent across calls; no IO side effects.
//
// Spec references:
//   - specs/003-ingest-pipeline/plan.md PREREQ-001
//   - specs/003-ingest-pipeline/data-model.md §"Entity 8 — Normalized Body"
//   - Constitution Principle XIV (single resolver)
//
// TDD: this test MUST FAIL before T006 (the implementation) lands.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';

describe('PREREQ-001 — Paths.docsStore() (contract)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.CORPUS_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('Paths.docsStore is exported as a function', async () => {
    const { Paths } = await freshImport();
    expect(
      typeof (Paths as unknown as Record<string, unknown>).docsStore,
    ).toBe('function');
  });

  it('returns exactly path.join(Paths.docs(), "store")', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-home-sp003-t001';
    const { Paths } = await freshImport();
    expect(Paths.docsStore()).toBe(path.join(Paths.docs(), 'store'));
  });

  it('composes from Paths.docs() (no new XDG base introduced)', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-sp003-t001b';
    const { Paths } = await freshImport();
    expect(Paths.docsStore().startsWith(Paths.docs())).toBe(true);
    expect(Paths.docsStore()).toBe(
      path.join('/tmp/corpus-sp003-t001b', 'data', 'docs', 'store'),
    );
  });

  it('honors CORPUS_HOME override', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-sp003-t001c';
    const { Paths } = await freshImport();
    expect(Paths.docsStore()).toBe(
      path.join('/tmp/corpus-sp003-t001c', 'data', 'docs', 'store'),
    );
  });

  it('honors XDG_DATA_HOME when CORPUS_HOME unset', async () => {
    process.env.XDG_DATA_HOME = '/tmp/xdg-sp003-t001d';
    const { Paths } = await freshImport();
    expect(Paths.docsStore()).toBe(
      path.join('/tmp/xdg-sp003-t001d', 'llm-corpus', 'docs', 'store'),
    );
  });

  it('is idempotent across calls (same value, no side effects)', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-sp003-t001e';
    const { Paths } = await freshImport();
    const a = Paths.docsStore();
    const b = Paths.docsStore();
    expect(a).toBe(b);
  });

  it('is distinct from Paths.docs() (proper subdirectory)', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-sp003-t001f';
    const { Paths } = await freshImport();
    expect(Paths.docsStore()).not.toBe(Paths.docs());
    expect(Paths.docsStore().length).toBeGreaterThan(Paths.docs().length);
  });

  it('is distinct from inbox/pending/processed/failed (sibling subdirs under docs/)', async () => {
    process.env.CORPUS_HOME = '/tmp/corpus-sp003-t001g';
    const { Paths } = await freshImport();
    expect(Paths.docsStore()).not.toBe(Paths.inbox());
    expect(Paths.docsStore()).not.toBe(Paths.pending());
    expect(Paths.docsStore()).not.toBe(Paths.processed());
    expect(Paths.docsStore()).not.toBe(Paths.failed());
  });
});

async function freshImport(): Promise<typeof import('../../packages/contracts/src/paths.js')> {
  vi.resetModules();
  return (await import('../../packages/contracts/src/paths.js')) as typeof import('../../packages/contracts/src/paths.js');
}
