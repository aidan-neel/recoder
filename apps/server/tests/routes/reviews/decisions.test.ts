import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DismissalReason, Finding } from '@recoder/shared';
import { listDismissals, recordDismissal } from '../../../src/review/guidelines/learned/dismissals';
import { dismissalKey } from '../../../src/review/guidelines/learned/finding-key';
import { listProposals } from '../../../src/review/guidelines/learned/proposals';
import { topicTallies } from '../../../src/review/guidelines/learned/votes';
import { closeStore, db } from '../../../src/store';
import { DIFF } from '../../review/pipeline/harness-fixtures';
import { savedReview, send } from './finding-requests';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-decision-route-'));
});

const TOPIC = 'category:correctness';

const finding: Finding = {
	id: 'finding-1',
	title: 'Drops the old value',
	file: 'src/a.ts',
	line: 1,
	severity: 'warning',
	message: '[correctness] The old value is lost',
	category: 'correctness',
	topic: { id: TOPIC, label: 'Correctness' }
};

/** Two findings consolidation split from one line, each with its own claim. */
const split: Finding[] = [
	{
		...finding,
		id: 'stale',
		title: 'Expired entry is served',
		message: '[correctness] A read after expiry returns the old entry',
		claim: {
			trigger: 'a second request reads the entry after it expired',
			executionPath: [],
			consequence: 'the caller gets a stale value',
			violatedContract: 'expired entries are never served'
		}
	},
	{
		...finding,
		id: 'wraps',
		title: 'Index wraps around',
		message: '[correctness] The counter overflows on long loops',
		claim: {
			trigger: 'the loop runs past two billion iterations',
			executionPath: [],
			consequence: 'the counter turns negative and reads out of bounds',
			violatedContract: 'indexes stay inside the array'
		}
	}
];

const decisionPath = (reviewId: string, findingId: string) => `/api/reviews/${reviewId}/findings/${findingId}/decision`;

const dismiss = (reviewId: string, findingId: string, reason: DismissalReason, note?: string) =>
	send(decisionPath(reviewId, findingId), 'PUT', { state: 'dismissed', reason, ...(note ? { note } : {}) });

test('dismissing a finding saves the decision on the review and remembers it under the stored copy', async () => {
	const review = await savedReview([finding]);

	const answer = await dismiss(review.id, 'finding-1', 'wrong', 'on purpose');

	expect(answer.status).toBe(200);
	expect(await answer.json()).toMatchObject({ state: 'dismissed', reason: 'wrong', note: 'on purpose' });

	expect((await db.reviews.get(review.id))?.findings[0]?.decision).toMatchObject({
		state: 'dismissed',
		reason: 'wrong'
	});

	expect(listDismissals('repo-1')).toMatchObject([
		{ fingerprint: dismissalKey(finding, DIFF), reason: 'wrong', note: 'on purpose', title: 'Drops the old value' }
	]);

	expect(topicTallies('repo-1').get(TOPIC)).toEqual({ useful: 0, dismissed: 1 });
});

test('reopening a finding removes its decision, its remembered dismissal and its vote', async () => {
	const review = await savedReview([finding]);

	await dismiss(review.id, 'finding-1', 'not-worth-fixing');

	const answer = await send(decisionPath(review.id, 'finding-1'), 'DELETE');

	expect(await answer.json()).toEqual({ reopened: true });
	expect((await db.reviews.get(review.id))?.findings[0]?.decision).toBeUndefined();
	expect(listDismissals('repo-1')).toEqual([]);
	expect(topicTallies('repo-1').size).toBe(0);
});

test('a duplicate stops nothing and counts nothing, and already handled stops the finding without judging its topic', async () => {
	const review = await savedReview(split);

	await dismiss(review.id, 'stale', 'duplicate');
	expect(listDismissals('repo-1')).toEqual([]);
	expect(topicTallies('repo-1').size).toBe(0);

	await dismiss(review.id, 'wraps', 'already-handled');
	expect(listDismissals('repo-1').map((held) => held.reason)).toEqual(['already-handled']);
	expect(topicTallies('repo-1').size).toBe(0);
});

test('accepting a dismissed finding forgets the dismissal and counts it once, as useful', async () => {
	const review = await savedReview([finding]);

	await dismiss(review.id, 'finding-1', 'style-preference');
	await send(decisionPath(review.id, 'finding-1'), 'PUT', { state: 'accepted' });

	expect(listDismissals('repo-1')).toEqual([]);
	expect(topicTallies('repo-1').get(TOPIC)).toEqual({ useful: 1, dismissed: 0 });
});

test('a dismissal needs one of the listed reasons, and an unknown review or finding is a 404', async () => {
	const review = await savedReview([finding]);

	expect((await send(decisionPath(review.id, 'finding-1'), 'PUT', { state: 'dismissed' })).status).toBe(400);

	expect((await send(decisionPath(review.id, 'finding-1'), 'PUT', { state: 'dismissed', reason: 'meh' })).status).toBe(
		400
	);

	expect((await dismiss(review.id, 'nope', 'wrong')).status).toBe(404);
	expect((await send(decisionPath(review.id, 'nope'), 'DELETE')).status).toBe(404);
	expect((await dismiss('missing', 'finding-1', 'wrong')).status).toBe(404);
	expect(listDismissals('repo-1')).toEqual([]);
});

test('two findings split from one line are dismissed and reopened independently', async () => {
	const review = await savedReview(split);

	for (const entry of split) expect((await dismiss(review.id, entry.id, 'wrong')).status).toBe(200);

	const keys = split.map((entry) => dismissalKey(entry, DIFF));

	expect(keys[0]).not.toBe(keys[1]);

	await send(decisionPath(review.id, 'stale'), 'DELETE');
	expect(listDismissals('repo-1').map((held) => held.fingerprint)).toEqual([keys[1]]);
});

test('reopening a finding forgets a dismissal stored in the old place-only form', async () => {
	const review = await savedReview(split);
	const placeOnly = dismissalKey(split[0], DIFF).split(':')[0];

	recordDismissal({
		repoId: 'repo-1',
		fingerprint: placeOnly,
		file: 'src/a.ts',
		category: 'correctness',
		title: 'Expired entry is served',
		dismissedAt: new Date().toISOString()
	});

	await send(decisionPath(review.id, 'stale'), 'DELETE');
	expect(listDismissals('repo-1')).toEqual([]);
});

test('dismissing a topic often proposes quieting it, and nothing is quieted before a person approves', async () => {
	const findings = ['a', 'b', 'c'].map((id) => ({ ...finding, id, fingerprint: `print-${id}` }));
	const review = await savedReview(findings);

	for (const entry of findings) await dismiss(review.id, entry.id, 'wrong');

	expect(listProposals('repo-1')).toMatchObject([{ topic: { id: TOPIC }, state: 'proposed', votes: { dismissed: 3 } }]);
	expect(topicTallies('repo-1').get(TOPIC)?.quietApproved).toBeUndefined();
});

test('a decision and its reason are still there after the server restarts', async () => {
	await closeStore();

	const review = await savedReview([finding]);

	await dismiss(review.id, 'finding-1', 'already-handled', 'fixed in #12');
	await closeStore();

	expect((await db.reviews.get(review.id))?.findings[0]?.decision).toMatchObject({
		state: 'dismissed',
		reason: 'already-handled',
		note: 'fixed in #12'
	});

	expect(listDismissals('repo-1')).toMatchObject([{ reason: 'already-handled', note: 'fixed in #12' }]);
});
