import { beforeAll, describe, expect, test } from 'bun:test';
import { unitContextParts } from '../../../../src/review/pipeline/change-model/lookup';
import { buildFrom, type Built } from './fixtures';

/** Twelve importing files: five fit the caller cap, three more the reference list, and four neither. */
const CALLER_FILES = [...'abcdefghijkl'];

const callers = Object.fromEntries(
	CALLER_FILES.map((name) => [`src/${name}.ts`, `import { rate } from './rate';\n\nexport const ${name} = rate(1);\n`])
);

const BASE = { 'src/rate.ts': 'export function rate(n: number): number {\n\treturn n * 2;\n}\n', ...callers };
const HEAD = { 'src/rate.ts': 'export function rate(n: number, per = 1): number {\n\treturn (n * 2) / per;\n}\n' };
const SCOPE = [{ path: 'src/rate.ts', hunkIds: [] }];

describe('the context a signature change supplies', () => {
	let first: Built;
	let second: Built;

	beforeAll(async () => {
		first = await buildFrom(BASE, HEAD);
		second = await buildFrom(BASE, HEAD);
	});

	test('is identical when the same change is supplied twice', () => {
		expect(unitContextParts(second.model, SCOPE)).toEqual(unitContextParts(first.model, SCOPE));
	});

	test('lists the declaration, its contract and the first five callers', () => {
		const { supplied } = unitContextParts(first.model, SCOPE);

		expect(supplied.slice(0, 2).map((item) => [item.kind, item.path, item.why])).toEqual([
			['source', 'src/rate.ts', undefined],
			['contract', 'src/rate.ts', 'signature or export changed']
		]);

		expect(supplied.filter((item) => item.kind === 'caller').map((item) => item.path)).toEqual(
			CALLER_FILES.slice(0, 5).map((name) => `src/${name}.ts`)
		);
	});

	test('records each caller past the cap that the prompt does not list as a reference, with its reason', () => {
		const { supplied, omitted } = unitContextParts(first.model, SCOPE);

		expect(supplied.filter((item) => item.kind === 'reference').map((item) => item.path)).toEqual([
			'src/f.ts',
			'src/g.ts',
			'src/h.ts'
		]);

		expect(omitted).toEqual(
			['i', 'j', 'k', 'l'].map((name) => ({
				kind: 'caller',
				path: `src/${name}.ts`,
				startLine: 3,
				symbol: 'rate',
				why: 'call outside the diff',
				reason: 'caller-cap'
			}))
		);
	});

	test('records a declaration the size cap leaves out', () => {
		const { text, supplied, omitted } = unitContextParts(first.model, SCOPE, 600);

		expect([text, supplied]).toEqual(['', []]);

		expect(omitted).toEqual([
			{ kind: 'source', path: 'src/rate.ts', startLine: 1, endLine: 3, symbol: 'rate', reason: 'context-cap' }
		]);
	});
});
