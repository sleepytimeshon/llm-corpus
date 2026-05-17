// SP-008 T030 — RED unit test for the `corpus accept --note` length cap.
//
// `corpus accept <req-id> --note "<exactly 512 chars>"` → recorded as
// `acceptance_note` on the event. `--note "<513 chars>"` → Zod-rejected
// at parse time (no silent truncation).
//
// References:
//   - specs/008-user-acceptance/tasks.md T030
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, SC-008-011,
//     SC-008-012
//   - Constitution Principles V, IX

import { describe, it, expect } from 'vitest';
import { parseAcceptArgs } from '../../packages/cli/src/engagement/accept-args-parser.js';

const validUuid = 'cafef00d-cafe-4f00-9dad-deadbeefdead';

describe('SP-008 T030 — --note length cap', () => {
  it('accepts a 512-char note as-is', () => {
    const note = 'a'.repeat(512);
    const parsed = parseAcceptArgs([validUuid, '--note', note]);
    expect(parsed.note!.length).toBe(512);
  });

  it('rejects a 513-char note at the Zod boundary (no silent truncation)', () => {
    const note = 'a'.repeat(513);
    expect(() => parseAcceptArgs([validUuid, '--note', note])).toThrow();
  });
});
