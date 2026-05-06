// T046 — Loopback classifier (NFR-002a).
// Source of truth: contracts/egress-hook-api.md §"Loopback classification"
//
// Pure functions — no IO, no side effects. The egress hook (T047) calls
// classifyHost() during interception to decide loopback (allow) vs remote (block).
//
// The IPv4/IPv6 loopback recognition predicates live in
// `@llm-corpus/contracts` so `runTool` (in contracts) and the egress hook
// (in transport) share a single source of truth. This file adds the
// transport-layer policy: the IPv4/IPv6 unspecified address family
// (`0.0.0.0`, `::`) is treated as loopback by `classifyHost` so internal
// Node bind machinery is not mis-classified as egress.

import { isLoopbackIPv4, isLoopbackIPv6 } from '@llm-corpus/contracts';

// Re-exported so existing transport-internal imports continue to work and
// so external consumers that imported from `@llm-corpus/transport` keep a
// stable surface.
export { isLoopbackIPv4, isLoopbackIPv6 };

/**
 * Unspecified (bind-any) addresses. These are never remote destinations —
 * Node uses them internally for default-bind operations (dgram, listen, etc.).
 * Treating them as loopback prevents internal Node machinery from being
 * mis-classified as egress attempts.
 */
function isUnspecified(ip: string): boolean {
  return ip === '0.0.0.0' || ip === '::' || ip === '0:0:0:0:0:0:0:0';
}

/**
 * Classify a destination as `loopback` or `remote`.
 *
 * Rules per contracts/egress-hook-api.md:
 *   - Direct IPv4 in 127/8 → loopback
 *   - Direct IPv6 ::1 (or long form) → loopback
 *   - Hostname literal 'localhost' → loopback
 *   - IPv4/IPv6 unspecified (0.0.0.0, ::) → loopback (internal bind machinery)
 *   - Everything else → remote (post-DNS check applied separately for hostnames)
 */
export function classifyHost(host: string, port: number): 'loopback' | 'remote' {
  void port; // reserved for future port-based policy hooks
  if (isLoopbackIPv4(host)) return 'loopback';
  if (isLoopbackIPv6(host)) return 'loopback';
  if (host === 'localhost') return 'loopback';
  if (isUnspecified(host)) return 'loopback';
  return 'remote';
}
