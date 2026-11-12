'use client';

import { SkeletonRows } from '@recoder/ui';

import { useProviderSource } from '@/lib/settings/providers/use-provider-source';
import type { AgentSectionView } from '@/lib/settings/use-agent-section';

import { SettingsGroup } from '../settings-group';
import { ProviderList } from './provider-list';
import { ProviderModal } from './provider-modal';
import { ProviderNotice } from './provider-notice';

/** How many placeholder rows stand in for the list while it loads. */
const SKELETON_ROWS = 3;

/** Name and detail bar widths of the placeholder rows, cycled so the rows do not look stamped. */
const SKELETON_WIDTHS = [
	['88px', '148px'],
	['64px', '132px'],
	['112px', '156px']
] as const;

/** The Providers card for where the list stands: placeholder rows, the connected providers, or why there are none. */
function ProvidersCard({ onAdd }: { onAdd: AgentSectionView['addProvider'] }) {
	const source = useProviderSource();

	if (source.state === 'ready') return <ProviderList manager={source.manager} onAdd={onAdd} />;

	return (
		<SettingsGroup title="Providers">
			{source.state === 'loading' ? (
				<SkeletonRows count={SKELETON_ROWS} height={60} widths={SKELETON_WIDTHS} rowClassName="settings-row" />
			) : (
				<ProviderNotice source={source} />
			)}
		</SettingsGroup>
	);
}

/** Settings → Models → Providers: the connected model providers, and the dialog that connects another. */
export function ProvidersGroup({ section }: { section: AgentSectionView }) {
	const { host } = section;

	return (
		<>
			<ProvidersCard onAdd={section.addProvider} />
			<ProviderModal open={host.open} providerId={host.providerId} onOpenChange={host.onOpenChange} />
		</>
	);
}
