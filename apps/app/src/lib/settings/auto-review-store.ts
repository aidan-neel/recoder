import type { AutoReviewPayload, AutoReviewSettings } from '@recoder/shared';
import { create } from 'zustand';

import { autoReviewApi } from '../api/auto-review';
import { failureText, isOffline } from '../api/http';

/** `offline`: the review server did not answer. `error`: it answered the first load with an error. */
type AutoReviewLoad = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

interface AutoReviewStore {
	status: AutoReviewLoad;
	/** The settings and the watcher's state. Null until the first load answers. */
	payload: AutoReviewPayload | null;
	/** The server's reason when the first load failed with an answer. */
	error: string | null;
	/** Loads again, keeping what is on screen; only a first load that fails shows the failure. */
	load: () => Promise<void>;
	/** Saves a change and keeps the server's answer. Rejects with the reason it was refused. */
	save: (patch: Partial<AutoReviewSettings>) => Promise<void>;
	/**
	 * Watches a repository or leaves it alone. The list it saves is built when
	 * the save runs, from the answer before it, so quick switches on two
	 * repositories both land.
	 */
	watchRepo: (repoId: string, watched: boolean) => Promise<void>;
	/** Runs one round of checks now. Rejects when it could not run. */
	check: () => Promise<void>;
}

/** Settings → Auto-review. Reads and writes run one at a time, so answers land in the order they were asked. */
export const useAutoReview = create<AutoReviewStore>((set, get) => {
	let queue: Promise<unknown> = Promise.resolve();

	function queued(work: () => Promise<AutoReviewPayload>): Promise<void> {
		const next = queue.then(work).then((payload) => set({ payload, status: 'ready', error: null }));

		queue = next.catch(() => undefined);

		return next;
	}

	return {
		status: 'idle',
		payload: null,
		error: null,

		async load() {
			if (!get().payload) set({ status: 'loading' });

			try {
				await queued(autoReviewApi.get);
			} catch (error) {
				if (get().payload) return;

				set(
					isOffline(error)
						? { status: 'offline', error: null }
						: { status: 'error', error: failureText(error, 'Auto-review settings didn’t load.') }
				);
			}
		},

		save: (patch) => queued(() => autoReviewApi.save(patch)),

		watchRepo: (repoId, watched) =>
			queued(() => {
				const excluded = new Set(get().payload?.settings.excludedRepoIds ?? []);

				if (watched) excluded.delete(repoId);
				else excluded.add(repoId);

				return autoReviewApi.save({ excludedRepoIds: [...excluded] });
			}),

		check: () => queued(autoReviewApi.check)
	};
});
