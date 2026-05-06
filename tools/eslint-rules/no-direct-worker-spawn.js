// T025 — Custom eslint rule: no-direct-worker-spawn.
//
// Constitution XII + NFR-002: Workers MUST be spawned through
// `spawnGuardedWorker()` in packages/daemon/src/worker-spawn-guard.ts.
// Direct `new Worker(...)` calls are an egress-bypass vector — the helper
// preloads the egress hook bootstrap into every worker.
//
// Scope (configured in eslint.config.js): all packages/ EXCEPT the helper itself.

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct `new Worker(...)` outside the spawn guard helper (NFR-002).',
    },
    schema: [],
    messages: {
      noDirectWorker:
        '[NFR-002] Direct `new Worker(...)` is forbidden. Use `spawnGuardedWorker()` from @llm-corpus/daemon — it preloads the egress hook into the worker process.',
    },
  },
  create(context) {
    return {
      'NewExpression[callee.name="Worker"]'(node) {
        context.report({ node, messageId: 'noDirectWorker' });
      },
    };
  },
};

export default rule;
