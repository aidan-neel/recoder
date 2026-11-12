import { AsyncLocalStorage } from 'node:async_hooks';
import type { SQL, TransactionSQL } from 'bun';

const transactions = new AsyncLocalStorage<TransactionSQL>();

export function currentPostgresTransaction(): TransactionSQL | undefined {
	return transactions.getStore();
}

export async function withPostgresTransaction<T>(
	database: SQL,
	work: (transaction: TransactionSQL) => Promise<T>
): Promise<T> {
	const current = transactions.getStore();

	if (current) return work(current);

	return database.begin((transaction) => transactions.run(transaction, () => work(transaction)));
}
