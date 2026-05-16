// SP-007 T034 — `corpus init` preflight.
//
// References:
//   - specs/007-install-first-run/tasks.md T021 / T034
//   - specs/007-install-first-run/spec.md FR-INSTALL-003, SC-007-002,
//     SC-007-003, SC-007-004
//   - specs/007-install-first-run/contracts/adr-firewall-provisioning.md (ADR-013)
//   - specs/001-egress-hook/contracts/adr-001-firewall-path.md (ADR-001)
//   - Constitution Principle I (loopback-only egress; the one allowed
//     exception is the Ollama health probe at http://127.0.0.1:11434)
//   - Constitution Principle V (Zod boundaries)
//   - Constitution Principle VII (cancellable IO)
//   - Constitution Principle XIII (telemetry on every catch)
//
// Probes the four FR-INSTALL-003 preconditions: Node ≥ 18, Ollama loopback
// reachable, XDG bases writable, no partial-install debris.
//
// The only network call in SP-007 source is the Ollama loopback probe
// (eslint-disable-next-line below). The probe targets `127.0.0.1:11434`
// (loopback), so Principle I's "no outbound non-loopback" invariant holds.

/* eslint-disable-next-line llm-corpus/no-forbidden-network-imports
   -- Principle I loopback exception per ADR-001 §"loopback Ollama probe".
   The preflight Ollama-reachability GET is the ONLY annotated allowed
   network import in SP-007 source. */
import * as http from 'node:http';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  emitTelemetry,
  type InstallPreflightResult,
} from '@llm-corpus/contracts';

export interface PreflightDeps {
  /** Override for tests — supplied Ollama loopback URL. */
  ollamaUrl?: string;
  /** Override for tests — required model names. */
  requiredModels?: readonly string[];
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';
const DEFAULT_REQUIRED_MODELS = ['qwen3:8b', 'nomic-embed-text'] as const;

/**
 * Parse `process.versions.node` (e.g. `"20.18.1"`) and return its major
 * component. Returns -1 on parse failure (the preflight then treats as fail).
 */
function nodeMajor(version: string): number {
  const m = version.match(/^(\d+)\./);
  if (!m || m[1] === undefined) return -1;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : -1;
}

interface OllamaProbeResult {
  reachable: boolean;
  modelsLoaded: string[];
}

async function probeOllama(
  ollamaUrl: string,
  signal: AbortSignal,
): Promise<OllamaProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: OllamaProbeResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const onAbort = (): void => finish({ reachable: false, modelsLoaded: [] });
    if (signal.aborted) {
      finish({ reachable: false, modelsLoaded: [] });
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const req = http.get(ollamaUrl, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if ((res.statusCode ?? 0) !== 200) {
            finish({ reachable: false, modelsLoaded: [] });
            return;
          }
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(body) as {
              models?: { name?: string }[];
            };
            const names = Array.isArray(parsed.models)
              ? parsed.models
                  .map((m) => m.name)
                  .filter((n): n is string => typeof n === 'string')
              : [];
            finish({ reachable: true, modelsLoaded: names });
          } catch {
            finish({ reachable: false, modelsLoaded: [] });
          }
        });
        res.on('error', () => finish({ reachable: false, modelsLoaded: [] }));
      });
      req.on('error', () =>
        finish({ reachable: false, modelsLoaded: [] }),
      );
      req.setTimeout(3_000, () => {
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        finish({ reachable: false, modelsLoaded: [] });
      });
    } catch {
      finish({ reachable: false, modelsLoaded: [] });
    }
  });
}

function nameMatches(loaded: string, required: string): boolean {
  // Ollama tag-aware match: `qwen3:8b` matches both `qwen3:8b` and
  // `qwen3:8b-instruct`; `nomic-embed-text` matches `nomic-embed-text:latest`.
  if (loaded === required) return true;
  if (loaded.startsWith(required + ':')) return true;
  if (loaded.startsWith(required + '-')) return true;
  return false;
}

async function checkXdgWritable(): Promise<{
  writable: boolean;
  failedPath?: string;
}> {
  const bases = [Paths.config(), Paths.data(), Paths.state(), Paths.cache()];
  for (const base of bases) {
    try {
      await fs.mkdir(base, { recursive: true });
      await fs.access(base, fs.constants.W_OK);
    } catch {
      return { writable: false, failedPath: base };
    }
  }
  return { writable: true };
}

async function detectPartialInstall(): Promise<{
  partial: boolean;
  paths: string[];
}> {
  const xdgBases = [Paths.config(), Paths.data(), Paths.state(), Paths.cache()];
  const present: string[] = [];
  for (const base of xdgBases) {
    try {
      await fs.access(base);
      present.push(base);
    } catch {
      /* missing — fine */
    }
  }
  // A partial-install is XDG paths present AND no install-receipt.
  if (present.length === 0) return { partial: false, paths: [] };
  const receiptPath = path.join(Paths.state(), 'install-receipt.json');
  try {
    await fs.access(receiptPath);
    return { partial: false, paths: [] };
  } catch {
    return { partial: true, paths: present };
  }
}

/**
 * Run the four preflight checks; return the structured result. Caller
 * decides whether to halt (any field false → halt and emit
 * `install.preflight_failed`).
 */
export async function runInstallPreflight(
  deps: PreflightDeps,
  signal: AbortSignal,
): Promise<InstallPreflightResult> {
  const ollamaUrl = deps.ollamaUrl ?? DEFAULT_OLLAMA_URL;
  const requiredModels = deps.requiredModels ?? DEFAULT_REQUIRED_MODELS;

  const nodeVersion = process.versions.node;
  const node_ok = nodeMajor(nodeVersion) >= 18;
  const ollama = await probeOllama(ollamaUrl, signal);
  const ollamaModels = {
    classifier: ollama.modelsLoaded.some((m) =>
      nameMatches(m, requiredModels[0] ?? 'qwen3:8b'),
    ),
    embedder: ollama.modelsLoaded.some((m) =>
      nameMatches(m, requiredModels[1] ?? 'nomic-embed-text'),
    ),
  };
  const xdg = await checkXdgWritable();
  const partial = await detectPartialInstall();

  const result: InstallPreflightResult = {
    node_ok,
    node_version: nodeVersion,
    ollama_ok: ollama.reachable,
    ollama_models_pulled: ollamaModels,
    xdg_writable: xdg.writable,
    partial_install_detected: partial.partial,
    partial_install_paths: partial.paths,
  };

  // Emit `install.preflight_failed` events for each failure mode separately
  // (Constitution XIII — telemetry on every failure).
  if (!node_ok) {
    await emitTelemetry({
      event: 'install.preflight_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      unmet_requirement: 'node_version',
      details: { node_version: nodeVersion },
    });
  }
  if (!ollama.reachable) {
    await emitTelemetry({
      event: 'install.preflight_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      unmet_requirement: 'ollama_reachability',
    });
  } else if (!ollamaModels.classifier || !ollamaModels.embedder) {
    const missing: string[] = [];
    if (!ollamaModels.classifier) missing.push(requiredModels[0] ?? 'qwen3:8b');
    if (!ollamaModels.embedder) missing.push(requiredModels[1] ?? 'nomic-embed-text');
    await emitTelemetry({
      event: 'install.preflight_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      unmet_requirement: 'ollama_models',
      details: { missing_models: missing },
    });
  }
  if (!xdg.writable) {
    await emitTelemetry({
      event: 'install.preflight_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      unmet_requirement: 'xdg_writable',
    });
  }
  if (partial.partial) {
    await emitTelemetry({
      event: 'install.preflight_failed',
      timestamp: new Date().toISOString(),
      severity: 'error',
      outcome: 'failure',
      unmet_requirement: 'partial_install',
      details: { partial_install_paths: partial.paths.slice(0, 32) },
    });
  }

  return result;
}
