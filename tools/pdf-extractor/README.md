# pdf-extractor

Vendored CLI shim for SP-003 PDF text extraction. Wraps `pdf-parse` behind a
process boundary so the main pipeline never imports `pdf-parse` directly
(Constitution Principle XII — subprocess hygiene).

## Why a CLI shim instead of an in-process import?

1. **Constitution XII**: subprocess hygiene. All subprocess invocations route
   through `runTool` with explicit args; no `child_process.exec` / no shell
   string-formation. Wrapping pdf-parse in a separate process means the main
   pipeline's egress hook surface is preserved cleanly.
2. **Memory isolation**: pdf-parse parses untrusted PDF bytes; malformed
   input can OOM. The subprocess is invoked with `--max-old-space-size=512`
   so a malformed PDF tanks the child, not the daemon (plan.md R2).
3. **Security**: a future minor-version bump of pdf-parse that adds new code
   paths is sandboxed to this subprocess; the egress hook's OS-firewall
   fallback layer catches accidental network access at the kernel boundary
   (plan.md R8).

## Why this is out-of-workspaces

The shim has its own `package.json` and is NOT a workspace member of the
top-level `llm-corpus` monorepo. Reasons:

- It is invoked exclusively as a subprocess via `runTool('node',
  ['tools/pdf-extractor/extract.mjs', '--in', ..., '--out', ...])`.
- Its `pdf-parse` dependency must NOT be hoisted into the monorepo
  `node_modules`/dependency graph (it should never appear as a transitive
  dep of the main process's import resolution).
- Pinned exactly (`"pdf-parse": "1.1.1"` — no `^` range) to make CI guards
  trivial.

## Invocation contract

```
node tools/pdf-extractor/extract.mjs --in <pdf-path> --out <text-path>
```

- `--in`: absolute path to a `.pdf` file
- `--out`: absolute path where extracted text will be written (atomic
  `fs.writeFile` + rename — Constitution VIII)
- `--help`: print usage and exit 0

Exit codes:
- 0 success (text written to `--out`)
- 1 usage error / missing required arg
- 2 input file missing or unreadable
- 3 pdf-parse failure

Errors go to `stderr` as a single JSON line of shape:
```json
{"error_code": "<enum>", "message": "<one-line>"}
```

The shim is currently a Phase 1 scaffold — `pdf-parse` integration lands in
Phase 3 (T066). See `specs/003-ingest-pipeline/tasks.md` for the full plan.

## Installation

This directory's `node_modules` is installed by the top-level postinstall:
```
cd tools/pdf-extractor && npm install
```

The shim is then invokable from the repo root via:
```
node tools/pdf-extractor/extract.mjs --help
```
