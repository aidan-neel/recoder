import {
	applyProgressMessage,
	emptyReviewProgress,
	type CreateReviewInput,
	type ProgressMessage,
	type Review,
	type ReviewListItem
} from '@recoder/shared';

import { failureText, plainly } from '../api/http';
import { isReviewing } from '../pulls/pull-rows';
import type { SessionContext } from '../pull/session-state';
import type { Connection } from '../api/event-stream';

/** What the rest of the session hears about the review. */
interface ReviewEvents {
	/** The session follows another review now. */
	reviewFollowed: (id: string) => void;
	/** A review that ran has passed or failed; the page's counts and state may have changed. */
	reviewSettled: () => void;
}

/** The review a session follows: what tells it apart from an older one. */
type Followed = Pick<ReviewListItem, 'id' | 'createdAt'>;

/** The newest review of the pull request: reading it, following its live events, and starting and stopping it. */
export function createReviewFollow(context: SessionContext, events: ReviewEvents) {
	const { client, list, state, repoId, number } = context;
	let followed: Followed | null = null;
	let stopStream: (() => void) | null = null;
	/** True from `close` until the session opens again: a closed session starts no stream. */
	let closed = true;

	/** Takes the server's copy of the followed review; a run that just ended tells the page. */
	function accept(review: Review): void {
		if (review.id !== followed?.id) return;

		const before = state.getState().review;

		state.setState({ review, reviewLoad: 'ready', reviewError: null });

		if (before && isReviewing(before) && !isReviewing(review)) {
			events.reviewSettled();
			list.reload();
		}
	}

	/**
	 * Takes the review a request answers with, unless a newer copy reached the
	 * screen while it was asked: the live events, or a decision made meanwhile.
	 */
	async function acceptAnswer(request: () => Promise<Review>): Promise<void> {
		const shown = state.getState().review;
		const review = await request();

		if (state.getState().review === shown) accept(review);
	}

	async function load(id: string): Promise<void> {
		const shown = state.getState().review;

		if (shown?.id !== id) state.setState({ reviewLoad: 'loading', reviewError: null });

		try {
			await acceptAnswer(() => client.review(id));
		} catch (error) {
			if (followed?.id === id && state.getState().review === shown) {
				state.setState({ reviewLoad: 'failed', reviewError: failureText(error) });
			}
		}
	}

	function received(id: string, message: ProgressMessage): void {
		const { progress, review } = state.getState();

		state.setState({ progress: applyProgressMessage(progress ?? emptyReviewProgress(id), message) });

		if (message.review) accept(message.review);
		if (message.type === 'heartbeat' && message.status && message.status !== review?.status) void load(id);
	}

	function connected(connection: Connection): void {
		state.setState({ connection: connection === 'reconnecting' ? 'reconnecting' : 'live' });
	}

	/** Follows another review: its record (read now unless given) and its live events. A closed session follows none. */
	function follow(target: Followed, review?: Review): void {
		if (closed) return;

		const { id } = target;

		stopStream?.();
		followed = target;
		state.setState({ progress: null, connection: 'live' });
		events.reviewFollowed(id);

		if (review) accept(review);
		else void load(id);

		stopStream = client.follow(id, {
			onMessage: (message) => received(id, message),
			onConnection: connected,
			onStale: () => void load(id)
		});
	}

	/** The review that starts on the pull request's head as the page shows it. */
	function reviewInput(input: Pick<CreateReviewInput, 'start' | 'instructions'>): CreateReviewInput {
		const pull = state.getState().page.value?.pull;

		return {
			repoId,
			prNumber: number,
			...(pull && { headSha: pull.headSha, prTitle: pull.title }),
			...input
		};
	}

	/** Runs a lifecycle call on the followed review; rejects with a plain sentence. */
	async function onFollowed<T>(call: (id: string) => Promise<T>): Promise<T> {
		const id = followed?.id;

		if (!id) throw new Error('This pull request has no review yet.');

		return plainly(() => call(id));
	}

	/** Runs a draft session's review, or queues a fresh one of the current head with the person's brief. */
	async function startReview(brief?: string): Promise<Review> {
		const { review } = state.getState();

		if (review?.status === 'draft' && !brief) return client.startDraft(review.id);

		return client.createReview(reviewInput(brief ? { instructions: brief } : {}));
	}

	/** Shows a pause or resume at once; the next event confirms it. */
	function markPaused(paused: boolean): void {
		const { progress } = state.getState();

		if (progress) state.setState({ progress: { ...progress, paused } });
	}

	return {
		/** Follows the page's newest review; the one already followed, or one older than it, is left as it is. */
		sync(item: ReviewListItem | null): void {
			if (!item || item.id === followed?.id) return;
			if (followed && Date.parse(item.createdAt) < Date.parse(followed.createdAt)) return;

			follow(item);
		},

		/** Lets the session follow reviews, until it closes. */
		open(): void {
			closed = false;
		},

		/** Stops following; answers that arrive after it start nothing. */
		close(): void {
			closed = true;
			stopStream?.();
			stopStream = null;
			followed = null;
		},

		async start(brief?: string): Promise<void> {
			state.setState({ starting: true });

			try {
				const review = await plainly(() => startReview(brief));

				follow(review, review);
				list.reload();
			} finally {
				state.setState({ starting: false });
			}
		},

		/** Opens a draft session, so the person can ask about a pull request before any review ran. */
		async openDraft(): Promise<string> {
			const review = await plainly(() => client.createReview(reviewInput({ start: false })));

			follow(review, review);

			return review.id;
		},

		async cancel(): Promise<void> {
			const id = await onFollowed(async (current) => {
				await client.cancelReview(current);

				return current;
			});

			await load(id);
		},

		async pause(): Promise<void> {
			await onFollowed(client.pauseReview);
			markPaused(true);
		},

		async resume(): Promise<void> {
			await onFollowed(client.resumeReview);
			markPaused(false);
		},

		async retry(): Promise<void> {
			await acceptAnswer(() => onFollowed(client.continueReview));
		}
	};
}
