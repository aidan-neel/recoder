'use client';

import { DotsThreeIcon } from '@phosphor-icons/react';
import type { Backup, BackupReason } from '@recoder/shared';
import {
	Button,
	ConfirmDialog,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Select,
	Switch
} from '@recoder/ui';
import { useState } from 'react';

import { serverApi } from '@/lib/api/server';
import { useBackups, type BackupsView } from '@/lib/server/use-backups';
import { fullTime } from '@/lib/shell/age';
import { formatBytes } from '@/lib/shell/format';

import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

/** Why a backup was made, as its row says it. */
const REASONS: Record<BackupReason, string> = {
	nightly: 'nightly',
	update: 'before an update',
	manual: 'made by hand'
};

const KEEP_OPTIONS = [3, 7, 14, 30].map((keep) => ({ value: String(keep), label: `${keep} most recent` }));

/** What a backup menu asks before it acts. */
type BackupAsk = 'key' | 'restore' | 'delete';

const ASKS: Record<BackupAsk, { title: string; description: (when: string) => string; confirm: string }> = {
	key: {
		title: 'Download with the secret key?',
		description: () =>
			'The key opens the credentials sealed in this backup. Anyone with the file can read them, so keep it somewhere safe.',
		confirm: 'Download'
	},
	restore: {
		title: 'Restore this backup?',
		description: (when) =>
			`Recoder restarts on the data from ${when}. Reviews and settings changed since then are lost.`,
		confirm: 'Restore'
	},
	delete: {
		title: 'Delete this backup?',
		description: (when) => `The backup from ${when} is deleted from this server.`,
		confirm: 'Delete'
	}
};

/** One backup: when, how big and why, and a menu to download, delete or, where the updater runs, restore it. */
function BackupRow({ backup, view }: { backup: Backup; view: BackupsView }) {
	const [ask, setAsk] = useState<BackupAsk | null>(null);
	const when = fullTime(backup.createdAt);

	async function confirm(): Promise<void> {
		if (ask === 'key') window.location.assign(serverApi.backupUrl(backup.id, true));
		if (ask === 'restore') await view.restore(backup);
		if (ask === 'delete') await view.remove(backup);
	}

	return (
		<SettingsRow
			name={when}
			detail={`${formatBytes(backup.sizeBytes)} · ${REASONS[backup.reason]} · ${backup.version}`}
		>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button variant="ghost" size="icon" aria-label={`Backup from ${when}`}>
						<DotsThreeIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => window.location.assign(serverApi.backupUrl(backup.id, false))}>
						Download
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setAsk('key')}>Download with the secret key</DropdownMenuItem>
					{view.restorable ? <DropdownMenuItem onSelect={() => setAsk('restore')}>Restore</DropdownMenuItem> : null}
					<DropdownMenuItem onSelect={() => setAsk('delete')}>Delete</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={ask !== null}
				onOpenChange={(open) => {
					if (!open) setAsk(null);
				}}
				title={ask ? ASKS[ask].title : ''}
				description={ask ? ASKS[ask].description(when) : ''}
				confirmLabel={ask ? ASKS[ask].confirm : ''}
				onConfirm={confirm}
			/>
		</SettingsRow>
	);
}

function Schedule({ view }: { view: BackupsView }) {
	const policy = view.state?.policy;

	if (!policy) return null;

	const nightly = policy.schedule === 'nightly';

	return (
		<SettingsGroup title="Schedule">
			<SettingsRow
				name="Back up every night"
				detail={nightly ? `At ${policy.hour}:00 server time` : 'Only before updates and by hand'}
				error={view.refused ?? undefined}
			>
				<Switch
					aria-label="Back up every night"
					checked={nightly}
					onCheckedChange={(on) => view.setPolicy({ ...policy, schedule: on ? 'nightly' : 'off' })}
				/>
			</SettingsRow>
			<SettingsRow name="Keep" detail="Older backups are deleted as new ones are made">
				<Select
					aria-label="Backups to keep"
					align="end"
					value={String(policy.keep)}
					options={KEEP_OPTIONS}
					onValueChange={(keep) => view.setPolicy({ ...policy, keep: Number(keep) })}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}

/** Settings → Server → Backups: when they are made, and each one kept on this server. */
export function BackupsView() {
	const view = useBackups();
	const { state } = view;

	if (!state) {
		return view.error ? (
			<SectionNotice what="Backups" error={view.error} retry={{ status: 'idle', run: view.reload }} />
		) : (
			<SettingsSkeleton groups={[2, 3]} />
		);
	}

	if (!state.supported) {
		return (
			<div className="settings">
				<SettingsGroup title="Backups">
					<SettingsRow name="Not kept by Recoder" detail={state.note ?? 'This install keeps its data elsewhere.'} />
				</SettingsGroup>
			</div>
		);
	}

	return (
		<div className="settings">
			<Schedule view={view} />
			<SettingsGroup
				title="Backups"
				action={
					<Button variant="ghost" onClick={view.backUp} status={view.backUpStatus}>
						Back up now
					</Button>
				}
			>
				{state.backups.length > 0 ? (
					state.backups.map((backup) => <BackupRow key={backup.id} backup={backup} view={view} />)
				) : (
					<SettingsRow
						name="No backups yet"
						detail="One is made before every update, and every night when that is on"
					/>
				)}
			</SettingsGroup>
		</div>
	);
}
