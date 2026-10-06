import type { FileDiff } from '$lib/diff/diff';
import type { Finding } from '$lib/findings/findings.svelte';

/** Part of the stretch between two hunks: a run of unchanged lines, or findings on lines the diff has no row for. */
export type GapPart =
	{ kind: 'skip'; count: number } | { kind: 'outside'; startLine: number; endLine: number; findings: Finding[] };

/** Findings whose card line has no row in the diff, grouped by that line in file order. */
function outsideGroups(diff: FileDiff, findings: Finding[]): Finding[][] {
	const shown = new Set(diff.hunks.flatMap((hunk) => hunk.lines.flatMap((line) => line.newNo ?? [])));
	const groups = new Map<number, Finding[]>();

	for (const finding of findings) {
		if (shown.has(finding.endLine)) continue;
		groups.set(finding.endLine, [...(groups.get(finding.endLine) ?? []), finding]);
	}

	return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

/** The unchanged lines `from` to `to` (new side), when there are any. */
function unchangedBetween(from: number, to: number): GapPart[] {
	return to >= from ? [{ kind: 'skip', count: to - from + 1 }] : [];
}

/**
 * What renders before each hunk, plus one entry after the last. Between hunks that is the count of unchanged lines.
 * Without a checkout the diff is only its hunks, so a finding on an unchanged line elsewhere gets an `outside` row
 * where its line falls, with the unchanged lines counted either side, and is never hidden.
 */
export function diffGaps(diff: FileDiff, findings: Finding[]): GapPart[][] {
	const groups = outsideGroups(diff, findings);
	const count = diff.hunks.length;

	return Array.from({ length: count + 1 }, (_, i) => {
		const prev = diff.hunks[i - 1];
		const next = diff.hunks[i];
		const from = prev ? prev.newStart + prev.newCount : 1;

		const here = groups.filter(
			(group) => group[0].endLine < (next?.newStart ?? Infinity) && (!prev || group[0].endLine >= prev.newStart)
		);

		if (!here.length) {
			const skipped = prev && next ? Math.max(0, next.oldStart - (prev.oldStart + prev.oldCount)) : 0;

			return skipped > 0 ? [{ kind: 'skip', count: skipped }] : [];
		}

		const parts: GapPart[] = [];
		let cursor = from;

		for (const group of here) {
			const endLine = group[0].endLine;
			const startLine = Math.min(endLine, Math.max(cursor, Math.min(...group.map((finding) => finding.startLine))));

			parts.push(...unchangedBetween(cursor, startLine - 1));
			parts.push({ kind: 'outside', startLine, endLine, findings: group });
			cursor = endLine + 1;
		}

		if (next) parts.push(...unchangedBetween(cursor, next.newStart - 1));

		return parts;
	});
}
