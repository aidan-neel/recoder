'use client';

import type { ProviderAuth } from '@recoder/shared';
import { Button, ConfirmDialog, ForgeMark, toast } from '@recoder/ui';
import { useState, type ReactNode } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import type { Forge } from '@/lib/api/connections';
import { failureText } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { FORGES, rejectedForges, type ForgeInfo } from '@/lib/connections/forges';

import type { Connect } from './use-token-dialog';

/** The line under a forge's name: who it is signed in as, or why it is not. */
function forgeLine(auth: ProviderAuth, forge: ForgeInfo, rejected: boolean): string {
	if (auth.authenticated) {
		const who = auth.user ? `Signed in as ${auth.user}` : 'Signed in';

		return auth.host ? `${who} on ${auth.host}` : who;
	}

	if (rejected) return `${forge.label} rejected the token`;

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
	/** Opens the token dialog; `replacing` when the forge rejected the token it has. */
	onConnect: Connect;
}

/**
 * Settings → Connections → Forges: GitHub and GitLab, who each is signed in
 * as, and Connect or Disconnect; Update token when the forge rejects the one
 * it has.
 */
export function ForgeGroup({ auth, onConnect }: ForgeGroupProps) {
	const repos = useConnections((store) => store.repos);
	const removal = useDisconnect();
	const refused = rejectedForges(auth, repos);

	return (
		<SettingsGroup title="Forges" group="forges">
			{FORGES.map((forge) => {
				const state = auth[forge.id];
				const rejected = refused.includes(forge.id);

				return (
					<SettingsRow
						key={forge.id}
						className="forge-row"
						name={
							<span className="forge-name">
								<ForgeMark provider={forge.id} className="text-fg-muted" />
								{forge.label}
							</span>
						}
						description={forgeLine(state, forge, rejected)}
					>
						{state.authenticated ? (
							<Button variant="ghost" onClick={() => removal.ask(forge)}>
								Disconnect
							</Button>
						) : (
							<Button variant="outline" onClick={() => onConnect(forge.id, rejected)}>
								{rejected ? 'Update token' : 'Connect'}
							</Button>
						)}
					</SettingsRow>
				);
			})}
			{removal.dialog}
		</SettingsGroup>
	);
}
