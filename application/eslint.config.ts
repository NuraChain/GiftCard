import js from '@eslint/js';
import type { ESLint } from 'eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

// The house style, unchanged by the move to React: allman braces, 4-space indent, single
// quotes, and the TypeScript discipline the rest of the repo is written under.
//
// What React adds is `react-hooks`, and it is the one set of rules here that catches BUGS
// rather than inconsistencies: a missing dependency in an effect is a stale render, and a
// hook behind a condition is a crash on the second pass.
//
// Those TWO rules are taken, not the plugin's whole recommended set. v7 bundles the React
// Compiler's rules with them - `set-state-in-effect`, `immutability`, `refs` and the rest -
// and those encode a stricter model than this app is written to: fetching a tab's data when
// the console session opens is a synchronisation with something outside React, which is what
// an effect is for, and the compiler set calls every such effect a mistake. Adopting it is a
// decision about how the whole application is written, so it is not made by default here.
// (`refs` did catch one real defect on its way past - see ui/toast.tsx.)
const config: ReturnType<typeof defineConfig> = defineConfig([
    globalIgnores([
        '**/dist/**',
        '**/node_modules/**',
        '**/build/**'
    ]),
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        // The plugin ships two generations of config under one export and its own type
        // does not fit ESLint's `Plugin`. The rules are what is wanted here, not the
        // presets, so the shape is asserted rather than chased across versions.
        plugins: { 'react-hooks': reactHooks as unknown as ESLint.Plugin },
        rules:
        {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn'
        }
    },
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
        languageOptions: { globals: globals.browser },
        rules:
        {
            'no-undef': 'off',
            // TypeScript models overloaded signatures natively; the base rule flags them.
            'no-redeclare': 'off',
            'space-before-blocks': 'error',
            'quotes': ['error', 'single', { avoidEscape: true }],
            'key-spacing': 'error',
            'semi-spacing': 'error',
            'curly': ['error', 'all'],
            // No core `indent` rule: it mis-handles nested `=> ({ ... })` returns (its
            // autofix mangles them). Indentation stays consistent by convention + the brace
            // and spacing rules below; swap in @stylistic/indent if you want it enforced.
            'semi': ['error', 'always'],
            'brace-style': ['error', 'allman', { allowSingleLine: true }],
            'block-spacing': ['error', 'always'],
            'object-curly-spacing': ['error', 'always'],
            'template-curly-spacing': ['error', 'always'],
            'comma-dangle': ['error', 'never'],
            'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
            'no-trailing-spaces': 'error',
            'linebreak-style': ['error', 'unix'],
            'no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true, allowTypedFunctionExpressions: true }],
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
            '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: false }],
            '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit', overrides: { constructors: 'no-public' } }],
            '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
            // Native #private members over the erased `private`/`protected`; union literals over enums; ES modules over namespaces.
            'no-restricted-syntax':
            [
                'error',
                {
                    selector: ':matches(PropertyDefinition, MethodDefinition, TSAbstractPropertyDefinition, TSAbstractMethodDefinition)[accessibility=private]',
                    message: 'Use a native #private member - TypeScript `private` is erased and stays reachable at runtime.'
                },
                {
                    selector: ':matches(PropertyDefinition, MethodDefinition)[accessibility=protected]',
                    message: 'No `protected` members - prefer composition over inheritance-facing state.'
                },
                {
                    selector: 'TSEnumDeclaration',
                    message: 'Use a union of literal types instead of an enum.'
                },
                {
                    selector: "TSModuleDeclaration[id.type='Identifier']",
                    message: 'Use ES modules instead of a namespace.'
                }
            ]
        }
    },
    {
        // Fast refresh replaces a module in place, which it can only do when the module's
        // exports are all components. A page that also exports its context hook is the
        // normal, deliberate exception.
        files: ['**/*.tsx'],
        plugins: { 'react-refresh': reactRefresh },
        rules: { 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] }
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
    },
    {
        files: ['**/*.spec.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
        rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
    }
]);

export default config;
