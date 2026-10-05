import { beforeAll, describe, expect, test } from 'bun:test';
import { unitContext } from '../../../../src/review/pipeline/change-model/change-model';
import { buildFrom, type Built } from './fixtures';

const BASE_LIMITER = ['export function take(n: number): boolean {', '\treturn n > 0;', '}', ''].join('\n');

const HEAD_LIMITER = [
	'export function take(n: number, label: string): boolean {',
	'\treturn n > 0 && label.length > 0;',
	'}',
	''
].join('\n');

const UNCHANGED = {
	'src/use.ts': ["import { take } from './limiter';", '', 'export const ok = take(3);', ''].join('\n'),
	'src/bag.ts': [
		'export class Bag {',
		'\ttake(): number {',
		'\t\treturn 1;',
		'\t}',
		'}',
		'',
		'export const one = new Bag().take();',
		''
	].join('\n'),
	'src/notes.ts': ['// take the lock before writing', "export const label = 'take';", ''].join('\n'),
	'tests/limiter.test.ts': ["import { take } from '../src/limiter';", '', "console.log(take(1, 'a'));", ''].join('\n')
};

describe('a signature change', () => {
	let built: Built;

	const take = () => built.model.symbols.find((symbol) => symbol.name === 'take' && symbol.file === 'src/limiter.ts');

	beforeAll(async () => {
		built = await buildFrom(
			{ 'src/limiter.ts': BASE_LIMITER, ...UNCHANGED },
			{ 'src/limiter.ts': HEAD_LIMITER, ...UNCHANGED }
		);
	});

	test('lists a call in an importing file as a call, then the test', () => {
		expect(take()?.callers?.map((ref) => [ref.file, ref.line, ref.kind])).toEqual([
			['src/use.ts', 3, 'call'],
			['tests/limiter.test.ts', 3, 'test']
		]);
	});

	test('does not list a same-name method in a file that never imports the module', () => {
		expect(take()?.callers?.some((ref) => ref.file === 'src/bag.ts')).toBe(false);
	});

	test('keeps that unrelated call as a reference, since the file might reach the symbol another way', () => {
		const bag = take()?.references.filter((ref) => ref.file === 'src/bag.ts');

		expect(bag?.map((ref) => ref.line)).toEqual([7]);
	});

	test('ignores the word in a comment or a string literal', () => {
		expect(take()?.references.some((ref) => ref.file === 'src/notes.ts')).toBe(false);
	});

	test('renders the current and previous signature with the call sites', () => {
		const text = unitContext(built.model, [{ path: 'src/limiter.ts', hunkIds: [] }]);

		expect(text).toContain('contract: export function take(n: number, label: string): boolean (was: export function');
		expect(text).toContain('src/use.ts:3 export const ok = take(3);');
		expect(text).toContain('tests/limiter.test.ts:3 [test]');
		expect(text).not.toContain('signature:');
	});
});

test('an import of the folder reaches its index file', async () => {
	const { model } = await buildFrom(
		{
			'src/q/index.ts': 'export function parse(a: string) {\n\treturn a;\n}\n',
			'src/main.ts': "import { parse } from './q';\nparse('x');\n"
		},
		{
			'src/q/index.ts': 'export function parse(a: string, b: string) {\n\treturn a + b;\n}\n',
			'src/main.ts': "import { parse } from './q';\nparse('x');\n"
		}
	);

	expect(model.symbols[0].callers?.map((ref) => [ref.file, ref.kind])).toEqual([['src/main.ts', 'call']]);
});

test('a name whose real use sits past a file of comment-only matches stays unknown, not unused', async () => {
	const decoys = Array.from({ length: 5 }, () => '// take the lock').join('\n');

	const { model } = await buildFrom(
		{ 'src/limiter.ts': BASE_LIMITER, 'src/use.ts': `${decoys}\nimport { take } from './limiter';\ntake(3);\n` },
		{ 'src/limiter.ts': HEAD_LIMITER, 'src/use.ts': `${decoys}\nimport { take } from './limiter';\ntake(3);\n` }
	);

	const text = unitContext(model, [{ path: 'src/limiter.ts', hunkIds: [] }]);

	expect(model.symbols[0].usageUnknown).toBe(true);
	expect(text).toContain('not fully searched');
	expect(text).not.toContain('callers: none found');
});
