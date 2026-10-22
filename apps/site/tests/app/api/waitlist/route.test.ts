import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/** What the fake database saw, and whether its next query fails. */
const database = { values: [] as unknown[][], failWith: null as Error | null };

mock.module('@neondatabase/serverless', () => ({
	neon:
		() =>
		(_strings: TemplateStringsArray, ...values: unknown[]) => {
			if (database.failWith) return Promise.reject(database.failWith);

			database.values.push(values);

			return Promise.resolve([]);
		}
}));

const { POST } = await import('../../../../src/app/api/waitlist/route');

function join(body: unknown): Promise<Response> {
	return POST(new Request('http://localhost/api/waitlist', { method: 'POST', body: JSON.stringify(body) }));
}

const saved = process.env.DATABASE_URL;

beforeEach(() => {
	process.env.DATABASE_URL = 'postgresql://user:hunter2@db.example/neondb';
	database.values = [];
	database.failWith = null;
});

/** Puts the variable back as it was; assigning `undefined` would leave the string "undefined". */
afterEach(() => {
	if (saved === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = saved;
});

describe('POST /api/waitlist', () => {
	test('refuses an address the table would reject before it looks for a database', async () => {
		delete process.env.DATABASE_URL;

		for (const email of ['', 'no-at.example', 'a@b', `${'a'.repeat(250)}@b.co`, 42]) {
			const response = await join({ email });

			expect(response.status).toBe(400);
		}

		expect(
			(await POST(new Request('http://localhost/api/waitlist', { method: 'POST', body: 'not json' }))).status
		).toBe(400);
	});

	test('answers 503 when no database is configured', async () => {
		process.env.DATABASE_URL = '';

		const response = await join({ email: 'you@company.com' });

		expect(response.status).toBe(503);
		expect(database.values).toEqual([]);
	});

	test('stores the address trimmed and lowercase', async () => {
		const response = await join({ email: '  You@Company.COM ' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(database.values).toEqual([['you@company.com']]);
	});

	test('never echoes a database error', async () => {
		database.failWith = new Error('connect to postgresql://user:hunter2@db.example failed: relation "waitlist"');

		const response = await join({ email: 'you@company.com' });

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Could not join the waitlist' });
	});
});
