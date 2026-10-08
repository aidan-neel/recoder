import { afterEach, beforeEach, setSystemTime } from 'bun:test';

/** Where the system clock stands at the start of each test that freezes it. */
export const FROZEN_AT = 1_000_000;

/**
 * Freezes the system clock at `FROZEN_AT` for each test in the calling file
 * and lets it run again after, so the review clock moves only when a test
 * moves it and every reading is exact.
 */
export function freezeClockEachTest(): void {
	beforeEach(() => setSystemTime(new Date(FROZEN_AT)));
	afterEach(() => setSystemTime());
}

/** Moves the frozen clock on by `ms`. */
export function advanceClock(ms: number): void {
	setSystemTime(new Date(Date.now() + ms));
}
