import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'], // React 17+ JSX transform: no need to import React
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // App.jsx has never been linted; keep unused-vars as a warning (not an
      // error) for now so it doesn't block on a first pass. Constants/components
      // that look like factories (PascalCase / ALL_CAPS) are ignored.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]' }],
      // This codebase has no `prop-types` convention and no TypeScript --
      // there is no type-checked prop-shape system for this rule to be
      // checking components *against*. Turned on, it fires ~590 times on
      // App.jsx alone, none of which are real bugs; it just measures "did
      // not adopt PropTypes." If the project later adopts PropTypes or
      // migrates to TS, re-enable this (or drop eslint-plugin-react's
      // `recommended` in favor of `jsx-runtime` + a handful of a11y/JSX
      // correctness rules).
      'react/prop-types': 'off',
    },
  },
  {
    // Test files run under Vitest/Node, not the browser bundle.
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // All feature slices (docs/trailer-technical-spec.md §11 for the
    // trailer; mensgames/ui/styles.jsx's own header comment makes the same
    // claim for mens-games): text renders as plain React children, never
    // `dangerouslySetInnerHTML`/`renderMd`. Widened from trailer-only so
    // that claim is enforced everywhere it's made, not just remembered.
    files: ['src/features/**/*.{js,jsx}'],
    rules: {
      'react/no-danger': 'error',
    },
  },
])
