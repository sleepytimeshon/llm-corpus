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

/**
 * SP-003 ingest-pipeline configuration knobs read from `[ingest]` section of
 * config.toml. See specs/003-ingest-pipeline/data-model.md §"Validation Gate
 * Config" and plan.md Decisions E-I.
 */
export interface IngestConfig {
  /** Validation gate per-file size cap, megabytes. Default 100. Range [1, 1024]. */
  maxFileSizeMb: number;
  /** Per-doc timeout under interactivePolicy, milliseconds. Default 60_000. */
  perDocTimeoutMs: number;
  /** Per-doc timeout under batchPolicy, milliseconds. Default 300_000. */
  batchPerDocTimeoutMs: number;
}

const DEFAULT_RECENT_WINDOW_SIZE = 10;
const RECENT_WINDOW_SIZE_MIN = 1;
const RECENT_WINDOW_SIZE_MAX = 100;

const DEFAULT_INGEST_MAX_FILE_SIZE_MB = 100;
const INGEST_MAX_FILE_SIZE_MB_MIN = 1;
const INGEST_MAX_FILE_SIZE_MB_MAX = 1024;
const DEFAULT_INGEST_PER_DOC_TIMEOUT_MS = 60_000;
const DEFAULT_INGEST_BATCH_PER_DOC_TIMEOUT_MS = 300_000;
const INGEST_TIMEOUT_MS_MIN = 1000;

// SP-006 [search] section defaults + bounds.
const DEFAULT_SEARCH_MIN_RESULTS = 3;
const SEARCH_MIN_RESULTS_MIN = 0;
const SEARCH_MIN_RESULTS_MAX = 100;
const DEFAULT_SEARCH_TIER_TOTAL_BUDGET_MS = 600;
const SEARCH_TIER_TOTAL_BUDGET_MS_MIN = 50;
const SEARCH_TIER_TOTAL_BUDGET_MS_MAX = 30_000;

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

/**
 * Load SP-003 ingest-pipeline config from `Paths.config()/config.toml`
 * `[ingest]` section. Defaults applied for any missing key. Out-of-range
 * values throw ConfigurationError at boot.
 *
 * Defaults applied when:
 *   - The file does not exist (ENOENT)
 *   - The `[ingest]` section is missing
 *   - Any individual key is missing
 *
 * Throws ConfigurationError when:
 *   - `max_file_size_mb` is not an integer in [1, 1024]
 *   - `per_doc_timeout_ms` is not an integer ≥ 1000
 *   - `batch_per_doc_timeout_ms` is not an integer ≥ 1000
 */
export function loadIngestConfig(): IngestConfig {
  const configPath = path.join(Paths.config(), 'config.toml');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultIngestConfig();
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

  const ingestSection = parsed['ingest'] as
    | {
        max_file_size_mb?: unknown;
        per_doc_timeout_ms?: unknown;
        batch_per_doc_timeout_ms?: unknown;
      }
    | undefined;
  if (!ingestSection) {
    return defaultIngestConfig();
  }

  const maxFileSizeMb = validateInt(
    ingestSection.max_file_size_mb,
    'ingest.max_file_size_mb',
    DEFAULT_INGEST_MAX_FILE_SIZE_MB,
    INGEST_MAX_FILE_SIZE_MB_MIN,
    INGEST_MAX_FILE_SIZE_MB_MAX,
  );
  const perDocTimeoutMs = validateInt(
    ingestSection.per_doc_timeout_ms,
    'ingest.per_doc_timeout_ms',
    DEFAULT_INGEST_PER_DOC_TIMEOUT_MS,
    INGEST_TIMEOUT_MS_MIN,
    Number.MAX_SAFE_INTEGER,
  );
  const batchPerDocTimeoutMs = validateInt(
    ingestSection.batch_per_doc_timeout_ms,
    'ingest.batch_per_doc_timeout_ms',
    DEFAULT_INGEST_BATCH_PER_DOC_TIMEOUT_MS,
    INGEST_TIMEOUT_MS_MIN,
    Number.MAX_SAFE_INTEGER,
  );

  return { maxFileSizeMb, perDocTimeoutMs, batchPerDocTimeoutMs };
}

function defaultIngestConfig(): IngestConfig {
  return {
    maxFileSizeMb: DEFAULT_INGEST_MAX_FILE_SIZE_MB,
    perDocTimeoutMs: DEFAULT_INGEST_PER_DOC_TIMEOUT_MS,
    batchPerDocTimeoutMs: DEFAULT_INGEST_BATCH_PER_DOC_TIMEOUT_MS,
  };
}

/**
 * SP-006 [search] config knobs. Reads `[search].min_results` and
 * `[search].tier_total_budget_ms` from config.toml; unknown keys inside
 * `[search]` are ignored (forward-compat).
 *
 * Defaults applied when:
 *   - The file does not exist (ENOENT)
 *   - The `[search]` section is missing
 *   - Any individual key is missing
 *
 * Throws ConfigurationError when:
 *   - `min_results` is not an integer in [0, 100]
 *   - `tier_total_budget_ms` is not an integer in [50, 30_000]
 */
export interface SearchConfig {
  /** Min results across the tier cascade before falling through. */
  min_results: number;
  /** Aggregate cascade wall-clock budget in milliseconds. */
  tier_total_budget_ms: number;
}

export function loadSearchConfig(): SearchConfig {
  const configPath = path.join(Paths.config(), 'config.toml');
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultSearchConfig();
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

  const searchSection = parsed['search'] as
    | {
        min_results?: unknown;
        tier_total_budget_ms?: unknown;
      }
    | undefined;
  if (!searchSection) {
    return defaultSearchConfig();
  }

  const minResults = validateInt(
    searchSection.min_results,
    'search.min_results',
    DEFAULT_SEARCH_MIN_RESULTS,
    SEARCH_MIN_RESULTS_MIN,
    SEARCH_MIN_RESULTS_MAX,
  );
  const tierTotalBudgetMs = validateInt(
    searchSection.tier_total_budget_ms,
    'search.tier_total_budget_ms',
    DEFAULT_SEARCH_TIER_TOTAL_BUDGET_MS,
    SEARCH_TIER_TOTAL_BUDGET_MS_MIN,
    SEARCH_TIER_TOTAL_BUDGET_MS_MAX,
  );

  return { min_results: minResults, tier_total_budget_ms: tierTotalBudgetMs };
}

function defaultSearchConfig(): SearchConfig {
  return {
    min_results: DEFAULT_SEARCH_MIN_RESULTS,
    tier_total_budget_ms: DEFAULT_SEARCH_TIER_TOTAL_BUDGET_MS,
  };
}

function validateInt(
  value: unknown,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ConfigurationError({
      key,
      reason: `must be an integer (got ${typeof value === 'number' ? value : typeof value})`,
    });
  }
  if (value < min || value > max) {
    throw new ConfigurationError({
      key,
      reason: `must be in [${min}, ${max}] (got ${value})`,
    });
  }
  return value;
}
