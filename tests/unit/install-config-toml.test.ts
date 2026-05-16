// SP-007 T024 — RED-phase contract test for `writeDefaultConfigToml`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { writeDefaultConfigToml } from '../../packages/cli/src/install-helpers/config-toml-writer.js';
import { Paths } from '@llm-corpus/contracts';

async function makeCorpusHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-config-'));
  process.env.CORPUS_HOME = dir;
  await fs.mkdir(Paths.config(), { recursive: true });
  await fs.mkdir(Paths.cache(), { recursive: true });
  return dir;
}

describe('SP-007 T024 — writeDefaultConfigToml', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('writes the default config when file does not exist', async () => {
    await makeCorpusHome();
    const r = await writeDefaultConfigToml({}, new AbortController().signal);
    expect(r.written).toBe(true);
    const body = await fs.readFile(Paths.configFile(), 'utf8');
    expect(body).toMatch(/\[classifier\]/);
    expect(body).toMatch(/model = "qwen3:8b"/);
    expect(body).toMatch(/\[embedder\]/);
    expect(body).toMatch(/\[search\]/);
  });

  it('preserves operator edits on idempotent re-run', async () => {
    await makeCorpusHome();
    await fs.writeFile(Paths.configFile(), '# operator-authored\n', 'utf8');
    let skipped = '';
    const r = await writeDefaultConfigToml(
      { onSkip: (m) => (skipped = m) },
      new AbortController().signal,
    );
    expect(r.written).toBe(false);
    expect(skipped).toMatch(/preserving operator edits/);
    expect(await fs.readFile(Paths.configFile(), 'utf8')).toBe(
      '# operator-authored\n',
    );
  });
});
