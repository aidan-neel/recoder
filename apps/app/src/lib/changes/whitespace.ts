import type { DiffHunk, DiffLine, FileDiff } from '@recoder/shared';

/** A line's text with every run of whitespace removed, so re-indented code compares equal. */
function bare(text: string): string {
	return text.replace(/\s+/g, '');
}

/**
 * One block of removed lines and the added lines after it, with each pair that differs only in whitespace folded
 * into one unchanged line (the added text, both numbers). Pairs are matched in order by their longest common run,
 * so a moved line stays a change.
 */
function foldBlock(dels: DiffLine[], adds: DiffLine[]): DiffLine[] {
	const same = dels.map(() => adds.map(() => 0));

	for (let d = dels.length - 1; d >= 0; d -= 1) {
		for (let a = adds.length - 1; a >= 0; a -= 1) {
			same[d][a] =
				bare(dels[d].text) === bare(adds[a].text)
					? 1 + (same[d + 1]?.[a + 1] ?? 0)
					: Math.max(same[d + 1]?.[a] ?? 0, same[d][a + 1] ?? 0);
		}
	}

	const out: DiffLine[] = [];
	const left: DiffLine[] = [];
	const right: DiffLine[] = [];
	let d = 0;
	let a = 0;

	while (d < dels.length && a < adds.length) {
		if (bare(dels[d].text) === bare(adds[a].text)) {
			out.push(...left.splice(0), ...right.splice(0), { ...adds[a], type: 'context', oldNo: dels[d].oldNo });
			d += 1;
			a += 1;
		} else if ((same[d + 1]?.[a] ?? 0) >= (same[d][a + 1] ?? 0)) left.push(dels[d++]);
		else right.push(adds[a++]);
	}

	return [...out, ...left, ...dels.slice(d), ...right, ...adds.slice(a)];
}

/** The hunk with whitespace-only changes folded into unchanged lines. */
function foldHunk(hunk: DiffHunk): DiffHunk {
	const lines: DiffLine[] = [];
	let at = 0;

	while (at < hunk.lines.length) {
		if (hunk.lines[at].type === 'context') {
			lines.push(hunk.lines[at++]);

			continue;
		}

		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];

		while (at < hunk.lines.length && hunk.lines[at].type === 'del') dels.push(hunk.lines[at++]);
		while (at < hunk.lines.length && hunk.lines[at].type === 'add') adds.push(hunk.lines[at++]);

		lines.push(...foldBlock(dels, adds));
	}

	return { ...hunk, lines };
}

/**
 * The file's diff without changes that only touch whitespace, as `git diff -w` shows it: such a line pair reads as
 * one unchanged line, and the counts follow. A hunk left with no change stays, so the code around it still reads.
 */
export function withoutWhitespace(file: FileDiff): FileDiff {
	const hunks = file.hunks.map(foldHunk);
	const lines = hunks.flatMap((hunk) => hunk.lines);

	return {
		...file,
		hunks,
		additions: lines.filter((line) => line.type === 'add').length,
		deletions: lines.filter((line) => line.type === 'del').length
	};
}
