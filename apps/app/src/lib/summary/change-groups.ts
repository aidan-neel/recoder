import type { ChangeGroup, FileDiff } from '@recoder/shared';

import type { BugView } from '../bugs/types';
import { severityCounts, type SeverityCount } from './bug-tones';

/** One changed file of a group, with its size once the diff has loaded. */
interface GroupFile {
	path: string;
	additions?: number;
	deletions?: number;
}

/** One group of the description as the tab shows it: its files and size, and the open findings in its files. */
export interface GroupView {
	group: ChangeGroup;
	files: GroupFile[];
	/** Lines added and removed across its files; null until the diff has loaded. */
	size: { additions: number; deletions: number } | null;
	findings: BugView[];
	/** The worst severity among its findings, counted (`1 high`); null when it has none. */
	worst: SeverityCount | null;
}

/** The description's groups with what the diff and the review know about their files. */
export function groupViews(
	groups: readonly ChangeGroup[],
	diff: readonly FileDiff[] | null,
	open: readonly BugView[]
): GroupView[] {
	const sizes = new Map((diff ?? []).map((file) => [file.path, file]));

	return groups.map((group) => {
		const files = group.paths.map((path) => ({
			path,
			additions: sizes.get(path)?.additions,
			deletions: sizes.get(path)?.deletions
		}));

		const findings = open.filter((bug) => group.paths.includes(bug.file));

		return {
			group,
			files,
			size: diff ? sizeOf(files) : null,
			findings,
			worst: severityCounts(findings)[0] ?? null
		};
	});
}

function sizeOf(files: readonly GroupFile[]): { additions: number; deletions: number } {
	return {
		additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
		deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
	};
}
