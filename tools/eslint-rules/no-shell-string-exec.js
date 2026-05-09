// T026 — Custom eslint rule: no-shell-string-exec.
//
// Constitution XII (Subprocess Hygiene): no `execSync`, no
// `child_process.exec` (which uses a shell), no `spawn(... { shell: true })`,
// no string-formed shell commands. All subprocess invocations MUST go
// through `runTool(name, args[], opts)` with an explicit argv array.
//
// SP-002 refinement: the original SP-001 rule flagged ALL `.exec()` member
// calls, which mis-fired on better-sqlite3's `db.exec(SQL)` API (a legitimate
// SQL-multi-statement entry point — NOT a shell). This refinement detects
// only the child_process.* family by tracking imports from 'child_process'
// and 'node:child_process', falling back to `execSync`/`execFileSync` (which
// are unambiguously shell-class names — better-sqlite3 has no such API).

// `execSync` / `execFileSync` are unambiguously child_process; better-sqlite3
// has no method by these names. `exec` is the ambiguous name — flagged only
// when bound to a child_process import.
const UNAMBIGUOUS_FORBIDDEN = new Set(['execSync', 'execFileSync']);
const CHILD_PROCESS_MODULES = new Set(['child_process', 'node:child_process']);

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
    // Track local bindings imported from child_process so we know which
    // `exec(...)` / `cp.exec(...)` calls actually invoke child_process.
    const childProcessNamespaces = new Set(); // local namespace names: e.g. `cp`
    const childProcessNamedExec = new Set(); // local names of `exec` from cp

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string') return;
        if (!CHILD_PROCESS_MODULES.has(node.source.value)) return;
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') {
            childProcessNamespaces.add(spec.local.name);
          } else if (spec.type === 'ImportSpecifier') {
            const importedName =
              spec.imported.type === 'Identifier' ? spec.imported.name : null;
            if (importedName === 'exec') {
              childProcessNamedExec.add(spec.local.name);
            }
            // execSync / execFileSync caught by unambiguous-name check
          } else if (spec.type === 'ImportDefaultSpecifier') {
            // CommonJS-style default import of the whole module
            childProcessNamespaces.add(spec.local.name);
          }
        }
      },

      // Member-call: `<obj>.<prop>(...)`
      'CallExpression[callee.type="MemberExpression"]'(node) {
        const prop = node.callee.property;
        if (!prop || prop.type !== 'Identifier') return;
        const propName = prop.name;
        // Unambiguously forbidden names (no SQLite collision):
        if (UNAMBIGUOUS_FORBIDDEN.has(propName)) {
          context.report({
            node,
            messageId: 'noExec',
            data: { name: propName },
          });
          return;
        }
        // Ambiguous `.exec`: only flag when called on a child_process namespace.
        if (propName === 'exec') {
          const obj = node.callee.object;
          if (obj.type === 'Identifier' && childProcessNamespaces.has(obj.name)) {
            context.report({
              node,
              messageId: 'noExec',
              data: { name: 'exec' },
            });
          }
        }
      },
      // Bare exec() / execSync() (named imports).
      'CallExpression[callee.type="Identifier"]'(node) {
        const calleeName = node.callee.name;
        if (UNAMBIGUOUS_FORBIDDEN.has(calleeName)) {
          context.report({
            node,
            messageId: 'noExec',
            data: { name: calleeName },
          });
          return;
        }
        // Match the call's local binding name against tracked
        // child_process.exec imports — covers both `import { exec } from
        // 'child_process'` (local name 'exec') AND `import { exec as foo }
        // from 'child_process'` (local name 'foo'). A redundant
        // `calleeName === 'exec'` guard would have let the alias slip.
        if (childProcessNamedExec.has(calleeName)) {
          context.report({
            node,
            messageId: 'noExec',
            data: { name: calleeName },
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
