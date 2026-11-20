import { expect, test } from 'bun:test';
import { parseUnifiedDiff } from '../src/diff';
import { detectMoves } from '../src/diff-moves';

const lines = ['function value() {', '  const count = 1;', '  return count + 1;', '}'];

function patch(path: string, content: string[], added: boolean): string {
	return `diff --git a/${path} b/${path}\n--- ${added ? '/dev/null' : `a/${path}`}\n+++ ${added ? `b/${path}` : '/dev/null'}\n@@ -${added ? '0,0' : `1,${content.length}`} +${added ? `1,${content.length}` : '0,0'} @@\n${content.map((line) => `${added ? '+' : '-'}${line}`).join('\n')}`;
}

test('cross-file moves preserve old/new line ranges and reindentation is exact', () => {
	const result = detectMoves(
		parseUnifiedDiff(
			`${patch('old.ts', lines, false)}\n${patch(
				'new.ts',
				lines.map((line) => `  ${line}`),
				true
			)}`
		)
	);

	expect(result).toEqual([
		{
			fromPath: 'old.ts',
			fromLines: { start: 1, end: 4 },
			toPath: 'new.ts',
			toLines: { start: 1, end: 4 },
			kind: 'moved',
			exact: true,
			match: 'exact'
		}
	]);
});

test('ambiguous duplicate origins or destinations do not acquire move identities', () => {
	expect(
		detectMoves(
			parseUnifiedDiff(
				[patch('a.ts', lines, false), patch('b.ts', lines, false), patch('c.ts', lines, true)].join('\n')
			)
		)
	).toEqual([]);

	expect(
		detectMoves(
			parseUnifiedDiff([patch('a.ts', lines, false), patch('b.ts', lines, true), patch('c.ts', lines, true)].join('\n'))
		)
	).toEqual([]);
});

test('blank lines do not meet the three non-blank line threshold', () => {
	const short = ['const a = 1;', '', '', 'const b = 2;'];

	expect(detectMoves(parseUnifiedDiff(`${patch('a.ts', short, false)}\n${patch('b.ts', short, true)}`))).toEqual([]);
	expect(detectMoves([])).toEqual([]);
});

test('a block moved within the same file retains distinct old and new coordinates', () => {
	const content = ['const value = 1;', 'const next = value + 1;', 'consume(next);'];
	const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,4 +1,4 @@\n${content.map((line) => `-${line}`).join('\n')}\n keep\n${content.map((line) => `+${line}`).join('\n')}`;

	expect(detectMoves(parseUnifiedDiff(diff))).toMatchObject([
		{
			fromPath: 'a.ts',
			toPath: 'a.ts',
			kind: 'moved',
			exact: true,
			fromLines: { start: 1, end: 3 },
			toLines: { start: 2, end: 4 }
		}
	]);
});

test('one small edit is marked modified-small rather than hidden as pure movement', () => {
	const changed = lines.map((line) => line.replace('count + 1', 'count + 2'));
	const result = detectMoves(parseUnifiedDiff(`${patch('a.ts', lines, false)}\n${patch('b.ts', changed, true)}`));

	expect(result).toMatchObject([{ kind: 'moved', exact: false, match: 'modified-small' }]);
});

test('unchanged context can be the source of a copied block', () => {
	const diff = `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,4 +1,8 @@\n${lines.map((line) => ` ${line}`).join('\n')}\n${lines.map((line) => `+${line}`).join('\n')}`;

	expect(detectMoves(parseUnifiedDiff(diff))).toMatchObject([
		{ kind: 'copied', exact: true, fromLines: { start: 1, end: 4 }, toLines: { start: 5, end: 8 } }
	]);
});

test('changing a string literal spacing is not exact whitespace-only movement', () => {
	const original = ['function value() {', 'return "a b";', '}'];
	const changed = original.map((line) => line.replace('a b', 'a  b'));

	expect(
		detectMoves(parseUnifiedDiff(`${patch('a.ts', original, false)}\n${patch('b.ts', changed, true)}`))[0]?.exact
	).toBe(false);
});
