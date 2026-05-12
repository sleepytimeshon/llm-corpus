# Quickstart: SP-000-Lite — NFR-008 Reduced-Scope Pilot

**Audience**: Shon (operator).
**Outcome**: discharge ADR-010's binary exit gate by running the pilot harness and writing one terminal D-NNN ledger entry.
**Time budget**: 1–2 days end-to-end (per ADR-010 §Consequences). Per-iteration model-run wall-clock is ~15–30 minutes on `pai-node01`.

This walkthrough assumes you are starting from a freshly-pulled `main` after all SP-000-lite prerequisite PRs have merged. Every step below is verifiable against an artifact you can read in the repo or on disk.

## 0. Verify prerequisites

Before running the harness, confirm the four load-bearing dependencies are in place:

### 0.1 `qwen3:8b` is pulled on `pai-node01`

```bash
ollama list | grep -E '^qwen3:8b\b'
```

If absent, run `ollama pull qwen3:8b` once and re-check. Per ADR-010 §Decision, NO other model is acceptable — the pilot halts with a structured telemetry error rather than substituting.

### 0.2 SP-002 MCP server is operational

```bash
cd /home/shonrs/Projects/llm-corpus
bun run build
node packages/cli/dist/index.js mcp --help
```

The `mcp` subcommand should list `corpus.find` as an exposed tool and the four `corpus://` resources (manifest, taxonomy, recent, docs/{id}). If the SP-002 surface is not present, SP-000-lite cannot run — re-check that `main` carries PR #4.

### 0.3 `Paths.pilotTelemetry()` resolver key is merged on `main`

```bash
grep -n 'pilotTelemetry' packages/contracts/src/paths.ts
```

Expected output: a derived-getter line returning `path.join(Paths.state(), 'pilot-telemetry')`. If absent, the PREREQ-001 task captured in plan.md has NOT yet shipped — DO NOT RUN the harness. Running against an unmerged resolver key is FORBIDDEN per FR-PILOT-006 and ADR-010 §Decision.

### 0.4 `nfr_008_pilot` event class is registered in the telemetry Zod schema

```bash
grep -n "'nfr_008_pilot'" packages/contracts/src/telemetry.ts
```

Expected output: a Zod literal entry registering the event class with FR-PILOT-005's enumerated fields. If absent, PREREQ-002 has not shipped — same prohibition as 0.3.

### 0.5 Q3 retrieval-pattern DRAFT definitions are ratified

Inspect the PR-walkthrough comments on the PR that authored spec.md `## Retrieval Pattern Operational Definitions`. Look for an explicit ratification comment from you (Shon) on each of the three patterns. Per FR-PILOT-012, running against unratified definitions is FORBIDDEN.

### 0.6 The 50-query set is committed and passes the stratification linter

```bash
ls -la specs/000-nfr-008-pilot-lite/queries.yaml
bun run vitest run tests/contract/sp000-lite/query-stratification.test.ts
```

The linter MUST pass before the harness runs. A failing linter blocks the pilot harness's own startup (per `pilot-harness.feature` scenario "Bucket count deviation blocks the pilot run").

## 1. Run iteration 1

```bash
cd /home/shonrs/Projects/llm-corpus
node packages/cli/dist/index.js pilot run --variant v1 --iteration 1
```

What this does:
- Starts the in-process MCP loopback against the SP-002 server.
- Loads `specs/000-nfr-008-pilot-lite/queries.yaml`, hashes it into the run's `query_set_id`.
- Drives 50 turns through `qwen3:8b` over Ollama on `127.0.0.1:11434`.
- Appends 50 `nfr_008_pilot` events to `${XDG_STATE_HOME:-$HOME/.local/state}/llm-corpus/pilot-telemetry/pilot-iter1.jsonl`.
- Writes an atomic per-iteration summary to `…/pilot-iter1-summary.json` at completion.

Expected wall-clock: ~15–30 minutes (50 queries × ~2–10 s per inference + tool-call envelope round-trip).

## 2. Interpret the headline N value

After the run completes, read the summary:

```bash
cat "$(node -e "console.log(require('./packages/contracts/dist/paths.js').Paths.pilotTelemetry())")/pilot-iter1-summary.json"
```

The fields that matter:
- **`headline_n`** — the count of knowledge-grounded queries on which `qwen3:8b` actually invoked `corpus.find`. Range `[0, 30]`. THIS is the value you commit to the D-NNN ledger entry.
- **`bucket_invocations`** — per-bucket counts. Useful sanity check: adversarial bucket should ideally have `tool_invoked == true` rarely (false-positive resistance).
- **`pattern_invocations`** — invocation count per retrieval pattern within the KG bucket. If one pattern is starkly lower than the others, it's a prompt-or-substrate diagnostic signal.
- **`malformed_call_count_kg`** + **`soft_threshold_flag`** — informational ONLY. The flag firing tells you "iteration 1 may have a prompt-template defect — consider revising the variant before iteration 2." It does NOT force escalation.
- **`personal_scale_qualifier`** — the framing string you'll inherit into the D-NNN entry verbatim.

### Decision branches

- **`headline_n` ≥ 15** → proceed to Step 3 (commit D-NNN entry).
- **`headline_n` < 15** → proceed to Step 4 (run iteration 2 with revised variant) OR Step 5 (downgrade NFR-008 directly if iteration 1 signal already makes iteration 2 unproductive).

## 3. Commit the terminal D-NNN ledger entry (binary exit closure)

Open `.product/ledgers/decisions.jsonl` and append a new entry. Required fields:

- **`decision_id`** — `"D-NNN"` (next free integer in the ledger).
- **`title`** — e.g., `"NFR-008 personal-scale floor = N at headline_n on qwen3:8b"`.
- **`status`** — `"accepted"`.
- **`related_adr`** — `"ADR-010"`.
- **`requirement_updated`** — `"NFR-008"`.
- **`rationale`** — MUST contain the verbatim `personal_scale_qualifier` from the summary AND a brief narrative citing the iteration count, the malformed-call rate, and any qualitative observations.
- **`evidence_paths`** — list of the per-iteration JSONL + summary files under `Paths.pilotTelemetry()` (use repo-relative or `$HOME`-relative paths).

Verify the entry passes the personal-scale-qualifier presence check before commit (the same Zod check the contract test enforces).

Then close the loop:
- Update `Pilot Run.terminal_artifact_id` references where they appear in PR commentary.
- Update `.product/REQUIREMENTS.yaml` NFR-008 floor and `linked_decision: D-NNN`.
- Confirm the D-NNN entry's rationale carries the personal-scale qualifier inline (a quick `grep -E 'qwen3:8b|personal-scale' .product/ledgers/decisions.jsonl`).

ADR-010's binary exit gate is now closed. SP-003 (ingest) is unblocked per SC-005.

## 4. (Conditional) Run iteration 2 with revised variant

Only invoke iteration 2 if iteration 1 lands `headline_n` < 15 AND you have a prompt-variant hypothesis worth testing. Per ADR-010, exactly ONE additional iteration is permitted; iteration 3+ is forbidden.

```bash
node packages/cli/dist/index.js pilot run --variant v2-revised --iteration 2
```

The variant name `v2-revised` is conventional but free-form; what matters is that you record (in PR comments or in the D-NNN rationale) what changed in the prompt between v1 and v2. Iteration 2 writes to `pilot-iter2.jsonl` + `pilot-iter2-summary.json` and MUST NOT touch the iteration 1 artifacts (per FR-PILOT-014).

After iteration 2 completes, re-interpret per Step 2. Then:
- If iteration 2 `headline_n` ≥ 15 → Step 3 (commit D-NNN with iteration 2's N).
- If iteration 2 `headline_n` < 15 → Step 5 (downgrade) or Step 6 (escalate).

## 5. (Conditional) Downgrade NFR-008 to `nice_to_have`

If both iterations land below N=15 and you judge the local-LLM tool-use rate insufficient to defend at `priority: should`, write a D-NNN entry that:
- Downgrades `NFR-008` to `priority: nice_to_have` in `.product/REQUIREMENTS.yaml`.
- Cites ADR-010 §Decision binary exit constraint.
- Lists the iteration 1 + iteration 2 telemetry + summary paths as evidence.
- Carries the personal-scale qualifier in the rationale.

ADR-010's binary exit gate closes via downgrade. SP-003 is unblocked.

## 6. (Conditional) Escalate to full SP-000

If you judge the iteration signals ambiguous enough that fuller coverage (Llama family + Qwen 2.5 family per ADR-005 original spec) is justified, write a D-NNN entry that:
- Escalates to full SP-000 per ADR-005 alternative 1.
- Cites ADR-010 §Decision AND ADR-005 §Decision.
- Triggers authoring of a new `specs/00X-nfr-008-pilot-extended/` feature for the larger pilot.

ADR-010's binary exit gate closes via escalation commitment. SP-003 remains blocked until SP-000-extended completes.

## 7. Cleanup (optional, user-driven)

The harness MUST NOT delete iteration artifacts on its own (per FR-PILOT-014). After the D-NNN entry is committed and the binary exit is closed, you MAY manually remove the pilot telemetry files:

```bash
# Optional, after D-NNN commit
rm "$(node -e "console.log(require('./packages/contracts/dist/paths.js').Paths.pilotTelemetry())")"/pilot-iter*.{jsonl,json}
```

Recommended retention: keep the files for at least one release cycle so the D-NNN entry's `evidence_paths` references resolve. Once the D-NNN ledger entry has stabilized in the project record, the local telemetry files are no longer load-bearing.

## Troubleshooting

- **Harness exits with `Paths.pilotTelemetry is not a function`**: PREREQ-001 has not landed. Do NOT manually add the resolver key — that's a separate PR. Coordinate with `/speckit-tasks` output.
- **Harness exits with `event class 'nfr_008_pilot' not registered`**: PREREQ-002 has not landed. Same rule as above.
- **Harness exits citing FR-PILOT-012**: Q3 DRAFT definitions are unratified. Complete the PR walkthrough ratification first.
- **Stratification linter fails on `queries.yaml`**: fix the query set before the harness — bucket counts, retrieval-pattern coverage, or worked-example verbatim text is off.
- **Ollama returns 503 / 404 on `qwen3:8b`**: model not pulled, or Ollama daemon down, or disk full. Resolve the model availability problem; do NOT substitute another model.
- **Summary shows `soft_threshold_flag: true` on iteration 1**: read the `malformed_call_payload` fields in the JSONL stream. The flag is informational — but it's also a signal that the prompt template may need revision before iteration 2 (this is the v2-revised opportunity).
