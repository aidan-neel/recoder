'use client';

import type { SetupChecklist } from '@recoder/shared';
import { create } from 'zustand';

import { failureText, isOffline } from '../api/http';
import { setupApi } from '../api/setup';

/** Where the checklist's read stands: `offline` when the server did not answer, `error` when it refused. */
export type ChecklistStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

interface ChecklistStore {
	checklist: SetupChecklist | null;
	status: ChecklistStatus;
	error: string | null;
	/** Reads the checklist; a read already in flight is shared. A failed read after a good one keeps the good one. */
	load: () => Promise<void>;
	/** Takes a checklist a setup call answered with. */
	take: (checklist: SetupChecklist) => void;
}

let inflight: Promise<void> | null = null;

/** The server's setup checklist: which of the seven steps are done, and whether setup is over. */
export const useChecklist = create<ChecklistStore>((set, get) => ({
	checklist: null,
	status: 'idle',
	error: null,
	load: () => {
		if (inflight) return inflight;

		if (!get().checklist) set({ status: 'loading' });

		const read = setupApi
			.checklist()
			.then(
				(checklist) => set({ checklist, status: 'ready', error: null }),
				(error: unknown) => {
					if (get().checklist) return;

					set({ status: isOffline(error) ? 'offline' : 'error', error: failureText(error) });
				}
			)
			.finally(() => {
				if (inflight === read) inflight = null;
			});

		inflight = read;

		return read;
	},
	take: (checklist) => set({ checklist, status: 'ready', error: null })
}));
