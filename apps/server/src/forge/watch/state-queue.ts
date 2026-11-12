import { postgres, storageTransaction } from '../../storage/backend';
import { withSharedSettingsTransaction } from '../../config/shared-settings';

let pending: Promise<void> = Promise.resolve();

/** Keep each read/decide/start/write of the shared cursor file together across poller and webhook requests. */
export function withWatchState<T>(work: () => Promise<T>): Promise<T> {
	if (postgres) {
		return storageTransaction(async (transaction) => {
			if (!transaction) throw new Error('Shared watch state requires a PostgreSQL transaction.');
			await transaction`SELECT pg_advisory_xact_lock(hashtextextended('recoder:watch-state', 0))`;

			return withSharedSettingsTransaction(transaction, work);
		});
	}

	const result = pending.then(work);

	pending = result.then(
		() => undefined,
		() => undefined
	);

	return result;
}
