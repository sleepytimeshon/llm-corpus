#!/usr/bin/env node
// T072 — SP-001 performance check.
//
// Measures two design-target latencies on the user's machine:
//   1. Cold-start MCP `tools/list` response — target < 200 ms (plan.md).
//   2. Egress hook overhead per intercepted call — target < 1 ms (plan.md).
//
// Per Constitution Principle XVI, these are TARGETS not guarantees. The
// script emits the measured numbers + a pass/miss indicator. Missing a
// target is investigation-warranted but not a P1 block.

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const TOOLS_LIST_TARGET_MS = 200;
const HOOK_OVERHEAD_TARGET_MS = 1;
const HOOK_ITERATIONS = 10000;

/**
 * Build a minimal stdio MCP client over an InMemoryTransport-equivalent —
 * for an integration-grade benchmark we spawn the real CLI binary, write a
 * single `initialize` followed by `tools/list` to its stdin, and read the
 * response from stdout. Cold-start latency is measured wall-clock from
 * spawn() to the `tools/list` response observed on stdout.
 */
async function measureColdStartToolsList() {
  const start = performance.now();
  const child = spawn(
    'node',
    ['packages/cli/dist/index.js', 'mcp'],
    { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let toolsListResolved = false;
  let toolsListMs = -1;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('cold-start tools/list exceeded 5s wall clock'));
    }, 5000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      // Look for the tools/list response (id:2)
      if (!toolsListResolved && stdout.includes('"id":2')) {
        toolsListMs = performance.now() - start;
        toolsListResolved = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        resolve(toolsListMs);
      }
    });

    child.on('error', reject);

    // Send initialize request
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'perf-check', version: '0.0.0' },
      },
    };
    const list = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };
    child.stdin.write(JSON.stringify(init) + '\n');
    child.stdin.write(JSON.stringify(list) + '\n');
  });
}

/**
 * Hook overhead: with the egress hook installed, measure the amortized cost
 * of a loopback dns.lookup call (passes-through, no throw). Per
 * contracts/egress-hook-api.md, loopback passes through with a single
 * `egress.attempted` emission. The hook overhead = (hooked - unhooked)/N.
 *
 * We import the bootstrap which installs the hook, then time N iterations.
 * Because we cannot easily compare "hooked vs unhooked" in the same process
 * (the hook is a singleton), we report the hooked-call median and treat
 * "median < target" as the success signal — the target is per-call wall
 * clock for a hooked call, not the additive overhead measured separately.
 */
async function measureHookOverhead() {
  // Use require/import dynamically so the import doesn't happen at module
  // load (which would side-effect installing the hook before measurement).
  await import(path.join(repoRoot, 'packages/transport/dist/egress-hook-bootstrap.js'));

  const dns = await import('node:dns');
  const lookup = (host) =>
    new Promise((resolve, reject) => {
      dns.lookup(host, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    });

  // Warm up
  for (let i = 0; i < 100; i++) {
    await lookup('localhost');
  }

  // Measure
  const samples = [];
  for (let i = 0; i < HOOK_ITERATIONS; i++) {
    const t0 = performance.now();
    await lookup('localhost');
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  return { median, p95 };
}

async function main() {
  console.log('SP-001 performance check (Constitution XVI: targets, not guarantees)');
  console.log('-'.repeat(72));

  console.log('\n[1] Cold-start MCP tools/list response');
  console.log(`    target: < ${TOOLS_LIST_TARGET_MS} ms`);
  try {
    const ms = await measureColdStartToolsList();
    const status = ms < TOOLS_LIST_TARGET_MS ? 'PASS' : 'MISS';
    console.log(`    measured: ${ms.toFixed(2)} ms — ${status}`);
  } catch (e) {
    console.log(`    measured: FAILED — ${e.message}`);
  }

  console.log('\n[2] Egress hook overhead (loopback dns.lookup, passes through)');
  console.log(`    target: median < ${HOOK_OVERHEAD_TARGET_MS} ms per intercepted call`);
  try {
    const { median, p95 } = await measureHookOverhead();
    const status = median < HOOK_OVERHEAD_TARGET_MS ? 'PASS' : 'MISS';
    console.log(`    measured: median=${median.toFixed(4)} ms, p95=${p95.toFixed(4)} ms — ${status}`);
  } catch (e) {
    console.log(`    measured: FAILED — ${e.message}`);
  }

  console.log('\n' + '-'.repeat(72));
  console.log('Per Constitution XVI, missing a target is investigation-warranted');
  console.log('but not a P1 block. Re-run after performance work.');
}

main().catch((e) => {
  console.error('perf-check failed:', e);
  process.exit(1);
});
