import { beforeAll, describe, expect, test } from 'bun:test';
import { unitContext } from '../../../../src/review/pipeline/change-model/change-model';
import { changedAspects, dependence, docComment } from '../../../../src/review/pipeline/change-model/dependence';
import { unitContextParts } from '../../../../src/review/pipeline/change-model/lookup';
import { buildFrom, type Built } from './fixtures';

/** Five files that call `rate` and drop the result, then one that compares it, last in file order. */
const CALLERS = {
	...Object.fromEntries([...'abcde'].map((name) => [`src/${name}.ts`, `import { rate } from './rate';\n\nrate(1);\n`])),
	'src/z.ts': "import { rate } from './rate';\n\nexport const over = rate(1) > 2;\n"
};

const BASE = {
	'src/rate.ts':
		'/** Twice the count, never below zero. */\nexport function rate(n: number): number {\n\treturn Math.max(n * 2, 0);\n}\n',
	...CALLERS
};

const HEAD = {
	'src/rate.ts':
		'/** Twice the count, never below zero. */\nexport function rate(n: number): number {\n\treturn n * 2;\n}\n'
};

const SCOPE = [{ path: 'src/rate.ts', hunkIds: [] }];

describe('caller selection on a changed return value', () => {
	let off: Built;
	let on: Built;

	const rate = (built: Built) => built.model.symbols.find((symbol) => symbol.name === 'rate');
	const files = (refs: { file: string }[] | undefined) => refs?.map((ref) => ref.file);

	beforeAll(async () => {
		off = await buildFrom(BASE, HEAD, false);
		on = await buildFrom(BASE, HEAD, true);
	});

	test('off, the caller that uses the value is past the first five in file order and left out', () => {
		expect(files(rate(off)?.callers)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']);
		expect(files(rate(off)?.omittedCallers)).toEqual(['src/z.ts']);
		expect(rate(off)?.behavior).toBeUndefined();
	});

	test('on, that caller ranks first under the same cap, marked with what it relies on', () => {
		const callers = rate(on)?.callers;

		expect(files(callers)).toEqual(['src/z.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
		expect(callers?.[0].dependsOn).toEqual(['return value']);
		expect(callers?.slice(1).every((ref) => ref.dependsOn === undefined)).toBe(true);
		expect(files(rate(on)?.omittedCallers)).toEqual(['src/e.ts']);
	});

	test('on, the changed behavior and its documented contract sit next to the callers', () => {
		expect(rate(on)).toMatchObject({ behavior: ['return value'], doc: 'Twice the count, never below zero.' });

		const text = unitContext(on.model, SCOPE);

		expect(text).toContain('src/z.ts:3 [relies on: return value]');
		expect(text).toContain('documented: Twice the count, never below zero.');
	});

	test('on, the record says why the caller and the contract were supplied', () => {
		const { supplied } = unitContextParts(on.model, SCOPE);

		expect(supplied.find((item) => item.path === 'src/z.ts')?.why).toBe('relies on the changed return value');
		expect(supplied.find((item) => item.kind === 'contract')?.why).toBe('changed return value, documented');
	});

	test('off, a body change with the same signature shows no callers, as before', () => {
		expect(unitContext(off.model, SCOPE)).not.toContain('callers:');
	});

	test('RECODER_CALLER_SELECTION=1 turns it on when the build does not say', async () => {
		const before = process.env.RECODER_CALLER_SELECTION;

		process.env.RECODER_CALLER_SELECTION = '1';

		try {
			expect(files(rate(await buildFrom(BASE, HEAD))?.callers)?.[0]).toBe('src/z.ts');
		} finally {
			if (before === undefined) delete process.env.RECODER_CALLER_SELECTION;
			else process.env.RECODER_CALLER_SELECTION = before;
		}
	});
});

describe('changed aspects', () => {
	const symbol = { name: 'f', qualifiedName: 'f', kind: 'function' as const, file: 'f.ts', startLine: 1, endLine: 4 };

	const hunk = (lines: [type: 'add' | 'del' | 'context', text: string][]) => {
		let oldNo = 1;
		let newNo = 1;

		return {
			header: '@@',
			oldStart: 1,
			oldCount: 0,
			newStart: 1,
			newCount: 0,
			lines: lines.map(([type, text]) => ({
				type,
				text,
				oldNo: type === 'add' ? null : oldNo++,
				newNo: type === 'del' ? null : newNo++
			}))
		};
	};

	test('come from the lines changed inside the declaration, in a fixed order', () => {
		const changed = hunk([
			['context', 'export function f(items) {'],
			['del', '\treturn items;'],
			['add', '\tif (!items) throw new Error("none");'],
			['add', '\treturn items.sort();'],
			['context', '}'],
			['add', 'const ttl = 5;']
		]);

		expect(changedAspects({ ...symbol, signature: 'export function f(items)' }, [changed])).toEqual([
			'return value',
			'error',
			'ordering'
		]);
	});

	test('take a literal fallback as a default, but not a plain condition or callback', () => {
		const changed = hunk([
			['context', 'export function f(opts) {'],
			['add', '\tconst n = opts.n || 5;'],
			['add', '\tif (opts.a || opts.b) opts.items.forEach((item) => item.go());'],
			['context', '}']
		]);

		expect(changedAspects({ ...symbol, signature: 'export function f(opts)' }, [changed])).toEqual(['default']);
	});

	test('count a changed parameter default as a changed default', () => {
		expect(
			changedAspects({ ...symbol, signature: 'function f(n = 2)', previousSignature: 'function f(n = 1)' }, [])
		).toEqual(['default']);
	});
});

describe('call site dependence', () => {
	const relies = dependence('take', 2, ['default', 'return value', 'error', 'normalization']);
	const on = (text: string) => relies({ file: 'a.ts', line: 1, text });

	test('a call whose result is kept, compared or passed on relies on the value', () => {
		expect(on('const left = take(1, 2);')).toEqual(['return value', 'normalization']);
		expect(on('if (take(1, 2) > 0) {')).toEqual(['return value', 'normalization']);
		expect(on('return this.limiter.take(1, 2).trim();')).toEqual(['return value', 'normalization']);
	});

	test('a bare call relies on nothing, a short one on the default, a guarded one on the error', () => {
		expect(on('this.limiter.take(1, 2);')).toEqual([]);
		expect(on('take(1);')).toEqual(['default']);
		expect(on('try { take(1, 2); } catch {}')).toEqual(['error']);
	});
});

describe('doc comments', () => {
	test('take the comment block right above the declaration, without markers', () => {
		expect(docComment('/**\n * Waits.\n * Then gives up.\n */\nfunction f() {}', 5)).toBe('Waits. Then gives up.');
		expect(docComment('# Parses it.\ndef f():', 2)).toBe('Parses it.');
		expect(docComment('const a = 1;\nfunction f() {}', 2)).toBeUndefined();
	});
});
