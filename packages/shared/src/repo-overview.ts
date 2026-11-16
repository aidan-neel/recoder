/**
 * `GET /api/repos/:id/overview`: what the repository page shows beyond its open pull requests, over the last `days`
 * UTC days. A review counts from the day it started; a draft session and a review a person stopped do not count.
 */
export interface RepoOverview {
	repoId: string;
	days: number;
	/** Auto review is on and its watcher checks this repository: the settings neither leave it out nor scope it away. */
	autoReview: boolean;
	/** Pull requests with a review started in the window, and how many of them merged in it. */
	reviewedPulls: number;
	mergedPulls: number;
	/**
	 * Findings first raised by a review in the window, and the newest decision on each. A finding a re-review carried
	 * over counts once. Quieted findings are left out.
	 */
	findings: { raised: number; accepted: number; dismissed: number };
	/** Median time from start to last update of the passed reviews in the window; null with none. */
	typicalReviewMs: number | null;
	/** One entry per UTC day of the window, oldest first: reviews started that day and how many found a bug. */
	daily: { day: string; reviews: number; withBugs: number }[];
	/**
	 * Directories holding the most bugs (findings that are not suggestions) raised in the window, most first, at most
	 * five. A path ends in `/`; a file at the root of the repository counts under `/`.
	 */
	hotspots: { path: string; findings: number }[];
	/**
	 * The newest merged pull requests that had a review, at most three, newest first. `title` is the newest review's
	 * record of it, empty when none kept one; `fixed` counts the accepted findings across its reviews.
	 */
	merged: { number: number; title: string; mergedAt: string; fixed: number }[];
}
