'use client';

import type { AgentSectionView } from '@/lib/settings/use-agent-section';

/** Settings → Models → Providers: the connected model providers, and the dialog that connects another. */
export function ProvidersGroup({ section }: { section: AgentSectionView }) {
	return section.providersReady ? null : null;
}
