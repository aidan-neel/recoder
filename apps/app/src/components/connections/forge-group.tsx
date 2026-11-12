'use client';

import type { ProviderAuth } from '@recoder/shared';
import { Button, ConfirmDialog } from '@recoder/ui';

import { ForgeTile } from '@/components/common/forge-tile';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import type { Forge } from '@/lib/api/connections';
import { FORGES, forgeLine, type ForgeInfo } from '@/lib/connections/forges';
import { useDisconnect } from '@/lib/connections/use-disconnect';

interface ForgeActionProps {
	forge: ForgeInfo;
	signedIn: boolean;
	onConnect: (forge: Forge) => void;
	onDisconnect: (forge: ForgeInfo) => void;
}

/** A forge row's one control: Connect while signed out, Disconnect while signed in. */
function ForgeAction({ forge, signedIn, onConnect, onDisconnect }: ForgeActionProps) {
	if (signedIn) {
		return (
			<Button variant="ghost" aria-label={`Disconnect ${forge.label}`} onClick={() => onDisconnect(forge)}>
				Disconnect
			</Button>
		);
	}

	return (
		<Button variant="outline" aria-label={`Connect ${forge.label}`} onClick={() => onConnect(forge.id)}>
			Connect
		</Button>
	);
}

interface ForgeGroupProps {
	auth: Record<Forge, ProviderAuth>;
	/** Opens the token dialog for a forge. */
	onConnect: (forge: Forge) => void;
}

/** Settings → Connections → Forges: who each forge is signed in as, with Connect or Disconnect. */
export function ForgeGroup({ auth, onConnect }: ForgeGroupProps) {
	const disconnect = useDisconnect();

	return (
		<SettingsGroup title="Forges">
			{FORGES.map((forge) => (
				<SettingsRow
					key={forge.id}
					leading={<ForgeTile provider={forge.id} />}
					name={forge.label}
					detail={forgeLine(auth[forge.id])}
				>
					<ForgeAction
						forge={forge}
						signedIn={auth[forge.id].authenticated}
						onConnect={onConnect}
						onDisconnect={disconnect.ask}
					/>
				</SettingsRow>
			))}
			<ConfirmDialog
				open={disconnect.open}
				onOpenChange={disconnect.setOpen}
				title={`Disconnect ${disconnect.target.label}?`}
				description={`Recoder removes the saved token. If the ${disconnect.target.cli} CLI is signed in, ${disconnect.target.label} stays connected.`}
				confirmLabel="Disconnect"
				destructive
				onConfirm={disconnect.confirm}
			/>
		</SettingsGroup>
	);
}
