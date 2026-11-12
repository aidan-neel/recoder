import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { initializePostgresStore, PostgresStore } from '../../src/storage/postgres';
import { initializePostgresEvents, PostgresEvents } from '../../src/storage/postgres-events';
import { withPostgresTransaction } from '../../src/storage/postgres-transactions';

const testUrl = process.env.RECODER_POSTGRES_TEST_URL;
const schema = `recoder_storage_${crypto.randomUUID().replaceAll('-', '')}`;
let admin: SQL;
let first: SQL;
let second: SQL;

beforeAll(async () => {
	if (!testUrl) return;

	admin = new SQL(testUrl);
	await admin.unsafe(`CREATE SCHEMA ${schema}`);
	first = new SQL(testUrl, { connection: { search_path: schema } });
	second = new SQL(testUrl, { connection: { search_path: schema } });
	await Promise.all([initializePostgresStore(first), initializePostgresStore(second)]);
	await initializePostgresEvents(first);
});

afterAll(async () => {
	if (!testUrl) return;

	await Promise.all([first.close(), second.close()]);
	await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
	await admin.close();
});

const integration = test.skipIf(!testUrl);
const unrestricted = async () => {};

integration('a committed record is visible to an independent database client', async () => {
	const writer = new PostgresStore(first, unrestricted).collection<{ id: string; count: number }>('reviews');
	const reader = new PostgresStore(second, unrestricted).collection<{ id: string; count: number }>('reviews');
	const item = { id: crypto.randomUUID(), count: 1 };

	await writer.set(item);
	expect(await reader.get(item.id)).toEqual(item);
	await writer.delete(item.id);
	expect(await reader.get(item.id)).toBeUndefined();
});

integration('concurrent updates retain every increment across clients', async () => {
	const stores = [first, second].map((database) =>
		new PostgresStore(database, unrestricted).collection<{ id: string; count: number }>('review_metrics')
	);

	const id = crypto.randomUUID();

	await stores[0].set({ id, count: 0 });

	await Promise.all(
		Array.from({ length: 40 }, (_, index) =>
			stores[index % 2].update(id, (current) => ({
				id,
				count: (current?.count ?? 0) + 1
			}))
		)
	);

	expect(await stores[1].get(id)).toEqual({ id, count: 40 });
});

integration('a failed mutation leaves the committed record unchanged', async () => {
	const records = new PostgresStore(first, unrestricted).collection<{ id: string; count: number }>('reviews');
	const item = { id: crypto.randomUUID(), count: 3 };

	await records.set(item);

	await expect(
		records.update(item.id, () => {
			throw new Error('rejected update');
		})
	).rejects.toThrow('rejected update');

	expect(await records.get(item.id)).toEqual(item);
	await expect(records.update(item.id, () => ({ id: 'different', count: 9 }))).rejects.toThrow('cannot change its id');
	expect(await records.get(item.id)).toEqual(item);
});

integration('an ownership rejection prevents every mutating operation', async () => {
	const records = new PostgresStore(first, async () => {
		throw new Error('lease expired');
	}).collection<{ id: string }>('reviews');

	await expect(records.set({ id: 'blocked' })).rejects.toThrow('lease expired');
	await expect(records.update('blocked', () => ({ id: 'blocked' }))).rejects.toThrow('lease expired');
	await expect(records.delete('blocked')).rejects.toThrow('lease expired');
	await expect(records.clear()).rejects.toThrow('lease expired');
	expect(await records.get('blocked')).toBeUndefined();
});

integration('an outer transaction rolls back record changes together', async () => {
	const records = new PostgresStore(first, unrestricted).collection<{ id: string }>('reviews');
	const id = crypto.randomUUID();

	await expect(
		withPostgresTransaction(first, async () => {
			await records.set({ id });
			throw new Error('abort transaction');
		})
	).rejects.toThrow('abort transaction');

	expect(await records.get(id)).toBeUndefined();
});

integration('independent event writers commit a complete ordered snapshot and log', async () => {
	const streams = [first, second].map((database) => new PostgresEvents(database, unrestricted));
	const id = crypto.randomUUID();

	await Promise.all(
		Array.from({ length: 30 }, (_, index) =>
			streams[index % 2].append(id, { type: 'log', message: `message ${index}` }, (snapshot, event) => {
				event.data = { committed: true };
				snapshot.activity.push({ sequence: event.sequence, message: event.message, at: event.at });

				return snapshot;
			})
		)
	);

	const events = await streams[1].after(id, 0);

	const progress = await new PostgresStore(second, unrestricted)
		.collection<{ id: string; sequence: number; activity: unknown[] }>('review_progress')
		.get(id);

	expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
	expect(events.every((event) => event.data?.committed === true)).toBe(true);
	expect(progress?.sequence).toBe(30);
	expect(progress?.activity).toHaveLength(30);
});
