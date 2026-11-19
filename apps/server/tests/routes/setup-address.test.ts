import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { requireSession } from '../../src/accounts/enforcement';
import type { AddressDeps } from '../../src/deploy/setup/address';
import { createSetupAddressRoutes } from '../../src/routes/setup-address';
import { collection } from '../../src/storage/backend';
import { restoreEnvAfterEach } from '../helpers/env';
import { useTempStore } from '../helpers/temp-store';

useTempStore('recoder-setup-address-');
restoreEnvAfterEach(['RECODER_TLS', 'RECODER_PUBLIC_IPS', 'RECODER_PUBLIC_URL']);

const LOOPBACK = { requestIP: () => ({ address: '127.0.0.1' }) };

const NOW = Date.parse('2026-11-20T18:00:00Z');

const deps: AddressDeps = {
	now: () => NOW,
	probeTls: async () => ({ issuer: "Let's Encrypt", expiresAt: '2027-02-20T18:00:00.000Z' }),
	resolveDns: async () => ['203.0.113.7'],
	loadCaddy: async () => undefined
};

function setupApp(overrides: Partial<AddressDeps> = {}): Hono {
	const app = new Hono();

	app.use('/api/*', requireSession);
	app.route('/api/setup/address', createSetupAddressRoutes({ deps: { ...deps, ...overrides } }));

	return app;
}

beforeEach(async () => {
	await collection('update_state').clear();
});

test('a malformed body is answered with 400 and a reason', async () => {
	const response = await setupApp().request('/api/setup/address', { method: 'POST', body: '{"url": "x"}' }, LOOPBACK);

	expect(response.status).toBe(400);

	const body = (await response.json()) as { error: string };

	expect(body.error).toContain('domain');
});

test('a domain that does not point anywhere is answered with 409 and why', async () => {
	const response = await setupApp({ resolveDns: async () => [] }).request(
		'/api/setup/address',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ domain: 'recoder.example.com' })
		},
		LOOPBACK
	);

	expect(response.status).toBe(409);
	expect(((await response.json()) as { error: string }).error).toContain('does not resolve');
});

test('a locked remote browser may not set the address', async () => {
	process.env.RECODER_PUBLIC_IPS = '203.0.113.7';

	const response = await setupApp().request('/api/setup/address', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ domain: 'recoder.example.com' })
	});

	expect(response.status).toBe(403);
	expect(((await response.json()) as { kind?: string }).kind).toBe('setup-locked');
});

test('a local browser sets the domain and the answer reports it as pending', async () => {
	process.env.RECODER_PUBLIC_IPS = '203.0.113.7';

	const response = await setupApp().request(
		'/api/setup/address',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ domain: 'recoder.example.com' })
		},
		LOOPBACK
	);

	expect(response.status).toBe(200);

	const answer = (await response.json()) as {
		publicUrl: string | null;
		tls: { state: string; domain: string | null };
		dns?: { points: boolean };
	};

	expect(answer.publicUrl).toBe('https://recoder.example.com');
	expect(answer.tls.state).toBe('issued');
	expect(answer.tls.domain).toBe('recoder.example.com');
	expect(answer.dns?.points).toBe(true);
});

test('an external proxy address is stored and read back as external', async () => {
	const app = setupApp();

	const stored = await app.request(
		'/api/setup/address',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ external: 'https://recoder-proxy.example.com' })
		},
		LOOPBACK
	);

	expect(stored.status).toBe(200);

	const read = (await (await app.request('/api/setup/address', {}, LOOPBACK)).json()) as {
		publicUrl: string | null;
		tls: { state: string };
	};

	expect(read.publicUrl).toBe('https://recoder-proxy.example.com');
	expect(read.tls.state).toBe('external');
});

afterEach(async () => {
	await collection('update_state').clear();
});
