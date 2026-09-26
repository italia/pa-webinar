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

      // L'icona di design-react-kit si carica in una cache asincrona: il
      // server la disegna, il browser al primo disegno no, e l'icona sparisce.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'design-react-kit',
              importNames: ['Icon'],
              message: "Usa `Icon` da '@/components/ui/icon': quella di design-react-kit sparisce all'idratazione.",
            },
          ],
        },
      ],

      // No console.log in production code
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Custom: warn when console.* args mention PII-named identifiers.
      // Kept as 'warn' so the rule surfaces hits without breaking CI on
      // legacy lines that still need to be audited.
      'local/no-console-with-pii': 'warn',

      // React rules
      'react/no-unescaped-entities': 'off',

      // `process.env.NEXT_PUBLIC_X` in notazione puntata lo sostituisce webpack
      // al BUILD: il valore resta congelato nell'immagine (quello di default del
      // Dockerfile, cioe' localhost) e l'immagine unica multi-ambiente si rompe
      // in silenzio. Si legge con `getPublicEnv()` di `@/lib/env`. Unica
      // eccezione, per nome: l'identita' del build `NEXT_PUBLIC_BUILD_*`
      // (versione, sha, canale, data), che deve essere proprio quella del build.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_(?!BUILD_)/]",
          message:
            "process.env.NEXT_PUBLIC_* viene inlinato al build: usa getPublicEnv() di '@/lib/env'.",
        },
      ],

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
  {
    // Il modulo che incapsula la lettura a runtime, e i test, che impostano
    // l'ambiente a mano e non passano da webpack.
    files: ['src/lib/env.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];

export default eslintConfig;
