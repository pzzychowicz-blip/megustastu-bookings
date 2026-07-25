import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // Lint cleanup (2026-07-24): the react-hooks v6 React-Compiler advisory
      // rules are downgraded to WARN — as errors they flag patterns that are
      // deliberate, documented architecture in this codebase (see CLAUDE.md):
      // the constants.js LIVE MODULE BINDINGS mutated by setLayout/
      // setActiveDayHours (globals/immutability/purity), the ref-mirror +
      // latest-values-ref patterns (refs), and one-shot setState resets inside
      // effects (set-state-in-effect). They stay visible as warnings so NEW
      // code doesn't adopt these patterns casually; rules-of-hooks and
      // exhaustive-deps keep their default severities.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
    },
  },
  {
    // Deliberate multi-export files (documented in CLAUDE.md): atoms.jsx is
    // THE multi-export atoms file; FloorGlyphs is a multi-export geometry
    // unit; SettingsChrome/Settings/FloorPlanEditor export chrome constants +
    // re-exports alongside components. Fast-refresh granularity is an
    // accepted trade-off there — not a defect to fix.
    files: [
      'src/components/atoms.jsx',
      'src/components/FloorGlyphs.jsx',
      'src/components/FloorPlanEditor.jsx',
      'src/components/SettingsChrome.jsx',
      'src/components/Settings.jsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
