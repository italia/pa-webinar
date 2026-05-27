import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

import noConsoleWithPii from './eslint-rules/no-console-with-pii.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends(
    'next/core-web-vitals',
    'next/typescript',
    'prettier'
  ),
  {
    plugins: {
      local: {
        rules: {
          'no-console-with-pii': noConsoleWithPii,
        },
      },
    },
    rules: {
      // TypeScript strict rules
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],

      // No console.log in production code
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Custom: warn when console.* args mention PII-named identifiers.
      // Kept as 'warn' so the rule surfaces hits without breaking CI on
      // legacy lines that still need to be audited.
      'local/no-console-with-pii': 'warn',

      // React rules
      'react/no-unescaped-entities': 'off',

      // Import order
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
        },
      ],
    },
  },
];

export default eslintConfig;
