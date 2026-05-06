// T048 — Module-load-time egress hook installation.
// Source of truth: contracts/egress-hook-api.md §"Bootstrap ordering contract"
//
// This module is the FIRST import of `packages/transport/src/index.ts`. Its
// side effect is to call `installEgressHook()` synchronously at module load.
// Importing transport before any pipeline package therefore guarantees the
// hook patches are in place before any potentially-network-using code runs.
//
// Production: never disposes. Tests: import egress-hook directly with HookOptions
// and dispose via Symbol.dispose for round-trip cases.

import { installEgressHook } from './egress-hook.js';

installEgressHook();
