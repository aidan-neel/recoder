import { expect, test } from 'bun:test';
import type { ReviewAssignment } from '@recoder/shared';
import { progressFrame } from '../../../src/cli/output/progress-frame';
import { advanceProgress, initialProgress, type ProgressState } from '../../../src/cli/output/progress-state';
import type { ProgressEvent } from '../../../src/cli/progress';
import { PLAIN_SURFACE } from '../../../src/cli/terminal/surface';

const STARTED_AT = 1_000_000;

function assignment(id: string, status: ReviewAssignment['status'], title = `Reviewer ${id}`): ProgressEvent {
	return { type: 'assignment', assignment: { id, role: 'reviewer', title, reason: '', status, scope: [] } };
}

/** The state after these events, each a second after the one before. */
function after(events: ProgressEvent[]): ProgressState {
	return events.reduce(
		(state, event, index) => advanceProgress(state, event, STARTED_AT + (index + 1) * 1000),
		initialProgress(STARTED_AT)
	);
}

function frameOf(state: ProgressState, now: number): string {
	return progressFrame(state, { now, surface: PLAIN_SURFACE, title: 'Reviewing', hint: 'ctrl-c cancels' }).join('\n');
}

test('a stage keeps the time it was first entered when the review reports it again', () => {
	const state = after([
		{ type: 'stage', stage: 'reviewing' },
		{ type: 'stage', stage: 'subagents' },
		{ type: 'stage', stage: 'reviewing' }
	]);

	expect(state.stage).toBe('reviewing');
	expect(state.stageStartedAt.reviewing).toBe(STARTED_AT + 1000);
});

test('a later report of an assignment replaces the earlier one in its place', () => {
	const state = after([assignment('a', 'queued'), assignment('b', 'queued'), assignment('a', 'running')]);

	expect(state.assignments.map(({ id, status }) => [id, status])).toEqual([
		['a', 'running'],
		['b', 'queued']
	]);
});

test('a frame lists the stages entered and those ahead, and leaves out one the review skipped', () => {
	const state = after([
		{ type: 'stage', stage: 'checkout' },
		{ type: 'stage', stage: 'reviewing' }
	]);

	const frame = frameOf(state, STARTED_AT + 5000);

	expect(frame).toContain('Checkout');
	expect(frame).toContain('Verify');
	expect(frame).not.toContain('Understand');
});

test('a finished stage shows how long it took, up to the next stage entered', () => {
	const state = after([
		{ type: 'stage', stage: 'checkout' },
		{ type: 'stage', stage: 'understand' }
	]);

	expect(frameOf(state, STARTED_AT + 60_000)).toMatch(/Checkout\s+1s/);
});

test('finished assignments are counted in one line, and only those still open are listed', () => {
	const state = after([
		{ type: 'stage', stage: 'reviewing' },
		assignment('a', 'done', 'Sync job'),
		assignment('b', 'running', 'Command line')
	]);

	const frame = frameOf(state, STARTED_AT + 5000);

	expect(frame).toContain('Command line');
	expect(frame).not.toContain('Sync job');
	expect(frame).toContain('1 finished');
});
