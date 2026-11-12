import { toast } from '@recoder/ui';

import { reviewsApi } from '../api/reviews';
import { retryToast, undoToast } from '../shell/notify';
import type { DecisionState } from './surface';

/** Decisions that say a finding was worth raising. */
const USEFUL: ReadonlySet<DecisionState> = new Set(['accepted', 'sent']);

/** One finding's useful mark, set or taken back. */
interface Vote {
	reviewId: string;
	findingId: string;
	useful: boolean;
}

/** Each finding's votes still on their way, by `review/finding`; a vote waits only on the votes before it for the same finding. */
const chains = new Map<string, Promise<void>>();

/** The Try again toast each finding's failed vote raised, until a newer vote for it replaces the failure. */
const offers = new Map<string, string | number>();

/**
 * The change to a finding's useful mark that a decision change asks for:
 * `true` sets it on the way into accepted or sent from anything else,
 * `false` takes it back on the way from accepted or sent to open, and null
 * asks for nothing. A dismissal replaces the mark on the server by itself,
 * and accepted and sent count the same.
 */
function usefulChange(was: DecisionState, now: DecisionState): boolean | null {
	if (USEFUL.has(now) && !USEFUL.has(was)) return true;
	if (USEFUL.has(was) && now === 'open') return false;

	return null;
}

/** Where a finding's votes are tracked. */
function keyOf(vote: Vote): string {
	return `${vote.reviewId}/${vote.findingId}`;
}

/** What a failed vote leaves, in one sentence beside the toast's Try again. */
function standing(useful: boolean): string {
	return useful ? 'Recoder may not count it as useful.' : 'Recoder may still count it as useful.';
}

/** Takes away the finding's Try again toast, if one is showing. */
function withdraw(key: string): void {
	const offer = offers.get(key);

	if (offer === undefined) return;

	offers.delete(key);
	toast.dismiss(offer);
}

/** Says the vote failed, with a Try again that sends it once more while no newer vote for the finding came after. */
function fail(key: string, vote: Vote): void {
	const offer = retryToast('Couldn’t save that', standing(vote.useful), () => {
		if (offers.get(key) === offer) enqueue(vote, true);
	});

	offers.set(key, offer);
}

async function send({ reviewId, findingId, useful }: Vote): Promise<void> {
	if (useful) await reviewsApi.markUseful(reviewId, findingId);
	else await reviewsApi.unmarkUseful(reviewId, findingId);
}

/**
 * Sends `vote` after the finding's earlier votes. A failure is reported only
 * while the vote is still the finding's latest, since a newer one settles
 * where the finding stands; a vote Try again sent says Saved when it lands.
 */
function enqueue(vote: Vote, retried = false): void {
	const key = keyOf(vote);
	const latest = () => chains.get(key) === chain;

	withdraw(key);

	const chain: Promise<void> = (chains.get(key) ?? Promise.resolve())
		.then(() => send(vote))
		.then(
			() => {
				if (latest() && retried) undoToast('Saved');
			},
			() => {
				if (latest()) fail(key, vote);
			}
		);

	chains.set(key, chain);

	void chain.then(() => {
		if (latest()) chains.delete(key);
	});
}

/**
 * Tells the server a person found a finding useful (accepted or sent it
 * back), or no longer does, so Recoder learns which topics people want
 * raised in the repository (see {@link usefulChange}). A finding's votes run
 * one at a time, in order; a failed one offers Try again and lets the next
 * go.
 */
export function sendUsefulVote(reviewId: string, findingId: string, was: DecisionState, now: DecisionState): void {
	const useful = usefulChange(was, now);

	if (useful !== null) enqueue({ reviewId, findingId, useful });
}
