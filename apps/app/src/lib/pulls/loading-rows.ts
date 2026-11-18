import type { PullRow, PullRowStatus } from './types';

/** What one stand-in row says; only how long each text runs matters, since no one reads it. */
const SHAPES: readonly (readonly [title: string, author: string, status: PullRowStatus])[] = [
	['Keep the session token fresh across tabs', 'maria', { kind: 'bugs', bugs: 2, suggestions: 1 }],
	['Add a retry to the upload client', 'devon', { kind: 'ready' }],
	['Move the billing webhooks behind the queue and drop the old poller', 'priya', { kind: 'reviewed' }],
	['Fix the date range on the usage chart', 'sam', { kind: 'outdated' }],
	['Read feature flags from the edge config', 'alexander', { kind: 'ready' }],
	['Trim the build image', 'jo', { kind: 'conflicts' }]
];

/**
 * Rows that stand in for pull requests while a list first loads. The
 * skeleton is measured from them, so it has the list's own lines and widths.
 * A list that has loaded before uses the shape it had then instead.
 */
export const LOADING_PULL_ROWS: readonly PullRow[] = SHAPES.map(([title, author, status], index) => ({
	key: `loading#${index}`,
	repoId: 'loading',
	repoName: 'repository',
	repoForge: null,
	number: 100 + index,
	title,
	author,
	activeAt: new Date().toISOString(),
	additions: 120,
	deletions: 40,
	status,
	reviewId: null,
	href: '#'
}));
