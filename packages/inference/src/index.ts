// SP-004 US1 (T034) — Classifier-inference package entry point.
//
// References:
//   - specs/004-classifier/plan.md PREREQ-006
//   - specs/004-classifier/plan.md "Project Structure"
//
// Replaces the SP-001-era `export {};` stub. Re-exports the four SP-004
// inference primitives consumed by `packages/pipeline/src/classify-stage.ts`
// and by `packages/cli/src/reenrich-command.ts`.

export * from './ollama-adapter.js';
export * from './vocabulary.js';
export * from './prompt.js';
export * from './validate.js';
