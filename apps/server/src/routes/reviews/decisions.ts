import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DISMISSAL_REASONS, type FindingDecision, type FindingDecisionInput } from '@recoder/shared';
import {
	forgetDecision,
	learnFromDecision,
	type DecidedFinding
} from '../../review/guidelines/learned/decision-learning';
import { dismissalKey } from '../../review/guidelines/learned/finding-key';
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
 * The `:id` review's finding `:findingId`, keyed as later reviews match it, or
 * the 404/409 that ends the request. The server's own copy of the finding
 * decides what is remembered, never the client's.
 */
async function decisionTarget(c: Context): Promise<(DecidedFinding & { reviewId: string }) | Response> {
	const target = await requireFinding(c, c.req.param('findingId') ?? '');

	if (target instanceof Response) return target;

	const { review, finding } = target;
	const diff = await reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	return { reviewId: review.id, repoId: review.repoId, finding, dismissalKey: dismissalKey(finding, diff) };
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

/** Saves `decision` on the review's finding, or clears it when undefined, in one read-modify-write. */
async function saveDecision(reviewId: string, findingId: string, decision: FindingDecision | undefined): Promise<void> {
	await db.reviews.update(reviewId, (current) => {
		if (!current) return undefined;

		const findings = current.findings.map((finding) => {
			if (finding.id !== findingId) return finding;

			const { decision: _previous, ...open } = finding;

			return decision ? { ...open, decision } : open;
		});

		return { ...current, findings, updatedAt: new Date().toISOString() };
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

	await saveDecision(target.reviewId, target.finding.id, decision);
	learnFromDecision(target, decision);

	return c.json(decision);
});

/** Reopen a decided finding: remove its decision and forget what the decision taught later reviews. */
app.delete('/:id/findings/:findingId/decision', async (c) => {
	const target = await decisionTarget(c);

	if (target instanceof Response) return target;

	await saveDecision(target.reviewId, target.finding.id, undefined);
	forgetDecision(target);

	return c.json({ reopened: true });
});

export default app;
