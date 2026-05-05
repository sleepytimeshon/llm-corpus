---
description: "Task list for feature 001-local-only-mcp-foundation (SP-001)"
---

# Tasks: Local-Only Enforcement and MCP Server Foundation

**Input**: Design documents from `/specs/001-local-only-mcp-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{mcp-corpus-find,telemetry-egress-events,egress-hook-api}.md, quickstart.md

**Tests**: MANDATORY for tasks touching IO, classifier output, telemetry, paths, taxonomy, schema, or subprocess (per `tasks-template.md` project-specific override and Constitution Principles V, VII, VIII, IX, X, XII, XIII, XIV, XV). SP-001 touches ALL of these surfaces, so tests are mandatory throughout.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Constitution Check (16 principles) verified at plan time; no Complexity Tracking entries.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3, US4, or US5 (maps to user stories in spec.md)
- File paths are absolute or repo-relative

## Path Conventions

Repo-relative paths under `~/Projects/llm-corpus/`. Single TypeScript monorepo with `packages/` workspaces:
- `packages/contracts/` — pure types, zero IO
- `packages/transport/` — MCP stdio transport, egress hook bootstraps here
- `packages/daemon/` — Worker-thread guards
- `packages/cli/` — `corpus` binary entry point
- `packages/{storage,index,inference,extract,pipeline}/` — stub libraries (empty `index.ts`) so NFR-001 lint scope covers them
- `tests/{unit,integration,lint-fixtures}/` — test rigs
- `tools/eslint-rules/` — custom eslint rules
- `build/` — build-time scripts (verify-native-addons.ts)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, monorepo workspace, TypeScript + lint + test toolchain.

- [ ] T001 Create monorepo layout: `packages/{contracts,transport,daemon,cli,storage,index,inference,extract,pipeline}/`, `tests/{unit,integration,lint-fixtures}/`, `tools/eslint-rules/`, `build/` per plan.md "Project Structure"
- [ ] T002 Initialize root `package.json` with npm workspaces, scripts (`build`, `lint`, `test`, `test:integration`, `mcp:start`, `postinstall: build/verify-native-addons.ts`), Node engine `>=20`
- [ ] T003 [P] Initialize each package's `package.json` (`@llm-corpus/{contracts,transport,daemon,cli,storage,index,inference,extract,pipeline}`) with strict `dependencies`/`devDependencies` declarations matching plan.md dependency direction
- [ ] T004 [P] Configure root `tsconfig.json` (strict mode, target ES2022, module NodeNext, isolatedModules) and per-package `tsconfig.json` extending root with `references` for project-references build
- [ ] T005 [P] Configure `vitest.config.ts` at root with workspace support and per-package coverage
- [ ] T006 [P] Configure `eslint.config.js` (flat config) at root with TypeScript + custom-rules registration
- [ ] T007 [P] Add devDependencies: `typescript@^5.5`, `vitest@^2`, `@vitest/coverage-v8`, `eslint@^9`, `typescript-eslint`, `zod`, `@modelcontextprotocol/sdk`, `undici` (already a Node built-in but pin for type imports)
- [ ] T008 [P] Add native-addon dependencies: `better-sqlite3`, `sqlite-vec` (the v1 allowlist; install verifies the allowlist post-install)
- [ ] T009 Create `.gitignore` additions for `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo` (verify they don't conflict with existing `.gitignore`)
- [ ] T010 Create `tsconfig.base.json` shared compiler options, referenced by all package tsconfigs

**Checkpoint**: `npm install` runs cleanly; the post-install allowlist check (T020 below) wires up later. `npm run build` may not yet succeed (no source files) but the toolchain is configured.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, the Paths resolver, the Result type, the runTool helper, the telemetry primitives — every user story depends on these.

**⚠️ CRITICAL**: No user-story work begins until Phase 2 completes.

### Tests (mandatory per Constitution V/VII/IX/XI/XII/XIII/XIV)

- [ ] T011 [P] Unit test `tests/unit/paths.test.ts` — XDG resolution: `Paths.data()`, `Paths.state()`, `Paths.config()`, `Paths.cache()` honor env vars and defaults; `CORPUS_HOME` overrides root; derived paths (`indexDb`, `telemetry`, `drainLock`) compose correctly. *Constitution XIV*
- [ ] T012 [P] Unit test `tests/unit/result.test.ts` — `Result<T,E>` construction (ok/err), unwrap behavior, map/flatMap, type narrowing in conditionals. *Constitution XI*
- [ ] T013 [P] Unit test `tests/unit/telemetry-event-shapes.test.ts` — Zod schemas validate `egress.attempted`, `egress.blocked`, `egress.checkpoint` discriminated union; ≤4 KB serialization assertion. *Constitution V, IX, XIII*
- [ ] T014 [P] Unit test `tests/unit/run-tool.test.ts` — `runTool('echo', ['hi'], {})` returns captured stdout; rejects on non-zero exit; propagates AbortSignal; emits `tool_invoked` telemetry event. *Constitution VII, XII, XIII*

### Implementation

- [ ] T015 [P] Implement `packages/contracts/src/paths.ts` — single XDG resolver per ARCHITECTURE-FINAL §2.1; export frozen `Paths` object with `data/state/config/cache` + derived getters (indexDb, telemetry, drainLock, sourceIndex, taxonomy, catalog, configFile, extractCache, docs, inbox, pending, processed, failed, trash, assets). *Constitution XIV*
- [ ] T016 [P] Implement `packages/contracts/src/result.ts` — `Result<T, E>` discriminated union, `ok(value)`/`err(error)` constructors, `map`/`flatMap`/`unwrapOr`/`isOk`/`isErr`. *Constitution XI*
- [ ] T017 [P] Implement `packages/contracts/src/telemetry.ts` — Zod schemas from `contracts/telemetry-egress-events.md`: `EgressAttemptedEvent`, `EgressBlockedEvent`, `EgressCheckpointEvent`, `EgressEvent` discriminated union. Export `emitTelemetry(event)` helper that validates, serializes, asserts ≤4 KB, and `fs.appendFile(Paths.telemetry(), serialized + '\n')`. *Constitution V, IX, XIII*
- [ ] T018 Implement `packages/contracts/src/run-tool.ts` — `runTool(name: string, args: string[], opts: { signal?: AbortSignal; cwd?: string }): Promise<Result<{stdout, stderr, exitCode}, ToolInvocationError>>` using `child_process.spawn` with arg array; propagates AbortSignal; emits `tool_invoked` telemetry event. *Constitution VII, XII*
- [ ] T019 [P] Implement `packages/contracts/src/errors.ts` — typed errors: `EgressBlockedError`, `EgressHookAlreadyInstalledError`, `ToolInvocationError`, `SchemaValidationError`. Per `contracts/egress-hook-api.md` §"EgressBlockedError contract". *Constitution XI*
- [ ] T020 Implement `build/verify-native-addons.ts` — enumerates `node_modules/**/*.node` post-install, maps each to its containing package via `package.json` directory walk, fails the build if any package outside `{better-sqlite3, sqlite-vec}` contributes a `.node` file. *Constitution VII, XII*
- [ ] T021 [P] Implement stub `packages/{storage,index,inference,extract,pipeline}/src/index.ts` — single `export {}` placeholder so the lint AST has a target. Per Architect critique (empty packages have no source files; lint needs at least one).

### Custom eslint rules (build-time enforcement contracts per `contracts/egress-hook-api.md`)

- [ ] T022 [P] Implement `tools/eslint-rules/no-forbidden-network-imports.ts` — AST scan for forbidden import sources from `data-model.md` ForbiddenImportSet. Scope: `packages/{pipeline,storage,index,inference,extract,cli}/`. *NFR-001*
- [ ] T023 [P] Implement `tools/eslint-rules/no-process-exit-in-libs.ts` — rejects `process.exit(...)` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`. *Constitution XI*
- [ ] T024 [P] Implement `tools/eslint-rules/paths-from-resolver-only.ts` — rejects path literals matching `data-model.md` ForbiddenPathLiteral patterns outside `packages/contracts/src/paths.ts`. *Constitution XIV*
- [ ] T025 [P] Implement `tools/eslint-rules/no-direct-worker-spawn.ts` — rejects `new Worker(` outside `packages/daemon/src/worker-spawn-guard.ts`. *Constitution XII, NFR-002*
- [ ] T026 [P] Implement `tools/eslint-rules/no-shell-string-exec.ts` — rejects `execSync`, `exec`, and string-formed shell commands (selector for `child_process.exec` calls without arg-array form). *Constitution XII*
- [ ] T027 Wire all 5 custom rules into `eslint.config.js` flat config

**Checkpoint**: Foundation ready. `npm run lint` exits 0 on the empty stubs; `npm run build` succeeds; `npm run test:unit` passes. User-story phases can now run in parallel.

---

## Phase 3: User Story 1 — AI agent can discover and connect to the corpus (Priority: P1) 🎯 MVP

**Goal**: An MCP-aware agent connecting over stdio receives a `tools/list` response containing exactly one `corpus.find` tool with input/output schemas advertised. Cold-start race returns `code: -32002, message: "server_initializing"`.

**Independent Test**: Start MCP server. Connect MCP client over stdio. Issue `tools/list`. Verify the response.

### Tests for US1 (mandatory per Constitution V)

- [ ] T028 [P] [US1] Integration test `tests/integration/mcp-tools-list.test.ts` — assert `tools/list` response contains exactly one tool named `corpus.find` with valid input + output JSON Schemas (Zod-derived). *FR-001, US1 AS1, US1 AS3, SC-006*
- [ ] T029 [P] [US1] Integration test `tests/integration/mcp-no-http-transport.test.ts` — attempt to connect to MCP server over HTTP/SSE/TCP; assert connection refused; assert no inbound-connection event logged. *FR-001, US1 AS2*
- [ ] T030 [P] [US1] Integration test `tests/integration/mcp-cold-start-error.test.ts` — issue `tools/list` during bootstrapping phase; assert error envelope `code: -32002, message: "server_initializing", data.retry_after_ms`. *FR-001, US1 AS4*

### Implementation for US1

- [ ] T031 [US1] Implement `packages/transport/src/schemas.ts` — Zod `CorpusFindInput`, `SearchFilter`, `SearchHit`, `CorpusFindOutput` per `contracts/mcp-corpus-find.md`. Export `inputJsonSchema()` and `outputJsonSchema()` helpers using `zod-to-json-schema`. *Constitution V*
- [ ] T032 [US1] Implement `packages/transport/src/corpus-find-tool.ts` — `corpusFindHandler: CorpusFindHandler` with signature `(input, signal) => Promise<CorpusFindOutput>`. SP-001 body returns `{ hits: [], query: input.query, tier_used: undefined }` after `signal.throwIfAborted()`. *Constitution VII, FR-001*
- [ ] T033 [US1] Implement `packages/transport/src/mcp-server.ts` — register the SDK server with stdio transport ONLY (refuse HTTP/SSE per US1 AS2). Register exactly one tool `corpus.find` with input/output JSON Schemas + handler. Implement bootstrapping → ready transition: initial state returns `code: -32002` for `tools/list`; transition fires after hook + SDK + (placeholder) index open. *FR-001*
- [ ] T034 [US1] Implement `packages/transport/src/index.ts` — entry point: import `./egress-hook` FIRST (T037 below), then `./mcp-server`, then call `startMcpServer()`. *Bootstrap ordering per `contracts/egress-hook-api.md`*
- [ ] T035 [US1] Implement `packages/cli/src/index.ts` — `corpus` binary dispatcher; `corpus mcp` subcommand starts the MCP server (delegates to `@llm-corpus/transport`). Other subcommands (ingest/search/etc.) are SP-003+ scope and not implemented in SP-001
- [ ] T036 [US1] Wire `bin` field in `packages/cli/package.json` so `npm run mcp:start` resolves to `node packages/cli/dist/index.js mcp`

**Checkpoint**: US1 done. `npm run mcp:start &` plus an MCP-spec client issuing `tools/list` returns the corpus.find tool. SC-006 verified.

---

## Phase 4: User Story 2 — User's documents never leave the user's machine (Priority: P1)

**Goal**: Runtime egress hook installed before any pipeline import, blocks 6 outbound primitives, refuses unguarded Workers. tcpdump shows zero non-loopback packets during sentinel cycle.

**Independent Test**: Run sentinel ingest cycle while tcpdump captures non-loopback interfaces. Verify zero packets.

### Tests for US2 (mandatory per Constitution VII, XII, XIII; CRITICAL P1 path)

- [ ] T037 [P] [US2] Unit test `tests/unit/loopback-classifier.test.ts` — exhaustive table for `classifyHost(host, port)`: 127.x.x.x → loopback, ::1 → loopback, 'localhost' → loopback, '8.8.8.8' → remote, 'example.org' → remote (post-DNS check). *NFR-002a, `contracts/egress-hook-api.md`*
- [ ] T038 [P] [US2] Unit test `tests/unit/egress-hook.test.ts` — invoke each of the six primitives against a remote destination; assert `EgressBlockedError` is thrown synchronously (or async-rejected for promise-returning); assert `egress.attempted` + `egress.blocked` events emitted in order. *NFR-002a, US2 AS2, SC-002*
- [ ] T039 [P] [US2] Unit test `tests/unit/egress-hook-loopback-passthrough.test.ts` — invoke each primitive against loopback (127.0.0.1, ::1, localhost); assert call proceeds (no throw); assert `egress.attempted` event emitted with `result: "loopback"`; assert NO `egress.blocked` event. *NFR-002a*
- [ ] T040 [P] [US2] Integration test `tests/integration/bootstrap-order.test.ts` — spawn Node child with strategically-positioned import-time `console.log` instrumentation; assert hook installation banner appears BEFORE any pipeline-package banner. *SC-007*
- [ ] T041 [P] [US2] Integration test `tests/integration/hook-install-once.test.ts` — call `installEgressHook()` twice in same process; assert second call throws `EgressHookAlreadyInstalledError`. *`contracts/egress-hook-api.md`*
- [ ] T042 [P] [US2] Integration test `tests/integration/worker-shim-refusal.test.ts` — attempt `new Worker(...)` directly (bypassing the helper); assert lint rule rejects at compile time AND runtime test asserts spawnGuardedWorker IS the only path. Spawn a guarded worker; from inside it, attempt egress; assert blocked + telemetry. *NFR-002a, US2 AS5, SC-003*
- [ ] T043 [US2] Integration test `tests/integration/tcpdump-sentinel.test.ts` — start tcpdump on non-loopback interfaces, run a sentinel-document fixture through the find-path (ingest/classify/embed/index are stubs in SP-001), capture packets, assert zero attributable to corpus process. *NFR-002, SC-002, US2 AS1*
- [ ] T044 [US2] Integration test `tests/integration/child-process-firewall.test.ts` — pre-test: install OS firewall rule manually (Fedora iptables). Spawn a child process via `runTool` that attempts egress to 8.8.8.8:53; assert connection rejected at OS layer; assert telemetry event with `blocked_at: 'os_firewall'`. Post-test: remove rule. *NFR-002b, US2 AS6, SC-004*
- [ ] T045 [P] [US2] Integration test `tests/integration/find-path-checkpoint-smoke.test.ts` — 10-document smoke fixture exercising find-path; assert one `egress.checkpoint` event per document with `pipeline_stage: 'find'`; assert checkpoint helper is exported from `@llm-corpus/contracts/telemetry`. *SC-008 SP-001 partial*

### Implementation for US2

- [ ] T046 [P] [US2] Implement `packages/transport/src/loopback-classifier.ts` — `isLoopbackIPv4`, `isLoopbackIPv6`, `classifyHost(host, port)` per `contracts/egress-hook-api.md` §"Loopback classification"
- [ ] T047 [US2] Implement `packages/transport/src/egress-hook.ts` — `installEgressHook(opts?: HookOptions): Disposable` patches all six primitives at module load time. Each patched method: emit `egress.attempted`, classify destination, if remote throw `EgressBlockedError` + emit `egress.blocked`. DNS post-resolution check for hostnames. Singleton install with `EgressHookAlreadyInstalledError` defensive throw. *NFR-002a, ADR-001 §Decision.1*
- [ ] T048 [US2] Implement `packages/transport/src/egress-hook-bootstrap.ts` — module-load-time call to `installEgressHook()` (no args). Imported FIRST by `packages/transport/src/index.ts` (T034 already wired)
- [ ] T049 [P] [US2] Implement `packages/daemon/src/worker-bootstrap.ts` — worker preload: calls `installEgressHook()` first thing, before any user-supplied Worker code
- [ ] T050 [US2] Implement `packages/daemon/src/worker-spawn-guard.ts` — `spawnGuardedWorker(filename, opts?)` injects the bootstrap-shim path as a preload via `execArgv`. Lint rule (T025) rejects direct `new Worker(...)` outside this helper
- [ ] T051 [US2] Add SP-001 verification helper `build/verify-firewall-rule.sh` — manual install rig referenced in quickstart.md (Fedora iptables + macOS pf); SP-007 will replace with automated install
- [ ] T052 [US2] Implement `packages/transport/src/mcp-checkpoint.ts` — `emitCheckpoint(doc_id, pipeline_stage)` helper that emits `egress.checkpoint`; called from each pipeline-stage entry point. SP-001 only the find-path entry calls it; SP-003+ wire ingest/classify/embed/index

**Checkpoint**: US2 done. SC-002, SC-003, SC-004, SC-007, SC-008 (partial) all verified.

---

## Phase 5: User Story 3 — Build fails on forbidden network import (Priority: P2)

**Goal**: NFR-001 lint rule rejects forbidden-import additions to in-scope packages with the offending file + import named.

**Independent Test**: Add `import 'node:http'` to a pipeline source file. Run `npm run lint`. Verify exit non-zero with diagnostic.

### Tests for US3 (mandatory per Constitution rules being enforced are V/XI/XIII/XIV)

- [ ] T053 [P] [US3] Lint-fixture test `tests/lint-fixtures/forbidden-imports.test.ts` — for each entry in `data-model.md` ForbiddenImportSet, create a fixture file under `tests/lint-fixtures/forbidden/` with that import; assert eslint rule reports a violation naming the file + import. *NFR-001, US3 AS2*
- [ ] T054 [P] [US3] Lint-fixture test `tests/lint-fixtures/clean-fixture.test.ts` — fixture file with no forbidden imports under `tests/lint-fixtures/clean/`; assert eslint passes with zero violations. *NFR-001, US3 AS1, SC-001*
- [ ] T055 [P] [US3] Lint-fixture test `tests/lint-fixtures/scope-boundary.test.ts` — add forbidden import to a file under `packages/transport/` (which is OUT of scope because it hosts the hook); assert eslint does NOT report (lint scope correctly excludes transport/daemon). *NFR-001 scope*
- [ ] T056 [P] [US3] Lint-fixture test `tests/lint-fixtures/all-in-scope-packages.test.ts` — add forbidden import to a file in EACH of `pipeline,storage,index,inference,extract,cli` packages; assert all 6 violations reported. *NFR-001, US3 AS3*

### Implementation for US3

- [ ] T057 [P] [US3] Author CI workflow `.github/workflows/lint.yml` (or equivalent) that runs `npm run lint` on every PR and main push. Fails the build on non-zero exit
- [ ] T058 [US3] Verify NFR-001 lint rule (T022) covers all `data-model.md` ForbiddenImportSet entries; add any missing entries; commit fixtures (T053-T056) referencing the rule

**Checkpoint**: US3 done. SC-001 (NFR-001 happy path) verified.

---

## Phase 6: User Story 4 — Native addon allowlist refuses unknown addons (Priority: P2)

**Goal**: Build fails when a `.node` addon outside `{better-sqlite3, sqlite-vec}` is bundled.

**Independent Test**: Add a dummy native addon (e.g., bcrypt) to deps, run `npm run build`, expect failure naming the offender.

### Tests for US4

- [ ] T059 [P] [US4] Integration test `tests/integration/native-addon-allowlist.test.ts` — fixture: tarball-install a dummy package containing a `.node` file outside the allowlist; run `build/verify-native-addons.ts`; assert build fails with diagnostic naming the package. Test cleans up. *NFR-002c, US4 AS2, SC-005*
- [ ] T060 [P] [US4] Integration test `tests/integration/native-addon-allowlist-passes.test.ts` — with only `better-sqlite3` + `sqlite-vec` (the allowlisted addons), run `build/verify-native-addons.ts`; assert exit 0. *NFR-002c, US4 AS1*

### Implementation for US4

- [ ] T061 [US4] Verify `build/verify-native-addons.ts` (T020) covers the test cases; harden enumeration per `research.md` §"Open Questions" — lock npm v10+ `node_modules/**/*.node` walk pattern
- [ ] T062 [US4] Wire `postinstall` script in root `package.json` so `npm install` runs the verification automatically (per quickstart.md SC-005)

**Checkpoint**: US4 done. SC-005 verified.

---

## Phase 7: User Story 5 — Egress attempts recorded in telemetry (Priority: P3)

**Goal**: Every egress attempt (blocked or loopback) emits a structured `egress.attempted` / `egress.blocked` / `egress.checkpoint` event to `Paths.telemetry()`.

**Independent Test**: Trigger a synthetic egress; verify event in telemetry stream.

### Tests for US5

- [ ] T063 [P] [US5] Integration test `tests/integration/telemetry-emit-egress.test.ts` — trigger a remote egress attempt; assert `egress.attempted` + `egress.blocked` events appear in `Paths.telemetry()`-resolved JSONL file with all required fields (timestamp, primitive, destination_host, destination_port, request_id, blocked_at). *FR-OBS, US5 AS1*
- [ ] T064 [P] [US5] Integration test `tests/integration/telemetry-emit-os-firewall.test.ts` — child-process firewall block (overlap with T044); assert telemetry event with `blocked_at: 'os_firewall'`. *FR-OBS, US5 AS2*
- [ ] T065 [P] [US5] Integration test `tests/integration/telemetry-size-limit.test.ts` — synthesize an event with a 10 KB destination_host string; assert pre-append assertion `serialized.length <= 4096` rejects. *Constitution IX*

### Implementation for US5

- [ ] T066 [US5] Verify telemetry primitives (T017) cover the FR-OBS schema; harden the size-assertion path; ensure `EgressBlockedError` from the hook (T047) wires to the `egress.blocked` event correctly
- [ ] T067 [P] [US5] Add OS-firewall block detection — when a child process under `runTool` exits with the OS-firewall-rejection signal (e.g., `ECONNREFUSED` or `ENETUNREACH` from a non-loopback target), emit `egress.blocked` with `blocked_at: 'os_firewall'`. Wire from `runTool` (T018) error handler

**Checkpoint**: US5 done. FR-OBS verified.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification suite, documentation, README.

- [ ] T068 [P] Compile `tests/integration/sp001-suite.test.ts` — orchestration that runs all 8 SC verification tests in order matching quickstart.md; emits a Pass/Fail report
- [ ] T069 [P] Author repo-level `README.md` — quickstart instructions, link to `.specify/memory/constitution.md` and `specs/001-local-only-mcp-foundation/`. Per Constitution Principle XVI: NO cross-agent compatibility claims; performance numbers labeled as targets
- [ ] T070 [P] Update repo `CLAUDE.md` to summarize the 16-principle constitution + active feature 001 (already done at plan time; verify current)
- [ ] T071 [P] Coverage report — verify `npm run test -- --coverage` shows ≥95% on `packages/contracts/` per ARCHITECTURE-FINAL §14 Epic 1 exit; ≥90% on `packages/transport/` and `packages/daemon/`
- [ ] T072 Performance check — `tools/list` cold-start latency target (< 200ms on user's machine); `egress.attempted` hook overhead target (< 1ms per call). Per Constitution XVI: TARGETS, not guarantees; failure is investigation-warranted but not a P1 block
- [ ] T073 Final lint pass — `npm run lint` exit 0 with all 5 custom rules active; zero forbidden imports anywhere in the in-scope tree
- [ ] T074 Final type-check — `npm run build` succeeds with strict TypeScript; project-references build resolves clean
- [ ] T075 Single feature-completion commit on branch `001-local-only-mcp-foundation`: "feat(001): SP-001 implementation complete" — bundling all source + tests + lint rules + build scripts. Push.

**Checkpoint**: SP-001 implementation complete. All 8 SP-001 success criteria pass. Feature 001 ready for merge to main once PM review approves (Constitution Governance).

---

## Dependencies

**Phase ordering**:
- Phase 1 (Setup) → Phase 2 (Foundational): T001-T010 must complete before T011-T027
- Phase 2 (Foundational) → Phase 3-7 (User Stories): T015-T021 (impl) must complete before story-impl tasks; tests can be authored in parallel with foundational impl
- Phase 3 (US1) is independent of Phase 4-7 (parallel-eligible if Phase 2 complete)
- Phase 4 (US2) ⟂ Phase 3 (US1): independent in code, but US1 verification (mcp-tools-list) uses the same MCP server US2's hook protects; SP-001 verification suite (T068) requires both
- Phase 5 (US3) is mostly tests + CI wiring; depends on T022 (lint rule impl) from Phase 2
- Phase 6 (US4) depends on T020 (verify-native-addons impl) from Phase 2
- Phase 7 (US5) depends on T017 (telemetry impl) and T047 (egress hook impl)
- Phase 8 depends on Phase 3-7

**Within a phase**:
- All `[P]`-marked tasks in the same phase can run in parallel (different files, no dependencies)
- Non-`[P]` tasks within a phase have implicit ordering (read the task description)

## Parallel Execution Examples

**Phase 2 (foundational) parallelism**:
- T011, T012, T013, T014 (test authoring) can run in parallel
- T015, T016, T017, T019, T021 (impl) can run in parallel
- T022, T023, T024, T025, T026 (custom eslint rules) can run in parallel
- T027 must run after all 5 rules are written

**Phase 4 (US2) parallelism**:
- T037, T038, T039, T040, T041, T042, T045 (tests) can run in parallel
- T046, T049 (loopback classifier + worker bootstrap) can run in parallel
- T047, T048, T050, T052 must serialize on egress-hook impl
- T043 (tcpdump) and T044 (firewall) require T047 + T048 done; can run in parallel

## Implementation Strategy

**MVP scope**: User Story 1 + User Story 2 (both P1) form the SP-001 MVP. US3, US4, US5 are P2/P3 and ship together with the P1 stories per SP-001's bundled scope.

**Recommended order**: Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4 ∥ Phase 5 ∥ Phase 6 ∥ Phase 7) → Phase 8.

**Test-first discipline**: Within each user story phase, tests are authored BEFORE the corresponding implementation. The Constitution-mandated test surface (Constitution V/VII/VIII/IX/XII/XIII/XIV) means failing tests upfront drive the implementation contract — every passing test is a constitutional checkbox earned.

**Total task count**: 75 tasks. Mapped 1:1 to:
- Constitution principles I–XVI: every principle has at least one test or impl task
- Spec.md user stories US1-US5: every user story has its own phase
- Spec.md acceptance scenarios: 17 → covered across phases 3–7
- Spec.md success criteria SC-001 through SC-008: every SC has at least one task
- Plan.md project structure: every package + every contract document maps to tasks

Each task is specific enough that an LLM (or a developer) can complete it without additional context — the file path, the dependency, and the constitutional rationale are inline.
