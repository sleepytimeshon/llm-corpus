// T023 — Custom eslint rule: no-process-exit-in-libs.
//
// Constitution XI (Library/CLI Boundary): library packages return
// Result<T,E>; they MUST NOT call process.exit. Only CLI entry points
// and build/ scripts may exit the process.
//
// Scope (configured in eslint.config.js):
//   packages/{contracts,storage,index,inference,extract,pipeline}.
// OUT of scope: packages/cli, packages/transport (entry points), build/.

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow process.exit() in library packages (Constitution Principle XI).',
    },
    schema: [],
    messages: {
      noProcessExit:
        '[Constitution XI] process.exit() is forbidden in library packages. ' +
        'Return Result.err(<typed-error>) and let the CLI/transport boundary decide what to exit with.',
    },
  },
  create(context) {
    return {
      // Match `process.exit(...)` and `process['exit'](...)`.
      'CallExpression[callee.type="MemberExpression"]'(node) {
        const callee = node.callee;
        if (
          callee.object &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'process'
        ) {
          const propName =
            callee.property.type === 'Identifier'
              ? callee.property.name
              : callee.property.type === 'Literal'
                ? callee.property.value
                : null;
          if (propName === 'exit') {
            context.report({ node, messageId: 'noProcessExit' });
          }
        }
      },
    };
  },
};

export default rule;
