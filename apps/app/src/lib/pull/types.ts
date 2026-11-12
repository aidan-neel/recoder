import type {
	PrCheck,
	PullCheckTally,
	PullComment,
	PullCommit,
	PullDiff,
	PullMergeMethod,
	PullPage
} from '@recoder/shared';

/** The tabs of the pull request page, in order. The tab lives in the URL (`?tab=`); `changes` is the default. */
export const PULL_TABS = ['changes', 'summary', 'bugs', 'commits'] as const;

export type PullTab = (typeof PULL_TABS)[number];

/** Data a tab loads on its own: it is loading, it is there (and may be refreshing), or it failed and can be tried again. */
export type Loadable<Value> =
	| { phase: 'loading' }
	| { phase: 'ready'; value: Value; refreshing: boolean }
	| { phase: 'failed'; error: string; retry: () => void };

/** The pull request page above its tabs. */
export interface PullPageView {
	phase: 'loading' | 'ready' | 'not-found' | 'failed';
	/** Why it failed, when `phase` is `failed`. */
	error: string | null;
	offline: boolean;
	/** Set once `phase` is `ready`. A refresh keeps the last page. */
	page: PullPage | null;
	/** The repository's short name, for the breadcrumb; known before the page loads when the repository is tracked. */
	repoName: string;
	/** The numbers on the tabs; null until known. `bugs` counts open findings of the newest review. */
	counts: { files: number | null; bugs: number | null; commits: number | null };
	/** Reads the page again: after a merge, a new review or a new push. */
	refresh: () => void;
}

/** The diff of the Changes tab. */
export type PullDiffView = Loadable<PullDiff>;

/** The Commits tab, oldest first. */
export type PullCommitsView = Loadable<PullCommit[]>;

/** The head commit's CI checks, for the merge bar. It reads them again while one is pending and the page is visible. */
export interface PullChecksView {
	/** `none`: the forge has no checks for this commit, or has none at all. */
	phase: 'loading' | 'ready' | 'none' | 'failed';
	/** Failed first, then pending, then passed. */
	checks: PrCheck[];
	tally: PullCheckTally;
	/** `failed` when any check failed, else `pending` when any still runs, else `passed`. */
	outcome: 'passed' | 'failed' | 'pending' | 'none';
	error: string | null;
}

/** The pull request's conversation on its forge, and writing to it. */
export interface PullConversationView {
	/** `off`: the forge keeps no conversation (a local repository). */
	phase: 'loading' | 'ready' | 'off' | 'failed';
	/** Oldest first. A comment the person just posted is in it at once. */
	entries: PullComment[];
	error: string | null;
	/** Posts a comment on the pull request. It rejects with a plain sentence when the forge refuses. */
	post: (body: string) => Promise<void>;
	posting: boolean;
}

/** Why the merge button is off: the first reason that holds. */
export type MergeBlock = 'merged' | 'closed' | 'draft' | 'conflicts' | 'blocked' | 'unavailable';

/** Merging the pull request from the merge bar. */
export interface MergeView {
	/** The methods the repository allows; empty when Recoder cannot merge here. */
	methods: PullMergeMethod[];
	/** The chosen method, remembered per repository. */
	method: PullMergeMethod | null;
	setMethod: (method: PullMergeMethod) => void;
	/** Null when the pull request can merge now. */
	block: MergeBlock | null;
	phase: 'idle' | 'merging' | 'merged' | 'failed';
	/** The forge's reason, when `phase` is `failed`. */
	error: string | null;
	/** Merges at the head the page shows. The page refreshes when it is done. */
	merge: () => Promise<void>;
}
