'use client';

import type { Backup, BackupPolicy, BackupsState } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';
import { serverApi } from '../api/server';
import { navigate } from '../shell/navigation';
import { settingsHref } from '../shell/routes';
import { useAction } from '../shell/use-action';
import { useUpdate } from '../update/update-store';
import { useServerRead } from './use-server-read';

/** How often the backups are read while one is being made. */
const POLL_MS = 1000;

/** Everything Settings → Server → Backups shows and does. */
export interface BackupsView {
	state: BackupsState | null;
	error: string | null;
	reload: () => void;
	backUp: () => void;
	backUpStatus: ButtonStatus;
	setPolicy: (policy: BackupPolicy) => void;
	remove: (backup: Backup) => Promise<void>;
	/** True when the updater runs this install, the only way a backup restores while Recoder runs. */
	restorable: boolean;
	restore: (backup: Backup) => Promise<void>;
	/** Why the last change was refused. */
	refused: string | null;
}

/**
 * The backups this server keeps. While one is being made they are read every second. A restore restarts the server
 * through its updater, so it is offered only where one runs, and the page moves to Updates, where its steps tick off.
 */
export function useBackups(): BackupsView {
	const read = useServerRead(serverApi.backups, 'The backups did not load.');
	const making = useAction();
	const [refused, setRefused] = useState<string | null>(null);
	const running = read.data?.running ?? false;
	const { reload, take } = read;
	const { update: updateApi } = useApi();
	const restorable = useUpdate((store) => store.status?.mode === 'container');

	useEffect(() => {
		if (useUpdate.getState().read !== 'ready') void useUpdate.getState().load(updateApi);
	}, [updateApi]);

	useEffect(() => {
		if (!running) return;

		const timer = setTimeout(reload, POLL_MS);

		return () => clearTimeout(timer);
	}, [running, read.data, reload]);

	async function settle(write: Promise<BackupsState>): Promise<void> {
		take(await write);
	}

	return {
		state: read.data,
		error: read.error,
		reload,
		backUp: () => making.run(() => settle(serverApi.backUp())),
		backUpStatus: running ? 'pending' : making.status,
		setPolicy: (policy) => {
			const before = read.data;

			if (before) take({ ...before, policy });
			setRefused(null);

			settle(serverApi.setBackupPolicy(policy)).catch((failure: unknown) => {
				if (before) take(before);
				setRefused(failureText(failure, 'The schedule was not saved.'));
			});
		},
		remove: (backup) => settle(serverApi.deleteBackup(backup.id)),
		restorable,
		restore: async (backup) => {
			const status = await serverApi.restoreBackup(backup.id);

			useUpdate.setState({ status, phase: 'applying', unreachableSince: null, error: null });
			navigate(settingsHref('server', 'updates'));
		},
		refused
	};
}
