# pilot-harness (SP-000-Lite)

Library-layer implementation of the NFR-008 reduced-scope pilot.

## Status

**Phase 1 (workspace plumbing) — scaffolded.** No behavior yet. Phase 2
authors the failing contract tests; Phase 3 implements the linter, event
constructor, summary builder, and harness driver against those tests.

## Design intent

The full design lives in the `000-nfr-008-pilot-lite` feature branch (PR #6),
under `specs/000-nfr-008-pilot-lite/`. The relevant files there are:

- `spec.md` — FR-PILOT-001 through FR-PILOT-014, success criteria.
- `plan.md` — implementation plan; "Project Structure" section.
- `data-model.md` — Entity 1 (Pilot Summary), Entity 2 (Query Set),
  Entity 3 (Telemetry Event).
- `tasks.md` — T005 through T026 cover this directory's scope.
- `contracts/{pilot-harness,query-set,telemetry}.feature` — Gherkin
  scenarios that the contract tests realize.

External reference: `.product/ADRs/ADR-010-sp000-lite-supersedes-005.md`
(on `main`).

## Boundaries (Constitution XI)

- Library functions return `Result<T, E>` from `@llm-corpus/contracts/result`.
- This package MUST NOT call `process.exit`. The CLI boundary
  (`packages/cli/src/pilot/command.ts`) is the only site allowed to unwrap a
  `Result.Err` into a non-zero exit code.

## Future-shape (Phase 3)

Phase 3 will populate this directory with:

- `harness.ts` — driver (T024).
- `stratification.ts` — `queries.yaml` linter + Q3 ratification gate (T018, T019).
- `events.ts` — `mkPilotEvent` typed constructor over `NfrPilotEvent` (T022).
- `summary.ts` — `mkPilotSummary` + atomic `writePilotSummary` (T023).

These are intentionally absent in Phase 1.
