'use client';

import type { AgentProvider, AgentStatus } from '@recoder/shared';
import { Button, Switch } from '@recoder/ui';
import { Plus } from 'lucide-react';

import { connectedProviders } from '@/lib/settings/providers/provider-entries';
import type { ProviderSwitches } from '@/lib/settings/providers/use-provider-switches';
import { describeProvider } from '@/lib/settings/provider-options';
import { useSettings } from '@/lib/settings/settings-store';

import { SettingsRow } from '../settings-group';
import { DetailBlock } from './detail-block';
import { CompactUsage } from './provider-usage';

interface ModelProvidersProps {
	/** The CLI that connects them: OpenCode. */
	manager: AgentStatus;
	/** Connecting works now: the manager is installed, running and signed in. */
	canConnect: boolean;
	switches: ProviderSwitches;
	/** Opens the model provider dialog on its list, or on one provider's sign-in. */
	onConnect: (providerId?: string) => void;
	onDisconnect: (provider: AgentProvider) => void;
}

/**
 * In OpenCode's details: the model providers it is connected to, each with
 * its models, how it is reached, its usage when the provider meters it, a
 * switch, and Disconnect (or Add key for a free one). Connect adds another.
 */
export function ModelProviders({ manager, canConnect, switches, onConnect, onDisconnect }: ModelProvidersProps) {
	const providers = useSettings((state) => state.providers);
	const rows = connectedProviders(providers);

	return (
		<DetailBlock
			title="Model providers"
			aside={
				<Button variant="ghost" data-provider-control="connect" disabled={!canConnect} onClick={() => onConnect()}>
					<Plus aria-hidden />
					Connect
				</Button>
			}
		>
			{rows.length === 0 ? (
				<p className="detail-text">
					{canConnect ? 'None yet. Connect one to pick its models.' : `Sign in to ${manager.name} first.`}
				</p>
			) : (
				<ul className="model-providers">
					{rows.map(({ key, provider }) => (
						<li key={key} className="model-provider" data-off={!switches.isOn(key) || undefined}>
							<SettingsRow name={provider.name} detail={describeProvider(provider, manager.name)}>
								<ProviderAction provider={provider} onConnect={onConnect} onDisconnect={onDisconnect} />
								<Switch
									checked={switches.isOn(key)}
									onCheckedChange={(on) => switches.turn(key, on)}
									aria-label={`Use ${provider.name}`}
								/>
							</SettingsRow>
							<CompactUsage providerKey={key} />
						</li>
					))}
				</ul>
			)}
		</DetailBlock>
	);
}

interface ProviderActionProps {
	provider: AgentProvider;
	onConnect: (providerId?: string) => void;
	onDisconnect: (provider: AgentProvider) => void;
}

/** Disconnect for a saved key or sign-in; Add key for a free provider that takes one; else nothing. */
function ProviderAction({ provider, onConnect, onDisconnect }: ProviderActionProps) {
	if (provider.removable) {
		return (
			<Button variant="ghost" onClick={() => onDisconnect(provider)}>
				Disconnect
			</Button>
		);
	}

	if (provider.via !== 'builtin' || provider.methods.length === 0) return null;

	return (
		<Button variant="ghost" onClick={() => onConnect(provider.id)}>
			Add key
		</Button>
	);
}
