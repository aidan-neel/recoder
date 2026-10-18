import type { FileDiff } from '@recoder/shared';

/**
 * How much of a person's attention a changed file asks for. `read`: it holds
 * an open decision or no reviewer examined it. `checked`: reviewers examined
 * it and left nothing open. `tests`: test code, which is evidence rather than
 * behavior. `skim`: lockfiles, generated output and docs.
 */
export type FileClass = 'read' | 'checked' | 'tests' | 'skim';

const SKIM = [
	/(^|\/)(bun\.lock|bun\.lockb|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock)$/,
	/(^|\/)(dist|build|generated|__generated__|\.svelte-kit|vendor)\//,
	/\.(snap|min\.js|map|lock)$/,
	/\.(md|mdx|txt|rst)$/,
	/(^|\/)(LICENSE|CHANGELOG|\.gitignore|\.prettierrc[^/]*|\.editorconfig)$/
];

const TESTS = [
	/(^|\/)(tests?|__tests__|spec|e2e)\//,
	/\.(test|spec)\.[cm]?[jt]sx?$/,
	/_test\.(go|py)$/,
	/(^|\/)test_[^/]+\.py$/
];

/** Whether a path is mechanical (`skim`), test code (`tests`), or behavior. */
export function pathClass(path: string): 'skim' | 'tests' | 'code' {
	if (SKIM.some((re) => re.test(path))) return 'skim';
	if (TESTS.some((re) => re.test(path))) return 'tests';

	return 'code';
}

/** Lines a person reads in a file: every added and deleted line. */
export function changedLines(file: Pick<FileDiff, 'additions' | 'deletions'>): number {
	return file.additions + file.deletions;
}

/** Lines either side of a flagged range a person reads to judge it. */
const READ_RADIUS = 10;

/**
 * Changed lines a person reads to judge `line..endLine`: those within
 * `READ_RADIUS` of the range, inside the hunks that hold it, on the new side
 * (the old side for deleted code). With no line, every changed line.
 */
export function readingLines(
	file: FileDiff,
	line: number | null,
	endLine: number | null,
	side: 'old' | 'new'
): Set<string> {
	const keys = new Set<string>();
	const from = line === null ? -Infinity : line - READ_RADIUS;
	const to = line === null ? Infinity : (endLine ?? line) + READ_RADIUS;

	file.hunks.forEach((hunk, index) => {
		hunk.lines.forEach((diffLine, at) => {
			const no =
				(side === 'old' ? diffLine.oldNo : diffLine.newNo) ?? (side === 'old' ? diffLine.newNo : diffLine.oldNo);

			if (diffLine.type !== 'context' && no !== null && no >= from && no <= to) keys.add(`${index}:${at}`);
		});
	});

	return keys;
}

/** True for a file the change creates: every hunk starts from nothing on the old side. */
export function isNewFile(file: FileDiff): boolean {
	return file.hunks.length > 0 && file.hunks.every((hunk) => hunk.oldStart === 0 && hunk.oldCount === 0);
}
