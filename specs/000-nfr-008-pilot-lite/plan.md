# Implementation Plan: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Branch**: `000-nfr-008-pilot-lite` | **Date**: 2026-05-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/000-nfr-008-pilot-lite/spec.md`
**Authoritative ADR**: [.product/ADRs/ADR-010-sp000-lite-supersedes-005.md](../../.product/ADRs/ADR-010-sp000-lite-supersedes-005.md)

## Summary

SP-000-lite is a reduced-scope pre-build pilot whose deliverable is a *decision*, not a product surface. The pilot harness drives 50 stratified queries through `qwen3:8b` (already pulled on the build environment) against the SP-001/SP-002 MCP surface (`corpus.find` tool + four `corpus://` resources), records per-query tool-invocation behavior to a JSONL telemetry stream under a *new* `Paths.pilotTelemetry()` resolver key, and emits a per-iteration summary. Shon then discharges ADR-010's binary exit gate via exactly one of three terminal moves: commit final N to `decisions.jsonl` as a new D-NNN entry establishing the personal-scale floor for NFR-008, OR formally downgrade NFR-008 to `priority: nice_to_have`, OR escalate to full SP-000.

The technical approach is deliberately thin: a TypeScript pilot harness that composes existing SP-001/SP-002 infrastructure (Ollama client, MCP stdio loopback, path resolver) and ships no production substrate code. The only cross-cutting change SP-000-lite forces is the new `Paths.pilotTelemetry()` resolver key in `packages/contracts/src/paths.ts` — captured as a Phase 2 prerequisite task for `/speckit-tasks`, NOT authored here.

## Technical Context

**Language/Version**: TypeScript on Node ≥ 20 (matches root `package.json` engines field).
**Primary Dependencies**: existing `@llm-corpus/contracts` (`Paths`, `runTool`, telemetry types), `@llm-corpus/inference` (Ollama HTTP client; localhost-only per Principle I), `@llm-corpus/transport` (MCP stdio loopback for in-process tool-call simulation), `js-yaml` (already in tree; used to parse the 50-query YAML set). No new runtime dependencies are introduced by SP-000-lite.
**Storage**: append-only JSONL under `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` (telemetry stream, one event per query turn) plus `Paths.pilotTelemetry()/pilot-iter{N}-summary.json` (per-iteration summary). No SQLite touch; no index mutation; SP-000-lite is read-only against SP-001/SP-002 production state.
**Testing**: `vitest` (matches root `package.json`). Contract tests under `tests/contract/sp000-lite/` validate harness telemetry schema, query-set stratification rubric, and personal-scale qualifier presence on terminal artifacts. Integration test under `tests/integration/sp000-lite/` exercises the full pilot harness against a fixture MCP loopback (no real Ollama call in CI; live-Ollama run is operator-driven on Shon's workstation).
**Target Platform**: Linux workstation (Shon's `pai-node01` Fedora environment) with Ollama 0.x running locally on `127.0.0.1:11434` and `qwen3:8b` already pulled.
**Project Type**: internal-developer pilot harness — TypeScript CLI subcommand (`corpus pilot run --variant <id> --iteration <1|2>`) layered onto the existing `packages/cli/` surface; produces JSONL telemetry + JSON summary; does NOT add a new public CLI verb, MCP tool, or persistent product feature.
**Performance Goals**: not load-bearing. Per-query latency is dominated by `qwen3:8b` inference (~2-10 s on Shon's hardware); the pilot is sized at 50 queries × ≤2 iterations = at most 100 model invocations. Wall-clock budget: 15-30 minutes per iteration. No SLA, no benchmark claim.
**Constraints**:
- Hard-bound by ADR-010 §Decision (50 queries, qwen3:8b, single variant + ≤1 iteration cycle, binary exit).
- Hard-bound by Constitution Principle XIV: every path resolves through `Paths.*`; the new `Paths.pilotTelemetry()` key MUST be merged to `main` before the harness runs (Phase 2 prerequisite task).
- Hard-bound by AG-005 / FR-PILOT-009: the harness measures *tool invocation rate*, not *retrieval quality*. No relevance judgments, no labeled benchmark, no hit-rate scoring.
- Hard-bound by Constitution Principle XVI: every terminal artifact (D-NNN entry, REQUIREMENTS.yaml fields, CLI `--help`, README passages) carries an explicit personal-scale qualifier; industry-standard phrasing is forbidden.
**Scale/Scope**: single-user, single-machine, single-model (Constitution Principle IV). The 50-query set is one operator's curated stratification against one curated 32-PDF substrate sampler. No multi-user, multi-machine, or cross-environment claims arise from the pilot output.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Marking convention:
- `[x]` — plan complies in full
- `[ ]` — plan violates the principle (would require Complexity Tracking justification)
- `[~]` — plan complies in spirit but depends on a prerequisite task that is captured for `/speckit-tasks` and NOT implemented inside this plan

- [x] **I. Local-First, No Egress** — Pilot harness uses only the existing localhost Ollama HTTP client and the in-process MCP loopback. No new network code paths introduced. The harness emits telemetry to local JSONL files under `Paths.pilotTelemetry()`; nothing leaves the machine. ADR-010 §Decision constrains the model to `qwen3:8b` already pulled locally; the harness halts if Ollama is unreachable rather than substituting a hosted model.
- [x] **II. User Curates, LLM Classifies Metadata** — The pilot does NOT classify or generate document bodies. It measures whether the LLM *invokes* `corpus.find`; it does not write any document, frontmatter field, or `synthesis/` artifact to the canonical store. The 50-query set is hand-curated by Shon (US2), not LLM-synthesized. No forbidden frontmatter fields are introduced.
- [x] **III. Substrate, Not Surface** — Pilot harness ships as a CLI subcommand (`corpus pilot run`) reading existing stdio MCP transport. No HTTP server, no TUI, no browser UI, no HTML output, no agent-facing mutation surface (the MCP server remains read-only; the pilot consumes its `corpus.find` tool + four resources without modification).
- [x] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — Pilot output is one operator's tool-use rate on one machine. No conversation memory, no SaaS connector, no shared `CORPUS_HOME`, no cross-machine sync. The committed N is explicitly framed as Shon's-workflow-on-his-substrate (Principle XVI + US3); no cross-user, cross-account, or cross-machine claim is permitted.
- [x] **V. Schema-Enforced Structured Output** — N/A in spirit (the pilot does not invoke the classifier pipeline). For the harness itself, telemetry events conform to a Zod schema derived from FR-PILOT-005's enumerated fields, validated at emit time. The summary JSON conforms to a Zod schema derived from FR-PILOT-013's enumerated fields. No post-hoc string parsing of LLM output (the LLM's tool-call payload is structurally inspected via the MCP tool-call envelope, not regex-extracted from free text).
- [x] **VI. One Pipeline, Two Policies** — SP-000-lite does NOT introduce a parallel ingestion pipeline. The pilot reads existing SP-002 MCP surface and writes only to telemetry. No `Policy` object is added; no production code path is forked.
- [x] **VII. Cancellable, Bounded IO** — Every external IO call (Ollama HTTP, MCP tool invocation, JSONL append) takes an `AbortSignal` propagated through the harness's top-level `AbortController`. SIGTERM/SIGINT during pilot run aborts the in-flight model call, persists any partial JSONL records (each ≤ 4 KB per Principle IX), and exits within 2 seconds. Per-query timeout default is 60 s; per-iteration timeout is 30 min; both configurable via CLI flag. No `Promise.race` against `setTimeout`; no `execSync`.
- [x] **VIII. Atomic Writes & Transactional Index Updates** — JSONL appends are POSIX-atomic (each event line is < 4 KB, written via `appendFileSync` with `O_APPEND`; alternatively via the existing `runTool` + `fsync`-aware writer if needed for cross-platform safety). The per-iteration summary JSON is written via `tmp + fsync + rename + dirsync` (the existing atomic-write helper in `@llm-corpus/contracts`). No SQLite index touched, so no transactional-index-update consideration applies.
- [x] **IX. Concurrency-Safe Shared State** — Pilot harness is single-process, single-iteration; no concurrent writers to the telemetry file are spawned. Each JSONL event line is bounded ≤ 4 KB so the `O_APPEND` write is POSIX-atomic. The pilot does NOT touch `Paths.drainLock()`, the inbox, or SQLite WAL state; concurrency-safety concerns are inherited from the substrate (SP-001/SP-002), not introduced here.
- [x] **X. Idempotent Pipeline Transitions; Three-Folder Routing** — N/A in spirit (no pipeline transitions). The pilot run itself is *not* idempotent at the high level (a second pilot run intentionally produces a second iteration file `pilot-iter2.jsonl` — that's the design per FR-PILOT-014, not a bug). The harness MUST NOT delete or overwrite iteration-1 artifacts when iteration 2 runs (FR-PILOT-014).
- [x] **XI. Library/CLI Boundary** — Pilot harness logic lives in `packages/cli/src/pilot/` (a CLI-layer module) and `packages/pipeline/src/pilot-harness/` (library-layer helpers if needed). Library functions return `Result<T, E>` or throw typed errors; only the `packages/cli/` wrapper calls `process.exit`. No `process.exit` added to `packages/{contracts,core,storage,index,inference,extract,pipeline}/`.
- [x] **XII. Subprocess Hygiene** — Pilot harness invokes Ollama via HTTP (the existing inference client), not subprocess. If `pdftotext` or `docx2txt` is invoked at substrate-conversion time (one-time prep, not pilot-run-time), it routes through the existing `runTool(name, args[], opts)` helper with `AbortSignal` propagation. No `execSync`, no string-formed shell commands.
- [x] **XIII. Telemetry-or-Die** — Every catch block in the pilot harness emits a structured event to `Paths.telemetry()` (the production telemetry stream, for harness-level errors) at severity matching the actual error. Per-query results emit to `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` (the pilot-specific stream) per FR-PILOT-005. No exception is swallowed before reaching a per-file catch block; no severity downgrade. The pilot's `nfr_008_pilot` event class is registered in the telemetry-event Zod schema.
- [~] **XIV. XDG Paths via Single Resolver — PARTIAL: depends on resolver-key prerequisite** — All pilot artifacts (telemetry JSONL, summary JSON, query-set YAML) MUST resolve through `Paths.*`. The pilot's telemetry path is `Paths.pilotTelemetry()/pilot-iter{N}.jsonl`. **The `Paths.pilotTelemetry()` resolver key is not yet implemented in `packages/contracts/src/paths.ts`** — it is captured as a Phase 2 prerequisite task for `/speckit-tasks` (see Phase 2 Prerequisites section below). Running the pilot harness against an unmerged `Paths.pilotTelemetry()` key is FORBIDDEN (per FR-PILOT-006 and the Q5 round-2 clarification). Once the resolver key lands on `main`, Principle XIV is fully `[x]`; until then this entry remains `[~]` and is the single load-bearing dependency for SP-000-lite execution. No hardcoded path literals appear in the harness implementation.
- [x] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — N/A. Pilot harness does not touch `facet_domain`, `tags`, the classifier prompt, or `taxonomy.yml`. No new domain enters the system from the pilot run; the pilot measures tool-invocation rate against an already-curated substrate.
- [x] **XVI. Validation Honesty** — Every terminal artifact (D-NNN entry, REQUIREMENTS.yaml NFR-008 fields, CLI `--help` for `corpus pilot`, any README passage citing the committed N) MUST carry an explicit personal-scale qualifier identifying both the model (`qwen3:8b`) and the substrate (Shon's personal knowledge-work corpus). Industry-standard phrasing is FORBIDDEN. The harness's per-run summary JSON (Pilot Summary entity, per `data-model.md`) labels the run with `model=qwen3:8b`, `substrate=personal-curated-32pdf-sampler`, and the run's date — three summary-level fields that the downstream D-NNN ledger entry inherits verbatim. These appear on the per-iteration summary file (`pilot-iter{N}-summary.json`) and on the Pilot Run record, NOT per-event in the JSONL telemetry stream (the Pilot Telemetry Event entity at `data-model.md` Entity 3 carries only the FR-PILOT-005 fields). No cross-model, cross-user, cross-substrate, or cross-machine generalization is claimed.

**Gate result**: 15 principles fully compliant (`[x]`); 1 principle partial (`[~]`) pending a tracked Phase 2 prerequisite task. No `[ ]` entries; no Complexity Tracking justification required. The `[~]` is a *sequencing* dependency, not a violation: the plan is honest that the harness cannot run until `Paths.pilotTelemetry()` merges, and that the merge is captured for `/speckit-tasks` rather than smuggled into this plan.

## Project Structure

### Documentation (this feature)

```text
specs/000-nfr-008-pilot-lite/
├── plan.md                             # this file (/speckit-plan output)
├── research.md                         # Phase 0 output — qwen3:8b tool-use evidence base
├── data-model.md                       # Phase 1 output — Pilot Run, Query, Pilot Telemetry Event, Pilot Summary
├── quickstart.md                       # Phase 1 output — operator walkthrough
├── contracts/
│   ├── pilot-harness.feature           # FR-PILOT-001/004/005/006/013/014 scenarios
│   ├── query-set.feature               # FR-PILOT-002/003/010/011 scenarios
│   └── telemetry.feature               # FR-PILOT-005/013/014 + SC-003/006 scenarios
├── checklists/
│   └── requirements.md                 # spec quality checklist (already authored)
├── spec.md                             # feature specification (already authored)
└── tasks.md                            # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
packages/
├── contracts/
│   └── src/
│       ├── paths.ts                    # [READ-ONLY in this plan] Phase 2 prerequisite: add Paths.pilotTelemetry()
│       └── telemetry.ts                # [READ-ONLY in this plan] Phase 2 follow-up: register 'nfr_008_pilot' event class in Zod schema
├── cli/
│   └── src/
│       └── pilot/                      # NEW (Phase 2) — `corpus pilot run --variant <id> --iteration <N>` subcommand
│           ├── command.ts              # CLI entry; parses --variant, --iteration; calls library harness
│           ├── summary.ts              # per-iteration summary writer
│           └── README.md               # operator usage notes (personal-scale qualifier inline)
└── pipeline/
    └── src/
        └── pilot-harness/              # NEW (Phase 2) — library-layer harness (returns Result<T,E>)
            ├── harness.ts              # drives the 50-query loop against MCP loopback + Ollama
            ├── stratification.ts       # lints the 50-query YAML against FR-PILOT-002/003
            └── events.ts               # Zod schema for `nfr_008_pilot` event (matches FR-PILOT-005)

specs/000-nfr-008-pilot-lite/
└── queries.yaml                        # NEW (Phase 2) — the 50-query set (30 KG + 15 G + 5 A); subject to lint via stratification.ts

tests/
├── contract/
│   └── sp000-lite/
│       ├── telemetry-schema.test.ts    # nfr_008_pilot event conforms to Zod schema (FR-PILOT-005)
│       ├── query-stratification.test.ts # queries.yaml passes stratification linter (FR-PILOT-002/003)
│       └── path-resolution.test.ts     # harness writes only under Paths.pilotTelemetry() (SC-006)
└── integration/
    └── sp000-lite/
        └── harness-loopback.test.ts    # full harness drive against MCP loopback + fixture Ollama stub
```

**Structure Decision**: The pilot harness composes existing packages (`@llm-corpus/contracts`, `@llm-corpus/inference`, `@llm-corpus/transport`) rather than introducing a new top-level package. The new code is contained to two directories — `packages/cli/src/pilot/` (CLI surface, allowed to call `process.exit`) and `packages/pipeline/src/pilot-harness/` (library, returns `Result<T, E>`). No new workspace entry; no new dependency in `package.json`. The 50-query YAML set lives in `specs/000-nfr-008-pilot-lite/queries.yaml` (not under `packages/`) because it is per-feature spec content, not production code.

## Phase 2 Prerequisites (captured for `/speckit-tasks`)

The following two prerequisite tasks MUST land on `main` before the pilot harness implementation tasks can run. They are explicitly out of scope for `/speckit-plan` and are NOT touched by this plan:

1. **PREREQ-001 — Add `Paths.pilotTelemetry()` resolver key to `packages/contracts/src/paths.ts`.**
   The new derived getter returns `path.join(Paths.state(), 'pilot-telemetry')` (a directory path, in contrast to `Paths.telemetry()` which returns a single file path). The key composes from `Paths.state()` and introduces no new XDG base directory, honoring Constitution Principle XIV. The change ships in an isolated PR with a `tests/contract/paths-resolver.test.ts` update covering the new key. This task is the load-bearing dependency that lifts the `[~]` on Constitution Check Principle XIV to `[x]`.
2. **PREREQ-002 — Register `nfr_008_pilot` event class in the telemetry-event Zod schema** in `packages/contracts/src/telemetry.ts`. The class enumerates the FR-PILOT-005 fields with their types. Ships in the same PR as PREREQ-001 or as an immediate follow-up. This task lifts the Principle XIII `[x]` from "spirit-only" to "schema-enforced".

These two tasks are pure SP-001 substrate amendments. They do NOT depend on Q3 DRAFT ratification; they MAY be authored in parallel with the PR walkthrough that ratifies Q3.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified.**

No violations to justify. The single `[~]` entry on Principle XIV is a *prerequisite dependency*, not a principle violation: the plan honestly declares that the pilot harness cannot execute until `Paths.pilotTelemetry()` merges, and the merge is captured as PREREQ-001 above for `/speckit-tasks` to enumerate. Once PREREQ-001 lands, all 16 principles are fully `[x]` and no Complexity Tracking entry is required.
