// SP-007 T012 — Zod contract surface for the SP-007 install / uninstall /
// taxonomy-promote feature. PREREQ-001 of plan.md.
//
// References:
//   - specs/007-install-first-run/data-model.md Entities 1-6
//   - specs/007-install-first-run/spec.md FR-INSTALL-020, SC-007-028
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md (ADR-012)
//   - specs/007-install-first-run/contracts/adr-firewall-provisioning.md (ADR-013)
//   - specs/007-install-first-run/contracts/adr-taxonomy-promote-cli.md (ADR-014)
//   - specs/007-install-first-run/contracts/adr-curated-seed.md (ADR-015)
//   - Constitution Principle V (Schema-Enforced Structured Output)
//
// Zero IO. Pure schema surface. Re-exported from packages/contracts/src/index.ts
// so downstream packages can `import { InstallReceiptZodSchema } from
// '@llm-corpus/contracts'`.

import { z } from 'zod';

// ---- Shared primitives ----

/** ISO-8601 timestamp regex (mirrors the SP-001 envelope convention). */
const ISO8601 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

/** OS discriminator captured via `os.platform()`. */
export const InstallOsZodSchema = z.enum(['macos', 'linux']);
export type InstallOs = z.infer<typeof InstallOsZodSchema>;

/** `installed_via` heuristic from `process.execPath`. */
export const InstalledViaZodSchema = z.enum(['npx', 'global', 'local']);
export type InstalledVia = z.infer<typeof InstalledViaZodSchema>;

/** The four taxonomy axes — closed enum mirroring the SP-004 axis column. */
export const TaxonomyAxisZodSchema = z.enum([
  'domain',
  'type',
  'tag',
  'source_type',
]);
export type TaxonomyAxis = z.infer<typeof TaxonomyAxisZodSchema>;

/**
 * A subprocess invocation captured as cmd + args[]. Constitution XII
 * (subprocess hygiene) — every external command must be invoked with an
 * arg array, never a shell-formatted string.
 */
export const SubprocessSpecZodSchema = z
  .object({
    cmd: z.string().min(1),
    args: z.array(z.string()),
  })
  .strict();
export type SubprocessSpec = z.infer<typeof SubprocessSpecZodSchema>;

// ============================================================================
// Entity 2 — TaxonomySeedEntry / TaxonomySeed
// ============================================================================

export const TaxonomySeedEntryZodSchema = z
  .object({
    axis: TaxonomyAxisZodSchema,
    term: z
      .string()
      .min(1)
      .refine((s) => s === s.trim(), {
        message: 'term must be trimmed (no leading/trailing whitespace)',
      }),
  })
  .strict();
export type TaxonomySeedEntry = z.infer<typeof TaxonomySeedEntryZodSchema>;

/**
 * The curated seed list bundled into the published package. Enforces the
 * SP-006 USER-GUIDE.md floor (≥ 25 entries: 5+6+9+5) and the dispatch-prompt
 * C-045 cap (≤ 50 entries). Refinement rejects duplicate `(axis, term)`.
 */
export const TaxonomySeedZodSchema = z
  .array(TaxonomySeedEntryZodSchema)
  .min(25)
  .max(50)
  .refine(
    (seed) => {
      const keys = seed.map((e) => `${e.axis}::${e.term}`);
      return new Set(keys).size === keys.length;
    },
    { message: 'duplicate (axis, term) pair in seed' },
  );
export type TaxonomySeed = z.infer<typeof TaxonomySeedZodSchema>;

// ============================================================================
// Entity 4 — MCPClientConfigEntry
// ============================================================================

export const MCPClientConfigEntryZodSchema = z
  .object({
    command: z.string().min(1),
    args: z.tuple([z.literal('mcp')]),
  })
  .strict();
export type MCPClientConfigEntry = z.infer<typeof MCPClientConfigEntryZodSchema>;

/**
 * The MCP-client config file shape — permissive at the root (other top-level
 * keys preserved) but strict inside `mcpServers` (each entry has
 * `{ command, args }`). The `corpus` key is the SP-007 install target;
 * other keys are operator- or other-server-managed and must be preserved.
 */
export const MCPClientConfigFileZodSchema = z
  .object({
    mcpServers: z
      .record(
        z.string(),
        z
          .object({
            command: z.string(),
            args: z.array(z.string()),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type MCPClientConfigFile = z.infer<typeof MCPClientConfigFileZodSchema>;

// ============================================================================
// Entity 5 — FirewallRuleSpec
// ============================================================================

export const FirewallRuleSpecZodSchema = z
  .object({
    os: InstallOsZodSchema,
    corpus_uid: z.number().int().nonnegative(),
    anchor_or_chain: z.string().min(1),
    rule_text: z.string(),
    provision_command: SubprocessSpecZodSchema,
    reverse_command: SubprocessSpecZodSchema,
  })
  .strict();
export type FirewallRuleSpec = z.infer<typeof FirewallRuleSpecZodSchema>;

// ============================================================================
// AutoStartUnitSpec (paired with FirewallRuleSpec inside the install-receipt)
// ============================================================================

export const AutoStartUnitSpecZodSchema = z
  .object({
    os: InstallOsZodSchema,
    unit_path: z.string().min(1),
    reverse_command: SubprocessSpecZodSchema,
  })
  .strict();
export type AutoStartUnitSpec = z.infer<typeof AutoStartUnitSpecZodSchema>;

// ============================================================================
// Entity 1 — InstallReceipt
// ============================================================================

const InstallReceiptBaseShape = {
  schema_version: z.literal(1),
  installed_at: ISO8601,
  installed_via: InstalledViaZodSchema,
  corpus_binary_path: z.string().min(1),
  created_paths: z.array(z.string().min(1)),
  mcp_client_configs: z.array(
    z
      .object({
        path: z.string().min(1),
        key_added: z.literal('mcpServers.corpus'),
      })
      .strict(),
  ),
  firewall_rules: z.array(FirewallRuleSpecZodSchema),
  auto_start_units: z.array(AutoStartUnitSpecZodSchema),
  seeded_taxonomy_terms: z.array(
    z
      .object({
        axis: TaxonomyAxisZodSchema,
        term: z.string().min(1),
        established_at: ISO8601,
      })
      .strict(),
  ),
  os: InstallOsZodSchema,
  os_version: z.string(),
  node_version: z.string(),
} as const;

/**
 * The canonical post-install receipt. Written atomically at install-step-10
 * via `withTempDir`; read at uninstall preflight; Zod-validated on both ends.
 * The strict() refinement rejects unknown root keys per data-model.md
 * invariants.
 */
export const InstallReceiptZodSchema = z.object(InstallReceiptBaseShape).strict();
export type InstallReceipt = z.infer<typeof InstallReceiptZodSchema>;

/**
 * The post-uninstall receipt shape (without `--purge`). The two optional
 * fields are set by `corpus uninstall` to preserve the side-effect history
 * for audit / future-install introspection.
 */
export const InstallReceiptUninstalledZodSchema = z
  .object({
    ...InstallReceiptBaseShape,
    uninstalled: z.boolean().optional(),
    uninstalled_at: ISO8601.optional(),
  })
  .strict();
export type InstallReceiptUninstalled = z.infer<
  typeof InstallReceiptUninstalledZodSchema
>;

// ============================================================================
// Entity 6 — TaxonomyPromoteArgs
// ============================================================================

/**
 * Parsed argv for `corpus taxonomy promote`. XOR refinement enforces
 * `(axis && terms) XOR from_proposed_with_count_ge` per ADR-014.
 *
 * - `--axis=<v> --term=<t1> --term=<t2>` → `{axis, terms: [t1, t2]}`
 * - `--from-proposed-with-count-ge=N`     → `{from_proposed_with_count_ge: N}`
 *
 * Both modes are mutually exclusive at the Zod boundary (Constitution V).
 */
export const TaxonomyPromoteArgsZodSchema = z
  .object({
    axis: TaxonomyAxisZodSchema.optional(),
    terms: z.array(z.string().min(1)).min(1).optional(),
    from_proposed_with_count_ge: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasAxisOrTerms =
      val.axis !== undefined || val.terms !== undefined;
    const hasThreshold = val.from_proposed_with_count_ge !== undefined;
    if (hasAxisOrTerms && hasThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          '--axis/--term and --from-proposed-with-count-ge are mutually exclusive',
      });
      return;
    }
    if (!hasAxisOrTerms && !hasThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'must provide either --axis/--term (one or more) or --from-proposed-with-count-ge=N',
      });
      return;
    }
    if (hasAxisOrTerms) {
      if (val.axis === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '--term provided without --axis',
        });
      }
      if (val.terms === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '--axis provided without at least one --term',
        });
      }
    }
  });
export type TaxonomyPromoteArgs = z.infer<typeof TaxonomyPromoteArgsZodSchema>;

// ============================================================================
// Entity 3 — InstallPreflightResult
// ============================================================================

export const InstallPreflightResultZodSchema = z
  .object({
    node_ok: z.boolean(),
    node_version: z.string(),
    ollama_ok: z.boolean(),
    ollama_models_pulled: z
      .object({
        classifier: z.boolean(),
        embedder: z.boolean(),
      })
      .strict(),
    xdg_writable: z.boolean(),
    partial_install_detected: z.boolean(),
    partial_install_paths: z.array(z.string()),
  })
  .strict();
export type InstallPreflightResult = z.infer<
  typeof InstallPreflightResultZodSchema
>;

// ============================================================================
// CLI arg schemas (built-in arg parsing — no commander / yargs / meow)
// ============================================================================

/**
 * `corpus init` argv shape. All flags optional; defaults baked into the
 * install-command.ts orchestrator. The `mcp-client-config` flag overrides
 * the `$CLAUDE_CONFIG_PATH` env var which overrides the `~/.claude.json`
 * default (precedence per data-model.md Entity 4).
 */
export const InstallCliArgsZodSchema = z
  .object({
    'mcp-client-config': z.string().optional(),
    'enable-autostart': z.boolean().optional(),
    'no-autostart': z.boolean().optional(),
    smoke: z.boolean().optional(),
    'force-autostart': z.boolean().optional(),
  })
  .strict();
export type InstallCliArgs = z.infer<typeof InstallCliArgsZodSchema>;

/** `corpus uninstall` argv shape. */
export const UninstallCliArgsZodSchema = z
  .object({
    purge: z.boolean().optional(),
  })
  .strict();
export type UninstallCliArgs = z.infer<typeof UninstallCliArgsZodSchema>;
