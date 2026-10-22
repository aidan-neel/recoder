'use client';

import type { ProviderAuth } from '@recoder/shared';
import { Button, ConfirmDialog, ForgeMark, toast } from '@recoder/ui';
import { useState, type ReactNode } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import type { Forge } from '@/lib/api/connections';
import { failureText } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { FORGES, type ForgeInfo } from '@/lib/connections/forges';

/** The line under a forge's name: who it is signed in as, or why it is not. */
function forgeLine(auth: ProviderAuth): string {
	if (auth.authenticated) {
		const who = auth.user ? `Signed in as ${auth.user}` : 'Signed in';

		return auth.host ? `${who} on ${auth.host}` : who;
	}

	return auth.available ? 'Not connected' : 'CLI not installed. Connect with a token instead.';
}

/**
 * Forgets the saved token. A signed-in CLI still answers for the forge, so
 * when it does the toast says so rather than the row quietly staying put. A
 * failure rejects with the plain reason, which the confirm dialog shows.
 */
async function disconnect(forge: ForgeInfo): Promise<void> {
	let after: ProviderAuth | null;

	try {
		after = await useConnections.getState().clearToken(forge.id);
	} catch (error) {
		throw new Error(failureText(error, `Couldn’t disconnect ${forge.label}.`), { cause: error });
	}

	if (after?.authenticated) {
		toast(`${forge.label} is still signed in through ${forge.cli}`, {
			description: `Sign out of the ${forge.cli} CLI to disconnect it.`
		});
	}
}

/** Asks before a forge's token is forgotten. */
function useDisconnect(): { ask: (forge: ForgeInfo) => void; dialog: ReactNode } {
	const [target, setTarget] = useState<ForgeInfo>(FORGES[0]);
	const [open, setOpen] = useState(false);

	function ask(forge: ForgeInfo): void {
		setTarget(forge);
		setOpen(true);
	}

	const dialog = (
		<ConfirmDialog
			open={open}
			onOpenChange={setOpen}
			title={`Disconnect ${target.label}?`}
			description={`Recoder forgets the saved token. A signed-in ${target.cli} CLI still works.`}
			confirmLabel="Disconnect"
			destructive
			onConfirm={() => disconnect(target)}
		/>
	);

	return { ask, dialog };
}

interface ForgeGroupProps {
	auth: Record<Forge, ProviderAuth>;
	onConnect: (forge: Forge) => void;
}

/** Settings → Connections → Forges: GitHub and GitLab, who each is signed in as, and Connect or Disconnect. */
export function ForgeGroup({ auth, onConnect }: ForgeGroupProps) {
	const removal = useDisconnect();

	return (
		<SettingsGroup title="Forges">
			{FORGES.map((forge) => {
				const state = auth[forge.id];

				return (
					<SettingsRow
						key={forge.id}
						name={
							<span className="forge-name">
								<ForgeMark provider={forge.id} className="text-fg-muted" />
								{forge.label}
							</span>
						}
						description={forgeLine(state)}
					>
						{state.authenticated ? (
							<Button variant="ghost" onClick={() => removal.ask(forge)}>
								Disconnect
							</Button>
						) : (
							<Button variant="outline" onClick={() => onConnect(forge.id)}>
								Connect
							</Button>
						)}
					</SettingsRow>
				);
			})}
			{removal.dialog}
		</SettingsGroup>
	);
}
