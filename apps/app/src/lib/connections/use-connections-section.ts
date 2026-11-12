'use client';

import type { ProviderAuth, Repo } from '@recoder/shared';
import { useEffect, useState } from 'react';

import type { Forge } from '../api/connections';
import { useAction } from '../shell/use-action';
import { useConnections, type LoadStatus } from './connections-store';
import { useTokenDialog, type TokenDialog } from './use-token-dialog';
import type { ActionFace } from './use-remote-list';

/** Loads the forges and the repositories. On a retry, a failure stays on screen until the answer lands, so the notice holds still. */
function reload(): Promise<unknown> {
	const { loadAuth, loadRepos } = useConnections.getState();

	return Promise.all([loadAuth(), loadRepos()]);
}

/** True once a load has answered, well or not. */
function settled(status: LoadStatus): boolean {
	return status !== 'idle' && status !== 'loading';
}

/** What the Connections section shows once its loads settle. */
export type ConnectionsView = 'loading' | 'down' | 'ready';

/** Everything the Connections section shows and does. */
export interface ConnectionsSection {
	view: ConnectionsView;
	/** The forge sign-ins, or null while the check has not answered. */
	auth: Record<Forge, ProviderAuth> | null;
	/** Why the forge check failed; null while it has not or the server is down. */
	authError: string | null;
	/** The tracked repositories, or null while the list has not answered. */
	repos: Repo[] | null;
	/** Why the repository list failed; null while it has not or the server is down. */
	reposError: string | null;
	/** The whole-section retry, for the server-down notice. */
	retry: ActionFace;
	/** The Forges group's retry. */
	authRetry: ActionFace;
	/** The Repositories group's retry. */
	reposRetry: ActionFace;
	/** Whether the repository browser dialog is open. */
	browsing: boolean;
	setBrowsing: (open: boolean) => void;
	/** The token dialog state; `token.connect` opens it for a forge. */
	token: TokenDialog;
}

/**
 * Settings → Connections: the forges Recoder reads pull requests from, and
 * the repositories it tracks. Loads both on mount; `view` is `down` only
 * while the repository list has never answered and the server is offline.
 */
export function useConnectionsSection(): ConnectionsSection {
	const auth = useConnections((state) => state.auth);
	const authStatus = useConnections((state) => state.authStatus);
	const authError = useConnections((state) => state.authError);
	const repos = useConnections((state) => state.repos);
	const reposStatus = useConnections((state) => state.reposStatus);
	const reposError = useConnections((state) => state.reposError);
	const [browsing, setBrowsing] = useState(false);
	const token = useTokenDialog();
	const retry = useAction();
	const authRetry = useAction();
	const reposRetry = useAction();

	useEffect(() => {
		void reload();
	}, []);

	const view: ConnectionsView =
		!repos && reposStatus === 'offline' ? 'down' : !settled(authStatus) || !settled(reposStatus) ? 'loading' : 'ready';

	return {
		view,
		auth,
		authError,
		repos,
		reposError,
		retry: { status: retry.status, run: () => retry.run(reload) },
		authRetry: { status: authRetry.status, run: () => authRetry.run(reload) },
		reposRetry: { status: reposRetry.status, run: () => reposRetry.run(reload) },
		browsing,
		setBrowsing,
		token
	};
}
