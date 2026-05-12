#!/usr/bin/env node
// T035 — `corpus` binary dispatcher.
//
// SP-001 supports a single subcommand: `corpus mcp` — start the MCP server.
// All other subcommands (ingest, search, etc.) are SP-003+ scope.
//
// Reference: contracts/mcp-corpus-find.md, plan.md "CLI surface".
//
// Constitution XI: this is the CLI boundary, where Result types are unwrapped
// into `process.exit` codes. Library packages MUST NOT call process.exit.

import { startMcpServer } from '@llm-corpus/transport';
import { runPilotCommand } from './pilot/command.js';

interface ParsedArgs {
  subcommand: string | undefined;
  rest: readonly string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path; subcommand is argv[2].
  const [, , sub, ...rest] = argv;
  return { subcommand: sub, rest };
}

function printUsage(): void {
  process.stdout.write(
    [
      'corpus — local-only knowledge substrate',
      '',
      'Usage: corpus <subcommand>',
      '',
      'Subcommands:',
      '  mcp        Start the MCP server on stdio',
      '  pilot      NFR-008 reduced-scope pilot harness (SP-000-Lite)',
      '  --help     Print this message',
      '',
      'SP-001 ships only the `mcp` subcommand. Ingest/search land in SP-003+.',
      '',
    ].join('\n'),
  );
}

async function runMcp(): Promise<number> {
  // startMcpServer() connects to stdio and returns once connected. We then
  // wait on a never-resolving promise so the process stays alive until the
  // transport closes (the MCP SDK closes the process when stdin EOFs).
  const built = await startMcpServer();
  // Keep the process alive until the underlying server closes.
  await new Promise<void>((resolve) => {
    const underlying = built.server.server;
    const originalClose = underlying.onclose;
    underlying.onclose = (): void => {
      try {
        originalClose?.();
      } finally {
        resolve();
      }
    };
  });
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const { subcommand, rest } = parseArgs(argv);

  switch (subcommand) {
    case 'mcp':
      return runMcp();
    case 'pilot':
      return runPilotCommand(rest);
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      printUsage();
      return 0;
    default:
      process.stderr.write(`corpus: unknown subcommand "${subcommand}"\n\n`);
      printUsage();
      return 2;
  }
}

main(process.argv).then(
  (code) => {
    // CLI boundary — process.exit is the legitimate way to surface code.
    process.exit(code);
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`corpus: fatal: ${msg}\n`);
    process.exit(1);
  },
);
