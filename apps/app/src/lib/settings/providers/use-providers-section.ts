'use client';

import { useState } from 'react';

import { useSettings } from '../settings-store';
import { useAgentSection, type ProviderHost } from '../use-agent-section';
import { missingClis, providerEntries, type ProviderEntry } from './provider-entries';
import { useProviderDisconnect, type ProviderDisconnect } from './use-provider-disconnect';
import { useProviderSwitches, type ProviderSwitches } from './use-provider-switches';

/** Everything Settings → Providers shows and does. */
export interface ProvidersSectionView {
	entries: ProviderEntry[];
	/** The entry the detail panel shows: the one picked, else the first; null with an empty list. */
	selected: ProviderEntry | null;
	select: (key: string) => void;
	/** Why the last agent check failed, shown over the list it kept; null when it worked. */
	agentError: string | null;
	switches: ProviderSwitches;
	disconnect: ProviderDisconnect;
	/** The Add provider dialog: the CLIs still to install. */
	adding: { open: boolean; setOpen: (open: boolean) => void; missing: ProviderEntry['agent'][] };
	/** Model providers can be connected now: the provider manager is installed, running and signed in. */
	canConnect: boolean;
	/** The model provider dialog, opened from OpenCode's details. */
	providerHost: ProviderHost;
	connectProvider: (providerId?: string) => void;
}

/**
 * Settings → Providers: the installed agent CLIs, each with a switch, and the
 * picked one's details beside them. OpenCode's details hold the model
 * providers it connects. Add provider offers the CLIs still to install.
 */
export function useProvidersSection(): ProvidersSectionView {
	const agents = useSettings((state) => state.agents);
	const agentError = useSettings((state) => state.agentError);
	const [picked, setPicked] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const agentSection = useAgentSection();
	const switches = useProviderSwitches();
	const disconnect = useProviderDisconnect();

	const entries = providerEntries(agents);

	return {
		entries,
		selected: entries.find((entry) => entry.key === picked) ?? entries[0] ?? null,
		select: setPicked,
		agentError,
		switches,
		disconnect,
		adding: { open: adding, setOpen: setAdding, missing: missingClis(agents) },
		canConnect: agentSection.providersReady,
		providerHost: agentSection.host,
		connectProvider: agentSection.addProvider
	};
}
