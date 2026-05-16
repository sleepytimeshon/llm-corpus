// SP-007 T037 — Default `config.toml` writer (install-step 5).
//
// References:
//   - specs/007-install-first-run/tasks.md T024 / T037
//   - specs/007-install-first-run/spec.md FR-INSTALL-007, SC-007-008
//   - specs/007-install-first-run/research.md Decision C
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - Constitution Principles V, VIII (atomic write), X (idempotent)
//
// On absent file: write the minimal Decision C config atomically via
// `withTempDir` + fs.rename. On present file: preserve operator edits;
// return `{written: false}` so the install-receipt can record the choice
// (so uninstall doesn't delete an operator-authored file).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Paths, withTempDir } from '@llm-corpus/contracts';

export interface ConfigTomlWriterDeps {
  /** Optional override for tests — alternate config body. */
  bodyOverride?: string;
  /** Optional debug-log sink for the idempotent-skip branch. */
  onSkip?: (msg: string) => void;
}

/**
 * The minimal default config per research.md Decision C. Comments survive
 * the TOML parser; values are SP-001..SP-006 defaults baked in.
 */
const DEFAULT_CONFIG_TOML = `# llm-corpus config.toml — written at install by \`corpus init\`.
# Operator-editable. Re-running \`corpus init\` will NOT overwrite this file.
# Reference: research.md Decision C.

[classifier]
model = "qwen3:8b"

[embedder]
model = "nomic-embed-text"

[search]
min_results = 3
tier_total_budget_ms = 600

[ingest]
# max_doc_size_bytes inherits the SP-003 substrate default.

[telemetry]
# rotate_at_bytes inherits the SP-003 substrate default.

# [ranker.confidence_weights]
# Defaults live in packages/index/src/confidence-adapter.ts
# DEFAULT_CONFIDENCE_WEIGHTS. Override here to tune.
# research-paper = 1.20
# manual         = 1.10
# form           = 1.10
# reference      = 1.10
# book           = 1.05
# article        = 1.00
# notes          = 0.95
# transcript     = 0.90
# podcast        = 0.90
# video          = 0.90
`;

export async function writeDefaultConfigToml(
  deps: ConfigTomlWriterDeps,
  signal: AbortSignal,
): Promise<{ written: boolean }> {
  if (signal.aborted) return { written: false };
  const target = Paths.configFile();
  try {
    await fs.access(target);
    // Already exists — preserve operator edits.
    deps.onSkip?.(`config.toml exists at ${target}; preserving operator edits`);
    return { written: false };
  } catch {
    /* fall through to write */
  }

  // Ensure parent dir exists (defense — should be true after xdg_bringup).
  await fs.mkdir(path.dirname(target), { recursive: true });

  const body = deps.bodyOverride ?? DEFAULT_CONFIG_TOML;
  await withTempDir(
    async (dir) => {
      const tmp = path.join(dir, 'config.toml');
      await fs.writeFile(tmp, body, 'utf8');
      await fs.rename(tmp, target);
    },
    { signal, namespace: 'sp007-config-toml' },
  );
  return { written: true };
}
