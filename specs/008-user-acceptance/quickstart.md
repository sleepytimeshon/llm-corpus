# SP-008 Quickstart (operator walkthrough — Track B dogfood)

**Feature**: 008-user-acceptance
**Date**: 2026-05-17

This document walks the operator (Shon-as-Maya) through the 7-day Track B
dogfood window that ships the SP-008 user-acceptance gate per C-028. Track
A (code) merged with this PR; Track B (verdict) is what you do for the
next 7 days.

**The Track A/B split (per Constitution XVI honesty):**

- **Track A (code) — merged in this PR**: 4 new telemetry event classes,
  `corpus accept <request-id>` CLI, `corpus engagement-proxy report` CLI,
  3 UR integration tests, 2 adversary tests, 1 C-046 E2E smoke harness.
- **Track B (operator-action) — your next 7 days**: actually USE the
  installed substrate against real questions. Track A produced ZERO
  evidence about whether the substrate is useful; only your dogfood
  produces that evidence.

The PR-merge does NOT close SP-008. The Track B verdict captured in
`specs/008-user-acceptance/RETROSPECTIVE.md` does.

---

## Prereqs

You have a working SP-007 install on your dev machine:

```bash
which corpus
corpus --version            # ≥ 0.1.0 with SP-008 surfaces
ls ~/.local/share/llm-corpus/index.db
systemctl --user status corpus.service    # Linux; or launchctl on macOS
```

Ollama is running and the models referenced by `~/.config/llm-corpus/config.toml`
are pulled:

```bash
curl -s http://127.0.0.1:11434/api/tags | jq -r '.models[].name'
# expect at minimum: qwen3:8b, nomic-embed-text
```

Verify the SP-008 CLI surfaces are reachable:

```bash
corpus accept --help                # ADR-016 surface
corpus engagement-proxy report --help  # ADR-017 surface
```

If either prints "unknown command", rebuild dist + reinstall:

```bash
cd /path/to/llm-corpus && npm run build
# then re-link or re-shim the install per the SP-007 walkthrough
```

---

## Step 1 — Start the dogfood window

Pick a calendar start. Record it as an ISO-8601 instant — this is your
`--since` argument at the end:

```bash
DOGFOOD_START=$(date --iso-8601=seconds --utc)
echo "$DOGFOOD_START" > ~/.local/state/llm-corpus/sp008-dogfood-start.txt
```

For Maya / Shon, the dogfood window is calendar-aligned (e.g., a Monday
morning start). The C-028 threshold is "≥ 5 queries + ≥ 1 acceptance
event over 7 days" — there is no hard requirement that the 7 days are
contiguous wall-clock days; what matters is that the engagement-proxy
report's `--since`/`--until` window covers a real 7-day operator usage
stretch.

---

## Step 2 — Use the substrate naturally

Drop documents into the inbox the way you would normally use a Knowledge
Manager / Zettelkasten:

```bash
cp ~/notes/some-important-pdf.pdf ~/.local/share/llm-corpus/docs/inbox/
cp ~/notes/some-meeting-transcript.md ~/.local/share/llm-corpus/docs/inbox/
```

Wait for ingestion to complete (the daemon polls inbox every 2-30 s
depending on size). You can watch:

```bash
tail -f $(corpus paths telemetry 2>/dev/null || echo ~/.local/state/llm-corpus/telemetry.jsonl) \
  | jq 'select(.event | startswith("ingest.") or startswith("classify.") or startswith("embed.") or startswith("index.") or startswith("edges."))'
```

The doc is queryable when the last `edges.completed` event fires for that
content_hash.

---

## Step 3 — Ask questions in your usual agent (Claude Code)

Open a fresh Claude Code session. Ask questions whose answer is in your
corpus. The agent invokes `corpus.find` via the auto-registered MCP
server; you don't need to do anything special.

Every `corpus.find` invocation lands as a `engagement.corpus_find_invoked`
event in the telemetry log with a `request_id` field — that's the handle
you use to record an acceptance event.

To watch the request_ids stream by in a side terminal:

```bash
tail -f ~/.local/state/llm-corpus/telemetry.jsonl \
  | jq -c 'select(.event == "engagement.corpus_find_invoked") | {ts, request_id, query, result_count, tier_used}'
```

---

## Step 4 — Record acceptance events when results were useful

When the agent's `corpus.find` returns a SearchHit that you actually used
to ground your answer (not a placebo, not "looks relevant", but
substantively load-bearing for the agent's response), capture the
`request_id` from the telemetry stream and run:

```bash
corpus accept <request-id> --note "<one-line rationale>"
```

Examples:

```bash
corpus accept 7f3a8c12-b1e0-4f5a-9c2d-3e8b1a4d5f6e \
  --note "Found the BofA SSSD AD timeline doc; grounded the Tuesday plan."

corpus accept 9d2e1f3b-c4a5-4d6e-8f7a-1b2c3d4e5f60 \
  --note "Confirmed v34i01 contributor list from the Boresight tracker."
```

The `--note` field is optional but recommended; it's what makes the
RETROSPECTIVE.md Track B verdict block readable later.

**Per Decision D**: there is no `--last` flag in v1 — always pass the
explicit `<request-id>` from the telemetry log. This is intentional
friction so you only accept when the result was truly load-bearing.

---

## Step 5 — Adversary check at any point during the window

The two adversary properties verified at sprint close are:

1. **Empty-corpus adversary**: `corpus.find` against zero documents
   returns `hits: []` with no fabricated citations. (Verified
   programmatically by `packages/cli/test/empty-corpus-adversary.test.ts`.)
2. **Session-start idempotency adversary**: re-starting the daemon with
   identical inbox contents does NOT re-ingest. (Verified programmatically
   by `packages/cli/test/session-start-idempotency-adversary.test.ts`.)

If during the dogfood window you observe either invariant violated
(impossible-to-find data, duplicate document rows after a restart),
record it as a Track B counter-finding in RETROSPECTIVE.md and surface
to the PM as a C-NNN concern entry.

---

## Step 6 — End-of-window report

At day 7 (or whenever you've crossed ≥ 5 queries + ≥ 1 accept and want to
close the verdict), run:

```bash
DOGFOOD_START=$(cat ~/.local/state/llm-corpus/sp008-dogfood-start.txt)
corpus engagement-proxy report \
  --since="$DOGFOOD_START" \
  --until=now \
  --format=text
```

Read the verdict line. Three possible outcomes:

### Outcome A — PASS

```
Maya Week-1 Engagement-Proxy Report (per C-028)
Track B measurement — operator-dogfood verdict
...
Verdict: PASS
Queries in window:           ≥ 5
Acceptance events in window: ≥ 1
C-028 threshold met:         true
KILL signal:                 false
...
PASS — C-028 gate cleared.
```

Action: paste this output AND the JSON form (`--format=json`) into
`specs/008-user-acceptance/RETROSPECTIVE.md`'s Track B Verdict block.
Open a PR titled "SP-008 Track B verdict: PASS — v1.0.0 substrate
release-ready". Tag `v1.0.0` after merge.

### Outcome B — FAIL (non-KILL)

```
Verdict: FAIL
Queries in window:           between 3 and 4 OR (≥ 5 AND acceptances == 0)
C-028 threshold met:         false
KILL signal:                 false
...
FAIL (non-KILL) — engagement floor cleared but C-028 gate not met.
Recommendation: continue dogfood + retry report.
```

Action: this is a "soft fail" — the engagement floor is clear but you
either haven't run enough queries OR haven't pressed `corpus accept` on
anything yet. Extend the dogfood window 3-7 more days and re-run the
report. Record the soft-fail in RETROSPECTIVE.md but do NOT roll back.

### Outcome C — FAIL (KILL)

```
Verdict: FAIL
Queries in window:           < 3
KILL signal:                 true
...
KILL signal detected — engagement floor below 3 queries.
Recommendation: Stage 4 recycle per C-028.
```

Action: this is the C-028 v1 KILL signal. The substrate did not gain
real usage in the dogfood window — the operator's organic invocation
rate is below 3 `corpus.find` events in 7 days. Per C-028 mitigation
(SPRINT-PLAN.yaml line 253) the rollback is a Stage 4 recycle. Capture
the JSON report in RETROSPECTIVE.md, open a Stage 4 retro PR, and
recycle. v1.0.0 does NOT ship until a re-instrumented re-dogfood produces
PASS.

---

## Honest performance notes (Constitution XVI)

The `corpus engagement-proxy report` CLI is fast (telemetry-scan over
NDJSON in `Paths.telemetry()` plus any rotated logs; typical wall-clock
< 200 ms for a 7-day window with ~ 100 events). The C-046 E2E smoke
harness (`packages/cli/test/engagement-proxy-e2e.test.ts`) runs in
< 1 s against the production binary and a synthetic 5q+1a fixture.

The 7-day dogfood window's verdict is NOT a code measurement — it's the
operator's real engagement. The PR-merge ships Track A; Track B is what
you actually do. Per Constitution XVI: SP-008 sprint close is honestly
"Track A complete; Track B verdict pending".

---

## R3 operator-friction acknowledgement (risk register)

The `corpus accept <request-id>` workflow has real operator friction: you
must read the telemetry stream, copy a request_id, and run a separate CLI
command for every load-bearing result. This is intentional v1 design per
Decision D — the friction is the load-bearing signal. If you find
yourself pressing `accept` reflexively on every result (placebo
acceptance), the metric is corrupted; if you find yourself NEVER pressing
accept despite the agent helping you, the metric is also corrupted. A
later sprint may add a `--last` flag or a "rate this result" prompt at
the end of every Claude Code session, but for v1 user-acceptance the
manual flow is the contract.

---

## Track B Verdict block reference

When the window closes, paste BOTH the text and JSON outputs into the
"Track B Verdict" block of
`specs/008-user-acceptance/RETROSPECTIVE.md`:

```bash
DOGFOOD_START=$(cat ~/.local/state/llm-corpus/sp008-dogfood-start.txt)
echo "=== TEXT FORMAT ==="
corpus engagement-proxy report --since="$DOGFOOD_START" --format=text
echo ""
echo "=== JSON FORMAT ==="
corpus engagement-proxy report --since="$DOGFOOD_START" --format=json
```

Both stdouts go into the Track B Verdict block. That's the SC-008-035
evidence; that's the SP-008 sprint close.
