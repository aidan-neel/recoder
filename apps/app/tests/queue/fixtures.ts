import type { PullRequest, Repo } from '@recoder/shared';

/** A tracked GitHub repository. */
export function repo(id: string, name: string): Repo {
	return {
		id,
		name,
		url: `https://github.com/${name}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

/** An open pull request whose head is `sha<number>`. */
export function pull(number: number): PullRequest {
	return {
		number,
		title: `PR ${number}`,
		url: `https://github.com/acme/api/pull/${number}`,
		author: 'claude[bot]',
		base: 'main',
		headRef: `agent/pr-${number}`,
		headSha: `sha${number}`,
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		createdAt: '2026-10-13T09:00:00Z'
	};
}
