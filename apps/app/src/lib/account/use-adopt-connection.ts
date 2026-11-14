'use client';

import type { Account, ConnectedForge } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useRef, useState } from 'react';

import type { AuthApi } from '../api/accounts';
import { failureText } from '../api/http';
import { waitFor } from '../shell/wait-for';

/** How long the success face shows before the page goes on. */
const ADOPTED_MS = 700;

/** Where "Continue as" stands, and what it needs. */
export interface AdoptView {
	/** The connection being adopted; null while none is. */
	target: ConnectedForge | null;
	status: ButtonStatus;
	/** The server's reason the last try failed; null otherwise. */
	reason: string | null;
	/** Makes the account from a connection the server already has. One try runs at a time. */
	adopt: (connection: ConnectedForge) => void;
}

/**
 * "Continue as @login": asks the server to make the account from a
 * connection it already has. The button spins while it asks, shows a check
 * when it is done, and hands the account over a beat later; a refusal shows
 * the server's reason and lets the person try again.
 */
export function useAdoptConnection(api: AuthApi, onSignedIn: (account: Account) => void): AdoptView {
	const [target, setTarget] = useState<ConnectedForge | null>(null);
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [reason, setReason] = useState<string | null>(null);
	const running = useRef<AbortController | null>(null);
	const finished = useRef(onSignedIn);

	useEffect(() => {
		finished.current = onSignedIn;
	}, [onSignedIn]);

	useEffect(() => () => running.current?.abort(), []);

	async function run(connection: ConnectedForge, signal: AbortSignal): Promise<void> {
		try {
			const { account } = await api.adopt({ provider: connection.provider });

			signal.throwIfAborted();
			setStatus('success');
			await waitFor(ADOPTED_MS, signal);
			finished.current(account);
		} catch (error) {
			if (signal.aborted) return;

			setStatus('idle');
			setReason(failureText(error, 'Couldn’t sign in with that connection.'));
		}
	}

	return {
		target,
		status,
		reason,
		adopt: (connection) => {
			if (status === 'pending' || status === 'success') return;

			const attempt = new AbortController();

			running.current = attempt;
			setTarget(connection);
			setStatus('pending');
			setReason(null);
			void run(connection, attempt.signal);
		}
	};
}
