# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

For each principle, mark `[x]` if the plan complies, `[ ]` if it does not (and populate Complexity Tracking with a justification). All 16 principles MUST be marked `[x]` for the plan to merge unchallenged.

- [ ] **I. Local-First, No Egress** — Plan introduces no code path that reaches a non-localhost network endpoint.
- [ ] **II. User Curates, LLM Classifies Metadata** — Plan introduces no LLM-generated document bodies in the canonical store; no `synthesis/` namespace; no forbidden frontmatter fields (`origin`, `provenance_*`, `confidence`, `captured_at`, `corpus capture`).
- [ ] **III. Substrate, Not Surface** — Plan introduces no HTTP server other than MCP stdio, no TUI, no browser-rendered surface, no agent-facing mutation surface, no HTML/graphical output.
- [ ] **IV. Knowledge, Not Memory; Single-User, Single-Machine** — Plan introduces no conversation memory, no SaaS connector, no shared CORPUS_HOME, no cross-machine sync, no multi-user concept, no permissions/roles.
- [ ] **V. Schema-Enforced Structured Output** — Plan uses Ollama `format` parameter for classification; no post-hoc string parsing; frontmatter routes through one YAML library.
- [ ] **VI. One Pipeline, Two Policies** — Plan does NOT fork the pipeline; behavior changes go in `Policy` fields, not parallel code paths.
- [ ] **VII. Cancellable, Bounded IO** — Every external IO call takes `AbortSignal`; per-call/per-doc/per-batch timeouts configurable; no `Promise.race` against `setTimeout`; no `execSync`.
- [ ] **VIII. Atomic Writes & Transactional Index Updates** — Disk writes use `tmp + fsync + rename + dirsync` with PID-and-entropy temp suffix; index writes commit FTS5 + docs + sqlite-vec rows in one transaction; tmp dirs use `withTempDir`.
- [ ] **IX. Concurrency-Safe Shared State** — Drain serialized via `flock`; SQLite in WAL mode; append-only JSONL records ≤ 4 KB or use file locks.
- [ ] **X. Idempotent Pipeline Transitions; Three-Folder Routing** — Every transition is `(state, input) → next_state | error` with no extra side effects on re-run; `pending/`/`processed/`/`failed/` discipline maintained.
- [ ] **XI. Library/CLI Boundary** — No `process.exit` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`; library functions return `Result<T,E>` or throw typed errors.
- [ ] **XII. Subprocess Hygiene** — All subprocess invocations go through the `runTool(name, args[], opts)` helper; no `exec`, `execSync`, or string-formed shell commands.
- [ ] **XIII. Telemetry-or-Die** — Every catch block under `packages/` emits a structured telemetry event at severity matching the actual error severity; no swallowing in wrappers/middleware.
- [ ] **XIV. XDG Paths via Single Resolver** — Every filesystem path the system reads/writes resolves through `Paths.*`; no writes to `/tmp/`, `/var/`, `os.tmpdir()`, or anywhere outside `$HOME`.
- [ ] **XV. Dynamic Taxonomy with User-Reviewed Promotion** — No hardcoded `enum FacetDomain`; classifier prompt rendered with live `SELECT DISTINCT facet_domain`; new domains enter user-review queue; auto-promotion is FORBIDDEN without explicit user acknowledgment.
- [ ] **XVI. Validation Honesty** — Plan introduces no marketing claim of cross-agent compatibility, no formal eval harness as v1 success criterion, no performance guarantees not backed by CI benchmark on primary user's hardware.

See `.specify/memory/constitution.md` for full principle text and rationale.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
