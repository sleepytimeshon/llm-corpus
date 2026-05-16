// SP-007 T021 — RED-phase contract test for `runInstallPreflight`.
//
// References: tasks.md T021 / T034 — spec.md FR-INSTALL-003

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstallPreflight } from '../../packages/cli/src/install-helpers/preflight.js';
import {
  InstallPreflightResultZodSchema,
  Paths,
} from '@llm-corpus/contracts';

async function makeCorpusHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-preflight-'));
  process.env.CORPUS_HOME = dir;
  return dir;
}

describe('SP-007 T021 — runInstallPreflight', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('returns a Zod-validated InstallPreflightResult', async () => {
    await makeCorpusHome();
    const result = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: ['x', 'y'] },
      new AbortController().signal,
    );
    const parsed = InstallPreflightResultZodSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.node_version).toBe(process.versions.node);
  });

  it('node_ok=true on current process (Node 20+ build runtime)', async () => {
    await makeCorpusHome();
    const r = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: [] },
      new AbortController().signal,
    );
    expect(r.node_ok).toBe(true);
  });

  it('ollama_ok=false on connect-refused (port 1 is unreachable)', async () => {
    await makeCorpusHome();
    const r = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: [] },
      new AbortController().signal,
    );
    expect(r.ollama_ok).toBe(false);
    expect(r.ollama_models_pulled.classifier).toBe(false);
    expect(r.ollama_models_pulled.embedder).toBe(false);
  });

  it('partial_install_detected=true when XDG present + no install-receipt', async () => {
    const home = await makeCorpusHome();
    // Create partial debris: XDG bases exist, no install-receipt.
    await fs.mkdir(Paths.state(), { recursive: true });
    await fs.mkdir(Paths.data(), { recursive: true });
    const r = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: [] },
      new AbortController().signal,
    );
    expect(r.partial_install_detected).toBe(true);
    expect(r.partial_install_paths.length).toBeGreaterThan(0);
    void home;
  });

  it('partial_install_detected=false when install-receipt present', async () => {
    await makeCorpusHome();
    await fs.mkdir(Paths.state(), { recursive: true });
    await fs.writeFile(
      path.join(Paths.state(), 'install-receipt.json'),
      '{"schema_version":1}',
      'utf8',
    );
    const r = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: [] },
      new AbortController().signal,
    );
    expect(r.partial_install_detected).toBe(false);
  });

  it('xdg_writable=true on a fresh CORPUS_HOME tempdir', async () => {
    await makeCorpusHome();
    const r = await runInstallPreflight(
      { ollamaUrl: 'http://127.0.0.1:1/__never__', requiredModels: [] },
      new AbortController().signal,
    );
    expect(r.xdg_writable).toBe(true);
  });
});
