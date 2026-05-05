---
artifact: ADR
adr_id: ADR-007
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
  decisions_jsonl_id: D-011
  requirements_gated: [FR-010, FR-011]
  roadmap_items_gated: [RM-004]
  related_adrs: []
  answers_questions: [Q-004]

reversibility: medium
tags: [mime, ingest, validation]
---

# ADR-007: FR-010 v1 MIME Allowlist (PDF, Markdown, Plain Text, HTML)

## Status

accepted

## Context

FR-010 validates incoming documents at the inbox boundary. The MIME-type allowlist is the load-bearing v1 scope decision: too narrow, and Maya hits "this document type isn't supported"; too wide, and the classifier (FR-012) faces input variety it cannot reliably handle in v1.

**Forces / constraints:**
- Whitepaper §1.2 implies PDF, Markdown, plain text, HTML
- D-011 (Stage 3 SP-003) closed the MIME-sniff feasibility (file-type npm package); this ADR scopes the v1 allowlist
- C-018 / QATester F-5 requires MIME sniff after extension check (closed by D-011, implementation-level)
- MEDIA-INGESTION-SPEC at `~/Projects/llm-corpus/MEDIA-INGESTION-SPEC.md` may extend the allowlist; consultation deferred until Stage 5 build (per Stage 3 handoff)
- Classifier (FR-012) trained on text-based content; binary content needs extraction first

**Alternatives considered:**

1. **Maximal allowlist (everything file-type can detect, ~150 MIME types)** — Most flexible; classifier failure rate climbs; many types (zip, image, video) require extractors not in v1.
2. **Conservative allowlist for v1: PDF + Markdown + plain text + HTML** — Covers whitepaper-cited types; classifier known to handle this content variety; can extend later via ADR-007 amendment without breaking existing corpus.
3. **Markdown + plain text only** — Minimum viable; excludes PDF (a primary persona use case for Maya/David); too restrictive.
4. **Defer to MEDIA-INGESTION-SPEC consultation** — Punts the decision into Stage 5; FR-010 cannot ship without an allowlist.

**Origin of these alternatives:** Q-004 (Stage 2 Architect-raised); whitepaper §1.2 implication; SP-003 file-type capability bounds; MEDIA-INGESTION-SPEC reference (consulted for v1: confirms the four types as primary).

## Decision

We will commit the **v1 MIME allowlist as exactly four types**:

| MIME family | Detected by file-type | Notes |
|---|---|---|
| `application/pdf` | yes (magic bytes `%PDF`) | normalized via `pdf-parse` or equivalent (extractor selected at SP-003 implementation) |
| `text/markdown` | inferred from `.md` ext + UTF-8 text body | passes through normalization unchanged |
| `text/plain` | UTF-8 text without specific magic bytes | wrapped in minimal Markdown structure during normalization |
| `text/html` | yes (magic bytes `<!DOCTYPE html>` / `<html`) | normalized via `turndown` or equivalent (extractor selected at SP-003 implementation) |

All other detected MIME types route to the failure lane with `error_code: mime_not_allowlisted`. The allowlist is configurable post-v1 via `corpus config inbox.mime_allowlist += <type>`, but expansion requires the corresponding normalizer/extractor to exist.

MIME-sniff happens AFTER extension check (per D-011): if extension passes (e.g., `.md`) but file-type detects `application/pdf` (binary content), the file routes to failure with `error_code: mime_mismatch` (closes C-018 / F-5).

## Consequences

**Positive:**
- Closes Q-004; FR-010 has a concrete shipable scope
- Closes C-018 / F-5 attack vector (binary file with allowed extension rejected)
- Four types cover the primary persona use cases (Maya: research PDFs; David: legal/contract HTML+PDF; Priya: text/Markdown notes)
- Failure lane handling is uniform across rejected types; user-recoverable

**Negative:**
- Excludes Word documents (.docx), spreadsheets, code files, RTF, etc. — these become user-friction events ("why didn't my .docx file ingest?")
- Per-extension extractor (PDF, HTML) adds dependency surface to the ingest pipeline
- Future allowlist expansion is a per-type ADR (proper, but introduces small overhead)

**Neutral:**
- Failure-lane CLI triage path (NFR-006) makes rejection acknowledgeable; user can convert manually
- MEDIA-INGESTION-SPEC may grow the allowlist in v2; this ADR is the v1 commitment

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for FR-010 cover happy-path for each of 4 allowed types + rejection for at least 5 disallowed types + C-018 mismatch case
- **Telemetry**: `inbox.allowlist_hit` / `inbox.allowlist_miss` events per NFR-016
- **Trigger to revisit**: ≥10 distinct user-reported "why didn't X ingest" events for the same MIME family → open ADR-007 amendment to add type
