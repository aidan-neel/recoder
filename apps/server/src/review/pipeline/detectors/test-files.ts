import type { FileDiff } from '@recoder/shared';
import type { ReviewRevision } from '../../../evidence/evidence.js';
import { isTestPath } from '../change-model/test-files.js';
import type { ReviewInventory } from '../inventory.js';
import type { AddedLines } from './changed-lines.js';
import { readFilesAt } from './repo-files.js';

/** One test file at the merge base and the PR head, plus the diff's new-side lines. */
export interface TestFileVersions {
	path: string;
	base: string;
	head: string;
	/** New-side line numbers the diff adds, with context lines around them. */
	added: ReadonlySet<number>;
	visible: ReadonlySet<number>;
}

/** Test files run long and are written by hand, so they get a higher limit than generated or data files. */
const MAX_TEST_BYTES = 400_000;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Whether this path is a JS or TS test file the test detectors can read. */
function isScriptTest(path: string): boolean {
	return SOURCE_FILE.test(path) && isTestPath(path);
}

/** New-side line numbers each changed path's hunks show, added and context alike. */
function visibleLines(diffs: FileDiff[]): Map<string, Set<number>> {
	return new Map(
		diffs.map((diff) => [
			diff.path,
			new Set(diff.hunks.flatMap((hunk) => hunk.lines.flatMap((line) => (line.newNo === null ? [] : [line.newNo]))))
		])
	);
}

/**
 * Every added or edited JS or TS test file the review covers, at the merge
 * base and the PR head. An added file's base is empty. Files over the test size
 * limit are left out.
 */
export async function readTestFiles(input: {
	inventory: ReviewInventory;
	added: AddedLines;
	revision: ReviewRevision | null | undefined;
	signal: AbortSignal;
}): Promise<TestFileVersions[]> {
	const { inventory, added, revision, signal } = input;

	const files = inventory.files.filter(
		(file) =>
			!file.excludeReason &&
			(file.status === 'added' || file.status === 'modified' || file.status === 'renamed') &&
			isScriptTest(file.path)
	);

	if (!revision || !files.length) return [];

	const edited = files.filter((file) => file.status !== 'added');

	const [bases, heads] = await Promise.all([
		readFilesAt(
			revision.checkoutPath,
			revision.mergeBaseSha,
			edited.map((file) => file.oldPath ?? file.path),
			signal
		),
		readFilesAt(
			revision.checkoutPath,
			revision.headSha,
			files.map((file) => file.path),
			signal
		)
	]);

	const visible = visibleLines(inventory.diffs);

	return files.flatMap((file) => {
		const base = file.status === 'added' ? '' : bases.get(file.oldPath ?? file.path);
		const head = heads.get(file.path);

		if (base === undefined || head === undefined) return [];
		if (base.length > MAX_TEST_BYTES || head.length > MAX_TEST_BYTES) return [];

		return [
			{
				path: file.path,
				base,
				head,
				added: new Set(added.get(file.path)?.keys()),
				visible: visible.get(file.path) ?? new Set()
			}
		];
	});
}
