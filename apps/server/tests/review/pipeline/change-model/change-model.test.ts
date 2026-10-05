import { beforeAll, describe, expect, test } from 'bun:test';
import { symbolAt, unitContext } from '../../../../src/review/pipeline/change-model/change-model';
import { deadCodeResults } from '../../../../src/review/pipeline/detectors/symbols';
import { buildFrom, type Built } from './fixtures';

const BASE_TS = [
	'export class Limiter {',
	'\tprivate count = 0;',
	'',
	'\ttake(n: number): boolean {',
	'\t\treturn this.count >= n;',
	'\t}',
	'',
	'\tdrop(): void {',
	'\t\tthis.count = 0;',
	'\t}',
	'}',
	'',
	'function helper(a: string) {',
	'\treturn a;',
	'}',
	''
].join('\n');

const HEAD_TS = [
	'export class Limiter {',
	'\tprivate count = 0;',
	'',
	'\ttake(n: number): boolean {',
	'\t\tif (n > 0) {',
	'\t\t\tthis.count += n;',
	'\t\t}',
	'',
	'\t\treturn this.count >= n;',
	'\t}',
	'}',
	'',
	'export const limit = (max: number, label: string) => {',
	'\treturn new Limiter().take(max);',
	'};',
	''
].join('\n');

describe('typescript', () => {
	let built: Built;

	const model = () => built.model;
	const byId = (id: string) => built.model.symbols.find((symbol) => symbol.id === id);

	beforeAll(async () => {
		built = await buildFrom({ 'src/limiter.ts': BASE_TS }, { 'src/limiter.ts': HEAD_TS });
	});

	test('a method edit is owned by the method, not its class', () => {
		const take = byId('src/limiter.ts#Limiter.take');

		expect(take).toMatchObject({ kind: 'method', change: 'modified', exported: true, startLine: 4, endLine: 10 });
		expect(take?.metrics).toEqual({ lines: 7, maxDepth: 1, params: 1 });
		expect(byId('src/limiter.ts#Limiter')).toBeUndefined();
	});

	test('an exported arrow-function const is an added function with its call names', () => {
		const limit = byId('src/limiter.ts#limit');

		expect(limit).toMatchObject({ kind: 'function', change: 'added', exported: true, startLine: 13, endLine: 15 });
		expect(limit?.signature).toBe('export const limit = (max: number, label: string) =>');
		expect(limit?.calls).toEqual(['take', 'Limiter']);
	});

	test('removed declarations come from the merge base with old-side lines', () => {
		expect(byId('src/limiter.ts#Limiter.drop')).toMatchObject({ change: 'deleted', startLine: 8, endLine: 10 });
		expect(byId('src/limiter.ts#helper')).toMatchObject({ change: 'deleted', kind: 'function', exported: false });
	});

	test('every hunk is indexed and symbols come in file then line order', () => {
		const hunkIds = built.inventory.files[0].hunks.map((hunk) => hunk.id);

		expect(Object.keys(model().byHunk).sort()).toEqual([...hunkIds].sort());

		expect(model().symbols.map((symbol) => symbol.startLine)).toEqual(
			[...model().symbols.map((symbol) => symbol.startLine)].sort((a, b) => a - b)
		);
	});

	test('symbolAt picks the innermost changed symbol on either side', () => {
		expect(symbolAt(model(), 'src/limiter.ts', 6)?.qualifiedName).toBe('Limiter.take');
		expect(symbolAt(model(), 'src/limiter.ts', 14)?.qualifiedName).toBe('limit');
		expect(symbolAt(model(), 'src/limiter.ts', 2)).toBeNull();
		expect(symbolAt(model(), 'src/limiter.ts', 9, 'old')?.qualifiedName).toBe('Limiter.drop');
		expect(symbolAt(model(), 'src/limiter.ts', 5, 'old')?.qualifiedName).toBe('Limiter.take');
	});

	test('the unit prompt block is deterministic and respects its cap', () => {
		const scope = [{ path: 'src/limiter.ts', hunkIds: [] }];
		const full = unitContext(model(), scope);

		expect(full).toContain('Limiter.take (method, modified, exported) src/limiter.ts:4-10');
		expect(unitContext(model(), scope)).toBe(full);
		expect(unitContext(model(), scope, 300).length).toBeLessThanOrEqual(300);
		expect(unitContext(model(), [{ path: 'other.ts', hunkIds: [] }])).toBe('');
	});
});

test('python methods are qualified by their class and lose self from their arity', async () => {
	const source = 'class Store:\n    def get(self, key, default=None):\n        return self.data.get(key, default)\n';
	const { model } = await buildFrom({}, { 'app/store.py': source });

	expect(model.symbols.map((symbol) => [symbol.qualifiedName, symbol.kind, symbol.metrics.params])).toEqual([
		['Store', 'class', 0],
		['Store.get', 'method', 2]
	]);
});

test('a svelte script symbol keeps its file line, and markup belongs to the component', async () => {
	const base =
		'<script lang="ts" generics="T extends Record<string, unknown>">\n\tlet count = 0;\n</script>\n\n<p>{count}</p>\n';

	const head =
		'<script lang="ts" generics="T extends Record<string, unknown>">\n\tlet count = 0;\n\n\tfunction bump() {\n\t\tcount++;\n\t}\n</script>\n\n<button onclick={bump}>{count}</button>\n';

	const { model } = await buildFrom({ 'ui/Counter.svelte': base }, { 'ui/Counter.svelte': head });

	expect(symbolAt(model, 'ui/Counter.svelte', 5)).toMatchObject({ qualifiedName: 'bump', startLine: 4, endLine: 6 });
	expect(symbolAt(model, 'ui/Counter.svelte', 9)).toMatchObject({ qualifiedName: 'Counter', kind: 'component' });
});

test('files without a grammar are listed as unparsed with empty hunk entries', async () => {
	const { model, inventory } = await buildFrom({}, { 'notes.txt': 'hello\n' });

	expect(model.unparsed).toEqual(['notes.txt']);
	expect(model.byHunk[inventory.files[0].hunks[0].id]).toEqual([]);
});

test('an added export keeps the test beside its module but is named by no other file', async () => {
	const { model, inventory } = await buildFrom(
		{},
		{
			'src/query/index.ts': [
				'export type ParsedQuery = Record<string, string>;',
				'',
				'export function parseQuery(input: string): ParsedQuery {',
				'\treturn Object.fromEntries(new URLSearchParams(input));',
				'}',
				''
			].join('\n'),
			'src/query/index.test.ts': ["import { parseQuery } from '.';", '', "parseQuery('a=1');", ''].join('\n')
		}
	);

	const dead = deadCodeResults(model, inventory).map((result) => result.symbol);

	expect(model.symbols.find((symbol) => symbol.name === 'ParsedQuery')?.tests).toEqual(['src/query/index.test.ts']);
	expect(dead).toEqual(['ParsedQuery']);
});

test('an added export whose name is too short to search for is never called unused', async () => {
	const { model, inventory } = await buildFrom(
		{},
		{
			'src/fn.ts': ['export function fn(): number {', '\treturn 1;', '}', ''].join('\n'),
			'src/caller.ts': ["import { fn } from './fn';", '', 'export const one = fn();', ''].join('\n'),
			'src/main.ts': ["import { one } from './caller';", '', 'console.log(one);', ''].join('\n')
		}
	);

	expect(model.symbols.find((symbol) => symbol.name === 'fn')?.usageUnknown).toBe(true);
	expect(deadCodeResults(model, inventory)).toEqual([]);
});
