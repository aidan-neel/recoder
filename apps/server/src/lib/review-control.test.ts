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

test('cancel releases anyone waiting on a pause', async () => {
	const control = new ReviewControl();
	control.pause();
	const gate = runWithReviewControl(control, () => reviewPausePoint());
	control.cancel();
	await gate;
	expect(control.abort.signal.aborted).toBe(true);
	expect(control.pause()).toBe(false);
});
