# SP-007 install / uninstall test fixtures

Authored during SP-007 Phase 2 (T020) as the canonical reference inputs for
the SP-007 unit + integration test suite. Every fixture is committed to
the repo so tests are deterministic + reproducible across machines.

## Files

| Filename | Purpose | Consumed by |
| --- | --- | --- |
| `taxonomy-seed-fixture.json` | Known-good 25-term seed (≥5 domain + ≥6 type + ≥9 tag + ≥5 source_type) used by unit tests as a smaller alternative to the production seed at `packages/cli/src/install-resources/taxonomy-seed.json` | T002, T025, T038 |
| `claude-json-with-prior-entries.json` | Operator's `~/.claude.json` with 2 prior MCP-server entries that must be preserved by the install (mutates ONLY `mcpServers.corpus`) | T026, T039, T056 |
| `claude-json-malformed.json` | Invalid JSON; install exits non-zero with `InstallMCPClientConfigError` BEFORE any other side-effect | T026, T039 |
| `partial-install-debris/` | XDG-shape directory tree without an install-receipt; FR-INSTALL-004 partial-install detection | T021, T034 |
| `installed-receipt-valid.json` | Fully-populated post-install receipt; uninstall-driver round-trip tests | T027, T041, T051, T061 |
| `installed-receipt-malformed.json` | Receipt with `schema_version: 2`; Zod-rejection test | T027, T041, T052 |

## Provenance

- `taxonomy-seed-fixture.json` mirrors a 25-entry subset of
  `packages/cli/src/install-resources/taxonomy-seed.json` (the production
  seed). Tests that exercise the seed-loader's Zod-validation path use this
  fixture so the fixture path lives next to the test surface.
- `claude-json-with-prior-entries.json` is hand-crafted. The two prior
  entries are intentional placeholders (`example-prior-server-a/b`) — they
  exist solely to assert SP-007 install preservation behavior.
- `claude-json-malformed.json` is deliberately invalid JSON (trailing
  unmatched brace + missing-quote on `args`). Do not "fix" it.
- `partial-install-debris/data|state|config|cache/llm-corpus/` are
  placeholder XDG-shape directories. Tests synthesize the relevant content
  via `fs.mkdirSync` in their setup hooks.
- `installed-receipt-valid.json` is a realistic Linux install: UID 1000,
  one iptables firewall rule with verbatim provision/reverse args, two
  seeded taxonomy terms, no auto-start unit.
- `installed-receipt-malformed.json` flips `schema_version` to 2 — the
  Zod-rejection path uses this to confirm `UninstallReceiptMissingError`
  fires BEFORE any destructive operation.
