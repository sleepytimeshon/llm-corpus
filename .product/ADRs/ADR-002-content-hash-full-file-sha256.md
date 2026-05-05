---
artifact: ADR
adr_id: ADR-002
project_slug: llm-corpus
stage: 4-plan
tier: deep
template_version: 3.0.0
generated: 2026-04-26T00:11:00Z
generated_by: ProductDevelopment Skill v3.0
status: accepted
supersedes: null
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-04-26T00:11:00Z
date_accepted: 2026-04-26T00:35:00Z
product_type: software

links:
  decisions_jsonl_id: D-009
  requirements_gated: [FR-017]
  roadmap_items_gated: [RM-004]
  related_adrs: [ADR-003]

reversibility: medium
tags: [idempotency, hashing, ingest]
---

# ADR-002: Full-File SHA-256 for Content-Hash Idempotency

## Status

accepted

## Context

FR-017 requires the pipeline to deduplicate documents using a content-hash idempotency key. The hash function and the byte range over which it is computed are the load-bearing decision.

**Forces / constraints:**
- C-020 / QATester F-10: a partial-file hash (e.g., first 4 KB only) would falsely deduplicate two 60 MB files identical in prefix but differing in tail
- Performance budget: ingest must remain within first-run NFR-014 90s envelope; classifier and embed are expected to dominate, not hashing
- Pipeline must be reproducible: same input bytes → same hash, regardless of platform

**Alternatives considered:**

1. **First-4 KB SHA-256** — Fastest. Falsely dedups any two files with identical first 4 KB (e.g., common headers, frontmatter templates). Ruled out by C-020 / QATester F-10 explicit attack scenario.
2. **xxHash64 streaming on full file** — ~5× faster than SHA-256; non-cryptographic; collision rate empirically low but not formally bounded. Adequate for dedup but adds a non-cryptographic dependency.
3. **SHA-256 streaming on full file** — Cryptographically robust; Node `crypto.createHash('sha256').update(stream)` is built-in (zero dependency); ~250 ms on 60 MB on M-series Mac per Stage 3 SP-004.
4. **BLAKE3 streaming** — Faster than SHA-256, parallelizable; requires native addon. Excluded by ADR-001 native-addon whitelist policy unless explicitly added.

**Origin of these alternatives:** C-020 mitigation (QATester F-10) + Stage 3 SP-004 perf data + Node crypto module documentation. Decision laundering check: D-009 rationale cites Stage 3 SP-004 + C-020 explicitly.

## Decision

We will use **streaming full-file SHA-256** as the content-hash idempotency key for FR-017. Implementation: `crypto.createHash('sha256').update(readStream).digest('hex')` with Node's built-in `fs.createReadStream`. Hash computed once per ingest; stored as `content_hash` column in the documents table (UNIQUE constraint).

## Consequences

**Positive:**
- Closes C-020 / QATester F-10 attack: identical-prefix-different-tail files produce different hashes
- Zero new dependency (crypto is built into Node)
- Cryptographic collision resistance: false-dedup rate is effectively zero for any realistic corpus
- ~250 ms on a 60 MB file is dominated by classifier+embed; not a UX concern (NFR-014 budget unaffected)

**Negative:**
- Cannot dedup-on-the-fly during file copy (must read full file before deciding); incoming files trigger one read pass for hashing then either reject-as-duplicate or proceed to normalization
- Re-hashing on file modification rewrites are unavoidable (any byte change → new hash); for very-large append-mostly files (rare in this corpus type), this is a minor inefficiency

**Neutral:**
- Future hash-algorithm migration (e.g., SHA-3 or BLAKE3 if performance becomes a bottleneck) would need a new ADR + migration path for already-indexed documents

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for FR-017 include the C-020 adversary case (two 60 MB files identical in first 1 MB but differing in tail must ingest as separate documents)
- **Telemetry**: `ingest.dedup_hit` / `ingest.dedup_miss` events emitted per NFR-016
- **Trigger to revisit**: classifier+embed perf substantially improves AND hashing becomes >10% of ingest wall-clock → consider BLAKE3 (would require ADR-001 native-addon allowlist update)
