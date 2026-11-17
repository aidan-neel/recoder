'use client';

import { providerKey, type AgentStatus } from '@recoder/shared';
import { useEffect, useRef, useState } from 'react';

import { useSettings } from '../settings-store';
import { dialogClis, missingClis } from './provider-entries';

/** Everything one opening of the Add provider dialog shows. */
export interface AddProviderView {
	/** The installable CLIs shown in this opening. */
	items: AgentStatus[];
	/** At least one CLI is still uninstalled, so Check again has work to do. */
	hasUninstalled: boolean;
}

/**
 * View state for one opening of Add provider. CLIs missing when it opened stay
 * in the list once installed so their rows confirm in place instead of jumping
 * away, and the newly installed CLI is selected in the Providers list behind
 * the dialog.
 */
export function useAddProvider(onAdded?: (key: string) => void): AddProviderView {
	const agents = useSettings((state) => state.agents);
	const [openedMissing] = useState(() => new Set(missingClis(agents).map((agent) => agent.id)));
	const announced = useRef(new Set<string>());

	const items = dialogClis(agents, openedMissing);

	useEffect(() => {
		for (const agent of items) {
			if (!agent.installed || !openedMissing.has(agent.id) || announced.current.has(agent.id)) continue;

			announced.current.add(agent.id);
			onAdded?.(providerKey({ kind: 'cli', id: agent.id }));
		}
	}, [items, onAdded, openedMissing]);

	return {
		items,
		hasUninstalled: items.some((agent) => !agent.installed)
	};
}
