'use client';

import { Suspense, useState } from 'react';

import { agentReady, useSettings } from '@/lib/settings/settings-store';

import { AgentClis } from './providers/agent-clis';
import { ProviderList } from './providers/provider-list';
import { ProviderModalHost, type AddRequest } from './providers/provider-modal-host';

/**
 * Settings → Agent, top half: the agent CLIs and the model providers
 * connected in OpenCode. Providers show once the agent that connects them is
 * ready; a later check that fails keeps the last list it loaded.
 */
export function AgentSection() {
	const manager = useSettings((state) => state.agents.find((agent) => agent.providers) ?? null);
	const listed = useSettings((state) => !state.agentError || state.providers.length > 0);
	const [request, setRequest] = useState<AddRequest | null>(null);
	const ready = Boolean(manager && agentReady(manager) && listed);

	return (
		<>
			<AgentClis />
			{manager && ready ? (
				<ProviderList manager={manager} onAdd={(providerId) => setRequest({ providerId: providerId ?? null })} />
			) : null}
			<Suspense fallback={null}>
				<ProviderModalHost request={request} ready={ready} onClose={() => setRequest(null)} />
			</Suspense>
		</>
	);
}
