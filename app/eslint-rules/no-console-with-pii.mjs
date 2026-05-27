/**
 * Custom ESLint rule: no-console-with-pii
 *
 * Flags `console.log/warn/error/info/debug` calls whose arguments mention a
 * PII-related variable/property name. Helps avoid accidentally logging
 * personal data (email, tokens, passwords, etc.) to stdout.
 *
 * Detection is name-based and intentionally conservative: it walks the
 * argument AST and looks for Identifier or property names matching the
 * PII pattern. It does NOT analyze runtime values.
 */

const PII_PATTERN =
  /(email|password|secret|token|apikey|api_key|displayname|firstname|lastname|phone|dob|iban|pii|personaldata|cookie|authorization|jwt|accesstoken|refreshtoken|moderatortoken|appsecret)/i;

const CONSOLE_METHODS = new Set(['log', 'warn', 'error', 'info', 'debug']);

/**
 * Return true if `name` looks like a PII-related identifier.
 * Skips trivial/short matches like a bare "to" that could substring-match.
 */
function isPiiName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return PII_PATTERN.test(name);
}

/**
 * Walk a single argument node and return true if it references an identifier
 * or property whose name matches PII_PATTERN.
 */
function hasPiiIdentifier(node, seen = new WeakSet()) {
  if (!node || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);

  switch (node.type) {
    case 'Identifier':
      return isPiiName(node.name);

    case 'MemberExpression':
      // foo.email, user.accessToken, obj['password']
      if (node.property) {
        if (node.property.type === 'Identifier' && isPiiName(node.property.name)) {
          return true;
        }
        if (
          node.property.type === 'Literal' &&
          typeof node.property.value === 'string' &&
          isPiiName(node.property.value)
        ) {
          return true;
        }
      }
      return hasPiiIdentifier(node.object, seen);

    case 'TemplateLiteral':
      return node.expressions.some((e) => hasPiiIdentifier(e, seen));

    case 'TaggedTemplateExpression':
      return hasPiiIdentifier(node.quasi, seen);

    case 'ObjectExpression':
      return node.properties.some((prop) => {
        if (prop.type === 'Property') {
          // { email } or { email: x } or { 'email': x }
          if (prop.key) {
            if (prop.key.type === 'Identifier' && isPiiName(prop.key.name)) return true;
            if (
              prop.key.type === 'Literal' &&
              typeof prop.key.value === 'string' &&
              isPiiName(prop.key.value)
            ) {
              return true;
            }
          }
          // Also inspect the value (e.g. { foo: user.email })
          return hasPiiIdentifier(prop.value, seen);
        }
        if (prop.type === 'SpreadElement') {
          return hasPiiIdentifier(prop.argument, seen);
        }
        return false;
      });

    case 'ArrayExpression':
      return node.elements.some((el) => hasPiiIdentifier(el, seen));

    case 'SpreadElement':
      return hasPiiIdentifier(node.argument, seen);

    case 'CallExpression':
    case 'NewExpression':
      if (hasPiiIdentifier(node.callee, seen)) return true;
      return node.arguments.some((a) => hasPiiIdentifier(a, seen));

    case 'ChainExpression':
      return hasPiiIdentifier(node.expression, seen);

    case 'ConditionalExpression':
      return (
        hasPiiIdentifier(node.test, seen) ||
        hasPiiIdentifier(node.consequent, seen) ||
        hasPiiIdentifier(node.alternate, seen)
      );

    case 'LogicalExpression':
    case 'BinaryExpression':
      return hasPiiIdentifier(node.left, seen) || hasPiiIdentifier(node.right, seen);

    case 'UnaryExpression':
    case 'AwaitExpression':
    case 'YieldExpression':
      return hasPiiIdentifier(node.argument, seen);

    case 'AssignmentExpression':
      return hasPiiIdentifier(node.left, seen) || hasPiiIdentifier(node.right, seen);

    case 'SequenceExpression':
      return node.expressions.some((e) => hasPiiIdentifier(e, seen));

    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return hasPiiIdentifier(node.expression, seen);

    default:
      return false;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid console.log/warn/error/info/debug calls that reference PII-related identifiers',
    },
    schema: [],
    messages: {
      pii: "console.{{method}} mentions a PII-related identifier ('{{name}}'); redact or move to structured logger.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'console') return;
        if (!callee.property || callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        if (!CONSOLE_METHODS.has(method)) return;

        for (const arg of node.arguments) {
          if (hasPiiIdentifier(arg)) {
            // Best-effort: try to surface the offending name in the message.
            const src = context.getSourceCode().getText(arg);
            const match = src.match(PII_PATTERN);
            context.report({
              node: arg,
              messageId: 'pii',
              data: {
                method,
                name: match ? match[0] : 'PII',
              },
            });
            return;
          }
        }
      },
    };
  },
};

export default rule;
