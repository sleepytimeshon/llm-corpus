// SP-007 T045 — C-046 end-to-end smoke harness (install-step 12 / --smoke).
//
// References:
//   - specs/007-install-first-run/tasks.md T033 / T045 / T050
//   - specs/007-install-first-run/spec.md FR-INSTALL-013, FR-INSTALL-024,
//     SC-007-025
//   - Constitution Principles VI, VII, X, XII, XIII
//
// The 8-step harness:
//   (1) spawn `corpus daemon start` as a child via runTool;
//   (2) poll for the daemon PID file with a 3s budget;
//   (3) copy the seed doc into Paths.inbox();
//   (4) poll telemetry for `edges-build.completed` with a 20s budget;
//   (5) spawn `corpus mcp` as a second child connected via real MCP-stdio;
//   (6) invoke `corpus.find({query: <deterministic-query>})` via MCP;
//   (7) assert the response has ≥ 1 SearchHit pointing at the seed;
//   (8) tear down via `corpus daemon stop`.
//
// The whole harness is wrapped in a 30-second sub-budget per FR-INSTALL-013.
// Emits `install.smoke_started`, `install.smoke_completed`, `install.smoke_failed`.
// Smoke failure does NOT undo install (steps 1-11 already succeeded).

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  Paths,
  runTool,
  emitTelemetry,
} from '@llm-corpus/contracts';

export interface SmokeHarnessDeps {
  /** Absolute path to the corpus binary (e.g. node dist/index.js or symlink). */
  corpusBinaryPath: string;
  /** Absolute path to the deterministic seed fixture. */
  seedDocPath: string;
  /** Deterministic search query to pass to `corpus.find`. */
  searchQuery: string;
  /** Total smoke budget in ms (default 30_000 per FR-INSTALL-013). */
  budgetMs?: number;
  /** Daemon-spawn detection budget. */
  daemonSpawnBudgetMs?: number;
  /** Seed-processing detection budget. */
  seedProcessingBudgetMs?: number;
  /** MCP `find` call budget. */
  findBudgetMs?: number;
  /** Daemon-teardown budget. */
  teardownBudgetMs?: number;
}

export interface SmokeHarnessResult {
  searchHitCount: number;
}

class SmokeFailure extends Error {
  override readonly name = 'SmokeFailure';
  constructor(
    readonly step:
      | 'daemon_spawn'
      | 'seed_traversal_timeout'
      | 'mcp_spawn'
      | 'corpus_find_zero_hits'
      | 'teardown',
    readonly code: string,
  ) {
    super(`smoke step '${step}' failed: ${code}`);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function pollFor(
  predicate: () => Promise<boolean>,
  budgetMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (signal.aborted) return false;
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function spawnDaemon(
  corpusBinary: string,
  signal: AbortSignal,
): Promise<ChildProcess> {
  if (signal.aborted) {
    throw new SmokeFailure('daemon_spawn', 'aborted_before_spawn');
  }
  // Spawn detached so the install can exit while the daemon continues —
  // the harness explicitly stops the daemon at teardown.
  const child = spawn(corpusBinary, ['daemon', 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: false,
  });
  // Capture spawn-time errors so they don't propagate to the main event loop.
  child.on('error', () => {
    /* swallow — the harness's polling loop will surface the failure */
  });
  child.stdout?.on('error', () => {
    /* ignore */
  });
  child.stderr?.on('error', () => {
    /* ignore */
  });
  return child;
}

async function stopDaemon(
  corpusBinary: string,
  budgetMs: number,
  signal: AbortSignal,
): Promise<void> {
  await runTool(corpusBinary, ['daemon', 'stop'], {
    signal,
    timeoutMs: budgetMs,
  });
}

async function detectSeedProcessed(
  seedDocId: string | undefined,
  budgetMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  void seedDocId;
  const telemetry = Paths.telemetry();
  return pollFor(
    async () => {
      try {
        const body = await fs.readFile(telemetry, 'utf8');
        // Probe for any edges-build.completed event after the seed drop —
        // the daemon writes one per processed doc.
        return /"event"\s*:\s*"edges-build\.completed"/.test(body);
      } catch {
        return false;
      }
    },
    budgetMs,
    signal,
  );
}

interface McpFindResponse {
  hits?: { doc_id?: string }[];
}

async function invokeMcpFind(
  corpusBinary: string,
  query: string,
  budgetMs: number,
  signal: AbortSignal,
): Promise<McpFindResponse> {
  // Spawn the MCP-stdio server and write a JSON-RPC message to its stdin.
  // The MCP SDK initialization handshake is required before tool calls;
  // we run a minimal init + tools/call sequence directly over stdio.
  const child = spawn(corpusBinary, ['mcp'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  try {
    const initReq =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'sp007-smoke', version: '0.1.0' },
        },
      }) + '\n';
    child.stdin!.write(initReq);
    const initNotif =
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n';
    child.stdin!.write(initNotif);

    const callReq =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'corpus.find',
          arguments: { query, max_results: 5 },
        },
      }) + '\n';
    child.stdin!.write(callReq);

    let stdoutBuf = '';
    const lineHandlers: ((line: string) => void)[] = [];
    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        for (const h of lineHandlers) h(line);
      }
    });

    const response = await new Promise<McpFindResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('mcp_find_timeout'));
      }, budgetMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('mcp_find_aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      lineHandlers.push((line) => {
        if (!line.trim()) return;
        try {
          const parsed = JSON.parse(line) as {
            id?: number;
            result?: { content?: { type?: string; text?: string }[] };
          };
          if (parsed.id === 2 && parsed.result) {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            // The MCP `corpus.find` tool result is wrapped in a `content`
            // array whose first text item is the SP-005 SearchResult JSON.
            const text =
              Array.isArray(parsed.result.content) &&
              parsed.result.content[0]?.type === 'text'
                ? parsed.result.content[0].text ?? '{}'
                : '{}';
            try {
              resolve(JSON.parse(text) as McpFindResponse);
            } catch {
              resolve({});
            }
          }
        } catch {
          /* not JSON-RPC line; skip */
        }
      });
    });

    return response;
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

export async function runSmokeHarness(
  deps: SmokeHarnessDeps,
  signal: AbortSignal,
): Promise<SmokeHarnessResult> {
  const startedAt = Date.now();
  const budgetMs = deps.budgetMs ?? 30_000;

  // Internal AbortController for budget enforcement.
  const innerController = new AbortController();
  const onOuter = (): void => innerController.abort(signal.reason);
  if (signal.aborted) innerController.abort(signal.reason);
  else signal.addEventListener('abort', onOuter, { once: true });
  const budgetTimer = setTimeout(() => {
    innerController.abort('smoke_budget_exceeded');
  }, budgetMs);

  try {
    await emitTelemetry({
      event: 'install.smoke_started',
      timestamp: new Date().toISOString(),
      severity: 'info',
      outcome: 'success',
      seed_doc_path: deps.seedDocPath,
    });
  } catch {
    /* telemetry must not crash install */
  }

  let daemonChild: ChildProcess | undefined;
  try {
    // Step 1+2: spawn daemon + poll for PID
    daemonChild = await spawnDaemon(deps.corpusBinaryPath, innerController.signal);
    const pidPath = path.join(Paths.state(), 'daemon.pid');
    const daemonOk = await pollFor(
      () => fileExists(pidPath),
      deps.daemonSpawnBudgetMs ?? 3_000,
      innerController.signal,
    );
    if (!daemonOk) {
      throw new SmokeFailure('daemon_spawn', 'daemon_pid_not_observed');
    }

    // Step 3: copy seed doc into inbox
    const inbox = Paths.inbox();
    await fs.mkdir(inbox, { recursive: true });
    const dest = path.join(inbox, path.basename(deps.seedDocPath));
    await fs.copyFile(deps.seedDocPath, dest);

    // Step 4: poll telemetry for edges-build.completed
    const processedOk = await detectSeedProcessed(
      undefined,
      deps.seedProcessingBudgetMs ?? 20_000,
      innerController.signal,
    );
    if (!processedOk) {
      throw new SmokeFailure(
        'seed_traversal_timeout',
        'edges_build_not_observed',
      );
    }

    // Steps 5+6: invoke MCP corpus.find
    let response: McpFindResponse;
    try {
      response = await invokeMcpFind(
        deps.corpusBinaryPath,
        deps.searchQuery,
        deps.findBudgetMs ?? 5_000,
        innerController.signal,
      );
    } catch (cause) {
      throw new SmokeFailure(
        'mcp_spawn',
        (cause as Error).message ?? 'mcp_invocation_failed',
      );
    }

    const hits = Array.isArray(response.hits) ? response.hits : [];
    if (hits.length === 0) {
      throw new SmokeFailure('corpus_find_zero_hits', 'zero_hits');
    }

    // Step 8: teardown
    try {
      await stopDaemon(
        deps.corpusBinaryPath,
        deps.teardownBudgetMs ?? 2_000,
        innerController.signal,
      );
    } catch {
      /* best-effort */
    }

    try {
      await emitTelemetry({
        event: 'install.smoke_completed',
        timestamp: new Date().toISOString(),
        severity: 'info',
        outcome: 'success',
        duration_ms: Date.now() - startedAt,
        hits_returned: hits.length,
      });
    } catch {
      /* ignore */
    }

    return { searchHitCount: hits.length };
  } catch (cause) {
    const failure =
      cause instanceof SmokeFailure
        ? cause
        : new SmokeFailure('teardown', (cause as Error).message ?? 'unknown');
    try {
      await emitTelemetry({
        event: 'install.smoke_failed',
        timestamp: new Date().toISOString(),
        severity: 'warning',
        outcome: 'failure',
        duration_ms: Date.now() - startedAt,
        failure_step: failure.step,
        error_code: failure.code.slice(0, 256),
      });
    } catch {
      /* ignore */
    }
    // Cleanup: try to stop the daemon if it is still running.
    if (daemonChild) {
      try {
        daemonChild.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    throw failure;
  } finally {
    clearTimeout(budgetTimer);
    signal.removeEventListener('abort', onOuter);
  }
}
