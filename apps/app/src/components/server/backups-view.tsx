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
import { useRef, useState, type Ref, type RefObject } from 'react';

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

/** The backups next to the one at `index`: the one below, which takes its place once it is deleted, then the one above. */
function neighboursOf(backups: Backup[], index: number): string[] {
	return [backups[index + 1], backups[index - 1]].flatMap((backup) => (backup ? [backup.id] : []));
}

/** A backup the menu asked about, kept through the dialog's exit, with the rows below and above it, in that order. */
interface Asked {
	kind: BackupAsk;
	backup: Backup;
	neighbours: string[];
}

interface BackupRowProps {
	backup: Backup;
	restorable: boolean;
	onAsk: (kind: BackupAsk) => void;
	/** The row's menu button, so focus can land on a neighbour's once this backup is deleted. */
	triggerRef: Ref<HTMLButtonElement>;
}

/** One backup: when, how big and why, and a menu to download, delete or, where the updater runs, restore it. */
function BackupRow({ backup, restorable, onAsk, triggerRef }: BackupRowProps) {
	const when = fullTime(backup.createdAt);

	return (
		<SettingsRow
			name={when}
			detail={`${formatBytes(backup.sizeBytes)} · ${REASONS[backup.reason]} · ${backup.version}`}
		>
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button ref={triggerRef} variant="ghost" size="icon" aria-label={`Backup from ${when}`}>
						<DotsThreeIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => window.location.assign(serverApi.backupUrl(backup.id, false))}>
						Download
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onAsk('key')}>Download with the secret key</DropdownMenuItem>
					{restorable ? <DropdownMenuItem onSelect={() => onAsk('restore')}>Restore</DropdownMenuItem> : null}
					<DropdownMenuItem onSelect={() => onAsk('delete')}>Delete</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SettingsRow>
	);
}

/**
 * The backups, newest first, and the one dialog their menus ask through. It lives beside the rows rather than in one,
 * so deleting a backup leaves it to close and hand focus to the row that took its place, the one above, or Back up now.
 * The rows on screen are read from their menu buttons as it closes: the closing dialog keeps the props it last had.
 */
function BackupList({
	view,
	backups,
	fallback
}: {
	view: BackupsView;
	backups: Backup[];
	fallback: RefObject<HTMLButtonElement | null>;
}) {
	const [asked, setAsked] = useState<Asked | null>(null);
	const [open, setOpen] = useState(false);
	const triggers = useRef(new Map<string, HTMLButtonElement>());
	const when = asked ? fullTime(asked.backup.createdAt) : '';
	const copy = ASKS[asked?.kind ?? 'delete'];

	async function confirm(): Promise<void> {
		if (!asked) return;
		if (asked.kind === 'key') window.location.assign(serverApi.backupUrl(asked.backup.id, true));
		if (asked.kind === 'restore') await view.restore(asked.backup);
		if (asked.kind === 'delete') await view.remove(asked.backup);
	}

	function focusAfterDelete(event: Event): void {
		const buttons = triggers.current;

		if (!asked || buttons.has(asked.backup.id)) return;

		const neighbour = asked.neighbours.find((id) => buttons.has(id));

		event.preventDefault();
		(neighbour ? buttons.get(neighbour) : fallback.current)?.focus();
	}

	if (backups.length === 0) {
		return (
			<SettingsRow name="No backups yet" detail="One is made before every update, and every night when that is on" />
		);
	}

	return (
		<>
			{backups.map((backup, index) => (
				<BackupRow
					key={backup.id}
					backup={backup}
					restorable={view.restorable}
					onAsk={(kind) => {
						setAsked({ kind, backup, neighbours: neighboursOf(backups, index) });
						setOpen(true);
					}}
					triggerRef={(button) => {
						if (button) triggers.current.set(backup.id, button);
						else triggers.current.delete(backup.id);
					}}
				/>
			))}
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={copy.title}
				description={copy.description(when)}
				confirmLabel={copy.confirm}
				destructive={asked?.kind === 'delete' || asked?.kind === 'restore'}
				onConfirm={confirm}
				onCloseAutoFocus={focusAfterDelete}
			/>
		</>
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
	const backUpButton = useRef<HTMLButtonElement>(null);
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
					<Button ref={backUpButton} variant="ghost" onClick={view.backUp} status={view.backUpStatus}>
						Back up now
					</Button>
				}
			>
				<BackupList view={view} backups={state.backups} fallback={backUpButton} />
			</SettingsGroup>
		</div>
	);
}
