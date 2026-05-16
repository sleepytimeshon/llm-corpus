// SP-007 T060 — Verification-summary builder (uninstall step 7).
//
// References:
//   - specs/007-install-first-run/tasks.md T058 / T060
//   - specs/007-install-first-run/spec.md FR-INSTALL-016, SC-007-013/014/015
//
// Builds a paste-friendly diff block listing (a) created_paths with
// present/absent status; (b) MCP-client config files with `mcpServers.corpus`
// present/absent status; (c) firewall rules with the recorded reverse_command.
// NO ANSI colors; one section per category; intended for bug reports.

import * as fs from 'node:fs/promises';
import type {
  FirewallRuleSpec,
} from '@llm-corpus/contracts';

export interface VerificationSummaryInput {
  created_paths: readonly string[];
  mcp_client_configs: readonly { path: string }[];
  firewall_rules: readonly FirewallRuleSpec[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function corpusEntryPresent(configPath: string): Promise<boolean> {
  try {
    const body = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(body) as {
      mcpServers?: Record<string, unknown>;
    };
    return !!parsed.mcpServers && 'corpus' in parsed.mcpServers;
  } catch {
    return false;
  }
}

export async function buildVerificationSummary(
  input: VerificationSummaryInput,
): Promise<string> {
  const lines: string[] = [];
  lines.push('corpus uninstall — verification summary');
  lines.push('');

  lines.push('Filesystem diff:');
  if (input.created_paths.length === 0) {
    lines.push('  (no recorded created_paths)');
  } else {
    for (const p of input.created_paths) {
      const status = (await exists(p)) ? 'present' : 'absent';
      lines.push(`  ${p}: ${status}`);
    }
  }
  lines.push('');

  lines.push('MCP-client configs:');
  if (input.mcp_client_configs.length === 0) {
    lines.push('  (no recorded mcp_client_configs)');
  } else {
    for (const c of input.mcp_client_configs) {
      const present = await corpusEntryPresent(c.path);
      const status = present ? 'present' : 'absent';
      lines.push(`  ${c.path}: mcpServers.corpus ${status}`);
    }
  }
  lines.push('');

  lines.push('Firewall rules:');
  if (input.firewall_rules.length === 0) {
    lines.push('  (no recorded firewall_rules)');
  } else {
    for (const r of input.firewall_rules) {
      lines.push(
        `  ${r.os}:${r.anchor_or_chain} — reversed via ${r.reverse_command.cmd} ${r.reverse_command.args.join(' ')}`,
      );
    }
  }

  return lines.join('\n') + '\n';
}
