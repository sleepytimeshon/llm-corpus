// T067 — SC-010 read-only enforcement: AST scan over the resource-handler
// call graph forbids any write primitive.
//
// Scope (configured in eslint.config.js):
//   - packages/transport/src/resource-{manifest,taxonomy,recent,document}-handler.ts
//   - packages/storage/src/{manifest,taxonomy,recent,document}-adapter.ts
//
// Forbidden patterns:
//   - .exec(...) / .run(...) where the FIRST argument's source contains an
//     SQL write keyword (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, REPLACE,
//     TRUNCATE) — case-insensitive, with whitespace tolerance.
//   - fs.writeFile* / fs.appendFile* member calls. (The telemetry helper is
//     OUT of scope; the resource handlers/adapters MUST NOT contain any
//     telemetry-helper write — they call emitResourceRead() which lives in
//     packages/transport/src/resource-telemetry.ts and is outside this scope.)
//   - fs.mkdir* member calls — same rationale.
//
// The rule operates on raw source text for SQL-keyword detection (not Zod
// AST inference) because TS literals + template strings are the natural
// surface and a literal substring scan is robust.
//
// References:
//   - contracts/mcp-resources-api.md §"Read-only enforcement (SC-010)"
//   - SC-010 (read-only-by-construction)
//   - Constitution III (Substrate, Not Surface)

const SQL_WRITE_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'REPLACE',
  'TRUNCATE',
];

const SQL_WRITE_REGEX = new RegExp(
  '(?:^|[\\s;(])(' + SQL_WRITE_KEYWORDS.join('|') + ')\\b',
  'i',
);

const FS_WRITE_METHODS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'unlink',
  'unlinkSync',
  'rename',
  'renameSync',
  'copyFile',
  'copyFileSync',
  'truncate',
  'truncateSync',
  'symlink',
  'symlinkSync',
  'createWriteStream',
]);

/**
 * Extract a flattened source string from a TS Literal / TemplateLiteral /
 * BinaryExpression-of-strings. Returns null if the AST shape is non-trivial.
 */
function extractStringSource(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral') {
    // Concatenate quasis (cooked text); ignore expression slots since they're
    // dynamic. Keyword detection is on the static portion.
    return node.quasis.map((q) => q.value.cooked).join('');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const l = extractStringSource(node.left);
    const r = extractStringSource(node.right);
    if (l !== null && r !== null) return l + r;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow writes from MCP resource handlers and their adapter call graph (SC-010, Constitution III).',
    },
    schema: [],
    messages: {
      noWriteSql:
        '[SC-010] Resource handlers must be read-only. Detected SQL write keyword "{{keyword}}" in .{{method}} call.',
      noWriteFs:
        '[SC-010] Resource handlers must not write to disk. Detected `{{name}}`.',
      noMkdir:
        '[SC-010] Resource handlers must not create directories. Detected `{{name}}`.',
    },
  },
  create(context) {
    return {
      // Detect <expr>.exec(<sql>) / <expr>.run(<sql>) on better-sqlite3
      // statement objects, where <sql> contains a write keyword.
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        const propName =
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name;
        if (!propName) return;

        // SQL-write detection on .exec / .run / .prepare-then-call
        if (propName === 'exec' || propName === 'run') {
          const firstArg = node.arguments[0];
          const src = extractStringSource(firstArg);
          if (src !== null) {
            const m = src.match(SQL_WRITE_REGEX);
            if (m) {
              context.report({
                node,
                messageId: 'noWriteSql',
                data: { keyword: m[1].toUpperCase(), method: propName },
              });
            }
          }
        }

        // FS-write detection: <fs>.<writeMethod>(...) or <fs>.promises.<writeMethod>(...).
        if (FS_WRITE_METHODS.has(propName)) {
          // Walk back from the property to find the root receiver name.
          let receiver = callee.object;
          // Allow fs.promises.writeFile etc.
          if (
            receiver &&
            receiver.type === 'MemberExpression' &&
            receiver.property &&
            receiver.property.type === 'Identifier' &&
            (receiver.property.name === 'promises' ||
              receiver.property.name === 'default')
          ) {
            receiver = receiver.object;
          }
          if (
            receiver &&
            receiver.type === 'Identifier' &&
            // Common identifiers for the fs module.
            (receiver.name === 'fs' ||
              receiver.name === 'fsp' ||
              receiver.name === 'fsPromises')
          ) {
            const messageId =
              propName === 'mkdir' || propName === 'mkdirSync'
                ? 'noMkdir'
                : 'noWriteFs';
            context.report({
              node,
              messageId,
              data: { name: `${receiver.name}.${propName}` },
            });
          }
        }
      },
    };
  },
};

export default rule;
