import { applyProgressMessage, emptyReviewProgress, type ProgressMessage, type Review } from '@recoder/shared';

import type { createFetchers, LoadContext } from './review-fetch';
import { ReviewStream } from './review-stream';
import { whileVisible } from './while-visible';

/** While any CI check runs, read them again this often. */
const CHECKS_POLL_MS = 20000;

/** Read the pull request again this often, so commits pushed while the page is open show up. */
const PULL_POLL_MS = 60000;

/** The review's diff, checks and pull request loaders. */
export type Fetchers = ReturnType<typeof createFetchers>;

/** What following a review reaches in the store. */
interface FollowContext extends Pick<LoadContext, 'get' | 'set' | 'current'> {
	fetchers: Fetchers;
	/** Takes a copy of the review the stream carried. */
	accept: (review: Review) => void;
	/** The stream heard from the server, so the copy on screen was current until now. */
	heard: () => void;
	/** Reads the review again over REST. */
	refresh: () => Promise<void>;
}

/**
 * Follows the review while the page is open: its event stream, running CI
 * checks and the pull request's head.
 */
export function createFollower({ get, set, current, fetchers, accept, heard, refresh }: FollowContext) {
	let stream: ReviewStream | null = null;
	let watchers: (() => void)[] = [];

	/**
	 * One stream message. The snapshot that opens each connection replaces the
	 * progress whatever its sequence: the server sends all it has on every
	 * connect, and after a hard restart that is less than the page showed.
	 */
	function onMessage(message: ProgressMessage, opening: boolean): void {
		const { id, progress } = get();
		const next = applyProgressMessage(opening || !progress ? emptyReviewProgress(id) : progress, message);

		heard();

		if (next !== progress) set({ progress: next, progressFailed: false });

		if (message.review && message.review.id === id) accept(message.review);

		if (message.type === 'task' && message.data?.task?.id === 'diff' && message.data.task.status === 'done') {
			fetchers.loadFiles();
		}

		if (message.type === 'heartbeat' && message.status && message.status !== get().review?.status) {
			void refresh();
		}
	}

	return {
		/** Opens the stream and the polls for review `id` from load `gen`. */
		follow(id: string, gen: number): void {
			stream = new ReviewStream(id, {
				onMessage,
				onConnection: (connection) => current(id, gen) && set({ connection }),
				onStale: () => void refresh(),
				onNoSnapshot: () => current(id, gen) && !get().progress && set({ progressFailed: true }),
				onFailures: (streamFailures) => current(id, gen) && set({ streamFailures })
			});

			stream.open();

			watchers = [
				whileVisible(CHECKS_POLL_MS, () => fetchers.checksRunning() && fetchers.loadChecks()),
				whileVisible(PULL_POLL_MS, fetchers.refreshPull)
			];
		},

		/** Stops following the review: closes the stream and every poll. */
		stop(): void {
			stream?.close();
			stream = null;

			for (const stop of watchers) stop();

			watchers = [];
			fetchers.stop();
		},

		/** Reconnects the stream now, with its backoff reset: its first snapshot did not come in time, or it keeps failing. */
		reconnect(): void {
			if (!stream) return;

			set({ progressFailed: false });
			stream.retry();
		}
	};
}
