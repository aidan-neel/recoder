import { beforeAll, describe, expect, test } from 'bun:test';
import type { ContextOmission, OmissionReason } from '@recoder/shared';
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

/** A body-only change: same signature, no behavior callers rely on. */
const BODY = { 'src/rate.ts': 'export function rate(n: number): number {\n\treturn n * 3;\n}\n' };

/** Seven test files that import it: five fit the test cap. */
const TEST_FILES = Object.fromEntries(
	[...'mnopqrs'].map((name) => [
		`tests/${name}.test.ts`,
		`import { rate } from '../src/rate';\n\ntest('${name}', () => rate(1));\n`
	])
);

function callerCut(name: string, reason: OmissionReason): ContextOmission {
	return { kind: 'caller', path: `src/${name}.ts`, startLine: 3, symbol: 'rate', why: 'call outside the diff', reason };
}

function referenceAt(name: string, line: number): ContextOmission {
	return { kind: 'reference', path: `src/${name}.ts`, startLine: line, symbol: 'rate', reason: 'reference-cap' };
}

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

	test('records every caller past the cap, listed as a plain reference or not, with its reason', () => {
		const { supplied, omitted } = unitContextParts(first.model, SCOPE);

		expect(supplied.filter((item) => item.kind === 'reference').map((item) => item.path)).toEqual([
			'src/f.ts',
			'src/g.ts',
			'src/h.ts'
		]);

		expect(omitted.filter((item) => item.reason === 'caller-cap')).toEqual(
			CALLER_FILES.slice(5).map((name) => callerCut(name, 'caller-cap'))
		);
	});

	test('records every reference past the reference cap, calls before imports', () => {
		const { omitted } = unitContextParts(first.model, SCOPE);

		expect(omitted.filter((item) => item.reason === 'reference-cap')).toEqual([
			...CALLER_FILES.slice(8).map((name) => referenceAt(name, 3)),
			...CALLER_FILES.map((name) => referenceAt(name, 1))
		]);
	});

	test('records the call sites dropped to fit the block in, apart from those past the cap', () => {
		const { text, omitted } = unitContextParts(first.model, SCOPE, 700);

		expect(text).not.toContain('callers:');

		expect(omitted.filter((item) => item.reason !== 'reference-cap')).toEqual([
			...CALLER_FILES.slice(0, 5).map((name) => callerCut(name, 'context-cap')),
			...CALLER_FILES.slice(5).map((name) => callerCut(name, 'caller-cap'))
		]);
	});

	test('records a declaration the size cap leaves out', () => {
		const { text, supplied, omitted } = unitContextParts(first.model, SCOPE, 600);

		expect([text, supplied]).toEqual(['', []]);

		expect(omitted).toEqual([
			{ kind: 'source', path: 'src/rate.ts', startLine: 1, endLine: 3, symbol: 'rate', reason: 'context-cap' }
		]);
	});
});

describe('the context a body-only change supplies', () => {
	test('records every caller as left out because the contract did not change', async () => {
		const { model } = await buildFrom(BASE, BODY);
		const { text, omitted } = unitContextParts(model, SCOPE);

		expect(text).not.toContain('callers:');

		expect(omitted.filter((item) => item.reason !== 'reference-cap')).toEqual(
			CALLER_FILES.map((name) => callerCut(name, 'contract-unchanged'))
		);
	});

	test('records every test past the test cap', async () => {
		const { model } = await buildFrom({ ...BASE, ...TEST_FILES }, BODY);
		const { supplied, omitted } = unitContextParts(model, SCOPE);

		expect(supplied.filter((item) => item.kind === 'test').map((item) => item.path)).toEqual(
			[...'mnopq'].map((name) => `tests/${name}.test.ts`)
		);

		expect(omitted.filter((item) => item.reason === 'test-cap')).toEqual(
			['r', 's'].map((name) => ({ kind: 'test', path: `tests/${name}.test.ts`, symbol: 'rate', reason: 'test-cap' }))
		);
	});
});

describe('caller omissions with caller selection off and on', () => {
	const THROWS = {
		'src/rate.ts':
			"export function rate(n: number): number {\n\tif (n < 0) throw new Error('negative');\n\n\treturn n * 2;\n}\n"
	};

	/** Each caller found, as listed or with the reason it was left out. */
	function callerFates(parts: ReturnType<typeof unitContextParts>): string[] {
		const listed = parts.supplied.filter((item) => item.kind === 'caller').map((item) => `${item.path} listed`);
		const left = parts.omitted.filter((item) => item.kind === 'caller').map((item) => `${item.path} ${item.reason}`);

		return [...listed, ...left];
	}

	test('account for every caller either way, so their counts compare', async () => {
		const off = await buildFrom(BASE, THROWS, false);
		const on = await buildFrom(BASE, THROWS, true);

		expect(callerFates(unitContextParts(off.model, SCOPE))).toEqual(
			CALLER_FILES.map((name) => `src/${name}.ts contract-unchanged`)
		);

		expect(callerFates(unitContextParts(on.model, SCOPE))).toEqual([
			...CALLER_FILES.slice(0, 5).map((name) => `src/${name}.ts listed`),
			...CALLER_FILES.slice(5).map((name) => `src/${name}.ts caller-cap`)
		]);
	});
});
