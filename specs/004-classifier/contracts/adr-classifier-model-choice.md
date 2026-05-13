# ADR — Classifier model choice: qwen3.5:9b primary, gemma3:4b fallback

**Feature**: 004-classifier
**Date**: 2026-05-13
**Status**: Accepted
**Supersedes**: none
**Superseded by**: none

## Context

SP-004 requires a local LLM that supports Ollama 0.5+ token-grammar-constrained generation via the `format` parameter (JSON Schema). The user's primary machine (pai-node01, Fedora 43+, CPU-only inference baseline) has several models pre-loaded under Ollama 0.21.0. SP-004 needs to pick a primary model and a fallback for the case where the primary's wall-clock budget is exceeded or the primary becomes unavailable.

The classification task is constrained:
- One facet_domain from a (small to medium) established list, or a proposal
- One facet_type from the SCHEMA.md 7-value constitutional enum
- 3-10 tags from an established list, or proposals
- A 15-25 word summary
- Three confidence sub-scores

Per Constitution Principles I, IV, and XVI, the model:
- MUST run locally against `http://localhost:11434` (Principle I — no egress)
- MUST be usable on the user's actual hardware without requiring purchases (Principle IV — single-user / single-machine)
- MUST have its choice be honest, documented, and substitutable via config (Principle XVI — no marketing claims)

## Decision

**Primary classifier model**: `qwen3.5:9b` (Q4_K_M quantization, ~5.5 GB on-disk, pre-loaded on pai-node01).

**Fallback classifier model**: `gemma3:4b` (Q4_K_M, ~3 GB on-disk, pre-loaded on pai-node01).

**Selection mechanism**: The active model is config-driven via `[classifier].model` in `config.toml`. Default value: `qwen3.5:9b`. Switching to the fallback is a single-line config edit; no code change required.

The model name is passed as the `model` field in every Ollama `/api/chat` request body (Decision B in research.md). The OllamaAdapter at boot time issues a GET to `/api/version` to record Ollama's version (R1 mitigation in plan.md) and a GET to `/api/tags` to verify the configured model is locally available; if absent, `ClassifierConfigurationError` is thrown at adapter construction.

## Rationale

**Pre-loaded on the user's machine**: Both models verified present on pai-node01 (`ollama list` confirmed 2026-05-13). Zero install-time burden; SP-004 does not require model downloads as part of the install process.

**Structured-output capability**: Both models work with Ollama 0.5+'s `format` parameter against the canonical JSON Schema rendered from `ClassifierOutputZodSchema`. Token-grammar constraint is enforced at the sampler level — invalid metadata is structurally impossible (Principle V).

**Quality / latency tradeoff**:
- `qwen3.5:9b` offers higher quality on the proposed-term naming task (suggesting good new domain / tag names for novel content) and on the 15-25-word summary task. Latency on CPU is the larger cost — empirically estimated at 30-90 seconds per document for the SP-004 prompt budget (vocabulary block + rules + 2000-codepoint body excerpt). Within the 60-second interactive policy budget for most documents; tail cases route to the failure lane retriable.
- `gemma3:4b` is ~3x faster on CPU. Quality on proposed-term naming is lower but still acceptable for the SP-004 scope (the user reviews proposed terms before promotion anyway — Principle XV). Quality on facet_type / facet_domain classification (selecting from a constrained list) is comparable.

**No GPU requirement**: Both models work on CPU at acceptable latency for single-user / single-machine use. The user's pai-node01 has no dedicated GPU in the SP-004 baseline configuration.

**Local-only by construction (Principle I)**: Both models are Ollama-served at `http://localhost:11434`. The OllamaAdapter has no cloud-API code path; reaching a non-localhost destination would hard-fail with `EgressBlockedError` from the SP-001 egress hook.

**Honest framing (Principle XVI)**: This ADR does NOT claim qwen3.5:9b is "the best" classifier model. It claims qwen3.5:9b is a defensible primary choice given the user's pre-loaded models, the CPU-only constraint, and the constrained classification task. Future model releases (Qwen 4, Llama 4, etc.) may merit re-evaluation via a follow-up ADR.

## Alternatives considered

**`llama3.1:8b`**: Viable. Structured-output works. Not pre-loaded on pai-node01; choosing it would require a model download (~5 GB). Rejected for v1 — qwen3.5:9b is the conservative match to existing state.

**`mistral:7b`**: Viable. Structured-output works. Same install-burden objection. Rejected.

**`qwen3:8b`**: Older qwen generation. Pre-loaded on pai-node01 but with less battle-tested structured-output. Rejected as primary; could be a secondary fallback in a future revision if qwen3.5:9b is unloaded.

**GPT-OSS larger models (qwen3:32b, mixtral)**: Too large for the user's CPU-only hardware budget. Rejected.

**Cloud API (OpenAI / Anthropic / Gemini API)**: FORBIDDEN by Principle I. Not a real alternative.

**Multi-model ensembling (run qwen3.5:9b AND gemma3:4b, combine outputs)**: Doubles latency without clear quality lift on the constrained classification task. Rejected for v1; future ADR if quality data demands it.

## Consequences

**Positive**:
- Zero install-time model downloads for SP-004.
- Fallback model exists and is pre-loaded; degradation path is config-only.
- The Ollama version detection at boot gives clean observability for the R1 risk (older Ollama silently ignoring `format`).
- The SC-CLASSIFY-001 budget (per-document classify wall-clock) is empirically measurable at Phase 5 against the actual primary model.

**Negative / Risk**:
- qwen3.5:9b CPU latency may exceed 60s on degenerate documents (very long Markdown bodies; complex HTML normalizations). Mitigation: 300s batch-policy budget for `corpus reenrich`; failure-lane sidecar with `retriable=true` for tail cases.
- The fallback model (gemma3:4b) produces lower-quality proposed-term names than the primary. Mitigation: user reviews proposed terms before promotion (Principle XV gate); no auto-promotion path.
- Future Ollama version bumps may change the `format` parameter contract. Mitigation: PREREQ contract-test asserts the rendered JSON Schema parses through Ollama's validator; version recorded in `classify.ollama_version` telemetry at adapter boot.

**Migration path to a different model**: A future ADR may supersede this one with a different primary model. The change surface is:
1. Update `[classifier].model` default in `config.toml`.
2. Update PREREQ unit test fixture to use the new model name.
3. Re-run SC-CLASSIFY-001 empirical measurement; record in plan.md Performance Goals footnote.

No code change required (the model name is fully data-driven).

## References

- Constitution Principle I (Local-First, No Egress)
- Constitution Principle IV (Knowledge, Not Memory; Single-User, Single-Machine)
- Constitution Principle V (Schema-Enforced Structured Output)
- Constitution Principle XVI (Validation Honesty)
- `specs/004-classifier/research.md` Decision A
- `specs/004-classifier/plan.md` Risk Register R2
- Ollama structured-outputs blog (2024-12-06)
- Pre-flight verification: `ollama list` on pai-node01 (2026-05-13) confirmed qwen3.5:9b + gemma3:4b loaded
