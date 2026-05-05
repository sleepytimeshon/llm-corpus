---
artifact: SUCCESS-METRICS
project_slug: llm-corpus
stage: 1-frame
tier: deep
template_version: 3.0.0
generated: 2026-04-26T01:40:00-07:00
generated_by: ProductDevelopment Skill v1.0
supersedes: null
product_type: software

edition: spec
edition_history:
  - edition: frame
    generated: 2026-04-26T01:40:00-07:00
  - edition: spec
    generated: 2026-04-27T01:45:00Z
    extension_source: "Stage 2 carry-forward CF-4 from stage-1-to-2 handoff: add per-opportunity hard metrics for OPP-003, OPP-005, OPP-008"
counts:
  metrics_total: 7
  hard_metrics: 4
  soft_metrics: 1
  anti_metrics: 2

completeness:
  every_metric_has_baseline: true
  every_metric_has_target: true
  every_metric_has_owner: true
  every_metric_has_measurement_window: true
  every_metric_has_instrument: true
  every_metric_has_opportunity_ref: true
  every_soft_metric_paired: true

links:
  opportunity_tree: ./OPPORTUNITY-TREE.yaml
  charter: ./CHARTER.md
  personas: ./PERSONAS.md
  prd: null
sources:
  decisions: ./ledgers/decisions.jsonl
  concerns: ./ledgers/concerns.jsonl
  questions: ./ledgers/questions.jsonl
---

# Success Metrics — llm-corpus

## North-star metric

The single outcome-level metric llm-corpus moves. It traces directly to the OUTCOME node at the top of `OPPORTUNITY-TREE.yaml`. If this metric does not improve, the product has not delivered the outcome — regardless of how many opportunities were addressed or features shipped.

```yaml
hard_metrics:
  - id: M-001
    name: Weekly grounded-query rate
    category: north_star
    baseline: 0                                          # greenfield; no MCP server exists yet
    target: ">=5 corpus.find calls per week with >=1 hit accepted by Shon, sustained 4-week rolling window"
    measurement_window: "4-week rolling window, beginning 7 days post-v1 ship"
    owner: Shon
    instrument: "MCP server telemetry log (SQLite table `tool_invocations`) joined with user-marked acceptance via `corpus mark-accepted <doc_id>` CLI command. Both surfaces ship in v1."
    opportunity_ref: OPP-001
    leading_indicator: "Daily corpus.find call count (smoothed 7-day average)"
    notes: |
      RedTeam pre-flight (concerns.jsonl C-003) replaced the original "50-query hit-rate >= 0.85" success metric because the labeled eval harness does not exist and is listed as Future Work in WHITEPAPER §5. This north-star is measurable from day one of v1 use because both surfaces (telemetry, mark-accepted CLI) ship in v1.

      Threshold rationale: 5 queries/week is the floor at which the corpus is meaningfully part of Shon's workflow rather than a vanity install. The acceptance signal (>=1 hit accepted per week) prevents the metric from rewarding query-spam without retrieval value.
```

## Soft metrics (qualitative signals — paired with the north-star)

```yaml
soft_metrics:
  - id: SM-001
    name: Weekly groundedness reflection
    method: interview
    cadence: "End of every 7-day window"
    owner: Shon
    paired_hard_metric: M-001
    sample_size_minimum: 4 weeks before signal counts
    notes: |
      One-sentence written reflection at week-end: "Did the corpus make me more grounded this week, or did I work around it?" Captured as a journal entry in MEMORY/WORK or via `corpus reflect` CLI. The signal counts only after 4 weeks because earlier impressions are dominated by setup novelty and initial-ingest excitement, not steady-state value.
```

## Anti-metrics (what we explicitly will NOT optimize)

```yaml
anti_metrics:
  - id: AM-001
    name: Total document count in corpus
    why_not_optimize: "Vanity. Bloating the corpus with low-quality or low-relevance documents degrades retrieval — both signal-to-noise and disk/index cost. The corpus should grow because Shon reads more, not because document count is a number to chase."
    common_temptation: '"Look how big my library is" — feels like progress, isn'"'"'t.'
    related_anti_goal: null

  - id: AM-002
    name: Classifier output confidence score (averaged across documents)
    why_not_optimize: "The classifier outputs grammar-constrained JSON; structurally invalid output is impossible. A high average confidence score would tempt the team to optimize the classifier prompt for confidence rather than for downstream retrieval quality. The right signal is whether retrieval works, not whether the classifier feels sure."
    common_temptation: '"Our classifier is 95% confident on average" — confidence is not correctness.'
    related_anti_goal: null
```

## Why these and not others (Frame-stage rationale)

The original architecture document named "hit-rate ≥ 0.85 on 50-query harness" as the gating success metric. Stage 1 RedTeam pre-flight (concerns.jsonl C-003) flagged that the harness does not exist, the queries are not written, the relevance judgments are not produced, and the whitepaper itself lists "formal retrieval evaluation" as Future Work. A v1 success metric that depends on Future Work is unmeasurable at v1 ship.

The replacement north-star (M-001) is measurable from day one because both surfaces ship in v1 — the MCP server's telemetry and the `corpus mark-accepted` CLI. It is also faithful to the actual outcome: the corpus is successful when Shon habitually reaches for it through his agent and gets value back.

The weekly reflection (SM-001) is the qualitative pair. Quantitative usage without subjective groundedness can mean the agent is calling corpus.find but not benefiting; quantitative + qualitative together is the honest signal.

The two anti-metrics (AM-001 document count, AM-002 average classifier confidence) name the two most likely vanity-metric drift paths the architecture-spec language might tempt. Naming them now prevents PM-Review at Stage 2+ from accepting them as proxies for the north-star.

## Gate ties

A metric counts as "owned" (and therefore counted toward gate M-09) only when:

- it has `baseline`, `target`, `measurement_window`, `owner`, `instrument`, `opportunity_ref` — all six, none null
- the instrument is real (a query, dashboard, or tool — not "we'll figure it out")
- it traces to a specific `opportunity_ref` from `OPPORTUNITY-TREE.yaml`

M-001 satisfies all six. SM-001 is paired (S-06 satisfied).

## Per-opportunity hard metrics (Spec edition — CF-4 from Stage 1 handoff)

Stage 2 carry-forward CF-4 from `handoffs/stage-1-to-2.md` requires per-opportunity hard metrics for OPP-003, OPP-005, OPP-008. Each block has all six required fields (baseline, target, measurement_window, owner, instrument, opportunity_ref) per gate M-09.

```yaml
hard_metrics:
  - id: M-002
    name: Classifier autonomy rate
    category: per_opportunity
    baseline: 0                                          # greenfield; classifier does not exist yet
    target: ">=95% of ingested documents classified end-to-end with no operator intervention (no manual frontmatter edit, no retry trigger), measured across 100-doc benchmark in v1 and 30-day usage in v1.1"
    measurement_window: "100-doc benchmark at v1 ship + 30-day rolling window post-ship"
    owner: Shon
    instrument: "Pipeline event log (NFR-011) joined with failure-lane (FR-018) — autonomy_rate = (docs_classified_successfully / docs_ingested) where successfully = no manual intervention recorded in audit log"
    opportunity_ref: OPP-003
    requirement_refs: [FR-012, FR-013, FR-014, NFR-004]
    leading_indicator: "Per-batch failure-lane entry count (smoothed)"
    notes: |
      OPP-003 framed classification as "operator overhead I won't do." Success = the classifier does it WITHOUT operator overhead. NFR-004 already requires 100% schema-validity on benchmark; this M-002 widens the bar from "schema-valid" to "no human intervention required end-to-end" (which includes things like vocabulary-conflict triage that wouldn't fail NFR-004 but would still cost operator time).

  - id: M-003
    name: Local-only invariant verified
    category: per_opportunity
    baseline: 0                                          # no enforcement exists yet
    target: "100% of CI runs pass NFR-001 lint AND 100% of weekly runtime egress audits (NFR-002 tcpdump harness on sentinel privileged document) observe zero outbound non-loopback packets, sustained over rolling 90-day window"
    measurement_window: "Per-CI-run for static; weekly cron for runtime; 90-day rolling window aggregate"
    owner: Shon
    instrument: "(a) CI lint job (NFR-001) report; (b) Weekly cron tcpdump+sentinel-doc harness (NFR-002) writing pass/fail to ledger; (c) Egress.blocked telemetry events (NFR-016) — zero events on privileged-data path = pass"
    opportunity_ref: OPP-005
    requirement_refs: [NFR-001, NFR-002, NFR-016]
    leading_indicator: "Daily egress.blocked event count from telemetry (should be 0 on privileged-data path)"
    notes: |
      OPP-005 framed local-only as "won't store my docs in a SaaS that lets the vendor see them." This is the outcome-level metric for that opportunity; NFR-001/002/016 are the requirement-level expressions. The metric joins all three for a binary "invariant holds" signal.

  - id: M-004
    name: Pipeline autonomy on real-use ingest
    category: per_opportunity
    baseline: 0                                          # pipeline does not exist yet
    target: ">=90% of documents ingested via the inbox watcher reach searchable state (FR-015 indexed) without operator action — measured over a 30-day window of real Shon-with-Claude-Code use after v1 ship"
    measurement_window: "30-day rolling window starting 7 days post-v1 ship"
    owner: Shon
    instrument: "Telemetry log (NFR-016 ingest.completed events) divided by total inbox enqueue events (FR-010 ingest.enqueued events). Operator action = any CLI replay (UR-005), manual re-classify (UR-004), or failure-lane manual triage."
    opportunity_ref: OPP-008
    requirement_refs: [FR-010, FR-011, FR-016a, FR-016b, FR-018, NFR-005]
    leading_indicator: "Daily failure-lane entry rate; if rising, M-004 will degrade"
    notes: |
      OPP-008 framed the autonomous pipeline as the differentiator from operator-heavy tools (Priya's ChromaDB pipeline she abandoned). M-004 measures whether the autonomy claim holds in real use — separate from NFR-005 (kill -9 reliability) and FR-018 (failure lane works); this metric checks the FREQUENCY of human-in-the-loop, not the correctness of when the human IS in the loop.
```

## Why these per-opportunity metrics now (Spec-edition rationale)

Stage 1 PM-Review accepted CONDITIONAL_GO (per Council recommendation C-007) on the condition that Stage 2 add per-opportunity hard metrics for OPP-003, OPP-005, OPP-008 (the three opportunities whose Frame-stage measurability was weakest). CF-4 in stage-1-to-2 handoff records this commitment.

Each metric:
- Joins requirement-level NFRs (single-property tests) into outcome-level signals (does-the-opportunity-actually-resolve)
- Has its instrument grounded in shipping requirements (M-002 uses NFR-011 + FR-018; M-003 uses NFR-001/002/016; M-004 uses NFR-016 + FR-010 + UR-004/005). No metric depends on infrastructure that does not ship in v1.
- Is measurable from data the system produces in normal use — no separate eval harness needed (consistent with AG-005)

## Carry-forward to Stage 4 (Plan edition)

When Stage 4 extends SUCCESS-METRICS.md to its Plan edition, it:

1. Keeps M-001..M-004 unchanged (Stage 2 is the source for those)
2. Adds per-requirement hard metrics for any must-have FR-NNN that needs additional metric coverage beyond NFR quantitative_targets
3. Re-validates completeness — Plan edition's gate cascades all six fields to every new metric

## Notes

- Per AG-005: the formal 50-query labeled retrieval evaluation harness is explicitly v1.5 work, not v1. M-001 is the v1 north-star; the formal harness is v1.5 work that supersedes M-001 only after sufficient v1 usage data validates that M-001 was capturing the right signal.
- M-001 traces to OPP-001 because the agent-grounded-in-user-docs outcome is what every other opportunity ultimately serves.
- The instrument for M-001 (MCP telemetry + mark-accepted CLI) becomes a Stage 2 must-have requirement so it ships in v1 alongside the substrate it measures.

---

*Opportunity tree: [`./OPPORTUNITY-TREE.yaml`](./OPPORTUNITY-TREE.yaml) · Personas: [`./PERSONAS.md`](./PERSONAS.md) · Anti-goals: [`./ANTI-GOALS.md`](./ANTI-GOALS.md)*
