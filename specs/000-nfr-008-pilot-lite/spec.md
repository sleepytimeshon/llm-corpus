# Feature Specification: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Feature Branch**: `000-nfr-008-pilot-lite`
**Created**: 2026-05-09
**Status**: Draft
**Input**: SP-000-lite per ADR-010 (which supersedes ADR-005). Reduced-scope pre-build pilot to set the NFR-008 absolute floor for local-LLM tool-use rate against the corpus, OR formally downgrade NFR-008 to `priority: nice_to_have`. 50-query benchmark on `qwen3:8b` (already pulled on the build environment), single prompt variant initially with one optional iteration cycle if first run lands below N=15. Stratification rubric required: 30 knowledge-grounded queries (60%), 15 general queries (30%), 5 adversarial queries (10%); knowledge-grounded bucket covers ≥3 distinct retrieval patterns (factual lookup, recall-by-context, multi-document synthesis), each with a 1-sentence operational definition + 2 worked examples per Architect's PR #5 review. Binary exit constraint preserved verbatim from ADR-005: commit final N to `decisions.jsonl` as a new D-NNN entry, OR formal downgrade of NFR-008 to `nice_to_have` priority, OR formal escalation to full SP-000 (per ADR-005 alternative 1 with both spec'd models). Personal-scale floor framing required throughout. Sequencing: SP-000-lite runs after SP-002 (PR #4 merged) and before SP-003 (ingest work). Substrate exercised: SP-002's `corpus.find` MCP tool + four `corpus://` resources (manifest, taxonomy, recent, docs/{id}). Constitutional anchors: Principle XIII (telemetry-or-die — harness emits `nfr_008_pilot` events), Principle XVI (validation honesty — personal-scale floor framing). Anti-goal anchor: AG-005 (this is NOT the OOS-012 labeled retrieval evaluation harness; this is tool-use rate measurement on real personal data).

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
- **LLM emits malformed tool call (schema violation on `corpus.find` arguments)**: Counted as a non-invocation in the per-bucket tally (the LLM did not successfully invoke the tool). The telemetry event records `tool_invoked=false` AND a separate field capturing the malformed-call payload for later prompt-template diagnosis.
- **Query in knowledge-grounded bucket gets retrieval but the retrieved doc is irrelevant**: Out of scope for SP-000-lite — this pilot measures *tool invocation rate*, not retrieval quality. Retrieval-quality measurement is OOS-012 (deferred to v1.5+ per AG-005).
- **Adversarial bucket query triggers tool invocation when it should not**: Recorded in telemetry as a `tool_invoked=true` event in the adversarial bucket. Whether this counts as a pilot failure depends on Shon's read of the result; ADR-010's binary exit is parameterized on the knowledge-grounded N, not on adversarial-bucket behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-PILOT-001**: The pilot harness MUST drive 50 query turns through `qwen3:8b` (loaded via Ollama on the build environment) with the SP-001/SP-002 MCP server advertised over stdio, exposing the `corpus.find` tool and the four `corpus://` resources (manifest, taxonomy, recent, docs/{id}) as the available substrate.
- **FR-PILOT-002**: The 50-query set MUST be stratified into exactly 30 knowledge-grounded queries (60% bucket), 15 general queries (30% bucket), and 5 adversarial queries (10% bucket).
- **FR-PILOT-003**: The 30-query knowledge-grounded bucket MUST cover at least 3 distinct retrieval patterns: `factual_lookup`, `recall_by_context`, and `multi_doc_synthesis`. Each pattern MUST be operationally defined in the spec with a 1-sentence definition followed by 2 worked examples drawn from the seed corpus.
- **FR-PILOT-004**: The pilot MUST run a single prompt variant on iteration 1. If iteration 1 lands below N=15 on the knowledge-grounded subset, the pilot MAY run exactly one additional iteration with a revised prompt variant; iteration 3+ is FORBIDDEN by ADR-010 scope.
- **FR-PILOT-005**: The pilot harness MUST emit a structured telemetry event of class `nfr_008_pilot` per query, with fields: `model` (string, expected `qwen3:8b`), `prompt_variant` (string identifier), `query_id` (string), `query_bucket` (`knowledge_grounded`/`general`/`adversarial`), `retrieval_pattern` (one of the three for knowledge-grounded; null for general/adversarial), `tool_invoked` (boolean), `tool_arguments_valid` (boolean), `retrieval_outcome` (string, opaque to this pilot), `duration_ms` (integer). Compliance with Constitution Principle XIII is non-negotiable.
- **FR-PILOT-006**: The pilot harness MUST write all artifacts (telemetry log, summary, query set) under paths reachable through `Paths.*` (Constitution Principle XIV). Writes outside `$HOME` or to `/tmp`, `/var`, system paths, or arbitrary cwd-relative locations are FORBIDDEN.
- **FR-PILOT-007**: At pilot resolution, exactly one of three terminal artifacts MUST be produced: (a) a new `decisions.jsonl` D-NNN entry committing the final N; OR (b) a `decisions.jsonl` entry formally downgrading NFR-008 from `priority: should` to `priority: nice_to_have`; OR (c) a `decisions.jsonl` entry formally escalating to full SP-000 per ADR-005 alternative 1.
- **FR-PILOT-008**: The terminal artifact (whichever of FR-PILOT-007 (a)/(b)/(c) applies) MUST contain explicit personal-scale qualifier text identifying both the model (`qwen3:8b`) and the substrate (Shon's personal knowledge-work corpus). Industry-standard phrasing is FORBIDDEN per Constitution Principle XVI.
- **FR-PILOT-009**: SP-000-lite MUST NOT introduce a labeled retrieval evaluation harness, hit-rate metric, or relevance-judged dataset (per AG-005 / OOS-012). The pilot measures *tool invocation rate*, not *retrieval quality*. Any extension toward retrieval-quality scoring is forbidden in this spec's scope.
- **FR-PILOT-010**: The seed corpus exercised by the pilot MUST be a real on-disk substrate (not synthetic / not the empty SP-001 corpus). The specific source of the seed corpus is unresolved; see Q1 below.
- **FR-PILOT-011**: The 30 knowledge-grounded queries MUST be sourced from material that genuinely tests recall against the seed corpus (i.e., the queries must have answers in the corpus). The query mining source is unresolved; see Q2 below.
- **FR-PILOT-012**: The operational definitions of the three retrieval patterns (`factual_lookup`, `recall_by_context`, `multi_doc_synthesis`) MUST be ratified by Shon before pilot run. The Engineer MAY author DRAFT definitions; ratification is not delegable. See Q3 below.

### Open Questions Requiring User Decisions

The following three areas are deliberately left unresolved at spec-scaffolding time. These decisions are not pre-decided by ADR-010 and require user input via `/speckit-clarify` (separate Engineer invocation) before the pilot harness can be implemented:

#### [NEEDS CLARIFICATION: Q1] Seed corpus substrate

**What we need to know**: Which on-disk corpus does the pilot exercise as its retrieval substrate?

**Why it matters**: The N value is a function of the substrate. A corpus of llm-corpus's own architecture docs produces different tool-invocation behavior than a corpus of mixed personal knowledge-work content; both produce different behavior from a corpus of heterogeneous codebases. The personal-scale floor framing in Constitution Principle XVI requires identifying the substrate explicitly.

**Suggested options**:

| Option | Substrate | Implication |
|--------|-----------|-------------|
| A | llm-corpus's own architecture/spec docs (`docs/`, `.product/`, `.specify/memory/`, ARCHITECTURE-FINAL.md, etc.) | Self-referential; small substrate (~50-100 docs); pilot signal limited to "can the LLM use the corpus to answer questions about the corpus." Tightest scope; closest to reproducible. |
| B | `~/.claude/MEMORY/WORK/` PRD bodies (per ADR-010 §Decision query construction note) | Council-recommended for query mining; substrate is real personal knowledge-work content; size depends on PRD count at pilot time. Larger substrate; closer to the production use case. |
| C | Heterogeneous slice of `~/Projects/` (multiple repos / multiple domains) | Highest realism; broadest substrate; most variance in document structure. Hardest to characterize for the personal-scale qualifier; most representative of Shon's actual usage. |

#### [NEEDS CLARIFICATION: Q2] Query mining source for the 30 knowledge-grounded queries

**What we need to know**: Where do the 30 knowledge-grounded queries come from?

**Why it matters**: The knowledge-grounded queries must have answers in the seed corpus, AND they must reflect realistic agent prompts (not contrived test cases). Source choice affects whether the pilot measures realistic tool-use rate or rate-on-curated-easy-cases.

**Suggested options**:

| Option | Source | Implication |
|--------|--------|-------------|
| A | Hand-craft from substrate without mining (Engineer/Shon authors all 30 by reading the corpus) | Fully controlled; risk of authoring queries the LLM happens to handle well; lowest realism. |
| B | Mine from `~/.claude/MEMORY/WORK/` PRD bodies (per ADR-010 Decision text) | Council recommendation; queries reflect Shon's actual past intents; queries paired with corpus answers requires substrate Q1=B (or substrate that includes the PRD-referenced material). |
| B+C blend | Mine from `~/.claude/MEMORY/WORK/` plus a sampled set from active project session transcripts in `~/Projects/*/docs/SESSION_STATE.md` | Council also supported this blend; covers both retrospective intent (PRDs) and in-flight intent (session state); broader query distribution at the cost of more curation time. |

#### [NEEDS CLARIFICATION: Q3] Retrieval pattern operational definitions

**What we need to know**: What are the binding 1-sentence operational definitions of `factual_lookup`, `recall_by_context`, and `multi_doc_synthesis` for THIS pilot's bucket-labeling purposes?

**Why it matters**: The Architect's PR #5 review made the retrieval-pattern stratification load-bearing. Definitions that are too loose let the same query be labeled either way, which silently re-creates the very query-set skew the rubric was supposed to prevent. The Engineer can draft definitions, but Shon ratifies — these become the binding operational contract for the pilot AND for any SP-000-extended re-run.

**Suggested options**:

| Option | Approach | Implication |
|--------|----------|-------------|
| A | Engineer authors DRAFT definitions in `/speckit-clarify`; Shon reviews and ratifies inline | Fastest; Engineer drafts based on retrieval-quality literature norms (factual_lookup = single-doc fact extraction, recall_by_context = retrieval requiring contextual disambiguation, multi_doc_synthesis = answer requires combining ≥2 docs); Shon ratifies or amends. |
| B | Shon authors definitions from his own intuition; Engineer captures verbatim | Highest fidelity to Shon's mental model; slower; risks definitions that don't ground in published retrieval-evaluation conventions. |
| C | Adopt definitions from a cited published source (e.g., BEIR / MS MARCO / Berkeley FCL retrieval taxonomy) and bind them by citation | Most defensible against future re-pilot drift; requires Shon to ratify the chosen source; introduces external dependency on the cited taxonomy. |

### Key Entities

- **Pilot Run**: A single end-to-end execution of the SP-000-lite harness. Carries: `model` (string, expected `qwen3:8b`), `prompt_variant` (string), `iteration` (integer, 1 or 2), `started_at`, `completed_at`, `query_set_id`, `terminal_artifact_id` (the D-NNN entry that closed the binary exit gate).
- **Query**: One of the 50 stratified queries. Carries: `query_id` (stable string), `query_text` (string), `query_bucket` (one of three), `retrieval_pattern` (one of three for knowledge-grounded; null for general/adversarial), `expected_corpus_relevance` (boolean — true for knowledge-grounded; false for general/adversarial; used only for analysis, not for pilot decision logic).
- **Pilot Telemetry Event**: One emitted per query turn. Carries the FR-PILOT-005 fields. Conforms to Constitution Principle XIII (severity, tier_used where applicable, structured fields not free-form strings).
- **Pilot Summary**: One emitted at run completion. Carries: per-bucket invocation counts and rates, per-retrieval-pattern invocation counts (knowledge-grounded only), the headline N value (knowledge-grounded invocation count), iteration number, and a free-text qualitative section captured for inclusion in the eventual D-NNN entry's rationale.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: ADR-010's binary exit gate is closed by exactly one of: a new `decisions.jsonl` D-NNN entry committing final N, OR an entry downgrading NFR-008 to `priority: nice_to_have`, OR an entry escalating to full SP-000. Verifiable by reading the ledger after pilot resolution.
- **SC-002**: The 50-query set authored for the pilot run satisfies the stratification rubric: exactly 30 knowledge-grounded, 15 general, 5 adversarial; the 30 knowledge-grounded queries collectively cover all three retrieval patterns with each pattern appearing at least once. Verifiable by static lint of the query-set artifact.
- **SC-003**: The pilot harness emits exactly 50 `nfr_008_pilot` telemetry events per iteration (one per query) with all FR-PILOT-005 fields populated and conforming to schema; zero events are dropped or downgraded to lower severity. Verifiable by reading the telemetry log after pilot run.
- **SC-004**: Whatever terminal artifact is produced (D-NNN ledger entry) carries an explicit personal-scale qualifier identifying both `qwen3:8b` and the seed corpus substrate; no industry-standard phrasing appears. Verifiable by manual review of the ledger entry against Constitution Principle XVI.
- **SC-005**: SP-003 (ingest) is unblocked to begin AFTER the pilot's binary exit is closed — and not before. Verifiable by sequencing: the SP-003 spec scaffolding PR opens only after the SP-000-lite ledger entry is merged.
- **SC-006**: All pilot artifacts (telemetry log, summary, query set) live under `Paths.*` resolved paths; zero writes occur to `/tmp`, `/var`, system paths, or any location not under `$HOME`. Verifiable by static review + filesystem audit at pilot run end.

## Assumptions

- **Build environment has `qwen3:8b` pulled in Ollama** — confirmed in ADR-010 §Context; if at pilot run time the model is unavailable, the pilot halts (per Edge Cases) rather than substituting another model.
- **SP-002's `corpus.find` MCP tool and four resources are operational on main** — confirmed; SP-002 PR #4 merged on 2026-05-09. The pilot consumes that surface, does not modify it.
- **NFR-008 currently sits at `priority: should` with provisional N=20 from D-012** — confirmed via ADR-010 §Context. The pilot's terminal artifact supersedes D-012's provisional value.
- **AG-005 binds**: SP-000-lite is NOT the OOS-012 labeled retrieval evaluation harness (deferred to v1.5+). This spec's scope is tool-use rate measurement, not retrieval-quality scoring. Any acceptance scenario that smells like "did the retrieved doc answer the query" is out of scope here.
- **AG-004 caps NFR-008 at `priority: should`**: even with a strong N, NFR-008 cannot be promoted above `should` in v1.0.0. The pilot can only commit a floor at `should`, not promote.
- **Shon ratifies retrieval-pattern definitions before pilot run** — DRAFT definitions can be authored in `/speckit-clarify`; running the pilot harness against unratified definitions is forbidden.
- **Single-user, single-machine framing applies (Constitution Principle IV)** — no multi-user, multi-machine, or cross-environment claims arise from the pilot result. The committed N is one user's floor on one machine against one model and one substrate.
- **Sequencing**: SP-000-lite runs after SP-002 PR #4 (already merged) and gates SP-003 (ingest) per ADR-010 §Decision.
