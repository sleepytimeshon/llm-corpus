// T026 — Custom eslint rule: no-shell-string-exec.
//
// Constitution XII (Subprocess Hygiene): no `execSync`, no
// `child_process.exec` (which uses a shell), no `spawn(... { shell: true })`,
// no string-formed shell commands. All subprocess invocations MUST go
// through `runTool(name, args[], opts)` with an explicit argv array.

const FORBIDDEN_EXEC_FUNCTIONS = new Set(['exec', 'execSync', 'execFileSync']);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow shell-string subprocess invocations (Constitution XII).',
    },
    schema: [],
    messages: {
      noExec:
        '[Constitution XII] `{{name}}` is forbidden. Use `runTool(name, args[], opts)` from @llm-corpus/contracts/run-tool — it spawns with shell:false and an explicit argv array.',
      noShellTrue:
        '[Constitution XII] spawn/spawnSync with `shell: true` is forbidden. Use runTool() with an argv array instead.',
    },
  },
  create(context) {
    return {
      // child_process.exec(...) / .execSync(...) / .execFileSync(...)
      'CallExpression[callee.type="MemberExpression"]'(node) {
        const prop = node.callee.property;
        if (prop && prop.type === 'Identifier' && FORBIDDEN_EXEC_FUNCTIONS.has(prop.name)) {
          context.report({
            node,
            messageId: 'noExec',
            data: { name: prop.name },
          });
        }
      },
      // Bare exec() / execSync() (named imports).
      'CallExpression[callee.type="Identifier"]'(node) {
        if (FORBIDDEN_EXEC_FUNCTIONS.has(node.callee.name)) {
          context.report({
            node,
            messageId: 'noExec',
            data: { name: node.callee.name },
          });
        }
      },
      // spawn/spawnSync with `shell: true` option object.
      'CallExpression'(node) {
        const calleeName =
          node.callee.type === 'Identifier'
            ? node.callee.name
            : node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
              ? node.callee.property.name
              : null;
        if (calleeName !== 'spawn' && calleeName !== 'spawnSync') return;
        // Look for an options object argument (last arg, must be ObjectExpression).
        for (const arg of node.arguments) {
          if (arg.type !== 'ObjectExpression') continue;
          for (const prop of arg.properties) {
            if (
              prop.type === 'Property' &&
              prop.key.type === 'Identifier' &&
              prop.key.name === 'shell' &&
              prop.value.type === 'Literal' &&
              prop.value.value === true
            ) {
              context.report({ node: prop, messageId: 'noShellTrue' });
            }
          }
        }
      },
    };
  },
};

export default rule;
