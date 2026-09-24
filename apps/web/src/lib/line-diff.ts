import type { FileDiffLine } from '@sivir-ui/svelte/components/file-diff';

/**
 * Line diff of two texts (LCS), as rows for Sivir FileDiff. Guidelines are a
 * few hundred lines at most, so the quadratic table is fine.
 */
export function lineDiff(before: string, after: string): FileDiffLine[] {
	const a = before.replace(/\n$/, '').split('\n');
	const b = after.replace(/\n$/, '').split('\n');
	if (before === '') a.length = 0;
	if (after === '') b.length = 0;
	const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const rows: FileDiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			rows.push({ type: 'context', oldLineNumber: i + 1, newLineNumber: j + 1, content: a[i] });
			i++;
			j++;
		} else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
			// Removals before additions within a change, as unified diffs read.
			rows.push({ type: 'remove', oldLineNumber: i + 1, content: a[i] });
			i++;
		} else {
			rows.push({ type: 'add', newLineNumber: j + 1, content: b[j] });
			j++;
		}
	}
	return rows;
}
