# llm-corpus

Local-first knowledge substrate for the user's primary AI terminal agent. Normalizes documents to Markdown with structured frontmatter, classifies them through a local LLM, and exposes the corpus to any MCP-aware agent over a stdio Model Context Protocol server.

The system runs entirely on the user's machine. No document body, frontmatter, embedding, classification, or query string transmits to any non-localhost endpoint during normal operation. See [Constitution Principle I](.specify/memory/constitution.md#i-local-first-no-egress-non-negotiable).

## Status

- **Feature 001 (`001-local-only-mcp-foundation`)** — security primitive + MCP foundation. Egress hook live, MCP stdio server registered with `corpus.find` tool.
- **Feature 002 (`002-mcp-resources`)** — four read-only MCP resources (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, `corpus://docs/{id}`), `resource.read` telemetry event class, and the SP-002 baseline schema migration (`documents` + `taxonomy_terms` tables). The MCP server returns empty/baseline payloads on the SP-001 empty index; populated-corpus paths verified against fixtures (SC-005, SC-006, SC-007). Ranking and ingest land in SP-003 through SP-005.

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

A connected MCP-aware client receives:
- One tool: `corpus.find`.
- Three static resources: `corpus://manifest`, `corpus://taxonomy`, `corpus://recent`.
- One URI template: `corpus://docs/{id}` for per-document dereference.

`corpus://manifest` carries the standard MCP auto-load annotation (`audience: ['assistant']`, `priority: 1.0`) — clients that honor the annotation can fetch it at session start without an explicit request. The other three resources are read-on-demand.

Cold-start `tools/list`, `resources/list`, `resources/templates/list`, and `resources/read` requests during bootstrap return `code: -32002, message: "server_initializing"` so clients can implement a clean retry. Per-document reads also surface `-32010 document_not_found` and `-32011 index_locked` (retriable) error envelopes.

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

- `packages/contracts/` — pure types, zero IO. `Result<T,E>`, `Paths` resolver, telemetry primitives + `ResourceReadEvent`, the four resource payload Zod schemas, `runTool`, `parseMarkdownWithFrontmatter`, version constants.
- `packages/transport/` — MCP stdio server. The egress hook bootstraps here. Hosts the four resource handlers + `emitResourceRead` helper.
- `packages/storage/` — read-only adapters: `manifest-adapter`, `taxonomy-adapter`, `recent-adapter`, `document-adapter`. SQLite open helper (WAL, busy_timeout=5000ms), schema migration (`documents` + `taxonomy_terms`), config loader, fixture loader (test-only).
- `packages/daemon/` — Worker-thread spawn guard.
- `packages/cli/` — `corpus` binary entry point.
- `packages/{index,inference,extract,pipeline}/` — empty stubs; lint rules apply now, content lands in SP-003+.
- `tools/eslint-rules/` — six custom rules enforcing Constitution principles. SP-002 adds `no-writes-from-resource-handlers` (SC-010 read-only-by-construction).
- `build/` — `verify-native-addons.ts` and the manual `verify-firewall-rule.sh` rig.
- `tests/{unit,integration,lint-fixtures,fixtures/sp002-populated}/` — vitest suites + source-controlled fixture templates.
- `specs/001-local-only-mcp-foundation/` — feature 001 spec + plan + tasks + contracts.
- `specs/002-mcp-resources/` — feature 002 spec + plan + tasks + contracts (mcp-resources-api, four resource payload contracts, telemetry-resource-events).
- `.specify/memory/constitution.md` — 16 governing principles; gates every feature plan.

## Documentation

- [Constitution](.specify/memory/constitution.md) — 16 principles, ratified 2026-05-05.
- [Feature 001 spec](specs/001-local-only-mcp-foundation/spec.md) — local-only enforcement + MCP foundation.
- [Feature 001 plan](specs/001-local-only-mcp-foundation/plan.md) — Constitution Check + technical context.
- [Feature 001 quickstart](specs/001-local-only-mcp-foundation/quickstart.md) — verifying success criteria SC-001 through SC-008.
- [Feature 002 spec](specs/002-mcp-resources/spec.md) — four read-only MCP resources.
- [Feature 002 plan](specs/002-mcp-resources/plan.md) — Constitution Check + dependency map on SP-001.
- [Feature 002 quickstart](specs/002-mcp-resources/quickstart.md) — verifying success criteria SC-001 through SC-010.
- [`CLAUDE.md`](CLAUDE.md) — guidance for AI agents working in this repo.

## Performance targets

Design-intent latency targets are documented in [`specs/002-mcp-resources/research.md`](specs/002-mcp-resources/research.md); v1 ships without a CI-confirmed benchmark suite, so per [Constitution Principle XVI](.specify/memory/constitution.md#xvi-validation-honesty) (validation honesty) no numerics are surfaced here.

## License

Single-user, single-machine project. License terms are not yet defined.
