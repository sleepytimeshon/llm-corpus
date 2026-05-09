---
artifact: ADR
adr_id: ADR-010
project_slug: llm-corpus
stage: 5-build-test
tier: deep
template_version: 3.0.0
generated: 2026-05-09T02:45:00Z
generated_by: ProductBuild (Phase 1a recovery)
status: proposed
supersedes: ADR-005
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-05-09T02:45:00Z
date_accepted: null
product_type: software

links:
  decisions_jsonl_id: D-021
  requirements_gated: [NFR-008]
  roadmap_items_gated: [RM-001]
  related_adrs: [ADR-005]

reversibility: medium
tags: [nfr, local-llm, pilot, ollama, recovery, supersession]
---

# ADR-010: SP-000-Lite — Reduced-Scope NFR-008 Pilot Superseding ADR-005

## Status

proposed

## Context

ADR-005 (accepted 2026-04-26) declared SP-000 a hard pre-build pilot sprint with the following minimum scope:

1. FR-009 retrieval prompt template authored
2. **100-query benchmark on BOTH** `llama3.1:8b-instruct` AND `qwen2.5:7b-instruct` via live Ollama+MCP
3. **At least 2 prompt-template iteration cycles** if first run achieves <N=25
4. Hard gate: if no variant reaches N=20 on either model after 2 iterations, NFR-008 downgrades to `nice_to_have` BEFORE Sprint 1 of build

ADR-005 §Status: accepted. ADR-005 §Decision: SP-000 runs **before Sprint 1**.

**What actually happened (build phase reality):**

- SP-001 (local-only enforcement + MCP foundation, RM-002) was scaffolded and shipped between 2026-05-05 and 2026-05-06 via PR #1 — without SP-000 running first
- SP-002 (MCP resources, RM-003) was authored and shipped between 2026-05-08 and 2026-05-09 via PR #4 — without SP-000 running first
- ADR-005's hard pre-build gate was bypassed
- The bypass was caught in a process audit on 2026-05-08 and surfaced as a substantive concern in the recovery plan
- Provisional N=20 from D-012 has been the working floor for two sprints without empirical validation

**Forces / constraints (re-evaluated for the recovery context):**

- **AG-005** (no formal labeled retrieval evaluation harness in v1) still binds; OOS-012 (50-query labeled retrieval evaluation harness) remains deferred to v1.5+
- **AG-004** (priority cap on cross-agent / portability surfaces) still caps NFR-008 at `priority: should`; downgrade to nice_to_have remains an option but not the only path
- **Constitution Principle XVI** (validation honesty) requires that any N committed must be backed by real evidence
- **The pre-build gate framing in ADR-005 is now infeasible** — SP-001 and SP-002 are merged on main; reverting to "before Sprint 1" is not on the table
- **Models on Shon's system**: `qwen3:8b`, `qwen3.5:9b`, `gemma3:4b` are pulled; `llama3.1:8b-instruct` and `qwen2.5:7b-instruct` are NOT pulled
- **ADR-005's two-model + two-iteration design** was an empirical research project sized like a sprint; the recovery context calls for the cheapest measurement that discharges the binary commit-N-or-downgrade exit constraint
- **Recovery discipline**: per the bypass-prevention pattern surfaced in PR #2 (ADR-009), substantive ADR scope change is itself an ADR ceremony, not a casual sprint-level decision

**Alternatives considered (in the recovery context — different alternatives than ADR-005's original four):**

1. **Re-run ADR-005 as written** — pull `llama3.1:8b-instruct` + `qwen2.5:7b-instruct` (~9 GB), run full 100q × 2 model × ≥2 iteration. Full empirical signal; ADR-005 §Decision honored verbatim. Cost: 5+ days, model downloads, retroactive frame ("we now run the gate after the gate") still awkward.
2. **Downgrade NFR-008 to nice_to_have without piloting** — invoke ADR-005's hard-gate fallback path directly; ship v1 without an empirical N. Lowest cost; preserves AG-004 cap; honest about the bypass having occurred. Loses the Priya-persona value-proposition validation entirely.
3. **SP-000-lite (this ADR)** — single 50-query benchmark on `qwen3:8b` (already pulled) with one prompt variant; binary exit (commit N OR downgrade OR escalate to full SP-000). Cost: 1-2 days. Validates Priya value-proposition at lower confidence; explicit "personal-scale floor not industry-standard floor" framing per Constitution Principle XVI.
4. **Full SP-000 in non-pre-build position** — same scope as ADR-005's original spec, but run after SP-002 instead of before SP-001. ADR-005's Decision text becomes incorrect (the "before Sprint 1" framing is gone) but its empirical commitments hold. Same cost as alternative 1, less ceremony than this ADR.

**Origin of these alternatives:** Recovery-plan deliberation on 2026-05-08 (PRD `20260508-175010_llm-corpus-relaunch-plan`); ADR-005 §Status revisit per Architect agent integrity audit; Phase 0a-2 PR ceremony surfaced lint-amendment-as-separate-PR pattern that this ADR adopts for amendment-as-separate-PR.

## Decision

We adopt **alternative 3: SP-000-lite** as the reduced-scope pilot superseding ADR-005's locked Decision.

**SP-000-lite minimum scope:**

1. **FR-009 retrieval prompt template authored** — single variant, version-controlled in `specs/000-nfr-008-pilot-lite/` per Phase 1b spec scaffolding
2. **50-query benchmark** on `qwen3:8b` (already pulled on the build environment); query construction follows the Council synthesis from PRD `20260508-175010` (mine `~/.claude/MEMORY/WORK/` PRD bodies for knowledge-grounded queries; hand-craft general + adversarial buckets)
3. **Stratification rubric** (per Architect's earlier finding): minimum 30 knowledge-grounded queries (60% bucket), 15 general queries (30% bucket), 5 adversarial queries (10% bucket); ≥3 distinct retrieval patterns in knowledge-grounded bucket (factual lookup, recall-by-context, multi-doc synthesis)
4. **One prompt variant** initially; if first run lands <N=15, escalate to one additional iteration cycle
5. **Binary exit constraint** (preserves ADR-005's hard gate): final N committed to `decisions.jsonl` OR formal downgrade of NFR-008 to `priority: nice_to_have` OR formal escalation to full SP-000 (alternative 1 above)

**Model substitution rationale**: ADR-005 spec'd `llama3.1:8b-instruct` + `qwen2.5:7b-instruct` based on Berkeley Function Calling Leaderboard data current as of Stage 3 Validate (2026-04-27). `qwen3:8b` is from the same architecture family as Qwen 2.5 7B Instruct (qwen3 is the successor model series; 8B parameter class) and is already pulled on the build environment. Single-model coverage in SP-000-lite (vs ADR-005's two-model coverage) is the primary scope reduction; covering both Llama and Qwen families is deferred to a follow-up SP-000-extended run if SP-000-lite signals warrant it.

**Stratification rationale**: Architect's pre-launch audit (PR #4 review thread) flagged that "leaving query authoring to the user without a stratification rubric lets the 50q sample skew toward whatever Shon's recent transcripts happened to emphasize. A pilot whose queries cluster on one retrieval pattern produces a decision that doesn't generalize — and you commit to N based on it." The 60/30/10 stratification + ≥3 retrieval-pattern requirement closes that gap.

**Sequencing**: SP-000-lite runs AFTER SP-002 commit (already done — PR #4 merged on 2026-05-09). The "before Sprint 1" framing of ADR-005 is replaced with "before SP-003 ingest work begins" — preserving the spirit of "validate the local-LLM tool-use rate before it metastasizes inside SP-004 classifier work" while honestly reflecting the recovery context.

**Honest framing of personal-scale floor**: The N committed by SP-000-lite is a *personal-scale floor* (Shon's workflow on `qwen3:8b` against his own knowledge-work substrate). It is NOT an industry-standard floor (Priya persona at scale; multiple model families; adversarial query distributions sourced from Berkeley FCL or equivalent). This must be declared explicitly in the D-021 ledger entry and in any user-facing documentation that cites the committed N value.

## Consequences

**Positive:**

- Discharges the binary commit-N-or-downgrade exit constraint at substantially reduced cost (1-2 days vs 5+ days for full ADR-005 scope)
- Uses already-pulled `qwen3:8b` model — no ~9 GB model downloads gating sprint start
- Stratification rubric closes the Architect's "queries cluster on one retrieval pattern" gap
- Preserves AG-005 anti-goal (no formal labeled retrieval eval harness in v1; SP-000-lite is not OOS-012's labeled harness — it's tool-use rate measurement on real personal data)
- Explicit "personal-scale floor" framing honors Constitution Principle XVI (validation honesty); the committed N value is not silently misrepresented as industry-standard
- ADR-005's hard binary exit (commit N OR downgrade) is preserved verbatim
- Recovery from bypass is documented as ADR ceremony rather than informal sprint-level rescope

**Negative:**

- Single-model coverage means model-family-specific behavior on Llama family is unobserved in v1; if Llama users run llm-corpus, their tool-use rate may differ from the committed Qwen3 N. Mitigation: D-021 explicitly notes the personal-scale floor framing; follow-up SP-000-extended on Llama family triggered by user feedback (per ADR-005 §Trigger to revisit, preserved here)
- 50-query sample is half ADR-005's spec; statistical confidence bounds are correspondingly wider. Mitigation: stratification rubric ensures the 50q has retrieval-pattern diversity; the binary exit doesn't require statistical confidence intervals — it requires "did any prompt variant reach ≥15 invocations on the knowledge-grounded subset"
- Single prompt variant (vs ADR-005's "≥2 iteration cycles") means prompt-engineering convergence is not explored. Mitigation: escalation path (run one additional iteration if first lands <N=15) is preserved in the SP-000-lite spec; if even iteration 2 fails, downgrade is the binary exit
- ADR-005 supersession sets a precedent that inviolable-decision ADRs can be amended via supersession-ADR ceremony when subsequent reality (build phase outcomes, user environment constraints) makes the original Decision infeasible. Mitigation: this precedent itself requires ceremony (separate PR before any spec scaffolding that depends on the supersession), which is exactly what this Phase 1a PR establishes

**Neutral:**

- ADR-005 status remains `accepted` (historical record); its frontmatter `superseded_by: ADR-010` field is set as part of this amendment
- D-012's provisional N=20 is no longer the working floor; SP-000-lite's pilot output supersedes it (recorded in D-021 + any subsequent D-NNN entry committing the final N)
- AG-004's priority cap on NFR-008 is unaffected; SP-000-lite cannot move NFR-008 above `should`
- Future model upgrades (e.g., qwen4) may surface a higher N and trigger re-pilot per ADR-005 §Trigger to revisit (preserved in ADR-010's compliance/verification below)

## Compliance / verification

- **Tests**: SP-000-lite spec.md (Phase 1b) lists Gherkin scenarios for the pilot run; SP-000-lite tasks.md lists the harness-script implementation tasks. The pilot's exit gate is recorded in `.product/ledgers/decisions.jsonl` as a new D-NNN entry with prompt variants tested and per-model results.
- **Telemetry**: pilot run produces a structured record per Constitution Principle XIII; the harness emits a `nfr_008_pilot` event class for each query with fields including model, prompt_variant, query_bucket (knowledge-grounded / general / adversarial), tool_invoked (boolean), retrieval_outcome, duration_ms.
- **Trigger to revisit ADR-010** (preserved from ADR-005): NFR-008 in production observed substantially below the committed N AND user (Priya persona equivalent) reports loss of value → open ADR-010-superseder. Also: a future allowlisted model (per ADR-001 amendment) shows materially different tool-use behavior than `qwen3:8b` → re-pilot under SP-000-extended scope.
- **Ratification path**: this ADR ships in `proposed` status. Merging this PR ratifies it (`status: accepted`). A follow-up edit will set `date_accepted` to the merge timestamp and the `decisions_jsonl_id` D-021 will be authored as part of this same PR.
- **ADR-005 amendment**: ADR-005's frontmatter `superseded_by` field is set to `ADR-010` in the same commit as this ADR's authoring. ADR-005's status remains `accepted` (historical record) per the project's supersession convention.
