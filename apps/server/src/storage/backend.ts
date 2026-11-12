import { SQL, type TransactionSQL } from 'bun';
import { env } from '../env';
import { initializeSharedSettings, withFreshSharedSettings } from '../config/shared-settings';
import { PostgresCoordinator } from '../review/runtime/coordinator';
import { assertOwnership, currentLease, OwnershipLostError } from '../review/runtime/ownership';
import type { Collection, Table } from './collection';
import { initializePostgresStore, PostgresStore } from './postgres';
import { initializePostgresEvents, PostgresEvents } from './postgres-events';
import { withPostgresTransaction } from './postgres-transactions';
import { initializePublication, closePublicationStorage } from './postgres-publication';
import { sqliteCollection, closeSqlite } from './sqlite';

export const postgres = env.RECODER_DATABASE_URL
	? new SQL(env.RECODER_DATABASE_URL, {
			max: 12,
			connectionTimeout: 5,
			idleTimeout: 30,
			connection: { statement_timeout: 10_000, lock_timeout: 5000 }
		})
	: undefined;

async function assertActiveReviewOwner(transaction: TransactionSQL): Promise<void> {
	await assertOwnership(transaction);

	const lease = currentLease();

	if (!lease) return;

	const records = await transaction<{ id: string }[]>`
		SELECT id FROM recoder_records
		WHERE collection = 'reviews' AND id = ${lease.reviewId}
	`;

	if (!records.length) throw new OwnershipLostError(lease.reviewId);
}

const sharedStore = postgres ? new PostgresStore(postgres, assertActiveReviewOwner) : undefined;

export const sharedEvents = postgres ? new PostgresEvents(postgres, assertActiveReviewOwner) : undefined;
export const coordinator = postgres
	? new PostgresCoordinator(postgres, { leaseMs: env.RECODER_JOB_LEASE_MS })
	: undefined;

export function collection<T extends { id: string }>(table: Table): Collection<T> {
	return sharedStore ? sharedStore.collection<T>(table) : sqliteCollection<T>(table);
}

export async function initializeStorage(): Promise<void> {
	if (!postgres || !coordinator) return;

	await initializePostgresStore(postgres);
	await initializePostgresEvents(postgres);
	await initializeSharedSettings(postgres);
	await coordinator.initialize();
	await initializePublication(postgres);
}

export async function closeStorage(): Promise<void> {
	if (postgres) {
		await closePublicationStorage(postgres);
		await postgres.close();
	} else await closeSqlite();
}

export async function storageTransaction<T>(work: (transaction?: TransactionSQL) => Promise<T>): Promise<T> {
	return postgres ? withPostgresTransaction(postgres, work) : work();
}

export async function settingsOperation<T>(work: () => T | Promise<T>): Promise<T> {
	return postgres ? withFreshSharedSettings(postgres, work) : work();
}

export const sharedDiffs = sharedStore?.collection<{ id: string; diff: string }>('review_diffs');
