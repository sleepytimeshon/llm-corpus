// T017 — Unit test: loadResourceConfig() reads config.toml.
//
// References: plan.md Decision C, contracts/resource-recent.md §"Window size N",
// errors.ts ConfigurationError.
//
// Coverage:
//   - Missing config file → defaults to {recent: {window_size: 10}}
//   - Parses [resources.recent] window_size = N
//   - Validates N ∈ [1, 100]; throws ConfigurationError on out-of-range
//   - Synchronous — no Promise/Result; bad config = boot failure

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { loadResourceConfig } from '../../packages/storage/src/config-loader.js';
// Import from the same package-resolved path as the implementation so the
// `instanceof ConfigurationError` check uses the same class identity.
import { ConfigurationError } from '@llm-corpus/contracts';

describe('loadResourceConfig() (T017, plan.md Decision C)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'corpus-config-loader-'),
    );
    process.env.CORPUS_HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, 'config'), { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns default {recent: {window_size: 10}} when config file is absent', () => {
    const cfg = loadResourceConfig();
    expect(cfg.recent.window_size).toBe(10);
  });

  it('parses [resources.recent] window_size = N', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 25\n`,
    );
    const cfg = loadResourceConfig();
    expect(cfg.recent.window_size).toBe(25);
  });

  it('falls back to default 10 when [resources.recent] is missing', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[some_other_section]\nkey = "value"\n`,
    );
    const cfg = loadResourceConfig();
    expect(cfg.recent.window_size).toBe(10);
  });

  it('throws ConfigurationError when window_size = 0 (out of range)', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 0\n`,
    );
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when window_size = 101 (out of range)', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 101\n`,
    );
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError on negative window_size', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = -1\n`,
    );
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError on non-integer window_size', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 1.5\n`,
    );
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });

  it('accepts boundary values 1 and 100', () => {
    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 1\n`,
    );
    expect(loadResourceConfig().recent.window_size).toBe(1);

    fs.writeFileSync(
      path.join(tmpHome, 'config', 'config.toml'),
      `[resources.recent]\nwindow_size = 100\n`,
    );
    expect(loadResourceConfig().recent.window_size).toBe(100);
  });
});
