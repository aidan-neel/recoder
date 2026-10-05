import type { Repo } from '@recoder/shared';
import { GhError } from '../cli.js';
import type { RepoFileHost } from '../repo-files.js';
import { localGit, localGitOutput } from './git.js';
import { localRepoPath, readLocalForge } from './schema.js';

/**
 * Files of a local repo read straight from its git objects. Nothing is ever
 * written: there is no forge to open a pull request on.
 */
export function localFileHost(repo: Repo): RepoFileHost {
	const repoPath = localRepoPath(repo.url);

	return {
		canWrite: () => false,

		async defaultBranch() {
			const { defaultBranch: branch } = await readLocalForge(repo.url);
			const sha = await localGit(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);

			return { branch, sha };
		},

		async readFile(path, ref) {
			return localGitOutput(repoPath, ['show', `${ref}:${path}`]).then(
				(content) => ({ content }),
				() => null
			);
		},

		findPending: async () => null,

		propose: async () => {
			throw new GhError('unknown', 'Local repositories are read-only; edit the file in the repository instead.');
		}
	};
}
