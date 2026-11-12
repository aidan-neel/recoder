import { parseUnifiedDiff, type DiffHunk, type DiffLine, type FileDiff, type Finding } from '@recoder/shared';

/** A review's pull request diff by file path. */
export type DiffFiles = ReadonlyMap<string, FileDiff>;

/**
 * What the commits between two reviews did to a finding's code, read from the
 * two pull request diffs. `untouched`: its hunk reads the same, perhaps moved
 * by `lineShift` lines. `touched`: its hunk changed, or the earlier diff did
 * not show it, so nothing says it is the same. `gone`: the pull request no
 * longer changes its file.
 */
export type CodeChange = { kind: 'untouched'; lineShift: number } | { kind: 'touched' } | { kind: 'gone' };

/** The diff's files by path. */
export function diffFiles(diff: string): DiffFiles {
	return new Map(parseUnifiedDiff(diff).map((file) => [file.path, file]));
}

/** Every line the diff shows of `file`, hunk after hunk; none when the diff does not change it. */
export function diffLines(files: DiffFiles, file: string): DiffLine[] {
	return files.get(file)?.hunks.flatMap((hunk) => hunk.lines) ?? [];
}

/** The text of the finding's line on its side, empty when the diff does not show it. */
export function lineText(files: DiffFiles, finding: Finding): string {
	const { line } = finding;

	if (!line) return '';

	const side = finding.side ?? 'new';

	return (
		diffLines(files, finding.file).find((entry) => (side === 'old' ? entry.oldNo : entry.newNo) === line)?.text ?? ''
	);
}

/**
 * What the commits since the earlier review did to the finding's code. The
 * hunk around the finding stands for its code, not the line alone, so a guard
 * added just above it counts as touching it.
 */
export function codeChange(before: DiffFiles, after: DiffFiles, finding: Finding): CodeChange {
	const earlier = before.get(finding.file);
	const later = after.get(finding.file);

	const { line } = finding;

	if (!earlier) return { kind: 'touched' };
	if (!later) return { kind: 'gone' };
	if (!line) return sameHunks(earlier.hunks, later.hunks) ? { kind: 'untouched', lineShift: 0 } : { kind: 'touched' };

	const side = finding.side ?? 'new';
	const hunk = earlier.hunks.find((candidate) => holds(candidate, line, side));
	const match = hunk && later.hunks.find((candidate) => hunkText(candidate) === hunkText(hunk));

	if (!hunk || !match) return { kind: 'touched' };

	return { kind: 'untouched', lineShift: startOn(match, side) - startOn(hunk, side) };
}

/** The finding moved by `lineShift` lines, as its untouched code moved. */
export function shifted(finding: Finding, lineShift: number): Finding {
	if (!lineShift || !finding.line) return finding;

	return {
		...finding,
		line: finding.line + lineShift,
		...(finding.endLine ? { endLine: finding.endLine + lineShift } : {})
	};
}

/** Where the hunk starts on `side`. */
function startOn(hunk: DiffHunk, side: 'old' | 'new'): number {
	return side === 'old' ? hunk.oldStart : hunk.newStart;
}

/** Whether the hunk spans `line` on `side`. */
function holds(hunk: DiffHunk, line: number, side: 'old' | 'new'): boolean {
	const count = side === 'old' ? hunk.oldCount : hunk.newCount;
	const start = startOn(hunk, side);

	return line >= start && line < start + Math.max(count, 1);
}

/** What the hunk changes, line by line, without its position. */
function hunkText(hunk: DiffHunk): string {
	return hunk.lines.map((line) => `${line.type}:${line.text}`).join('\n');
}

/** Whether two files' hunks change the same lines in the same order, wherever they sit. */
function sameHunks(a: DiffHunk[], b: DiffHunk[]): boolean {
	return JSON.stringify(a.map(hunkText)) === JSON.stringify(b.map(hunkText));
}
