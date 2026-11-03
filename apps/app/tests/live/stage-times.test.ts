import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewAssignment, type ReviewProgress, type ReviewTask } from '@recoder/shared';

import { stageTimes } from '../../src/lib/live/stage-times';
import { stageRows } from '../../src/lib/live/stages';

/** Seconds into the review as an ISO timestamp. */
function at(seconds: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
}

function task(id: string, kind: ReviewTask['kind'], start: number, end: number | null): ReviewTask {
	return {
		id,
		label: id,
		kind,
		status: end === null ? 'running' : 'done',
		message: '',
		startedAt: at(start),
		updatedAt: at(end ?? start)
	};
}

function reviewer(id: string, start: number, end: number | null): ReviewAssignment {
	return {
		id,
		role: 'reviewer',
		title: id,
		reason: '',
		status: end === null ? 'running' : 'done',
		scope: [],
		startedAt: at(start),
		...(end === null ? {} : { completedAt: at(end) })
	};
}

function times(patch: Partial<ReviewProgress>) {
	const progress = { ...emptyReviewProgress('r1'), ...patch };

	return stageTimes(progress, stageRows(progress, 'running', 'running'));
}

describe('stage times', () => {
	test('a finished stage ends where the next one starts, even when its late work runs on', () => {
		const result = times({
			stage: 'reviewing',
			tasks: {
				fetch: task('fetch', 'checkout', 0, 6),
				inventory: task('inventory', 'inventory', 6, 20),
				setup: task('setup', 'setup', 20, 50),
				patches: task('patches', 'checks', 50, null)
			},
			assignments: [reviewer('a', 47, null)]
		});

		expect(result.get('checkout')?.took).toBe(6000);
		expect(result.get('understand')?.took).toBe(14000);
		expect(result.get('checks')?.took).toBe(27000);
		expect(result.get('reviewing')).toEqual({ took: null, since: Date.parse(at(47)) });
	});

	test('a stage whose next one started before it shows no time', () => {
		const result = times({
			stage: 'reviewing',
			tasks: { inventory: task('inventory', 'inventory', 30, 40), setup: task('setup', 'setup', 10, 20) },
			assignments: [reviewer('a', 45, null)]
		});

		expect(result.get('understand')?.took).toBeNull();
		expect(result.get('checkout')?.took).toBeNull();
	});
});
