import { beforeAll, describe, expect, test } from 'bun:test';
import { unitContext } from '../../../../src/review/pipeline/change-model/change-model';
import { CASES } from './cases';
import { buildFrom, type Built } from './fixtures';

describe('a signature change', () => {
	let built: Built;

	const take = () => built.model.symbols.find((symbol) => symbol.name === 'take' && symbol.file === 'src/limiter.ts');

	beforeAll(async () => {
		built = await buildFrom(CASES.signatureChange.base, CASES.signatureChange.head);
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
	const { model } = await buildFrom(CASES.folderImport.base, CASES.folderImport.head);

	expect(model.symbols[0].callers?.map((ref) => [ref.file, ref.kind])).toEqual([['src/main.ts', 'call']]);
});

test('a name whose real use sits past a file of comment-only matches stays unknown, not unused', async () => {
	const { model } = await buildFrom(CASES.decoyedUse.base, CASES.decoyedUse.head);

	const text = unitContext(model, [{ path: 'src/limiter.ts', hunkIds: [] }]);

	expect(model.symbols[0].usageUnknown).toBe(true);
	expect(text).toContain('not fully searched');
	expect(text).not.toContain('callers: none found');
});
