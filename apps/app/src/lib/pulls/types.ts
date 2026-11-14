import type { Provider } from '@recoder/shared';

/**
 * What one row of the pull request list says about its pull request, most
 * urgent first: a review that runs, open findings, a review that failed,
 * merge conflicts, failing checks, a draft, no review yet, commits newer than
 * the review, then a clean review that can merge (`ready`) or cannot yet
 * (`reviewed`).
 */
export type PullRowStatus =
	| { kind: 'reviewing' }
	| { kind: 'bugs'; bugs: number; suggestions: number }
	| { kind: 'review-failed' }
	| { kind: 'conflicts' }
	| { kind: 'checks-failing'; failed: number }
	| { kind: 'draft' }
	| { kind: 'not-reviewed' }
	| { kind: 'outdated' }
	| { kind: 'ready' }
	| { kind: 'reviewed' };

/** One open pull request as the list shows it. */
export interface PullRow {
	/** `<repoId>#<number>`, unique in the list. */
	key: string;
	repoId: string;
	/** The repository's short name (`recoder`, not `owner/recoder`). */
	repoName: string;
	/** Where the repository lives, for the mark beside its name; null while the repositories load. */
	repoForge: Provider | null;
	number: number;
	title: string;
	author: string;
	/** ISO time of the newest activity on the pull request. */
	activeAt: string;
	additions: number;
	deletions: number;
	status: PullRowStatus;
	/** The newest review of the pull request, when it has one. */
	reviewId: string | null;
	/** The pull request page. */
	href: string;
}

/** Which rows the list shows: all, those with no review at the current head, those with open findings, or those ready to merge. */
export type PullFilter = 'all' | 'needs-review' | 'bugs' | 'ready';

/** A tracked repository in the repository filter. */
export interface RepoOption {
	id: string;
	/** `owner/name`. */
	name: string;
	provider: Provider;
}

/** Everything the pull request list screen shows and does. */
export interface PullListView {
	/** `loading` until the first answer; a refresh keeps `ready` and sets `refreshing`. */
	phase: 'loading' | 'ready' | 'failed';
	/** The rows after the repository filter, the status filter and the search text, newest activity first. */
	rows: PullRow[];
	/** How many rows each filter holds, after the repository filter and the search text. */
	counts: Record<PullFilter, number>;
	filter: PullFilter;
	setFilter: (filter: PullFilter) => void;
	repos: RepoOption[];
	/** The one repository shown, or null for all. */
	repoId: string | null;
	setRepoId: (repoId: string | null) => void;
	query: string;
	setQuery: (query: string) => void;
	/** Repositories whose forge did not answer; the others still load. */
	failures: { repoName: string; error: string }[];
	/** Reading further down the list: the repositories in view may have more pull requests than the rows shown. */
	more: {
		/** Some repository in view has a next page. */
		available: boolean;
		loading: boolean;
		/** Why the newest read of more failed; null when it did not. */
		error: string | null;
		/** Reads the next page of every repository in view that has one. */
		load: () => void;
	};
	/** Why the whole list failed, when `phase` is `failed`. */
	error: string | null;
	/** True when the review server did not answer at all. */
	offline: boolean;
	/** True when no repository is tracked yet. */
	noRepos: boolean;
	/** ISO time of the newest answer. */
	fetchedAt: string | null;
	refreshing: boolean;
	refresh: () => void;
	/** Starts a review of the row's pull request. The row turns to `reviewing` at once and goes back if the start fails. */
	review: (row: PullRow) => Promise<void>;
	/** Keys of the rows whose review start is in flight. */
	starting: ReadonlySet<string>;
}

/**
 * What pasted or typed text points at: nothing yet, a pull request Recoder can
 * open (`href` is its page), a pull request in a repository that is not
 * tracked yet, or text that is no pull request.
 */
export type PullTarget =
	| { kind: 'empty' }
	| { kind: 'pull'; repoId: string; repoName: string; number: number; href: string }
	| { kind: 'untracked'; repoUrl: string; repoName: string; number: number }
	| { kind: 'invalid'; reason: string };
