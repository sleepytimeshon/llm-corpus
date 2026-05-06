# llm-corpus

Local-first knowledge substrate for the user's primary AI terminal agent. Normalizes documents to Markdown with structured frontmatter, classifies them through a local LLM, and exposes the corpus to any MCP-aware agent over a stdio Model Context Protocol server.

The system runs entirely on the user's machine. No document body, frontmatter, embedding, classification, or query string transmits to any non-localhost endpoint during normal operation. See [Constitution Principle I](.specify/memory/constitution.md#i-local-first-no-egress-non-negotiable).

## Status

Feature 001 (`001-local-only-mcp-foundation`) — security primitive + MCP foundation. The MCP server returns an empty `SearchHit[]` in v1; ranking and ingest land in subsequent features (SP-003 through SP-005).

## Requirements

- Linux (Fedora 43+ baseline) or macOS. Windows out of scope for v1.
- Node.js 20 LTS or 22 LTS.
- npm (bundled with Node).

## Install

```bash
git clone <repo-url> ~/Projects/llm-corpus
cd ~/Projects/llm-corpus
npm install
```

`npm install` runs the native-addon allowlist verification post-install. The v1 allowlist is `better-sqlite3` and `sqlite-vec`. Adding any other native addon requires an explicit allowlist update in `build/verify-native-addons.ts`.

## Build

```bash
npm run build
```

Project-references TypeScript build across the `packages/` workspaces.

## Run

Start the MCP server (stdio transport only — HTTP/SSE/TCP refused per spec):

```bash
npm run mcp:start
```

A connected MCP-aware client receives one tool: `corpus.find`. Cold-start `tools/list` requests during bootstrap return `code: -32002, message: "server_initializing"` so clients can implement a clean retry.

## Test

```bash
npm run lint                  # forbidden-import lint + custom rules
npm run build                 # strict TypeScript build
npm test                      # full unit + integration + lint-fixture suite
npm run test:unit             # unit tests only
npm run test:integration      # integration tests only (root-gated tests skip)
npm run test:lint             # lint-rule fixture tests
npm run verify:native-addons  # native-addon allowlist scan
```

Two integration tests require root and are gated behind `LLM_CORPUS_ROOT_TESTS=1`:

- `tcpdump-sentinel.test.ts` — captures non-loopback traffic during a sentinel cycle (SC-002).
- `child-process-firewall.test.ts` — installs a UID-scoped iptables rule and verifies child-process egress is rejected at the OS layer (SC-004).

Run them with:

```bash
sudo LLM_CORPUS_ROOT_TESTS=1 npm run test:integration:root
```

## Project structure

- `packages/contracts/` — pure types, zero IO. `Result<T,E>`, `Paths` resolver, telemetry primitives, `runTool`.
- `packages/transport/` — MCP stdio server. The egress hook bootstraps here.
- `packages/daemon/` — Worker-thread spawn guard.
- `packages/cli/` — `corpus` binary entry point.
- `packages/{storage,index,inference,extract,pipeline}/` — empty stubs; lint rules apply now, content lands in SP-002+.
- `tools/eslint-rules/` — five custom rules enforcing Constitution principles.
- `build/` — `verify-native-addons.ts` and the manual `verify-firewall-rule.sh` rig.
- `tests/{unit,integration,lint-fixtures}/` — vitest suites.
- `specs/001-local-only-mcp-foundation/` — feature 001 spec + plan + tasks + contracts.
- `.specify/memory/constitution.md` — 16 governing principles; gates every feature plan.

## Documentation

- [Constitution](.specify/memory/constitution.md) — 16 principles, ratified 2026-05-05.
- [Feature 001 spec](specs/001-local-only-mcp-foundation/spec.md) — local-only enforcement + MCP foundation.
- [Feature 001 plan](specs/001-local-only-mcp-foundation/plan.md) — Constitution Check + technical context.
- [Feature 001 quickstart](specs/001-local-only-mcp-foundation/quickstart.md) — verifying success criteria SC-001 through SC-008.
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI agents working in this repo.

## Performance targets

Targets, not guarantees, per [Constitution Principle XVI](.specify/memory/constitution.md#xvi-validation-honesty):

- Cold-start `tools/list` response: under 200 ms on the primary user's machine.
- Egress hook overhead: under 1 ms per intercepted call.
- Build-time native-addon verification: under 5 seconds.
- Lint scan over pipeline + adapter packages: under 10 seconds.

These targets reflect the design intent; they become guarantees only when a benchmark suite in CI confirms them on the primary user's hardware.

## License

Single-user, single-machine project. License terms are not yet defined.
