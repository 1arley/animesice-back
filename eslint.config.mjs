// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/',
      'commitlint.config.js',
      'jest.config.mjs',
      'jest-e2e.config.js',
      'jest-e2e.config.mjs',
      '*.config.js',
      '*.config.mjs',
      '.releaserc.js',
      '.releaserc.mjs',
      'prisma.config.ts',
      'prisma/**/*.ts',
      'scripts/**/*.ts',
      'test/**/*.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }], // ← allow void fn() to suppress
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',   // ← explicit
      '@typescript-eslint/no-unsafe-call': 'error',          // ← explicit
      '@typescript-eslint/no-unsafe-member-access': 'error', // ← explicit
      '@typescript-eslint/no-unsafe-return': 'error',        // ← added
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prettier/prettier': ['error', { endOfLine: 'lf' }], // ← 'auto' → 'lf'
    },
  },
  // Test files relax the type-aware safety rules on purpose: mocks commonly
  // cast to `any`, and specs assert on internals that production code should
  // never touch. These are turned OFF (not warn) so `npm run lint` stays clean
  // while production files keep every rule at error level.
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);