// T011 — Unit test for the Paths resolver (Constitution XIV).
// Verifies XDG resolution: env vars honored, defaults correct, CORPUS_HOME override,
// derived paths compose correctly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

const HOME = os.homedir();

describe('Paths (Constitution XIV — XDG resolution)', () => {
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

  describe('XDG defaults', () => {
    it('Paths.data() defaults to ~/.local/share/llm-corpus', async () => {
      const { Paths } = await freshImport();
      expect(Paths.data()).toBe(path.join(HOME, '.local', 'share', 'llm-corpus'));
    });

    it('Paths.state() defaults to ~/.local/state/llm-corpus', async () => {
      const { Paths } = await freshImport();
      expect(Paths.state()).toBe(path.join(HOME, '.local', 'state', 'llm-corpus'));
    });

    it('Paths.config() defaults to ~/.config/llm-corpus', async () => {
      const { Paths } = await freshImport();
      expect(Paths.config()).toBe(path.join(HOME, '.config', 'llm-corpus'));
    });

    it('Paths.cache() defaults to ~/.cache/llm-corpus', async () => {
      const { Paths } = await freshImport();
      expect(Paths.cache()).toBe(path.join(HOME, '.cache', 'llm-corpus'));
    });
  });

  describe('XDG env vars honored', () => {
    it('XDG_DATA_HOME overrides Paths.data()', async () => {
      process.env.XDG_DATA_HOME = '/tmp/xdg-data';
      const { Paths } = await freshImport();
      expect(Paths.data()).toBe(path.join('/tmp/xdg-data', 'llm-corpus'));
    });

    it('XDG_STATE_HOME overrides Paths.state()', async () => {
      process.env.XDG_STATE_HOME = '/tmp/xdg-state';
      const { Paths } = await freshImport();
      expect(Paths.state()).toBe(path.join('/tmp/xdg-state', 'llm-corpus'));
    });

    it('XDG_CONFIG_HOME overrides Paths.config()', async () => {
      process.env.XDG_CONFIG_HOME = '/tmp/xdg-config';
      const { Paths } = await freshImport();
      expect(Paths.config()).toBe(path.join('/tmp/xdg-config', 'llm-corpus'));
    });

    it('XDG_CACHE_HOME overrides Paths.cache()', async () => {
      process.env.XDG_CACHE_HOME = '/tmp/xdg-cache';
      const { Paths } = await freshImport();
      expect(Paths.cache()).toBe(path.join('/tmp/xdg-cache', 'llm-corpus'));
    });
  });

  describe('CORPUS_HOME override', () => {
    it('CORPUS_HOME overrides root for all four base dirs', async () => {
      process.env.CORPUS_HOME = '/tmp/corpus-home';
      const { Paths } = await freshImport();
      expect(Paths.data()).toBe(path.join('/tmp/corpus-home', 'data'));
      expect(Paths.state()).toBe(path.join('/tmp/corpus-home', 'state'));
      expect(Paths.config()).toBe(path.join('/tmp/corpus-home', 'config'));
      expect(Paths.cache()).toBe(path.join('/tmp/corpus-home', 'cache'));
    });

    it('CORPUS_HOME takes precedence over XDG vars', async () => {
      process.env.CORPUS_HOME = '/tmp/corpus-home';
      process.env.XDG_DATA_HOME = '/tmp/xdg-data';
      const { Paths } = await freshImport();
      expect(Paths.data()).toBe(path.join('/tmp/corpus-home', 'data'));
    });
  });

  describe('Derived paths', () => {
    it('indexDb composes from Paths.data()', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      expect(Paths.indexDb()).toBe(path.join('/tmp/h', 'data', 'index.db'));
    });

    it('telemetry composes from Paths.state()', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      expect(Paths.telemetry()).toBe(path.join('/tmp/h', 'state', 'telemetry.jsonl'));
    });

    it('drainLock composes from Paths.state()', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      expect(Paths.drainLock()).toBe(path.join('/tmp/h', 'state', 'drain.lock'));
    });

    it('configFile composes from Paths.config()', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      expect(Paths.configFile()).toBe(path.join('/tmp/h', 'config', 'config.toml'));
    });

    it('docs/inbox/pending/processed/failed/trash compose under data', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      const docs = path.join('/tmp/h', 'data', 'docs');
      expect(Paths.docs()).toBe(docs);
      expect(Paths.inbox()).toBe(path.join(docs, 'inbox'));
      expect(Paths.pending()).toBe(path.join(docs, 'pending'));
      expect(Paths.processed()).toBe(path.join(docs, 'processed'));
      expect(Paths.failed()).toBe(path.join(docs, 'failed'));
      expect(Paths.trash()).toBe(path.join(docs, 'trash'));
    });

    it('sourceIndex / taxonomy / catalog / extractCache / assets are defined', async () => {
      process.env.CORPUS_HOME = '/tmp/h';
      const { Paths } = await freshImport();
      expect(Paths.sourceIndex()).toBe(path.join('/tmp/h', 'state', 'source-index.jsonl'));
      expect(Paths.taxonomy()).toBe(path.join('/tmp/h', 'data', 'taxonomy.json'));
      expect(Paths.catalog()).toBe(path.join('/tmp/h', 'data', 'catalog.jsonl'));
      expect(Paths.extractCache()).toBe(path.join('/tmp/h', 'cache', 'extract'));
      expect(Paths.assets()).toBe(path.join('/tmp/h', 'data', 'assets'));
    });
  });

  describe('Paths object is frozen', () => {
    it('Paths is frozen — properties cannot be mutated', async () => {
      const { Paths } = await freshImport();
      expect(Object.isFrozen(Paths)).toBe(true);
    });
  });
});

// The Paths resolver reads env vars at call time (not at import time), so we
// don't actually need to reset the module cache between tests — but we
// resetModules() defensively so a future eager-evaluation refactor doesn't
// silently break this test surface.
async function freshImport(): Promise<typeof import('../../packages/contracts/src/paths.js')> {
  vi.resetModules();
  return (await import('../../packages/contracts/src/paths.js')) as typeof import('../../packages/contracts/src/paths.js');
}
