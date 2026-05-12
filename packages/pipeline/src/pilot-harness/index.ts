// SP-000-Lite Phase 1 (T005) — pilot-harness library placeholder.
//
// Phase 1 is workspace plumbing only — NO behavior yet. Phase 3 (T018–T026)
// implements the stratification linter, event constructor, summary builder,
// and harness driver. Phase 2 (T010–T017) authors the contract tests that
// constrain those implementations.
//
// Constitution XI: this library-layer entry point exports types only at this
// stage. The CLI boundary (`packages/cli/src/pilot/command.ts`) is the only
// site that may call `process.exit`. Library functions added in Phase 3 will
// return `Result<T, E>` per `@llm-corpus/contracts/result`.
//
// Spec references:
//   - specs/000-nfr-008-pilot-lite/tasks.md T005
//   - specs/000-nfr-008-pilot-lite/plan.md "Project Structure"
//   - .product/ADRs/ADR-010-sp000-lite-supersedes-005.md

/** Pilot run iteration count. ADR-010: only 1 or 2 are permitted. */
export type PilotIteration = 1 | 2;

/**
 * Phase-3 placeholder kept for backwards compatibility with Phase 1's CLI
 * stub. The concrete options surface for `runPilot` lives on
 * `RunPilotOptions` in `./driver.ts` and is re-exported below.
 */
export interface PilotRunOptions {
  readonly variant: string;
  readonly iteration: PilotIteration;
  readonly signal: AbortSignal;
}

// --- Phase 3 (T018, T019, T022, T023) public re-exports --------------------

export {
  lintQuerySet,
  QueryRowSchema,
  QuerySetSchema,
  type QueryRow,
  type QuerySet,
  type ValidatedQuerySet,
  type LintError,
} from './stratification.js';

export {
  verifyQ3Ratified,
  type RatificationStatus,
  type RatificationError,
  type RetrievalPatternName,
} from './q3-ratification.js';

export {
  mkPilotEvent,
  EventConstructionError,
  type PilotEventInputFields,
} from './events.js';

export {
  mkPilotSummary,
  writePilotSummary,
  PilotSummarySchema,
  SummaryError,
  WriteError,
  PERSONAL_SCALE_QUALIFIER,
  type PilotSummary,
  type PilotSummaryRunMeta,
} from './summary.js';

// --- Phase 3 (T024) — harness driver + path resolver -----------------------

export {
  runPilot,
  getHarnessPaths,
  type RunPilotOptions,
  type RunPilotResult,
  type OllamaClient,
  type OllamaChatRequest,
  type OllamaChatResponse,
  type OllamaToolCall,
  type McpClient,
  type McpToolResult,
} from './driver.js';
