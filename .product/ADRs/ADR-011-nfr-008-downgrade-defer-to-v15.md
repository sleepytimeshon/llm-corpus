---
artifact: ADR
adr_id: ADR-011
project_slug: llm-corpus
stage: 5-build-test
tier: deep
template_version: 3.0.0
generated: 2026-05-12T03:30:00Z
generated_by: Shon (principal-driven during PR #6 walkthrough)
status: accepted
supersedes: ADR-010
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-05-12T03:30:00Z
date_accepted: 2026-05-12T03:30:00Z
product_type: software

links:
  decisions_jsonl_id: D-022
  decisions_supersedes_consequences_of: [D-021]
  requirements_gated: [NFR-008]
  roadmap_items_gated: []
  related_adrs: [ADR-005, ADR-010]

reversibility: medium
tags: [nfr, local-llm, downgrade, supersession, validation-honesty, ai-as-principal, adr-011, supersedes-adr-010]
---

# ADR-011: NFR-008 Validation Downgrade — Defer to v1.5 Under AI-as-Principal Framing

## Status

accepted

## Context

ADR-010 (`SP-000-lite supersedes ADR-005`) settled on a 50-query benchmark pilot — 30 knowledge-grounded queries mined from `~/.claude/MEMORY/WORK/` PRD bodies, 15 general queries hand-crafted by Shon, 5 adversarial queries hand-crafted by Shon — to discharge ADR-005's binary exit constraint and establish a personal-scale floor for NFR-008. Phase 1b of that work shipped the spec package on PR #6 and the harness implementation on PR #9 (merged as `8b3230d`). 30 KG query candidates were drafted at `~/Projects/llm-corpus-drafts/queries-kg-draft.yaml` awaiting Shon's curation, alongside the request to hand-craft 15 general + 5 adversarial queries himself.

**The mismatch surfaced during PR #6 walkthrough preparation.**

ADR-005 was authored in Stage 3 (2026-04-26) before SP-002 shipped. SP-002's MCP-resources surface introduced auto-loaded resources (`corpus://manifest`, `corpus://taxonomy`, `corpus://recent`, `corpus://docs/{id}`) and an explicit product axiom: agents bias toward corpus *without per-prompt nudging* (FR-005, UR-003). The whitepaper §line 159 and architecture §5.3-5.4 both make the AI the principal user of the corpus: tools are agent-invoked, resources are auto-loaded at session start, and MCP prompts are server-supplied templates that distribute the corpus's usage protocol cross-agent ("how an agent recognizes when to use the corpus and how it interprets the results"). The agent adopts the protocol without further configuration.

ADR-005 (and ADR-010 by inheritance) measures something different: whether qwen3:8b, when given synthetic human-natural-language queries, decides to invoke `corpus.find`. That's a coarse proxy for tool-use behavior in a *human-asks-question → agent-answers* flow — which the product explicitly does NOT center on. The product centers on *agent-in-mid-task* and *agent-at-session-start* flows where corpus content arrives via auto-loaded resources and the MCP-prompts-distributed protocol, not via single-shot natural-language prompts.

**Forces / constraints:**

- **Constitution Principle XVI (validation honesty) binds.** Authoring 15 general + 5 adversarial queries hand-fabricates test data, then committing the resulting N as the NFR-008 floor cites a number whose framing requires a paragraph of disclaimer every time it's referenced. The disclaimer itself signals the underlying mismatch.
- **The 30 KG queries are corpus-substrate-anchored** but still test the *human-issues-query → agent-decides-to-invoke* flow rather than the at-need / auto-loaded flow the product implements.
- **PR #6 has not yet merged.** The spec package can be closed without merge cost.
- **PR #9 (harness implementation) is on main.** The code is well-tested (50 contract tests green) and follows Constitution principles. The Ollama client, MCP client interface, telemetry envelope (`nfr_008_pilot` event class), summary writer, and atomic-write helper composition are reusable scaffolding for a future at-need pilot under v1.5 framing.
- **AG-004 caps NFR-008 priority at `should`** in v1.0.0 regardless of validation evidence. Downgrade to `nice_to_have` is within AG-004's permitted range and removes the v1.0.0 validation pressure entirely.
- **AG-005 still forbids a formal labeled retrieval evaluation harness in v1**, and OOS-012 (50-query labeled retrieval evaluation harness) remains deferred to v1.5+. ADR-011 aligns the NFR-008 timeline with AG-005's existing posture rather than fighting it.

**Alternatives considered (in the AI-as-principal re-evaluation context):**

1. **Pivot SP-000-Lite spec to at-need measurement.** Replace the 50-query stratification with an auto-load smoke test (does a fresh agent session actually receive manifest/taxonomy/recent/prompts?) plus a real-prompt replay against qwen3:8b with MCP attached. Reuse the merged Ollama + MCP clients + telemetry scaffolding. Estimated cost: 1-2 days of spec rework + 1 day of test redesign. Honest deliverable but substantial engineering work that should itself be a stand-alone ADR decision. Rejected for v1.0.0 scope discipline.

2. **Run the current pilot truthfully reframed.** Skip the 15+5 hand-crafted queries; run with 30 KG queries only; commit N with explicit "lower-bound proof; NOT a measurement of at-need auto-load flow" framing in the D-NNN entry. Discharges ADR-010's binary exit at near-zero cost. Rejected because the framing burden recurs on every citation of the committed N and the resulting number is operationally useless — the AI-as-principal flow is what ships, and a coarse lower bound on a flow the product doesn't center on doesn't shift any v1.0.0 release decision.

3. **Downgrade NFR-008 to `nice_to_have` for v1.0.0** (this ADR). Use ADR-010's binary exit option B verbatim. NFR-008 stays in REQUIREMENTS.yaml but marked honestly: validation framework re-spec'd, deferred to v1.5 with at-need framing. PR #6 closes without merge; PR #9's harness code stays on main as reusable scaffolding for the v1.5 re-pilot. Zero additional engineering for the v1.0.0 milestone.

## Decision

We adopt **alternative 3: NFR-008 priority downgrade to `nice_to_have`** for v1.0.0, deferring AI-as-principal-aligned validation to v1.5.

**Specifically:**

1. `.product/REQUIREMENTS.yaml` NFR-008 record:
   - `priority: should` → `priority: nice_to_have`
   - `description` text refined to declare the AI-as-principal re-framing and the v1.5 deferral
   - `quantitative_targets[0].test_method` annotated: the 100-query benchmark framing is superseded; v1.5 re-spec will define an at-need behavioral measurement
   - `acceptance_criteria` updated to reflect the deferral
2. ADR-010's `status` is set to `superseded` and `superseded_by: ADR-011` (in-band amendment to ADR-010 frontmatter only; the historical record of ADR-010's accepted state from D-021 is preserved verbatim in `.product/ledgers/decisions.jsonl`).
3. **D-022 ledger entry** records the downgrade decision per ADR-010 §Decision item 5 option B ("formal downgrade of NFR-008 to `priority: nice_to_have`"), citing this ADR-011 + Constitution Principle XVI.
4. **PR #6 (`000-nfr-008-pilot-lite`)** closes without merge. The branch's spec package documented a measurement framework SP-000-Lite would have used; with NFR-008 downgraded, the measurement framework has no v1.0.0 consumer. The branch is preserved (not deleted) so the v1.5 re-spec can fork from it if continuity helps.
5. **PR #9's merged harness code stays on main.** The pilot CLI subcommand (`corpus pilot run`) remains callable but, with NFR-008 downgraded, has no v1.0.0 binding obligation; its eventual at-need re-pilot use case lands under a future ADR-012 (or successor) authored at v1.5 scoping time. Comment updates may be appropriate on the pilot subtree to clarify "pending v1.5 re-design" — captured as a follow-up housekeeping task, not a v1.0.0 blocker.
6. **`~/Projects/llm-corpus-drafts/queries-kg-draft.yaml`** stays as draft. The 30 corpus-substrate-anchored query candidates remain a useful starting point for the v1.5 at-need replay corpus if Shon wants to reuse them.

**Sequencing**: ADR-011 acceptance unblocks the v1.0.0 release path with respect to NFR-008. SP-003 (ingest) was previously gated by ADR-010's binary exit; with NFR-008 downgraded, the gate is discharged and SP-003 can begin.

**Honest framing of the deferral**: NFR-008 in v1.0.0 carries no validated floor. The provisional N=20 from D-012 is *also* withdrawn (it was never validated; it preceded ADR-005's pilot design; the AI-as-principal product flow doesn't measure tool-use rate against synthetic queries). v1.0.0 ships the corpus product on the strength of FR-005's auto-load semantics, UR-003's session-portability, and the MCP-prompts protocol distribution — none of which depend on a tool-use-rate floor.

## Consequences

**Positive:**

- Closes the v1.0.0 NFR-008 validation gate at zero additional engineering cost
- Honors Constitution Principle XVI by not citing a number whose framing requires a paragraph of disclaimer
- Aligns NFR-008's timeline with AG-005's existing v1.5+ posture on retrieval evaluation
- Preserves the harness implementation (PR #9, merged) as reusable scaffolding for the v1.5 at-need re-pilot
- Removes the principal's hand-crafted-query authoring burden (15 general + 5 adversarial) that was the proximate trigger for the re-evaluation
- Unblocks SP-003 (ingest) which was gated by ADR-010's binary exit

**Negative:**

- v1.0.0 ships without ANY local-LLM tool-use rate evidence — no floor, no lower bound, no coarse proxy. The product validation rests entirely on FR-005/UR-003/MCP-prompts mechanics being correctly implemented (which they are, per SP-002 and PR #9's contract test coverage), not on quantitative tool-use behavior.
- The provisional N=20 from D-012 is withdrawn without replacement. Any prior documentation or roadmap reference to "N=20 floor" must be retracted or annotated.
- A v1.5 re-pilot under at-need framing is now committed engineering work that someone has to scope, author, and execute. ADR-011 doesn't design that work; it only defers it.

**Recovery from accumulated drift:**

This ADR captures a class of failure worth naming explicitly: when the product evolves (SP-002 introduced auto-load resources + MCP prompts as the principal mechanism), older ADRs may continue to bind the project to validation framings that the new product reality has invalidated. ADR-005 → ADR-010 only narrowed scope; the underlying premise (synthetic queries as the measurement substrate) inherited from ADR-005 was never re-examined against the post-SP-002 product reality. The mismatch surfaced only at PR #6 walkthrough preparation when the proximate authoring burden (15 + 5 hand-crafted queries) prompted the principal to ask whether the measurement model itself was correct. **Future ADR ceremonies that follow major product-surface introductions (e.g., post-SP-003 ingest landing) should explicitly audit prior validation-bound ADRs for premise drift before accepting their constraints as still-binding.**

## Operational steps (executed in this PR)

- [x] Author this ADR-011
- [x] Amend ADR-010 frontmatter: `status: superseded`, `superseded_by: ADR-011`
- [x] Append D-022 to `.product/ledgers/decisions.jsonl`
- [x] Update REQUIREMENTS.yaml NFR-008 record (priority, description, test_method annotation, acceptance_criteria)
- [ ] Merge this PR
- [ ] Close PR #6 (`000-nfr-008-pilot-lite`) with comment linking ADR-011 + D-022 + this PR. Do NOT delete the branch.

Open items (NOT in this PR):

- ADR-012 (or successor) authoring the v1.5 at-need pilot re-spec — deferred to v1.5 milestone planning
- README + roadmap audit for any "N=20" or "NFR-008 tool-use floor" references — housekeeping pass
- `packages/cli/src/pilot/` + `packages/pipeline/src/pilot-harness/` README annotations clarifying "v1.5-pending re-spec" — housekeeping pass

## Provenance

This decision was raised by the principal during preparation for PR #6 walkthrough on 2026-05-12, in response to the request to hand-craft 15 general + 5 adversarial queries. The principal's question — "Is it necessary for me to author queries for a tool that the LLM is the target user?" — surfaced the AI-as-principal mismatch documented in §Context. The supporting evidence (FR-005, UR-003, WHITEPAPER §line 159, ARCHITECTURE §5.3-5.4) was already present in the repository; the mismatch had simply not been audited against ADR-010's accepted scope.
