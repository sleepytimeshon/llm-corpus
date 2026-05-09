---
artifact: ADR
adr_id: ADR-009
project_slug: llm-corpus
stage: 5-build-test
tier: deep
template_version: 3.0.0
generated: 2026-05-09T00:00:00Z
generated_by: ProductBuild (SP-002 amendment)
status: proposed
supersedes: null
superseded_by: null
deciders: ["Shon"]
date_proposed: 2026-05-09T00:00:00Z
date_accepted: null
product_type: software

links:
  decisions_jsonl_id: D-020
  requirements_gated: []
  roadmap_items_gated: []
  related_adrs: [ADR-001]

reversibility: low
tags: [lint, constitution, subprocess, sqlite]
---

# ADR-009: Narrow `no-shell-string-exec` Lint Rule to Disambiguate `db.exec(SQL)`

## Status

proposed

## Context

Constitution Principle XII (Subprocess Hygiene, NON-NEGOTIABLE) forbids `execSync`, `exec`, and string-formed shell commands; all subprocess invocations must go through the `runTool` helper. The SP-001 lint rule `tools/eslint-rules/no-shell-string-exec.js` enforced this via a forbidden-name set: `{exec, execSync, execFileSync}` matched against any `<obj>.<prop>()` member call or bare identifier call.

**The conflict surfaced in SP-002:** the storage layer required by FR-005..FR-008 uses `better-sqlite3` for the corpus-side SQLite work. `better-sqlite3` exposes a `Database.prototype.exec(sql: string)` method — a legitimate, single-process API that runs multi-statement SQL inside the Node process via the native addon. It has no shell semantics, no subprocess, no command-injection vector. It is precisely the kind of thing Constitution XII does not target.

The original lint rule has no way to distinguish the SQLite API from `child_process.exec`: both surface as `<obj>.exec(<string>)` calls. SP-002 storage adapters therefore could not be implemented without lint-rule changes.

**Forces / constraints:**

- Constitution XII is NON-NEGOTIABLE — the protection it provides (no shell-class subprocess invocation outside `runTool`) cannot weaken
- ADR-001 native-addon allowlist confirms `better-sqlite3` and `sqlite-vec` are the only allowed native modules; their APIs are part of the project's intended substrate
- Lint rules that produce false positives erode their own enforcement value — the team starts disabling them per-line, which is worse than narrower coverage
- A separate ADR ceremony for this change is required because Principle XII is constitution-level; per the project's bypass-prevention discipline, lint-rule changes affecting NON-NEGOTIABLE principles cannot ride in feature PRs

**Alternatives considered:**

1. **Per-line disable comments at every `db.exec(SQL)` call site** — preserves rule strictness but creates 20+ disable comments across SP-002 storage adapters; each future SQL-bearing file adds one; rule strictness erodes informally over time
2. **Rename the SQLite method via a wrapper** — would force every call site to use `db.exec(...)`-equivalent through a project helper. Adds indirection with no constitutional benefit; the call still ends up in native code
3. **Narrow the lint rule with import-tracking** — distinguish `child_process.exec` (still fully forbidden) from `<other>.exec` (allowed if not bound to child_process). Requires AST work to track which local bindings come from `child_process` / `node:child_process`
4. **Disable the lint rule entirely; rely on code review** — abandons machine enforcement of Principle XII

## Decision

We adopt **alternative 3**: narrow the rule via import-tracking.

The new rule:

- `execSync` and `execFileSync` remain unambiguously forbidden as bare identifiers OR as member-call property names — these have no overlap with `better-sqlite3` or any other allowlisted addon
- `exec` (the ambiguous name) is forbidden only when:
  - it is a bare identifier imported from `'child_process'` or `'node:child_process'`, OR
  - it is the property of a member-call whose receiver is a local binding imported as a namespace from `'child_process'` / `'node:child_process'`
- `spawn` / `spawnSync` with `shell: true` continues to be forbidden in all cases

The rule's import-tracking is local-scope per source file, which is sufficient because Node ESM/CJS imports are file-scoped and `better-sqlite3` is never imported under a name that masquerades as `child_process` (allowlist-enforced via ADR-001).

## Consequences

**Positive:**
- Principle XII enforcement preserved against its actual target (shell-class subprocess invocation)
- SP-002 storage adapters can use `db.exec(SQL)` without per-line disable comments
- The rule's signal-to-noise ratio improves; future contributors don't need to learn a per-call-site exemption pattern
- Constitution amendment ceremony is honored — this ADR + constitution.md note ratify the narrowing rather than letting it ride implicitly in a feature PR

**Negative:**
- The rule is more complex (import-tracking AST work). More LOC, more test surface
- **Variable-rebinding gap (known limitation):** if a contributor writes `import * as cp from 'child_process'; const sneak = cp.exec; sneak('cmd')`, the rule will not flag the `sneak('cmd')` call. AST-only rules without taint analysis cannot follow value flow through assignments. Same gap for `const { exec } = require('child_process')` destructuring at runtime if not via the static `ImportDeclaration` AST shape. Mitigation: (a) code review for any subprocess-adjacent diff; (b) the existing `runTool`-required pattern means non-`runTool` subprocess work is already a review red flag; (c) the egress hook in `packages/transport/src/egress-hook.ts` blocks the actual outbound network call regardless, so a smuggled `child_process.exec('curl ...')` would still fail at runtime
- We have widened the surface where future allowlisted native addons (sqlite-vec etc.) could plausibly add a method named `exec` and silently bypass the rule. Mitigation: ADR-001's native-addon allowlist gates new addons, and any new addon's API surface should be reviewed against this rule when added

**Neutral:**
- The constitution text for Principle XII does not change; only the lint mechanism's interpretation of "exec" narrows. The principle still says: "execSync, exec, and any string-formed shell command are FORBIDDEN" — and they are, when the lint rule can determine they are child_process-bound. The rule's gap is a known limitation, not a relaxation of the principle.

## Compliance / verification

- **Tests**: SP-002 lint-fixture tests under `tests/lint-fixtures/` cover (a) `db.exec(SQL)` against an imported `better-sqlite3` Database — must NOT report; (b) `child_process.exec('cmd')` — must report; (c) `import * as cp from 'child_process'; cp.exec('cmd')` — must report; (d) `import { exec } from 'child_process'; exec('cmd')` — must report; (e) `import { execSync } from 'child_process'; execSync('cmd')` — must report; (f) `spawn('cmd', { shell: true })` — must report. SP-001's existing 17-fixture forbidden-import suite remains unchanged.
- **Lint pass**: `npm run lint` clean across `packages/`, `tools/`, `tests/` after the rule narrowing
- **Constitution Check**: 16/16 principles still pass; Principle XII text unchanged; only its lint-mechanism implementation widens its disambiguation surface
- **Trigger to revisit**: a new allowlisted native addon (per ADR-001 amendment) introduces an API method named `exec` AND that addon is imported under a name that overlaps with `child_process` aliases → reopen ADR-009 for further narrowing
