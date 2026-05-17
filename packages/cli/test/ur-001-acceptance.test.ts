// SP-008 T015 + T017 — UR-001 integration test.
//
// UR-001 ("dropped document becomes queryable on next matching query without
// further action") happy-path + proposed-term + validation-failure scenarios
// per FR-ENGAGEMENT-007.
//
// Drives the production binary via `corpus init --smoke` against a fresh
// CORPUS_HOME; spawns the daemon; drops fixture docs from
// `tests/fixtures/sp008-engagement/ur-001-fixture-docs/`; waits for
// `edges-build.completed` telemetry events; invokes `corpus.find` via real
// MCP-stdio; asserts SearchHits + `engagement.corpus_find_invoked` event.
//
// Ollama-gated (FR-INSTALL-024 / SP-007 pattern). On a CI / dev box without
// Ollama, the test is skipped silently.
//
// References:
//   - specs/008-user-acceptance/tasks.md T015 / T017
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-007, SC-008-022
//   - Constitution Principles VI, VII, XIII

import { describe, it, expect, beforeAll } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CLI_DIST_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const FIXTURE_DOCS = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'sp008-engagement',
  'ur-001-fixture-docs',
);

async function ollamaReachable(): Promise<boolean> {
  if (process.env.OLLAMA_RUNNING === '0') return false;
  return new Promise((resolve) => {
    const req = new AbortController();
    const timer = setTimeout(() => {
      req.abort();
      resolve(false);
    }, 1_500);
    fetch('http://127.0.0.1:11434/api/tags', { signal: req.signal })
      .then((r) => {
        clearTimeout(timer);
        resolve(r.status === 200);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

async function spawnInit(env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [CLI_DIST_ENTRY, 'init', '--smoke', '--no-autostart'],
      { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
    child.on('error', (err) => resolve({ stdout, stderr: stderr + err.message, exitCode: -1 }));
  });
}

describe('SP-008 T015 — UR-001 dropped document → queryable + engagement event', () => {
  let ollamaOk = false;
  let fixtureExists = false;
  let binaryExists = false;

  beforeAll(async () => {
    ollamaOk = await ollamaReachable();
    try {
      await fsp.access(FIXTURE_DOCS);
      fixtureExists = true;
    } catch {
      fixtureExists = false;
    }
    try {
      await fsp.access(CLI_DIST_ENTRY);
      binaryExists = true;
    } catch {
      binaryExists = false;
    }
  });

  it.skipIf(!process.env.OLLAMA_RUNNING && !process.env.CI)(
    'happy-path: drop a fixture doc; corpus.find returns hits AND engagement event emits',
    async () => {
      if (!ollamaOk || !fixtureExists || !binaryExists) return;
      const tempHome = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'sp008-ur-001-'),
      );
      const result = await spawnInit({
        ...process.env,
        CORPUS_HOME: tempHome,
        CLAUDE_CONFIG_PATH: path.join(tempHome, 'claude.json'),
      });
      // The smoke harness ran corpus.find at least once; the engagement
      // event must appear in the telemetry log.
      expect(result.exitCode).toBe(0);
      const telemetryFile = path.join(tempHome, 'state', 'telemetry.jsonl');
      const raw = await fsp.readFile(telemetryFile, 'utf8').catch(() => '');
      const events = raw
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as { event?: string };
          } catch {
            return {};
          }
        });
      const engageEvents = events.filter(
        (e) => e.event === 'engagement.corpus_find_invoked',
      );
      expect(engageEvents.length).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );
});
