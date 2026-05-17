// SP-008 T022 — RED unit test for `corpus accept` argv parsing.
//
// Validates `AcceptArgsZodSchema` (positional <request-id> + optional --note)
// per FR-ENGAGEMENT-002 + Constitution V.
//
// References:
//   - specs/008-user-acceptance/tasks.md T022 / T025
//   - specs/008-user-acceptance/spec.md FR-ENGAGEMENT-002, SC-008-011,
//     SC-008-012
//   - specs/008-user-acceptance/contracts/adr-acceptance-event-definition.md
//     (ADR-016)
//   - Constitution Principle V

import { describe, it, expect } from 'vitest';
import { parseAcceptArgs } from '../../packages/cli/src/engagement/accept-args-parser.js';

describe('SP-008 T022 — corpus accept argv parsing', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('parses a bare positional request-id', () => {
    const args = parseAcceptArgs([validUuid]);
    expect(args.request_id).toBe(validUuid);
    expect(args.note).toBeUndefined();
  });

  it('parses positional + --note <text> (separate args)', () => {
    const args = parseAcceptArgs([validUuid, '--note', 'useful result']);
    expect(args.request_id).toBe(validUuid);
    expect(args.note).toBe('useful result');
  });

  it('parses positional + --note=<text> (joined form)', () => {
    const args = parseAcceptArgs([validUuid, '--note=useful result']);
    expect(args.note).toBe('useful result');
  });

  it('trims leading/trailing whitespace on --note', () => {
    const args = parseAcceptArgs([validUuid, '--note', '  trimmed  ']);
    expect(args.note).toBe('trimmed');
  });

  it('rejects oversize note (> 512 chars) at the Zod boundary', () => {
    const big = 'a'.repeat(513);
    expect(() => parseAcceptArgs([validUuid, '--note', big])).toThrow();
  });

  it('accepts exactly-512-char note', () => {
    const exactly = 'b'.repeat(512);
    const args = parseAcceptArgs([validUuid, '--note', exactly]);
    expect(args.note!.length).toBe(512);
  });

  it('rejects a missing positional', () => {
    expect(() => parseAcceptArgs([])).toThrow();
  });

  it('rejects a non-UUIDv4 positional', () => {
    expect(() => parseAcceptArgs(['not-a-uuid'])).toThrow();
    expect(() => parseAcceptArgs(['00000000-0000-0000-0000-000000000000'])).toThrow();
  });

  it('multiple --note flags: last wins', () => {
    const args = parseAcceptArgs([validUuid, '--note', 'first', '--note', 'second']);
    expect(args.note).toBe('second');
  });
});
