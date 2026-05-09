// T027 — Config loader for resource-related runtime knobs.
//
// References: plan.md Decision C, contracts/resource-recent.md §"Window size N",
// contracts.errors.ConfigurationError.
//
// SP-002 ships ONE config knob: [resources.recent].window_size. Defaults to
// 10; valid range [1, 100]. Out-of-range values throw ConfigurationError at
// boot — the server fails to start rather than starting with a bad config.
//
// Synchronous: config load is a boot-time gate; no Promise/Result type. If
// the file is unreadable for non-ENOENT reasons, the error propagates.

import * as fs from 'node:fs';
import * as TOML from '@iarna/toml';
import * as path from 'node:path';
import { Paths, ConfigurationError } from '@llm-corpus/contracts';

export interface ResourceConfig {
  recent: {
    window_size: number;
  };
}

const DEFAULT_RECENT_WINDOW_SIZE = 10;
const RECENT_WINDOW_SIZE_MIN = 1;
const RECENT_WINDOW_SIZE_MAX = 100;

/**
 * Load resource-related config from `Paths.config()/config.toml`.
 *
 * Defaults applied when:
 *   - The file does not exist (ENOENT) → return defaults
 *   - The file exists but does not contain `[resources.recent].window_size`
 *
 * Throws ConfigurationError when:
 *   - `window_size` is present but not an integer
 *   - `window_size` is outside [1, 100]
 */
export function loadResourceConfig(): ResourceConfig {
  const configPath = path.join(Paths.config(), 'config.toml');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { recent: { window_size: DEFAULT_RECENT_WINDOW_SIZE } };
    }
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigurationError({
      key: 'config.toml',
      reason: `failed to parse TOML: ${(err as Error).message ?? String(err)}`,
    });
  }

  const resources = parsed['resources'] as
    | { recent?: { window_size?: unknown } }
    | undefined;
  const recentSection = resources?.recent;
  const windowSize = recentSection?.window_size;

  if (windowSize === undefined || windowSize === null) {
    return { recent: { window_size: DEFAULT_RECENT_WINDOW_SIZE } };
  }

  if (typeof windowSize !== 'number' || !Number.isInteger(windowSize)) {
    throw new ConfigurationError({
      key: 'resources.recent.window_size',
      reason: `must be an integer (got ${typeof windowSize === 'number' ? windowSize : typeof windowSize})`,
    });
  }

  if (
    windowSize < RECENT_WINDOW_SIZE_MIN ||
    windowSize > RECENT_WINDOW_SIZE_MAX
  ) {
    throw new ConfigurationError({
      key: 'resources.recent.window_size',
      reason: `must be in [${RECENT_WINDOW_SIZE_MIN}, ${RECENT_WINDOW_SIZE_MAX}] (got ${windowSize})`,
    });
  }

  return { recent: { window_size: windowSize } };
}
