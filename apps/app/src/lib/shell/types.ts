import type { Provider } from '@recoder/shared';

/** One row of "Reviews" in the sidebar. */
export interface RecentReview {
	reviewId: string;
	/** The pull request page, on its Review tab. */
	href: string;
	/** The repository the pull request is in, for warming its page on hover. */
	repoId: string;
	title: string;
	/** The repository's short name. */
	repoName: string;
	/** Where the repository lives, for the mark beside its name; null while the repositories load. */
	repoForge: Provider | null;
	number: number;
	state: 'queued' | 'running' | 'bugs' | 'clean' | 'failed' | 'cancelled';
	/** `Reviewing`, `2 bugs`, `1 suggestion`, `No bugs`, `Failed`, `Cancelled`, `Queued`. */
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
	/** The repository the chat is about, for a list that shows one repository's chats. */
	repoId: string;
	/** Short, from the chat's first message. */
	title: string;
	/** The repository's short name. */
	repoName: string;
	/** Where the repository lives, for the mark beside its name; null while the repositories load. */
	repoForge: Provider | null;
	/** When the chat last changed, as an ISO date. */
	updatedAt: string;
}

/** A row of "Settled": a review or a chat, and how its pull request ended when it did. */
export type SettledRow =
	| { kind: 'review'; row: RecentReview; outcome: SettledReview['outcome'] | null }
	| { kind: 'chat'; row: RecentChat; outcome: null };

/** A tracked repository in the sidebar, which opens its page. */
export interface SidebarRepo {
	id: string;
	/** The repository's short name, or the label that tells it apart from another of the same name. */
	name: string;
	href: string;
	/** Where the repository lives, for the mark on the row. */
	provider: Provider;
	/** One of its open pull requests has an open high-severity bug. */
	alert: boolean;
}

/** What the sidebar shows around the pages. */
export interface ShellView {
	/** The forge login for the account row; null when no forge is signed in. */
	account: string | null;
	/** The count beside "Pull requests"; null until the list answered once. */
	openPulls: number | null;
	/** The tracked repositories, by name. */
	repos: SidebarRepo[];
	/** The newest review of each open pull request that is not settled, newest first; at most eight. */
	recent: RecentReview[];
	/** Reviews of merged or closed pull requests, and the reviews and chats settled by hand or by rest, newest first. */
	settled: SettledRow[];
	/** The chats most recently active that are not settled, newest first. */
	chats: RecentChat[];
	/** True while the recent reviews load for the first time. */
	loading: boolean;
}
