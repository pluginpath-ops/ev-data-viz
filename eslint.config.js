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
/**
 * What explainers may import from EVBench, relative to src/. Theme tokens are
 * CSS variables and need no import. useChargingTests is the one data hook:
 * read-only curves for an explainer's tests card. NavigationContext is navigation only (ExplainerLink's in-place
 * click), no data.
 */
const EXPLAINER_MAY_IMPORT = [
    'utils/platforms',
    'hooks/useChargingTests',
    // The second data hook: modeled efficiency curves + range tests by EPA link
    // id, computed EVBench-side so explainers never import the EPA derivations.
    'hooks/useModeledEfficiency',
    'context/NavigationContext',
    'components/Popover',
    'components/InfoIcon',
    'components/reference/PlatformLink',
];

export default [
    // `.claude/worktrees` holds throwaway git worktrees — a second, stale copy of
    // the whole codebase, pinned to whatever commit a past session branched from.
    // git excludes it; ESLint did not, so every run linted both copies and CI
    // annotated files that were not in the pull request. One left over from a
    // merged branch produced a phantom "'updateRunColor' is assigned but never
    // used" on #312, against a line no longer in the source.
    { ignores: ['dist', 'node_modules', 'coverage', '.claude/worktrees'] },
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
    // ── The explainers boundary (src/explainers/CLAUDE.md) ─────────────────
    //
    // Explainers are kept apart from EVBench so neither has to be read to work
    // on the other. Two connections are allowed and nothing else: EVBench may
    // import ExplainerLink (the "Learn more" link) and ExplainersSection (the
    // mount point under Reference), and explainers may import the short
    // EVBench list above. Widen the list here, with a reason, rather than working around it.
    //
    // no-restricted-imports matches the import string, not the resolved file,
    // so each depth of src/explainers gets its own block (hence the two-level
    // limit in that folder's CLAUDE.md).
    {
        files: ['src/**/*.{js,jsx}'],
        ignores: ['src/explainers/**'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [{
                regex: '(^|/)explainers/(?!(ExplainerLink|ExplainersSection)(\\.jsx)?$)',
                message: 'EVBench may import only ExplainerLink and ExplainersSection from src/explainers (see src/explainers/CLAUDE.md).',
            }] }],
        },
    },
    ...[['src/explainers/*.{js,jsx}', '../'], ['src/explainers/*/*.{js,jsx}', '../../']].map(([files, up]) => ({
        files: [files],
        rules: {
            'no-restricted-imports': ['error', { patterns: [{
                // A regex, not a gitignore group: a group cannot re-include a
                // file once `../*` has excluded the directory it sits in.
                regex: `^${up.replaceAll('.', '\\.')}(?!(${EXPLAINER_MAY_IMPORT.join('|')})(\\.jsx?)?$)`,
                message: 'Explainers may import only the EVBench modules in EXPLAINER_MAY_IMPORT (eslint.config.js).',
            }] }],
        },
    })),
    {
        // Vitest globals.
        files: ['**/*.test.js', 'src/**/__tests__/**'],
        languageOptions: { globals: { ...globals.node } },
    },
];
