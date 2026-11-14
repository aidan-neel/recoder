'use client';

import type { LinkedForge } from '@recoder/shared';
import { Button } from '@recoder/ui';

import { useAccountView } from '@/lib/account/use-account-menu';
import { forgeLabel } from '@/lib/connections/forges';

import { Avatar } from '@/components/common/avatar';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

/** The forges an account signs in with, as one line: "octocat on GitHub, aidan on GitLab (gitlab.example.com)". */
function forgeSummary(forges: LinkedForge[]): string {
	return forges
		.map((forge) => `${forge.login} on ${forgeLabel(forge.provider)}${forge.host ? ` (${forge.host})` : ''}`)
		.join(', ');
}

/**
 * Settings → Connections → Account: the person signed in and the forges the
 * account signs in with. Nothing shows while there is no account.
 */
export function AccountGroup() {
	const view = useAccountView('');

	if (!view.name) return null;

	return (
		<SettingsGroup title="Account">
			<SettingsRow
				leading={<Avatar name={view.name} src={view.avatarUrl} shape="square" />}
				name={view.name}
				detail={forgeSummary(view.forges)}
			>
				{view.canSignOut ? (
					<Button variant="ghost" onClick={view.signOut}>
						Sign out
					</Button>
				) : null}
			</SettingsRow>
		</SettingsGroup>
	);
}
