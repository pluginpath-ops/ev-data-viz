import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Lint rules, chosen for the bugs this project actually keeps hitting.
 *
 * The motivating one: a helper used in JSX without being imported is a runtime
 * ReferenceError that no build step catches, because Vite transpiles rather
 * than resolves. It blanked the app three times in one day. `no-undef` catches
 * it before the page ever renders.
 *
 * Deliberately not a style pass. Everything here either finds a defect or
 * finds dead code; formatting opinions are left alone so the diff on adoption
 * stays reviewable.
 */
export default [
    { ignores: ['dist', 'node_modules', 'coverage'] },
    {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,

            // The rule this was installed for.
            'no-undef': 'error',

            // JSX components read as unused to the base rule; keep capitalised
            // identifiers exempt so the signal stays clean.
            'no-unused-vars': ['warn', {
                varsIgnorePattern: '^[A-Z_]',
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],

            // A missing dependency is how the correction dropdown came to do
            // nothing on the Charging chart: the effect never re-ran.
            'react-hooks/exhaustive-deps': 'warn',

            'react-refresh/only-export-components': 'off',
            'no-empty': ['warn', { allowEmptyCatch: true }],

            // ── Warnings, not errors, and why ────────────────────────────────
            //
            // eslint-plugin-react-hooks v6 ships the React Compiler rules, which
            // flag 33 places here. Several look worth acting on — set-state-in-
            // effect is the shape of a bug this project has already hit — but
            // each is a refactor, not a config choice. Adopting them as errors
            // would mean a lint that fails on arrival, and a lint that fails on
            // arrival is one nobody runs. Left visible as a backlog instead.
            'react-hooks/refs': 'warn',
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/immutability': 'warn',
            'react-hooks/preserve-manual-memoization': 'warn',

            // Fires on defensive initialisers that every branch overwrites —
            // technically dead, deliberately written.
            'no-useless-assignment': 'warn',
        },
    },
    {
        // Vitest globals.
        files: ['**/*.test.js', 'src/**/__tests__/**'],
        languageOptions: { globals: { ...globals.node } },
    },
];
