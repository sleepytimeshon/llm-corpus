// T047 — Runtime egress hook (NFR-002a, ADR-001).
// Source of truth: contracts/egress-hook-api.md
//
// Patches six outbound network primitives at module-load time. Each patched
// method:
//   1. Emits an `egress.attempted` telemetry event.
//   2. Classifies destination via the loopback-classifier.
//   3. If remote: emits `egress.blocked`, throws EgressBlockedError synchronously
//      (or async-rejects through the natural error channel for promise primitives).
//   4. If loopback: proceeds to original implementation.
//
// Singleton install — second call throws EgressHookAlreadyInstalledError.
// The returned Disposable allows tests to restore originals via `using` or
// explicit dispose. Production never disposes.

import * as net from 'node:net';
import * as dgram from 'node:dgram';
import { Agent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// Type-only imports keep the TypeScript namespace bindings available even
// though the runtime uses CJS-loaded copies (see comment below).
import type * as DnsT from 'node:dns';
import type * as Http2T from 'node:http2';
import type * as TlsT from 'node:tls';

// IMPORTANT: dns/http2/tls are loaded via CJS require so we get a *mutable*
// module.exports object. ESM `import * as dns` returns a read-only namespace
// where properties are non-configurable, making monkey-patching impossible.
// CJS-loaded versions are the same singletons as the ESM exports — Node
// caches both views — but only the CJS shape is writable.
const cjsRequire = createRequire(import.meta.url);
const dns = cjsRequire('node:dns') as typeof DnsT;
const http2 = cjsRequire('node:http2') as typeof Http2T;
const tls = cjsRequire('node:tls') as typeof TlsT;

import {
  EgressBlockedError,
  EgressHookAlreadyInstalledError,
} from '@llm-corpus/contracts/errors';
import {
  emitTelemetrySync,
  type PrimitiveType,
} from '@llm-corpus/contracts/telemetry';
import { classifyHost } from './loopback-classifier.js';

export type Primitive = PrimitiveType;

export interface AttemptContext {
  primitive: Primitive;
  host: string;
  port: number;
  classification: 'loopback' | 'remote';
  request_id: string;
}

export interface HookOptions {
  /** Per-call observer for tests. */
  onAttempt?: (attempt: AttemptContext) => void;
  /** Override the classifier in tests. */
  classifyDestination?: (host: string, port: number) => 'loopback' | 'remote';
}

/** Module-level singleton state. */
let installed = false;
let activeOptions: HookOptions | undefined;

/** Originals captured at install time, restored by Disposable.dispose(). */
interface Originals {
  netSocketConnect: typeof net.Socket.prototype.connect;
  dgramSocketSend: typeof dgram.Socket.prototype.send;
  dnsLookup: typeof dns.lookup;
  http2Connect: typeof Http2T.connect;
  tlsConnect: typeof TlsT.connect;
  undiciDispatcher: Dispatcher;
}

let originals: Originals | undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function emitAttempted(
  primitive: Primitive,
  host: string,
  port: number,
  request_id: string,
): void {
  try {
    emitTelemetrySync({
      event: 'egress.attempted',
      timestamp: nowIso(),
      primitive,
      destination_host: host,
      destination_port: port,
      request_id,
    });
  } catch {
    // Telemetry must never crash the hook. Swallow errors quietly.
  }
}

function emitBlocked(
  primitive: Primitive,
  host: string,
  port: number,
  request_id: string,
): void {
  try {
    emitTelemetrySync({
      event: 'egress.blocked',
      timestamp: nowIso(),
      primitive,
      destination_host: host,
      destination_port: port,
      result: 'blocked',
      blocked_at: 'in_process_hook',
      request_id,
    });
  } catch {
    /* telemetry must never crash hook */
  }
}

function classify(host: string, port: number): 'loopback' | 'remote' {
  if (activeOptions?.classifyDestination) {
    return activeOptions.classifyDestination(host, port);
  }
  return classifyHost(host, port);
}

/**
 * Replace a property on a module-namespace object, falling back across the
 * configurations Node module bindings expose. The dns/http2/tls module
 * exports are non-configurable in some Node versions; defineProperty fails.
 * Direct assignment also fails because the binding is read-only. As a last
 * resort we silently skip — other primitives still cover the egress surface.
 */
function safeReplaceMember<T extends object>(
  obj: T,
  key: keyof T & string,
  newValue: unknown,
): boolean {
  try {
    Object.defineProperty(obj, key, {
      value: newValue,
      configurable: true,
      writable: true,
    });
    return true;
  } catch {
    /* fall through */
  }
  try {
    (obj as unknown as Record<string, unknown>)[key] = newValue;
    return true;
  } catch {
    return false;
  }
}

function notifyAttempt(ctx: AttemptContext): void {
  if (activeOptions?.onAttempt) {
    try {
      activeOptions.onAttempt(ctx);
    } catch {
      /* observer errors must not crash the hook */
    }
  }
}

/**
 * Install the egress hook. MUST be called from the entry-point bootstrap
 * BEFORE any pipeline package import. Idempotent within a process via the
 * EgressHookAlreadyInstalledError defensive throw.
 */
export function installEgressHook(opts?: HookOptions): { [Symbol.dispose](): void } {
  if (installed) {
    throw new EgressHookAlreadyInstalledError();
  }
  // Capture originals BEFORE any side-effecting work — if patching throws, we
  // can fully unwind and leave the module in a re-installable state.
  const captured: Originals = {
    netSocketConnect: net.Socket.prototype.connect,
    dgramSocketSend: dgram.Socket.prototype.send,
    dnsLookup: dns.lookup,
    http2Connect: http2.connect,
    tlsConnect: tls.connect,
    undiciDispatcher: getGlobalDispatcher(),
  };
  // Set live state ONLY when we're committed to applying patches.
  installed = true;
  activeOptions = opts;
  originals = captured;

  try {
    patchNetSocketConnect();
    patchDgramSend();
    patchDnsLookup();
    patchHttp2Connect();
    patchTlsConnect();
    patchUndiciDispatcher();
  } catch (e) {
    // Unwind on failure: restore originals and clear singleton flags.
    restoreOriginals();
    installed = false;
    activeOptions = undefined;
    originals = undefined;
    throw e;
  }

  // Stderr banner so bootstrap-order tests can sequence-check the install
  // relative to pipeline imports (T040).
  if (process.env.LLM_CORPUS_BOOTSTRAP_PROBE === '1') {
    process.stderr.write('EGRESS_HOOK_INSTALLED\n');
  }

  return {
    [Symbol.dispose](): void {
      restoreOriginals();
      installed = false;
      activeOptions = undefined;
      originals = undefined;
    },
  };
}

function restoreOriginals(): void {
  if (!originals) return;
  net.Socket.prototype.connect = originals.netSocketConnect;
  dgram.Socket.prototype.send = originals.dgramSocketSend;
  // Best-effort: dns.lookup cannot be reassigned to the namespace export
  // (read-only); the patched function checks the `installed` flag and
  // delegates to the original when uninstalled.
  // http2.connect / tls.connect: same — patched fn checks `installed`.
  setGlobalDispatcher(originals.undiciDispatcher);
}

/* --- net.Socket.connect patch ------------------------------------------- */

function patchNetSocketConnect(): void {
  if (!originals) return;
  const orig = originals.netSocketConnect;
  net.Socket.prototype.connect = function patchedConnect(
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    if (!installed) {
      // safety — passthrough after dispose
      return (orig as (...a: unknown[]) => net.Socket).apply(this, args);
    }
    const { host, port } = parseConnectArgs(args);
    const request_id = randomUUID();
    emitAttempted('net.Socket.connect', host, port, request_id);
    const classification = classify(host, port);
    notifyAttempt({
      primitive: 'net.Socket.connect',
      host,
      port,
      classification,
      request_id,
    });
    if (classification === 'remote') {
      emitBlocked('net.Socket.connect', host, port, request_id);
      const err = new EgressBlockedError('net.Socket.connect', host, port, request_id);
      // net.Socket.connect contract: surface the error via the 'error' event.
      // Use setImmediate (not queueMicrotask) so listeners attached after the
      // synchronous .connect(...) call still see it. We do NOT call destroy()
      // because callers commonly rely on the 'error' handler to clean up; an
      // extra destroy() risks re-entrancy and double-emission.
      setImmediate(() => {
        if (!this.destroyed && this.listenerCount('error') > 0) {
          this.emit('error', err);
        } else if (!this.destroyed) {
          // No listener — emit will throw; destroy with the error so it gets
          // surfaced through the close event instead.
          this.destroy(err);
        }
      });
      return this;
    }
    return (orig as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

interface ConnectOpts {
  host?: string;
  port?: number;
  path?: string;
}

function parseConnectArgs(args: unknown[]): { host: string; port: number } {
  // Forms:
  //   connect(port[, host][, listener])
  //   connect(path[, listener])
  //   connect(options[, listener])
  if (args.length === 0) return { host: '127.0.0.1', port: 0 };
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as ConnectOpts;
    return {
      host: typeof o.host === 'string' ? o.host : '127.0.0.1',
      port: typeof o.port === 'number' ? o.port : 0,
    };
  }
  if (typeof first === 'number') {
    const port = first;
    const second = args[1];
    const host = typeof second === 'string' ? second : '127.0.0.1';
    return { host, port };
  }
  if (typeof first === 'string') {
    // path form (Unix domain socket) — treat as loopback
    return { host: '127.0.0.1', port: 0 };
  }
  return { host: '127.0.0.1', port: 0 };
}

/* --- dgram.Socket.prototype.send ---------------------------------------- */

function patchDgramSend(): void {
  if (!originals) return;
  const orig = originals.dgramSocketSend;
  dgram.Socket.prototype.send = function patchedSend(
    this: dgram.Socket,
    ...args: unknown[]
  ) {
    if (!installed) {
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    }
    const { host, port } = parseDgramArgs(args);
    const request_id = randomUUID();
    emitAttempted('dgram.send', host, port, request_id);
    const classification = classify(host, port);
    notifyAttempt({
      primitive: 'dgram.send',
      host,
      port,
      classification,
      request_id,
    });
    if (classification === 'remote') {
      emitBlocked('dgram.send', host, port, request_id);
      const err = new EgressBlockedError('dgram.send', host, port, request_id);
      // dgram.send accepts a callback as the LAST arg. Surface the error there.
      const cb = args.find((a): a is (e: Error | null) => void => typeof a === 'function');
      if (cb) {
        queueMicrotask(() => cb(err));
        return undefined;
      }
      throw err;
    }
    return (orig as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof dgram.Socket.prototype.send;
}

function parseDgramArgs(args: unknown[]): { host: string; port: number } {
  // Forms (per Node docs):
  //   send(msg, [offset, length,] port[, address][, callback])
  // address (host) is the first STRING after the port arg, OR may be omitted.
  // We scan for the port (first number after arg[0]) then the host (next string).
  let port = 0;
  let host = '127.0.0.1';
  let foundPort = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!foundPort && typeof a === 'number') {
      // Could be offset/length OR port. Heuristic: port range 0..65535 AND not directly preceded by another number-and-zero pattern.
      // Simpler: take the LAST number arg before any string/function as the port.
      port = a;
      foundPort = true;
      continue;
    }
    if (foundPort && typeof a === 'string') {
      host = a;
      break;
    }
  }
  // Better heuristic: scan from the end for (number, string?) pattern.
  // Walk from end: skip callback if function, then string is host, then number is port.
  let endIdx = args.length - 1;
  if (typeof args[endIdx] === 'function') endIdx--;
  let endHost: string | undefined;
  if (endIdx >= 0 && typeof args[endIdx] === 'string') {
    endHost = args[endIdx] as string;
    endIdx--;
  }
  if (endIdx >= 0 && typeof args[endIdx] === 'number') {
    port = args[endIdx] as number;
  }
  if (endHost !== undefined) host = endHost;
  return { host, port };
}

/* --- dns.lookup --------------------------------------------------------- */

function patchDnsLookup(): void {
  if (!originals) return;
  const orig = originals.dnsLookup as typeof dns.lookup;

  const patched = function patchedLookup(
    hostname: string,
    optionsOrCb: unknown,
    maybeCb?: unknown,
  ): void {
    if (!installed) {
      // Cast through unknown — Node's overload set is too rich to type fully here.
      return (orig as unknown as (...a: unknown[]) => void)(hostname, optionsOrCb, maybeCb);
    }
    const request_id = randomUUID();
    emitAttempted('dns.lookup', hostname, 0, request_id);
    const initialClass = classify(hostname, 0);
    notifyAttempt({
      primitive: 'dns.lookup',
      host: hostname,
      port: 0,
      classification: initialClass,
      request_id,
    });
    // If the hostname is already a known loopback literal ('localhost',
    // 127.x.x.x, ::1), skip the post-resolution gate — the contract treats
    // these as loopback by definition (see contracts/egress-hook-api.md
    // §"Trusted loopback hostnames").
    if (initialClass === 'loopback') {
      return (orig as unknown as (...a: unknown[]) => void)(hostname, optionsOrCb, maybeCb);
    }
    // Allow the lookup itself to proceed (DNS for 'localhost' is allowed).
    // Wrap the user callback to enforce the post-resolution check.
    const callback =
      typeof optionsOrCb === 'function' ? (optionsOrCb as (...a: unknown[]) => void)
      : typeof maybeCb === 'function' ? (maybeCb as (...a: unknown[]) => void)
      : undefined;
    if (!callback) {
      // No callback variant (returns Promise via util.promisify) — skip post-check.
      return (orig as unknown as (...a: unknown[]) => void)(hostname, optionsOrCb, maybeCb);
    }
    const wrappedCb = (err: Error | null, address: unknown, family?: unknown): void => {
      if (err) {
        callback(err);
        return;
      }
      // address is a string (single) or array of {address,family} objects (all option).
      const addrStr =
        typeof address === 'string'
          ? address
          : Array.isArray(address) && address[0]
            ? (address[0] as { address: string }).address
            : '';
      // Skip the post-resolution check if no resolved address (e.g., empty
      // string from a hint=ADDRCONFIG miss) — treat as loopback equivalent so
      // we don't synthesize a fake EgressBlockedError with destination_host=''.
      if (!addrStr) {
        callback(null, address, family);
        return;
      }
      const postClass = classifyHost(addrStr, 0);
      if (postClass === 'remote') {
        const blockErr = new EgressBlockedError(
          'dns.lookup',
          hostname,
          0,
          request_id,
        );
        emitBlocked('dns.lookup', hostname, 0, request_id);
        callback(blockErr);
        return;
      }
      callback(null, address, family);
    };
    if (typeof optionsOrCb === 'function') {
      return (orig as unknown as (...a: unknown[]) => void)(hostname, wrappedCb);
    }
    return (orig as unknown as (...a: unknown[]) => void)(hostname, optionsOrCb, wrappedCb);
  };
  // CJS-loaded dns module has writable, configurable bindings.
  safeReplaceMember(dns, 'lookup', patched);
}

/* --- http2.connect ------------------------------------------------------- */

function patchHttp2Connect(): void {
  if (!originals) return;
  const orig = originals.http2Connect;
  const patched = function patchedHttp2Connect(
    authority: string | URL,
    ...rest: unknown[]
  ): Http2T.ClientHttp2Session {
    if (!installed) {
      return (orig as (...a: unknown[]) => Http2T.ClientHttp2Session)(authority, ...rest);
    }
    const url =
      typeof authority === 'string'
        ? new URL(authority)
        : authority instanceof URL
          ? authority
          : new URL(String(authority));
    const host = url.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const request_id = randomUUID();
    emitAttempted('http2.connect', host, port, request_id);
    const classification = classify(host, port);
    notifyAttempt({
      primitive: 'http2.connect',
      host,
      port,
      classification,
      request_id,
    });
    if (classification === 'remote') {
      emitBlocked('http2.connect', host, port, request_id);
      throw new EgressBlockedError('http2.connect', host, port, request_id);
    }
    return (orig as (...a: unknown[]) => Http2T.ClientHttp2Session)(authority, ...rest);
  };
  safeReplaceMember(http2, 'connect', patched);
}

/* --- tls.connect --------------------------------------------------------- */

function patchTlsConnect(): void {
  if (!originals) return;
  const orig = originals.tlsConnect;
  const patched = function patchedTlsConnect(...args: unknown[]): TlsT.TLSSocket {
    if (!installed) {
      return (orig as (...a: unknown[]) => TlsT.TLSSocket)(...args);
    }
    const { host, port } = parseTlsArgs(args);
    const request_id = randomUUID();
    emitAttempted('tls.connect', host, port, request_id);
    const classification = classify(host, port);
    notifyAttempt({
      primitive: 'tls.connect',
      host,
      port,
      classification,
      request_id,
    });
    if (classification === 'remote') {
      emitBlocked('tls.connect', host, port, request_id);
      throw new EgressBlockedError('tls.connect', host, port, request_id);
    }
    return (orig as (...a: unknown[]) => TlsT.TLSSocket)(...args);
  };
  safeReplaceMember(tls, 'connect', patched);
}

interface TlsOpts {
  host?: string;
  servername?: string;
  port?: number;
}

function parseTlsArgs(args: unknown[]): { host: string; port: number } {
  if (args.length === 0) return { host: '127.0.0.1', port: 443 };
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as TlsOpts;
    return {
      host: o.host ?? o.servername ?? '127.0.0.1',
      port: typeof o.port === 'number' ? o.port : 443,
    };
  }
  if (typeof first === 'number') {
    const port = first;
    const second = args[1];
    const host = typeof second === 'string' ? second : '127.0.0.1';
    return { host, port };
  }
  return { host: '127.0.0.1', port: 443 };
}

/* --- undici Dispatcher --------------------------------------------------- */

function patchUndiciDispatcher(): void {
  // Strategy: install a global Agent subclass that intercepts dispatch().
  class GuardedAgent extends Agent {
    override dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
      if (!installed) {
        return super.dispatch(opts, handler);
      }
      // Resolve host/port from opts.origin or opts.path
      let host = '127.0.0.1';
      let port = 0;
      try {
        const originSource =
          (opts.origin as string | URL | undefined) ??
          ((opts as unknown as { url?: string | URL }).url);
        if (originSource) {
          const url = typeof originSource === 'string' ? new URL(originSource) : originSource;
          host = url.hostname;
          port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
        }
      } catch {
        /* best-effort parse */
      }
      const request_id = randomUUID();
      emitAttempted('undici.Dispatcher', host, port, request_id);
      const classification = classify(host, port);
      notifyAttempt({
        primitive: 'undici.Dispatcher',
        host,
        port,
        classification,
        request_id,
      });
      if (classification === 'remote') {
        emitBlocked('undici.Dispatcher', host, port, request_id);
        const err = new EgressBlockedError('undici.Dispatcher', host, port, request_id);
        // Surface to handler
        if (typeof handler.onError === 'function') {
          handler.onError(err);
        }
        return false;
      }
      return super.dispatch(opts, handler);
    }
  }
  setGlobalDispatcher(new GuardedAgent());
}
