'use client';

import type { UpdatePolicy } from '@recoder/shared';
import { Select, Switch } from '@recoder/ui';

import { useUpdate } from '@/lib/update/update-store';
import { useUpdatePolicy } from '@/lib/update/use-update-policy';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

const CHANNELS = [
	{ value: 'stable', label: 'Stable' },
	{ value: 'beta', label: 'Beta' }
];

const INSTALLS = [
	{ value: 'ask', label: 'Ask me first' },
	{ value: 'auto', label: 'Automatically' }
];

/** How a container install updates on its own; other installs have no policy to read. */
export function UpdatePolicyGroup() {
	const mode = useUpdate((store) => store.status?.mode);

	return mode === 'container' ? <PolicyGroup /> : null;
}

/** Which releases, whether it waits to be asked, and the backup first. */
function PolicyGroup() {
	const view = useUpdatePolicy();
	const { policy } = view;

	if (!policy) return null;

	const set = (change: Partial<UpdatePolicy>) => view.change({ ...policy, ...change });

	return (
		<SettingsGroup
			title="Automatic updates"
			note={view.refused ? <span data-tone="danger">{view.refused}</span> : null}
		>
			<SettingsRow name="Channel">
				<Select
					aria-label="Channel"
					align="end"
					value={policy.channel}
					options={CHANNELS}
					onValueChange={(channel) => set({ channel: channel === 'beta' ? 'beta' : 'stable' })}
				/>
			</SettingsRow>
			<SettingsRow name="Install updates">
				<Select
					aria-label="Install updates"
					align="end"
					value={policy.install}
					options={INSTALLS}
					onValueChange={(install) => set({ install: install === 'auto' ? 'auto' : 'ask' })}
				/>
			</SettingsRow>
			<SettingsRow name="Back up before each update" detail="Kept on this server with the other backups">
				<Switch
					aria-label="Back up before each update"
					checked={policy.backupFirst}
					onCheckedChange={(backupFirst) => set({ backupFirst })}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}
