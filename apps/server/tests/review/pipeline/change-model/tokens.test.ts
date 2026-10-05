import { expect, test } from 'bun:test';
import { normalizedTokens } from '../../../../src/review/pipeline/change-model/tokens';

const texts = async (path: string, source: string) =>
	(await normalizedTokens(path, source))?.map((token) => token.text);

test('renamed identifiers, changed literals and comments give the same tokens', async () => {
	const a = await texts(
		'a.ts',
		'// first\nexport function total(items: number[]) { return items.length + 1 + "x"; }\n'
	);

	const b = await texts(
		'b.ts',
		'export function count(xs: number[]) { /* note */ return xs.length + 2 + `y${xs}`; }\n'
	);

	expect(a).toEqual(b);
	expect(a?.slice(0, 4)).toEqual(['export', 'function', 'ID', '(']);
});

test('tokens carry their 1-based line', async () => {
	const tokens = await normalizedTokens('m.py', 'def f(a):\n    return a  # done\n');

	expect(tokens?.map((token) => `${token.text}@${token.line}`)).toEqual([
		'def@1',
		'ID@1',
		'(@1',
		'ID@1',
		')@1',
		':@1',
		'return@2',
		'ID@2'
	]);
});

test('unsupported files have no tokens', async () => {
	expect(await normalizedTokens('README.md', '# hi')).toBeNull();
});
