// Loopback predicates — canonical, dependency-free.
//
// These predicates live in `@llm-corpus/contracts` so both `transport`
// (the egress hook + classifyHost) and `contracts` (the runTool OS-firewall
// detection) can share a single source of truth without creating a
// dependency cycle. `contracts` MUST NOT depend on `transport` per the
// dependency-direction rule.
//
// The transport classifier wraps these predicates with additional carve-outs
// (e.g., the IPv4/IPv6 unspecified address family `0.0.0.0` / `::` is treated
// as loopback by `classifyHost` to avoid mis-classifying internal Node bind
// machinery). Those carve-outs are transport-layer policy, not loopback
// recognition itself, and stay in `transport/loopback-classifier.ts`.

/**
 * IPv4 loopback predicate — accepts the entire 127.0.0.0/8 block.
 * Strict format: 4 dotted octets, each 0–255 enforced by digit count + parse.
 */
export function isLoopbackIPv4(ip: string): boolean {
  if (!/^127\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * IPv6 loopback predicate — accepts both `::1` and `0:0:0:0:0:0:0:1`.
 */
export function isLoopbackIPv6(ip: string): boolean {
  return ip === '::1' || ip === '0:0:0:0:0:0:0:1';
}

/**
 * Generic loopback host predicate — IPv4 127/8, IPv6 ::1, or the literal
 * hostname `localhost`. Does NOT include unspecified addresses (0.0.0.0, ::);
 * those are bind-side concerns handled by `transport/loopback-classifier.ts`.
 */
export function isLoopbackHost(host: string): boolean {
  if (isLoopbackIPv4(host)) return true;
  if (isLoopbackIPv6(host)) return true;
  if (host === 'localhost') return true;
  return false;
}
