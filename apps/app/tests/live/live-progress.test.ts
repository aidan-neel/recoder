import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewAssignment, type ReviewProgress, type ReviewTask } from '@recoder/shared';

import { stepProgress } from '../../src/lib/live/live-progress';
import { reviewerRows } from '../../src/lib/live/reviewers';
import { stageDetail, stageRows } from '../../src/lib/live/stages';

function task(id: string, status: ReviewTask['status'], message = ''): ReviewTask {
	return { id, label: id, status, message, updatedAt: '' };
}

function assignment(id: string, status: string, role = 'reviewer'): ReviewAssignment {
	return {
		id,
		role,
		title: `${id} · Correctness`,
		reason: '',
		status: status as ReviewAssignment['status'],
		scope: []
	};
}

function progress(patch: Partial<ReviewProgress>): ReviewProgress {
	return { ...emptyReviewProgress('r1'), ...patch };
}

describe('stages', () => {
	test('stages before the running one are done, later ones idle, and subagents stay hidden when none ran', () => {
		const rows = stageRows(
			progress({ stage: 'reviewing', assignments: [assignment('a', 'running')] }),
			'running',
			'running'
		);

		expect(rows.map((row) => [row.key, row.state])).toEqual([
			['checkout', 'done'],
			['understand', 'done'],
			['checks', 'done'],
			['reviewing', 'active'],
			['verify', 'idle'],
			['consolidation', 'idle']
		]);
	});

	test('a paused review holds its stage without a spinner', () => {
		const row = stageRows(progress({ stage: 'verify', paused: true }), 'paused', 'running').find(
			(item) => item.key === 'verify'
		);

		expect(row?.state).toBe('paused');
		expect(row?.glyph).toBe('idle');
	});

	test('the running stage shows its own step while checking out, and the latest activity after', () => {
		const checkout = progress({
			tasks: { fetch: task('fetch', 'done', 'Fetched'), sandbox: task('sandbox', 'running', 'Preparing sandbox…') },
			activity: [{ sequence: 3, message: 'git fetch origin', at: '' }]
		});

		expect(stageDetail(checkout, 'running')).toBe('Preparing sandbox…');

		const reviewing = progress({
			stage: 'reviewing',
			activity: [
				{ sequence: 4, message: 'Reading 9 changed files…', at: '' },
				{ sequence: 5, message: 'rg -n "refill" · exit 0', at: '' }
			]
		});

		expect(stageDetail(reviewing, 'running')).toBe('rg -n "refill" · exit 0');
	});
});

describe('steps', () => {
	const tasks = {
		fetch: task('fetch', 'done'),
		verify: task('verify', 'partial'),
		skip: task('skip', 'skipped'),
		run: task('run', 'running')
	};

	test('a check that could not verify counts as a finished step', () => {
		expect(stepProgress(progress({ tasks, planVersion: 1 }), 'running')).toEqual({
			done: 3,
			total: 4,
			share: 0.75,
			counted: true
		});
	});

	test('before the plan is known the meter slides and the growing count stays hidden', () => {
		expect(stepProgress(progress({ tasks }), 'running')).toMatchObject({ share: null, counted: false });
	});

	test('a queued review rests empty even with steps kept from an earlier run', () => {
		expect(stepProgress(progress({ tasks, planVersion: 1 }), 'queued')).toMatchObject({ share: 0, counted: false });
	});
});

describe('reviewers', () => {
	test('a repeated reviewer id keeps its latest copy, and a legacy partial status reads as finished', () => {
		const rows = reviewerRows(
			[assignment('a', 'running'), assignment('b', 'queued'), assignment('a', 'partial')],
			'running'
		);

		expect(rows.map((row) => [row.id, row.glyph, row.state])).toEqual([
			['a', 'ok', 'Finished'],
			['b', 'idle', 'Queued']
		]);
	});
});
