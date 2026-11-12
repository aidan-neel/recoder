import type { SQL } from 'bun';
import { coordinator, settingsOperation } from '../../storage/backend';
import { readAutoReviewSettings } from '../../forge/watch/settings';
import { readWatchState } from '../../forge/watch/cursor';
import { checkNow } from '../../forge/watch/watcher';
import { syncAllVllm, VLLM_SYNC_INTERVAL_MS } from '../../models/vllm/vllm-sync';
import { createWorkerWaitReporter } from './worker-wait';

export function startSharedMaintenance(database: SQL): () => Promise<void> {
	let stopped = false;
	let lastModelSync = 0;
	let wake: (() => void) | undefined;
	const reportWorkerWaits = coordinator ? createWorkerWaitReporter(coordinator) : undefined;

	/** A failed report must not hold back the forge check, so it is logged and the next round tries again. */
	const reportWaitingReviews = async () => {
		try {
			await reportWorkerWaits?.();
		} catch {
			if (!stopped)
				console.error('[maintenance] could not report reviews waiting for a worker; the next round will retry');
		}
	};

	const run = async () => {
		while (!stopped) {
			try {
				const connection = await database.reserve();

				try {
					const [row] = await connection<{ locked: boolean }[]>`
						SELECT pg_try_advisory_lock(hashtextextended('recoder:maintenance', 0)) AS locked
					`;

					if (row?.locked) {
						try {
							await reportWaitingReviews();

							await settingsOperation(async () => {
								const settings = readAutoReviewSettings();
								const previous = readWatchState().status?.lastCheckAt;

								if (
									settings.enabled &&
									(!previous || Date.now() - Date.parse(previous) >= settings.intervalSeconds * 1000)
								)
									await checkNow();
							});

							if (!stopped && Date.now() - lastModelSync >= VLLM_SYNC_INTERVAL_MS) {
								await settingsOperation(() => syncAllVllm(true));
								lastModelSync = Date.now();
							}
						} finally {
							await connection`SELECT pg_advisory_unlock(hashtextextended('recoder:maintenance', 0))`;
						}
					}
				} finally {
					connection.release();
				}
			} catch {
				if (!stopped) console.error('[maintenance] shared maintenance failed; the next round will retry');
			}

			if (!stopped)
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 1000);

					wake = () => {
						clearTimeout(timer);
						resolve();
					};
				});
		}
	};

	const running = run();

	return async () => {
		stopped = true;
		wake?.();
		await Promise.race([running, new Promise<void>((resolve) => setTimeout(resolve, 1000))]);
	};
}
