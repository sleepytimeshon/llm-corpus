// T019 (SP-004 US1) — Classifier prompt renderer contract test.
//
// Verifies renderClassifierPrompt(vocab, doc):
//   - Returns { systemMessage, userMessage } both strings.
//   - User message contains the comma-joined vocabulary domains AND tags.
//   - User message contains the document title + source + first-2000-cp body.
//   - Codepoint-safe truncation at 2000 — long bodies are bounded.
//   - Deterministic — identical inputs produce identical outputs.
//
// Spec references:
//   - specs/004-classifier/spec.md FR-CLASSIFY-006, FR-CLASSIFY-014,
//     FR-CLASSIFY-020
//   - specs/004-classifier/research.md Decision C, Decision H
//
// TDD: this test MUST FAIL before T032 (the implementation) lands.

import { describe, it, expect } from 'vitest';

function vocab(): {
  domains: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  types: ReadonlySet<string>;
  snapshot_id: string;
  loaded_at: string;
} {
  return {
    domains: new Set(['agent-systems', 'distributed-systems']),
    tags: new Set(['memory', 'retrieval', 'tutorial']),
    types: new Set(),
    snapshot_id: '11111111-1111-4111-8111-111111111111',
    loaded_at: '2026-05-13T10:00:00.000Z',
  };
}

describe('US1 — renderClassifierPrompt (contract)', () => {
  it('renderClassifierPrompt is exported from packages/inference', async () => {
    const mod = (await import(
      '../../packages/inference/src/prompt.js'
    )) as Record<string, unknown>;
    expect(typeof mod.renderClassifierPrompt).toBe('function');
  });

  it('returns { systemMessage, userMessage } both strings', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const { systemMessage, userMessage } = renderClassifierPrompt(vocab(), {
      title: 'A Tutorial on Agent Memory',
      sourcePath: '/inbox/foo.md',
      mimeType: 'text/markdown',
      body: 'The body of the document.',
    });
    expect(typeof systemMessage).toBe('string');
    expect(typeof userMessage).toBe('string');
    expect(systemMessage.length).toBeGreaterThan(0);
    expect(userMessage.length).toBeGreaterThan(0);
  });

  it('user message contains each established domain', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const { userMessage } = renderClassifierPrompt(vocab(), {
      title: 't',
      sourcePath: '/p',
      mimeType: 'text/markdown',
      body: 'b',
    });
    expect(userMessage).toContain('agent-systems');
    expect(userMessage).toContain('distributed-systems');
  });

  it('user message contains each established tag', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const { userMessage } = renderClassifierPrompt(vocab(), {
      title: 't',
      sourcePath: '/p',
      mimeType: 'text/markdown',
      body: 'b',
    });
    expect(userMessage).toContain('memory');
    expect(userMessage).toContain('retrieval');
    expect(userMessage).toContain('tutorial');
  });

  it('user message contains title + source + mime + body', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const { userMessage } = renderClassifierPrompt(vocab(), {
      title: 'Unique-Title-XYZ',
      sourcePath: '/abs/path/to/doc.md',
      mimeType: 'text/markdown',
      body: 'Unique-Body-Token-ABC.',
    });
    expect(userMessage).toContain('Unique-Title-XYZ');
    expect(userMessage).toContain('/abs/path/to/doc.md');
    expect(userMessage).toContain('text/markdown');
    expect(userMessage).toContain('Unique-Body-Token-ABC.');
  });

  it('truncates body to 2000 codepoints', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const longBody = 'x'.repeat(5000);
    const { userMessage } = renderClassifierPrompt(vocab(), {
      title: 't',
      sourcePath: '/p',
      mimeType: 'text/markdown',
      body: longBody,
    });
    // The body block in the prompt must contain at most 2000 x's, not 5000.
    const xRun = userMessage.match(/x+/g);
    if (xRun) {
      const longest = Math.max(...xRun.map((s) => s.length));
      expect(longest).toBeLessThanOrEqual(2000);
    }
  });

  it('is deterministic across two calls on identical input', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const v = vocab();
    const doc = {
      title: 't',
      sourcePath: '/p',
      mimeType: 'text/markdown',
      body: 'b',
    };
    const a = renderClassifierPrompt(v, doc);
    const b = renderClassifierPrompt(v, doc);
    expect(a.systemMessage).toBe(b.systemMessage);
    expect(a.userMessage).toBe(b.userMessage);
  });

  it('system message names the structured-output contract + classification rules', async () => {
    const { renderClassifierPrompt } = await import(
      '../../packages/inference/src/prompt.js'
    );
    const { systemMessage } = renderClassifierPrompt(vocab(), {
      title: 't',
      sourcePath: '/p',
      mimeType: 'text/markdown',
      body: 'b',
    });
    // The system message should reference the schema-output contract and
    // mention the facet_type 7-value enum (FR-CLASSIFY-014).
    expect(systemMessage.toLowerCase()).toMatch(/json|schema/);
    expect(systemMessage).toContain('facet_type');
  });
});
