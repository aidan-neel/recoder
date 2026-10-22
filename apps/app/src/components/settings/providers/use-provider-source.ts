'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';

import { agentReady, useSettings } from '@/lib/settings/settings-store';

/**
 * Where the provider list stands: still loading, the server down, the agent
 * check failed with no list to show, the agent that connects providers
 * (OpenCode) not ready, or ready with its providers. A check that fails after
 * the list loaded keeps it, as the Agent CLIs card keeps its rows.
 */
export type ProviderSource =
	| { state: 'loading' }
	| { state: 'offline' }
	| { state: 'error'; message: string }
	| { state: 'unready'; manager: AgentStatus | null }
	| { state: 'ready'; manager: AgentStatus; providers: AgentProvider[] };

/** The agent that connects model providers itself, when the server reported one. */
function managerOf(agents: AgentStatus[]): AgentStatus | null {
	return agents.find((agent) => agent.providers) ?? null;
}

/** The provider list from Settings, with the reason when there is none to show. */
export function useProviderSource(): ProviderSource {
	const status = useSettings((state) => state.status);
	const agentError = useSettings((state) => state.agentError);
	const manager = useSettings((state) => managerOf(state.agents));
	const providers = useSettings((state) => state.providers);

	if (status === 'idle' || status === 'loading') return { state: 'loading' };
	if (status === 'offline') return { state: 'offline' };
	if (agentError && providers.length === 0) return { state: 'error', message: agentError };
	if (!manager || !agentReady(manager)) return { state: 'unready', manager };

	return { state: 'ready', manager, providers };
}
