'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import type { AuthApi } from '../api/accounts';
import { ApiError, failureText } from '../api/http';
import { useAccount } from './account-store';

/** The server answered 409: someone else finished setup. */
const SETUP_DONE = 409;

/** The server answered 429: too many wrong codes. */
const TOO_MANY_TRIES = 429;

/** The `kind` of the 403 for a wrong code. */
const WRONG_CODE_KIND = 'setup-code';

/** Everything the setup code step shows and does. */
export interface UnlockSetupView {
	code: string;
	setCode: (code: string) => void;
	/** Why the code was not taken; null while there is nothing to say. */
	error: string | null;
	status: ButtonStatus;
	/** Counts the refused codes, so the field can select the text each time one is refused. */
	refused: number;
	submit: () => void;
}

/** The plain line for a refused code. */
function refusal(error: unknown): string {
	if (error instanceof ApiError && error.kind === WRONG_CODE_KIND) return 'That code is not right.';

	if (error instanceof ApiError && error.status === TOO_MANY_TRIES) {
		return 'Too many tries. Wait a moment, then try again.';
	}

	return failureText(error, 'The code was not checked.');
}

/**
 * The setup code step. A right code unlocks setup for this browser and the
 * screen reads who is signed in again, which opens the forge choice. A wrong
 * code shows under the field with its text selected; a 409 means someone
 * else finished setup, so the screen reads again and shows sign-in.
 */
export function useUnlockSetup(api: AuthApi): UnlockSetupView {
	const [code, setCodeText] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [refused, setRefused] = useState(0);

	async function submit(): Promise<void> {
		if (!code.trim() || status !== 'idle') return;

		setStatus('pending');
		setError(null);

		try {
			await api.unlockSetup({ code: code.trim() });
			setStatus('success');
			await useAccount.getState().reload();
		} catch (failure) {
			setStatus('idle');

			if (failure instanceof ApiError && failure.status === SETUP_DONE) {
				await useAccount.getState().reload();

				return;
			}

			setError(refusal(failure));
			setRefused((count) => count + 1);
		}
	}

	return {
		code,
		setCode: (value) => {
			setCodeText(value);
			setError(null);
		},
		error,
		status,
		refused,
		submit: () => void submit()
	};
}
