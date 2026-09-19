import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'extra/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@swapcircle/api',
                '@swapcircle/api/*',
                '@swapcircle/database',
                '@swapcircle/database/*',
                '**/api/**',
                '**/database/**',
              ],
              message: 'Browser code must not import server packages.',
            },
            {
              group: ['node:*'],
              message: 'Node modules belong in server code or tooling.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/test/**', 'apps/web/vite.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
