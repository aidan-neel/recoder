import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The state of the harness code a report was made with: the commit, plus a
 * hash of every file that differed from it. A report made on a dirty tree
 * stays comparable, because the files that differed are known.
 */
export interface TreeState {
	commit: string;
	/** Content hash by repo-relative path, for every file that differs from `commit`; `deleted` for a removed one. */
	files: Record<string, string>;
}

/** What a report records about the code that made it. */
export interface HarnessRecord {
	/** The tree the report was written from. */
	tree: TreeState;
	/** The tree the reviewers last ran on; null when that is unknown, as for a report older than recording it. */
	reviewers: TreeState | null;
}

const DELETED = 'deleted';

function git(cwd: string, args: string[], input?: string): string | null {
	const result = Bun.spawnSync(['git', ...args], {
		cwd,
		stdin: input === undefined ? undefined : new TextEncoder().encode(input),
		stdout: 'pipe',
		stderr: 'pipe'
	});

	return result.exitCode === 0 ? result.stdout.toString() : null;
}

/** Paths that differ from `commit` in the working tree, untracked files included. */
function differingPaths(cwd: string, commit: string): string[] | null {
	const tracked = git(cwd, ['diff', '--name-only', '--no-renames', '-z', commit]);
	const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);

	if (tracked === null || untracked === null) return null;

	return [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))];
}

/** Whether two trees are the same state; two unknown trees are not. */
export function sameTree(a: TreeState | null | undefined, b: TreeState | null | undefined): boolean {
	return Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);
}

/** The working tree's state against HEAD, or null outside a git checkout. */
export function captureTree(cwd: string): TreeState | null {
	const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
	const commit = root ? git(root, ['rev-parse', 'HEAD'])?.trim() : null;
	const paths = root && commit ? differingPaths(root, commit) : null;

	if (!root || !commit || !paths) return null;

	const present = paths.filter((path) => existsSync(join(root, path)));
	const hashes = present.length ? (git(root, ['hash-object', '--stdin-paths'], `${present.join('\n')}\n`) ?? '') : '';
	const hashed = new Map(present.map((path, index) => [path, hashes.split('\n')[index] ?? DELETED]));

	return { commit, files: Object.fromEntries(paths.map((path) => [path, hashed.get(path) ?? DELETED])) };
}

/**
 * The paths whose content differs between two states of the tree. A path
 * missing from `files` has the content of its own commit, so two states on
 * different commits compare through `between`, the paths those commits differ in.
 */
function changedPaths(before: TreeState, after: TreeState, between: string[]): string[] {
	if (before.commit === after.commit) {
		const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);

		return [...paths].filter((path) => before.files[path] !== after.files[path]).sort();
	}

	return [...new Set([...between, ...Object.keys(before.files), ...Object.keys(after.files)])].sort();
}

/** The paths that differ between the commit `before` is on and `after`'s working tree, null when git cannot say. */
export function pathsSince(cwd: string, before: TreeState, after: TreeState): string[] | null {
	if (before.commit === after.commit) return changedPaths(before, after, []);

	const root = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
	const between = root ? git(root, ['diff', '--name-only', '--no-renames', '-z', before.commit, after.commit]) : null;

	return between === null ? null : changedPaths(before, after, between.split('\0').filter(Boolean));
}
