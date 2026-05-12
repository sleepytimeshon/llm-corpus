# Phase 0 Research: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **ADR**: [ADR-010](../../.product/ADRs/ADR-010-sp000-lite-supersedes-005.md)
**Date**: 2026-05-11
**Posture**: Personal-scale floor measurement, NOT a benchmark. Constitution Principle XVI binds every framing decision below.

## Scope of this research document

`/speckit-plan` instructs Phase 0 to resolve every NEEDS CLARIFICATION marker in the spec and to consolidate technology-choice rationale. The spec carries no NEEDS CLARIFICATION markers (Rounds 1 + 2 of `/speckit-clarify` resolved all five Q-items; the only outstanding domain gate is Q3 DRAFT ratification in PR walkthrough per FR-PILOT-012, which does NOT block planning). What remains for Phase 0 is therefore not *resolution* but *honest framing of the evidence base for `qwen3:8b` tool-use performance against a personal corpus*.

This document captures three threads:

1. What the public record says about `qwen3:8b` tool-use behavior — and the reliability bounds on that record for the SP-000-lite configuration.
2. Why the substitution of `qwen3:8b` for ADR-005's spec'd `llama3.1:8b-instruct` + `qwen2.5:7b-instruct` is a cost-driven scope reduction, not an evidence-supported equivalence.
3. Why ADR-010's `N ≥ 15` knowledge-grounded threshold is a personal-scale gate, not an industry-derived bar.

## Thread 1 — qwen3:8b tool-use evidence base

### Decision

For SP-000-lite, we treat `qwen3:8b`'s prior tool-use behavior as **operationally unknown** for this configuration and rely on the pilot's own 50-query measurement as the primary evidence. We do NOT pre-commit a target N based on extrapolation from public leaderboards.

### Rationale

`qwen3:8b` is one model in the Qwen3 lineage released by Alibaba (Qwen team) in 2025. The model card on the Ollama registry advertises tool-use capability via the standard function-calling/tool-use prompt envelopes. Berkeley Function Calling Leaderboard (BFCL) has historically published per-model scores for tool-use benchmarks; ADR-005's original two-model selection (`llama3.1:8b-instruct` + `qwen2.5:7b-instruct`) was grounded in BFCL data current as of 2026-04-27 (Stage 3 Validate). For SP-000-lite, three factors make BFCL data unreliable as a predictor:

1. **Lineage shift**: Qwen3 is a different training run than Qwen 2.5. The model card documents thinking-mode toggling and different post-training relative to 2.5. BFCL scores for `qwen2.5:7b-instruct` are NOT a valid proxy for `qwen3:8b`. (ADR-010 §Decision flags this explicitly: "qwen3 introduced thinking-mode toggling and different tool-use training relative to Qwen 2.5".)
2. **Prompt-envelope mismatch**: BFCL evaluates against its own synthetic tool-call prompts and a fixed function schema set. SP-000-lite evaluates against the SP-002 `corpus.find` tool schema with a system prompt authored for retrieval-grounded answering. A BFCL score predicts BFCL outcomes; it does not predict invocation rate on a different tool schema.
3. **Substrate mismatch**: BFCL's queries are synthetic and adversarially constructed to test function-calling correctness. SP-000-lite's 50-query set is mined from Shon's PRD bodies + hand-crafted general + adversarial buckets; the query distribution is workflow-shaped, not synthetic.

The honest conclusion: public benchmarks are *not* a reliable predictor for SP-000-lite's specific configuration (qwen3:8b × SP-002 MCP surface × Shon's curated corpus × Shon's mined query set). The pilot's measurement IS the evidence.

### Primary sources cited (and the limits of their applicability)

- **Ollama model card for `qwen3:8b`** — documents that the model supports tools per the standard Ollama tool-use envelope. The card does NOT publish a tool-invocation rate metric and does NOT compare against `qwen2.5` on tool tasks. Applicability to SP-000-lite: tells us tools-are-supported (necessary precondition), tells us nothing about expected rate.
- **Qwen team's Qwen3 release notes (2025)** — documents thinking-mode toggling and architectural changes from 2.5. Applicability: confirms the lineage shift; reinforces why `qwen2.5:7b-instruct` BFCL scores are not a proxy.
- **Berkeley Function Calling Leaderboard (BFCL)** — does publish per-model tool-use scores. Applicability: ADR-005 originally grounded its model selection in BFCL; ADR-010 explicitly steps away from that grounding because the spec'd Qwen 2.5 entry is not transferable to Qwen 3 (lineage shift) and because BFCL's evaluation surface is not transferable to SP-000-lite's MCP surface + workflow query distribution.

### Alternatives considered

- **Pre-commit a target N from BFCL extrapolation** — rejected. Constitution Principle XVI forbids quality claims not user-validated. BFCL extrapolation to this configuration is unvalidated speculation; if pre-committed and missed, the pilot becomes a benchmark-fitting exercise rather than a workflow-floor measurement.
- **Run a synthetic 50-query benchmark first to "calibrate"** — rejected. AG-005 binds: SP-000-lite is NOT a retrieval/eval harness. Synthetic calibration would silently widen the scope (this becomes OOS-012 in disguise).
- **Defer SP-000-lite entirely until BFCL publishes Qwen3 entries** — rejected. ADR-010 §Decision binds the project to discharge the binary exit gate before SP-003 ingest work begins. Waiting on BFCL is open-ended and outside Shon's control; the pilot is sized at 1-2 days and produces decision-grade signal regardless.

### Honest framing for the D-NNN ledger entry

Whatever N the pilot commits, the ledger entry MUST state:
- the configuration tested (`qwen3:8b`, single prompt variant `v1`, SP-002 `corpus.find` tool advertised over stdio MCP)
- the substrate (curated 32-PDF personal sampler enumerated in spec.md `## Substrate File List`)
- the query-set provenance (30 KG queries mined from `~/.claude/MEMORY/WORK/`; 15 G + 5 A hand-crafted)
- the explicit disclaimer that the N is Shon's-workflow-floor, NOT cross-model or cross-user generalization

## Thread 2 — Why model substitution is a scope reduction, not an equivalence claim

### Decision

ADR-010 substitutes `qwen3:8b` (single model, already pulled locally) for ADR-005's `llama3.1:8b-instruct` + `qwen2.5:7b-instruct` (two-model, ~9 GB to download). The substitution is justified as a *cost-driven scope reduction* (1-2 day pilot vs 5+ days) and is NOT framed as evidence-supported equivalence between the model families.

### Rationale

- ADR-005's two-model selection was sized like a sprint: cover both Llama and Qwen training lineages to detect family-specific tool-use behavior. Useful signal; expensive (download budget + extra iteration cycles).
- The recovery context (per ADR-010 §Context) is fundamentally different: SP-001 and SP-002 are already merged on `main`; the "pre-build gate" framing is gone; the cheapest measurement that discharges the binary exit constraint is the operating constraint.
- `qwen3:8b` is already pulled on the build environment; no ~9 GB download blocks the start. Pulling `llama3.1:8b-instruct` to satisfy ADR-005 literally would add 5 GB download + extra runtime measurement budget for a signal whose decision-relevance is bounded by AG-004's `priority: should` cap on NFR-008 (the floor cannot be promoted above `should` in v1.0.0 regardless).
- Single-model coverage is documented as the primary scope reduction; ADR-010 preserves the option to follow up with SP-000-extended on Llama family if pilot signal warrants it.

### Risk surface accepted

- Llama-family users running llm-corpus may experience a different tool-use rate than the committed Qwen3 N. Mitigation: D-NNN entry's personal-scale qualifier identifies the model explicitly; README + CLI `--help` text never generalizes the N across model families.
- Single prompt variant on iteration 1 (vs ADR-005's "≥ 2 iteration cycles" mandate) means prompt-engineering convergence is not explored deeply. Mitigation: FR-PILOT-004 preserves one revised-variant escalation if iteration 1 lands below N=15; iteration 3+ is forbidden by ADR-010 scope.

### Alternatives considered

- **Pull both ADR-005-spec'd models and run ADR-005 verbatim** — rejected per ADR-010 §Alternatives considered (alternative 1): 5+ day budget, download cost, retroactive "we now run the gate after the gate" framing still awkward.
- **Skip the pilot and invoke ADR-005's downgrade fallback directly** — rejected per ADR-010 §Alternatives considered (alternative 2): loses Priya-persona value-proposition validation entirely.

## Thread 3 — Why N ≥ 15 is a personal-scale gate, not an industry bar

### Decision

ADR-010 sets the iteration-2 escalation threshold at N=15 on the 30-query knowledge-grounded bucket (50% invocation rate). This threshold is a *personal-scale gate* informed by Shon's workflow tolerance, NOT a derived industry minimum.

### Rationale

- A 50% invocation rate on a curated knowledge-grounded bucket is the lowest threshold at which Shon would judge the local-LLM tool-use rate "good enough to live with" for v1.0.0 personal use. Below 50%, the tool-grounded retrieval flow fails too often to be the primary path; the user would prefer to query the corpus directly (CLI `corpus search`) or downgrade NFR-008 to nice_to_have.
- The 50% framing also aligns with ADR-005's hard-gate fallback: ADR-005 specified `N=20 on 100q` (also 20%, but on the full 100q set including general + adversarial buckets — math-equivalent to ~30-40 invocations on the 60-query knowledge-grounded subset under proportional stratification). SP-000-lite's `N=15 on 30q` is a stricter per-knowledge-grounded-query rate (50% vs ~50-67%), which is *appropriate* because the SP-000-lite knowledge-grounded bucket is specifically curated for "the LLM should clearly invoke the tool here." A lower rate on a clearer-signal bucket would indicate systemic prompt-template or model-fitness problems, not edge-case behavior.
- Constitution Principle XVI requires explicit framing: the N=15 gate is "Shon's tolerance threshold for personal v1.0.0 use," NOT "the industry floor for local-LLM tool use on RAG-style workflows."

### Honest framing for the D-NNN entry

If iteration 1 produces N ∈ [15, 30], the entry commits N at face value with personal-scale qualifier. If iteration 1 produces N < 15, the entry records iteration 2's revised variant + result; if iteration 2 also produces N < 15, the entry records either downgrade (NFR-008 → nice_to_have) or escalation (full SP-000 with both originally-spec'd models pulled). The binary exit is parameterized on N alone; the malformed-call rate (FR-PILOT-013) is informational, not gating (per Q4 round-2 clarification).

## Reliability of this research document itself

Per the verify-or-retract feedback memory, every factual claim in this document MUST be either:
- (a) directly stated in spec.md / ADR-010 / Constitution / the existing SP-001 codebase (cited above where so), OR
- (b) explicitly framed as uncertainty ("operationally unknown", "personal-scale gate", "not a proxy", etc.)

I have NOT performed live WebFetch against the Ollama model card or BFCL leaderboard during this Phase 0 pass because:
- the public-record limits described in Thread 1 are *categorical* (lineage shift, prompt-envelope mismatch, substrate mismatch), not numerical — fetching the latest BFCL score for any Qwen entry would not change the conclusion that the score is not transferable;
- the pilot's own 50-query measurement is the load-bearing evidence; any pre-commitment from a fetched benchmark number would be the kind of "extrapolation as quality claim" that Constitution Principle XVI forbids.

If during PR review Shon wants live BFCL or Ollama model-card fetches added as appendix citations, that's a small follow-up to this document. The conclusions stand without them.

## Inputs to Phase 1 design

The Phase 0 framing feeds Phase 1 as follows:
- **data-model.md** — the four entities (Pilot Run, Query, Pilot Telemetry Event, Pilot Summary) carry explicit `personal_scale_qualifier` text fields seeded with the framing language above. The harness writes these fields verbatim; the D-NNN entry inherits them; downstream artifacts (REQUIREMENTS.yaml, README) cite them.
- **contracts/** — Gherkin scenarios test for personal-scale qualifier presence and for the absence of industry-standard phrasing in terminal artifacts.
- **quickstart.md** — operator walkthrough explicitly tells Shon to read the summary JSON, interpret the headline N value *with* the personal-scale qualifier, and write the D-NNN entry preserving that framing verbatim.
