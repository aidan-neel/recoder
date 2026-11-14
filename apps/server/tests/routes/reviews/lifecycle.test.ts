import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	emptyReviewProgress,
	emptyTokenUsage,
	reviewTally,
	type BriefQuestionReport,
	type BriefQuestionResult,
	type Finding,
	type ObligationReport,
	type ProgressSummaries,
	type ReviewAssignment,
	type ReviewContext,
	type ReviewListItem,
	type ReviewTask
} from '@recoder/shared';
import { app } from '../../../src/app';
import { pullStateKey, pullStates } from '../../../src/forge/pulls/pull-states';
import type { RunTokenCall, StoredMetrics } from '../../../src/models/metrics';
import { reviewInstructions } from '../../../src/review/chat/review-chat';
import { db, reviewMetrics, reviewProgress } from '../../../src/store';
import { testReview } from '../../helpers/review';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-lifecycle-route-'));
});

const CONTEXT: ReviewContext = {
	units: { 'unit-1': { supplied: [{ kind: 'diff', path: 'src/a.ts', startLine: 1, endLine: 4 }], omitted: [] } },
	reviewers: [
		{ assignmentId: 'unit-1/correctness', role: 'reviewer', unit: 'unit-1', read: [], cited: [], omitted: [] }
	],
	findings: []
};

test('the review list leaves out each context record, which the single review still serves', async () => {
	const review = await db.reviews.set(testReview({ context: CONTEXT }));

	const listed = (await (await app.request('/api/reviews')).json()) as Record<string, unknown>[];

	expect(listed.map((item) => item.id)).toContain(review.id);
	expect(listed.filter((item) => 'context' in item)).toEqual([]);

	expect(await (await app.request(`/api/reviews/${review.id}`)).json()).toMatchObject({ context: CONTEXT });
});

test('the stored metrics route serves the row with its pipeline runs and run-tagged calls, null without one', async () => {
	const review = await db.reviews.set(testReview());
	const path = `/api/reviews/${review.id}/metrics/stored`;

	expect(await (await app.request(path)).json()).toBeNull();

	const run = {
		index: 0,
		startedAt: '2026-10-06T19:00:00.000Z',
		orchestrator: 'muse',
		subagent: 'muse',
		lockMisses: 0
	};

	const call: RunTokenCall = {
		id: 'call-1',
		model: 'muse',
		provider: 'opencode',
		scope: 'pipeline',
		status: 'completed',
		usage: emptyTokenUsage(),
		run: 0
	};

	const row: StoredMetrics = {
		id: review.id,
		startedAt: run.startedAt,
		pipelineTracked: true,
		runs: [run],
		calls: [call]
	};

	await reviewMetrics.set(row);
	expect(await (await app.request(path)).json()).toEqual(row);
	expect((await app.request('/api/reviews/no-such-review/metrics/stored')).status).toBe(404);
});

test('a review started with instructions runs with them as the developer brief', async () => {
	const env = {
		RECODER_REVIEW_BASE_URL: 'http://localhost:9/v1',
		RECODER_REVIEW_API_KEY: 'test',
		RECODER_REVIEW_MODEL: 'm'
	};

	Object.assign(process.env, env);

	try {
		const repo = await db.repos.set({
			id: 'repo-brief',
			name: 'brief',
			url: `file://${join(tmpdir(), 'recoder-no-such-repo')}`,
			provider: 'local',
			defaultBranch: 'main',
			createdAt: '',
			updatedAt: ''
		});

		const res = await app.request('/api/reviews', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ repoId: repo.id, prNumber: 3, instructions: '  only the python files ' })
		});

		const review = (await res.json()) as { id: string; startedAt: string };

		expect(res.status).toBe(201);
		expect(await reviewInstructions(review.id, review.startedAt)).toBe('only the python files');
	} finally {
		for (const key of Object.keys(env)) delete process.env[key];
	}
});

/** A finding with the text, proof and fix a list never needs. */
function heavyFinding(id: string, severity: Finding['severity']): Finding {
	return {
		id,
		file: 'src/a.ts',
		line: 3,
		severity,
		title: `Finding ${id}`,
		message: `[correctness] ${'A long explanation of the bug. '.repeat(40)}`,
		suggestion: 'Check the bound first.',
		category: 'correctness',
		verification: { status: 'verified', method: 'run', reason: 'The test fails.', command: 'bun test', exitCode: 1 }
	};
}

/** A brief question with the answer text and source a list never needs. */
function question(id: string, result: BriefQuestionResult): BriefQuestionReport['questions'][number] {
	return {
		id,
		question: `Does ${id} break?`,
		owners: ['unit-1/correctness'],
		source: { file: 'src/a.ts', line: 3 },
		answers: [],
		followUps: [],
		result,
		reason: 'Traced through the caller.'
	};
}

test('the summary list cuts each review to what the queue counts, and counts the same as the full review', async () => {
	const questions = {
		counts: {
			asked: 3,
			confirmed: 1,
			disproved: 1,
			unresolved: 1,
			notApplicable: 0,
			followUpsRun: 0,
			followUpsNotRun: 0
		},
		questions: [question('Q1', 'unresolved'), question('Q2', 'disproved'), question('Q3', 'confirmed')]
	} satisfies BriefQuestionReport;

	const obligations = {
		obligations: [{ id: 'obligation-1' }, { id: 'obligation-2' }],
		answers: [
			{ obligationId: 'obligation-1', result: 'disproved', reason: 'Bounded by the caller.' },
			{ obligationId: 'obligation-2', result: 'confirmed', reason: 'It overflows.' },
			{ obligationId: 'obligation-9', result: 'disproved', reason: 'An answer with no obligation.' }
		]
	} as unknown as ObligationReport;

	const full = await db.reviews.set(
		testReview({
			summary: 'Adds a bounds check.',
			prTitle: 'Bounds',
			prUrl: 'https://github.com/acme/api/pull/1',
			findings: [heavyFinding('f1', 'error'), heavyFinding('f2', 'warning'), heavyFinding('f3', 'info')],
			unconfirmed: [heavyFinding('u1', 'error')],
			questions,
			obligations,
			context: CONTEXT
		})
	);

	const listed = (await (await app.request('/api/reviews?view=summary')).json()) as ReviewListItem[];
	const item = listed.find((entry) => entry.id === full.id)!;
	const decided = { f1: 'sent', 'question:Q1': 'accepted' };

	expect(reviewTally(full, decided)).toEqual({ open: 2, tone: 'medium', sent: 1, receipts: 2 });
	expect(reviewTally(item, decided)).toEqual(reviewTally(full, decided));
	expect(reviewTally(item, {})).toEqual(reviewTally(full, {}));

	expect(item.findings).toEqual([
		{ id: 'f1', severity: 'error' },
		{ id: 'f2', severity: 'warning' },
		{ id: 'f3', severity: 'info' }
	]);

	const { findings: _findings, questions: _questions, obligations: _obligations, ...fields } = item;

	expect(fields).toEqual({
		id: full.id,
		repoId: full.repoId,
		prNumber: full.prNumber,
		headSha: full.headSha,
		status: full.status,
		summary: full.summary,
		prTitle: full.prTitle,
		prUrl: full.prUrl,
		createdAt: full.createdAt,
		updatedAt: full.updatedAt
	});

	expect(JSON.stringify(item).length).toBeLessThan(JSON.stringify(full).length / 5);
	await db.reviews.delete(full.id);
});

test('the review list carries each pull request’s last known forge state, full and summary', async () => {
	const settled = await db.reviews.set(testReview({ repoId: 'settled-repo', prNumber: 9 }));
	const other = await db.reviews.set(testReview({ repoId: 'other-repo', prNumber: 9 }));

	await pullStates.set({
		id: pullStateKey('settled-repo', 9),
		repoId: 'settled-repo',
		number: 9,
		state: 'merged',
		checkedAt: new Date().toISOString()
	});

	const listed = (await (await app.request('/api/reviews')).json()) as Record<string, unknown>[];
	const summary = (await (await app.request('/api/reviews?view=summary')).json()) as ReviewListItem[];

	expect(listed.find((item) => item.id === settled.id)?.pullState).toBe('merged');
	expect(summary.find((item) => item.id === settled.id)?.pullState).toBe('merged');
	expect(listed.find((item) => item.id === other.id)).not.toHaveProperty('pullState');

	await db.reviews.delete(settled.id);
	await db.reviews.delete(other.id);
	await pullStates.delete(pullStateKey('settled-repo', 9));
});

test('progress summaries list only reviews still queued or running', async () => {
	const running = await db.reviews.set(testReview({ status: 'running' }));
	const finished = await db.reviews.set(testReview({ status: 'passed' }));

	const task = (id: string, status: ReviewTask['status']): ReviewTask => ({
		id,
		label: id,
		status,
		message: id,
		updatedAt: ''
	});

	const reviewer = { id: 'unit-1/correctness', status: 'running' } as ReviewAssignment;

	for (const review of [running, finished]) {
		await reviewProgress.set({
			...emptyReviewProgress(review.id),
			tasks: { fetch: task('fetch', 'done'), unit: task('unit', 'running') },
			assignments: [reviewer]
		});
	}

	const summaries = (await (await app.request('/api/reviews/progress-summaries')).json()) as ProgressSummaries;

	expect(summaries[running.id]).toEqual({ tasksDone: 1, tasksTotal: 2, agents: 1 });
	expect(summaries[finished.id]).toBeUndefined();

	await db.reviews.set({ ...running, status: 'passed' });
	expect(await (await app.request('/api/reviews/progress-summaries')).json()).not.toHaveProperty(running.id);

	for (const review of [running, finished]) {
		await db.reviews.delete(review.id);
		await reviewProgress.delete(review.id);
	}
});
