# Requirements Traceability Matrix — llm-corpus

Generated: 2026-04-27T02:22:16.210Z

| Requirement | Title | Priority | Source Opportunity | AC Scenarios |
|---|---|---|---|---|
| FR-001 | MCP server exposes corpus.find tool over stdio transport | must | — | 4 |
| FR-002 | corpus.find accepts a structured query and returns ranked Se | must | — | 6 |
| FR-003 | corpus.find ranks results via hybrid retrieval (BM25 + dense | must | — | 6 |
| FR-004 | corpus.find returns deterministic structured error envelope  | must | — | 5 |
| FR-005 | MCP server exposes corpus manifest as auto-loaded resource | must | — | 4 |
| FR-006 | MCP server exposes taxonomy resource listing established dom | must | — | 7 |
| FR-007 | MCP server exposes recent-ingests resource | must | — | 4 |
| FR-008 | MCP server exposes per-document resource at stable URI | must | — | 4 |
| FR-009 | MCP server registers reusable retrieval prompt templates | must | — | 3 |
| FR-010 | Filesystem inbox watcher enqueues new documents for ingest | must | — | 3 |
| FR-011 | Ingest pipeline normalizes documents to Markdown with YAML f | must | — | 3 |
| FR-012 | Local-LLM classifier emits schema-valid metadata via grammar | must | — | 4 |
| FR-013 | Classifier output is schema-validated before frontmatter wri | must | — | 2 |
| FR-014 | Classifier validates domains and tags against the live corpu | must | — | 4 |
| FR-015 | Classified document is embedded and indexed for hybrid retri | must | — | 4 |
| FR-017 | Pipeline uses content-hash idempotency keys to prevent dupli | must | — | 2 |
| FR-018 | Failed ingests route to a failure lane with structured diagn | must | — | 2 |
| NFR-001 | Local-only enforcement via static lint of forbidden network  | must | — | 2 |
| NFR-002 | Runtime egress audit confirms zero outbound non-loopback pac | must | — | 4 |
| NFR-003 | corpus.find p95 latency ≤ 250ms at 5k docs (Research-baselin | must | — | 3 |
| NFR-004 | Classifier produces schema-valid output on 100% of inputs in | must | — | 3 |
| NFR-005 | Pipeline survives kill -9 at any stage without index corrupt | must | — | 2 |
| NFR-006 | Failure lane diagnostics are sufficient for triage without a | must | — | 5 |
| NFR-014 | First-run setup ≤ 90 seconds from npx invocation to first su | must | — | 2 |
| NFR-015 | SQLite WAL recovery on reopen ≤ 2 seconds for WAL files <100 | must | — | 2 |
| FR-019 | Dynamic-taxonomy promotion mechanism elevates proposed terms | should | — | 1 |
| FR-020 | Inbox accepts URLs as a document source in addition to local | should | — | 1 |
| FR-021 | Server exposes a corpus.health diagnostic resource | should | — | 1 |
| FR-022 | MCP server is invocable from MCP-aware agents other than Cla | should | — | 2 |
| FR-023 | MCP server is invocable from Ollama-served local LLMs (qwen3 | should | — | 2 |
| NFR-007 | Cross-agent retrieval-quality parity (top-3 Jaccard ≥ 0.7 on | should | — | 2 |
| NFR-008 | Local-LLM tool-use rate (≥N corpus.find calls per 100 llama  | should | — | 2 |
| NFR-009 | Classifier wall-clock per document on target hardware (Resea | should | — | 1 |
| NFR-010 | Index is a single SQLite file | should | — | 1 |
| NFR-011 | Pipeline observability via structured event log | should | — | 1 |
| NFR-016 | Telemetry surface ≥ 6 named event classes (Research-baseline | should | — | 1 |
| FR-026 | User can mark a corpus.find result as accepted or rejected t | nice | — | 0 |
| FR-024 | Inbox supports email/inbox-watcher source in addition to fil | nice | — | 0 |
| FR-025 | Knowledge-graph edges between documents are visible via a co | nice | — | 0 |
| NFR-012 | Classifier marginal cost per document is zero on user hardwa | nice | — | 0 |
| NFR-013 | Auto-proposed taxonomy growth feels like enrichment, not noi | nice | — | 0 |

Source: /home/shonrs/Projects/llm-corpus/.product/REQUIREMENTS.yaml
AC source: /home/shonrs/Projects/llm-corpus/.product/ACCEPTANCE-CRITERIA.feature
