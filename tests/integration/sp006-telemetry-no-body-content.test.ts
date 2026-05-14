// T059 (SP-006 Phase 6) — No body content in SP-006 telemetry payloads.
//
// Constitution Principle I + SC-HARDEN-024: across a mixed-workload run
// (recovery scans + failures-resource reads + tier-fallthrough invocations),
// zero SP-006 telemetry event payloads contain substrings drawn from body
// text of indexed documents NOR raw query text (queries are SHA-256-hashed
// per SP-005 FR-RETRIEVAL-023).
//
// Approach:
//   - Seed body-canary strings in (a) fixture sidecars in Paths.failed(),
//     (b) synthetic telemetry log entries (orphan markers carrying a body),
//     (c) the SearchInput query passed to runTieredSearch.
//   - Run a synthetic mixed workload (recovery scan + failures read + tier
//     cascade with stub TierFns).
//   - Read the resulting Paths.telemetry() JSONL and grep for the canaries.
//   - Assert ZERO matches across the SP-006 surface.
//
// References:
//   - specs/006-hardening/tasks.md T059
//   - specs/006-hardening/spec.md FR-HARDEN-005, SC-HARDEN-024
//   - Constitution Principle I (private-by-default; bodies stay local)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { Paths } from '@llm-corpus/contracts';
import { runRecoveryScan } from '../../packages/pipeline/src/recovery-scanner.js';
import { batchPolicy } from '../../packages/pipeline/src/policies.js';
import { failuresResourceHandler } from '../../packages/transport/src/failures-resource-handler.js';
import { runTieredSearch } from '../../packages/index/src/tier-orchestrator.js';

const recoveryLogger = { warn: (_m: string): void => {} };

// Distinct canary strings — one per body-content origin. None of these should
// appear in telemetry payloads.
const CANARIES = {
  sidecar: 'FIXTURE_BODY_CANARY_SIDECAR_SP006',
  telemetryOrphan: 'FIXTURE_BODY_CANARY_ORPHAN_SP006',
  query: 'FIXTURE_BODY_CANARY_QUERY_SP006',
  tierHit: 'FIXTURE_BODY_CANARY_TIERHIT_SP006',
} as const;

describe('SC-HARDEN-024 — no body content in SP-006 telemetry payloads (T059)', () => {
  let tmpHome: string;
  let originalCorpusHome: string | undefined;

  beforeEach(async () => {
    originalCorpusHome = process.env.CORPUS_HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sp006-no-body-telemetry-'));
    process.env.CORPUS_HOME = tmpHome;
    // Pre-create XDG bases used by SP-006 surfaces.
    for (const sub of ['data', 'state', 'cache', 'config']) {
      await fsp.mkdir(path.join(tmpHome, sub), { recursive: true });
    }
    await fsp.mkdir(Paths.failed(), { recursive: true });
    await fsp.mkdir(path.dirname(Paths.telemetry()), { recursive: true });
  });

  afterEach(() => {
    if (originalCorpusHome === undefined) {
      delete process.env.CORPUS_HOME;
    } else {
      process.env.CORPUS_HOME = originalCorpusHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('mixed recovery + failures-read + tier-cascade workload emits zero body-canary occurrences', async () => {
    // ---- Seed (a) — fixture sidecars carrying body content ----
    // The failures resource schema's `message` field is bounded to 1024 chars
    // BUT must not be sourced from document body text. We seed sidecars with
    // policy-compliant messages so the adapter accepts them, then plant the
    // body canary in a non-emitted field via the doc_id-shaped value below.
    // The canary, if leaked, would surface in the resource.read payload via
    // a body-content path — which the schema forbids.
    for (let i = 0; i < 5; i++) {
      const sidecar = {
        doc_id: `doc-${i.toString(16).padStart(8, '0')}`,
        stage: 'classify',
        error_code: 'persist_failed',
        message: 'synthetic',
        timestamp: `2026-05-13T09:0${i}:00Z`,
        retriable: false,
        // body_excerpt is NOT a schema field — adapter strips unknown keys.
        body_excerpt: `${CANARIES.sidecar} this should never reach telemetry`,
      };
      await fsp.writeFile(
        path.join(Paths.failed(), `doc-${i}.error.json`),
        JSON.stringify(sidecar),
        'utf8',
      );
    }

    // ---- Seed (b) — synthetic telemetry log with an orphan marker ----
    // The recovery scanner iterates the telemetry JSONL and identifies
    // orphans by their `doc_id` + `stage` pair. The body canary, planted in
    // an ignored field, must NOT round-trip into a recovery.* event payload.
    const telemetryPath = Paths.telemetry();
    const seed = [
      {
        event: 'daemon.started',
        timestamp: '2026-05-13T09:00:00Z',
        severity: 'info',
        outcome: 'success',
        pid: 1,
      },
      {
        event: 'classify.started',
        timestamp: '2026-05-13T09:01:00Z',
        doc_id: 'doc-aaaaaaaa',
        severity: 'info',
        outcome: 'success',
        // Body canary planted in a non-schema field of the seed event:
        body_excerpt: CANARIES.telemetryOrphan,
      },
    ];
    await fsp.writeFile(
      telemetryPath,
      seed.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );

    // ---- Workload 1 — recovery scans (5 invocations) ----
    for (let i = 0; i < 5; i++) {
      const ac = new AbortController();
      await runRecoveryScan(
        {
          policy: batchPolicy,
          paths: Paths,
          logger: recoveryLogger,
        },
        ac.signal,
      ).catch(() => {
        // recovery scanner may emit recovery.scan_skipped on a re-entry —
        // that's fine; we're measuring telemetry contents, not outcomes.
      });
    }

    // ---- Workload 2 — corpus://failures reads (5 invocations) ----
    for (let i = 0; i < 5; i++) {
      const ac = new AbortController();
      await failuresResourceHandler('corpus://failures', ac.signal);
    }

    // ---- Workload 3 — tier-cascade invocations with stub tier fns (5x) ----
    // The query carries CANARIES.query — SP-005 hashes queries to SHA-256
    // before emitting, so the canary should NOT appear in any search.* event.
    // Each TierFn returns a SearchHit whose `snippet` contains the tier-hit
    // canary; the orchestrator MUST NOT echo snippet content into telemetry.
    const stubHit = (docId: string, tier: 'hybrid' | 'bm25-only') => ({
      uri: `corpus://docs/${docId}`,
      title: 'stub',
      facet_domain: 'rhel',
      facet_type: 'reference' as const,
      tags: ['x', 'y', 'z'],
      score: 0.5,
      snippet: `match ${CANARIES.tierHit} here`,
      tier_used: tier,
    });
    for (let i = 0; i < 5; i++) {
      const ac = new AbortController();
      await runTieredSearch(
        {
          query: `${CANARIES.query} synthetic`,
          limit: 10,
        },
        {
          tier0: async () => ({
            tier: 'hybrid',
            hits: [stubHit('doc-aaaaaaaa', 'hybrid')],
            elapsed_ms: 1,
            outcome: 'completed',
          }),
          tier1: async () => ({
            tier: 'bm25-only',
            hits: [stubHit('doc-bbbbbbbb', 'bm25-only')],
            elapsed_ms: 1,
            outcome: 'completed',
          }),
          tier2: async () => ({
            tier: 'catalog-grep',
            hits: [],
            elapsed_ms: 1,
            outcome: 'skipped',
          }),
          tier3: async () => ({
            tier: 'fs-grep',
            hits: [],
            elapsed_ms: 1,
            outcome: 'skipped',
          }),
          policy: {
            minResultsForFallthrough: 3,
            tierTotalBudgetMs: 1000,
            tierBm25TimeoutMs: 100,
            tierCatalogGrepTimeoutMs: 100,
            tierFsGrepTimeoutMs: 100,
          },
        },
        ac.signal,
      );
    }

    // ---- Verify — the telemetry JSONL has zero canary occurrences ----
    const telemetryText = await fsp.readFile(telemetryPath, 'utf8');
    // Strip the synthetic SEED line we planted ourselves — that line is the
    // INPUT to the scanner, not an emitted event. We only assert that AFTER
    // the workload runs, no NEW lines contain the canaries (i.e., the lines
    // beyond the original seed line count).
    const lines = telemetryText.split('\n').filter((l) => l.length > 0);
    const emittedLines = lines.slice(seed.length); // skip the 2 seed lines

    for (const canary of Object.values(CANARIES)) {
      const hits = emittedLines.filter((l) => l.includes(canary));
      expect(
        hits.length,
        `canary ${canary} leaked into SP-006 telemetry: ${hits.slice(0, 3).join(' | ')}`,
      ).toBe(0);
    }
  });
});
