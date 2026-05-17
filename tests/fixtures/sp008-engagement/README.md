# SP-008 engagement-proxy fixtures

This directory carries the synthetic fixtures consumed by the SP-008
engagement-proxy unit + integration tests. All fixture files were authored
by Engineer #1 during Phase 2 (T012). The fixtures are intentionally small
+ deterministic so the report aggregator + verdict computer produce known
outputs.

## File inventory

| File | Purpose | Expected verdict |
|------|---------|------------------|
| `telemetry-fixture-pass.jsonl` | 5 `engagement.corpus_find_invoked` + 1 matching `engagement.acceptance_event` (request_id `e53d5aab-…`). | `PASS` — queries_in_window=5, acceptance_events_in_window=1, kill_signal=false, c028_threshold_met=true. |
| `telemetry-fixture-fail-low-queries.jsonl` | 2 `engagement.corpus_find_invoked` + 0 acceptances. | `FAIL` (KILL) — queries_in_window=2, kill_signal=true (< 3 floor). |
| `telemetry-fixture-fail-no-accept.jsonl` | 5 `engagement.corpus_find_invoked` + 0 acceptances. | `FAIL` (non-KILL) — queries_in_window=5, acceptance_events_in_window=0, kill_signal=false. |
| `telemetry-fixture-fail-mid-queries.jsonl` | 3 `engagement.corpus_find_invoked` + 0 acceptances. | `FAIL` (non-KILL) — queries_in_window=3 (≥ 3 floor cleared), kill_signal=false, c028_threshold_met=false. |
| `telemetry-fixture-corrupt.jsonl` | 3 well-formed lines + 2 malformed lines (broken JSON + invalid UUID `request_id`). | parse_errors_count >= 2; valid records still counted. |
| `telemetry-fixture-rotated/telemetry.jsonl` + `telemetry.jsonl.1` | Active log + 1 rotated log (mtime in window). | Scanner must enumerate both files per SP-003 rotation file-naming convention; events from BOTH count toward the metric. |
| `ur-001-fixture-docs/` | 3 fixture documents (PDF, Markdown, plain-text) used by the UR-001 integration test to verify "dropped document becomes queryable on next matching query". | n/a — exercised by `packages/cli/test/ur-001-acceptance.test.ts`. |

## UUIDv4 + SHA-256 provenance

The fixture `request_id` values are real `randomUUID()` outputs generated
once + committed to disk. The fixture `query_hash` values are real
`createHash('sha256').update('fixture-query-<N>').digest('hex')` outputs.
Tests may regenerate these by running the generator snippet at the top of
this file, but the committed values are the canonical expectations.

## Reference

- `specs/008-user-acceptance/plan.md` Project Structure section
- `specs/008-user-acceptance/data-model.md` Entities 1-7
- `specs/008-user-acceptance/spec.md` FR-ENGAGEMENT-003, FR-ENGAGEMENT-005,
  FR-ENGAGEMENT-016
- SP-003 telemetry rotation convention (the scanner reads both active +
  rotated logs whose mtime falls in the window)
