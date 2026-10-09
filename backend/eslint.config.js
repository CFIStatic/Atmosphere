import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      // `let x = default; if (...) x = ...` is the house idiom for defensive
      // defaults; flagging the default as "useless" is noise, not a bug.
      'no-useless-assignment': 'off',
      // `declare global { namespace Express { ... } }` is how Express's
      // Request type is augmented.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      // Ratcheted in CI (see .github/workflows/ci.yml): new code should not
      // add `any`; existing uses are paid down file by file.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
