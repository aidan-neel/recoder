import { Hono } from 'hono';
import { candidateOutcome } from '../../review/pipeline/candidate-outcome';
import { toFinding } from '../../review/pipeline/consolidate';
import { reviewCheckpoints, reviewReplays } from '../../store';
import { requireReview } from './shared';

const app = new Hono();

/**
 * Every candidate the review raised, shown or not, with the stage that
 * stopped it; for evals. Read from the running review's checkpoint, else the
 * one a passed review kept for replay. Candidates of unfinished units and
 * detector results are not in a checkpoint.
 */
app.get('/:id/candidates', (c) => {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	const kept = reviewCheckpoints.get(review.id) ?? reviewReplays.get(review.id);

	if (!kept) return c.json({ error: 'this review kept no candidates' }, 404);

	return c.json(kept.candidates.map((candidate) => ({ ...toFinding(candidate), ...candidateOutcome(candidate) })));
});

export default app;
