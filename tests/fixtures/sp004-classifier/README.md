# SP-004 Classifier Test Fixtures

Fixture inputs for SP-004 integration tests (`tests/integration/*sp004*`,
`tests/integration/end-to-end-classify.test.ts`,
`tests/integration/proposed-term-routing.test.ts`,
`tests/integration/vocabulary-violation-failure-lane.test.ts`).

## Files

- `seeded-taxonomy-minimal.sql` — 2 established domains + 5 established tags +
  type axis entries; loaded via `sqlite3 <db> < <file>` (or by the fixture
  loader's `runSql` helper) before classify integration tests.
- `novel-domain-doc.md` — a Markdown document whose subject does NOT match
  the seeded vocabulary. The classifier will (a) pick a closest-fitting
  established domain AND (b) propose the novel domain via
  `facet_domain_proposed`.
- `mock-ollama-response-valid.json` — schema-valid happy-path Ollama
  response body (`{"message": {"content": "<json>"}, ...}`) for the
  classifier-stage GREEN path tests.
- `mock-ollama-response-schema-invalid.json` — Ollama response whose
  embedded JSON content is missing the required `facet_domain` field.
  Triggers `SchemaInvalidError` in the defense-in-depth validator.
- `mock-ollama-response-vocab-violation.json` — Ollama response whose
  `facet_domain` is a value NOT in the established vocabulary AND NOT in
  `facet_domain_proposed`. Triggers `VocabularyViolationError`.

## Provenance

All fixtures are hand-crafted. None contain confidential data. The mock
Ollama responses mirror the Ollama 0.5+ `/api/chat` non-streaming response
shape (`{message: {content: "<json>", role: "assistant"}, ...}`).

The `seeded-taxonomy-minimal.sql` set is designed to be small enough that
the classifier prompt fits comfortably under qwen3.5:9b's context window
and large enough to exercise the proposed-term routing path on the
`novel-domain-doc.md` input.

The mock-response fixtures intentionally use the `agent-systems` /
`distributed-systems` / `quantum-cryptography` triad to make the
proposed-term routing observable end-to-end without needing live Ollama
inference.
