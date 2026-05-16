// SP-007 T073 — `corpus failures list|show` CLI command.
//
// References:
//   - specs/007-install-first-run/tasks.md T070 / T071 / T072 / T073
//   - specs/007-install-first-run/spec.md NFR-006, SC-007-023, FR-INSTALL-019
//     corollary, FR-INSTALL-023
//   - specs/007-install-first-run/contracts/adr-install-uninstall-surface.md
//     (ADR-012)
//   - Constitution Principles III (Substrate, Not Surface — no new MCP
//     mutation surfaces; this is READ-ONLY by construction), V (Zod), VII
//     (no Promise.race(setTimeout)), XI (the dispatcher in index.ts is the
//     legitimate exit layer; this module returns exit codes, not exits), XIII
//     (best-effort telemetry).
//
// Operator-facing CLI surface. AI agents use corpus://failures (SP-006 MCP
// resource); humans use this CLI. The CLI reads `Paths.failed()` directly
// rather than spawning an MCP server for a read-only lookup. Read-only by
// construction — never writes; only `fs.readdir` + `fs.readFile`.

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
  Paths,
  FailureEntryZodSchema,
  FAILURE_STAGE_VALUES,
  type FailureEntry,
  type FailureStage,
} from '@llm-corpus/contracts';

const FAILURE_STAGE_SET: ReadonlySet<string> = new Set(FAILURE_STAGE_VALUES);

const SIDECAR_PRIMARY = /\.error\.json$/;
const SIDECAR_RECOVERY = /\.recovery\.error\.json$/;

// The on-disk sidecar shape does NOT include the `sidecar_path` field;
// the adapter/CLI adds that at read time so triagers can `rm <path>`.
const SidecarPayloadSchema = FailureEntryZodSchema.omit({ sidecar_path: true });

/* ---------------------------- list types ----------------------------- */

export interface FailuresListArgs {
  readonly stage?: FailureStage;
  readonly since?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly json?: boolean;
}

export interface FailuresListResponse {
  readonly entries: readonly FailureEntry[];
  readonly total_count: number;
  readonly returned_count: number;
}

/* ---------------------------- show types ----------------------------- */

export interface FailuresShowArgs {
  readonly doc_id: string;
}

export interface FailuresShowResponse {
  readonly entry: FailureEntry | null;
}

/* ----------------------------- helpers ------------------------------- */

interface SidecarFile {
  readonly filename: string;
  readonly absolutePath: string;
}

async function listSidecarFiles(
  failedDir: string,
  signal: AbortSignal,
): Promise<SidecarFile[]> {
  signal.throwIfAborted();
  let names: readonly string[];
  try {
    names = await fsp.readdir(failedDir);
  } catch (caught) {
    const e = caught as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw caught;
  }
  const out: SidecarFile[] = [];
  for (const n of names) {
    if (SIDECAR_RECOVERY.test(n) || SIDECAR_PRIMARY.test(n)) {
      out.push({ filename: n, absolutePath: path.join(failedDir, n) });
    }
  }
  return out;
}

async function parseSidecar(
  file: SidecarFile,
  signal: AbortSignal,
): Promise<FailureEntry | null> {
  signal.throwIfAborted();
  let raw: string;
  try {
    raw = await fsp.readFile(file.absolutePath, 'utf8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SidecarPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { ...parsed.data, sidecar_path: file.absolutePath };
}

function applyListFilters(
  entries: readonly FailureEntry[],
  args: FailuresListArgs,
): FailureEntry[] {
  let out: FailureEntry[] = entries.slice();
  if (args.stage !== undefined) {
    const wanted = args.stage;
    out = out.filter((e) => e.stage === wanted);
  }
  if (args.since !== undefined) {
    const sinceMs = Date.parse(args.since);
    out = out.filter((e) => Date.parse(e.timestamp) >= sinceMs);
  }
  return out;
}

function sortDescByTimestamp(entries: FailureEntry[]): FailureEntry[] {
  return entries.sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (tb !== ta) return tb - ta;
    return (a.doc_id ?? '').localeCompare(b.doc_id ?? '');
  });
}

/* ----------------------------- list ---------------------------------- */

/**
 * Read the failure-lane sidecars at `Paths.failed()` and return a paginated,
 * filtered, sorted listing. Read-only — never mutates state.
 */
export async function runFailuresList(
  args: FailuresListArgs,
  signal: AbortSignal,
): Promise<FailuresListResponse> {
  signal.throwIfAborted();
  const failedDir = Paths.failed();
  const files = await listSidecarFiles(failedDir, signal);
  const parsed = await Promise.all(
    files.map((file) => parseSidecar(file, signal)),
  );
  const entries: FailureEntry[] = parsed.filter(
    (e): e is FailureEntry => e !== null,
  );
  const filtered = applyListFilters(entries, args);
  const sorted = sortDescByTimestamp(filtered);
  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;
  const page = sorted.slice(offset, offset + limit);
  return {
    entries: page,
    total_count: filtered.length,
    returned_count: page.length,
  };
}

/* ----------------------------- show ---------------------------------- */

/**
 * Find a single sidecar by `doc_id`. Read-only — never mutates state.
 * Returns `entry: null` when no matching sidecar exists.
 */
export async function runFailuresShow(
  args: FailuresShowArgs,
  signal: AbortSignal,
): Promise<FailuresShowResponse> {
  signal.throwIfAborted();
  const failedDir = Paths.failed();
  const files = await listSidecarFiles(failedDir, signal);
  // Cheap pre-filter: filename starts with doc_id.
  const candidates = files.filter((f) => f.filename.startsWith(args.doc_id));
  for (const file of candidates) {
    const entry = await parseSidecar(file, signal);
    if (entry && entry.doc_id === args.doc_id) {
      return { entry };
    }
  }
  // Fallback: scan all sidecars (filenames may not include doc_id verbatim
  // for orphan-recovery sidecars). Bounded by O(N) over the failed-dir set,
  // which is at most a few thousand on a worst-case operator install.
  for (const file of files) {
    if (candidates.includes(file)) continue;
    const entry = await parseSidecar(file, signal);
    if (entry && entry.doc_id === args.doc_id) {
      return { entry };
    }
  }
  return { entry: null };
}

/* ----------------------------- dispatch ------------------------------ */

export interface RunFailuresCommandInput {
  readonly argv: readonly string[];
  readonly signal?: AbortSignal;
  readonly stdout?: (msg: string) => void;
  readonly stderr?: (msg: string) => void;
}

export interface RunFailuresCommandResult {
  readonly exit: number;
}

interface ParsedListArgs {
  readonly subcommand: 'list';
  readonly args: FailuresListArgs;
}
interface ParsedShowArgs {
  readonly subcommand: 'show';
  readonly args: FailuresShowArgs;
}
interface ParsedArgsError {
  readonly subcommand: 'error';
  readonly message: string;
}

function parseFailuresArgs(
  argv: readonly string[],
): ParsedListArgs | ParsedShowArgs | ParsedArgsError {
  const [sub, ...rest] = argv;
  if (sub === 'list') {
    return { subcommand: 'list', args: parseListFlags(rest) };
  }
  if (sub === 'show') {
    return parseShowFlags(rest);
  }
  return {
    subcommand: 'error',
    message: `corpus failures: unknown sub-action "${sub ?? ''}" (allowed: "list" | "show")`,
  };
}

function parseListFlags(rest: readonly string[]): FailuresListArgs {
  const out: {
    stage?: FailureStage;
    since?: string;
    limit?: number;
    offset?: number;
    json?: boolean;
  } = {};
  for (const tok of rest) {
    if (tok === '--json') {
      out.json = true;
      continue;
    }
    const eq = tok.indexOf('=');
    if (tok.startsWith('--stage=') && eq > 0) {
      const v = tok.slice(eq + 1);
      if (FAILURE_STAGE_SET.has(v)) out.stage = v as FailureStage;
      continue;
    }
    if (tok.startsWith('--since=') && eq > 0) {
      out.since = tok.slice(eq + 1);
      continue;
    }
    if (tok.startsWith('--limit=') && eq > 0) {
      const n = Number.parseInt(tok.slice(eq + 1), 10);
      if (Number.isFinite(n) && n > 0) out.limit = n;
      continue;
    }
    if (tok.startsWith('--offset=') && eq > 0) {
      const n = Number.parseInt(tok.slice(eq + 1), 10);
      if (Number.isFinite(n) && n >= 0) out.offset = n;
      continue;
    }
  }
  return out;
}

function parseShowFlags(rest: readonly string[]): ParsedShowArgs | ParsedArgsError {
  let docId: string | undefined;
  for (const tok of rest) {
    if (tok.startsWith('--doc-id=')) {
      docId = tok.slice('--doc-id='.length);
    } else if (!tok.startsWith('--') && docId === undefined) {
      docId = tok;
    }
  }
  if (!docId) {
    return {
      subcommand: 'error',
      message:
        'corpus failures show: missing doc-id (usage: corpus failures show <doc-id> | --doc-id=<id>)',
    };
  }
  return { subcommand: 'show', args: { doc_id: docId } };
}

function renderListHuman(res: FailuresListResponse): string {
  if (res.entries.length === 0) {
    return 'no failure-lane sidecars at this time\n';
  }
  const lines: string[] = [];
  lines.push(
    `${'timestamp'.padEnd(20)}  ${'stage'.padEnd(22)}  ${'error_code'.padEnd(28)}  doc_id`,
  );
  lines.push(
    `${'-'.repeat(20)}  ${'-'.repeat(22)}  ${'-'.repeat(28)}  ${'-'.repeat(14)}`,
  );
  for (const e of res.entries) {
    const ts = e.timestamp.slice(0, 19);
    const stage = e.stage.padEnd(22);
    const code = e.error_code.slice(0, 28).padEnd(28);
    lines.push(`${ts.padEnd(20)}  ${stage}  ${code}  ${e.doc_id ?? '(no doc-id)'}`);
  }
  lines.push('');
  lines.push(`showing ${res.returned_count} of ${res.total_count}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * CLI dispatch entry point — called from `packages/cli/src/index.ts`. Returns
 * a `RunFailuresCommandResult` carrying an `exit` code; the index.ts
 * dispatcher is the layer that actually calls `process.exit` (Constitution
 * XI).
 */
export async function runFailuresCommand(
  input: RunFailuresCommandInput,
): Promise<RunFailuresCommandResult> {
  const stdout = input.stdout ?? ((m) => process.stdout.write(m));
  const stderr = input.stderr ?? ((m) => process.stderr.write(m));
  const signal = input.signal ?? new AbortController().signal;

  const parsed = parseFailuresArgs(input.argv);
  if (parsed.subcommand === 'error') {
    stderr(`${parsed.message}\n`);
    return { exit: 2 };
  }

  try {
    if (parsed.subcommand === 'list') {
      const res = await runFailuresList(parsed.args, signal);
      if (parsed.args.json) {
        stdout(`${JSON.stringify(res, null, 2)}\n`);
      } else {
        stdout(renderListHuman(res));
      }
      return { exit: 0 };
    }
    // show
    const res = await runFailuresShow(parsed.args, signal);
    if (res.entry === null) {
      stderr(`no failure record for doc_id ${parsed.args.doc_id}\n`);
      return { exit: 1 };
    }
    stdout(`${JSON.stringify(res.entry, null, 2)}\n`);
    return { exit: 0 };
  } catch (cause) {
    const msg = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
    stderr(`corpus failures: ${msg}\n`);
    return { exit: 1 };
  }
}
