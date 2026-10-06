import type { DiffLine, FileDiff } from '$lib/diff/diff';
import type { Finding } from '$lib/findings/findings.svelte';
import { compareSeverity } from '$lib/findings/severity';

/** A hunk of a file diff. */
type DiffHunk = FileDiff['hunks'][number];

/** One side of a split-view row: the line and its index within the hunk. */
interface SplitCell {
	line: DiffLine;
	i: number;
}

/** A split-view row; either side is empty where the other has no counterpart. */
interface SplitRow {
	left: SplitCell | null;
	right: SplitCell | null;
}

/** A line flattened out of its hunk, aligned 1:1 with the rendered diff rows. */
export interface FlatLine {
	line: DiffLine;
	hunk: DiffHunk;
}

/** Index of each hunk's first line within the flat line list. */
export function hunkOffsets(diff: FileDiff): number[] {
	return diff.hunks.reduce<number[]>((acc, hunk, i) => {
		acc.push(i === 0 ? 0 : acc[i - 1] + diff.hunks[i - 1].lines.length);

		return acc;
	}, []);
}

/** Side-by-side rows: context on both sides, deletions paired with the additions that follow. */
export function splitRows(hunk: DiffHunk): SplitRow[] {
	const rows: SplitRow[] = [];
	let dels: SplitCell[] = [];
	let adds: SplitCell[] = [];

	const flush = () => {
		for (let k = 0; k < Math.max(dels.length, adds.length); k++)
			rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
		dels = [];
		adds = [];
	};

	hunk.lines.forEach((line, i) => {
		if (line.type === 'del') {
			if (adds.length) flush();
			dels.push({ line, i });
		} else if (line.type === 'add') adds.push({ line, i });
		else {
			flush();
			rows.push({ left: { line, i }, right: { line, i } });
		}
	});

	flush();

	return rows;
}

/** Flat line list with its hunk. */
export function flattenLines(diff: FileDiff): FlatLine[] {
	return diff.hunks.flatMap((hunk) => hunk.lines.map((line) => ({ line, hunk })));
}

/** Items grouped by the line their card renders under. */
export function groupByEndLine<T extends { endLine: number }>(items: T[]): Map<number, T[]> {
	const map = new Map<number, T[]>();

	for (const item of items) {
		const list = map.get(item.endLine) ?? [];

		list.push(item);
		map.set(item.endLine, list);
	}

	return map;
}

/** Strongest open finding per new-side line, for row markers. */
export function strongestPerLine(findings: Finding[]): Map<number, Finding> {
	const map = new Map<number, Finding>();

	for (const finding of findings) {
		if (finding.status === 'dismissed') continue;

		for (let n = finding.startLine; n <= finding.endLine; n++) {
			const current = map.get(n);

			if (!current || compareSeverity(finding, current) < 0) {
				map.set(n, finding);
			}
		}
	}

	return map;
}

/** Full-row wash for highlighted lines (findings, notes, the selected range). */
export function rowTint(color: string, percent: number): string {
	return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}
