import type { Review } from './review';

/** One open PR as the Home screen sees it; the server joins its latest review. */
export interface HomeBriefPr {
	repoId: string;
	/** owner/name, for the model's wording. */
	repo: string;
	number: number;
	title: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	createdAt: string;
}

export interface HomeBriefRequest {
	/** First name for the greeting; omitted when unknown. */
	name?: string | null;
	/** Viewer's local part of day, so the greeting matches their clock. */
	dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
	prs: HomeBriefPr[];
	/** Tracked repos with no open PRs. */
	emptyRepos?: string[];
}

export interface HomeBriefResponse {
	/** Two or three sentences. `**phrase**` marks key phrases; PRs appear as `#123`. */
	text: string;
	generatedAt: string;
	model: string;
}

/** Latest review per `repoId#pr`; a real review outranks a newer empty draft. */
export function latestReviews(reviews: Review[]): Map<string, Review> {
	const latest = new Map<string, Review>();
	const rank = (review: Review) => (review.status === 'draft' ? 0 : 1);

	for (const review of reviews) {
		const key = `${review.repoId}#${review.prNumber}`;
		const current = latest.get(key);

		if (
			!current ||
			rank(review) > rank(current) ||
			(rank(review) === rank(current) && Date.parse(review.updatedAt) > Date.parse(current.updatedAt))
		) {
			latest.set(key, review);
		}
	}

	return latest;
}
