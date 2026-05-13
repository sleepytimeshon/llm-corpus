# llm-corpus Session State

**Last updated:** 2026-05-13 (SP-004 PR opened)
**Authoritative:** this file. Memory pointers in ~/.claude reference here.

## Current status

| Sprint | Scope | Status |
|---|---|---|
| SP-001 | Local-only MCP foundation | ✅ Merged (PR #?) |
| SP-002 | 4 read-only MCP resources (manifest / taxonomy / recent / docs/{id}) | ✅ Merged (PR #3) |
| SP-003 | Ingest pipeline — inbox watcher → validation → hash → normalize → persist | ✅ Merged 2026-05-12 (PR #11; daemon fix #12) |
| SP-004 | Semantic classification — Ollama grammar-constrained metadata + dynamic vocabulary + proposed-term routing | 🟡 **PR #13 open, CI running 2026-05-13** |
| SP-005 | Embedding + ranking + retrieval (makes `corpus.find` return real SearchHits) | ⏳ Not started |
| SP-006 | Kill-9 survival + `corpus://failures` MCP resource | ⏳ Not started |

**Branch:** `004-classifier` pushed; PR #13 at https://github.com/sleepytimeshon/llm-corpus/pull/13

## What "install-ready and fill with knowledge" means

User directive: deliver a finished product ready to install and start filling with knowledge.

| Capability | Sprint that delivers it | State |
|---|---|---|
| User drops files in inbox, system ingests | SP-003 | ✅ Ready today |
| System classifies metadata so the corpus is structured | SP-004 | 🟡 In PR review |
| System embeds + indexes for semantic search | SP-005 | ⏳ Required for `corpus.find` to return non-empty |
| System survives crashes / shows failure resource | SP-006 | ⏳ Production hardening |

**Minimum install-ready:** SP-004 merged + SP-005 merged. Without SP-005, `corpus.find` returns empty even on classified rows — the agent can ingest but can't search.

**Production-ready:** also SP-006 for crash recovery.

## Next-turn pickup (SP-005)

When resuming autonomously, the next sprint is SP-005 (embedding + ranking + retrieval).

**Per SP-003 plan.md defer list:** "Embedding/ranking to SP-005 (FR-015/FR-002/FR-003/FR-004)."

Pre-resolved design pointers from prior architecture:
- `ARCHITECTURE-FINAL.md` §10 — hybrid retrieval architecture (BM25 / sqlite-vec / FTS5 multi-tier)
- `WHITEPAPER-FINAL.md` — semantic search section
- `packages/inference/src/index.ts` after SP-004 — exports OllamaAdapter; SP-005 adds EmbeddingAdapter alongside
- `packages/index/` — exists but possibly empty; SP-005 fills it with `IndexAdapter` (FTS5 + sqlite-vec composite)
- `packages/transport/src/` — `corpus.find` tool handler currently returns empty SearchHits; SP-005 wires it through the new IndexAdapter
- `sqlite-vec ^0.1.0` already in dependencies — no need to add

SP-005 spec authoring should follow the same speckit workflow:
1. Create branch `005-retrieval` after SP-004 merges
2. `specs/005-retrieval/` with spec / plan / data-model / research / contracts / tasks / checklist
3. New telemetry classes: `embed.*`, `search.*`
4. New errors: `EmbeddingError`, `IndexLockedError` (the latter already exists per SP-002)
5. Implementation in `packages/inference/` (EmbeddingAdapter), `packages/index/` (composite FTS5+vec adapter), `packages/transport/` (`corpus.find` handler wiring)

## Resumption protocol

Pallas (the AI agent) drives all tactical workflow per the user's standing directive (2026-05-12+). No user involvement in:
- PR creation / merges / branch ceremony
- Constitution-check failures or spec/contract violations (Pallas resolves)
- Agent management / swarming / context budgeting

User involvement only when:
- 100% required (genuine blocker)
- Final product ready to install + ingest knowledge

When the user types anything that signals continuation ("what's next", "continue", "keep going", etc.) on this project, the autonomous turn picks up at SP-005 unless SP-004 PR is still pending — in which case the first task is to monitor + merge SP-004.

## Operating principles invoked

- `feedback-pallas-drives-tactical-workflow` — methodology, ceremony, plumbing all owned by Pallas
- `feedback-no-stop-recommendations` — continue executing under max-effort directive
- `feedback-pr-merges-and-ceremony-are-mine` — Pallas decides merge timing
- `feedback-no-session-churn` — build on prior docs; SP-005 inherits from SP-004 patterns
- `feedback-primary-sources-only` — verify subagent claims with tools; never trust summaries
- `feedback-build-tier-sizing-rule` — split builds >2000 LOC into pre-planned N≥2 Engineer agents
- `feedback-verify-or-retract` — claims must be tool-verified

## Pre-resolved constraints for SP-005

To avoid re-litigating in the next turn:
- Embedding model: local Ollama; specific model TBD by SP-005 research (likely `nomic-embed-text` or similar small embedding model)
- Vector store: sqlite-vec ^0.1.0 (already in dependencies)
- Retrieval hybrid: FTS5 (lexical) + sqlite-vec (semantic) + score-combined ranking
- `corpus.find` returns `Array<{ id: string, score: number, snippet: string, frontmatter: Frontmatter }>` per MCP-resource template signatures already defined in SP-002

Do NOT in SP-005:
- Add cloud-fallback embedding (Constitution I forbids)
- Add evaluation harness as success criterion (Constitution XVI defers eval to v1.5+)
- Re-tier retrieval beyond what ARCHITECTURE-FINAL §10 specifies without a separate ADR
