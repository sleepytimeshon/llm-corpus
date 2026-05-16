// SP-007 T002 — RED-phase contract test for the install-schemas Zod surface.
//
// References:
//   - specs/007-install-first-run/data-model.md Entities 1-6
//   - specs/007-install-first-run/tasks.md T002 / T012
//   - specs/007-install-first-run/spec.md FR-INSTALL-020
//   - Constitution Principle V (schema-enforced structured output)
//
// TDD: this test MUST FAIL before T012 (the implementation) lands; it imports
// `packages/contracts/src/install-schemas.ts` which does not yet exist.

import { describe, it, expect } from 'vitest';

const VALID_ISO = '2026-05-15T14:30:00.123Z';

describe('SP-007 PREREQ-001 — install-schemas (T002 / T012)', () => {
  it('module is importable from @llm-corpus/contracts', async () => {
    const mod = (await import(
      '../../packages/contracts/src/install-schemas.js'
    )) as Record<string, unknown>;
    expect(mod.InstallReceiptZodSchema).toBeDefined();
    expect(mod.InstallReceiptUninstalledZodSchema).toBeDefined();
    expect(mod.TaxonomySeedEntryZodSchema).toBeDefined();
    expect(mod.TaxonomySeedZodSchema).toBeDefined();
    expect(mod.MCPClientConfigEntryZodSchema).toBeDefined();
    expect(mod.MCPClientConfigFileZodSchema).toBeDefined();
    expect(mod.FirewallRuleSpecZodSchema).toBeDefined();
    expect(mod.AutoStartUnitSpecZodSchema).toBeDefined();
    expect(mod.TaxonomyPromoteArgsZodSchema).toBeDefined();
    expect(mod.InstallPreflightResultZodSchema).toBeDefined();
    expect(mod.InstallCliArgsZodSchema).toBeDefined();
    expect(mod.UninstallCliArgsZodSchema).toBeDefined();
  });

  it('every install-schemas export is also re-exported from contracts/index.ts', async () => {
    const idx = (await import(
      '../../packages/contracts/src/index.js'
    )) as Record<string, unknown>;
    expect(idx.InstallReceiptZodSchema).toBeDefined();
    expect(idx.TaxonomySeedZodSchema).toBeDefined();
    expect(idx.FirewallRuleSpecZodSchema).toBeDefined();
    expect(idx.TaxonomyPromoteArgsZodSchema).toBeDefined();
    expect(idx.InstallPreflightResultZodSchema).toBeDefined();
  });

  // --- InstallReceiptZodSchema ---

  function validReceipt(): Record<string, unknown> {
    return {
      schema_version: 1,
      installed_at: VALID_ISO,
      installed_via: 'npx',
      corpus_binary_path: '/usr/local/bin/corpus',
      created_paths: [
        '/home/shonrs/.local/share/llm-corpus',
        '/home/shonrs/.local/state/llm-corpus',
      ],
      mcp_client_configs: [
        { path: '/home/shonrs/.claude.json', key_added: 'mcpServers.corpus' },
      ],
      firewall_rules: [
        {
          os: 'linux',
          corpus_uid: 1000,
          anchor_or_chain: 'OUTPUT',
          rule_text: 'iptables OUTPUT uid 1000 reject non-loopback',
          provision_command: {
            cmd: 'iptables',
            args: ['-A', 'OUTPUT', '-m', 'owner', '--uid-owner', '1000'],
          },
          reverse_command: {
            cmd: 'iptables',
            args: ['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', '1000'],
          },
        },
      ],
      auto_start_units: [],
      seeded_taxonomy_terms: [
        { axis: 'domain', term: 'engineering', established_at: VALID_ISO },
      ],
      os: 'linux',
      os_version: '6.19.13-200.fc43.x86_64',
      node_version: '22.22.0',
    };
  }

  it('InstallReceiptZodSchema accepts a fully-populated receipt', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(InstallReceiptZodSchema.safeParse(validReceipt()).success).toBe(
      true,
    );
  });

  it('InstallReceiptZodSchema rejects schema_version=2', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = validReceipt();
    r.schema_version = 2;
    expect(InstallReceiptZodSchema.safeParse(r).success).toBe(false);
  });

  it('InstallReceiptZodSchema rejects installed_via outside enum', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = validReceipt();
    r.installed_via = 'pnpm';
    expect(InstallReceiptZodSchema.safeParse(r).success).toBe(false);
  });

  it('InstallReceiptZodSchema rejects empty reverse_command.cmd', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = validReceipt();
    (r.firewall_rules as Array<{ reverse_command: { cmd: string } }>)[0]
      .reverse_command.cmd = '';
    expect(InstallReceiptZodSchema.safeParse(r).success).toBe(false);
  });

  it('InstallReceiptZodSchema requires reverse_command.args to be an array', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = validReceipt();
    (
      r.firewall_rules as Array<{ reverse_command: { args: unknown } }>
    )[0].reverse_command.args = 'iptables -D OUTPUT';
    expect(InstallReceiptZodSchema.safeParse(r).success).toBe(false);
  });

  it('InstallReceiptZodSchema rejects unknown root keys', async () => {
    const { InstallReceiptZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = { ...validReceipt(), extra_unknown_field: 'x' };
    expect(InstallReceiptZodSchema.safeParse(r).success).toBe(false);
  });

  // --- InstallReceiptUninstalledZodSchema ---

  it('InstallReceiptUninstalledZodSchema accepts uninstalled receipt', async () => {
    const { InstallReceiptUninstalledZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const r = { ...validReceipt(), uninstalled: true, uninstalled_at: VALID_ISO };
    expect(
      InstallReceiptUninstalledZodSchema.safeParse(r).success,
    ).toBe(true);
  });

  // --- TaxonomySeedEntryZodSchema ---

  it('TaxonomySeedEntryZodSchema accepts {axis, term}', async () => {
    const { TaxonomySeedEntryZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomySeedEntryZodSchema.safeParse({ axis: 'domain', term: 'eng' })
        .success,
    ).toBe(true);
  });

  it('TaxonomySeedEntryZodSchema rejects empty term', async () => {
    const { TaxonomySeedEntryZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomySeedEntryZodSchema.safeParse({ axis: 'domain', term: '' })
        .success,
    ).toBe(false);
  });

  it('TaxonomySeedEntryZodSchema rejects axis outside enum', async () => {
    const { TaxonomySeedEntryZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomySeedEntryZodSchema.safeParse({ axis: 'unknown', term: 'x' })
        .success,
    ).toBe(false);
  });

  // --- TaxonomySeedZodSchema ---

  function makeSeed(n: number): Array<{ axis: string; term: string }> {
    const out: Array<{ axis: string; term: string }> = [];
    for (let i = 0; i < n; i++) {
      out.push({ axis: 'tag', term: `term-${i}` });
    }
    return out;
  }

  it('TaxonomySeedZodSchema accepts 25-entry seed', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(TaxonomySeedZodSchema.safeParse(makeSeed(25)).success).toBe(true);
  });

  it('TaxonomySeedZodSchema accepts 50-entry seed', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(TaxonomySeedZodSchema.safeParse(makeSeed(50)).success).toBe(true);
  });

  it('TaxonomySeedZodSchema rejects 24-entry seed', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(TaxonomySeedZodSchema.safeParse(makeSeed(24)).success).toBe(false);
  });

  it('TaxonomySeedZodSchema rejects 51-entry seed', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(TaxonomySeedZodSchema.safeParse(makeSeed(51)).success).toBe(false);
  });

  it('TaxonomySeedZodSchema rejects duplicate (axis, term) pairs', async () => {
    const { TaxonomySeedZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const seed = makeSeed(25);
    seed[0] = { axis: 'tag', term: 'term-1' };
    seed[1] = { axis: 'tag', term: 'term-1' };
    expect(TaxonomySeedZodSchema.safeParse(seed).success).toBe(false);
  });

  // --- MCPClientConfigEntryZodSchema ---

  it('MCPClientConfigEntryZodSchema enforces args: ["mcp"]', async () => {
    const { MCPClientConfigEntryZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      MCPClientConfigEntryZodSchema.safeParse({
        command: '/usr/local/bin/corpus',
        args: ['mcp'],
      }).success,
    ).toBe(true);
    expect(
      MCPClientConfigEntryZodSchema.safeParse({
        command: '/usr/local/bin/corpus',
        args: ['serve'],
      }).success,
    ).toBe(false);
    expect(
      MCPClientConfigEntryZodSchema.safeParse({
        command: '/usr/local/bin/corpus',
        args: ['mcp', 'extra'],
      }).success,
    ).toBe(false);
  });

  // --- MCPClientConfigFileZodSchema ---

  it('MCPClientConfigFileZodSchema accepts permissive root + strict mcpServers subtree', async () => {
    const { MCPClientConfigFileZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      MCPClientConfigFileZodSchema.safeParse({
        someOtherTopLevelKey: 'preserved',
        mcpServers: {
          corpus: { command: '/usr/local/bin/corpus', args: ['mcp'] },
          other: { command: '/x', args: ['y'] },
        },
      }).success,
    ).toBe(true);
  });

  // --- FirewallRuleSpecZodSchema ---

  it('FirewallRuleSpecZodSchema requires numeric uid + provision/reverse arg arrays', async () => {
    const { FirewallRuleSpecZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    const valid = {
      os: 'linux' as const,
      corpus_uid: 1000,
      anchor_or_chain: 'OUTPUT',
      rule_text: 'rule',
      provision_command: { cmd: 'iptables', args: ['-A', 'OUTPUT'] },
      reverse_command: { cmd: 'iptables', args: ['-D', 'OUTPUT'] },
    };
    expect(FirewallRuleSpecZodSchema.safeParse(valid).success).toBe(true);
    expect(
      FirewallRuleSpecZodSchema.safeParse({ ...valid, corpus_uid: '1000' })
        .success,
    ).toBe(false);
    expect(
      FirewallRuleSpecZodSchema.safeParse({ ...valid, os: 'windows' })
        .success,
    ).toBe(false);
  });

  // --- AutoStartUnitSpecZodSchema ---

  it('AutoStartUnitSpecZodSchema validates the systemd unit / launchd plist surface', async () => {
    const { AutoStartUnitSpecZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      AutoStartUnitSpecZodSchema.safeParse({
        os: 'linux',
        unit_path: '/home/shonrs/.config/systemd/user/corpus.service',
        reverse_command: {
          cmd: 'systemctl',
          args: ['--user', 'disable', '--now', 'corpus.service'],
        },
      }).success,
    ).toBe(true);
  });

  // --- TaxonomyPromoteArgsZodSchema ---

  it('TaxonomyPromoteArgsZodSchema accepts {axis, terms} mode', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({
        axis: 'domain',
        terms: ['climbing'],
      }).success,
    ).toBe(true);
  });

  it('TaxonomyPromoteArgsZodSchema accepts {from_proposed_with_count_ge: N} mode', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({ from_proposed_with_count_ge: 10 })
        .success,
    ).toBe(true);
  });

  it('TaxonomyPromoteArgsZodSchema rejects mixed modes (XOR refinement)', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({
        axis: 'domain',
        terms: ['climbing'],
        from_proposed_with_count_ge: 10,
      }).success,
    ).toBe(false);
  });

  it('TaxonomyPromoteArgsZodSchema rejects axis without terms', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({ axis: 'domain' }).success,
    ).toBe(false);
  });

  it('TaxonomyPromoteArgsZodSchema rejects empty terms array', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({ axis: 'domain', terms: [] })
        .success,
    ).toBe(false);
  });

  it('TaxonomyPromoteArgsZodSchema rejects negative or fractional count threshold', async () => {
    const { TaxonomyPromoteArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({ from_proposed_with_count_ge: -5 })
        .success,
    ).toBe(false);
    expect(
      TaxonomyPromoteArgsZodSchema.safeParse({ from_proposed_with_count_ge: 3.14 })
        .success,
    ).toBe(false);
  });

  // --- InstallPreflightResultZodSchema ---

  it('InstallPreflightResultZodSchema validates all 7 fields per data-model Entity 3', async () => {
    const { InstallPreflightResultZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      InstallPreflightResultZodSchema.safeParse({
        node_ok: true,
        node_version: '22.22.0',
        ollama_ok: true,
        ollama_models_pulled: { classifier: true, embedder: true },
        xdg_writable: true,
        partial_install_detected: false,
        partial_install_paths: [],
      }).success,
    ).toBe(true);
  });

  // --- InstallCliArgsZodSchema ---

  it('InstallCliArgsZodSchema accepts optional flags', async () => {
    const { InstallCliArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(
      InstallCliArgsZodSchema.safeParse({
        'mcp-client-config': '/home/user/.claude.json',
        'enable-autostart': false,
        'no-autostart': false,
        smoke: false,
        'force-autostart': false,
      }).success,
    ).toBe(true);
    expect(InstallCliArgsZodSchema.safeParse({}).success).toBe(true);
  });

  // --- UninstallCliArgsZodSchema ---

  it('UninstallCliArgsZodSchema validates --purge boolean', async () => {
    const { UninstallCliArgsZodSchema } = await import(
      '../../packages/contracts/src/install-schemas.js'
    );
    expect(UninstallCliArgsZodSchema.safeParse({ purge: true }).success).toBe(
      true,
    );
    expect(UninstallCliArgsZodSchema.safeParse({}).success).toBe(true);
  });
});
