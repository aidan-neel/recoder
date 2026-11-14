'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { Card, ConfirmDialog, StatusNotice } from '@recoder/ui';

import { CHECK_FAILED } from '@/lib/settings/providers/use-check-again';
import { useProvidersSection, type ProvidersSectionView } from '@/lib/settings/providers/use-providers-section';

import { ServerSection } from '../server-section';
import { AddProviderDialog } from './add-provider-dialog';
import { ModelProviders } from './model-providers';
import { ProviderDetail } from './provider-detail';
import { ProviderModal } from './provider-modal';
import { ProviderRail } from './provider-rail';

/** The skeleton's rows while settings load: the list's CLIs. */
const SKELETON_GROUPS = [4];

/** Settings → Providers: the agent CLIs in one list, the picked one's details beside it. */
export function ProvidersSection() {
	return (
		<ServerSection groups={SKELETON_GROUPS}>
			<ProvidersPanel />
		</ServerSection>
	);
}

/** The list and the detail panel, with the dialogs they open. */
function ProvidersPanel() {
	const section = useProvidersSection();
	const { disconnect, adding, selected } = section;
	const removing = disconnect.removing;

	return (
		<div className="settings">
			{section.agentError ? <StatusNotice tone="danger" title={CHECK_FAILED} detail={section.agentError} /> : null}
			<Card className="providers">
				<ProviderRail
					entries={section.entries}
					selectedKey={selected?.key ?? null}
					onSelect={section.select}
					switches={section.switches}
					onAdd={() => adding.setOpen(true)}
				/>
				{selected ? (
					<ProviderDetail entry={selected}>
						{selected.agent.providers ? <ManagerProviders manager={selected.agent} section={section} /> : null}
					</ProviderDetail>
				) : (
					<p className="provider-detail-empty">Add a provider to review with.</p>
				)}
			</Card>
			<AddProviderDialog open={adding.open} onOpenChange={adding.setOpen} missing={adding.missing} />
			<ProviderModal {...section.providerHost} />
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={disconnect.setConfirmOpen}
				title={`Disconnect ${removing?.name ?? 'provider'}?`}
				description={disconnectText(removing)}
				confirmLabel="Disconnect"
				destructive
				onConfirm={() => (removing ? disconnect.confirm(removing) : undefined)}
			/>
		</div>
	);
}

/** OpenCode's model providers, wired to the section's switches, dialog and disconnect. */
function ManagerProviders({ manager, section }: { manager: AgentStatus; section: ProvidersSectionView }) {
	return (
		<ModelProviders
			manager={manager}
			canConnect={section.canConnect}
			switches={section.switches}
			onConnect={section.connectProvider}
			onDisconnect={section.disconnect.ask}
		/>
	);
}

/** What the disconnect confirm says OpenCode forgets: the key or the sign-in. */
function disconnectText(provider: AgentProvider | null): string {
	const forgotten = provider?.via === 'oauth' ? 'this sign-in' : 'this key';

	return `OpenCode forgets ${forgotten}. Reviews set to its models stop until you connect it again.`;
}
