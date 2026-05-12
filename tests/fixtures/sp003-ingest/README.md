# SP-003 Ingest Fixtures

Test-fixture inputs for the SP-003 ingest-pipeline tests. See
`specs/003-ingest-pipeline/tasks.md` T018, plan.md Decision B, data-model.md.

## Files

| Fixture | Purpose | Generation |
|---|---|---|
| `valid-small.pdf` | 5-page PDF for happy-path PDF normalization | See `generate.sh` (Phase 3 will fill in concrete commands) |
| `valid-md.md` | 50-KB Markdown note for happy-path MD passthrough | Deterministic generation via script |
| `valid-txt.txt` | 5-KB plain-text file for happy-path text wrapping | Deterministic generation via script |
| `valid-html.html` | Single-page HTML article for happy-path turndown | Deterministic generation via script |
| `adversary-60mb-identical-prefix-A.bin` | First half of ADR-002 F-10 adversary pair | Identical first 60_000_000 bytes + 1 different terminal byte |
| `adversary-60mb-identical-prefix-B.bin` | Second half of ADR-002 F-10 adversary pair | Same prefix as A, last byte differs |
| `disallowed-docx.docx` | DOCX file for `mime_not_allowlisted` | Tiny placeholder DOCX |
| `mismatch-md-with-pdf-bytes.md` | `.md` extension wrapping PDF magic bytes (`%PDF`) for `mime_mismatch` | Deterministic generation via script |
| `oversize-by-one-byte.txt` | One byte over the size cap (default 100 MB) | Generated against the configured cap at test time |

## Generation discipline (Constitution XVI)

Fixtures are deterministic — they MUST be reproducible by re-running
`generate.sh` against a clean checkout. Provenance for each file is recorded
in its parent fixture-spec section so a reviewer can audit "where did this
PDF come from?" without having to re-render the source asset.

## Out of scope (Dispatch A)

The actual binary fixture content is generated in Phase 3 (Dispatch B) once
the real normalizers are wired up — Dispatch A only needs the directory and
this README to satisfy the contract-test scaffolding gate.

The contract tests in Phase 2 either:
- Reference fixtures via the documented filenames (and `describe.skip` if
  not yet present on disk), OR
- Generate fixture content inline within the test via `withTempDir` + the
  fixture's specified shape.

## Schema reference

See `specs/003-ingest-pipeline/data-model.md` §"Validation Gate Config" for
the size cap that determines `oversize-by-one-byte.txt`'s byte count.
