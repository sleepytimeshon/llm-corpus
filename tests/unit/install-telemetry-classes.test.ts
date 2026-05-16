// SP-007 T003 — RED-phase contract test for the 12 new SP-007 telemetry classes.
//
// References:
//   - specs/007-install-first-run/data-model.md Entity 7
//   - specs/007-install-first-run/tasks.md T003 / T013
//   - specs/007-install-first-run/spec.md FR-INSTALL-021
//   - Constitution Principles V, IX, XIII

import { describe, it, expect } from 'vitest';

const VALID_ISO = '2026-05-15T14:30:00.123Z';

describe('SP-007 PREREQ-002 — install/uninstall/taxonomy telemetry classes', () => {
  // ---- install.* (6 classes) ----

  it('install.preflight_failed validates required envelope + class fields', async () => {
    const mod = (await import('../../packages/contracts/src/telemetry.js')) as Record<
      string,
      unknown
    >;
    const Schema = mod.InstallPreflightFailedEvent as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(Schema).toBeDefined();
    expect(
      Schema.safeParse({
        event: 'install.preflight_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        unmet_requirement: 'node_version',
        details: { node_version: '16.14.0' },
      }).success,
    ).toBe(true);
    expect(
      Schema.safeParse({
        event: 'install.preflight_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        unmet_requirement: 'not_a_real_enum_value',
      }).success,
    ).toBe(false);
  });

  it('install.step_failed enforces the 11-value step enum', async () => {
    const { InstallStepFailedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const validSteps = [
      'preflight',
      'idempotency_check',
      'xdg_bringup',
      'sqlite_singlefile',
      'config_toml',
      'taxonomy_seed',
      'mcp_client_config',
      'firewall_provision',
      'auto_start_unit',
      'install_receipt',
      'next_step_output',
    ];
    for (const step of validSteps) {
      expect(
        InstallStepFailedEvent.safeParse({
          event: 'install.step_failed',
          timestamp: VALID_ISO,
          severity: 'error',
          outcome: 'failure',
          step,
          duration_ms: 100,
          error_code: 'some_code',
        }).success,
      ).toBe(true);
    }
    expect(
      InstallStepFailedEvent.safeParse({
        event: 'install.step_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        step: 'not_a_real_step',
        duration_ms: 100,
        error_code: 'x',
      }).success,
    ).toBe(false);
  });

  it('install.completed validates success outcome + duration', async () => {
    const { InstallCompletedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      InstallCompletedEvent.safeParse({
        event: 'install.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 45_000,
        installed_via: 'npx',
        os: 'linux',
        steps_skipped: ['auto_start_unit'],
      }).success,
    ).toBe(true);
  });

  it('install.smoke_started carries the seed_doc_path', async () => {
    const { InstallSmokeStartedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      InstallSmokeStartedEvent.safeParse({
        event: 'install.smoke_started',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        seed_doc_path: '/abs/path/to/fixtures/first-run-seed.md',
      }).success,
    ).toBe(true);
  });

  it('install.smoke_completed carries hits_returned', async () => {
    const { InstallSmokeCompletedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      InstallSmokeCompletedEvent.safeParse({
        event: 'install.smoke_completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 22_000,
        hits_returned: 1,
      }).success,
    ).toBe(true);
  });

  it('install.smoke_failed uses failure_step enum', async () => {
    const { InstallSmokeFailedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      InstallSmokeFailedEvent.safeParse({
        event: 'install.smoke_failed',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
        duration_ms: 30_000,
        failure_step: 'corpus_find_zero_hits',
        error_code: 'no_hits',
      }).success,
    ).toBe(true);
    expect(
      InstallSmokeFailedEvent.safeParse({
        event: 'install.smoke_failed',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
        duration_ms: 30_000,
        failure_step: 'not_an_enum',
        error_code: 'x',
      }).success,
    ).toBe(false);
  });

  // ---- uninstall.* (3 classes) ----

  it('uninstall.preflight_failed uses receipt_missing|receipt_malformed|platform_mismatch enum', async () => {
    const { UninstallPreflightFailedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    for (const reason of [
      'receipt_missing',
      'receipt_malformed',
      'platform_mismatch',
    ]) {
      expect(
        UninstallPreflightFailedEvent.safeParse({
          event: 'uninstall.preflight_failed',
          timestamp: VALID_ISO,
          severity: 'error',
          outcome: 'failure',
          unmet_requirement: reason,
        }).success,
      ).toBe(true);
    }
  });

  it('uninstall.step_failed uses the 6-value step enum', async () => {
    const { UninstallStepFailedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    for (const step of [
      'preflight',
      'mcp_client_config_reverse',
      'firewall_reverse',
      'auto_start_unit_reverse',
      'xdg_subtree_purge',
      'receipt_finalize',
    ]) {
      expect(
        UninstallStepFailedEvent.safeParse({
          event: 'uninstall.step_failed',
          timestamp: VALID_ISO,
          severity: 'error',
          outcome: 'failure',
          step,
          duration_ms: 50,
          error_code: 'x',
        }).success,
      ).toBe(true);
    }
  });

  it('uninstall.completed includes purged boolean', async () => {
    const { UninstallCompletedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      UninstallCompletedEvent.safeParse({
        event: 'uninstall.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 1_500,
        purged: true,
      }).success,
    ).toBe(true);
  });

  // ---- taxonomy.* (3 classes) ----

  it('taxonomy.promote_completed validates axis + term + was_already_established', async () => {
    const { TaxonomyPromoteCompletedEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      TaxonomyPromoteCompletedEvent.safeParse({
        event: 'taxonomy.promote_completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        axis: 'domain',
        term: 'climbing',
        was_already_established: false,
      }).success,
    ).toBe(true);
  });

  it('taxonomy.promote_lock_contention is optional-payload', async () => {
    const { TaxonomyPromoteLockContentionEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      TaxonomyPromoteLockContentionEvent.safeParse({
        event: 'taxonomy.promote_lock_contention',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
        lock_holder_hint: 'daemon',
      }).success,
    ).toBe(true);
    expect(
      TaxonomyPromoteLockContentionEvent.safeParse({
        event: 'taxonomy.promote_lock_contention',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
      }).success,
    ).toBe(true);
  });

  it('taxonomy.promote_missing_term validates axis + term', async () => {
    const { TaxonomyPromoteMissingTermEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      TaxonomyPromoteMissingTermEvent.safeParse({
        event: 'taxonomy.promote_missing_term',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        axis: 'domain',
        term: 'does_not_exist',
      }).success,
    ).toBe(true);
  });

  // ---- TelemetryEvent union — all 12 new variants ----

  it('TelemetryEvent union accepts every SP-007 variant', async () => {
    const { TelemetryEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    const variants: Array<Record<string, unknown>> = [
      {
        event: 'install.preflight_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        unmet_requirement: 'node_version',
      },
      {
        event: 'install.step_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        step: 'xdg_bringup',
        duration_ms: 1,
        error_code: 'EACCES',
      },
      {
        event: 'install.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 1,
        installed_via: 'local',
        os: 'macos',
        steps_skipped: [],
      },
      {
        event: 'install.smoke_started',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        seed_doc_path: '/x',
      },
      {
        event: 'install.smoke_completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 1,
        hits_returned: 1,
      },
      {
        event: 'install.smoke_failed',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
        duration_ms: 1,
        failure_step: 'teardown',
        error_code: 'x',
      },
      {
        event: 'uninstall.preflight_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        unmet_requirement: 'receipt_missing',
      },
      {
        event: 'uninstall.step_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        step: 'firewall_reverse',
        duration_ms: 1,
        error_code: 'x',
      },
      {
        event: 'uninstall.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 1,
        purged: false,
      },
      {
        event: 'taxonomy.promote_completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        axis: 'tag',
        term: 'x',
        was_already_established: false,
      },
      {
        event: 'taxonomy.promote_lock_contention',
        timestamp: VALID_ISO,
        severity: 'warning',
        outcome: 'failure',
      },
      {
        event: 'taxonomy.promote_missing_term',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        axis: 'tag',
        term: 'x',
      },
    ];
    for (const v of variants) {
      expect(TelemetryEvent.safeParse(v).success, JSON.stringify(v)).toBe(true);
    }
  });

  it('every SP-007 event serializes to <= 4096 bytes (Constitution IX)', async () => {
    const { TelemetryEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
    const samples: Array<Record<string, unknown>> = [
      {
        event: 'install.completed',
        timestamp: VALID_ISO,
        severity: 'info',
        outcome: 'success',
        duration_ms: 90_000,
        installed_via: 'npx',
        os: 'linux',
        steps_skipped: [
          'auto_start_unit',
          'xdg_bringup',
          'sqlite_singlefile',
          'config_toml',
          'taxonomy_seed',
          'mcp_client_config',
          'firewall_provision',
        ],
      },
      {
        event: 'install.step_failed',
        timestamp: VALID_ISO,
        severity: 'error',
        outcome: 'failure',
        step: 'firewall_provision',
        duration_ms: 10_000,
        error_code: 'firewall_binary_missing',
      },
    ];
    for (const s of samples) {
      const parsed = TelemetryEvent.safeParse(s);
      expect(parsed.success).toBe(true);
      const serialized = JSON.stringify(parsed.data);
      expect(serialized.length).toBeLessThanOrEqual(4096);
    }
  });

  // ---- Backward-compat: existing SP-001..SP-006 variants still validate ----

  it('existing pipeline.lock_contention still validates (reused by taxonomy promote per SC-007-022)', async () => {
    const { TelemetryEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      TelemetryEvent.safeParse({
        event: 'pipeline.lock_contention',
        timestamp: VALID_ISO,
        severity: 'warn',
        outcome: 'failed',
        lock_path: '/x/drain.lock',
        requesting_pid: 12345,
      }).success,
    ).toBe(true);
  });

  it('existing egress.attempted still validates (SP-001 carry-forward)', async () => {
    const { TelemetryEvent } = (await import(
      '../../packages/contracts/src/telemetry.js'
    )) as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    expect(
      TelemetryEvent.safeParse({
        event: 'egress.attempted',
        timestamp: VALID_ISO,
        primitive: 'net.Socket.connect',
        destination_host: 'example.com',
        destination_port: 443,
        request_id: '019099d4-78f0-7e61-a37c-8c2a9b5d2e10',
      }).success,
    ).toBe(true);
  });
});
