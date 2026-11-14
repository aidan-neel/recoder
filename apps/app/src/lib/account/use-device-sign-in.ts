'use client';

import type { Account, DeviceSignIn, StartDeviceSignIn } from '@recoder/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthApi } from '../api/accounts';
import { failureText } from '../api/http';
import { waitFor } from '../shell/wait-for';
import { pollSignIn } from './poll-sign-in';

/** How long the signed-in face shows before the sign-in lets the page go on. */
const SIGNED_IN_MS = 700;

/** Where a device sign-in stands. Every phase after `idle` knows the forge it is for. */
type SignInPhase =
	| { phase: 'idle' }
	| { phase: 'starting'; input: StartDeviceSignIn }
	| { phase: 'pending'; input: StartDeviceSignIn; code: DeviceSignIn }
	| { phase: 'signed-in'; input: StartDeviceSignIn; account: Account }
	| { phase: 'expired' | 'denied'; input: StartDeviceSignIn }
	| { phase: 'failed'; input: StartDeviceSignIn; reason: string };

/** A sign-in that has been started: every phase but `idle`. */
export type ActiveSignIn = Exclude<SignInPhase, { phase: 'idle' }>;

/** The attempt's phase, and what starts or drops it. */
export interface DeviceSignInView {
	state: SignInPhase;
	/** Starts an attempt on a forge, dropping any that is running. */
	start: (input: StartDeviceSignIn) => void;
	/** Drops the attempt and goes back to where a forge is chosen. */
	reset: () => void;
}

/** True when the error is the abort this hook asked for, which is no failure. */
function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * One device sign-in: it asks the server for a code, polls until the person
 * has answered on the forge, and hands the account to `onSignedIn` a beat
 * after the signed-in face shows. One attempt runs at a time; starting
 * another, resetting, or unmounting stops its polling.
 */
export function useDeviceSignIn(api: AuthApi, onSignedIn: (account: Account) => void): DeviceSignInView {
	const [state, setState] = useState<SignInPhase>({ phase: 'idle' });
	const running = useRef<AbortController | null>(null);
	const finished = useRef(onSignedIn);

	useEffect(() => {
		finished.current = onSignedIn;
	}, [onSignedIn]);

	const reset = useCallback(() => {
		running.current?.abort();
		running.current = null;
		setState({ phase: 'idle' });
	}, []);

	useEffect(() => () => running.current?.abort(), []);

	const start = useCallback(
		(input: StartDeviceSignIn) => {
			running.current?.abort();

			const attempt = new AbortController();

			running.current = attempt;
			setState({ phase: 'starting', input });
			void runAttempt(api, input, attempt.signal, setState, (account) => finished.current(account));
		},
		[api]
	);

	return { state, start, reset };
}

/** The attempt from the code to its end. An abort leaves the state to whoever aborted. */
async function runAttempt(
	api: AuthApi,
	input: StartDeviceSignIn,
	signal: AbortSignal,
	show: (state: SignInPhase) => void,
	finish: (account: Account) => void
): Promise<void> {
	try {
		const code = await api.startSignIn(input);

		signal.throwIfAborted();
		show({ phase: 'pending', input, code });

		const outcome = await pollSignIn({
			signInState: api.signInState,
			attemptId: code.attemptId,
			interval: code.interval,
			signal
		});

		if (outcome.state === 'signed-in') {
			show({ phase: 'signed-in', input, account: outcome.account });
			await waitFor(SIGNED_IN_MS, signal);
			finish(outcome.account);
		} else if (outcome.state === 'failed') {
			show({ phase: 'failed', input, reason: outcome.reason });
		} else {
			show({ phase: outcome.state, input });
		}
	} catch (error) {
		if (signal.aborted && isAbort(error)) return;

		show({ phase: 'failed', input, reason: failureText(error, 'The sign-in did not start.') });
	}
}
