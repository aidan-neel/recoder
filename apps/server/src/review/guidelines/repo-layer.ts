import { GUIDELINES_PATH, GUIDELINES_PATHS } from '@recoder/shared';
import type { RepoFileHost } from '../../forge/repo-files.js';

/** A repository's guidelines file on one branch. */
interface RepoGuidelinesFile {
	path: string;
	content: string;
}

/** The repo's guidelines file on `ref`: the first of `GUIDELINES_PATHS` that exists there, or null. */
export async function readRepoGuidelinesFile(host: RepoFileHost, ref: string): Promise<RepoGuidelinesFile | null> {
	for (const path of GUIDELINES_PATHS) {
		const file = await host.readFile(path, ref);

		if (file) return { path, content: file.content };
	}

	return null;
}

/**
 * Where a proposal writes: the file already on the pending branch, else the one
 * on the default branch, so a repo on `.recoder/REVIEW.md` keeps it; a repo
 * with neither gets `RECODER.md`.
 */
export async function proposalPath(host: RepoFileHost, pendingBranch: string | null): Promise<string> {
	const ref = pendingBranch ?? (await host.defaultBranch()).branch;
	const file = await readRepoGuidelinesFile(host, ref);

	return file?.path ?? GUIDELINES_PATH;
}
