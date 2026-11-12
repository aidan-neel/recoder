import { expect, test } from 'bun:test';
import { withReviewMetrics } from '../../../../src/models/metrics';
import { createRun } from '../../../../src/review/pipeline/harness/context';
import { recordHistorySources, recordLearnedHistory } from '../../../../src/review/pipeline/harness/history-record';
import type { IntentSource } from '../../../../src/review/pipeline/intent/types';
import { db, reviewMetrics } from '../../../../src/store';
import { testReview } from '../../../helpers/review';
import { useTempStore } from '../../../helpers/temp-store';
import { DIFF } from '../harness-fixtures';

const store = useTempStore('recoder-history-record-');

const sources: IntentSource[] = [
	{ kind: 'pr', ref: 'pr', title: 'Cache intents', text: 'The PR body is not history.' },
	{ kind: 'pr-history', ref: 'pr:#31', revision: 'abc1234', range: 'p..abc1234', recorded: true, text: 'Earlier PR' },
	{ kind: 'pr-history', ref: 'history:unavailable', text: 'Commits with no record: def5678' },
	{ kind: 'related-review', ref: 'review:#31', text: 'An earlier review of the file' }
];

/** The history the review's first pipeline run recorded, after `record` ran inside it. */
async function recorded(repoId: string | undefined, record: (run: ReturnType<typeof createRun>) => void) {
	const review = await db.reviews.set(testReview({ repoId: repoId ?? 'missing-repo', headSha: 'head' }));
	const run = createRun({ diff: DIFF, sandboxPath: null, repoId });

	store.track(review.id);

	run.dismissals = [
		{ repoId: 'repo', fingerprint: 'fp-1', file: 'a.ts', category: 'bug', title: 'x', dismissedAt: '2026-11-01' }
	];

	run.topicTallies = new Map([['null-check', { useful: 1, dismissed: 3 }]]);

	await withReviewMetrics(review.id, 'pipeline', () => record(run));

	return (await reviewMetrics.get(review.id))?.runs?.[0]?.history;
}

test('a run records the history sources, dismissals and votes it received, and unavailable history by name', async () => {
	const history = await recorded('repo', (run) => {
		recordLearnedHistory(run);
		recordHistorySources(sources);
	});

	expect(history).toEqual({
		dismissals: ['fp-1'],
		topics: { 'null-check': { useful: 1, dismissed: 3 } },
		sources: [
			{ kind: 'pr-history', ref: 'pr:#31', revision: 'abc1234', range: 'p..abc1234', recorded: true },
			{ kind: 'pr-history', ref: 'history:unavailable' },
			{ kind: 'related-review', ref: 'review:#31' }
		]
	});
});

test('a review without a repository records no learned history, which says it never read any', async () => {
	expect(await recorded(undefined, (run) => recordLearnedHistory(run))).toBeUndefined();
});
