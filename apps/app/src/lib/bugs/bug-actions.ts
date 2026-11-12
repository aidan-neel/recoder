import type { DismissalReason, Finding, FindingDecision, Review } from '@recoder/shared';

import { plainly } from '../api/http';
import type { DecisionInput } from '../api/reviews';
import type { SessionContext, Vote } from '../pull/session-state';
import { withKey, withoutKey } from '../shell/key-set';

/** What a person does with the findings of the followed review. Each write shows at once and rolls back when it fails. */
export function createBugActions(context: SessionContext) {
	const { client, state } = context;

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

	/** Runs a write on one finding while it shows as pending. */
	async function whilePending<T>(id: string, write: () => Promise<T>): Promise<T> {
		state.setState((current) => ({ pendingBugs: withKey(current.pendingBugs, id) }));

		try {
			return await write();
		} finally {
			state.setState((current) => ({ pendingBugs: withoutKey(current.pendingBugs, id) }));
		}
	}

	/** Shows the decision at once, saves it, and puts the old one back when the save fails. */
	async function decide(id: string, input: DecisionInput): Promise<void> {
		const reviewId = currentReview().id;
		const before = findingOf(id).decision;

		setDecision(id, { ...input, decidedAt: new Date().toISOString() });

		try {
			const saved = await whilePending(id, () => plainly(() => client.decide(reviewId, id, input)));

			setDecision(id, saved);
		} catch (error) {
			setDecision(id, before);

			throw error;
		}
	}

	/** Takes a review the server answered with, when it is still the one on screen. */
	function acceptReview(review: Review): void {
		if (state.getState().review?.id === review.id) state.setState({ review });
	}

	return {
		accept: (id: string) => decide(id, { state: 'accepted' }),

		dismiss: (id: string, reason: DismissalReason, note?: string) =>
			decide(id, { state: 'dismissed', reason, ...(note && { note }) }),

		async reopen(id: string): Promise<void> {
			const reviewId = currentReview().id;
			const before = findingOf(id).decision;

			setDecision(id, undefined);

			try {
				await whilePending(id, () => plainly(() => client.reopen(reviewId, id)));
			} catch (error) {
				setDecision(id, before);

				throw error;
			}
		},

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

			acceptReview(await whilePending(id, () => plainly(() => client.postFinding(reviewId, id))));
		},

		async postAll(): Promise<void> {
			const reviewId = currentReview().id;

			state.setState({ postingAll: true });

			try {
				acceptReview(await plainly(() => client.postFindings(reviewId)));
			} finally {
				state.setState({ postingAll: false });
			}
		}
	};
}

export type BugActions = ReturnType<typeof createBugActions>;
