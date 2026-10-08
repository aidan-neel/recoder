import { describe, expect, test } from 'bun:test';
import { parseUnifiedDiff } from '@recoder/shared';
import { diffGaps } from '../../src/lib/diff/diff-gaps';
import type { Finding } from '../../src/lib/findings/finding-model';

/** One hunk of six unchanged lines with a line added after the third. */
const hunk = (oldStart: number, newStart: number) => [
	`@@ -${oldStart},6 +${newStart},7 @@`,
	...[0, 1, 2].map((i) => ` l${oldStart + i}`),
	'+added',
	...[3, 4, 5].map((i) => ` l${oldStart + i}`)
];

/** Two hunks: new lines 1–7 (line 4 added) and 21–27 (line 24 added); 13 unchanged lines between. */
const diff = parseUnifiedDiff(
	['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', ...hunk(1, 1), ...hunk(20, 21), ''].join('\n')
)[0];

function finding(id: string, startLine: number, endLine = startLine): Finding {
	return {
		id,
		code: null,
		title: id,
		severity: 'medium',
		category: 'correctness',
		kind: 'bug',
		agent: 'reviewer',
		body: '',
		file: 'a.ts',
		startLine,
		endLine,
		status: 'open'
	};
}

const shape = (gaps: ReturnType<typeof diffGaps>) =>
	gaps.map((parts) => parts.map((part) => (part.kind === 'skip' ? part.count : part.findings.map((f) => f.id))));

describe('diffGaps', () => {
	test('counts the unchanged lines between hunks when every finding has a row', () => {
		expect(shape(diffGaps(diff, [finding('on-added', 4)]))).toEqual([[], [13], []]);
	});

	test('splits the gap around a finding on a line the diff has no row for', () => {
		const gaps = diffGaps(diff, [finding('control', 24), finding('off', 12)]);

		expect(shape(gaps)).toEqual([[], [4, ['off'], 8], []]);
		expect(gaps[1][1]).toMatchObject({ kind: 'outside', startLine: 12, endLine: 12 });
	});

	test('places findings before the first hunk and after the last, grouped by line', () => {
		const diff2 = { ...diff, hunks: [diff.hunks[1]] };
		const gaps = diffGaps(diff2, [finding('a', 5), finding('b', 3, 5), finding('c', 40)]);

		expect(shape(gaps)).toEqual([
			[2, ['a', 'b'], 15],
			[12, ['c']]
		]);

		expect(gaps[0][1]).toMatchObject({ startLine: 3, endLine: 5 });
	});
});
