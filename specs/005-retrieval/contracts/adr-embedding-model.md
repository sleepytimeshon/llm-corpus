# ADR — Embedding model choice: nomic-embed-text (768-dim) primary

**Feature**: 005-retrieval
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-005 requires a local embedding model to produce per-document and per-query dense vectors for the hybrid retriever's dense-cosine signal (ARCHITECTURE-FINAL §10.2). The user's primary machine (pai-node01, Fedora 43+, CPU-only inference baseline) has several models pre-loaded under Ollama 0.21.0; `nomic-embed-text` was pulled and verified as part of the pre-flight check on 2026-05-13.

The embedding task is constrained:

- Per-document: embed the concatenated `(title + summary + facet_topic + tags + body_excerpt)` text (typically 100-600 words) — used at index time, stored in `documents_vec`.
- Per-query: embed the user's query string (≤ 2048 chars) — used at search time, ephemeral.
- Output dimension MUST match the `documents_vec` virtual table's `float[N]` declaration; v1 hardcodes N=768. Schema-version bump is required for dimension changes.
- Cosine similarity is the comparison metric (sqlite-vec's `vec_distance_cosine`).

Per Constitution Principles I, IV, and XVI, the model:

- MUST run locally against `http://localhost:11434` (Principle I — no egress).
- MUST be usable on the user's actual hardware without purchases (Principle IV — single-user / single-machine).
- MUST have its choice be honest, documented, and substitutable via config (Principle XVI — no marketing claims).

## Decision

**Primary embedding model**: `nomic-embed-text` (~274 MB on-disk, pre-pulled on pai-node01).

**Output dimension**: 768.

**Selection mechanism**: The active model is config-driven via `[embedding].model` in `config.toml`. Default value: `nomic-embed-text`. Switching to a different model requires (a) editing the config, (b) manually deleting existing embeddings (`DELETE FROM documents_vec`), (c) running `corpus reindex` to backfill new-dimension embeddings. The schema's `float[768]` declaration is the hardcoded dimension fingerprint for v1; future ADR may extend with model-name-stored embeddings to detect model swaps automatically.

The model name is passed as the `model` field in every Ollama `/api/embeddings` request body (Decision D in research.md). The `EmbeddingAdapter` validates the response's `embedding` array length against the configured expected dimension (768); mismatch raises `EmbeddingDimensionMismatchError` BEFORE the vector reaches the persister.

## Rationale

**Pre-loaded on the user's machine**: nomic-embed-text was pulled on pai-node01 as part of the SP-005 pre-flight verification (2026-05-13). Zero install-time burden in SP-005 development.

**Retrieval-tuned**: nomic-embed-text was trained specifically for text retrieval and semantic search (vs. general-purpose models like `all-minilm-l6-v2`). The 768-dim output is the standard for retrieval-tuned models in the open-source ecosystem.

**Quality / latency tradeoff on CPU**: Embedding a 500-word body excerpt completes in sub-second on the user's pai-node01 (CPU-only). The 768-dim vector adds 3072 bytes per document to `documents_vec` storage (float32 × 768) — negligible at any plausible corpus size (10k docs = ~31 MB).

**Compact**: ~274 MB on-disk fits comfortably alongside the SP-004 chat models (qwen3.5:9b at ~5.5 GB, gemma3:4b at ~3 GB) and leaves the user's disk budget intact.

**Stable license**: nomic-embed-text is Apache 2.0 (verified via the model card); no license concerns for v1 distribution.

**Local-only by construction (Principle I)**: Served by Ollama at `http://localhost:11434/api/embeddings`. The OllamaEmbeddingAdapter (`packages/inference/src/embedding-adapter.ts`) has no cloud-API code path; reaching a non-localhost destination would hard-fail with `EgressBlockedError` from the SP-001 egress hook.

**Honest framing (Principle XVI)**: This ADR does NOT claim nomic-embed-text is "the best" embedding model for hybrid retrieval. It claims nomic-embed-text is a defensible primary choice given the user's verified-loaded state, the CPU-only constraint, the retrieval-specific tuning, and the 768-dim standard. Future model releases or quality data may merit re-evaluation via a follow-up ADR.

## Alternatives considered

**`mxbai-embed-large` (1024-dim)**: Slightly higher quality on some retrieval benchmarks (MTEB). Larger output dimension → larger `documents_vec` storage (~41 MB for 10k docs). Not pre-loaded on pai-node01. Rejected for v1 — nomic-embed-text is the conservative match to existing state. Future ADR could revisit if quality data demands.

**`all-MiniLM-L6-v2` (384-dim) via ONNX/transformers.js**: Smaller (~90 MB), faster on CPU (~2x). Bundling the model in-process via transformers.js or ONNX runtime adds dependency surface (a new native or WASM dependency). Rejected for v1 — Ollama-as-embedding-server is the architectural fit (mirrors SP-004's classifier transport; one HTTP endpoint, one egress-hook integration point).

**`bge-large-en-v1.5` (1024-dim)**: Higher quality than nomic-embed-text on some benchmarks. Not pre-loaded. Rejected for v1.

**`gte-large` (1024-dim)**: Similar to bge-large. Not pre-loaded. Rejected.

**OpenAI `text-embedding-3-small` / `text-embedding-3-large`**: FORBIDDEN by Principle I (cloud API). Not real alternatives.

**Anthropic / Cohere embedding APIs**: FORBIDDEN by Principle I.

**Hand-rolled BM25-only retrieval (skip dense entirely)**: Would violate FR-003 verbatim ("the four signals MUST all be inputs"). Reject — FR-003 is non-negotiable.

**Multi-model ensembling (run two embedding models, average vectors)**: Doubles latency without clear quality lift. Rejected for v1.

**Chunked embeddings (per-paragraph)**: Higher recall on long documents. v1 ships per-document granularity (one vector per doc) per ARCHITECTURE-FINAL §10.2. Future ADR.

## Consequences

**Positive**:

- Zero install-time model downloads for SP-005 (nomic-embed-text already pulled).
- Mature, retrieval-tuned model with stable license.
- Mirrors SP-004's HTTP-against-Ollama transport pattern; no new architectural surface.
- 768-dim is the standard; future retrieval research papers and benchmarks are easily comparable.
- The `EmbeddingDimensionMismatchError` at the adapter boundary catches dimension drift defensively (e.g., if Ollama returns an unexpected dimension due to a future model update).

**Negative / Risk**:

- **R3 (plan.md)**: Embedding dimension is hardcoded at 768. A future ADR adding model-name-stored embeddings would let the implementation auto-detect model swaps; v1 requires manual `DELETE FROM documents_vec` + `corpus reindex` on model change. Documented in quickstart.md troubleshooting.
- **Per-document CPU latency**: Sub-second on pai-node01 for typical body excerpts (500 words). Pathological inputs (multi-thousand-word body excerpts) could push toward several seconds; the index-stage budget (10 s interactive / 30 s batch per Decision L in research.md) accommodates this.
- **`nomic-embed-text` may be superseded**: Open-source embedding research moves quickly. The v1 commitment is to the named model; a v2 ADR may switch. The config-driven model name makes the switch a one-line change.
- **Ollama version skew**: The `/api/embeddings` endpoint is well-supported across Ollama 0.5+. The user's 0.21.0 is well past the threshold. Documented in R1 + quickstart.md.

**Migration path to a different model**: A future ADR may supersede this one with a different primary model. The change surface is:

1. Update `[embedding].model` default in `config.toml`.
2. Update `documents_vec` virtual-table dimension declaration (if changed) → schema-version bump → migration.
3. Update PREREQ unit test fixture to use the new model name and expected dimension.
4. Run `corpus reindex` against existing classified docs to backfill.
5. Re-measure SC-RETRIEVAL-001 + SC-RETRIEVAL-021 empirical wall-clock; record in plan.md Performance Goals footnote.

No code change required beyond the migration script (the model name and dimension are fully data-driven).

## References

- Constitution Principle I (Local-First, No Egress)
- Constitution Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)
- Constitution Principle V (Schema-Enforced Structured Output)
- Constitution Principle XVI (Validation Honesty)
- `specs/005-retrieval/research.md` Decision A
- `specs/005-retrieval/plan.md` Risk Register R3
- Ollama embedding API docs (`/api/embeddings`)
- nomic.ai model card for `nomic-embed-text`
- ARCHITECTURE-FINAL §10.2 (Dense vector retrieval)
- Pre-flight verification: `ollama pull nomic-embed-text` confirmed on pai-node01 (2026-05-13)
