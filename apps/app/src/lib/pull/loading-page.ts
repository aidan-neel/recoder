import type { PullPage } from '@recoder/shared';

/**
 * A page that stands in for a pull request while it first loads. The header's
 * skeleton is measured from it, so it has the title's and the facts' own
 * lines; once a pull request has loaded, the skeleton uses the shape its
 * header had then. No one reads it: only how long each text runs matters.
 */
export const LOADING_PULL_PAGE: PullPage = {
	provider: 'github',
	repoId: 'loading',
	pull: {
		number: 100,
		title: 'Keep the session token fresh across tabs',
		url: '',
		author: 'maria',
		base: 'main',
		headRef: 'fix/session-token-refresh',
		headSha: '',
		additions: 120,
		deletions: 40,
		changedFiles: 6,
		createdAt: ''
	},
	status: {
		state: 'open',
		draft: false,
		mergeability: 'unknown',
		updatedAt: new Date().toISOString(),
		checks: null,
		commits: null
	},
	capabilities: { comments: false, checks: false, mergeMethods: [] },
	review: null
};
