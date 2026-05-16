// SP-007 T030 — RED-phase contract test for `installAutoStartUnit`.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { installAutoStartUnit } from '../../packages/cli/src/install-helpers/auto-start-unit-installer.js';

async function tempdir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sp007-autostart-'));
  process.env.CORPUS_HOME = d;
  return d;
}

describe('SP-007 T030 — installAutoStartUnit', () => {
  beforeEach(() => {
    delete process.env.CORPUS_HOME;
  });

  it('Linux: writes systemd unit body; captures reverse_command', async () => {
    const d = await tempdir();
    const unit = path.join(d, 'systemd', 'corpus.service');
    const r = await installAutoStartUnit(
      '/abs/corpus',
      {
        platformOverride: 'linux',
        unitPathOverride: unit,
        skipUnitLoad: true,
      },
      new AbortController().signal,
    );
    expect(r.os).toBe('linux');
    expect(r.unit_path).toBe(unit);
    expect(r.reverse_command.cmd).toBe('systemctl');
    expect(r.reverse_command.args).toContain('disable');
    expect(r.reverse_command.args).toContain('corpus.service');
    const body = await fs.readFile(unit, 'utf8');
    expect(body).toMatch(/ExecStart=\/abs\/corpus daemon start/);
    expect(body).toMatch(/Restart=on-failure/);
    expect(body).toMatch(/WantedBy=default\.target/);
  });

  it('macOS: writes launchd plist; captures launchctl unload reverse_command', async () => {
    const d = await tempdir();
    const unit = path.join(d, 'launchd', 'io.llm-corpus.daemon.plist');
    const r = await installAutoStartUnit(
      '/abs/corpus',
      {
        platformOverride: 'darwin',
        unitPathOverride: unit,
        skipUnitLoad: true,
      },
      new AbortController().signal,
    );
    expect(r.os).toBe('macos');
    expect(r.reverse_command.cmd).toBe('launchctl');
    expect(r.reverse_command.args).toContain('unload');
    const body = await fs.readFile(unit, 'utf8');
    expect(body).toMatch(/<key>RunAtLoad<\/key>/);
    expect(body).toMatch(/<key>KeepAlive<\/key>/);
    expect(body).toMatch(/\/abs\/corpus/);
  });

  it('rejects conflict without --force-autostart', async () => {
    const d = await tempdir();
    const unit = path.join(d, 'corpus.service');
    await fs.writeFile(unit, 'pre-existing', 'utf8');
    await expect(
      installAutoStartUnit(
        '/abs/corpus',
        { unitPathOverride: unit, skipUnitLoad: true, platformOverride: 'linux' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it('--force-autostart overwrites existing unit file', async () => {
    const d = await tempdir();
    const unit = path.join(d, 'corpus.service');
    await fs.writeFile(unit, 'pre-existing', 'utf8');
    const r = await installAutoStartUnit(
      '/abs/corpus',
      {
        unitPathOverride: unit,
        skipUnitLoad: true,
        platformOverride: 'linux',
        forceAutostart: true,
      },
      new AbortController().signal,
    );
    expect(r.unit_path).toBe(unit);
    const body = await fs.readFile(unit, 'utf8');
    expect(body).toMatch(/ExecStart=/);
  });
});
