#!/usr/bin/env node
// SP-003 Phase 1 (T016) — Vendored PDF extractor CLI shim.
//
// References: specs/003-ingest-pipeline/plan.md Decision F,
// Constitution Principle XII (subprocess hygiene — the pipeline never
// imports pdf-parse directly; it spawns this CLI via runTool).
//
// Spawn-with-args contract:
//   node tools/pdf-extractor/extract.mjs --in <pdf-path> --out <text-path>
//
// Behavior (this Phase 1 scaffold):
//   - Validates --in and --out args are present.
//   - Reads the input file path.
//   - In Phase 3 (T066) this file is filled in to actually run pdf-parse
//     and write extracted text via atomic fs.writeFile + rename.
//   - For now it prints a usage banner and exits non-zero unless --help.
//
// Exit codes:
//   0  — success (Phase 3 will produce extracted text)
//   1  — usage error / missing required args
//   2  — input file missing or unreadable
//   3  — pdf-parse failure (Phase 3)
//
// stderr format (structured for runTool parsing):
//   {"error_code": "<code>", "message": "<msg>"}

import * as fs from 'node:fs/promises';
import * as process from 'node:process';

const USAGE = `pdf-extractor: SP-003 vendored PDF→text CLI shim
Usage:
  node tools/pdf-extractor/extract.mjs --in <pdf-path> --out <text-path>
Options:
  --in <path>       Input PDF file path (absolute)
  --out <path>      Output text file path (absolute)
  --help            Show this help and exit 0
`;

function parseArgs(argv) {
  const args = { in: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--in') args.in = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--')) {
      // Unknown flag — ignore in scaffold (Phase 3 may add more).
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (!args.in || !args.out) {
    process.stderr.write(
      JSON.stringify({
        error_code: 'missing_args',
        message: 'Both --in and --out are required',
      }) + '\n',
    );
    process.stderr.write(USAGE);
    process.exit(1);
  }
  // Phase 1 scaffold: verify input exists, then exit indicating "not yet
  // implemented". Phase 3 (T066) replaces this with the actual pdf-parse
  // invocation.
  try {
    await fs.access(args.in);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        error_code: 'input_not_found',
        message: `Input file not readable: ${args.in} (${err.message})`,
      }) + '\n',
    );
    process.exit(2);
  }
  process.stderr.write(
    JSON.stringify({
      error_code: 'not_implemented',
      message:
        'Phase 1 scaffold — pdf-parse integration lands in Phase 3 (T066). ' +
        `args=${JSON.stringify({ in: args.in, out: args.out })}`,
    }) + '\n',
  );
  process.exit(3);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      error_code: 'unhandled',
      message: err && err.message ? err.message : String(err),
    }) + '\n',
  );
  process.exit(1);
});
