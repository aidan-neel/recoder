import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding } from '@recoder/shared';
import { decideProposal, listProposals, proposeQuieting } from '../../../src/review/guidelines/learned/proposals';
import { recordVote, topicTallies } from '../../../src/review/guidelines/learned/votes';
import { db } from '../../../src/store';
import { savedReview, send } from './finding-requests';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-feedback-route-'));
});

const TOPIC = 'smell:magic-value';

const finding = (id: string, quieted?: true): Finding => ({
	id,
	fingerprint: `print-${id}`,
	file: 'src/a.ts',
	line: 1,
	severity: 'warning',
	message: '[readability] A bare number',
	category: 'readability',
	smell: 'magic-value',
	topic: { id: TOPIC, label: 'Magic value', ...(quieted ? { quieted } : {}) }
});

test('accepting and then dismissing a finding counts it once, as dismissed', async () => {
	const review = await savedReview([finding('f1')]);

	expect(await (await send(`/api/reviews/${review.id}/useful/f1`, 'PUT')).json()).toEqual({ useful: true });
	expect(topicTallies('repo-1').get(TOPIC)).toEqual({ useful: 1, dismissed: 0 });

	await send(`/api/reviews/${review.id}/findings/f1/decision`, 'PUT', { state: 'dismissed', reason: 'wrong' });
	expect(topicTallies('repo-1').get(TOPIC)).toEqual({ useful: 0, dismissed: 1 });

	expect(await (await send(`/api/reviews/${review.id}/useful/f1`, 'DELETE')).json()).toEqual({ removed: false });
	await send(`/api/reviews/${review.id}/findings/f1/decision`, 'DELETE');
	expect(topicTallies('repo-1').size).toBe(0);
});

test('turning a topic back on shows the review findings it quieted and forgets its dismissals and approved rule', async () => {
	const review = await savedReview([finding('f1', true), finding('f2')]);

	recordVote('repo-1', { findingKey: 'old', topic: TOPIC, choice: 'dismissed', votedAt: new Date().toISOString() });
	proposeQuieting('repo-1', { id: TOPIC, label: 'Magic value' }, { dismissed: 3, useful: 0 });
	decideProposal('repo-1', TOPIC, 'approved');

	const answer = await send(`/api/reviews/${review.id}/quieted/${encodeURIComponent(TOPIC)}`, 'DELETE');

	expect(await answer.json()).toEqual({ unquieted: ['f1'] });

	expect((await db.reviews.get(review.id))?.findings.map((entry) => entry.topic?.quieted)).toEqual([
		undefined,
		undefined
	]);

	expect(topicTallies('repo-1').size).toBe(0);
	expect(listProposals('repo-1')).toEqual([]);
});
