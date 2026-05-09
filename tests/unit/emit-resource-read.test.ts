// T018 — Unit test: emitResourceRead() typed wrapper from
// packages/transport/src/resource-telemetry.ts.
//
// References: contracts/telemetry-resource-events.md §"Emit helper",
// Constitution XIII (Telemetry-or-Die), IX (≤4096-byte serialization).
//
// Coverage:
//   - SEVERITY_MAP: success→info, document_not_found/index_locked/server_initializing→warn,
//     error→error
//   - Captures timestamp at emit (ISO-8601 UTC)
//   - Delegates to emitTelemetry; the appended JSONL line passes ResourceReadEvent.parse
//   - Per-event size ≤ TELEMETRY_MAX_BYTES

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  emitResourceRead,
  MCP_ERROR_CODES,
} from '../../packages/transport/src/resource-telemetry.js';
import {
  ResourceReadEvent,
  TELEMETRY_MAX_BYTES,
} from '../../packages/contracts/src/telemetry.js';

const VALID_UUID = '019099d4-78f0-7e61-a37c-8c2a9b5d2e10';
const VALID_DOC_ID = 'doc-ab12cd34';

function readTelemetryLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
}

describe('emitResourceRead() (T018, contracts/telemetry-resource-events.md)', () => {
  let tmpHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let telemetryFile: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-emit-resource-'));
    process.env.CORPUS_HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, 'state'), { recursive: true });
    telemetryFile = path.join(tmpHome, 'state', 'telemetry.jsonl');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('emits a success event with severity=info', async () => {
    await emitResourceRead({
      resource_uri: 'corpus://manifest',
      result: 'success',
      duration_ms: 12,
      request_id: VALID_UUID,
    });
    const lines = readTelemetryLines(telemetryFile);
    expect(lines.length).toBe(1);
    const parsed = ResourceReadEvent.safeParse(JSON.parse(lines[0]!));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.severity).toBe('info');
      expect(parsed.data.result).toBe('success');
      expect(parsed.data.resource_uri).toBe('corpus://manifest');
    }
  });

  it.each([
    ['success', 'info'],
    ['document_not_found', 'warn'],
    ['index_locked', 'warn'],
    ['server_initializing', 'warn'],
    ['error', 'error'],
  ] as const)('SEVERITY_MAP: %s → %s', async (result, expectedSeverity) => {
    await emitResourceRead({
      resource_uri: 'corpus://manifest',
      result,
      duration_ms: 1,
      request_id: VALID_UUID,
    });
    const lines = readTelemetryLines(telemetryFile);
    expect(lines.length).toBe(1);
    const parsed = ResourceReadEvent.parse(JSON.parse(lines[0]!));
    expect(parsed.severity).toBe(expectedSeverity);
  });

  it('captures timestamp at emit (ISO-8601 UTC, recent)', async () => {
    const before = Date.now();
    await emitResourceRead({
      resource_uri: 'corpus://taxonomy',
      result: 'success',
      duration_ms: 1,
      request_id: VALID_UUID,
    });
    const after = Date.now();
    const lines = readTelemetryLines(telemetryFile);
    const parsed = ResourceReadEvent.parse(JSON.parse(lines[0]!));
    const eventTimeMs = Date.parse(parsed.timestamp);
    expect(eventTimeMs).toBeGreaterThanOrEqual(before - 1000);
    expect(eventTimeMs).toBeLessThanOrEqual(after + 1000);
  });

  it('emitted event passes ResourceReadEvent.parse with all fields', async () => {
    await emitResourceRead({
      resource_uri: 'corpus://docs/*',
      doc_id: VALID_DOC_ID,
      result: 'success',
      duration_ms: 34,
      request_id: VALID_UUID,
    });
    const lines = readTelemetryLines(telemetryFile);
    const parsed = ResourceReadEvent.parse(JSON.parse(lines[0]!));
    expect(parsed.event).toBe('resource.read');
    expect(parsed.resource_uri).toBe('corpus://docs/*');
    expect(parsed.doc_id).toBe(VALID_DOC_ID);
    expect(parsed.duration_ms).toBe(34);
    expect(parsed.request_id).toBe(VALID_UUID);
  });

  it('per-event size is well under TELEMETRY_MAX_BYTES', async () => {
    await emitResourceRead({
      resource_uri: 'corpus://docs/*',
      doc_id: VALID_DOC_ID,
      result: 'error',
      duration_ms: 1234,
      request_id: VALID_UUID,
    });
    const lines = readTelemetryLines(telemetryFile);
    expect(lines[0]!.length).toBeLessThanOrEqual(TELEMETRY_MAX_BYTES);
    expect(lines[0]!.length).toBeLessThan(500); // ~230 bytes typical
  });
});

describe('MCP_ERROR_CODES (T018, T030 — canonical mapping)', () => {
  it('exports server_initializing = -32002', () => {
    expect(MCP_ERROR_CODES.server_initializing).toBe(-32002);
  });

  it('exports document_not_found = -32010', () => {
    expect(MCP_ERROR_CODES.document_not_found).toBe(-32010);
  });

  it('exports index_locked = -32011', () => {
    expect(MCP_ERROR_CODES.index_locked).toBe(-32011);
  });
});
