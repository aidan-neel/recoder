'use client';

import { agentReady, type AgentProvider, type AgentStatus } from '@recoder/shared';

import { OFFLINE_TEXT } from '@/lib/api/http';
import { pending, providerManager, useSettings } from '@/lib/settings/settings-store';

/**
 * Where the provider list stands: still loading, the server down, the agent
 * check failed with no list to show, the agent that connects providers
 * (OpenCode) not ready, the providers themselves failed to load, or ready
 * with its providers. A check that fails after the list loaded keeps it, as
 * the Agent CLIs card keeps its rows.
 */
export type ProviderSource =
	| { state: 'loading' }
	| { state: 'offline' }
	| { state: 'error'; message: string }
	| { state: 'unready'; manager: AgentStatus | null }
	| { state: 'unlisted'; message: string }
	| { state: 'ready'; manager: AgentStatus; providers: AgentProvider[] };

/** The provider list from Settings, with the reason when there is none to show. */
export function useProviderSource(): ProviderSource {
	const status = useSettings((state) => state.agentsStatus);
	const agentError = useSettings((state) => state.agentError);
	const manager = useSettings((state) => providerManager(state.agents));
	const providers = useSettings((state) => state.providers);
	const providersError = useSettings((state) => state.providersError);

	if (pending(status)) return { state: 'loading' };
	if (status === 'offline' && agentError === OFFLINE_TEXT) return { state: 'offline' };
	if (status === 'offline') return { state: 'error', message: agentError ?? OFFLINE_TEXT };
	if (agentError && providers.length === 0) return { state: 'error', message: agentError };
	if (!manager || !agentReady(manager)) return { state: 'unready', manager };
	if (providersError && providers.length === 0) return { state: 'unlisted', message: providersError };

	return { state: 'ready', manager, providers };
}
