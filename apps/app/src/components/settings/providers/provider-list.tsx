'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { Button, ConfirmDialog, type ButtonVariant } from '@recoder/ui';
import { Plus } from 'lucide-react';

import { useProviderList, type ProviderRowView } from '@/lib/settings/providers/use-provider-list';

import { SettingsGroup, SettingsRow } from '../settings-group';

/** Opens the provider dialog on the list, or on one provider's sign-in. */
type AddProvider = (providerId?: string) => void;

interface AddButtonProps {
	variant: ButtonVariant;
	onAdd: AddProvider;
}

/** Opens the dialog on the provider list. Focus lands here when the last removable provider goes. */
function AddButton({ variant, onAdd }: AddButtonProps) {
	return (
		<Button variant={variant} data-provider-control="add" onClick={() => onAdd()}>
			<Plus aria-hidden />
			Add provider
		</Button>
	);
}

interface RowControlProps {
	row: ProviderRowView;
	onRemove: (provider: AgentProvider) => void;
	onAdd: AddProvider;
}

/** What can be done about one connected provider: forget its key or sign-in, or give a free one a key. */
function RowControl({ row, onRemove, onAdd }: RowControlProps) {
	const { provider } = row;

	if (row.removable) {
		return (
			<Button variant="ghost" data-provider-control={provider.id} onClick={() => onRemove(provider)}>
				Disconnect
			</Button>
		);
	}

	if (!row.addKey) return null;

	return (
		<Button variant="ghost" data-provider-control={provider.id} onClick={() => onAdd(provider.id)}>
			Add key
		</Button>
	);
}

/** What the agent forgets when `provider` is disconnected. */
function forgotten(provider: AgentProvider | null): string {
	return provider?.via === 'oauth' ? 'this sign-in' : 'this key';
}

interface ProviderListProps {
	/** The agent that holds the keys and sign-ins. */
	manager: AgentStatus;
	onAdd: AddProvider;
}

/**
 * The model providers the agent is connected to. A saved key or sign-in can
 * be disconnected after a confirm; focus then moves to the next row's
 * control, or to Add provider when none is left, so the keyboard keeps its
 * place.
 */
export function ProviderList({ manager, onAdd }: ProviderListProps) {
	const list = useProviderList(manager);
	const { removing } = list;

	return (
		<>
			<SettingsGroup title="Providers" action={list.rows.length ? <AddButton variant="ghost" onAdd={onAdd} /> : null}>
				{list.rows.map((row) => (
					<SettingsRow key={row.provider.id} name={row.provider.name} detail={row.description}>
						<RowControl row={row} onRemove={list.askRemove} onAdd={onAdd} />
					</SettingsRow>
				))}
				{list.rows.length === 0 ? (
					<SettingsRow name="No providers yet" detail="Add one to pick models for reviews">
						<AddButton variant="outline" onAdd={onAdd} />
					</SettingsRow>
				) : null}
			</SettingsGroup>
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={list.setConfirmOpen}
				title={`Disconnect ${removing?.name ?? 'provider'}?`}
				description={`${manager.name} forgets ${forgotten(removing)}. Reviews set to its models stop until you connect it again.`}
				confirmLabel="Disconnect"
				destructive
				onConfirm={() => (removing ? list.confirmRemove(removing) : undefined)}
			/>
		</>
	);
}
