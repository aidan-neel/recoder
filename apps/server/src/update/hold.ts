/**
 * While an update pauses and applies, no new review pipeline may start: a
 * review queued during the update simply stays queued, and the boot after the
 * restart picks it back up. `runReviewPipeline` checks this before anything
 * else. The flag is process-local on purpose: the successor process starts
 * with starts allowed.
 */
let held = false;

export function holdReviewStarts(): void {
	held = true;
}

export function releaseReviewStarts(): void {
	held = false;
}

export function reviewStartsHeld(): boolean {
	return held;
}
