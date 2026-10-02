import { expect, test } from 'bun:test';
import { ReviewControl, reviewNow, reviewPausePoint, runWithReviewControl } from './review-control';

test('pause holds model calls and stops the review clock; resume releases both', async () => {
	const control = new ReviewControl();
	await runWithReviewControl(control, async () => {
		const before = reviewNow();
		expect(control.pause()).toBe(true);
		expect(control.pauseSignal.aborted).toBe(true);
		let passed = false;
		const gate = reviewPausePoint().then(() => { passed = true; });
		await Bun.sleep(150);
		expect(passed).toBe(false);
		// Paused time does not count against deadlines.
		expect(reviewNow() - before).toBeLessThan(50);
		expect(control.resume()).toBe(true);
		await gate;
		expect(passed).toBe(true);
		expect(control.pauseSignal.aborted).toBe(false);
	});
});

test('a plan nobody approves settles as a timeout, and an answer in time wins over the timer', async () => {
	const unanswered = new ReviewControl();
	expect(await unanswered.requestApproval(20)).toBe('timeout');
	expect(unanswered.awaitingApproval).toBe(false);
	const answered = new ReviewControl();
	const pending = answered.requestApproval(5_000);
	expect(answered.approve('all')).toBe(true);
	expect(await pending).toBe('all');
	expect(answered.approve('limited')).toBe(false);
});

test('cancel releases anyone waiting on a pause', async () => {
	const control = new ReviewControl();
	control.pause();
	const gate = runWithReviewControl(control, () => reviewPausePoint());
	control.cancel();
	await gate;
	expect(control.abort.signal.aborted).toBe(true);
	expect(control.pause()).toBe(false);
});
