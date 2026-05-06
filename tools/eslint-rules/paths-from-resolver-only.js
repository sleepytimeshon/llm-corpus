// T024 — Custom eslint rule: paths-from-resolver-only.
//
// Constitution XIV: All filesystem path references in this project MUST
// route through `packages/contracts/src/paths.ts` (the Paths resolver).
// Hardcoded path literals outside that file are rejected.
//
// Patterns rejected (per data-model.md §ForbiddenPathLiteral):
//   - `^/data/` — system /data root
//   - `llm-corpus/` (when used as a path segment, not the package name)
//   - `os.tmpdir()` calls
//   - `path.join(..., '/tmp/...')` / `'/var/...'`
//
// Scope (configured in eslint.config.js): all of packages/ EXCEPT
// packages/contracts/src/paths.ts (the resolver itself).

const FORBIDDEN_LITERAL_PATTERNS = [
  /^\/data\//,
  /\/tmp\//,
  /\/var\//,
];

/** Detect string literals that look like a path containing 'llm-corpus' segment. */
function isForbiddenLlmCorpusPath(literal) {
  if (typeof literal !== 'string') return false;
  if (!literal.includes('llm-corpus')) return false;
  // Allow package names like '@llm-corpus/contracts' — these aren't paths.
  if (literal.startsWith('@llm-corpus/')) return false;
  // Reject if the literal looks like a path segment containing llm-corpus.
  if (literal.includes('/llm-corpus/') || literal.endsWith('/llm-corpus')) {
    return true;
  }
  return false;
}

function isForbiddenLiteral(literal) {
  if (typeof literal !== 'string') return false;
  for (const re of FORBIDDEN_LITERAL_PATTERNS) {
    if (re.test(literal)) return true;
  }
  if (isForbiddenLlmCorpusPath(literal)) return true;
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded path literals outside the Paths resolver (Constitution XIV).',
    },
    schema: [],
    messages: {
      forbiddenLiteral:
        '[Constitution XIV] Forbidden path literal "{{value}}". All paths MUST route through the Paths resolver in packages/contracts/src/paths.ts.',
      forbiddenTmpdir:
        '[Constitution XIV] os.tmpdir() is forbidden outside the Paths resolver. Use Paths.cache() / Paths.extractCache() instead.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (isForbiddenLiteral(node.value)) {
          context.report({
            node,
            messageId: 'forbiddenLiteral',
            data: { value: String(node.value) },
          });
        }
      },
      // Catch os.tmpdir() calls.
      'CallExpression[callee.type="MemberExpression"]'(node) {
        const callee = node.callee;
        if (
          callee.object &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'os' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'tmpdir'
        ) {
          context.report({ node, messageId: 'forbiddenTmpdir' });
        }
      },
    };
  },
};

export default rule;
