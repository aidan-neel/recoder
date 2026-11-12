import { describe, expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewProgress, type ReviewStage, type ReviewTask } from '@recoder/shared';

import { runStages } from '../../src/lib/run/run-stages';

function progress(stage: ReviewStage, change: Partial<ReviewProgress> = {}): ReviewProgress {
	return { ...emptyReviewProgress('rv1'), stage, ...change };
}

function verification(id: string, status: ReviewTask['status']): ReviewTask {
	return { id, label: id, status, message: '', updatedAt: '', kind: 'verification' };
}

function states(live: ReviewProgress | null, phase: Parameters<typeof runStages>[2]): string[] {
	return runStages(live, phase === 'passed' ? 'passed' : 'running', phase).map((stage) => `${stage.id}:${stage.state}`);
}

describe('runStages', () => {
	test('the pipeline stages fold into read, plan, check and write', () => {
		expect(states(progress('checkout'), 'running')).toEqual([
			'read:active',
			'plan:waiting',
			'check:waiting',
			'write:waiting'
		]);

		expect(states(progress('understand'), 'running')).toEqual([
			'read:active',
			'plan:waiting',
			'check:waiting',
			'write:waiting'
		]);

		expect(states(progress('checks'), 'running')).toEqual([
			'read:done',
			'plan:active',
			'check:waiting',
			'write:waiting'
		]);

		expect(states(progress('subagents'), 'running')).toEqual([
			'read:done',
			'plan:active',
			'check:waiting',
			'write:waiting'
		]);

		expect(states(progress('verify'), 'running')).toEqual(['read:done', 'plan:done', 'check:active', 'write:waiting']);

		expect(states(progress('consolidation'), 'running')).toEqual([
			'read:done',
			'plan:done',
			'check:done',
			'write:active'
		]);
	});

	test('a queued review waits on every step, a passed one is done with all, and no review has none', () => {
		expect(states(null, 'queued')).toEqual(['read:waiting', 'plan:waiting', 'check:waiting', 'write:waiting']);
		expect(states(progress('consolidation'), 'passed')).toEqual(['read:done', 'plan:done', 'check:done', 'write:done']);
		expect(runStages(null, 'draft', 'none')).toEqual([]);
	});

	test('a failed review leaves the step it stopped on waiting, not active', () => {
		const stages = runStages(progress('verify'), 'failed', 'failed').map((stage) => stage.state);

		expect(stages).toEqual(['done', 'done', 'waiting', 'waiting']);
	});

	test('a paused review keeps its step active', () => {
		expect(runStages(progress('verify', { paused: true }), 'running', 'paused')[2].state).toBe('active');
	});

	test('the plan step counts claims and the check step counts settled verifications', () => {
		const tasks = {
			a: verification('a', 'done'),
			b: verification('b', 'error'),
			c: verification('c', 'running'),
			d: verification('d', 'queued')
		};

		const [, plan, check] = runStages(progress('verify', { candidateCount: 4, tasks }), 'running', 'running');

		expect(plan).toMatchObject({ detail: '4 claims', share: null });
		expect(check).toMatchObject({ detail: '2 of 4', share: 0.5 });
	});

	test('a waiting step shows no count', () => {
		const [, , check] = runStages(
			progress('checks', { tasks: { a: verification('a', 'done') } }),
			'running',
			'running'
		);

		expect(check).toMatchObject({ state: 'waiting', detail: null, share: null });
	});
});
