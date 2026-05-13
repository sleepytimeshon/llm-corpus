# llm-corpus Session State

**Last updated:** 2026-05-13 (SP-005 merged — install-ready milestone reached)
**Authoritative:** this file. Memory pointers in ~/.claude reference here.

## Current status

| Sprint | Scope | Status |
|---|---|---|
| SP-001 | Local-only MCP foundation | ✅ Merged |
| SP-002 | 4 read-only MCP resources (manifest / taxonomy / recent / docs/{id}) | ✅ Merged (PR #3) |
| SP-003 | Ingest pipeline — inbox watcher → validation → hash → normalize → persist | ✅ Merged 2026-05-12 (PR #11; daemon fix #12) |
| SP-004 | Semantic classification — Ollama grammar-constrained metadata + dynamic vocabulary + proposed-term routing | ✅ Merged 2026-05-13 (PR #13, commit 33f233c) |
| SP-005 | Hybrid retrieval — BM25 + dense + graph + confidence + RRF fusion | ✅ **Merged 2026-05-13 (PR #14, commit 7592eb9)** |
| SP-006 | Kill-9 survival + `corpus://failures` MCP resource + Tier 1/2/3 fallthrough | ⏳ Production hardening (not blocking install/use) |

**Branch:** `main` clean. SP-001 through SP-005 all merged.

## Install-ready milestone — REACHED

The substrate is install-ready in the sense the user directed:

| Capability | Sprint | State |
|---|---|---|
| User drops files in inbox, system ingests | SP-003 | ✅ Ready |
| System classifies metadata so the corpus is structured | SP-004 | ✅ Ready |
| System embeds + indexes for semantic search | SP-005 | ✅ **Ready** |
| `corpus.find` MCP tool returns ranked relevant docs | SP-005 | ✅ **Ready** |
| `corpus reindex [--dry-run]` CLI for manual backfill | SP-005 | ✅ Ready |

The agent can now:
1. Drop documents into `Paths.inbox()`
2. Wait for the daemon's autonomous chain (ingest → classify → embed → index → edges-build)
3. Call `corpus.find` via the MCP tool and receive ranked SearchHit lists with `score`, `uri`, `title`, `facet_domain`, `facet_type`, `tags`, `snippet`

### What you need to install (on a fresh machine)

1. Clone the repo, `npm install`
2. Pull two Ollama models:
   - `ollama pull qwen3.5:9b` (or `gemma3:4b` for lighter; for SP-004 classifier)
   - `ollama pull nomic-embed-text` (for SP-005 embeddings)
3. `npm run build`
4. `node packages/cli/dist/index.js init`
5. `node packages/cli/dist/index.js daemon` to start autonomous processing
6. Drop files into `$CORPUS_HOME/data/inbox/` to begin filling with knowledge

Walkthrough details: `specs/004-classifier/quickstart.md` + `specs/005-retrieval/quickstart.md`.

## SP-006 — production hardening (next sprint, NOT install-blocking)

Per SP-003 plan.md defer list and SP-005 anti-scope:

- **Kill-9 cross-stage recovery** — currently if the process is killed mid-classify or mid-embed, the row may be in an inconsistent state until the next drain catches it. SP-006 adds explicit recovery semantics: on daemon startup, detect orphaned in-flight work and either resume or fail-cleanly.
- **`corpus://failures` MCP resource** — currently failure-lane `.error.json` sidecars live on disk; SP-006 exposes them as a read-only MCP resource so agents can introspect what failed and why.
- **Tier 1/2/3 fallthrough** — Tier 0 (hybrid) is the only tier shipped; Tier 1 (BM25-only fast path), Tier 2 (grep CATALOG.md), Tier 3 (filesystem grep over `docs/`) are not yet wired. The tier model in ARCHITECTURE-FINAL §10.6 specifies latency targets for each tier; SP-006 builds the fallthrough.

## Resumption protocol (continued from SP-004 era)

Pallas owns all tactical workflow per Shon's standing directive (2026-05-12+):
- PR creation / merges / branch ceremony
- Constitution-check failures (resolved by Pallas, never escalated)
- Agent management / swarming / context budgeting

User involvement only when:
- 100% required (genuine blocker)
- Major milestone reached (install-ready, SP-006 complete, etc.)

When the user types continuation signal ("keep going", "continue", etc.), the next autonomous turn picks up at SP-006 hardening.

## Pre-resolved constraints for SP-006

- Kill-9 recovery: leverage the existing telemetry JSONL append-only log to detect in-flight work; on daemon startup, scan for `*.started` events without matching `*.completed` / `*.failed`
- `corpus://failures` resource: read-only MCP resource per Constitution III; list `Paths.failed()/*.error.json` sidecar files; return structured error envelope per FR-004
- Tier fallthrough: implemented in the search orchestrator; if Tier 0 (hybrid) returns fewer than `min_results` hits, fall through to Tier 1 (BM25-only on FTS5 — same table, lighter query), then Tier 2 (grep CATALOG.md), then Tier 3 (filesystem grep over `docs/`). Each tier has an aggregate latency budget; matched tier reported in hit metadata.

## Operating principles invoked (carries forward from SP-004 / SP-005)

- `feedback-pallas-drives-tactical-workflow` — methodology, ceremony, plumbing owned by Pallas
- `feedback-no-stop-recommendations` — continue executing under max-effort directive
- `feedback-pr-merges-and-ceremony-are-mine` — Pallas decides merge timing
- `feedback-primary-sources-only` — verify subagent claims with tools
- `feedback-verify-or-retract` — every load-bearing claim is tool-verified
- `feedback-build-tier-sizing-rule` — split builds; SP-005 single-dispatch succeeded at ~8.6K LOC
- `feedback-spec-contradictions-pre-build-lint` — pre-build review catches design drift (caught the SP-005 single-transaction claim against the actual two-transaction implementation)
