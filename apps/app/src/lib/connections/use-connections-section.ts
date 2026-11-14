'use client';

import type { ProviderAuth } from '@recoder/shared';
import { useEffect } from 'react';

import type { Forge } from '../api/connections';
import { useAction } from '../shell/use-action';
import { useConnections, type LoadStatus } from './connections-store';
import { useTokenDialog, type TokenDialog } from './use-token-dialog';
import type { ActionFace } from './use-remote-list';

/** Loads the forge sign-ins. On a retry, a failure stays on screen until the answer lands, so the notice holds still. */
function reload(): Promise<void> {
	return useConnections.getState().loadAuth();
}

/** What the Connections section shows once its load settles. */
type ConnectionsView = 'loading' | 'down' | 'ready';

/** The section's view: `down` only while the forge check has never answered and the server is offline. */
function sectionView(auth: Record<Forge, ProviderAuth> | null, status: LoadStatus): ConnectionsView {
	if (!auth && status === 'offline') return 'down';
	if (status === 'idle' || status === 'loading') return 'loading';

	return 'ready';
}

/** Everything the Connections section shows and does. */
export interface ConnectionsSection {
	view: ConnectionsView;
	/** The forge sign-ins, or null while the check has not answered. */
	auth: Record<Forge, ProviderAuth> | null;
	/** Why the forge check failed; null while it has not or the server is down. */
	authError: string | null;
	/** Checks the forges again, for the server-down notice and the failed group. */
	retry: ActionFace;
	/** The token dialog state; `token.connect` opens it for a forge. */
	token: TokenDialog;
}

/** Settings → Connections: the forges Recoder reads pull requests from. Loads their sign-ins on mount. */
export function useConnectionsSection(): ConnectionsSection {
	const auth = useConnections((state) => state.auth);
	const status = useConnections((state) => state.authStatus);
	const authError = useConnections((state) => state.authError);
	const token = useTokenDialog();
	const retry = useAction();

	useEffect(() => {
		void reload();
	}, []);

	return {
		view: sectionView(auth, status),
		auth,
		authError,
		retry: { status: retry.status, run: () => retry.run(reload) },
		token
	};
}
