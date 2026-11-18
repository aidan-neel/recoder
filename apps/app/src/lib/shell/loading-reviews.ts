import type { RecentReview } from './types';

/** What one stand-in card says; only how long each text runs matters, since no one reads it. */
const SHAPES: readonly (readonly [title: string, repoName: string, label: string])[] = [
	['Keep the session token fresh across tabs', 'web', '2 bugs'],
	['Add a retry to the upload client', 'server', 'No bugs'],
	['Move the billing webhooks behind the queue', 'billing', 'Reviewing'],
	['Fix the date range on the usage chart', 'web', '1 suggestion']
];

/**
 * Cards that stand in for the sidebar's reviews while they first load. The
 * skeleton is measured from them, so it has the cards' own lines; once the
 * reviews have loaded, it uses the shape they had then.
 */
export const LOADING_REVIEWS: readonly RecentReview[] = SHAPES.map(([title, repoName, label], index) => ({
	reviewId: `loading#${index}`,
	href: '#',
	repoId: 'loading',
	title,
	repoName,
	repoForge: null,
	number: 100 + index,
	state: 'clean',
	label,
	updatedAt: new Date().toISOString()
}));
