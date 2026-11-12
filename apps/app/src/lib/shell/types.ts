/** One row of "Recent reviews" in the sidebar. */
export interface RecentReview {
	reviewId: string;
	/** The pull request page, on its Bugs tab. */
	href: string;
	title: string;
	/** The repository's short name. */
	repoName: string;
	number: number;
	state: 'queued' | 'running' | 'bugs' | 'clean' | 'failed';
	/** `Reviewing`, `2 bugs`, `No bugs`, `Failed`, `Queued`. */
	label: string;
}

/** What the sidebar shows around the pages. */
export interface ShellView {
	/** The forge login for the account row; null when no forge is signed in. */
	account: string | null;
	/** The count beside "Pull requests"; null until the list answered once. */
	openPulls: number | null;
	/** The newest review of each pull request, newest first; at most eight. */
	recent: RecentReview[];
	/** True while the recent reviews load for the first time. */
	loading: boolean;
	/** True when the review server does not answer. */
	offline: boolean;
}
