// T062 — Integration test: corpus://recent N-window configurability.
//
// References: FR-007, US3 AS1, plan.md Decision C.
//
// Default N=10; configurable via config.toml [resources.recent].window_size.
// Range [1, 100]; out-of-range values throw ConfigurationError.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildMcpServer } from '../../packages/transport/src/mcp-server.js';
import { registerRecentResource } from '../../packages/transport/src/resource-recent-handler.js';
import { loadFixture } from '../../packages/storage/src/fixtures.js';
import {
  ConfigurationError,
  Paths,
  RecentPayload,
} from '@llm-corpus/contracts';
import { loadResourceConfig } from '../../packages/storage/src/config-loader.js';

function writeConfigToml(home: string, body: string): void {
  const dir = path.join(home, 'config');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), body, 'utf8');
}

describe('corpus://recent N-window (T062 / FR-007 / Decision C)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let osTmpDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    osTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-recent-N-'));
    process.env.CORPUS_HOME = osTmpDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(osTmpDir, { recursive: true, force: true });
  });

  it('default N=10 returns 10 of 25 fixture entries', async () => {
    const handle = await loadFixture('recent-n-default', 'recent-25-success');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      const built = buildMcpServer({ ready: false });
      registerRecentResource(built);
      built.markReady();

      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);
      try {
        const result = await client.readResource({ uri: 'corpus://recent' });
        const payload = RecentPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        expect(payload.entries.length).toBe(10);
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });

  it('config.toml window_size=25 returns all 25 fixture entries', async () => {
    const handle = await loadFixture('recent-n-25', 'recent-25-success');
    try {
      process.env.CORPUS_HOME = handle.rootDir;
      writeConfigToml(
        handle.rootDir,
        '[resources.recent]\nwindow_size = 25\n',
      );
      const built = buildMcpServer({ ready: false });
      registerRecentResource(built);
      built.markReady();

      const [c, s] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'test-client', version: '0.0.0' },
        { capabilities: {} },
      );
      await Promise.all([built.server.connect(s), client.connect(c)]);
      try {
        const result = await client.readResource({ uri: 'corpus://recent' });
        const payload = RecentPayload.parse(
          JSON.parse(result.contents[0]!.text as string),
        );
        expect(payload.entries.length).toBe(25);
      } finally {
        await client.close();
        await built.server.close();
      }
    } finally {
      handle.cleanup();
    }
  });

  it('config.toml window_size=0 throws ConfigurationError at config load', () => {
    process.env.CORPUS_HOME = osTmpDir;
    writeConfigToml(osTmpDir, '[resources.recent]\nwindow_size = 0\n');
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });

  it('config.toml window_size=101 throws ConfigurationError at config load', () => {
    process.env.CORPUS_HOME = osTmpDir;
    writeConfigToml(osTmpDir, '[resources.recent]\nwindow_size = 101\n');
    expect(() => loadResourceConfig()).toThrow(ConfigurationError);
  });
});
