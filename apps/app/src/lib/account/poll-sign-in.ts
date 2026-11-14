import type { DeviceSignInState } from '@recoder/shared';

import type { AuthApi } from '../api/accounts';
import { isOffline, OFFLINE_TEXT } from '../api/http';
import { waitFor } from '../shell/wait-for';

/** How an attempt ended: every answer but `pending`. */
export type SignInOutcome = Exclude<DeviceSignInState, { state: 'pending' }>;

/** Polls that fail to reach the server in a row before the sign-in gives up. */
const MAX_OFFLINE_POLLS = 3;

/** The shortest wait between polls, so a server that asks for none is never hammered. */
const MIN_INTERVAL_SECONDS = 1;

interface PollOptions {
	signInState: AuthApi['signInState'];
	attemptId: string;
	/** Seconds between polls, as the forge asked. */
	interval: number;
	/** Stops the polling: the wait and the poll in flight both end with the signal's reason. */
	signal: AbortSignal;
	/** Resolves after `ms`, or rejects with the signal's reason once it aborts. */
	wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Asks where a device sign-in stands, one poll at a time and `interval`
 * seconds apart, until it ends. A poll is never sent while another is in
 * flight. A server that cannot be reached is asked again, a few times; any
 * other failure ends the attempt with its reason. Rejects with the signal's
 * reason once it aborts.
 */
export async function pollSignIn(options: PollOptions): Promise<SignInOutcome> {
	const { signInState, attemptId, signal, wait = waitFor } = options;
	const pause = Math.max(options.interval, MIN_INTERVAL_SECONDS) * 1000;
	let offlinePolls = 0;

	for (;;) {
		await wait(pause, signal);
		signal.throwIfAborted();

		try {
			const answer = await signInState(attemptId, signal);

			offlinePolls = 0;

			if (answer.state !== 'pending') return answer;
		} catch (error) {
			signal.throwIfAborted();

			if (!isOffline(error)) throw error;
			if (++offlinePolls >= MAX_OFFLINE_POLLS) return { state: 'failed', reason: OFFLINE_TEXT };
		}
	}
}
