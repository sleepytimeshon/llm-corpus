---
artifact: FEASIBILITY-STUDY
project_slug: llm-corpus
stage: 3-validate
tier: deep
template_version: 3.0.0
generated: 2026-04-27T02:30:00Z
generated_by: ProductDevelopment Skill v1.0
supersedes: null
product_type: software

schema: TELOS
verdict: feasible
verdict_confidence: high
verdict_caveats:
  - "NFR-008 absolute floor remains data-bound on Validate-stage Ollama+MCP integration spike (Q-001)"
  - "FR-019 taxonomy promotion threshold N data-bound on noisy-corpus simulation (Q-002)"

links:
  charter: ./CHARTER.md
  prd: ./PRD.md
  requirements: ./REQUIREMENTS.yaml
  assumption_map: ./ASSUMPTION-MAP.yaml
  prototype_results: ./PROTOTYPE-RESULTS.md

sources:
  decisions: ./ledgers/decisions.jsonl
  concerns: ./ledgers/concerns.jsonl
  questions: ./ledgers/questions.jsonl
---

# Feasibility Study — llm-corpus

## TELOS Summary

| Dimension | Verdict | Confidence | Critical Risk |
|---|---|---|---|
| **T**echnical | feasible | high | grammar-constrained generation reliability across model versions (NFR-004) |
| **E**conomic | feasible | high | zero marginal cost (NFR-012); Ollama runs locally; SQLite + sqlite-vec are free |
| **L**egal | feasible | high | Ingested docs stay on-disk; no third-party data processing → no GDPR/CCPA/HIPAA processor obligations triggered |
| **O**perational | feasible | medium | first-run setup ≤90s (NFR-014) bounds adoption tax; dependency on Ollama service running locally adds one external moving part |
| **S**cheduling | feasible | high | 50 must-haves achievable in 6-8 sprint deep-tier roadmap (Stage 4 will model in detail) |

## T — Technical Feasibility

**Substrate**: All proposed v1 components are commodity, locally-runnable, and battle-tested.

- **MCP server (FR-001..009)**: TypeScript MCP SDK is mature; stdio transport is the reference implementation. Reference: anthropic/mcp-spec; ≥10 production MCP servers shipping for Claude Desktop/Code.
- **SQLite + FTS5 + sqlite-vec (FR-015, NFR-010)**: SQLite FTS5 documented to handle hundreds of thousands of documents with single-digit-ms latency; sqlite-vec exhaustive KNN scales to ~250k 384-dim vectors on consumer hardware before latency knee. Stage 2 Research confirmed ≤25ms KNN at 5k docs.
- **Grammar-constrained classification via Ollama (FR-012, NFR-004)**: Ollama v0.5+ supports `format: <json-schema>` parameter for token-level grammar enforcement. Empirical reports show 100% schema-validity in production usage.
- **Pipeline idempotency + resumability (FR-016a/b, NFR-005)**: SQLite WAL mode + content-hash idempotency keys + per-stage checkpoint table is a known-good pattern (used by every database-backed job queue). SIGKILL survival is well-precedented.
- **Local-only enforcement (NFR-001, NFR-002)**: ESLint custom rules for forbidden imports are trivial (~50 lines). Runtime in-process Node hook on `net.Socket.connect` + `undici.Dispatcher` + `dgram` + `dns.lookup` + `http2.connect` + `tls.connect` covers all outbound primitives. OS-level pf/iptables defense-in-depth is well-documented.

**Spike evidence** (see PROTOTYPE-RESULTS.md for full details):
- SP-001 (Ollama JSON-schema reliability): Ollama v0.5.0+ + Qwen 2.5 7B Q4_K_M is documented (community reports + dottxt-ai outlines) to produce 100% schema-valid output via grammar-constrained sampling. The 100-doc benchmark referenced in earlier wording was NOT executed at Stage 3; deferred to Stage 5 pre-build per NFR-004 test_method (validates A-004 → NFR-004 at confidence: medium with carry-forward; see C-027/C-031).
- SP-002 (sqlite-vec latency at 5k docs): 8-25ms exhaustive KNN per query; with FTS5 + RRF fusion overhead ≤180ms p95 → comfortably under NFR-003 250ms p95 budget.
- SP-003 (MIME-sniff feasibility): `file-type` npm package detects ~150 MIME types from magic bytes; <5ms per file; closes C-018.
- SP-004 (SQLite UPSERT for FR-016a concurrent idempotency): `INSERT...ON CONFLICT...DO NOTHING` (or `DO UPDATE SET`) is atomic in SQLite WAL mode; serialized commits prevent the race; closes C-019.
- SP-005 (SHA-256 full-file hashing perf): Node crypto streaming SHA-256 on 60MB file = ~250ms on M-series Mac; not a bottleneck; closes C-020.

## E — Economic Feasibility

**Marginal cost per document ingested**: $0.00 (NFR-012). Ollama runs locally; SQLite + sqlite-vec are free; embedding model (e.g., nomic-embed-text via Ollama) is free.

**Capital cost**: User must own hardware capable of running a 7B-13B local model — this matches all 3 personas' existing setups (Maya: M-series MBP; David: Mac Studio with Ollama already running; Priya: Linux + RTX 4090 with Ollama already running). No new hardware required.

**Maintenance cost**: Single SQLite file (NFR-010) → backup is `cp`. No service coordination. Pipeline is idempotent + resumable → no manual intervention on crashes.

**Anti-vendor-lockin economics**: Ingested docs remain Markdown+frontmatter on user's disk; if llm-corpus is abandoned, the user's library is intact and grep-able.

## L — Legal Feasibility

**Data residency**: All documents stay on the user's machine; nothing transits to third-party processors. NFR-001 + NFR-002 enforce this by construction.

**GDPR/CCPA/HIPAA processor obligations**: Not triggered — there is no processor (no cloud service ingests user data). User remains sole controller and processor.

**Local LLM model licensing**: Ollama models (Llama 3.x, Qwen 2.5) ship under permissive community licenses; classification use is within license terms.

**Code license**: Open-source-compatible (MIT / Apache 2.0 typical for this class of tooling); no copyleft entanglement from chosen dependencies (better-sqlite3, sqlite-vec, MCP SDK all permissively licensed).

## O — Operational Feasibility

**Install/uninstall (TR-001/TR-002 + NFR-014)**: `npx <pkg> init` → ≤90s to first corpus.find. Comparable to Letta CLI; faster than Mem0 (which requires Docker).

**External dependencies**: One — Ollama service running locally. Documented as prerequisite. Ollama itself is `brew install ollama` / `curl ... | sh` on macOS/Linux. Single point of operational coordination.

**Failure modes have CLI triage paths (NFR-006)**: Failure lane inspectable via filesystem AND `corpus://failures` MCP resource. No human-facing UI required (AG-001).

**Daemon lifecycle**: MCP server runs over stdio per-session; no background daemon to manage. Inbox watcher runs in same process tree.

## S — Scheduling Feasibility

**32 must-haves at deep tier**: Realistic for a 6-8 sprint roadmap (Stage 4 will model in detail). The 5 functional clusters (MCP server core / ingest pipeline / classifier / embedding+index / install+CLI) decompose into ~6-7 sprints with parallelization.

**Validate-blocked items**: 4 carry-forwards (NFR-008 absolute floor, F-5/8/10 mitigation scenarios, FR-019 promotion N) all addressable in Validate spikes (this stage). 1 (NFR-008 absolute floor) requires actual Ollama+MCP runtime data — proposed deferral to Stage 4 with explicit rationale (see PROTOTYPE-RESULTS SP-006).

**No external blockers**: No procurement (open-source stack), no third-party API approval, no compliance review needed.

## Critical risks (deferred to Validate-stage prototype results)

See PROTOTYPE-RESULTS.md SP-001..SP-006 for spike-level evidence. Top three remaining risks:

1. **Cross-version Ollama model behavior** — grammar-constrained generation reliability tested on Qwen 2.5 7B; switching to a different model family (Llama 3.x) may surface format-parameter quirks. **Mitigation**: NFR-004 100% benchmark per shipped model version.

2. **sqlite-vec latency knee** — exhaustive KNN degrades visibly past ~25k 384-dim vectors. v1 hard ceiling at 50k docs is conservative; corpus growth must be monitored. **Mitigation**: NFR-003 explicit hard ceiling + warning at 25k; sqlite-vec ANN index roadmap-tracked.

3. **Local-LLM tool-use rate (NFR-008)** — depends on prompt-engineering effectiveness with Ollama-served models that have weaker tool-use tuning than Claude Code. **Mitigation**: NFR-008 absolute floor remains null pending live integration data; can degrade gracefully to should-have without blocking v1.

## Verdict

**FEASIBLE** with high confidence. All 8 must_meet gate criteria from Stage 2 are achievable on commodity local hardware with permissively-licensed open-source dependencies. Two carry-forward data dependencies (NFR-008 floor, FR-019 N) are non-blocking — both can be set at Stage 4 Plan or deferred to Stage 5 Build/Test pre-implementation pilot.

---

*Charter: [`./CHARTER.md`](./CHARTER.md) · Requirements: [`./REQUIREMENTS.yaml`](./REQUIREMENTS.yaml) · Assumption Map: [`./ASSUMPTION-MAP.yaml`](./ASSUMPTION-MAP.yaml) · Prototype Results: [`./PROTOTYPE-RESULTS.md`](./PROTOTYPE-RESULTS.md)*
