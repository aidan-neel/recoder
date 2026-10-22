'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { Button, ConfirmDialog } from '@recoder/ui';
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { failureText } from '@/lib/api/http';
import { settingsApi } from '@/lib/api/settings';
import { describeProvider } from '@/lib/settings/provider-options';
import { useSettings } from '@/lib/settings/settings-store';
import { undoToast } from '@/lib/shell/notify';

import { SettingsGroup, SettingsRow } from '../settings-group';
import { Reveal } from './reveal';

interface ProviderListProps {
	/** The agent that holds the keys and sign-ins (OpenCode). */
	manager: AgentStatus;
	/** Opens the provider modal on the list, or on one provider's sign-in. */
	onAdd: (providerId?: string) => void;
}

/** A row's control by provider id, or Add provider for `add`; rows mark theirs with `data-provider-control`. */
function controlOf(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-provider-control="${CSS.escape(id)}"]`);
}

/** Forgets a provider's key or sign-in. A failure rejects with the plain reason, which the confirm dialog shows. */
async function disconnect(provider: AgentProvider): Promise<void> {
	try {
		const { providers } = await settingsApi.removeProvider(provider.id);

		useSettings.getState().setProviders(providers);
	} catch (error) {
		throw new Error(failureText(error, `Couldn’t disconnect ${provider.name}.`), { cause: error });
	}

	undoToast(`Disconnected ${provider.name}`);
}

/** True when the row has a control to take focus: Disconnect, or Add key. */
function hasControl(provider: AgentProvider): boolean {
	return provider.removable || (provider.via === 'builtin' && provider.methods.length > 0);
}

/**
 * Where focus goes once `removed` leaves the list: the next row with a
 * control, else the closest one before it, else Add provider.
 */
function focusTarget(connected: AgentProvider[], removed: AgentProvider): string {
	const at = connected.findIndex((provider) => provider.id === removed.id);
	const after = connected.slice(at + 1).find(hasControl);
	const before = connected.slice(0, Math.max(at, 0)).findLast(hasControl);

	return (after ?? before)?.id ?? 'add';
}

/** One connected provider: its name, model count and how it connects, and what can be done about it. */
function ProviderRow({
	provider,
	manager,
	onRemove,
	onAdd
}: {
	provider: AgentProvider;
	manager: AgentStatus;
	onRemove: (provider: AgentProvider) => void;
	onAdd: (providerId: string) => void;
}) {
	return (
		<SettingsRow name={provider.name} description={describeProvider(provider, manager.name)}>
			{provider.removable ? (
				<Button variant="ghost" data-provider-control={provider.id} onClick={() => onRemove(provider)}>
					Disconnect
				</Button>
			) : hasControl(provider) ? (
				<Button variant="ghost" data-provider-control={provider.id} onClick={() => onAdd(provider.id)}>
					Add key
				</Button>
			) : null}
		</SettingsRow>
	);
}

/**
 * Settings → Agent: the model providers the agent is connected to. Saved keys
 * and sign-ins can be disconnected, after a confirm; a provider that arrives
 * or leaves unfolds or folds in place. After a disconnect, focus moves to the
 * next row's control, or to Add provider when none is left, so the keyboard
 * keeps its place.
 */
export function ProviderList({ manager, onAdd }: ProviderListProps) {
	const providers = useSettings((state) => state.providers);
	const connected = providers.filter((provider) => provider.connected);
	const [confirmOpen, setConfirmOpen] = useState(false);

	/** Outlives the dialog's close, so its copy holds while it animates out. */
	const [removing, setRemoving] = useState<AgentProvider | null>(null);

	/** The control to focus once the dialog has let go of focus; set by a disconnect that landed. */
	const refocus = useRef<string | null>(null);

	useEffect(() => {
		const target = refocus.current;

		if (confirmOpen || !target) return;

		refocus.current = null;
		controlOf(target)?.focus();
	}, [confirmOpen]);

	function askRemove(provider: AgentProvider): void {
		setRemoving(provider);
		setConfirmOpen(true);
	}

	async function confirmRemove(provider: AgentProvider): Promise<void> {
		const target = focusTarget(connected, provider);

		await disconnect(provider);
		refocus.current = target;
	}

	const add = (
		<Button variant="ghost" data-provider-control="add" onClick={() => onAdd()}>
			<Plus aria-hidden />
			Add provider
		</Button>
	);

	return (
		<>
			<SettingsGroup title="Providers" action={connected.length ? add : null}>
				<AnimatePresence initial={false}>
					{connected.map((provider) => (
						<Reveal key={provider.id} className="provider-item">
							<ProviderRow provider={provider} manager={manager} onRemove={askRemove} onAdd={onAdd} />
						</Reveal>
					))}
					{connected.length === 0 ? (
						<Reveal key="empty" className="provider-item">
							<SettingsRow name="No providers yet" description="Add one to pick models for reviews">
								<Button variant="outline" data-provider-control="add" onClick={() => onAdd()}>
									<Plus aria-hidden />
									Add provider
								</Button>
							</SettingsRow>
						</Reveal>
					) : null}
				</AnimatePresence>
			</SettingsGroup>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={`Disconnect ${removing?.name ?? 'provider'}?`}
				description={`${manager.name} forgets ${removing?.via === 'oauth' ? 'this sign-in' : 'this key'}. Reviews set to its models stop until you connect it again.`}
				confirmLabel="Disconnect"
				destructive
				onConfirm={() => (removing ? confirmRemove(removing) : undefined)}
			/>
		</>
	);
}
