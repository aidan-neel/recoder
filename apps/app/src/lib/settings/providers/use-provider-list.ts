'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { useEffect, useRef, useState } from 'react';

import { failureText } from '../../api/http';
import { settingsApi } from '../../api/settings';
import { undoToast } from '../../shell/notify';
import { describeProvider } from '../provider-options';
import { useSettings } from '../settings-store';

/** A row's control by provider id, or Add provider for `add`; rows mark theirs with `data-provider-control`. */
function controlOf(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-provider-control="${CSS.escape(id)}"]`);
}

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

/** True when the row has a control to take focus: Disconnect, or Add key. */
function hasControl(provider: AgentProvider): boolean {
	return provider.removable || (provider.via === 'builtin' && provider.methods.length > 0);
}

/**
 * Where focus goes once `removed` leaves the list: the next row with a
 * control, else the closest one before it, else Add provider.
 */
export function focusTarget(connected: AgentProvider[], removed: AgentProvider): string {
	const at = connected.findIndex((provider) => provider.id === removed.id);
	const after = connected.slice(at + 1).find(hasControl);
	const before = connected.slice(0, Math.max(at, 0)).findLast(hasControl);

	return (after ?? before)?.id ?? 'add';
}

/** One connected provider as the row shows it. */
export interface ProviderRowView {
	provider: AgentProvider;
	/** "84 models · API key", by how the agent reaches it. */
	description: string;
	/** Disconnect is offered: the provider's key or sign-in can be removed from Recoder. */
	removable: boolean;
	/** Add key is offered: a built-in provider with methods but nothing saved. */
	addKey: boolean;
}

/** Everything the connected-providers list shows and does. */
export interface ProviderListView {
	/** The connected providers, in the agent's order. */
	rows: ProviderRowView[];
	/** The provider waiting on the disconnect confirm; null when the dialog is closed. */
	removing: AgentProvider | null;
	askRemove: (provider: AgentProvider) => void;
	setConfirmOpen: (open: boolean) => void;
	/** Runs the disconnect; rejects with the plain reason the dialog shows. */
	confirmRemove: (provider: AgentProvider) => Promise<void>;
}

/**
 * Settings → Models → Providers: the providers the agent is connected to.
 * Disconnect asks first, forgets the key or sign-in, and hands focus to the
 * next row's control (or Add provider) so the keyboard keeps its place.
 */
export function useProviderList(manager: AgentStatus): ProviderListView {
	const providers = useSettings((state) => state.providers);
	const connected = providers.filter((provider) => provider.connected);
	const [confirmOpen, setConfirmOpen] = useState(false);

	/** Outlives the dialog's close, so its copy holds while it animates out. */
	const [removing, setRemoving] = useState<AgentProvider | null>(null);

	/** The control to focus once the dialog has let go of focus; set by a disconnect that landed. */
	const refocus = useRef<string | null>(null);

	useEffect(() => {
		const target = refocus.current;

		if (confirmOpen || !target) return;

		refocus.current = null;
		controlOf(target)?.focus();
	}, [confirmOpen]);

	function askRemove(provider: AgentProvider): void {
		setRemoving(provider);
		setConfirmOpen(true);
	}

	async function confirmRemove(provider: AgentProvider): Promise<void> {
		const target = focusTarget(connected, provider);

		await disconnect(provider);
		refocus.current = target;
	}

	return {
		rows: connected.map((provider) => ({
			provider,
			description: describeProvider(provider, manager.name),
			removable: provider.removable,
			addKey: !provider.removable && provider.via === 'builtin' && provider.methods.length > 0
		})),
		removing: confirmOpen ? removing : null,
		askRemove,
		setConfirmOpen,
		confirmRemove
	};
}
