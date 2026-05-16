// SP-007 T042 — `withInstallBudget` AbortController-based budget enforcer.
//
// References:
//   - specs/007-install-first-run/tasks.md T028 / T042
//   - specs/007-install-first-run/spec.md FR-INSTALL-002, FR-INSTALL-017,
//     SC-007-029, SC-007-034
//   - Constitution Principle VII (cancellable IO; NEVER Promise.race + setTimeout)
//   - Constitution Principle XVI (honest performance commitments)
//
// Wraps an async function with a `setTimeout` + `clearTimeout` +
// `controller.abort('install_budget_exceeded')` pattern. On timeout the
// inner controller fires; the caller's AbortSignal (SIGINT propagation) is
// also wired through so the operator can ^C mid-install.
//
// Constitution VII explicitly forbids `Promise.race([fn, setTimeout])` for
// budget enforcement — the timeout handle leaks and the function can keep
// running. We use the AbortController + setTimeout + clearTimeout idiom
// instead: the inner abort signal is composed with the outer signal so any
// abort source triggers cancellation.

import { InstallBudgetExceededError } from '@llm-corpus/contracts';

export interface InstallBudgetDeps {
  /** Total install budget in ms (default 90_000 per FR-INSTALL-002). */
  budgetMs: number;
  /** Outer (caller) AbortSignal — SIGINT propagation from the CLI entry. */
  outerSignal: AbortSignal;
}

/**
 * Run `fn` against a derived AbortSignal that fires either when the outer
 * signal fires (SIGINT) or when `budgetMs` elapses. On budget expiry, the
 * inner controller aborts with reason `'install_budget_exceeded'` and `fn`
 * rejects with `InstallBudgetExceededError`.
 *
 * The helper never uses `Promise.race(setTimeout)`; the timer is cleared on
 * resolution / rejection / abort.
 */
export async function withInstallBudget<T>(
  deps: InstallBudgetDeps,
  fn: (innerSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;

  // Propagate outer abort → inner abort.
  const onOuterAbort = (): void => {
    controller.abort(deps.outerSignal.reason);
  };
  if (deps.outerSignal.aborted) {
    controller.abort(deps.outerSignal.reason);
  } else {
    deps.outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const timeoutHandle: NodeJS.Timeout = setTimeout(() => {
    timedOut = true;
    controller.abort('install_budget_exceeded');
  }, deps.budgetMs);

  try {
    const result = await fn(controller.signal);
    return result;
  } catch (cause) {
    if (timedOut) {
      throw new InstallBudgetExceededError({
        elapsed_ms: Date.now() - startedAt,
        budget_ms: deps.budgetMs,
      });
    }
    throw cause;
  } finally {
    clearTimeout(timeoutHandle);
    deps.outerSignal.removeEventListener('abort', onOuterAbort);
  }
}
