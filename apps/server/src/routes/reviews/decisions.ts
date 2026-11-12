import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DISMISSAL_REASONS, type Finding, type FindingDecision, type FindingDecisionInput } from '@recoder/shared';
import {
	forgetDecision,
	learnFromDecision,
	type DecidedFinding
} from '../../review/guidelines/learned/decision-learning';
import { learningKeys } from '../../review/guidelines/learned/finding-key';
import { earlierCopies } from '../../review/history/history';
import { settingsTransaction, storageTransaction } from '../../storage/backend';
import { db, reviewDiffs } from '../../store';
import { parseBody } from '../parse-body';
import { requireFinding } from './shared';

const app = new Hono();

const MAX_NOTE_CHARS = 500;

const note = z.string().trim().max(MAX_NOTE_CHARS).optional();

const decisionSchema: z.ZodType<FindingDecisionInput> = z.discriminatedUnion('state', [
	z.object({ state: z.literal('accepted'), note }),
	z.object({ state: z.literal('dismissed'), reason: z.enum(DISMISSAL_REASONS), note })
]);

/**
 * The `:id` review's finding `:findingId`, keyed as later reviews match it and
 * as earlier reviews of the pull request learned it, or the 404/409 that ends
 * the request. The server's own copy of the finding decides what is
 * remembered, never the client's.
 */
async function decisionTarget(c: Context): Promise<(DecidedFinding & { reviewId: string }) | Response> {
	const target = await requireFinding(c, c.req.param('findingId') ?? '');

	if (target instanceof Response) return target;

	const { review, finding } = target;
	const diff = await reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	const earlier = await earlierCopies(review, finding.id);

	return {
		reviewId: review.id,
		repoId: review.repoId,
		finding,
		keys: learningKeys(finding, diff),
		earlierKeys: earlier.map((copy) => learningKeys(copy.finding, copy.diff))
	};
}

/** The decision as saved: what the person chose, without an empty note, stamped now. */
function decisionOf(input: FindingDecisionInput): FindingDecision {
	return {
		state: input.state,
		...(input.state === 'dismissed' ? { reason: input.reason } : {}),
		...(input.note ? { note: input.note } : {}),
		decidedAt: new Date().toISOString()
	};
}

/** Saves `decision` on the review's finding, replacing any earlier one. */
async function saveDecision(reviewId: string, findingId: string, decision: FindingDecision): Promise<void> {
	await updateFinding(reviewId, findingId, (open) => ({ ...open, decision }));
}

/** Removes the decision from the review's finding, so it is open again. */
async function clearDecision(reviewId: string, findingId: string): Promise<void> {
	await updateFinding(reviewId, findingId, (open) => open);
}

/** Replaces the review's finding with `change` of it without its decision, in one read-modify-write. */
async function updateFinding(reviewId: string, findingId: string, change: (open: Finding) => Finding): Promise<void> {
	await db.reviews.update(reviewId, (current) => {
		if (!current) return undefined;

		const findings = current.findings.map((finding) => {
			if (finding.id !== findingId) return finding;

			const { decision: _previous, ...open } = finding;

			return change(open);
		});

		return { ...current, findings, updatedAt: new Date().toISOString() };
	});
}

/**
 * Changes the review, then learns, in one transaction, so a decision is saved
 * with what it taught or, when another replica changed the shared tables
 * first, not at all. The review is changed first: its record lock orders
 * concurrent decisions on one review, so each reads the shared tables after
 * the one before it committed.
 */
async function decideInOneCommit(changeReview: () => Promise<void>, learn: () => void): Promise<void> {
	await storageTransaction(async () => {
		await changeReview();
		await settingsTransaction(learn);
	});
}

/**
 * Accept or dismiss one of the review's findings, with a reason when
 * dismissing. The decision is saved on the finding, so every device and the
 * review list agree, and later reviews learn from it as `learnFromDecision`
 * says. Answers the saved decision.
 */
app.put('/:id/findings/:findingId/decision', async (c) => {
	const body = await parseBody(c, decisionSchema);

	if (body instanceof Response) return body;

	const target = await decisionTarget(c);

	if (target instanceof Response) return target;

	const decision = decisionOf(body);

	await decideInOneCommit(
		() => saveDecision(target.reviewId, target.finding.id, decision),
		() => learnFromDecision(target, decision)
	);

	return c.json(decision);
});

/** Reopen a decided finding: remove its decision and forget what the decision taught later reviews. */
app.delete('/:id/findings/:findingId/decision', async (c) => {
	const target = await decisionTarget(c);

	if (target instanceof Response) return target;

	await decideInOneCommit(
		() => clearDecision(target.reviewId, target.finding.id),
		() => forgetDecision(target)
	);

	return c.json({ reopened: true });
});

export default app;
