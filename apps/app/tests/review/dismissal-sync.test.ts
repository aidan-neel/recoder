import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sendDismissal } from '../../src/lib/review/dismissal-sync';

const realFetch = globalThis.fetch;

/** Every write the client sent, as `METHOD path`. */
const sent: string[] = [];

/** Whether the server stores dismissals or answers 500. */
let dismissWorks = true;

/** Lets the queued writes run; they wait on promises only. */
async function settle(): Promise<void> {
	for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

beforeEach(() => {
	sent.length = 0;
	dismissWorks = true;

	globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const ok = method !== 'POST' || dismissWorks;

		sent.push(`${method} ${new URL(String(input)).pathname}`);

		return Promise.resolve(
			new Response(JSON.stringify(ok ? {} : { error: 'database is locked' }), { status: ok ? 200 : 500 })
		);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('dismissal sync', () => {
	test('undoing a dismissal the server never stored sends no restore', async () => {
		dismissWorks = false;
		sendDismissal('rv-1', 'f1', 'open', 'dismissed');
		sendDismissal('rv-1', 'f1', 'dismissed', 'open');
		await settle();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals']);
	});

	test('undoing a stored dismissal restores it on the server', async () => {
		sendDismissal('rv-1', 'f2', 'open', 'dismissed');
		sendDismissal('rv-1', 'f2', 'dismissed', 'open');
		await settle();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'DELETE /api/reviews/rv-1/dismissals/f2']);
	});
});
