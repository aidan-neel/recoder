import { byCodePoint } from '@recoder/shared';
import { git } from '../../../evidence/git.js';
import { classifyPath, extraExcludes, packageBoundary, type FileClassification } from '../review-scope.js';

/** A regular file tracked at the reviewed commit. */
export interface RepoFile {
	path: string;
	/** The blob id. The same content has the same id at every commit, so facts about it carry across pull requests. */
	blob: string;
	size: number;
	language: string | null;
	classification: FileClassification;
	packageId: string | null;
	excludeReason?: string;
}

/**
 * Every regular file at one commit, listed once per review for each stage
 * that reads past the diff: the change model, obligations, detectors and the
 * reviewers' repo map. Symlinks and submodules are left out.
 */
export interface RepoInventory {
	/** The commit the files were listed at. */
	revision: string;
	/** Sorted by code point, so every reader walks them in the same order. */
	files: RepoFile[];
	byPath: Map<string, RepoFile>;
}

const REGULAR_MODES = new Set(['100644', '100755']);

/** The regular files at `revision` (a commit sha, or `HEAD` for a checkout without one), read from git objects. */
export async function loadRepoInventory(
	root: string,
	revision: string,
	signal: AbortSignal,
	extras: string[] = extraExcludes()
): Promise<RepoInventory> {
	const listed = await git(root, ['ls-tree', '-r', '-z', '-l', revision], signal);

	if (listed.code !== 0) throw new Error(`git ls-tree ${revision} failed: ${listed.stderr.slice(0, 300)}`);

	const files = parseTree(listed.stdout)
		.map((entry) => repoFile(entry, extras))
		.sort((a, b) => byCodePoint(a.path, b.path));

	return { revision, files, byPath: new Map(files.map((file) => [file.path, file])) };
}

/** The paths of every file, in inventory order. */
export function repoPaths(repo: RepoInventory): string[] {
	return repo.files.map((file) => file.path);
}

interface TreeEntry {
	path: string;
	blob: string;
	size: number;
}

/** `git ls-tree -r -z -l` records: `<mode> <type> <id> <size>\t<path>`, regular blobs only. */
function parseTree(stdout: string): TreeEntry[] {
	const entries: TreeEntry[] = [];

	for (const record of stdout.split('\0')) {
		const tab = record.indexOf('\t');

		if (tab < 0) continue;

		const [mode, type, blob, size] = record.slice(0, tab).trim().split(/\s+/);

		if (type === 'blob' && REGULAR_MODES.has(mode))
			entries.push({ path: record.slice(tab + 1), blob, size: Number(size) || 0 });
	}

	return entries;
}

function repoFile(entry: TreeEntry, extras: string[]): RepoFile {
	const classified = classifyPath(entry.path, extras);

	return {
		...entry,
		language: classified.language,
		classification: classified.classification,
		packageId: packageBoundary(entry.path),
		...(classified.excludeReason ? { excludeReason: classified.excludeReason } : {})
	};
}
