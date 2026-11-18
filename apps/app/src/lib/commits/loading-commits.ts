import type { PullCommit } from '@recoder/shared';

/** What one stand-in commit says; only how long each text runs matters, since no one reads it. */
const SHAPES: readonly (readonly [title: string, login: string])[] = [
	['Keep the session token fresh across tabs', 'maria'],
	['Add a retry to the upload client', 'devon'],
	['Move the billing webhooks behind the queue and drop the old poller', 'priya'],
	['Fix the date range on the usage chart', 'sam'],
	['Read feature flags from the edge config', 'alexander'],
	['Trim the build image', 'jo']
];

/**
 * Commits that stand in while a pull request's commits first load. The
 * skeleton is measured from them, so it has the rows' own lines; once a list
 * has loaded, it uses the shape that list had.
 */
export const LOADING_COMMITS: readonly PullCommit[] = SHAPES.map(([title, login], index) => ({
	sha: `${index}000000`,
	title,
	body: '',
	author: { login, name: null, avatarUrl: null },
	authoredAt: new Date().toISOString(),
	url: null
}));
