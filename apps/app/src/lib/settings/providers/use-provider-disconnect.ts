'use client';

import type { AgentProvider } from '@recoder/shared';
import { useEffect, useRef, useState } from 'react';

import { failureText } from '../../api/http';
import { settingsApi } from '../../api/settings';
import { undoToast } from '../../shell/notify';
import { useSettings } from '../settings-store';

/** The button that connects another model provider; focus lands on it after a disconnect. */
const CONNECT_SELECTOR = '[data-provider-control="connect"]';

/** Forgets a provider's key or sign-in. A failure rejects with the plain reason, which the confirm dialog shows. */
async function disconnect(provider: AgentProvider): Promise<void> {
	try {
		const { providers } = await settingsApi.removeProvider(provider.id);

		useSettings.getState().setProviders(providers);
	} catch (error) {
		throw new Error(failureText(error, `Couldn’t disconnect ${provider.name}.`), { cause: error });
	}

	undoToast(`Disconnected ${provider.name}`);
}

/** The disconnect confirm and what it does. */
export interface ProviderDisconnect {
	/** The provider waiting on the confirm; null when the dialog is closed. */
	removing: AgentProvider | null;
	ask: (provider: AgentProvider) => void;
	setConfirmOpen: (open: boolean) => void;
	/** Runs the disconnect; rejects with the plain reason the dialog shows. */
	confirm: (provider: AgentProvider) => Promise<void>;
}

/**
 * Disconnecting a model provider: it asks first, forgets the key or
 * sign-in, then hands focus to Connect once the dialog lets go, since the
 * row the focus came from is gone.
 */
export function useProviderDisconnect(): ProviderDisconnect {
	const [confirmOpen, setConfirmOpen] = useState(false);

	/** Outlives the dialog's close, so its copy holds while it animates out. */
	const [removing, setRemoving] = useState<AgentProvider | null>(null);

	/** Set by a disconnect that landed, so focus moves once the dialog has let go of it. */
	const refocus = useRef(false);

	useEffect(() => {
		if (confirmOpen || !refocus.current) return;

		refocus.current = false;
		document.querySelector<HTMLElement>(CONNECT_SELECTOR)?.focus();
	}, [confirmOpen]);

	async function confirm(provider: AgentProvider): Promise<void> {
		await disconnect(provider);
		refocus.current = true;
	}

	return {
		removing: confirmOpen ? removing : null,
		ask: (provider) => {
			setRemoving(provider);
			setConfirmOpen(true);
		},
		setConfirmOpen,
		confirm
	};
}
