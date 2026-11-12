import type { DismissalReason, Finding, FindingDecision, Review } from '@recoder/shared';

import { ApiError, plainly } from '../api/http';
import type { DecisionInput } from '../api/reviews';
import type { SessionContext, Vote } from '../pull/session-state';
import { withKey, withoutKey } from '../shell/key-set';

/** How long a decision the server could not save yet waits before it is sent again. */
const DECISION_RETRY_MS = 400;

/** Saves one decision on the review with id `reviewId`; reopening saves none. */
type SaveDecision = (reviewId: string) => Promise<FindingDecision | undefined>;

/** One finding's decision writes in flight. */
interface DecisionWrites {
	/** The newest write's turn; an older write that settles leaves the screen to it. */
	newest: number;
	/** The decision the server holds as far as this page knows: what a failed newest write puts back. */
	saved: FindingDecision | undefined;
	/** Settles once every write so far has; the next write starts then. */
	queue: Promise<unknown>;
}

/** Waits `ms`; the session's `wait` replaces it in tests. */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Saves a decision, sending it once more when the server answered 409: it
 * could not save yet and nothing was written. A second 409, or any other
 * failure, rejects as it came.
 */
async function saveWithRetry(
	reviewId: string,
	save: SaveDecision,
	pause: (ms: number) => Promise<void>
): Promise<FindingDecision | undefined> {
	try {
		return await save(reviewId);
	} catch (error) {
		if (!(error instanceof ApiError) || error.status !== 409) throw error;
	}

	await pause(DECISION_RETRY_MS);

	return save(reviewId);
}

/** What a person does with the findings of the followed review. Each write shows at once and rolls back when it fails. */
export function createBugActions(context: SessionContext) {
	const { client, state } = context;
	const pause = context.wait ?? wait;

	function currentReview(): Review {
		const { review } = state.getState();

		if (!review) throw new Error('This pull request has no review yet.');

		return review;
	}

	function findingOf(id: string): Finding {
		const finding = currentReview().findings.find((candidate) => candidate.id === id);

		if (!finding) throw new Error('That finding is no longer in the review.');

		return finding;
	}

	/** Changes the findings `match` picks in the review on screen. */
	function patchFindings(match: (finding: Finding) => boolean, change: (finding: Finding) => Finding): void {
		const { review } = state.getState();

		if (!review) return;

		state.setState({
			review: { ...review, findings: review.findings.map((finding) => (match(finding) ? change(finding) : finding)) }
		});
	}

	function setDecision(id: string, decision: FindingDecision | undefined): void {
		patchFindings(
			(finding) => finding.id === id,
			(finding) => {
				const { decision: _old, ...rest } = finding;

				return decision ? { ...rest, decision } : rest;
			}
		);
	}

	/** How many writes each finding has in flight; it shows as pending until the last one settles. */
	const pendingWrites = new Map<string, number>();

	/** Each finding's decision writes in flight, by finding id. */
	const decisionWrites = new Map<string, DecisionWrites>();

	function startPending(id: string): void {
		pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
		state.setState((current) => ({ pendingBugs: withKey(current.pendingBugs, id) }));
	}

	function endPending(id: string): void {
		const left = (pendingWrites.get(id) ?? 1) - 1;

		if (left > 0) {
			pendingWrites.set(id, left);

			return;
		}

		pendingWrites.delete(id);
		state.setState((current) => ({ pendingBugs: withoutKey(current.pendingBugs, id) }));
	}

	/** Runs a write on one finding while it shows as pending. */
	async function whilePending<T>(id: string, write: () => Promise<T>): Promise<T> {
		startPending(id);

		try {
			return await write();
		} finally {
			endPending(id);
		}
	}

	/**
	 * Shows `shown` at once and saves it after the finding's earlier decision
	 * writes, so the server takes them in the order they were made. Only the
	 * newest write changes the screen when it settles: it shows what the server
	 * saved, or on failure the decision the server last confirmed.
	 */
	async function writeDecision(id: string, shown: FindingDecision | undefined, save: SaveDecision): Promise<void> {
		const reviewId = currentReview().id;
		const writes = decisionWrites.get(id) ?? { newest: 0, saved: findingOf(id).decision, queue: Promise.resolve() };
		const earlier = writes.queue;
		const turn = writes.newest + 1;

		const write = whilePending(id, async () => {
			await earlier;

			return plainly(() => saveWithRetry(reviewId, save, pause));
		});

		decisionWrites.set(id, { ...writes, newest: turn, queue: Promise.allSettled([write]) });
		setDecision(id, shown);

		try {
			recordSaved(id, await write);
		} finally {
			showIfNewest(id, turn);
		}
	}

	function recordSaved(id: string, saved: FindingDecision | undefined): void {
		const writes = decisionWrites.get(id);

		if (writes) decisionWrites.set(id, { ...writes, saved });
	}

	/** When `turn` is the finding's newest write, it shows the decision the server holds and ends the queue. */
	function showIfNewest(id: string, turn: number): void {
		const writes = decisionWrites.get(id);

		if (writes?.newest !== turn) return;

		decisionWrites.delete(id);
		setDecision(id, writes.saved);
	}

	/** Shows the decision at once and saves it; a failure puts back the decision the server last confirmed. */
	function decide(id: string, input: DecisionInput): Promise<void> {
		return writeDecision(id, { ...input, decidedAt: new Date().toISOString() }, (reviewId) =>
			client.decide(reviewId, id, input)
		);
	}

	/** Takes what a post answered into the review on screen, keeping every change made since the post began. */
	function acceptPosted(posted: Review): void {
		const { review } = state.getState();

		if (review?.id !== posted.id) return;

		state.setState({
			review: {
				...review,
				findingComments: { ...review.findingComments, ...posted.findingComments },
				findingsReview: posted.findingsReview ?? review.findingsReview
			}
		});
	}

	return {
		accept: (id: string) => decide(id, { state: 'accepted' }),

		dismiss: (id: string, reason: DismissalReason, note?: string) =>
			decide(id, { state: 'dismissed', reason, ...(note && { note }) }),

		reopen: (id: string) =>
			writeDecision(id, undefined, async (reviewId) => {
				await client.reopen(reviewId, id);

				return undefined;
			}),

		/** Turns the finding's quieted topic back on, so every finding of it counts again. */
		async unquiet(id: string): Promise<void> {
			const reviewId = currentReview().id;
			const topic = findingOf(id).topic;

			if (!topic?.quieted) return;

			const ofTopic = (finding: Finding) => finding.topic?.id === topic.id;
			const { quieted: _quieted, ...heard } = topic;

			patchFindings(ofTopic, (finding) => ({ ...finding, topic: heard }));

			try {
				await whilePending(id, () => plainly(() => client.unquiet(reviewId, topic.id)));
			} catch (error) {
				patchFindings(ofTopic, (finding) => ({ ...finding, topic }));

				throw error;
			}
		},

		/**
		 * Saves the vote. The server counts only "useful", so "not useful" or
		 * none takes a useful vote back and is otherwise kept on this page.
		 */
		async vote(id: string, vote: Vote | null): Promise<void> {
			const reviewId = currentReview().id;
			const before = state.getState().votes[id] ?? null;

			const setVote = (next: Vote | null) =>
				state.setState((current) => {
					const { [id]: _old, ...votes } = current.votes;

					return { votes: next ? { ...votes, [id]: next } : votes };
				});

			setVote(vote);

			try {
				if (vote === 'useful') await whilePending(id, () => plainly(() => client.markUseful(reviewId, id)));
				else if (before === 'useful') await whilePending(id, () => plainly(() => client.unmarkUseful(reviewId, id)));
			} catch (error) {
				setVote(before);

				throw error;
			}
		},

		async post(id: string): Promise<void> {
			const reviewId = currentReview().id;

			acceptPosted(await whilePending(id, () => plainly(() => client.postFinding(reviewId, id))));
		},

		async postAll(): Promise<void> {
			const reviewId = currentReview().id;

			state.setState({ postingAll: true });

			try {
				acceptPosted(await plainly(() => client.postFindings(reviewId)));
			} finally {
				state.setState({ postingAll: false });
			}
		}
	};
}

export type BugActions = ReturnType<typeof createBugActions>;
