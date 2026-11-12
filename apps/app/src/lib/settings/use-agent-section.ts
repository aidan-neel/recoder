'use client';

import type { AgentStatus } from '@recoder/shared';
import { useState } from 'react';

import { agentReady, useSettings } from './settings-store';
import { useProviderHost, type ProviderHost } from './providers/use-provider-host';

/** Everything the Models section's top half needs: the provider manager, whether its list shows, and the modal host. */
export interface AgentSectionView {
	/** The agent that connects model providers itself (OpenCode), or null. */
	manager: AgentStatus | null;
	/** The connected-providers list shows: a manager is ready and its list (or a kept last one) loaded. */
	providersReady: boolean;
	/** The provider modal's open state, target and close. */
	host: ProviderHost;
	/** Opens the provider modal, on one provider's sign-in when an id is given. */
	addProvider: (providerId?: string) => void;
}

/**
 * Settings → Models, top half: the agent CLIs, the model providers connected
 * in OpenCode, and the vLLM servers. Providers show once the agent that
 * connects them is ready; a later check that fails keeps the last list it
 * loaded.
 */
export function useAgentSection(): AgentSectionView {
	const manager = useSettings((state) => state.agents.find((agent) => agent.providers) ?? null);
	const listed = useSettings((state) => !state.agentError || state.providers.length > 0);
	const [request, setRequest] = useState<{ providerId: string | null } | null>(null);
	const ready = Boolean(manager && agentReady(manager) && listed);
	const host = useProviderHost({ request, ready, onClose: () => setRequest(null) });

	return {
		manager,
		providersReady: ready,
		host,
		addProvider: (providerId) => setRequest({ providerId: providerId ?? null })
	};
}
