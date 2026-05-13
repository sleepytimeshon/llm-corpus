<!-- SPECKIT START -->
Active feature: **004-classifier** (SP-004) — spec + plan + research + data-model + contracts + checklist + quickstart authored; ready for `/speckit-tasks`.
Plan: [specs/004-classifier/plan.md](specs/004-classifier/plan.md)
Spec: [specs/004-classifier/spec.md](specs/004-classifier/spec.md)
Research: [specs/004-classifier/research.md](specs/004-classifier/research.md)
Data model: [specs/004-classifier/data-model.md](specs/004-classifier/data-model.md)
Quickstart: [specs/004-classifier/quickstart.md](specs/004-classifier/quickstart.md)
Checklist: [specs/004-classifier/checklists/requirements.md](specs/004-classifier/checklists/requirements.md)
ADRs: [model choice](specs/004-classifier/contracts/adr-classifier-model-choice.md) · [atomicity](specs/004-classifier/contracts/adr-classifier-atomicity.md)
Prior art (merged): [specs/003-ingest-pipeline/plan.md](specs/003-ingest-pipeline/plan.md) · [specs/002-mcp-resources/plan.md](specs/002-mcp-resources/plan.md) · [specs/001-local-only-mcp-foundation/plan.md](specs/001-local-only-mcp-foundation/plan.md)
Constitution (gates every plan): [.specify/memory/constitution.md](.specify/memory/constitution.md)
<!-- SPECKIT END -->

## SP-002 surface (what this repo ships now)

The MCP server registers four read-only resources alongside the SP-001 `corpus.find` tool:

| URI | List endpoint | Notes |
|---|---|---|
| `corpus://manifest` | `resources/list` | Auto-load annotation. Structural snapshot: doc_count, established_domains, established_tags, last_ingest_timestamp, schema/taxonomy versions. |
| `corpus://taxonomy` | `resources/list` | Promoted-only (Constitution XV). 4-axis envelope: domains, tags, types, source_types. |
| `corpus://recent` | `resources/list` | Last N=10 successful ingests, descending timestamp. Failure-lane + trash excluded. N configurable via `[resources.recent].window_size` in config.toml (range 1-100). |
| `corpus://docs/{id}` | `resources/templates/list` | RFC-6570 template. Per-doc body + frontmatter. The dereferencing target of every `corpus.find` SearchHit URI. |

Every read emits a `resource.read` telemetry event (success AND every failure path). New error envelopes: `-32002 server_initializing`, `-32010 document_not_found`, `-32011 index_locked` (retriable). The empty-baseline schema migration creates `documents` and `taxonomy_terms` SQLite tables; SP-003+ populates them.

SC-010 read-only enforcement is by construction: the `no-writes-from-resource-handlers` ESLint rule scopes the four resource handlers and four storage adapters; any INSERT/UPDATE/DELETE/CREATE/DROP/ALTER in `.exec()`/`.run()` or any `fs.write*`/`fs.append*`/`fs.mkdir*` call hard-fails the build.

# Working in this repo

This is a local-first knowledge substrate. Sixteen NON-NEGOTIABLE principles in [`.specify/memory/constitution.md`](.specify/memory/constitution.md) govern every change. Every feature plan must pass a 16-checkbox Constitution Check; violations require Complexity Tracking justification.

## Constitutional non-negotiables (top of mind)

- **I. No egress.** No code path may reach a non-localhost endpoint. Default inference + embedding + index adapters are local. Cloud fallback is forbidden in v1.0.0.
- **III. Substrate, not surface.** Two surfaces only: `corpus` CLI (one-shot text) and the MCP stdio transport. No HTTP server, no TUI, no browser, no agent-facing mutations.
- **VII. Cancellable, bounded IO.** Every external IO call takes an `AbortSignal`. `Promise.race` against `setTimeout` is forbidden — use `AbortController`.
- **XI. Library/CLI boundary.** No `process.exit` in `packages/{contracts,core,storage,index,inference,extract,pipeline}/`. Library functions return `Result<T, E>` or throw typed errors.
- **XII. Subprocess hygiene.** All subprocess invocation goes through `runTool(name, args[], opts)` with arg arrays. `execSync`, `exec`, and string-formed shell commands are forbidden.
- **XIII. Telemetry-or-die.** Every catch block emits a structured event before throwing or returning. AST-level lint enforcement lands in SP-003.
- **XIV. XDG paths.** Every path goes through `Paths.{data,state,config,cache}()`. The single user override is `CORPUS_HOME`. No writes outside `$HOME`.

The full 16 principles are in the constitution file. Read it before any non-trivial change.

## Source-of-truth hierarchy

When two artifacts disagree, the higher-numbered authority wins:

1. `WHITEPAPER-FINAL.md` — informational only.
2. `.product/CHARTER.md` — immutable. Original intent + WHITEPAPER SHA.
3. `.product/` non-charter artifacts — frozen at `pre-speckit-archive`. Reference-only.
4. `ARCHITECTURE-FINAL.md` — frozen at `pre-speckit-archive`. Reference-only.
5. `.specify/memory/constitution.md` — governing principles.
6. `specs/NNN-{slug}/spec.md` — per-feature specifications.
7. `specs/NNN-{slug}/plan.md` — per-feature plans (Constitution Check gated).
8. `specs/NNN-{slug}/tasks.md` — per-feature task lists.

## Workflow

Feature lifecycle uses spec-kit slash commands:

1. `/speckit-specify "feature description"` — creates `specs/NNN-{slug}/spec.md` and a feature branch.
2. `/speckit-clarify` — optional Q&A round.
3. `/speckit-plan` — produces `plan.md` after the Constitution Check gate.
4. `/speckit-tasks` — produces `tasks.md` from the locked plan.
5. `/speckit-implement` — executes tasks in order.

## Commit discipline

- Conventional Commits (`feat(scope): subject`, `fix(scope): subject`, etc.).
- Every commit on a feature branch references the feature slug in branch name or commit body.
- `--no-verify` is forbidden.
- Force-push to `main` is forbidden. Feature branches may be force-pushed by the author until merge.

## Stack

- TypeScript 5.5+ strict mode; Node.js 20+ runtime.
- npm workspaces monorepo under `packages/`.
- vitest for unit + integration testing.
- ESLint 9 flat config with six custom rules:
  - `no-forbidden-network-imports` — NFR-001 lint scope.
  - `no-process-exit-in-libs` — Constitution XI.
  - `paths-from-resolver-only` — Constitution XIV.
  - `no-direct-worker-spawn` — Constitution XII / NFR-002a.
  - `no-shell-string-exec` — Constitution XII.
  - `no-writes-from-resource-handlers` — SC-010 / Constitution III. Scoped to the four SP-002 resource-handler files and four storage adapters.
- `@modelcontextprotocol/sdk`, `undici`, `zod`, `better-sqlite3`, `sqlite-vec`, `js-yaml`, `@iarna/toml`.

## Extending

- New feature: run `/speckit-specify`. Stay strictly on the feature branch.
- New native addon: update the allowlist in `build/verify-native-addons.ts` AND cite the allowlist promotion in the feature plan's Complexity Tracking if the addon is not in `{better-sqlite3, sqlite-vec}`.
- New custom lint rule: add under `tools/eslint-rules/`, register in `eslint.config.js`, add a fixture suite under `tests/lint-fixtures/`.
- New egress primitive (uncommon): patch in `packages/transport/src/egress-hook.ts`, add a test pair (block + loopback passthrough), update `contracts/egress-hook-api.md`.
- New telemetry event class: add Zod schema in `packages/contracts/src/telemetry.ts` as a variant of the `TelemetryEvent` discriminated union, document in a new `contracts/telemetry-{class}-events.md`. SP-002 added `resource.read`.
- New MCP resource: add a Zod payload schema in `packages/contracts/src/resource-schemas.ts`, a read-only adapter in `packages/storage/`, a handler in `packages/transport/src/resource-{name}-handler.ts`, register via `BuiltMcpServer.registerStaticResource()` (or `registerResourceTemplate()` for URI templates) inside `startMcpServer()`. The `no-writes-from-resource-handlers` rule MUST be scoped to the new handler + adapter in `eslint.config.js`.

## Honesty rules (Constitution XVI)

- Performance numbers are targets, not guarantees.
- Cross-agent compatibility is a property of the MCP protocol, not a v1 user-validated feature.
- README, CLI `--help`, and any docs MUST NOT claim cross-agent compatibility as v1 user-validated.
- v1 ships no formal retrieval-evaluation harness; the 50-query labeled benchmark is Future Work (v1.5+).

## Verification gate (before commit)

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
npm run test:lint
npm test
npm run verify:native-addons
```

Root-gated tests (`LLM_CORPUS_ROOT_TESTS=1`) are optional outside CI; they run under `sudo` for the iptables/tcpdump SCs (SC-002, SC-004).
