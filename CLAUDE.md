<!-- SPECKIT START -->
Active feature: **001-local-only-mcp-foundation** (SP-001) — implementation complete; merge-ready.
Plan: [specs/001-local-only-mcp-foundation/plan.md](specs/001-local-only-mcp-foundation/plan.md)
Spec: [specs/001-local-only-mcp-foundation/spec.md](specs/001-local-only-mcp-foundation/spec.md)
Constitution (gates every plan): [.specify/memory/constitution.md](.specify/memory/constitution.md)
<!-- SPECKIT END -->

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
- ESLint 9 flat config with five custom rules:
  - `no-forbidden-network-imports` — NFR-001 lint scope.
  - `no-process-exit-in-libs` — Constitution XI.
  - `paths-from-resolver-only` — Constitution XIV.
  - `no-direct-worker-spawn` — Constitution XII / NFR-002a.
  - `no-shell-string-exec` — Constitution XII.
- `@modelcontextprotocol/sdk`, `undici`, `zod`, `better-sqlite3`, `sqlite-vec`.

## Extending

- New feature: run `/speckit-specify`. Stay strictly on the feature branch.
- New native addon: update the allowlist in `build/verify-native-addons.ts` AND cite the allowlist promotion in the feature plan's Complexity Tracking if the addon is not in `{better-sqlite3, sqlite-vec}`.
- New custom lint rule: add under `tools/eslint-rules/`, register in `eslint.config.js`, add a fixture suite under `tests/lint-fixtures/`.
- New egress primitive (uncommon): patch in `packages/transport/src/egress-hook.ts`, add a test pair (block + loopback passthrough), update `contracts/egress-hook-api.md`.
- New telemetry event class: add Zod schema in `packages/contracts/src/telemetry.ts`, document in `contracts/telemetry-egress-events.md`.

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
