// SP-007 T085 — MCP server registers no new mutation surfaces in SP-007.
//
// Constitution III: SP-007 ships zero new MCP tools, prompts, or
// mutation-shaped resources. The substrate continues to expose the
// five SP-002+SP-006 read-only resources (`corpus://{manifest,taxonomy,
// recent,docs/{id},failures}`) and the single SP-001/005 `corpus.find`
// read-only tool. The `corpus init` install adds an MCP-CLIENT entry to
// `mcpServers.corpus`; that is a CLIENT-side registration, NOT a
// SERVER-side mutation surface.
//
// References:
//   - specs/007-install-first-run/tasks.md T085
//   - specs/007-install-first-run/spec.md FR-INSTALL-023, SC-007-027
//   - Constitution Principle III

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MCP_SERVER_PATH = 'packages/transport/src/mcp-server.ts';

const HANDLER_FILES = [
  'packages/transport/src/resource-manifest-handler.ts',
  'packages/transport/src/resource-taxonomy-handler.ts',
  'packages/transport/src/resource-recent-handler.ts',
  'packages/transport/src/resource-document-handler.ts',
  'packages/transport/src/failures-resource-handler.ts',
];

const EXPECTED_RESOURCES = [
  'corpus://manifest',
  'corpus://taxonomy',
  'corpus://recent',
  'corpus://docs/',
  'corpus://failures',
];

const EXPECTED_TOOL = 'corpus.find';

function readSource(rel: string): string {
  const p = path.join(process.cwd(), rel);
  return fs.readFileSync(p, 'utf8');
}

function readAllTransport(): string {
  return [MCP_SERVER_PATH, ...HANDLER_FILES].map(readSource).join('\n\n');
}

describe('SP-007 Phase 8 T085 — zero new MCP mutation surfaces', () => {
  const mcpSrc = readSource(MCP_SERVER_PATH);
  const allTransportSrc = readAllTransport();

  it('preserves exactly the five SP-002+SP-006 corpus:// resource registrations', () => {
    for (const uri of EXPECTED_RESOURCES) {
      expect(
        allTransportSrc.includes(uri),
        `transport layer must continue to register ${uri}`,
      ).toBe(true);
    }
    const found = new Set<string>();
    for (const match of allTransportSrc.matchAll(/corpus:\/\/[a-z0-9_-]+(\/?)?/g)) {
      found.add(match[0]);
    }
    const allowed = new Set([
      'corpus://manifest',
      'corpus://taxonomy',
      'corpus://recent',
      'corpus://docs',
      'corpus://docs/',
      'corpus://failures',
    ]);
    for (const uri of found) {
      expect(
        allowed.has(uri),
        `Unexpected MCP resource URI in transport sources for SP-007: ${uri}`,
      ).toBe(true);
    }
  });

  it('preserves exactly one tool registration: corpus.find', () => {
    expect(mcpSrc.includes(EXPECTED_TOOL)).toBe(true);
    const matches = Array.from(mcpSrc.matchAll(/server\.registerTool\(/g));
    expect(
      matches.length,
      `expected exactly one server.registerTool(...) call; got ${matches.length}`,
    ).toBe(1);
  });

  it('does not register any MCP prompts in SP-007', () => {
    expect(allTransportSrc.includes('server.prompt(')).toBe(false);
    expect(allTransportSrc.includes('server.registerPrompt(')).toBe(false);
  });

  it('does not introduce a new install/uninstall/taxonomy mutation surface', () => {
    expect(allTransportSrc.includes('corpus://install')).toBe(false);
    expect(allTransportSrc.includes('corpus://uninstall')).toBe(false);
    expect(allTransportSrc.includes('corpus://taxonomy/promote')).toBe(false);
    // corpus://taxonomy is the existing read-only resource (no slash-children).
  });

  it('zero new SP-007 banners in transport/ source', () => {
    const repo = process.cwd();
    const transportDir = path.join(repo, 'packages/transport/src');
    if (!fs.existsSync(transportDir)) return;
    const files = fs.readdirSync(transportDir);
    for (const f of files) {
      if (!f.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(transportDir, f), 'utf8');
      expect(
        /^\/\/\s*SP-007\b/m.test(src),
        `${f} carries an SP-007 banner — new transport mutation surface forbidden`,
      ).toBe(false);
    }
  });
});
