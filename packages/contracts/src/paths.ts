// T015 — Single XDG path resolver for the entire project.
// Constitution Principle XIV: All filesystem path references in this project
// MUST route through this module. Hardcoded path literals outside this file
// are rejected by the `paths-from-resolver-only` lint rule.
//
// Reference: ARCHITECTURE-FINAL §2.1.

import * as path from 'node:path';
import * as os from 'node:os';

const PROJECT_NAME = 'llm-corpus';

/**
 * Resolve the project root for one of the four XDG categories.
 *
 * Precedence (highest first):
 * 1. CORPUS_HOME (test/dev override) — `${CORPUS_HOME}/${category}`
 * 2. XDG_*_HOME env var — `${XDG}/llm-corpus`
 * 3. XDG default — `${HOME}/.local/share/llm-corpus` etc.
 */
function xdgRoot(
  category: 'data' | 'state' | 'config' | 'cache',
  envVar: string,
  defaultRel: readonly string[],
): string {
  const corpusHome = process.env.CORPUS_HOME;
  if (corpusHome && corpusHome.length > 0) {
    return path.join(corpusHome, category);
  }
  const xdg = process.env[envVar];
  if (xdg && xdg.length > 0) {
    return path.join(xdg, PROJECT_NAME);
  }
  return path.join(os.homedir(), ...defaultRel, PROJECT_NAME);
}

/**
 * The single resolver. All paths in this project compose from these four
 * base methods + the derived getters below. NEVER add a hardcoded path
 * literal outside this file (Constitution XIV).
 */
export const Paths = Object.freeze({
  // --- XDG base directories ---
  data: (): string => xdgRoot('data', 'XDG_DATA_HOME', ['.local', 'share']),
  state: (): string => xdgRoot('state', 'XDG_STATE_HOME', ['.local', 'state']),
  config: (): string => xdgRoot('config', 'XDG_CONFIG_HOME', ['.config']),
  cache: (): string => xdgRoot('cache', 'XDG_CACHE_HOME', ['.cache']),

  // --- Derived: state/ ---
  telemetry: (): string => path.join(Paths.state(), 'telemetry.jsonl'),
  drainLock: (): string => path.join(Paths.state(), 'drain.lock'),
  sourceIndex: (): string => path.join(Paths.state(), 'source-index.jsonl'),

  // --- Derived: data/ ---
  indexDb: (): string => path.join(Paths.data(), 'index.db'),
  taxonomy: (): string => path.join(Paths.data(), 'taxonomy.json'),
  catalog: (): string => path.join(Paths.data(), 'catalog.jsonl'),
  assets: (): string => path.join(Paths.data(), 'assets'),
  docs: (): string => path.join(Paths.data(), 'docs'),
  inbox: (): string => path.join(Paths.data(), 'docs', 'inbox'),
  pending: (): string => path.join(Paths.data(), 'docs', 'pending'),
  processed: (): string => path.join(Paths.data(), 'docs', 'processed'),
  failed: (): string => path.join(Paths.data(), 'docs', 'failed'),
  trash: (): string => path.join(Paths.data(), 'docs', 'trash'),

  // --- Derived: config/ ---
  configFile: (): string => path.join(Paths.config(), 'config.toml'),

  // --- Derived: cache/ ---
  extractCache: (): string => path.join(Paths.cache(), 'extract'),
} as const);

export type PathsType = typeof Paths;
