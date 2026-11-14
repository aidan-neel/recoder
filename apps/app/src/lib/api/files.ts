import type { RepoFile, RepoTree } from '@recoder/shared';

import { ApiError, request, seg } from './http';

/** How long to wait before asking again while the server makes its first copy of the repository. */
const COPY_POLL_MS = 2_000;

/** After this long the server's "still copying" answer is shown as the failure it has become. */
const COPY_WAIT_LIMIT_MS = 5 * 60_000;

/** The query of a browsing call: the path, and the commit-ish to read (the repository's default branch when empty). */
function filesQuery(path: string, ref: string | undefined): string {
	const params = new URLSearchParams({ path });

	if (ref) params.set('ref', ref);

	return params.toString();
}

/**
 * Runs `read` again while the server answers 503, which it does while it clones a repository no review has copied
 * yet, so the panel stays loading instead of showing an error.
 */
async function readOnceCopied<T>(read: () => Promise<T>): Promise<T> {
	const deadline = Date.now() + COPY_WAIT_LIMIT_MS;

	for (;;) {
		try {
			return await read();
		} catch (error) {
			if (!(error instanceof ApiError && error.status === 503) || Date.now() > deadline) throw error;

			await new Promise((resolve) => setTimeout(resolve, COPY_POLL_MS));
		}
	}
}

/** Browsing a tracked repository's files at a ref, without leaving the app. */
export const filesApi = {
	tree: (repoId: string, path: string, ref: string | undefined) =>
		readOnceCopied(() => request<RepoTree>(`/api/repos/${seg(repoId)}/tree?${filesQuery(path, ref)}`)),
	file: (repoId: string, path: string, ref: string | undefined) =>
		readOnceCopied(() => request<RepoFile>(`/api/repos/${seg(repoId)}/file?${filesQuery(path, ref)}`))
};
