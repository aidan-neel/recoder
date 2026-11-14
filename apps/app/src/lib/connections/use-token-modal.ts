'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import { ApiError, failureText } from '../api/http';
import { useCloseOnSuccess } from '../settings/use-close-on-success';
import { useConnections } from './connections-store';
import { FORGES, type ForgeInfo } from './forges';
import type { Forge } from '../api/connections';

/** Where the server keeps a token (`apps/server/src/forge/tokens.ts`). */
const STORED = 'Saved to tokens.json in the server’s data folder.';

/** Which field a rejection belongs to, and what it says. */
interface TokenRejection {
	field: 'token' | 'host';
	text: string;
}

/** Everything the connect-token dialog shows and does. */
export interface TokenModalView {
	status: ButtonStatus;
	/** The check of the token is with the server: the fields hold still and the modal stays open until it answers. */
	pending: boolean;
	token: string;
	/** The GitLab URL field; only a GitLab dialog shows it. */
	host: string;
	/** The saved GitLab host the field starts from, or ''. */
	savedHost: string;
	error: TokenRejection | null;
	/** The token field's hint: what the token needs, and where the server keeps it. */
	tokenHint: string;
	/** The token has text, or a status face is still showing. */
	canSubmit: boolean;
	/** The dialog's onOpenChange: a close waits while the check runs. */
	changeOpen: (next: boolean) => void;
	setToken: (token: string) => void;
	setHost: (host: string) => void;
	/** Sends the form; a no-op while the check runs or with no token. */
	submit: () => void;
	/** The forge's copy for the dialog: name, scopes, placeholder. */
	info: ForgeInfo;
}

function rejection(error: unknown): TokenRejection {
	const field = error instanceof ApiError && error.kind === 'host' ? 'host' : 'token';

	return { field, text: failureText(error, 'The forge rejected that token.') };
}

/**
 * Connect GitHub or GitLab with a personal access token. The server checks
 * the token with the forge before it keeps it; a rejection lands under the
 * field it is about (`error.field`). While the check runs the fields are
 * read-only and the dialog holds still: Escape, a click outside and Cancel
 * wait for the answer. It closes a beat after the check face, then calls `onSaved`.
 */
export function useTokenModal(
	forge: Forge,
	onOpenChange: (open: boolean) => void,
	onSaved?: () => void
): TokenModalView {
	const info = FORGES.find((item) => item.id === forge) ?? FORGES[0];
	const savedHost = useConnections((state) => state.auth?.gitlab.host ?? '');
	const [token, setTokenText] = useState('');
	const [host, setHostText] = useState(savedHost);
	const [error, setError] = useState<TokenRejection | null>(null);
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const pending = status === 'pending';

	useCloseOnSuccess(status, () => {
		onOpenChange(false);
		onSaved?.();
	});

	async function submit(): Promise<void> {
		if (!token.trim() || status !== 'idle') return;

		setStatus('pending');
		setError(null);

		try {
			await useConnections.getState().saveToken(info.id, token.trim(), info.id === 'gitlab' ? host.trim() : undefined);
			setStatus('success');
		} catch (failure) {
			setStatus('idle');
			setError(rejection(failure));
		}
	}

	return {
		status,
		pending,
		token,
		host,
		savedHost,
		error,
		tokenHint: `${info.scope} ${STORED}`,
		canSubmit: Boolean(token.trim()) || status !== 'idle',
		changeOpen: (next) => {
			if (next || !pending) onOpenChange(next);
		},
		setToken: (value) => {
			setTokenText(value);
			setError(null);
		},
		setHost: (value) => {
			setHostText(value);
			setError(null);
		},
		submit: () => void submit(),
		info
	};
}
