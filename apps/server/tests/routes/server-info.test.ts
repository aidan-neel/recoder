import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { ServerCheck, ServerChecks } from '@recoder/shared';
import { Hono } from 'hono';
import { requireSession } from '../../src/accounts/enforcement';
import { readServerChecks } from '../../src/deploy/diagnostics/checks';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { createServerInfoRoutes } from '../../src/routes/server-info';
import { collection } from '../../src/storage/backend';
import { whenFound } from '../helpers/when-found';

const LOOPBACK = { requestIP: () => ({ address: '127.0.0.1' }) };
const PRIVATE = 'test-credential-not-for-output';
const POSTGRES = `postgres://diagnostics:${PRIVATE}@database.test/team`;

beforeEach(async () => {
	await collection('update_state').clear();
});

afterEach(() => {
	setReviewOverrides({});
	mock.restore();
});

test('only a POST including model calls the configured model, once, and never publishes its response body', async () => {
	const request = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(PRIVATE, { status: 503 }));

	setReviewOverrides({
		models: [
			{
				id: 'test-model',
				label: 'GPT-6 Luna',
				model: 'gpt-6-luna',
				baseUrl: 'https://provider.example/v1',
				apiKey: PRIVATE
			}
		]
	});

	const app = new Hono().route('/api/server', createServerInfoRoutes());
	const get = await app.request('/api/server/checks');

	expect((await get.json()) as ServerChecks).toMatchObject({ running: false });
	expect(request).not.toHaveBeenCalled();

	const post = await app.request('/api/server/checks?only=model', { method: 'POST' }, LOOPBACK);

	expect(post.status).toBe(202);
	expect(await post.json()).toMatchObject({ running: true });

	const completed = await settledChecks();

	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0]?.[0]).toBe('https://provider.example/v1/chat/completions');
	expect(completed.checks.find(({ id }) => id === 'model')?.state).toBe('fail');
	expect(completed.checks.find(({ id }) => id === 'forge')?.state).toBe('pending');
	expect(JSON.stringify(completed)).not.toContain(PRIVATE);

	const again = await app.request('/api/server/checks');

	expect(await again.json()).toEqual(completed);
	expect(request).toHaveBeenCalledTimes(1);
});

test('two route instances admit only one durable check run', async () => {
	const result = Promise.withResolvers<ServerCheck>();
	const runCheck = mock(() => result.promise);

	const replicas = [
		new Hono().route('/api/server', createServerInfoRoutes({ runCheck })),
		new Hono().route('/api/server', createServerInfoRoutes({ runCheck }))
	];

	const attempts = await Promise.all(
		replicas.map((app) => app.request('/api/server/checks?only=model', { method: 'POST' }, LOOPBACK))
	);

	result.resolve({ id: 'model', state: 'ok', detail: 'Answered.' });

	expect(attempts.map(({ status }) => status).sort()).toEqual([202, 409]);
	expect((await settledChecks()).checks.find(({ id }) => id === 'model')).toMatchObject({ state: 'ok' });
	expect(runCheck).toHaveBeenCalledTimes(1);
});

test('a locked browser cannot start a check or send a storage connection probe', async () => {
	const runCheck = mock(async () => ({ id: 'model' as const, state: 'ok' as const, detail: '' }));
	const connectPostgres = mock(async () => '16.4');

	const app = new Hono()
		.use('*', requireSession)
		.route('/api/server', createServerInfoRoutes({ runCheck, connectPostgres }));

	for (const [path, init] of [
		['/api/server/checks?only=model', { method: 'POST' }],
		['/api/server/storage/test', storageTestRequest(POSTGRES)]
	] as const) {
		const response = await app.request(path, init);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}

	expect(runCheck).not.toHaveBeenCalled();
	expect(connectPostgres).not.toHaveBeenCalled();
});

test('a connection test never echoes a supplied URL or a driver error', async () => {
	const connectPostgres = mock(async () => {
		throw new Error(`connection rejected: ${POSTGRES}`);
	});

	const app = new Hono().route('/api/server', createServerInfoRoutes({ connectPostgres }));

	const invalid = await app.request('/api/server/storage/test', storageTestRequest(`https://${PRIVATE}`), LOOPBACK);

	expect(invalid.status).toBe(400);
	expect(await invalid.text()).not.toContain(PRIVATE);
	expect(connectPostgres).not.toHaveBeenCalled();

	const failed = await app.request('/api/server/storage/test', storageTestRequest(POSTGRES), LOOPBACK);
	const failure = await failed.json();

	expect(failed.status).toBe(200);
	expect(failure).toMatchObject({ ok: false });
	expect(JSON.stringify(failure)).not.toContain(PRIVATE);
	expect(connectPostgres).toHaveBeenCalledWith(POSTGRES);
});

test('the database version is reported without arbitrary server metadata', async () => {
	const connectPostgres = mock(async () => `16.4 (build with ${PRIVATE})`);
	const app = new Hono().route('/api/server', createServerInfoRoutes({ connectPostgres }));
	const result = await app.request('/api/server/storage/test', storageTestRequest(POSTGRES), LOOPBACK);

	expect(result.status).toBe(200);
	expect(await result.json()).toEqual({ ok: true, version: '16.4' });
});

test('the overview hides URL credentials and raw TLS errors', async () => {
	const readAddress = () => ({
		publicUrl: `https://operator:${PRIVATE}@recoder.example/path?key=${PRIVATE}`,
		tls: { state: 'failed' as const, domain: 'recoder.example', error: PRIVATE }
	});

	const app = new Hono().route('/api/server', createServerInfoRoutes({ readAddress }));
	const response = await app.request('/api/server');
	const body = await response.json();

	expect(response.status).toBe(200);

	expect(body).toMatchObject({
		publicUrl: 'https://recoder.example',
		tls: { state: 'failed', domain: 'recoder.example' },
		storage: { kind: 'builtin' },
		reviews: { running: 0, queued: 0 }
	});

	expect(JSON.stringify(body)).not.toContain(PRIVATE);
});

function storageTestRequest(url: string): RequestInit {
	return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) };
}

function settledChecks(): Promise<ServerChecks> {
	return whenFound(async () => {
		const checks = await readServerChecks();

		return checks.running ? null : checks;
	});
}
