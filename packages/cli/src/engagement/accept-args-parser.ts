// SP-008 T025 — argv parser for `corpus accept <request-id> [--note <text>]`.
//
// Built-in arg parsing (no commander/yargs/meow per Engineer #1 handoff +
// existing SP-007 install-command convention). The parser computes the
// shape, then `AcceptArgsZodSchema` validates UUIDv4 + note length.
//
// References:
//   - specs/008-user-acceptance/tasks.md T025
//   - specs/008-user-acceptance/data-model.md Entity 6
//   - specs/008-user-acceptance/contracts/adr-acceptance-event-definition.md
//     (ADR-016)
//   - Constitution Principles V, XI (zero process.exit — library code)

import {
  AcceptArgsZodSchema,
  type AcceptArgs,
} from '@llm-corpus/contracts';

interface RawAcceptArgs {
  request_id?: string;
  note?: string;
}

function tokenize(argv: readonly string[]): RawAcceptArgs {
  const out: RawAcceptArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--note') {
      const next = argv[i + 1];
      if (next !== undefined) {
        out.note = next.trim();
        i += 1;
      } else {
        out.note = '';
      }
    } else if (a.startsWith('--note=')) {
      out.note = a.slice('--note='.length).trim();
    } else if (!a.startsWith('-') && out.request_id === undefined) {
      out.request_id = a;
    }
    // Unknown flags are ignored at the tokenize stage; Zod-strict will
    // surface them as schema errors if they leak into the parsed object.
  }
  return out;
}

/**
 * Parse `corpus accept` argv (the slice AFTER the `accept` verb) and
 * validate via `AcceptArgsZodSchema`. Throws on Zod failure. ZERO IO. ZERO
 * `process.exit` (Constitution XI — library boundary).
 */
export function parseAcceptArgs(argv: readonly string[]): AcceptArgs {
  const raw = tokenize(argv);
  const candidate: Record<string, unknown> = {
    request_id: raw.request_id,
  };
  if (raw.note !== undefined) {
    candidate.note = raw.note;
  }
  return AcceptArgsZodSchema.parse(candidate);
}
