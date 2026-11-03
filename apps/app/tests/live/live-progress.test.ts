import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewAssignment, type ReviewProgress, type ReviewTask } from '@recoder/shared';

import { progressShare } from '../../src/lib/live/live-progress';
import { reviewerRows } from '../../src/lib/live/reviewers';
import { stageNote, stageRows } from '../../src/lib/live/stages';

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
		const note = (snapshot: ReviewProgress) => {
			const row = stageRows(snapshot, 'running', 'running').find((item) => item.state === 'active');

			return row ? stageNote(row, snapshot, 'running') : null;
		};

		const checkout = progress({
			tasks: { fetch: task('fetch', 'done', 'Fetched'), sandbox: task('sandbox', 'running', 'Preparing sandbox…') },
			activity: [{ sequence: 3, message: 'git fetch origin', at: '' }]
		});

		expect(note(checkout)).toBe('Preparing sandbox…');

		const understanding = progress({
			stage: 'understand',
			activity: [
				{ sequence: 4, message: 'Reading 9 changed files…', at: '' },
				{ sequence: 5, message: 'rg -n "refill" · exit 0', at: '' }
			]
		});

		expect(note(understanding)).toBe('rg -n "refill" · exit 0');
	});
});

describe('progress', () => {
	const tasks = {
		fetch: task('fetch', 'done'),
		verify: task('verify', 'partial'),
		skip: task('skip', 'skipped'),
		run: task('run', 'running')
	};

	test('a check that could not verify counts as a finished step', () => {
		expect(progressShare(progress({ tasks, planVersion: 1 }), 'running')).toBe(0.75);
	});

	test('before the plan is known the meter slides', () => {
		expect(progressShare(progress({ tasks }), 'running')).toBeNull();
	});

	test('a queued review rests empty even with steps kept from an earlier run', () => {
		expect(progressShare(progress({ tasks, planVersion: 1 }), 'queued')).toBe(0);
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
