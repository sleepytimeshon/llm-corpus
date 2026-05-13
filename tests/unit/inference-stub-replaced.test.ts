// T007 (SP-004 PREREQ-006) — Verify packages/inference is no longer the
// SP-001-era `export {};` stub. SP-004 grows this package to a functional
// classifier-inference layer with four exports:
//
//   - OllamaAdapter
//   - loadEstablishedVocabulary
//   - renderClassifierPrompt
//   - validateClassifierOutput
//
// Spec references:
//   - specs/004-classifier/plan.md PREREQ-006

import { describe, it, expect } from 'vitest';

describe('PREREQ-006 — packages/inference exports SP-004 surface', () => {
  it('OllamaAdapter is exported', async () => {
    const mod = (await import('@llm-corpus/inference')) as Record<
      string,
      unknown
    >;
    expect(typeof mod.OllamaAdapter).toBe('function');
  });

  it('loadEstablishedVocabulary is exported', async () => {
    const mod = (await import('@llm-corpus/inference')) as Record<
      string,
      unknown
    >;
    expect(typeof mod.loadEstablishedVocabulary).toBe('function');
  });

  it('renderClassifierPrompt is exported', async () => {
    const mod = (await import('@llm-corpus/inference')) as Record<
      string,
      unknown
    >;
    expect(typeof mod.renderClassifierPrompt).toBe('function');
  });

  it('validateClassifierOutput is exported', async () => {
    const mod = (await import('@llm-corpus/inference')) as Record<
      string,
      unknown
    >;
    expect(typeof mod.validateClassifierOutput).toBe('function');
  });
});
