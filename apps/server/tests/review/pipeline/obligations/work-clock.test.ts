import { expect, test } from 'bun:test';
import { advanceClock, freezeClockEachTest } from '../../../helpers/manual-clock';
import { WorkClock } from '../../../../src/review/pipeline/obligations/work-clock';
import { ReviewControl, runWithReviewControl } from '../../../../src/review/session/review-control';

freezeClockEachTest();

test('the clock stops while a call waits in the queue and runs again once it starts', () => {
	const clock = new WorkClock();

	advanceClock(2_000);
	clock.queued();
	advanceClock(60_000);

	expect(clock.reading()).toEqual({ elapsedMs: 62_000, queuedMs: 60_000, workingMs: 2_000 });

	clock.started();
	advanceClock(3_000);
	clock.finished();
	advanceClock(1_000);

	expect(clock.reading()).toEqual({ elapsedMs: 66_000, queuedMs: 60_000, workingMs: 6_000 });
	expect(clock.workingMs()).toBe(6_000);
});

test('a call queued behind one of its own running calls is still working time', () => {
	const clock = new WorkClock();

	clock.queued();
	clock.started();
	clock.queued();
	advanceClock(5_000);
	clock.finished();
	clock.started();
	advanceClock(1_000);
	clock.finished();

	expect(clock.reading()).toEqual({ elapsedMs: 6_000, queuedMs: 0, workingMs: 6_000 });
});

test('waits that overlap count once', () => {
	const clock = new WorkClock();

	clock.queued();
	advanceClock(1_000);
	clock.queued();
	advanceClock(1_000);
	clock.started();
	advanceClock(500);
	clock.finished();
	advanceClock(4_000);
	clock.started();
	clock.finished();

	expect(clock.reading()).toEqual({ elapsedMs: 6_500, queuedMs: 6_000, workingMs: 500 });
});

test("the clock keeps the review's pauses out even when read from outside the review, as a tool call over HTTP is", async () => {
	const control = new ReviewControl();
	const clock = await runWithReviewControl(control, async () => new WorkClock());

	advanceClock(1_000);
	control.pause();
	advanceClock(30_000);
	control.resume();
	advanceClock(1_000);

	expect(clock.reading()).toEqual({ elapsedMs: 2_000, queuedMs: 0, workingMs: 2_000 });
});
