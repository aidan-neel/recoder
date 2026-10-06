import { beforeAll, describe, expect, test } from 'bun:test';
import { symbolAt, unitContext } from '../../../../src/review/pipeline/change-model/change-model';
import { deadCodeResults } from '../../../../src/review/pipeline/detectors/symbols';
import { CASES } from './cases';
import { buildFrom, type Built } from './fixtures';

describe('typescript', () => {
	let built: Built;

	const model = () => built.model;
	const byId = (id: string) => built.model.symbols.find((symbol) => symbol.id === id);

	beforeAll(async () => {
		built = await buildFrom(CASES.limiterClass.base, CASES.limiterClass.head);
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
	const { model } = await buildFrom(CASES.pythonMethod.base, CASES.pythonMethod.head);

	expect(model.symbols.map((symbol) => [symbol.qualifiedName, symbol.kind, symbol.metrics.params])).toEqual([
		['Store', 'class', 0],
		['Store.get', 'method', 2]
	]);
});

test('a svelte script symbol keeps its file line, and markup belongs to the component', async () => {
	const { model } = await buildFrom(CASES.svelteScript.base, CASES.svelteScript.head);

	expect(symbolAt(model, 'ui/Counter.svelte', 5)).toMatchObject({ qualifiedName: 'bump', startLine: 4, endLine: 6 });
	expect(symbolAt(model, 'ui/Counter.svelte', 9)).toMatchObject({ qualifiedName: 'Counter', kind: 'component' });
});

test('files without a grammar are listed as unparsed with empty hunk entries', async () => {
	const { model, inventory } = await buildFrom(CASES.noGrammar.base, CASES.noGrammar.head);

	expect(model.unparsed).toEqual(['notes.txt']);
	expect(model.byHunk[inventory.files[0].hunks[0].id]).toEqual([]);
});

test('an added export keeps the test beside its module but is named by no other file', async () => {
	const { model, inventory } = await buildFrom(CASES.addedExport.base, CASES.addedExport.head);

	const dead = deadCodeResults(model, inventory).map((result) => result.symbol);

	expect(model.symbols.find((symbol) => symbol.name === 'ParsedQuery')?.tests).toEqual(['src/query/index.test.ts']);
	expect(dead).toEqual(['ParsedQuery']);
});

test('an added export whose name is too short to search for is never called unused', async () => {
	const { model, inventory } = await buildFrom(CASES.shortName.base, CASES.shortName.head);

	expect(model.symbols.find((symbol) => symbol.name === 'fn')?.usageUnknown).toBe(true);
	expect(deadCodeResults(model, inventory)).toEqual([]);
});
