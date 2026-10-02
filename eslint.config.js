import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Only JSDoc block comments are allowed. Tool directives (`eslint-disable`,
 * `@ts-expect-error`, triple-slash references) stay legal because they are
 * instructions to tooling, not prose.
 */
const jsdocOnly = {
	meta: {
		type: 'suggestion',
		messages: {
			line: 'Use a JSDoc docstring (/** … */) on the declaration instead of a // comment.',
			block: 'Use a JSDoc docstring (/** … */) instead of a plain block comment.'
		},
		schema: []
	},
	create(context) {
		const directive = /^\s*(eslint-|@ts-expect-error|\/\s*<reference|global\s|svelte-ignore)/;

		return {
			Program() {
				for (const comment of context.sourceCode.getAllComments()) {
					if (directive.test(comment.value)) continue;

					if (comment.type === 'Line') {
						context.report({ loc: comment.loc, messageId: 'line' });
					} else if (!comment.value.startsWith('*')) {
						context.report({ loc: comment.loc, messageId: 'block' });
					}
				}
			}
		};
	}
};

/** Blank lines between logical blocks, so code never reads as one dense wall. */
const spacing = [
	'error',
	{ blankLine: 'always', prev: 'import', next: '*' },
	{ blankLine: 'any', prev: 'import', next: 'import' },
	{ blankLine: 'always', prev: '*', next: 'return' },
	{ blankLine: 'always', prev: ['const', 'let'], next: '*' },
	{ blankLine: 'always', prev: '*', next: ['const', 'let'] },
	{ blankLine: 'any', prev: ['singleline-const', 'singleline-let'], next: ['singleline-const', 'singleline-let'] },
	{
		blankLine: 'always',
		prev: '*',
		next: ['multiline-block-like', 'multiline-expression', 'multiline-const', 'multiline-let']
	},
	{ blankLine: 'always', prev: ['multiline-block-like', 'multiline-expression'], next: '*' },
	{ blankLine: 'always', prev: '*', next: ['function', 'class', 'export', 'interface', 'type'] },
	{ blankLine: 'always', prev: ['function', 'class', 'export', 'interface', 'type'], next: '*' },
	{ blankLine: 'any', prev: 'export', next: 'export' }
];

export default ts.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/build/**',
			'**/dist/**',
			'**/.svelte-kit/**',
			'**/.vercel/**',
			'**/.turbo/**',
			'**/data/**',
			'**/static/**'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node, Bun: 'readonly' }
		},
		plugins: {
			'@stylistic': stylistic,
			recoder: { rules: { 'jsdoc-only': jsdocOnly } }
		},
		rules: {
			'recoder/jsdoc-only': 'error',
			'@stylistic/padding-line-between-statements': spacing,
			'@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
			'max-lines': ['error', { max: 500 }],
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
			],
			'@typescript-eslint/no-explicit-any': 'error',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] }
		}
	}
);
