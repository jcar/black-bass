import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Zero-runtime-API rule: the game bundle may never touch the generation SDK.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@google/genai', message: 'The runtime must make zero API calls. Generation lives in tools/asset-pipeline.' }],
          patterns: [{ group: ['**/tools/**'], message: 'src/ must not import build tooling.' }],
        },
      ],
    },
  },
  {
    // The simulation core stays framework-free so it is deterministic and unit-testable.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['react', 'pixi.js', 'zustand', 'howler'], patterns: [{ group: ['**/render/**', '**/ui/**', '**/state/**'] }] },
      ],
    },
  },
);
