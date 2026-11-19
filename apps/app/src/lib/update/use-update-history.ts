'use client';

import type { UpdateHistoryEntry } from '@recoder/shared';
import { useEffect, useRef } from 'react';

import { useApi } from '../api/client';
import { useServerRead } from '../server/use-server-read';
import { dayDate } from '../shell/age';
import { formatDuration } from '../shell/format';
import { useUpdate } from './update-store';

/** Everything the update history shows and does. */
export interface UpdateHistoryView {
	entries: UpdateHistoryEntry[] | null;
	error: string | null;
	/** Starts going back to `version`; the card above follows it like an update. */
	rollback: (version: string) => Promise<void>;
}

/** The line under a version: when it went in, who put it in and how long it took, or why it did not stay. */
export function historyLine(entry: UpdateHistoryEntry): string {
	const when = dayDate(entry.installedAt);

	if (entry.outcome === 'rolled-back')
		return `${when} · ${entry.error ?? 'failed its health check'}, rolled back on its own`;
	if (entry.outcome === 'failed') return `${when} · ${entry.error ?? 'the update failed'}`;

	const by = entry.by ? `updated by ${entry.by}` : 'installed';
	const took = entry.durationMs === null ? '' : ` in ${formatDuration(entry.durationMs)}`;

	return `${when} · ${by}${took}`;
}

/** The versions this install has run, newest first, read again each time an update or a rollback settles. */
export function useUpdateHistory(): UpdateHistoryView {
	const { update } = useApi();
	const read = useServerRead(update.history, 'The update history did not load.');
	const phase = useUpdate((store) => store.phase);
	const was = useRef(phase);
	const { reload } = read;

	useEffect(() => {
		if (was.current === 'applying' && phase !== 'applying') reload();

		was.current = phase;
	}, [phase, reload]);

	return {
		entries: read.data?.entries ?? null,
		error: read.error,
		rollback: async (version) => {
			const status = await update.rollback(version);

			useUpdate.setState({ status, phase: 'applying', unreachableSince: null, error: null });
		}
	};
}
