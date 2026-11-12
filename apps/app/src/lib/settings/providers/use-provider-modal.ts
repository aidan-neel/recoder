'use client';

import type { AgentProvider } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { useSettings } from '../settings-store';
import { useProviderFlow, type ProviderFlow } from './use-provider-flow';

/** Everything the provider modal's content needs, mounted fresh each time it opens. */
export interface ProviderFlowView {
	flow: ProviderFlow;
}

/**
 * The provider modal's content. `providerId` opens straight on that
 * provider's sign-in (Add key on a free provider). It loads Settings itself,
 * so it works from first run as well as from Settings, and reports whether a
 * request is with the server so the modal can hold still until it answers.
 */
export function useProviderFlowView({
	providerId,
	close,
	onSending
}: {
	/** Open straight on this provider's sign-in instead of the list; null for the list. */
	providerId: string | null;
	/** Closes the modal. */
	close: () => void;
	/** Told whether a request is with the server; called with false on unmount. */
	onSending: (sending: boolean) => void;
}): ProviderFlowView {
	const [preset] = useState<AgentProvider | null>(() =>
		providerId ? (useSettings.getState().providers.find((item) => item.id === providerId) ?? null) : null
	);

	const flow = useProviderFlow(preset, close);

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	useEffect(() => {
		onSending(flow.sending);

		return () => onSending(false);
	}, [flow.sending, onSending]);

	return { flow };
}
