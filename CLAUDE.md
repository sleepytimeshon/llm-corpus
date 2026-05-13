<!-- SPECKIT START -->
Active feature: **005-retrieval** (SP-005) — hybrid retrieval (BM25 + dense + graph + confidence); spec package authored, ready for `/speckit-tasks`.
Plan: [specs/005-retrieval/plan.md](specs/005-retrieval/plan.md)
Spec: [specs/005-retrieval/spec.md](specs/005-retrieval/spec.md)
Research: [specs/005-retrieval/research.md](specs/005-retrieval/research.md)
Data model: [specs/005-retrieval/data-model.md](specs/005-retrieval/data-model.md)
Checklist: [specs/005-retrieval/checklists/requirements.md](specs/005-retrieval/checklists/requirements.md)
ADRs: [embedding model](specs/005-retrieval/contracts/adr-embedding-model.md) · [RRF fusion](specs/005-retrieval/contracts/adr-rrf-fusion.md) · [edges materialization](specs/005-retrieval/contracts/adr-edges-materialization.md)
Prior art (merged): [specs/004-classifier/plan.md](specs/004-classifier/plan.md) · [specs/003-ingest-pipeline/plan.md](specs/003-ingest-pipeline/plan.md) · [specs/002-mcp-resources/plan.md](specs/002-mcp-resources/plan.md) · [specs/001-local-only-mcp-foundation/plan.md](specs/001-local-only-mcp-foundation/plan.md)
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

## SP-004 surface (semantic classification)

The SP-003 daemon's post-persist hook now auto-invokes the SP-004 classify-stage on each newly-persisted row. A new `corpus reenrich [--dry-run]` CLI subcommand drains the sentinel-row backlog. Both surfaces invoke the SAME `classifyStage` function (Constitution VI — one pipeline, two policies).

**Trigger surfaces** (FR-CLASSIFY-016 commits to zero new MCP mutation surfaces):

- **Daemon post-persist hook** (`packages/daemon/src/index.ts`) — after each SP-003 drain success, re-acquires `Paths.drainLock()` (FR-CLASSIFY-015 drain-lock reuse), iterates `WHERE facet_type='unclassified' ORDER BY ingest_timestamp ASC`, invokes classifyStage under `batchPolicy`. Disable via `classifyEnabled: false` in DaemonOptions for tests / pre-Ollama setups.
- **CLI `corpus reenrich`** (`packages/cli/src/reenrich-command.ts`) — `corpus reenrich` (interactivePolicy + progress on stderr + summary on stdout) and `corpus reenrich --dry-run` (lists docs without Ollama calls or SQL UPDATEs). Concurrent invocation while a daemon drain holds the lock emits `pipeline.lock_contention` and exits 0.

**Telemetry classes emitted by classify-stage** (per Entity 6 of `specs/004-classifier/data-model.md`, 11 SP-004 variants in the `TelemetryEvent` Zod discriminated union; ≤ 4 KB per record):

`classify.started` · `classify.ollama_request` · `classify.ollama_response` · `classify.schema_invalid` · `classify.vocabulary_violation` · `classify.term_proposed` · `classify.completed` · `classify.failed` · `classify.ollama_unavailable` · `classify.batch_halted` · `classify.frontmatter_incomplete`

**Proposed-term routing contract** (FR-CLASSIFY-007 + Principle XV gate, not auto-trigger):

The classifier MAY emit `facet_domain_proposed: string` and/or `facet_tags_proposed: string[]` optional fields. Each entry that is NOT already in the established-vocabulary snapshot is INSERTed via `packages/storage/src/taxonomy-terms-adapter.ts insertProposedTerm(db, axis, term, signal)` — the SQL string contains a hardcoded `'proposed'` state literal; the function signature accepts no state parameter; the promoted-state INSERT is structurally impossible from any SP-004 code path (verified by `tests/integration/no-established-insert-in-sp004.test.ts`). `ON CONFLICT(axis, term) DO NOTHING` collapses duplicate proposals to a single row. `corpus://taxonomy` (SP-002 read contract) continues to surface only `state='established'` rows.

**Atomicity contract** (FR-CLASSIFY-008 + Decision F + ADR-CLASSIFIER-ATOMICITY):

The classify-persister commits the SQL UPDATE + 0..N taxonomy_terms INSERTs + body-file frontmatter rewrite (via `withTempDir` + atomic rename) in a single SQLite transaction (`BEGIN IMMEDIATE → UPDATE → INSERTs → rename → COMMIT`). The `AND facet_type='unclassified'` clause on the UPDATE is defense-in-depth idempotency per FR-CLASSIFY-012. On any failure: ROLLBACK + tmp body file cleanup + `<doc-id>.error.json` sidecar at `Paths.failed()`.

**Per-document budget** (Constitution XVI honesty — empirical, not target):

The SP-004 per-document classifier wall-clock budget is set to 60s (interactive policy) / 300s (batch policy) per Decision D. Empirical measurement against the user's pai-node01 with qwen3.5:9b on CPU is exercised end-to-end via `tests/integration/end-to-end-classify.test.ts` (mock-Ollama-driven for repeatable CI) + the live operator walkthrough in `specs/004-classifier/quickstart.md`. If qwen3.5:9b exceeds the budget on degenerate inputs, the fallback to `gemma3:4b` (Decision A) is a one-line config change in `config.toml [classifier].model`.

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
