import {
	reviewListItem,
	type CreateReviewInput,
	type PullList,
	type Repo,
	type RepoChatSummary,
	type Review,
	type ReviewListItem
} from '@recoder/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ApiClient } from '../api/client';
import { ApiError, failureText, isOffline, plainly } from '../api/http';
import type { RepoTarget } from '../connections/repo-input';
import { whileVisible } from '../review/while-visible';
import { readStored, writeStored } from '../shell/browser-storage';
import { withKey, withoutKey } from '../shell/key-set';
import type { PullListQuery } from '../api/pulls';
import { afterPage, afterReload, NO_MORE_PAGES, type MorePages } from './more-pages';
import { pullKey } from './pull-rows';
import type { PullFilter } from './types';

/** The list, the tracked repositories, the reviews and the newest chats, shared by the sidebar, the list and the New review screen. */
export interface ListData {
	/** `loading` until the first answer; a later failure keeps what loaded. */
	phase: 'loading' | 'ready' | 'failed';
	list: PullList | null;
	/** What was read past the first page of each repository, appended after `list`. */
	more: MorePages;
	repos: Repo[] | null;
	reviews: ReviewListItem[] | null;
	/** The newest chats about a repository, newest first. */
	chats: RepoChatSummary[] | null;
	account: string | null;
	error: string | null;
	offline: boolean;
	refreshing: boolean;
	/** Reviews started here that the list has not caught up with yet, by pull request key. */
	started: Record<string, ReviewListItem>;
	starting: ReadonlySet<string>;
	filter: PullFilter;
	repoId: string | null;
	query: string;
	composeText: string;
	/** The repository the New review screen last used; null for the first tracked one. */
	composeRepoId: string | null;
}

/** The pull request a review starts on. Without a head the server reviews the current one. */
interface StartTarget {
	repoId: string;
	number: number;
	title?: string;
	headSha?: string;
}

/** What the person asked a review to look at: the words after the pull request, and any images. */
type ReviewBrief = Pick<CreateReviewInput, 'instructions' | 'images'>;

export interface ListStore {
	state: StoreApi<ListData>;
	/** Keeps the list fresh while a screen shows it; returns the stop. */
	watch: () => () => void;
	/** Reads the list again, past the server's cache. */
	refresh: () => void;
	/** Reads the list again, as the timer does: after a review started or ended elsewhere. */
	reload: () => void;
	/**
	 * Reads the next page of `repoId`, or of every repository that has one when null. The rows append after the ones
	 * shown; a failure is kept in `more.error`.
	 */
	loadMore: (repoId: string | null) => Promise<void>;
	/**
	 * Queues a review, with the person's brief (what to look at, and images) when there is one; the row shows it
	 * at once and goes back when the start fails, which rejects with a sentence.
	 */
	start: (target: StartTarget, brief?: ReviewBrief) => Promise<Review>;
	/** Deletes a review and drops it from every list at once; rejects with the server's error. */
	deleteReview: (id: string) => Promise<void>;
	/** Deletes a chat and drops it from the sidebar at once; rejects with the server's error. */
	deleteChat: (id: string) => Promise<void>;
	/** Tracks a repository and reads the list again; rejects with a sentence. */
	track: (repo: RepoTarget) => Promise<Repo>;
	setComposeRepo: (repoId: string) => void;
}

/** The list reads itself again this often while the page is visible. */
const REFRESH_MS = 60_000;

/** How many of the newest chats the list reads, for the sidebar. */
const CHAT_LIMIT = 5;

/** Where the New review screen's last repository is kept. */
const COMPOSE_REPO_KEY = 'recoder.compose.repo.v1';

/** What a review started here looks like until the server's own record arrives. */
function placeholderReview(target: StartTarget): ReviewListItem {
	const at = new Date().toISOString();

	return {
		id: `starting:${pullKey(target.repoId, target.number)}`,
		repoId: target.repoId,
		prNumber: target.number,
		headSha: target.headSha ?? '',
		status: 'queued',
		summary: null,
		prTitle: target.title ?? null,
		prUrl: null,
		createdAt: at,
		updatedAt: at,
		findings: []
	};
}

/** The reviews started here that the newly loaded list does not show yet. */
function stillStarted(started: Record<string, ReviewListItem>, list: PullList): Record<string, ReviewListItem> {
	const shown = new Set(list.items.flatMap((item) => (item.review ? [item.review.id] : [])));
	const listed = new Set(list.items.map((item) => pullKey(item.repoId, item.pull.number)));

	return Object.fromEntries(
		Object.entries(started).filter(([key, review]) => listed.has(key) && !shown.has(review.id))
	);
}

/** Runs a delete; a 404 means it is already gone, which is what the person asked for. */
async function deleting(remove: () => Promise<void>): Promise<void> {
	try {
		await remove();
	} catch (error) {
		if (!(error instanceof ApiError && error.status === 404)) throw error;
	}
}

function withoutEntry<Value>(record: Record<string, Value>, key: string): Record<string, Value> {
	const { [key]: _dropped, ...rest } = record;

	return rest;
}

function initialData(): ListData {
	return {
		phase: 'loading',
		list: null,
		more: NO_MORE_PAGES,
		repos: null,
		reviews: null,
		chats: null,
		account: null,
		error: null,
		offline: false,
		refreshing: false,
		started: {},
		starting: new Set(),
		filter: 'all',
		repoId: null,
		query: '',
		composeText: '',
		composeRepoId: readStored(COMPOSE_REPO_KEY)
	};
}

/** The shared list for one client. Nothing loads until a screen watches it. */
export function createListStore(client: ApiClient): ListStore {
	const state = createStore<ListData>(initialData);
	let loadSeq = 0;
	/** Counts the times the pages past the first were dropped, so a page still in flight from before is ignored. */
	let moreEpoch = 0;
	let watchers = 0;
	let stopWatching: (() => void) | null = null;

	/** Reads the list, repositories, reviews and chats together; an answer older than the newest request is dropped. */
	async function load(query: PullListQuery): Promise<void> {
		const mine = ++loadSeq;

		if (query.fresh) moreEpoch += 1;

		state.setState({ refreshing: state.getState().phase === 'ready' });

		try {
			const [list, repos, reviews, chats] = await Promise.all([
				client.pulls(query),
				client.repos(),
				client.reviews(),
				client.repoChats(CHAT_LIMIT)
			]);

			if (mine !== loadSeq) return;

			state.setState((current) => ({
				phase: 'ready',
				list,
				more: afterReload(query.fresh ? NO_MORE_PAGES : current.more, list),
				repos,
				reviews,
				chats,
				error: null,
				offline: false,
				refreshing: false,
				started: stillStarted(current.started, list)
			}));
		} catch (error) {
			if (mine !== loadSeq) return;

			loadFailed(error);
		}
	}

	/** A failed read: the first one fails the list, a later one keeps the rows and says only whether the server is gone. */
	function loadFailed(error: unknown): void {
		const offline = isOffline(error);

		if (state.getState().phase === 'ready') {
			state.setState({ refreshing: false, offline });

			return;
		}

		state.setState({ phase: 'failed', error: failureText(error), offline, refreshing: false });
	}

	async function loadAccount(): Promise<void> {
		try {
			state.setState({ account: await client.account() });
		} catch {
			state.setState({ account: null });
		}
	}

	function reload(): void {
		void load({});
	}

	function follow(): () => void {
		const stopPolling = whileVisible(REFRESH_MS, reload);

		window.addEventListener('focus', reload);
		void loadAccount();

		if (state.getState().list === null) reload();

		return () => {
			stopPolling();
			window.removeEventListener('focus', reload);
		};
	}

	async function loadMore(repoId: string | null): Promise<void> {
		const { more } = state.getState();
		const targets = Object.entries(more.cursors).filter(([id]) => repoId === null || id === repoId);

		if (more.loading || targets.length === 0) return;

		const epoch = moreEpoch;

		state.setState({ more: { ...more, loading: true, error: null } });

		const pages = await Promise.allSettled(targets.map(([id, after]) => client.pulls({ repoId: id, after })));

		if (epoch !== moreEpoch) return;

		state.setState((current) => {
			let next: MorePages = { ...current.more, loading: false };

			pages.forEach((page, index) => {
				const [id] = targets[index];

				if (page.status === 'rejected') {
					next = { ...next, error: failureText(page.reason) };
				} else if (page.value.failures.length > 0) {
					next = { ...next, error: page.value.failures[0].error };
				} else {
					next = afterPage(next, id, page.value);
				}
			});

			return { more: next };
		});
	}

	async function start(target: StartTarget, brief: ReviewBrief = {}): Promise<Review> {
		const key = pullKey(target.repoId, target.number);

		if (state.getState().starting.has(key)) throw new Error('This review is already starting.');

		state.setState((current) => ({
			starting: withKey(current.starting, key),
			started: { ...current.started, [key]: placeholderReview(target) }
		}));

		try {
			const review = await plainly(() =>
				client.createReview({
					repoId: target.repoId,
					prNumber: target.number,
					...(target.headSha && { headSha: target.headSha }),
					...(target.title && { prTitle: target.title }),
					...(brief.instructions && { instructions: brief.instructions }),
					...(brief.images?.length && { images: brief.images })
				})
			);

			state.setState((current) => ({ started: { ...current.started, [key]: reviewListItem(review) } }));
			reload();

			return review;
		} catch (error) {
			state.setState((current) => ({ started: withoutEntry(current.started, key) }));

			throw error;
		} finally {
			state.setState((current) => ({ starting: withoutKey(current.starting, key) }));
		}
	}

	async function deleteReview(id: string): Promise<void> {
		await deleting(() => client.deleteReview(id));

		state.setState((current) => ({
			reviews: current.reviews?.filter((review) => review.id !== id) ?? null,
			started: Object.fromEntries(Object.entries(current.started).filter(([, review]) => review.id !== id))
		}));

		reload();
	}

	async function deleteChat(id: string): Promise<void> {
		await deleting(() => client.deleteRepoChat(id));

		state.setState((current) => ({ chats: current.chats?.filter((chat) => chat.id !== id) ?? null }));
	}

	async function track(repo: RepoTarget): Promise<Repo> {
		const tracked = await plainly(() => client.addRepo(repo));

		await load({});

		return tracked;
	}

	return {
		state,
		start,
		deleteReview,
		deleteChat,
		track,
		reload,
		loadMore,

		watch() {
			watchers += 1;

			if (watchers === 1) stopWatching = follow();

			return () => {
				watchers -= 1;

				if (watchers > 0) return;

				stopWatching?.();
				stopWatching = null;
			};
		},

		refresh() {
			void load({ fresh: true });
		},

		setComposeRepo(repoId) {
			state.setState({ composeRepoId: repoId });
			writeStored(COMPOSE_REPO_KEY, repoId);
		}
	};
}
