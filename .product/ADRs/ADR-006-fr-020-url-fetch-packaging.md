---
artifact: ADR
adr_id: ADR-006
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
  decisions_jsonl_id: null            # answers Q-003 directly; no prior D-NNN
  requirements_gated: [FR-020, NFR-001]
  roadmap_items_gated: [RM-012]
  related_adrs: [ADR-001]
  answers_questions: [Q-003]

reversibility: medium
tags: [packaging, lint, url-fetch, scope-exemption]
---

# ADR-006: FR-020 URL-Fetch Adapter as Separately-Linted Sub-Package

## Status

accepted

## Context

FR-020 (priority: should) lets users submit URLs as ingest sources. URL fetching requires outbound HTTP — directly contradicting NFR-001 (lint forbids network imports) at the source. Q-003 raised this: should the URL-fetch adapter live in a separately-linted sub-package, or should NFR-001 support per-file allowlist annotations?

**Forces / constraints:**
- FR-020 is should-priority and lives in `next` (RM-012); not a v1 must
- NFR-001 is must-priority and applies to all v1 build paths
- ADR-001 commits the runtime egress hook on all six primitives; URL-fetch needs an explicit runtime exception
- Maintainability: per-file allowlist annotations create a long tail of "is this `// ts-allow-egress` annotation legit?" review burden
- Audit: a separate package with its own lint config is more grep-able than annotated overrides

**Alternatives considered:**

1. **Per-file `// allow-network` lint annotations** — Lowest packaging overhead. Creates an audit-tail problem: every annotation needs a review case; future contributors may add unjustified ones.
2. **Separate sub-package `@llm-corpus/url-adapter` with its own `eslintrc` exempting network imports** — Clean boundary; lint config lives at one path; the runtime egress hook still applies but allow-listed for `documents.fetched_url` events; one package boundary to audit.
3. **Disable NFR-001 lint for FR-020 entirely** — Trivially defeats NFR-001's purpose for the URL path; not acceptable.
4. **Defer FR-020 to post-v1 entirely** — Avoids the question; legitimate but FR-020 is in `next` not `later`, suggesting Shon wants this as a near-term should.

**Origin of these alternatives:** Q-003 (Stage 2 Architect-raised); Stage 4 Plan ADR per workflow Step 4 + Q-003 routing. No prior decisions.jsonl entry — this ADR is the originating decision.

## Decision

We will package the FR-020 URL-fetch adapter as a **separately-linted sub-package** at `packages/url-adapter/` with its own eslint configuration that exempts network imports for that package only. Explicitly:

- The sub-package owns its own dependency on `undici` (and only `undici`); no other v1 package depends on `undici`.
- The sub-package consumes the runtime egress hook (ADR-001) but the hook is configured to allow `undici.Dispatcher.connect` ONLY when initiated from the url-adapter package call stack; this is enforced via stack-frame inspection at the hook layer (small additional logic in ADR-001's hook).
- The sub-package emits explicit `egress.allowed.url_fetch` telemetry events per NFR-016, distinguishable from the `egress.blocked` events.
- All other six-primitive guarantees from ADR-001 apply unchanged.
- The lint exemption scope is documented in the sub-package's README and CI lint job emits a structured warning if the exemption is broadened.

## Consequences

**Positive:**
- Single auditable boundary: `packages/url-adapter/` is the only path with allowed outbound HTTP in v1
- Answers Q-003 (closes the open question)
- Compatible with ADR-001's runtime egress hook architecture (small addition to hook's stack-frame check)
- Future contributors cannot accidentally widen the exemption — adding network imports anywhere else still fails NFR-001 lint

**Negative:**
- Slight complexity overhead in ADR-001's hook (stack-frame inspection adds ~20 lines + perf cost on every outbound primitive call from the URL adapter; bounded by URL-fetch frequency, which is low)
- Two-package monorepo introduces some packaging discipline; v1 only ships one binary

**Neutral:**
- Future allowed-egress requirements (e.g., remote-update self-check) would each get their own sub-package; long-tail of network-touching components becomes a directory of allowed pockets
- ADR-001's hook gains a configuration parameter (allowed_callers) which must be conservatively populated

## Compliance / verification

- **Tests**: ACCEPTANCE-CRITERIA.feature scenarios for FR-020 include "URL ingest from url-adapter SUCCEEDS" + "outbound HTTP from any other package FAILS at lint AND at runtime"
- **Telemetry**: `egress.allowed.url_fetch` per NFR-016; `egress.blocked.unauthorized` for any non-url-adapter origin
- **Trigger to revisit**: any v1 requirement needing outbound HTTP from a different code path → ADR-006 amendment OR new sub-package per same pattern
