#!/usr/bin/env node
// SP-003 T066 — Vendored PDF extractor CLI shim.
//
// References: specs/003-ingest-pipeline/plan.md Decision F,
// Constitution Principle XII (subprocess hygiene — the pipeline never imports
// pdf-parse directly; it spawns this CLI via runTool).
//
// Spawn-with-args contract:
//   node tools/pdf-extractor/extract.mjs --in <pdf-path> --out <text-path>
//
// Behavior:
//   - Validates --in and --out args are present.
//   - Reads the input PDF and invokes pdf-parse.
//   - Writes the extracted text to <text-path> via atomic write
//     (tmp + fsync + rename).
//   - Prints success summary to stdout (one JSON line).
//   - Errors written to stderr as structured JSON.
//
// Exit codes:
//   0  — success
//   1  — usage error / missing required args
//   2  — input file missing or unreadable
//   3  — pdf-parse failure
//   4  — output write failure
//
// stderr format (structured for runTool parsing):
//   {"error_code": "<code>", "message": "<msg>"}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as process from 'node:process';
import { createRequire } from 'node:module';

// pdf-parse ships as CommonJS — load via require to avoid the package's
// debug-mode startup block (it conditionally reads ./test/data/05-versions...
// when require.main === module).
const require = createRequire(import.meta.url);

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
      // Unknown flag — ignore (allows --max-old-space-size etc. injected by
      // callers; pdf-parse itself takes no CLI args).
    }
  }
  return args;
}

function writeStderr(obj) {
  process.stderr.write(JSON.stringify(obj) + '\n');
}

async function atomicWrite(outPath, content) {
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  const suffix = `.tmp.${process.pid}.${crypto.randomBytes(2).toString('hex')}`;
  const tmpPath = outPath + suffix;
  const fh = await fs.open(tmpPath, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmpPath, outPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (!args.in || !args.out) {
    writeStderr({
      error_code: 'missing_args',
      message: 'Both --in and --out are required',
    });
    process.stderr.write(USAGE);
    process.exit(1);
  }

  let inputBuf;
  try {
    inputBuf = await fs.readFile(args.in);
  } catch (err) {
    writeStderr({
      error_code: 'input_not_found',
      message: `Input file not readable: ${args.in} (${err.message})`,
    });
    process.exit(2);
  }

  let pdfText;
  try {
    // pdf-parse exports its main parser as the default CommonJS export.
    // We load the inner module directly to bypass the package's debug-
    // startup block that fires when require.main === module.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const result = await pdfParse(inputBuf);
    pdfText = typeof result.text === 'string' ? result.text : '';
  } catch (err) {
    writeStderr({
      error_code: 'pdf_parse_failed',
      message: `pdf-parse error: ${err && err.message ? err.message : String(err)}`,
    });
    process.exit(3);
  }

  try {
    await atomicWrite(args.out, pdfText);
  } catch (err) {
    writeStderr({
      error_code: 'output_write_failed',
      message: `Cannot write output: ${err && err.message ? err.message : String(err)}`,
    });
    process.exit(4);
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      in: args.in,
      out: args.out,
      bytes_written: Buffer.byteLength(pdfText, 'utf8'),
    }) + '\n',
  );
  process.exit(0);
}

main().catch((err) => {
  writeStderr({
    error_code: 'unhandled',
    message: err && err.message ? err.message : String(err),
  });
  process.exit(1);
});
