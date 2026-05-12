# Feature Specification: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Feature Branch**: `000-nfr-008-pilot-lite`
**Created**: 2026-05-09
**Status**: Draft
**Input**: SP-000-lite per ADR-010 (which supersedes ADR-005). Reduced-scope pre-build pilot to set the NFR-008 absolute floor for local-LLM tool-use rate against the corpus, OR formally downgrade NFR-008 to `priority: nice_to_have`. 50-query benchmark on `qwen3:8b` (already pulled on the build environment), single prompt variant initially with one optional iteration cycle if first run lands below N=15. Stratification rubric required: 30 knowledge-grounded queries (60%), 15 general queries (30%), 5 adversarial queries (10%); knowledge-grounded bucket covers ≥3 distinct retrieval patterns (factual lookup, recall-by-context, multi-document synthesis), each with a 1-sentence operational definition + 2 worked examples per Architect's PR #5 review. Binary exit constraint preserved verbatim from ADR-005: commit final N to `decisions.jsonl` as a new D-NNN entry, OR formal downgrade of NFR-008 to `nice_to_have` priority, OR formal escalation to full SP-000 (per ADR-005 alternative 1 with both spec'd models). Personal-scale floor framing required throughout. Sequencing: SP-000-lite runs after SP-002 (PR #4 merged) and before SP-003 (ingest work). Substrate exercised: SP-002's `corpus.find` MCP tool + four `corpus://` resources (manifest, taxonomy, recent, docs/{id}). Constitutional anchors: Principle XIII (telemetry-or-die — harness emits `nfr_008_pilot` events), Principle XVI (validation honesty — personal-scale floor framing). Anti-goal anchor: AG-005 (this is NOT the OOS-012 labeled retrieval evaluation harness; this is tool-use rate measurement on real personal data).

## Clarifications

### Session 2026-05-09

- Q: Seed corpus substrate (Q1) → A: SUB-OPTION A — Curated sampler of ~32 PDFs spanning Books (4), Writing-style references (8), and Modeling domain (~20 across AFV/Aircraft/Workbench/Reference). See `## Substrate File List` for explicit paths. Conversion via `pdftotext` (fast, structure-loss acceptable; "good enough" quality bar). Russian-language material excluded; self-written content excluded; binary `.azw.md` excluded.
- Q: Query mining source (Q2) → A: B+C blend with bookmarks topic-cross-check. 30 knowledge-grounded queries mined from `~/.claude/MEMORY/WORK/` PRD bodies for question-shaped language, with topic-coverage validated against Shon's bookmarks file. 15 general queries hand-crafted by Shon (NOT corpus-grounded; tests tool-use discrimination). 5 adversarial queries hand-crafted by Shon (close to corpus topics but should NOT trigger `corpus.find`; tests false-positive resistance).
- Q: Retrieval-pattern operational definitions (Q3) → A: Engineer authors DRAFT definitions; Shon ratifies in PR review. DRAFT definitions captured in `## Retrieval Pattern Operational Definitions` below.

### Session 2026-05-11

- Q: Malformed-tool-call semantics (Q4) → A: **Option C** — single-shot count, no retry; malformed-call rate recorded as a secondary diagnostic field in pilot telemetry and surfaced in the per-iteration summary; soft threshold of `>10/30` malformed in the knowledge-grounded bucket flagged in the summary as a "prompt-vs-model" interpretation prompt for Shon, but binary exit remains parameterized on N alone (no auto-conversion to escalation). Rationale: preserves ADR-010 binary exit purity (N on knowledge-grounded bucket) while surfacing the Principle XIII forensic signal that distinguishes prompt-template defects from systemic JSON-emission unreliability. Options B (retry) and D (hard threshold) silently expand ADR-010's exit surface; Option A discards diagnostic signal.
- Q: Telemetry on-disk format + Paths.* + retention (Q5) → A: **Option B** — JSONL stream under a new `Paths.pilotTelemetry()` resolver key (resolves to `{state}/pilot-telemetry/`); iteration-suffixed filenames (`pilot-iter1.jsonl`, `pilot-iter2.jsonl`); both iterations retained for forensic citation in the D-NNN ledger entry's rationale. Cross-cuts SP-001 path-resolver code: adding `pilotTelemetry()` to `packages/contracts/src/paths.ts` is a follow-up task that `/speckit-tasks` MUST capture; running the pilot harness against an unmerged `Paths.pilotTelemetry()` key is FORBIDDEN. Rationale: `Paths.telemetry()` resolves to a single file (`{state}/telemetry.jsonl`), which physically cannot express iteration-suffixed retention; a new directory-returning resolver key is mechanically required. Constitution Principle XIII (telemetry-or-die) and Principle XIV (single resolver) are both honored: events conform to the same schema as production telemetry, and the new key composes from `Paths.state()` rather than introducing a new XDG base.

## User Scenarios & Testing *(mandatory)*

<!--
  SP-000-lite is an internal-developer feature. The "user" of the pilot
  output is the project itself (specifically: ADR-010's binary exit gate
  and the D-021 ledger entry that records the resulting decision). User
  stories below are written from the perspective of Shon-as-developer
  consuming the pilot output to discharge ADR-010's binary exit constraint.
-->

### User Story 1 — Discharge the binary exit gate (Priority: P1)

Shon runs the SP-000-lite pilot harness against `qwen3:8b` on the build environment. The harness exercises 50 stratified queries through the SP-002 `corpus.find` MCP tool against a seed corpus, records per-query tool-invocation behavior to a structured telemetry stream, and outputs a summary with N (the count of knowledge-grounded queries on which the local LLM actually invoked `corpus.find`). Shon then makes one of three terminal moves: (a) commit the observed N to `.product/ledgers/decisions.jsonl` as a new D-NNN entry establishing the personal-scale floor for NFR-008; OR (b) author a formal downgrade of NFR-008 to `priority: nice_to_have` if N is too low to defend; OR (c) escalate to full SP-000 (ADR-005 alternative 1, both originally-spec'd models) if the lite scope produced ambiguous signal that justifies the larger investment.

**Why this priority**: This IS the feature. ADR-010 §Decision binds the project to one of these three terminal moves before SP-003 (ingest) can begin. Without this story, NFR-008 remains in its current state (provisional N=20 from D-012, unvalidated), the binary exit gate from ADR-005 stays open, and SP-003 begins on top of unvalidated retrieval-prompt assumptions. There is no P2 user story for this feature; the pilot exists only to discharge this gate.

**Independent Test**: With `qwen3:8b` pulled and the SP-002 MCP server running over stdio against a seed corpus, run the pilot harness end-to-end. Verify it produces (a) a structured telemetry log of 50 `nfr_008_pilot` events, (b) a per-bucket invocation-rate summary (knowledge-grounded / general / adversarial), and (c) a single N value (count of knowledge-grounded queries on which `corpus.find` was actually invoked by the LLM). Confirm the harness halts cleanly when complete and writes nothing outside `Paths.*` (Constitution Principle XIV).

**Acceptance Scenarios**:

1. **Given** `qwen3:8b` is pulled, the SP-002 MCP server is running over stdio against a seed corpus, and the 50-query stratified set is loaded, **When** Shon invokes the SP-000-lite harness, **Then** the harness drives 50 query turns through `qwen3:8b` with the SP-002 MCP tools advertised, records per-query tool-invocation behavior, and emits a summary with per-bucket counts and the headline N value (knowledge-grounded invocations).
2. **Given** the harness has completed a 50-query run, **When** N on the knowledge-grounded subset is ≥15, **Then** Shon may commit that N as the personal-scale floor in a new `decisions.jsonl` D-NNN entry citing ADR-010 as the gating decision.
3. **Given** the harness has completed a 50-query run, **When** N on the knowledge-grounded subset is <15 on iteration 1, **Then** Shon may run iteration 2 with one revised prompt variant before declaring the pilot resolved; if iteration 2 also lands <15, the binary exit forces either downgrade of NFR-008 to `nice_to_have` or escalation to full SP-000.
4. **Given** the pilot has resolved to any of the three terminal moves, **When** the corresponding ledger entry is committed (D-NNN with final N, or NFR-008 downgrade entry, or SP-000 escalation entry), **Then** ADR-010's binary exit gate is closed and SP-003 (ingest) is unblocked to begin.

---

### User Story 2 — Stratification rubric prevents query-set skew (Priority: P1)

Before the harness runs, the 50-query set must be authored against a stratification rubric so the resulting N is robust to query-distribution skew. Shon authors (or the pilot script enforces) a 50-query set with: 30 knowledge-grounded queries (60% bucket) covering ≥3 distinct retrieval patterns (factual lookup, recall-by-context, multi-document synthesis); 15 general queries (30% bucket); 5 adversarial queries (10% bucket). Each retrieval pattern has a 1-sentence operational definition plus 2 worked examples drawn from the seed corpus, so future re-pilots (SP-000-extended on additional models) can replicate the rubric.

**Why this priority**: P1 alongside US1 because without the rubric, the pilot reduces to "did the LLM invoke `corpus.find` on whatever 50 queries Shon happened to pick that day" — Architect's PR #5 review explicitly flagged this as the failure mode that invalidates the resulting N. The rubric is the guardrail that makes the personal-scale floor framing in Principle XVI defensible: the floor is honestly characterized as Shon's workflow against his substrate AND it is constructed from a query distribution that doesn't accidentally cluster on one retrieval pattern.

**Independent Test**: Inspect the 50-query set authored for the pilot (stored in `specs/000-nfr-008-pilot-lite/queries.yaml` or equivalent). Verify (a) bucket counts are exactly 30 / 15 / 5; (b) the knowledge-grounded bucket carries ≥3 retrieval-pattern labels (`factual_lookup`, `recall_by_context`, `multi_doc_synthesis`); (c) each retrieval pattern has a 1-sentence operational definition committed to the spec; (d) each retrieval pattern has 2 worked examples drawn from the seed corpus.

**Acceptance Scenarios**:

1. **Given** the 50-query set is authored, **When** an automated linter (or manual review checklist) inspects the bucket distribution, **Then** counts are exactly 30 knowledge-grounded / 15 general / 5 adversarial.
2. **Given** the knowledge-grounded bucket of 30 queries, **When** the bucket is parsed for retrieval-pattern labels, **Then** each query carries one of `factual_lookup`, `recall_by_context`, or `multi_doc_synthesis`, AND all three labels appear at least once.
3. **Given** the spec carries operational definitions for the three retrieval patterns, **When** a reviewer reads the spec, **Then** each definition is exactly one sentence AND each definition is followed by 2 worked examples whose query text appears verbatim in the 50-query set.

---

### User Story 3 — Personal-scale floor framing is preserved end-to-end (Priority: P1)

Whatever N the pilot commits (or whatever downgrade/escalation it triggers), the framing in every artifact MUST state explicitly that the result is "Shon's workflow on `qwen3:8b` against his own knowledge-work substrate" and NOT an "industry-standard floor for local-LLM tool-use rate." This framing constraint applies to: the `decisions.jsonl` D-NNN entry that records the result; any update to `.product/REQUIREMENTS.yaml` NFR-008 fields; any user-facing CLI `--help` output, README, or whitepaper passage that cites the committed N.

**Why this priority**: P1 because Constitution Principle XVI (Validation Honesty) is NON-NEGOTIABLE and ADR-010 §Decision explicitly invokes it. Without this framing constraint, the pilot output silently drifts into a marketing claim ("llm-corpus achieves N=X local-LLM tool-use rate") that AG-004 + AG-005 forbid in v1.0.0. The framing IS the deliverable for this user story; the artifacts that consume it (D-NNN entry, REQUIREMENTS.yaml fields, README) are tested for compliance.

**Independent Test**: After the pilot resolves, inspect (a) the new D-NNN ledger entry; (b) any modified field in `.product/REQUIREMENTS.yaml` NFR-008; (c) any user-facing text mentioning the committed N. Verify each artifact contains an explicit personal-scale qualifier (phrase like "personal-scale floor," "Shon's workflow on qwen3:8b," or equivalent) AND does not contain unqualified industry-standard phrasing.

**Acceptance Scenarios**:

1. **Given** the pilot has committed final N to a D-NNN entry, **When** the entry is read, **Then** its `rationale` or equivalent free-text field contains an explicit personal-scale qualifier identifying the model (`qwen3:8b`) AND the substrate (Shon's knowledge-work corpus, not a public benchmark dataset).
2. **Given** any user-facing artifact (README, CLI `--help`, whitepaper passage) cites the committed N, **When** that passage is reviewed, **Then** it carries the personal-scale qualifier inline and does not assert cross-model or cross-user generalization.
3. **Given** NFR-008 in `.product/REQUIREMENTS.yaml` is updated with the pilot result, **When** the field is read, **Then** the floor is annotated with both the model identity AND a pointer to the D-NNN entry that established it.

---

### Edge Cases

- **First-run iteration cycle exhausts without reaching N=15**: ADR-010 permits one additional iteration with a revised prompt variant. If iteration 2 also lands <N=15, the binary exit forces downgrade or escalation; iteration 3 is forbidden by ADR-010 scope.
- **`qwen3:8b` unavailable on build environment at pilot time**: If the model is not loadable (e.g., disk full, Ollama daemon down), the pilot halts with a structured telemetry event rather than substituting a different model — model substitution would invalidate ADR-010's "qwen3:8b is what was measured" basis.
- **MCP server crash mid-pilot**: The harness MUST emit a structured telemetry event for the failure, persist any partial results, and halt cleanly. Resumption from partial state is out of scope; a re-run starts the 50-query set from scratch (idempotency comes from the deterministic query set, not from harness checkpointing).
- **LLM emits malformed tool call (schema violation on `corpus.find` arguments)**: Counted AS an invocation in the headline N (single-shot; no retry) — the LLM attempted the tool call; the JSON was malformed. The telemetry event records `tool_invoked=true`, `tool_arguments_valid=false`, AND `malformed_call_payload` (non-null) capturing the raw malformed arguments for later prompt-template diagnosis. The per-iteration summary reports the malformed-call rate as a secondary diagnostic (count of knowledge-grounded queries where `tool_invoked=true && tool_arguments_valid=false`, divided by 30); a soft-threshold flag fires above 10/30 in the knowledge-grounded bucket but does NOT force escalation (binary exit remains parameterized on N alone per ADR-010).
- **Query in knowledge-grounded bucket gets retrieval but the retrieved doc is irrelevant**: Out of scope for SP-000-lite — this pilot measures *tool invocation rate*, not retrieval quality. Retrieval-quality measurement is OOS-012 (deferred to v1.5+ per AG-005).
- **Adversarial bucket query triggers tool invocation when it should not**: Recorded in telemetry as a `tool_invoked=true` event in the adversarial bucket. Whether this counts as a pilot failure depends on Shon's read of the result; ADR-010's binary exit is parameterized on the knowledge-grounded N, not on adversarial-bucket behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-PILOT-001**: The pilot harness MUST drive 50 query turns through `qwen3:8b` (loaded via Ollama on the build environment) with the SP-001/SP-002 MCP server advertised over stdio, exposing the `corpus.find` tool and the four `corpus://` resources (manifest, taxonomy, recent, docs/{id}) as the available substrate.
- **FR-PILOT-002**: The 50-query set MUST be stratified into exactly 30 knowledge-grounded queries (60% bucket), 15 general queries (30% bucket), and 5 adversarial queries (10% bucket).
- **FR-PILOT-003**: The 30-query knowledge-grounded bucket MUST cover at least 3 distinct retrieval patterns: `factual_lookup`, `recall_by_context`, and `multi_doc_synthesis`. Each pattern MUST be operationally defined in the spec with a 1-sentence definition followed by 2 worked examples drawn from the seed corpus.
- **FR-PILOT-004**: The pilot MUST run a single prompt variant on iteration 1. If iteration 1 lands below N=15 on the knowledge-grounded subset, the pilot MAY run exactly one additional iteration with a revised prompt variant; iteration 3+ is FORBIDDEN by ADR-010 scope.
- **FR-PILOT-005**: The pilot harness MUST emit a structured telemetry event of class `nfr_008_pilot` per query, with feature-specific fields: `model` (string, expected `qwen3:8b`), `prompt_variant` (string identifier), `query_id` (string), `query_bucket` (`knowledge_grounded`/`general`/`adversarial`), `retrieval_pattern` (one of the three for knowledge-grounded; null for general/adversarial), `tool_invoked` (boolean), `tool_arguments_valid` (boolean), `malformed_call_payload` (string|null — raw malformed arguments when `tool_arguments_valid=false`, null otherwise), `retrieval_outcome` (string, opaque to this pilot), `duration_ms` (integer) — plus the standard event-envelope fields (`event_class`, `severity`, `timestamp`, `run_id`, `iteration`) required on every event by the registered `nfr_008_pilot` Zod schema. Events MUST be written as JSONL stream to `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` where `{N}` is the iteration number (1 or 2 per FR-PILOT-004). Each line is one valid JSON object conforming to the schema enumerated above. Compliance with Constitution Principle XIII is non-negotiable.
- **FR-PILOT-006**: The pilot harness MUST write all artifacts (telemetry log, summary, query set) under paths reachable through `Paths.*` (Constitution Principle XIV). Writes outside `$HOME` or to `/tmp`, `/var`, system paths, or arbitrary cwd-relative locations are FORBIDDEN. Specifically: the pilot's telemetry file path is `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` and the pilot summary file path is `Paths.pilotTelemetry()/pilot-iter{N}-summary.json`. Both MUST resolve through `Paths.*` (no hardcoded path literals in the harness).
- **FR-PILOT-007**: At pilot resolution, exactly one of three terminal artifacts MUST be produced: (a) a new `decisions.jsonl` D-NNN entry committing the final N; OR (b) a `decisions.jsonl` entry formally downgrading NFR-008 from `priority: should` to `priority: nice_to_have`; OR (c) a `decisions.jsonl` entry formally escalating to full SP-000 per ADR-005 alternative 1.
- **FR-PILOT-008**: The terminal artifact (whichever of FR-PILOT-007 (a)/(b)/(c) applies) MUST contain explicit personal-scale qualifier text identifying both the model (`qwen3:8b`) and the substrate (Shon's personal knowledge-work corpus). Industry-standard phrasing is FORBIDDEN per Constitution Principle XVI.
- **FR-PILOT-009**: SP-000-lite MUST NOT introduce a labeled retrieval evaluation harness, hit-rate metric, or relevance-judged dataset (per AG-005 / OOS-012). The pilot measures *tool invocation rate*, not *retrieval quality*. Any extension toward retrieval-quality scoring is forbidden in this spec's scope.
- **FR-PILOT-010**: The seed corpus exercised by the pilot IS a curated sampler of 32 documents (30 PDFs + 2 DOCX, treated uniformly under the "good enough" PDF→text bar — see `## Substrate File List`) — 4 Books + 8 Writing-style references + ~20 Modeling-domain references — drawn from `~/Documents/Personal/`. PDF→text conversion uses `pdftotext` (structure-loss acceptable per Shon's "good enough" quality bar). Excluded: Russian-language material; all self-written content (Practical Dharma, theravada-eightfold-path, secular-dharma-foundations, The Long Shout, Tank & AFV Enthusiast); binary `.azw.md` Kindle artifacts; Family Shared / Claude Shared / Career / Backups subtrees. Explicit file paths enumerated in `## Substrate File List` below.
- **FR-PILOT-011**: The 30 knowledge-grounded queries MUST be mined from `~/.claude/MEMORY/WORK/` PRD bodies (extracting question-shaped language) AND topic-cross-checked against Shon's bookmarks file (path supplied at harness-implementation time) for topic-coverage validation. The 15 general queries and 5 adversarial queries MUST be hand-crafted by Shon: general queries are NOT corpus-grounded (test tool-use discrimination), adversarial queries are *close to* corpus topics but should NOT trigger `corpus.find` (test false-positive resistance).
- **FR-PILOT-012**: The operational definitions of the three retrieval patterns (`factual_lookup`, `recall_by_context`, `multi_doc_synthesis`) are authored as DRAFT in `## Retrieval Pattern Operational Definitions` below by the Engineer. Shon ratifies the DRAFT in the PR review walkthrough. Running the pilot harness against unratified definitions is FORBIDDEN.
- **FR-PILOT-013**: The pilot summary MUST report, per iteration: (a) the headline N (count of knowledge-grounded queries where `tool_invoked=true`); (b) the malformed-call rate (count of knowledge-grounded queries where the LLM emitted a tool call but `tool_arguments_valid=false`, divided by 30); (c) a soft-threshold flag set when malformed-call rate exceeds 10/30 (33%) on the knowledge-grounded bucket. The soft-threshold flag is informational only — it does NOT force escalation; ADR-010's binary exit remains parameterized on N alone.
- **FR-PILOT-014**: Iteration-1 telemetry artifacts MUST NOT be deleted or overwritten when iteration 2 runs. Both iteration-1 and iteration-2 files coexist under `Paths.pilotTelemetry()` for the lifetime of the pilot. They MAY be cleaned up by the user manually after the D-NNN ledger entry is committed, but the pilot harness itself MUST NOT remove them.

## Retrieval Pattern Operational Definitions

DRAFT (authored by Engineer in `/speckit-clarify` Session 2026-05-09; pending Shon's ratification in PR review walkthrough). Each definition is exactly one sentence and is followed by 2 worked examples drawn from the curated sampler substrate. A reviewer of pilot output MUST be able to classify any query into exactly one of these three buckets using only the definition + examples; ambiguous classifications indicate a definition defect that MUST be repaired before pilot run.

### `factual_lookup`

**Definition**: A query whose correct answer is a single discrete fact (name, number, date, label, single attribute) that appears verbatim or near-verbatim in exactly one source document, retrievable without combining information across documents and without contextual disambiguation.

**Worked Examples**:

1. *"Which manufacturer produced the M4A1 Sherman variants documented as 'Pacific Car & Foundry M4A1s'?"* — Answer ("Pacific Car & Foundry") is a single string lifted from one Sherman variant PDF; no disambiguation, no synthesis.
2. *"In 'Concise Writing,' what is the rule about the word 'really'?"* — Answer is a single rule statement located in one writing-style PDF; pure single-doc extraction.

### `recall_by_context`

**Definition**: A query whose correct answer requires the LLM to first identify *which* document is relevant (because the user's phrasing does not name the document directly) and then extract the answer from that disambiguated document, but where the answer itself still lives in a single source once the right document is identified.

**Worked Examples**:

1. *"What does Coates argue about the body in his book-length letter to his son?"* — User does not name `Between_the_World_and_Me`; the LLM must recognize the description ("book-length letter to his son" / "the body") as identifying that book, then answer from it.
2. *"Where do I find the Tamiya paint mix recipes for German armor?"* — User does not name `Tamiya Paint Mixes.pdf` or `DAK Painting Guide…`; the LLM must disambiguate between two plausible Workbench-domain references before answering.

### `multi_doc_synthesis`

**Definition**: A query whose correct answer cannot be assembled from any single source document and instead requires combining information from two or more distinct documents in the corpus, where omitting any one of those documents produces an incomplete or incorrect answer.

**Worked Examples**:

1. *"Compare what the Sherman 'Engine Decks' PDF says about engine-bay layout to what the 'M4 Shermans Composites (Hybrid) Small and Large Hatch' PDF says about hull-engine integration."* — Answer requires reading two distinct Sherman variant PDFs and combining them; neither alone satisfies the query.
2. *"What writing rules across Shon's reference set could explain why the passive voice appears overused in WWII armor descriptions?"* — Answer requires combining `Passive Voice 2024.pdf` (rule) with at least one Modeling reference document (example domain); neither alone constitutes the synthesis.

## Substrate File List

The pilot's seed corpus is exactly the ~32 PDFs enumerated below. The harness-implementation phase (Phase 2 / `/speckit-plan`) consumes this list verbatim — no re-curation required.

### Books (4)

1. `~/Documents/Personal/Books/Between_the_World_and_Me.pdf`
2. `~/Documents/Personal/Books/How_to_be_an_Antiracist.pdf`
3. `~/Documents/Personal/Books/The_Autobiography_of_Malcolm_X.pdf`
4. `~/Documents/Personal/Books/The_Noble_Eightfold_Path.pdf`

### Writing-Style References (8)

5. `~/Documents/Personal/Writing/Using and Fixing Modifiers.pdf`
6. `~/Documents/Personal/Writing/Clauses 2024  2024.pdf`
7. `~/Documents/Personal/Writing/Using Pronouns  2024.pdf`
8. `~/Documents/Personal/Writing/Using the Apostrophe 2024.pdf`
9. `~/Documents/Personal/Writing/Commonly Confused Words.pdf`
10. `~/Documents/Personal/Writing/Passive Voice 2024.pdf`
11. `~/Documents/Personal/Writing/Concise Writing.pdf`
12. `~/Documents/Personal/Writing/seven_deadly_sins_of_writing.pdf`

### Modeling — Workbench / Technique (5)

13. `~/Documents/Personal/Modeling/Workbench/Realistic German Tank Ammunition - David Parker.pdf`
14. `~/Documents/Personal/Modeling/Workbench/Working with PE for Armor Modelers_Book.pdf`
15. `~/Documents/Personal/Modeling/Workbench/Tamiya Paint Mixes.pdf`
16. `~/Documents/Personal/Modeling/Workbench/DAK Painting Guide for German Vehicles in the Deutsches Afrikakorps, 1941-43.docx` *(DOCX — extracted via `docx2txt` or `pandoc` rather than `pdftotext`; structure-loss acceptable per Q1 quality bar)*
17. `~/Documents/Personal/Modeling/Workbench/ECL101-IM.pdf`

### Modeling — Reference Library / General (3)

18. `~/Documents/Personal/Modeling/Reference Library/The USA Historical AFV register 4.7 rev1.pdf`
19. `~/Documents/Personal/Modeling/Reference Library/Complete List of German WWII Equipment by Sd.docx` *(DOCX; same conversion treatment as #16)*
20. `~/Documents/Personal/Modeling/Reference Library/Dientvorschriften/D1003_1-1942.pdf` *(German service manual — supports multi-doc synthesis with Workbench painting guides)*

### Modeling — AFV / T-34 (2)

21. `~/Documents/Personal/Modeling/AFV/T-34 76/Improving_Tamiya_T34.pdf`
22. `~/Documents/Personal/Modeling/AFV/T-34 76/Surviving_T-34.76.pdf`

### Modeling — AFV / Sherman (8)

23. `~/Documents/Personal/Modeling/AFV/Sherman/Sherman Engine Decks.pdf`
24. `~/Documents/Personal/Modeling/AFV/Sherman/M4 Shermans Composites (Hybrid) Small and Large Hatch.pdf`
25. `~/Documents/Personal/Modeling/AFV/Sherman/M4A4 Sherman Production Variants.pdf`
26. `~/Documents/Personal/Modeling/AFV/Sherman/British M3, M3A2, M3A3 and M3A5 Grants.pdf`
27. `~/Documents/Personal/Modeling/AFV/Sherman/Pacific Car & Foundry M4A1s.pdf`
28. `~/Documents/Personal/Modeling/AFV/Sherman/Sherman Firefly Tanks.pdf`
29. `~/Documents/Personal/Modeling/AFV/Sherman/M4A1 Shermans.pdf`
30. `~/Documents/Personal/Modeling/AFV/Sherman/Sherman 75mm Turrets.pdf`

### Modeling — Reference Library / Magazine (2)

31. `~/Documents/Personal/Modeling/Reference Library/AFV Modeller/AFV Modeller 050.pdf`
32. `~/Documents/Personal/Modeling/Reference Library/AFV Modeller/AFV Modeller 080.pdf`

**Total**: 32 documents (30 PDFs + 2 DOCX, treated uniformly under the "good enough" PDF→text bar).

**Aircraft note**: The `~/Documents/Personal/Modeling/Aircraft/` subtree contains only `.jpg`/`.png` image files — no PDFs/DOCX. Aircraft domain coverage is therefore intentionally absent from the substrate; the AFV/Sherman/T-34/Workbench/Reference selection provides sufficient Modeling-domain coverage for ≥3-pattern stratification.

**Curation criteria applied**:
- Sherman family selected for breadth (manufacturer variants, turret types, sub-types) — supports `recall_by_context` and `multi_doc_synthesis` queries.
- T-34 entries selected because both have full PDFs (other Soviet armor subdirs are image-only).
- Workbench entries selected to cover painting (Tamiya, DAK), technique (PE work), and ammunition reference — distinct topic clusters.
- Dientvorschriften D1003 included as a non-English (German) primary-source manual for genuine multi-doc-synthesis pairings with English secondary sources.
- AFV Modeller magazine issues 050 + 080 selected as cross-cutting magazine content (multiple short articles per issue) — useful for `recall_by_context` queries that span armor topics.

## Key Entities

- **Pilot Run**: A single end-to-end execution of the SP-000-lite harness. Carries: `model` (string, expected `qwen3:8b`), `prompt_variant` (string), `iteration` (integer, 1 or 2), `started_at`, `completed_at`, `query_set_id`, `terminal_artifact_id` (the D-NNN entry that closed the binary exit gate).
- **Query**: One of the 50 stratified queries. Carries: `query_id` (stable string), `query_text` (string), `query_bucket` (one of three), `retrieval_pattern` (one of three for knowledge-grounded; null for general/adversarial), `expected_corpus_relevance` (boolean — true for knowledge-grounded; false for general/adversarial; used only for analysis, not for pilot decision logic).
- **Pilot Telemetry Event**: One emitted per query turn. Carries the FR-PILOT-005 fields. Conforms to Constitution Principle XIII (severity, structured fields not free-form strings).
- **Pilot Summary**: One emitted at run completion. Carries: per-bucket invocation counts and rates, per-retrieval-pattern invocation counts (knowledge-grounded only), the headline N value (knowledge-grounded invocation count), iteration number, and a free-text qualitative section captured for inclusion in the eventual D-NNN entry's rationale.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ADR-010's binary exit gate is closed by exactly one of: a new `decisions.jsonl` D-NNN entry committing final N, OR an entry downgrading NFR-008 to `priority: nice_to_have`, OR an entry escalating to full SP-000. Verifiable by reading the ledger after pilot resolution.
- **SC-002**: The 50-query set authored for the pilot run satisfies the stratification rubric: exactly 30 knowledge-grounded, 15 general, 5 adversarial; the 30 knowledge-grounded queries collectively cover all three retrieval patterns with each pattern appearing at least once. Verifiable by static lint of the query-set artifact.
- **SC-003**: The pilot harness emits exactly 50 `nfr_008_pilot` telemetry events per iteration (one per query) with all FR-PILOT-005 fields populated and conforming to schema; zero events are dropped or downgraded to lower severity. Events are written to `Paths.pilotTelemetry()/pilot-iter{N}.jsonl` (one file per iteration, both retained). Verifiable by listing the directory and reading the JSONL files after pilot run.
- **SC-004**: Whatever terminal artifact is produced (D-NNN ledger entry) carries an explicit personal-scale qualifier identifying both `qwen3:8b` and the seed corpus substrate; no industry-standard phrasing appears. Verifiable by manual review of the ledger entry against Constitution Principle XVI.
- **SC-005**: SP-003 (ingest) is unblocked to begin AFTER the pilot's binary exit is closed — and not before. Verifiable by sequencing: the SP-003 spec scaffolding PR opens only after the SP-000-lite ledger entry is merged.
- **SC-006**: All pilot artifacts (telemetry log, summary, query set) live under `Paths.*` resolved paths; zero writes occur to `/tmp`, `/var`, system paths, or any location not under `$HOME`. Pilot telemetry resolves through `Paths.pilotTelemetry()`; pilot summary file resolves through the same key; no hardcoded path literal appears in the harness implementation. Verifiable by static review (grep for hardcoded paths) + filesystem audit at pilot run end.

## Assumptions

- **Build environment has `qwen3:8b` pulled in Ollama** — confirmed in ADR-010 §Context; if at pilot run time the model is unavailable, the pilot halts (per Edge Cases) rather than substituting another model.
- **SP-002's `corpus.find` MCP tool and four resources are operational on main** — confirmed; SP-002 PR #4 merged on 2026-05-09. The pilot consumes that surface, does not modify it.
- **NFR-008 currently sits at `priority: should` with provisional N=20 from D-012** — confirmed via ADR-010 §Context. The pilot's terminal artifact supersedes D-012's provisional value.
- **AG-005 binds**: SP-000-lite is NOT the OOS-012 labeled retrieval evaluation harness (deferred to v1.5+). This spec's scope is tool-use rate measurement, not retrieval-quality scoring. Any acceptance scenario that smells like "did the retrieved doc answer the query" is out of scope here.
- **AG-004 caps NFR-008 at `priority: should`**: even with a strong N, NFR-008 cannot be promoted above `should` in v1.0.0. The pilot can only commit a floor at `should`, not promote.
- **Shon ratifies retrieval-pattern definitions before pilot run** — DRAFT definitions can be authored in `/speckit-clarify`; running the pilot harness against unratified definitions is forbidden.
- **`Paths.pilotTelemetry()` resolver key is merged to main before the pilot harness runs** — adding this key (a derived getter that composes `path.join(Paths.state(), 'pilot-telemetry')`) is a prerequisite task captured in `/speckit-tasks` Phase 2. The key resolves to `{state}/pilot-telemetry/` (directory), distinct from the existing `Paths.telemetry()` which resolves to `{state}/telemetry.jsonl` (file). Running the pilot harness against an unmerged `Paths.pilotTelemetry()` key is FORBIDDEN.
- **Single-user, single-machine framing applies (Constitution Principle IV)** — no multi-user, multi-machine, or cross-environment claims arise from the pilot result. The committed N is one user's floor on one machine against one model and one substrate.
- **Sequencing**: SP-000-lite runs after SP-002 PR #4 (already merged) and gates SP-003 (ingest) per ADR-010 §Decision.
