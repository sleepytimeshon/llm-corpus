// T049 — Worker bootstrap shim (NFR-002a).
// Source of truth: contracts/egress-hook-api.md §"Worker-thread guard contract"
//
// This file is preloaded into every Worker thread by spawnGuardedWorker via
// `--require` in execArgv. Its single responsibility: install the runtime
// egress hook before any user-supplied Worker code runs.
//
// The Worker process is a separate V8 isolate, so it has its own copy of the
// egress hook's singleton state. Installing here patches the Worker's own
// dns/http2/tls/net/dgram/undici primitives.

import { installEgressHook } from '@llm-corpus/transport/egress-hook';

installEgressHook();
