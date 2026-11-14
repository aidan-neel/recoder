import { describe, expect, test } from 'bun:test';
import type { DeviceSignInState } from '@recoder/shared';

import { NetworkError, OFFLINE_TEXT } from '../../src/lib/api/http';
import { pollSignIn } from '../../src/lib/account/poll-sign-in';

/** A wait that records how long it was asked for and returns at once. */
function recordedWaits(): { waits: number[]; wait: (ms: number) => Promise<void> } {
	const waits: number[] = [];

	return { waits, wait: async (ms) => void waits.push(ms) };
}

describe('pollSignIn', () => {
	test('polls one at a time at the forge’s interval until the attempt ends', async () => {
		const answers: DeviceSignInState[] = [{ state: 'pending' }, { state: 'pending' }, { state: 'denied' }];
		const { waits, wait } = recordedWaits();
		let inFlight = 0;
		let overlapped = false;

		const outcome = await pollSignIn({
			attemptId: 'a1',
			interval: 5,
			signal: new AbortController().signal,
			wait,
			signInState: async () => {
				inFlight += 1;
				overlapped ||= inFlight > 1;
				await Promise.resolve();
				inFlight -= 1;

				return answers.shift() ?? { state: 'expired' };
			}
		});

		expect(outcome).toEqual({ state: 'denied' });
		expect(waits).toEqual([5000, 5000, 5000]);
		expect(overlapped).toBe(false);
	});

	test('stops polling once the signal aborts', async () => {
		const controller = new AbortController();
		let polls = 0;

		const outcome = pollSignIn({
			attemptId: 'a1',
			interval: 1,
			signal: controller.signal,
			wait: async () => {},
			signInState: async () => {
				polls += 1;
				controller.abort();

				return { state: 'pending' };
			}
		});

		await expect(outcome).rejects.toThrow();
		expect(polls).toBe(1);
	});

	test('gives up with the offline text after three unreachable polls in a row', async () => {
		const outcome = await pollSignIn({
			attemptId: 'a1',
			interval: 1,
			signal: new AbortController().signal,
			wait: async () => {},
			signInState: () => Promise.reject(new NetworkError('Failed to fetch'))
		});

		expect(outcome).toEqual({ state: 'failed', reason: OFFLINE_TEXT });
	});

	test('a server error ends the poll with that error', async () => {
		const outcome = pollSignIn({
			attemptId: 'a1',
			interval: 1,
			signal: new AbortController().signal,
			wait: async () => {},
			signInState: () => Promise.reject(new Error('Unknown attempt'))
		});

		await expect(outcome).rejects.toThrow('Unknown attempt');
	});
});
