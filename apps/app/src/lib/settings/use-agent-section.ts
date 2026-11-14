'use client';

import { agentReady, type AgentStatus } from '@recoder/shared';
import { useState } from 'react';

import { useSettings } from './settings-store';

/** Everything the provider modal host needs: whether it is open, on which provider, and how it closes. */
export interface ProviderHost {
	open: boolean;
	/** The provider to open straight on its sign-in, or null for the list. */
	providerId: string | null;
	/** The modal's onOpenChange; closing clears the request. */
	onOpenChange: (open: boolean) => void;
}

/** Whether model providers can be connected, and the host of the dialog that connects them. */
export interface AgentSectionView {
	/** The connected-providers list shows: a manager is ready and its list (or a kept last one) loaded. */
	providersReady: boolean;
	/** The provider modal's open state, target and close. */
	host: ProviderHost;
	/** Opens the provider modal, on one provider's sign-in when an id is given. */
	addProvider: (providerId?: string) => void;
}

/** The agent that connects model providers itself, or null when none is listed. */
export function useProviderManager(): AgentStatus | null {
	return useSettings((state) => state.agents.find((agent) => agent.providers) ?? null);
}

/**
 * The model provider dialog's host for Settings → Providers. Providers can
 * be connected once the agent that connects them is ready; a later check
 * that fails keeps the last list it loaded.
 */
export function useAgentSection(): AgentSectionView {
	const manager = useProviderManager();
	const listed = useSettings((state) => !state.agentError || state.providers.length > 0);
	const [request, setRequest] = useState<{ providerId: string | null } | null>(null);
	const ready = Boolean(manager && agentReady(manager) && listed);

	const host: ProviderHost = {
		open: request !== null,
		providerId: request?.providerId ?? null,
		onOpenChange: (open) => {
			if (!open) setRequest(null);
		}
	};

	return {
		providersReady: ready,
		host,
		addProvider: (providerId) => setRequest({ providerId: providerId ?? null })
	};
}
