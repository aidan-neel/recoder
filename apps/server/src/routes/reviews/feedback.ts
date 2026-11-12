import { Hono } from 'hono';
import type { Finding, FindingTopic } from '@recoder/shared';
import { forgetDismissedVotes, recordVote, removeVote, voteKeyOf } from '../../review/guidelines/learned/votes';
import { db } from '../../store';
import { requireFinding, requireReview } from './shared';

const app = new Hono();

/** Topic ids are `rule:` and a 16-character hash, or `smell:` or `category:` and a short id. */
const MAX_TOPIC_ID_CHARS = 100;

type TopicFinding = Finding & { topic: FindingTopic };

/**
 * Count that a person found one of the review's findings useful: they
 * accepted it or sent it on. It replaces a dismissed vote on the same finding.
 * `useful` is false when the finding has no topic, so nothing was counted.
 */
app.put('/:id/useful/:findingId', async (c) => {
	const target = await requireFinding(c, c.req.param('findingId'));

	if (target instanceof Response) return target;

	const { review, finding } = target;

	if (!finding.topic) return c.json({ useful: false });

	recordVote(review.repoId, {
		findingKey: voteKeyOf(finding),
		topic: finding.topic.id,
		choice: 'useful',
		votedAt: new Date().toISOString()
	});

	return c.json({ useful: true });
});

/** Take back a useful vote. A dismissal recorded since stays: only the dismissal routes change it. */
app.delete('/:id/useful/:findingId', async (c) => {
	const target = await requireFinding(c, c.req.param('findingId'));

	if (target instanceof Response) return target;

	const { review, finding } = target;

	return c.json({ removed: removeVote(review.repoId, voteKeyOf(finding), 'useful') });
});

/** The finding with its topic no longer quieted. */
function unquiet(finding: TopicFinding): Finding {
	const { quieted: _quieted, ...topic } = finding.topic;

	return { ...finding, topic };
}

/**
 * Turn a quieted topic back on: forget the repository's dismissed votes on
 * it, so later reviews show its findings until people dismiss it again, and
 * show this review's quieted findings of it. Exact dismissals of single
 * findings stay. Answers the ids of the findings it showed.
 */
app.delete('/:id/quieted/:topicId', async (c) => {
	const review = await requireReview(c);

	if (review instanceof Response) return review;

	const topicId = c.req.param('topicId');

	if (topicId.length > MAX_TOPIC_ID_CHARS) return c.json({ error: 'topic id too long' }, 400);

	const quieted = (finding: Finding): finding is TopicFinding =>
		finding.topic?.id === topicId && finding.topic.quieted === true;

	forgetDismissedVotes(review.repoId, topicId);

	let unquieted: string[] = [];

	await db.reviews.update(review.id, (current) => {
		if (!current) return undefined;

		unquieted = current.findings.filter(quieted).map((finding) => finding.id);

		if (unquieted.length === 0) return current;

		return {
			...current,
			findings: current.findings.map((finding) => (quieted(finding) ? unquiet(finding) : finding)),
			updatedAt: new Date().toISOString()
		};
	});

	return c.json({ unquieted });
});

export default app;
