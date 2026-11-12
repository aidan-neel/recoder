'use client';

import { agentReady } from '@recoder/shared';
import { Suspense, useEffect, useState } from 'react';

import { pending, providerManager, providersListed, retryAll, useSettings } from '@/lib/settings/settings-store';

import { AgentModels } from './agent-models';
import { SectionNotice } from './group-notice';
import { AddProvider } from './providers/add-provider';
import { AgentClis } from './providers/agent-clis';
import { ProviderList } from './providers/provider-list';
import { ProviderModalHost, type AddRequest } from './providers/provider-modal-host';
import { SettingsSectionSkeleton } from './settings-skeleton';

/** The model providers connected in OpenCode, once the agent that connects them is ready. */
function Providers({ onAdd }: { onAdd: (providerId?: string) => void }) {
	const manager = useSettings((state) => providerManager(state.agents));

	if (!manager || !agentReady(manager)) return null;

	return <ProviderList manager={manager} onAdd={onAdd} />;
}

/**
 * Settings → Agent: the agent CLIs, the model providers connected in
 * OpenCode, and the review models. The agents and the models load side by
 * side, and the section paints once both have answered, in one swap from its
 * skeleton, so no group lands while another is still a placeholder. Check
 * again and Add provider work in the skeleton already. Each group fails and
 * retries on its own; when the server answers neither, one notice stands for
 * the section. The provider modal stays mounted across the swap, so one
 * opened from the skeleton stays open.
 */
export function AgentSection() {
	const down = useSettings((state) => state.status === 'offline' && !state.error && state.agentsStatus === 'offline');
	const loading = useSettings((state) => pending(state.status) || pending(state.agentsStatus));
	const ready = useSettings(providersListed);
	const [request, setRequest] = useState<AddRequest | null>(null);
	const add = (providerId?: string) => setRequest({ providerId: providerId ?? null });

	useEffect(() => {
		void useSettings.getState().loadSettings();
		void useSettings.getState().loadAgents();
	}, []);

	if (down) return <SectionNotice what="Settings didn’t load." reason={null} retry={retryAll} />;

	return (
		<>
			{loading ? (
				<SettingsSectionSkeleton section="agent" actions={{ providers: <AddProvider onAdd={() => add()} /> }} />
			) : (
				<div className="settings-stack">
					<AgentClis />
					<Providers onAdd={add} />
					<AgentModels />
				</div>
			)}
			<Suspense fallback={null}>
				<ProviderModalHost request={request} ready={ready} onClose={() => setRequest(null)} />
			</Suspense>
		</>
	);
}
