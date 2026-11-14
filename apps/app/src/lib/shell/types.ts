import type { Provider } from '@recoder/shared';

/** One row of "Recent reviews" in the sidebar. */
export interface RecentReview {
	reviewId: string;
	/** The pull request page, on its Bugs tab. */
	href: string;
	/** The repository the pull request is in, for warming its page on hover. */
	repoId: string;
	title: string;
	/** The repository's short name. */
	repoName: string;
	/** Where the repository lives, for the mark beside its name; null while the repositories load. */
	repoForge: Provider | null;
	number: number;
	state: 'queued' | 'running' | 'bugs' | 'clean' | 'failed';
	/** `Reviewing`, `2 bugs`, `No bugs`, `Failed`, `Queued`. */
	label: string;
	/** When the review last changed, as an ISO date. */
	updatedAt: string;
}

/** A review whose pull request is no longer open: a row of "Settled". */
export interface SettledReview extends RecentReview {
	outcome: 'merged' | 'closed';
}

/** One row of "Chats" in the sidebar. */
export interface RecentChat {
	chatId: string;
	href: string;
	/** Short, from the chat's first message. */
	title: string;
	/** The repository's short name. */
	repoName: string;
	/** Where the repository lives, for the mark beside its name; null while the repositories load. */
	repoForge: Provider | null;
}

/** What the sidebar shows around the pages. */
export interface ShellView {
	/** The forge login for the account row; null when no forge is signed in. */
	account: string | null;
	/** The count beside "Pull requests"; null until the list answered once. */
	openPulls: number | null;
	/** The newest review of each open pull request, newest first; at most eight. */
	recent: RecentReview[];
	/** The newest review of each merged or closed pull request, newest first. */
	settled: SettledReview[];
	/** The chats most recently active, newest first; at most five. */
	chats: RecentChat[];
	/** True while the recent reviews load for the first time. */
	loading: boolean;
}
