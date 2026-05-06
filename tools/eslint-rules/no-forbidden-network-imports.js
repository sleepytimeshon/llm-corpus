// T022 — Custom eslint rule: no-forbidden-network-imports.
//
// NFR-001: pipeline + adapter packages MUST NOT import network-calling modules.
// Scope (configured in eslint.config.js): packages/{pipeline,storage,index,
// inference,extract,cli}.
//
// The full ForbiddenImportSet is sourced from
// `specs/001-local-only-mcp-foundation/data-model.md` §ForbiddenImportSet.
//
// This file is a plain ESM module (not TypeScript) so eslint can load it
// directly without a build step.

/**
 * @type {ReadonlySet<string>}
 *
 * Exact-match imports + scope/namespace prefixes. We use prefix matching
 * for `@aws-sdk/`, `@azure/`, `@google-cloud/`, `@anthropic-ai/` because
 * each scope publishes many sub-packages.
 */
const FORBIDDEN_EXACT = new Set([
  // Node built-in network modules
  'node:http',
  'node:https',
  'node:fetch',
  'node:net',
  'http',
  'https',
  'fetch',
  'net',
  // Cloud SDKs
  'openai',
  'cohere-ai',
  // HTTP clients
  'axios',
  'got',
  'node-fetch',
  'cross-fetch',
]);

const FORBIDDEN_PREFIXES = [
  '@aws-sdk/',
  '@azure/',
  '@google-cloud/',
  '@anthropic-ai/',
];

function isForbidden(source) {
  if (FORBIDDEN_EXACT.has(source)) return true;
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (source.startsWith(prefix)) return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow imports of network-calling modules in pipeline + adapter packages (NFR-001).',
    },
    schema: [],
    messages: {
      forbiddenImport:
        '[NFR-001] Forbidden network import "{{source}}" in pipeline/adapter package. ' +
        'Network access is only permitted via the egress hook in packages/transport/.',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        if (isForbidden(source)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source } });
        }
      },
      // Catch dynamic import('...') with a literal string.
      'ImportExpression > Literal'(node) {
        if (typeof node.value !== 'string') return;
        if (isForbidden(node.value)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source: node.value } });
        }
      },
      // Catch require('...') with a literal string.
      'CallExpression[callee.name="require"] > Literal'(node) {
        if (typeof node.value !== 'string') return;
        if (isForbidden(node.value)) {
          context.report({ node, messageId: 'forbiddenImport', data: { source: node.value } });
        }
      },
    };
  },
};

export default rule;
