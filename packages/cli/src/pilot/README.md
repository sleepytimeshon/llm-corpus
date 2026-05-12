# `corpus pilot` operator notes (SP-000-Lite)

CLI surface for the NFR-008 reduced-scope pilot harness.

## Status

**Phase 1 (workspace plumbing) — scaffolded.** The subcommand parses
`--variant` and `--iteration` flags and exits non-zero with a "pending
Phase 3" notice. Phase 3 (T025/T026 in
`specs/000-nfr-008-pilot-lite/tasks.md`, on PR #6's branch) wires this to
the real `runPilot()` driver and seeds the personal-scale qualifier in
`--help` output.

## Usage (Phase 3 target shape)

```
corpus pilot run --variant <id> --iteration <1|2>
```

- `--variant <id>` — prompt-variant identifier.
- `--iteration <1|2>` — pilot iteration number. Iteration ≥ 3 is rejected
  at argument validation per ADR-010 §Decision (FR-PILOT-004).

## Personal-scale qualifier (FR-PILOT-008, Constitution XVI)

Phase 3 (T026) will seed the following qualifier inline in `--help`
output, in this README, and in the per-iteration summary JSON:

> Shon's workflow on qwen3:8b against his personal-curated-32pdf-sampler
> substrate; NOT an industry-standard floor.

Phase 1 deliberately omits the qualifier so the T014 contract test stays
red until Phase 3 lands.
