// T058 (SP-006 Phase 6) — MCP server registers no new mutation surfaces.
//
// Constitution III: the substrate exposes ONLY read-only MCP resources +
// one read-only `corpus.find` tool. SP-006 may not introduce any new MCP
// tool, prompt, or mutation-shaped resource.
//
// This test grep-scans `packages/transport/src/mcp-server.ts` for the
// FIVE expected `corpus://*` resource registrations and the SINGLE
// `corpus.find` tool registration. Any deviation (e.g. a new tool or a
// rogue `corpus://recovery`) hard-fails CI.
//
// References:
//   - specs/006-hardening/tasks.md T058
//   - specs/006-hardening/spec.md FR-HARDEN-024, SC-HARDEN-016
//   - Constitution Principle III

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MCP_SERVER_PATH = 'packages/transport/src/mcp-server.ts';
// Resource URIs live in the handler files (they're the registrants); the
// mcp-server orchestrates the registration helpers but does not embed the
// URI literals itself. T058 verifies the cross-file invariant.
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
  'corpus://docs/', // template — `corpus://docs/{id}`
  'corpus://failures',
];

const EXPECTED_TOOL = 'corpus.find';

function readSource(rel: string): string {
  const p = path.join(process.cwd(), rel);
  return fs.readFileSync(p, 'utf8');
}

function readAll(): string {
  return [MCP_SERVER_PATH, ...HANDLER_FILES].map(readSource).join('\n\n');
}

describe('Phase 6 — SP-006 MCP server has no new mutation surfaces (T058)', () => {
  const mcpSrc = readSource(MCP_SERVER_PATH);
  const allTransportSrc = readAll();

  it('registers exactly the five expected `corpus://` resource registrations across transport handlers', () => {
    for (const uri of EXPECTED_RESOURCES) {
      expect(
        allTransportSrc.includes(uri),
        `transport layer must register ${uri}`,
      ).toBe(true);
    }
    // Sanity: collect every `corpus://...` URI literal across the transport
    // sources. Allow only the five enumerated above (plus the docs template
    // form).
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
        `Unexpected MCP resource URI in transport sources: ${uri}`,
      ).toBe(true);
    }
  });

  it('registers exactly one tool: corpus.find (mcp-server.ts)', () => {
    expect(mcpSrc.includes(EXPECTED_TOOL)).toBe(true);
    // Tool registrations route through `server.registerTool(...)`. We expect
    // the registerTool() helper to be invoked exactly once over the file.
    const matches = Array.from(mcpSrc.matchAll(/server\.registerTool\(/g));
    expect(
      matches.length,
      `expected exactly one server.registerTool(...) call; got ${matches.length}`,
    ).toBe(1);
  });

  it('does not register any MCP prompts (SP-006 does not introduce prompt surfaces)', () => {
    // The MCP SDK exposes `server.prompt(...)` and `server.registerPrompt(...)`
    // — neither should appear in our transport package.
    expect(allTransportSrc.includes('server.prompt(')).toBe(false);
    expect(allTransportSrc.includes('server.registerPrompt(')).toBe(false);
  });

  it('does not introduce a `corpus://recovery` resource (out of scope per tasks.md anti-claims)', () => {
    expect(allTransportSrc.includes('corpus://recovery')).toBe(false);
  });
});
