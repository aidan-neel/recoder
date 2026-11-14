import type { UpdateState, UpdateStatus } from '@recoder/shared';
import { create } from 'zustand';

import { ApiError, failureText, isOffline } from '../api/http';
import type { UpdateApi } from '../api/update';

/** How often a running update is read while the server answers. */
const POLL_MS = 1500;

/** The longest wait between reads while the server is away. */
const MAX_BACKOFF_MS = 6000;

/** How long the server may stay away, restarting, before the page gives up on it. */
export const GIVE_UP_MS = 120_000;

/** The states an update passes through while it applies. */
const RUNNING_STATES: readonly UpdateState[] = ['pausing', 'updating', 'restarting', 'resuming'];

/**
 * What the page is doing with the updater: `checking` waits on a check,
 * `applying` follows a running update, `updated` is one that settled, and
 * `lost` is a server that never came back.
 */
export type UpdatePhase = 'idle' | 'checking' | 'applying' | 'updated' | 'lost';

/** `failed`: the status could not be read at all. */
type UpdateRead = 'loading' | 'ready' | 'failed';

interface UpdateStore {
	read: UpdateRead;
	status: UpdateStatus | null;
	phase: UpdatePhase;
	/** When the server stopped answering the polls; null while it answers. */
	unreachableSince: number | null;
	/** How many polls ran, so the page can schedule the next one. */
	polls: number;
	/** Why the last check or start was refused, or why the status could not be read. */
	error: string | null;
	load: (api: UpdateApi) => Promise<void>;
	check: (api: UpdateApi) => Promise<void>;
	apply: (api: UpdateApi) => Promise<void>;
	poll: (api: UpdateApi, now: number) => Promise<void>;
	/** Follows the update again after the page gave up on the server. */
	resume: () => void;
}

/** How long to wait before the next read: steady while the server answers, slower the longer it is away. */
export function pollDelay(unreachableSince: number | null, now: number): number {
	if (unreachableSince === null) return POLL_MS;

	return Math.min(MAX_BACKOFF_MS, POLL_MS + (now - unreachableSince) / 4);
}

/** A server that is restarting refuses connections, or answers from a proxy that has nothing behind it. */
function isServerAway(error: unknown): boolean {
	return isOffline(error) || (error instanceof ApiError && error.status >= 500);
}

function isRunning(status: UpdateStatus): boolean {
	return RUNNING_STATES.includes(status.state);
}

/** Where a running update stands once its status is read: still going, done, or stopped with an error or an update left to apply. */
function phaseAfter(status: UpdateStatus): UpdatePhase {
	if (isRunning(status)) return 'applying';

	return status.state === 'idle' && status.available === null ? 'updated' : 'idle';
}

export const useUpdate = create<UpdateStore>((set, get) => ({
	read: 'loading',
	status: null,
	phase: 'idle',
	unreachableSince: null,
	polls: 0,
	error: null,

	async load(api) {
		try {
			const status = await api.status();

			set({ status, read: 'ready', error: null, phase: isRunning(status) ? 'applying' : 'idle' });
		} catch (error) {
			set({ read: 'failed', error: failureText(error, 'Couldn’t read the update status.') });
		}
	},

	async check(api) {
		set({ phase: 'checking', error: null });

		try {
			set({ status: await api.check(), phase: 'idle' });
		} catch (error) {
			set({ phase: 'idle', error: failureText(error, 'Couldn’t check for updates.') });
		}
	},

	async apply(api) {
		set({ error: null });

		try {
			set({ status: await api.apply(), phase: 'applying', unreachableSince: null });
		} catch (error) {
			set({ phase: 'idle', error: failureText(error, 'Couldn’t start the update.') });
		}
	},

	async poll(api, now) {
		if (get().phase !== 'applying') return;

		try {
			const status = await api.status();

			set((store) => ({ status, phase: phaseAfter(status), unreachableSince: null, polls: store.polls + 1 }));
		} catch (error) {
			if (!isServerAway(error)) {
				set({ phase: 'idle', error: failureText(error, 'Couldn’t read the update status.') });

				return;
			}

			const since = get().unreachableSince ?? now;

			set((store) => ({
				unreachableSince: since,
				polls: store.polls + 1,
				phase: now - since > GIVE_UP_MS ? 'lost' : 'applying'
			}));
		}
	},

	resume: () => set({ phase: 'applying', unreachableSince: null })
}));
