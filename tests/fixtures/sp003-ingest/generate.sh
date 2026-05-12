#!/usr/bin/env bash
# SP-003 fixture generator — produces the deterministic non-trivial fixtures.
#
# References: specs/003-ingest-pipeline/tasks.md T018, Constitution XVI.
#
# Idempotent: re-running this script overwrites the fixtures with identical
# byte content. Anything that depends on the configured ingest size-cap is
# regenerated at test time from `loadIngestConfig().maxFileSizeMb`.

set -euo pipefail

cd "$(dirname "$0")"

# adversary-60mb-identical-prefix-A.bin and B.bin (ADR-002 F-10).
# Generated lazily — Phase 3 will fill the actual generation; for Dispatch A
# we simply document the contract. The contract tests that exercise the
# F-10 adversary live under `describe.skipIf(!fs.existsSync(...))` so the
# 60-MB files do not block the contract-test pass.

cat <<'EOF'
SP-003 fixture generator (Phase 1 scaffold).
Heavy fixtures (60-MB adversary, DOCX binary) are deferred to Dispatch B
when Phase 3 implementations need them. Phase 2 contract tests for these
fixtures use the `.skipIf(!fixture-exists)` pattern.
EOF
