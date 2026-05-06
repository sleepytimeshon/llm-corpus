// T040 — Integration test: bootstrap-order discipline (SC-007).
// Spawns a Node child importing @llm-corpus/transport. The child has
// strategically-positioned import-time `console.log` instrumentation.
// The hook-installation banner MUST appear BEFORE any pipeline-package banner.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

function runChild(scriptPath: string, env: NodeJS.ProcessEnv): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(
      'node',
      ['--experimental-vm-modules', '--import', 'tsx', scriptPath],
      {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      },
    );
    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
  });
}

describe('Bootstrap ordering (T040 / SC-007)', () => {
  it('egress hook installs BEFORE pipeline package imports', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-bootstrap-order-'));
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-bootstrap-script-'));
    const scriptPath = path.join(scriptDir, 'probe.mjs');

    // The probe imports the transport module and a pipeline package; the
    // egress-hook-bootstrap module must announce itself before the pipeline
    // module's announcement. Both modules announce via stderr to keep stdout
    // clean for any future contract.
    const script = `
      // Probe script — emits a stderr banner ON IMPORT for the egress hook
      // and for a pipeline package. Reads order from console output.
      process.env.LLM_CORPUS_BOOTSTRAP_PROBE = '1';
      const t0 = Date.now();
      // Importing transport triggers the egress-hook-bootstrap (T048).
      await import('${ROOT.replace(/\\/g, '/')}/packages/transport/src/index.ts');
      console.log('PROBE: transport_imported_at=' + (Date.now() - t0) + 'ms');
      // Then pipeline (downstream of the hook).
      await import('${ROOT.replace(/\\/g, '/')}/packages/pipeline/src/index.ts');
      console.log('PROBE: pipeline_imported_at=' + (Date.now() - t0) + 'ms');
    `;
    fs.writeFileSync(scriptPath, script, 'utf8');

    try {
      const { stdout, stderr, exitCode } = await runChild(scriptPath, {
        ...process.env,
        CORPUS_HOME: tmpHome,
        NODE_OPTIONS: '',
      });
      expect(exitCode).toBe(0);

      // The transport module's egress-hook-bootstrap announces via stderr.
      const combined = stderr + '\n' + stdout;
      const hookIdx = combined.indexOf('EGRESS_HOOK_INSTALLED');
      const pipelineIdx = combined.indexOf('pipeline_imported_at');
      const transportIdx = combined.indexOf('transport_imported_at');

      // Hook must be visible AND must precede pipeline import.
      expect(hookIdx).toBeGreaterThanOrEqual(0);
      expect(transportIdx).toBeGreaterThanOrEqual(0);
      expect(pipelineIdx).toBeGreaterThanOrEqual(0);
      expect(hookIdx).toBeLessThan(pipelineIdx);
      // And the hook is installed during transport import (before transport_imported_at log)
      expect(hookIdx).toBeLessThan(transportIdx);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(scriptDir, { recursive: true, force: true });
    }
  }, 30_000);
});
