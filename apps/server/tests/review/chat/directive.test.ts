import { afterEach, expect, test } from 'bun:test';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import {
	applyDirective,
	heuristicDirective,
	interpretInstructions,
	normalizeGlob,
	type ReviewDirective
} from '../../../src/review/chat/directive';
import { resetLlmLimiter } from '../../../src/models/llm';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	resetLlmLimiter();
});

const DIFF = ['src/app.py', 'src/util.ts', 'tests/test_app.py', 'README.md']
	.map(
		(path) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`
	)
	.join('');

const config = { role: 'correctness' as const, baseUrl: 'http://model.test/v1', apiKey: 'k', model: 'small-7b' };

test('common phrasings become file globs without a model', () => {
	expect(heuristicDirective('review only python files')).toEqual({
		includeGlobs: ['**/*.py', '**/*.pyi'],
		excludeGlobs: []
	});

	expect(heuristicDirective('Only review the .ts files, skip the tests').includeGlobs).toEqual(['**/*.ts']);
	expect(heuristicDirective('Only review the .ts files, skip the tests').excludeGlobs).toContain('**/*.test.*');

	expect(heuristicDirective('focus on src/auth/ and ignore *.md')).toEqual({
		includeGlobs: ['src/auth/**'],
		excludeGlobs: ['**/*.md']
	});

	expect(heuristicDirective('python files only, not the tests').excludeGlobs).toContain('**/tests/**');
	expect(heuristicDirective('look for races in the worker')).toEqual({ includeGlobs: [], excludeGlobs: [] });
	expect(normalizeGlob('py')).toBe('**/py');
	expect(normalizeGlob('"*.go"')).toBe('**/*.go');
	expect(normalizeGlob('**')).toBeNull();
});

test('a directive marks the changed files it leaves out and drops includes that match nothing', () => {
	const inventory = buildInventory(DIFF);

	const directive: ReviewDirective = {
		instructions: 'only python, no tests',
		includeGlobs: ['**/*.py', '**/*.rs'],
		excludeGlobs: ['**/tests/**'],
		roles: []
	};

	const applied = applyDirective(inventory, directive);

	expect(applied).toEqual({ excluded: 3, kept: 1, droppedIncludes: ['**/*.rs'] });

	expect(inventory.files.map((file) => [file.path, file.excludeReason ?? null])).toEqual([
		['src/app.py', null],
		['src/util.ts', 'outside your instructions (not in **/*.py)'],
		['tests/test_app.py', 'outside your instructions (matches **/tests/**)'],
		['README.md', 'outside your instructions (not in **/*.py)']
	]);

	expect(inventory.executable).toBe(true);

	const nothing = buildInventory(DIFF);

	expect(
		applyDirective(nothing, { instructions: 'only rust', includeGlobs: ['**/*.rs'], excludeGlobs: [], roles: [] })
	).toEqual({ excluded: 0, kept: 4, droppedIncludes: ['**/*.rs'] });
});

test('the model reading of the instructions is merged with the heuristic, its excludes win, and a failed call leaves the heuristic', async () => {
	const inventory = buildInventory(DIFF);
	let prompt = '';

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		prompt = String(init?.body);

		return Response.json({
			choices: [
				{
					message: {
						content:
							'{"includeGlobs":["*.py","src/"],"excludeGlobs":["**/*.py"],"roles":["Security","tests","nonsense"]}'
					}
				}
			]
		});
	}) as unknown as typeof fetch;

	const directive = await interpretInstructions(
		'only python and src, security and tests',
		inventory,
		config,
		new AbortController().signal
	);

	expect(prompt).toContain('src/app.py');

	expect(directive).toEqual({
		instructions: 'only python and src, security and tests',
		includeGlobs: ['**/*.pyi', 'src/**'],
		excludeGlobs: ['**/*.py'],
		roles: ['security', 'testing']
	});

	globalThis.fetch = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch;

	const fallback = await interpretInstructions(
		'review only python files',
		inventory,
		config,
		new AbortController().signal
	);

	expect(fallback).toEqual({
		instructions: 'review only python files',
		includeGlobs: ['**/*.py', '**/*.pyi'],
		excludeGlobs: [],
		roles: []
	});
});
