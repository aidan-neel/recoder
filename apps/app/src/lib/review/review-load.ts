import type { PullRequest, Review } from '@recoder/shared';

import { ApiError, NetworkError, TimeoutError } from '../api/http';
import { SAMPLE_DIFFS } from '../sample/sample-diff';
import { SAMPLE_CHECKS, SAMPLE_PULL, SAMPLE_REVIEW } from '../sample/sample-review';
import { beforeMount } from '../shell/mounted';
import { useShell } from '../shell/shell-store';
import { knownRepoName, repoNames } from './repo-names';
import { forgetReview, isFresh, rememberReview, type CachedReview } from './review-cache';
import type { LoadContext } from './review-fetch';
import type { createFollower, Fetchers } from './review-follow';
import { firstLangs, grammarsFirst, grammarsWhenIdle } from './review-grammars';
import { fetchReview, readFailure, readPull, readReview, type Read, type ReviewRead } from './review-read';
import { INITIAL, isRunning } from './review-state';
import { keepTab, syncTab } from './review-tab';
import { readDecisions } from './saved-decisions';

/** What loading a review reaches in the store. */
interface LoaderContext extends LoadContext {
	fetchers: Fetchers;
	follower: Pick<ReturnType<typeof createFollower>, 'follow' | 'stop'>;
	/** Takes a copy of the review from the server. */
	accept: (review: Review) => void;
	/** Falls back to the overview when the selected item is gone. */
	keepSelection: () => void;
	/** False while a load keeps its decisions in memory only. */
	persists: () => boolean;
	/** Records when the copy on screen was last known to match the server. */
	confirmed: (at: number) => void;
	/** Marks the copy on screen as one a refresh could not bring up to date. */
	stale: () => void;
}

/** True for a failure the server or the network caused: a failed request, or an answer the page could not read. */
function expected(error: unknown): boolean {
	return (
		error instanceof ApiError ||
		error instanceof NetworkError ||
		error instanceof TimeoutError ||
		error instanceof SyntaxError
	);
}

/**
 * How a review loads: a first visit, a return visit painted from the copy
 * the page kept, the sample, and the re-reads that keep it current.
 */
export function createLoader(ctx: LoaderContext) {
	const { get, set, generation, current, openLink, fetchers, follower, accept } = ctx;

	/** The review is gone on the server: stop following it, forget its copies, close its tab and say so. */
	function gone(id: string): void {
		follower.stop();
		forgetReview(id);
		set({ status: 'missing', link: null });
		useShell.getState().closeTabs([id]);
	}

	/**
	 * A fault in the page itself, not the server: it is logged, keeps the
	 * review's tab and reads as a review the page could not show, never as a
	 * server that is down.
	 */
	function broke(error: unknown): void {
		console.error(error);
		keepTab(get());
		set({ status: 'failed', loadError: { kind: 'other', text: 'This review couldn’t be shown.' } });
	}

	/**
	 * A first read that failed: a 404 means the review is gone and a server
	 * that never answered reads as offline. Any other failed request, or an
	 * answer the page could not read, keeps its kind and words, so the notice
	 * says why and offers Try again.
	 */
	function failed(id: string, error: unknown): void {
		if (error instanceof NetworkError) return set({ status: 'offline' });
		if (error instanceof ApiError && error.status === 404) return gone(id);
		if (expected(error)) return set({ status: 'failed', loadError: readFailure(error) });

		broke(error);
	}

	/** Fills in the repository's name once the list answers, when the first paint went without it. */
	function fillRepoName(review: Review, gen: number): void {
		void repoNames()
			.catch(() => null)
			.then((map) => {
				const name = map?.get(review.repoId) ?? null;

				if (name && current(review.id, gen) && !get().repoName) {
					set({ repoName: name });
					syncTab(get());
				}
			});
	}

	/**
	 * Paints a first visit's read, then follows the review and fills in what
	 * came later: the pull request, once its lookup answers, and the rest of
	 * the diff's grammars, once the page is idle.
	 */
	function show(read: ReviewRead, pending: Promise<Read<PullRequest | null>> | null, gen: number): void {
		const { review, diff, repoName, pull } = read;

		try {
			set({ files: diff.value, filesError: diff.error, repoName, ...(pull ? { pull, pullAnswered: true } : {}) });
			accept(review);

			if (pending) void fetchers.settlePull(pending, review.id, gen);
			if (!repoName) fillRepoName(review, gen);
			if (diff.value.length === 0 && (isRunning(review) || review.status === 'draft')) fetchers.pollFiles();
			else if (diff.value.length === 0 && !diff.error) openLink(true);

			follower.follow(review.id, gen);
			grammarsWhenIdle(diff.value);
		} catch (error) {
			if (current(review.id, gen)) broke(error);
		}
	}

	/**
	 * A first visit: the review, its diff and the repository's name load
	 * together, joining a read ahead of the same review still in flight. The
	 * page paints once they are in, with the grammars for the code its first
	 * screen shows given a short head start. The CI checks (asked at once,
	 * beside the review) and the pull request (unless the read carried the
	 * queue's copy) fill their places as they answer: the checks' place is
	 * held at the end of the overview, and the header's author and branch sit
	 * last and give way first, so neither moves anything.
	 */
	async function loadLive(id: string, gen: number): Promise<void> {
		void fetchers.loadChecks();

		let read: ReviewRead;

		try {
			read = await readReview(id);
		} catch (error) {
			if (current(id, gen)) failed(id, error);

			return;
		}

		if (!current(id, gen)) return;

		const pending = read.pull ? null : readPull(read.review);

		await grammarsFirst(firstLangs(read.review, read.diff.value, get().link));

		if (current(id, gen)) show(read, pending, gen);
	}

	/**
	 * Brings a return visit's parts up to date once its copy painted. A copy
	 * kept moments ago (`stale` false: read ahead, or the page just left) is
	 * as new as a read, and the stream's first snapshot carries the review, so
	 * only what it lacks is read, and a running review's diff waits for its
	 * next poll. A finished review kept without a diff is not asked for one
	 * again; a change of status reads it anew.
	 */
	function catchUp(id: string, gen: number, stale: boolean): void {
		if (!current(id, gen) || get().status !== 'ready') return;

		const { files, review, pull } = get();
		const live = isRunning(review) || review?.status === 'draft';

		if (stale && (files.length > 0 || live)) fetchers.loadFiles();
		else if (live) fetchers.pollFiles();
		if (stale || !pull) fetchers.refreshPull();
		if (!get().repoName && review) fillRepoName(review, gen);
	}

	/**
	 * Re-reads the review over REST (after an action, or when the stream went
	 * quiet). A review deleted on the server closes; a read that failed marks
	 * the copy on screen as not brought up to date, until an answer comes.
	 */
	async function refresh(): Promise<void> {
		const { id, sample } = get();
		const gen = generation();

		if (sample || !id) return;

		try {
			const review = await fetchReview(id);

			if (current(id, gen)) accept(review);
		} catch (error) {
			if (!current(id, gen)) return;

			if (error instanceof ApiError && error.status === 404) gone(id);
			else if (expected(error)) ctx.stale();
			else console.error(error);
		}
	}

	/**
	 * Paints the copy the page kept, then follows the review and brings each
	 * part up to date in place ({@link catchUp}).
	 */
	function paintKept(id: string, link: string | null, cached: CachedReview, gen: number): void {
		const { review } = cached;

		set({
			...INITIAL,
			id,
			link,
			status: 'ready',
			review,
			files: cached.files,
			pull: cached.pull,
			pullAnswered: cached.pull !== null,
			repoName: cached.repoName ?? knownRepoName(review.repoId),
			checks: cached.checks,
			progress: cached.progress,
			records: readDecisions(review.id, review.headSha)
		});

		ctx.confirmed(cached.keptAt);
		ctx.keepSelection();
		openLink();
		syncTab(get(), true);
		follower.follow(id, gen);
		void fetchers.loadChecks();
		grammarsWhenIdle(cached.files);

		if (isFresh(cached)) catchUp(id, gen, false);
		else void refresh().then(() => catchUp(id, gen, true));
	}

	/** Paints the sample review, which needs no server, and opens the item its link names. */
	function paintSample(link: string | null): void {
		set({
			...INITIAL,
			id: 'sample',
			sample: true,
			status: 'ready',
			review: SAMPLE_REVIEW,
			files: SAMPLE_DIFFS,
			pull: SAMPLE_PULL,
			pullAnswered: true,
			repoName: 'acme/api',
			checks: SAMPLE_CHECKS,
			records: ctx.persists() ? readDecisions(SAMPLE_REVIEW.id, SAMPLE_REVIEW.headSha) : {},
			link
		});

		openLink();
		syncTab(get(), true);
	}

	return {
		loadLive,

		refresh,

		/**
		 * A return visit: paints the copy the page kept ({@link paintKept}) at
		 * once, in the same commit as the page. A full page load (a reload)
		 * that opens at an item's code first gives that code's grammar the same
		 * short wait a first visit does, while the server's skeleton is still
		 * unseen, so the code paints colored; a copy the page then cannot show
		 * says so rather than leave the skeleton up.
		 */
		restore(id: string, link: string | null, cached: CachedReview, gen: number): void {
			const langs = firstLangs(cached.review, cached.files, link);

			if (langs.length === 0 || !beforeMount()) return paintKept(id, link, cached, gen);

			set({ ...INITIAL, id, link });

			void grammarsFirst(langs)
				.then(() => current(id, gen) && paintKept(id, link, cached, gen))
				.catch((error: unknown) => current(id, gen) && broke(error));
		},

		/**
		 * The sample review, which needs no server. Like a return visit, a full
		 * page load (a reload, or Back from another site) that opens at an
		 * item's code first gives that code's grammar the short wait a first
		 * visit does, while the server's skeleton is still unseen, so the code
		 * paints colored; a grammar that fails to load paints it plain.
		 */
		loadSample(link: string | null): void {
			const langs = firstLangs(SAMPLE_REVIEW, SAMPLE_DIFFS, link);

			if (langs.length === 0 || !beforeMount()) return paintSample(link);

			const gen = generation();
			const paint = () => current('sample', gen) && paintSample(link);

			set({ ...INITIAL, id: 'sample', link });
			void grammarsFirst(langs).then(paint, paint);
		},

		/**
		 * Keeps a copy of the review on screen, so the next visit paints it at
		 * once. Leaving for another page saves it to session storage once that
		 * page is idle (`idle`); a tab that closes or reloads saves it at once.
		 */
		remember(write: 'now' | 'idle' = 'now'): void {
			const { status, sample, review, files, pull, repoName, checks, progress } = get();

			if (ctx.persists() && !sample && status === 'ready' && review) {
				rememberReview({ review, files, pull, repoName, checks, progress }, write);
			}
		}
	};
}
