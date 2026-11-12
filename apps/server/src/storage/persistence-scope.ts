import type { TransactionSQL } from 'bun';
import { env } from '../env';
import { currentLease } from '../review/runtime/ownership';
import { currentPostgresTransaction } from './postgres-transactions';

const transactions = new WeakMap<TransactionSQL, string>();

export function persistenceScope(): string {
	if (!env.RECODER_DATABASE_URL) return '';

	const transaction = currentPostgresTransaction();

	if (transaction) {
		let id = transactions.get(transaction);

		if (!id) {
			id = crypto.randomUUID();
			transactions.set(transaction, id);
		}

		return id;
	}

	const lease = currentLease();

	return lease ? JSON.stringify([lease.ownerId, lease.epoch]) : 'request';
}
