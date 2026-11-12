import type {
	PrCheck,
	PullComment,
	PullCommit,
	PullDiff,
	PullMergeMethod,
	PullPage,
	Review,
	ReviewProgress
} from '@recoder/shared';
import type { StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../api/client';
import type { AskThread } from '../ask/bug-thread';
import type { Outgoing } from '../ask/conversation';
import type { ListStore } from '../pulls/list-store';

/** Data a tab loads on its own. `idle`: nothing asked for it yet. */
export type Load<Value> =
	| { phase: 'idle' }
	| { phase: 'loading' }
	| { phase: 'ready'; value: Value; refreshing: boolean }
	| { phase: 'failed'; error: string };

/** The person's vote on a finding. */
export type Vote = 'useful' | 'not-useful';

/** Everything one pull request page holds, for one pull request. */
export interface SessionData {
	page: {
		phase: 'loading' | 'ready' | 'not-found' | 'failed';
		value: PullPage | null;
		error: string | null;
		offline: boolean;
	};
	diff: Load<PullDiff>;
	commits: Load<PullCommit[]>;
	checks: Load<PrCheck[]>;
	conversation: Load<PullComment[]>;
	posting: boolean;
	/** The newest review in full, once read; it follows the review's live events. */
	review: Review | null;
	reviewLoad: 'none' | 'loading' | 'ready' | 'failed';
	reviewError: string | null;
	progress: ReviewProgress | null;
	connection: 'live' | 'reconnecting';
	starting: boolean;
	merge: { phase: 'idle' | 'merging' | 'merged' | 'failed'; error: string | null; method: PullMergeMethod | null };
	/** Findings with a write in flight. */
	pendingBugs: ReadonlySet<string>;
	postingAll: boolean;
	votes: Record<string, Vote>;
	/** Viewed files: each path with the hash of the diff it had when marked. */
	viewed: Record<string, string>;
	treeFilter: string;
	closedFolders: ReadonlySet<string>;
	/** Messages this page sent to the review's conversation that its events have not carried yet. */
	outbox: Outgoing[];
	/** Threads about single findings, by finding id. */
	threads: Record<string, AskThread>;
}

/** What every part of a session works with. */
export interface SessionContext {
	client: ApiClient;
	list: ListStore;
	state: StoreApi<SessionData>;
	repoId: string;
	number: number;
	/** Waits before a decision write the server refused with 409 is sent again; tests inject an instant one. */
	wait?: (ms: number) => Promise<void>;
}

const IDLE: Load<never> = { phase: 'idle' };

export function initialSession(viewed: Record<string, string>): SessionData {
	return {
		page: { phase: 'loading', value: null, error: null, offline: false },
		diff: IDLE,
		commits: IDLE,
		checks: IDLE,
		conversation: IDLE,
		posting: false,
		review: null,
		reviewLoad: 'none',
		reviewError: null,
		progress: null,
		connection: 'live',
		starting: false,
		merge: { phase: 'idle', error: null, method: null },
		pendingBugs: new Set(),
		postingAll: false,
		votes: {},
		viewed,
		treeFilter: '',
		closedFolders: new Set(),
		outbox: [],
		threads: {}
	};
}

/** The loaded value, or null while it loads or failed. */
export function loaded<Value>(load: Load<Value>): Value | null {
	return load.phase === 'ready' ? load.value : null;
}
