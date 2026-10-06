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
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Keep existing legacy effect/ref patterns lintable while retaining hook ordering checks.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      // Surface unused legacy code as warnings; new CI blockers remain errors.
      'no-unused-vars': 'warn',
    },
  },
])
