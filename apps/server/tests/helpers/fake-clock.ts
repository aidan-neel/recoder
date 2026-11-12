import { afterEach, beforeEach, jest } from 'bun:test';

/** Promise callbacks run after each step of the clock, enough for a stream read, its parse and the turn that follows. */
const FLUSH_ROUNDS = 500;

/** For a test file: every test runs on bun's fake clock, which also moves `Date.now`. */
export function useFakeClock(): void {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());
}

/**
 * Moves the fake clock on `stepMs` at a time, running what each step wakes, until `work` settles. Throws when it
 * has not settled after `maxMs`.
 */
export async function settleOnClock<T>(work: Promise<T>, stepMs: number, maxMs: number): Promise<T> {
	let settled = false;
	const tracked = work.finally(() => (settled = true));

	await flush();

	for (let elapsed = 0; !settled && elapsed < maxMs; elapsed += stepMs) {
		jest.advanceTimersByTime(stepMs);
		await flush();
	}

	if (!settled) throw new Error(`The work did not settle within ${maxMs} ms of the fake clock`);

	return tracked;
}

async function flush(): Promise<void> {
	for (let round = 0; round < FLUSH_ROUNDS; round++) await Promise.resolve();
}
