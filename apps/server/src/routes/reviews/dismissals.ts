import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { splitCategoryTag, type Finding, type Review } from '@recoder/shared';
import { recordDismissal, removeDismissal } from '../../review/guidelines/learned/dismissals';
import { dismissalKey } from '../../review/guidelines/learned/finding-key';
import { matchesDismissal } from '../../review/pipeline/harness/findings';
import { reviewDiffs } from '../../store';
import { parseBody } from '../parse-body';
import { requireReview } from './shared';

const app = new Hono();

const dismissRequestSchema = z.object({
	findingId: z.string().min(1).max(200),
	reason: z.string().trim().max(500).optional()
});

const MAX_TITLE_CHARS = 200;

/**
 * The `:id` review, one of its findings and the fingerprint later reviews match
 * it by, or the 404/409 that ends the request. The server's own copy of the
 * finding decides what is remembered, never the client's.
 */
function dismissalTarget(
	c: Context,
	findingId: string
): { review: Review; finding: Finding; fingerprint: string } | Response {
	const review = requireReview(c);

	if (review instanceof Response) return review;

	const finding = review.findings.find((entry) => entry.id === findingId);

	if (!finding) return c.json({ error: 'finding not found' }, 404);

	const diff = reviewDiffs.get(review.id);

	if (!diff) return c.json({ error: 'no diff yet' }, 409);

	return { review, finding, fingerprint: dismissalKey(finding, diff) };
}

/** The title a person saw on the finding: its own, else the first line of its message. */
function titleOf(finding: Finding): string {
	const title = finding.title ?? splitCategoryTag(finding.message).body.split('\n')[0];

	return title.slice(0, MAX_TITLE_CHARS);
}

/** Remember that a person dismissed one of the review's findings, so later reviews of the repository do not report it again. */
app.post('/:id/dismissals', async (c) => {
	const body = await parseBody(c, dismissRequestSchema);

	if (body instanceof Response) return body;

	const target = dismissalTarget(c, body.findingId);

	if (target instanceof Response) return target;

	const { review, finding, fingerprint } = target;

	recordDismissal({
		repoId: review.repoId,
		fingerprint,
		file: finding.file,
		category: finding.category ?? '',
		title: titleOf(finding),
		...(body.reason ? { reason: body.reason } : {}),
		dismissedAt: new Date().toISOString()
	});

	return c.json({ dismissed: true });
});

/**
 * Forget the finding's dismissal, so later reviews may report it again. Every held key that matches the finding goes,
 * the old place-only form included; the dismissal of another finding split from the same line stays.
 */
app.delete('/:id/dismissals/:findingId', (c) => {
	const target = dismissalTarget(c, c.req.param('findingId'));

	if (target instanceof Response) return target;

	const { review, fingerprint } = target;

	return c.json({ restored: removeDismissal(review.repoId, (held) => matchesDismissal(held, fingerprint)) });
});

export default app;
