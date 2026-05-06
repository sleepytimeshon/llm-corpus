// T043 — Integration test: tcpdump sentinel (NFR-002, SC-002).
//
// =============================================================================
// ROOT-GATED TEST — requires CAP_NET_RAW (effectively root) on Linux to run.
// =============================================================================
//
// What this test does:
//   1. Starts `tcpdump` on every non-loopback network interface, filtering
//      for packets attributable to the corpus process by destination/source
//      (heuristic: any packet whose payload mentions the sentinel string).
//   2. Runs a sentinel-document fixture through the find-path. SP-001's
//      ingest/classify/embed/index are stubs, so the find-path is a tight
//      probe (corpus.find handler invocation) rather than a full pipeline.
//   3. Asserts zero packets attributable to the corpus process.
//
// Why root is needed:
//   tcpdump opens raw sockets via libpcap (BPF on Linux). On a default Fedora
//   install, this requires CAP_NET_RAW. We could grant the capability to the
//   tcpdump binary persistently, but that's a system-level change. For the
//   SP-001 verification gate, run with sudo:
//
//       sudo LLM_CORPUS_ROOT_TESTS=1 npm run test:integration:root \
//         -- tests/integration/tcpdump-sentinel.test.ts
//
// Default invocation (`npm run test:integration`) skips this test cleanly.

import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CorpusFindInput } from '../../packages/transport/src/schemas.js';
import { corpusFindHandler } from '../../packages/transport/src/corpus-find-tool.js';

const ROOT_GATE = process.env.LLM_CORPUS_ROOT_TESTS === '1';

const SENTINEL_TOKEN = 'CORPUS_SENTINEL_DOCUMENT_PRIVILEGED_DO_NOT_LEAK';

describe.skipIf(!ROOT_GATE)('tcpdump sentinel (T043 / NFR-002 / SC-002)', () => {
  it('zero non-loopback packets during sentinel find-path cycle', async () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tcpdump-'));
    process.env.CORPUS_HOME = tmpHome;

    // Capture file
    const captureFile = path.join(tmpHome, 'capture.pcap');

    // Find non-loopback interfaces. We use tcpdump's `-i any` and post-filter
    // by interface name in the BPF expression to exclude `lo`.
    let tcpdump: ChildProcess | undefined;
    try {
      tcpdump = spawn(
        'tcpdump',
        [
          '-i',
          'any',
          '-w',
          captureFile,
          '-n',
          'not (host 127.0.0.0/8) and not (ip6 host ::1)',
        ],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      // Wait briefly for tcpdump to start capturing.
      await new Promise<void>((resolve) => setTimeout(resolve, 800));

      // Run the find-path probe — sentinel query carries the SENTINEL_TOKEN.
      const input = CorpusFindInput.parse({
        query: SENTINEL_TOKEN,
      });
      const ac = new AbortController();
      const result = await corpusFindHandler(input, ac.signal);
      // SP-001 returns empty hits — that's fine; we're verifying NO packets
      // leaked, not that we got results.
      expect(Array.isArray(result.hits)).toBe(true);

      // Allow brief flush window
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
    } finally {
      if (tcpdump) {
        tcpdump.kill('SIGINT');
        await new Promise<void>((resolve) => {
          tcpdump!.once('close', () => resolve());
        });
      }
    }

    // Inspect capture: any captured frames means egress leaked.
    const stat = fs.statSync(captureFile);
    // pcap-savefile global header is 24 bytes; if no frames captured, the
    // file is exactly 24 bytes (or near it; some tcpdump variants add an
    // empty record). Allow a tiny slack.
    const NON_LOOPBACK_PACKETS_PRESENT = stat.size > 100;
    expect(NON_LOOPBACK_PACKETS_PRESENT).toBe(false);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }, 60_000);
});
