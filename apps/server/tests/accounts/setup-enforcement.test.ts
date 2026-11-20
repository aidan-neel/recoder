import { afterEach, expect, spyOn, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { requireSession } from '../../src/accounts/enforcement';
import { serverAccessToken } from '../../src/accounts/local-access-token';
import { retireSetup, startSetupCode } from '../../src/accounts/setup-code';
import { createSession } from '../../src/accounts/sessions';
import { app } from '../../src/app';
import { db } from '../../src/store';
import { serverDataDir } from '../../src/util/data-dir';
import { createOwnerAccount, useFakeForges } from '../helpers/fake-forge-oauth';
import { requestFrom } from '../helpers/local-app';

useFakeForges();

const REMOTE = '192.0.2.14';
const REMOTE_PEER = { requestIP: () => ({ address: REMOTE }) };

const OPERATIONS = [
	['POST', '/api/settings/vllm', {}, 400],
	['POST', '/api/settings/providers/openrouter/connect', {}, 400],
	['PUT', '/api/settings/models?catalog=0', {}, 200],
	['PUT', '/api/agent/providers/openai/key', {}, 400],
	['PUT', '/api/server/backups/policy', {}, 400],
	['POST', '/api/update/rollback', {}, 409],
	['POST', '/api/repos', { name: 'org/repo', url: 'https://github.com/org/repo' }, 201],
	['GET', '/api/settings/providers', undefined, 200],
	['GET', '/api/settings/models?catalog=0', undefined, 200],
	['GET', '/api/settings/vllm', undefined, 200],
	['GET', '/api/server/backups/missing/download?key=1', undefined, 404],
	['GET', '/api/server/logs', undefined, 200],
	['GET', '/api/update/history', undefined, 200],
	['GET', '/api/repos', undefined, 200],
	['GET', '/api/auth/repos', undefined, 400]
] as const;

afterEach(async () => {
	await retireSetup();
	await db.repos.clear();
});

function send(method: string, path: string, body?: object, headers: Record<string, string> = {}): Promise<Response> {
	return requestFrom(REMOTE, path, {
		method,
		headers: { 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function unlock(): Promise<string> {
	const log = spyOn(console, 'log').mockImplementation(() => {});

	try {
		await startSetupCode(false);
	} finally {
		log.mockRestore();
	}

	const code = (await readFile(join(serverDataDir(), 'setup-code'), 'utf8')).trim();
	const response = await send('POST', '/api/auth/setup', { code });

	expect(response.status).toBe(200);

	return response.headers.getSetCookie()[0]!.split(';')[0]!;
}

test('a remote request must unlock before configuration writes and private reads reach their handlers', async () => {
	for (const [method, path, body] of OPERATIONS) {
		const response = await send(method, path, body);

		expect([method, path, response.status]).toEqual([method, path, 403]);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}

	expect(await db.repos.list()).toEqual([]);
});

test('a setup-code grant admits the same operations from a remote peer', async () => {
	const cookie = await unlock();

	for (const [method, path, body, status] of OPERATIONS) {
		const response = await send(method, path, body, { cookie });

		expect([method, path, response.status]).toEqual([method, path, status]);
	}

	expect(await db.repos.list()).toMatchObject([{ name: 'org/repo' }]);
});

test('claiming the server replaces setup access with session authentication', async () => {
	const setup = await unlock();

	await createOwnerAccount();

	const session = `recoder_session=${(await createSession('owner')).token}`;

	for (const [method, path, body, status] of OPERATIONS) {
		const denied = await send(method, path, body, { cookie: setup });

		expect([method, path, denied.status]).toEqual([method, path, 401]);
		expect(await denied.json()).toMatchObject({ kind: 'signed-out' });

		const allowed = await send(method, path, body, { cookie: session });

		expect([method, path, allowed.status]).toEqual([method, path, status]);
	}
});

test('the locked checklist returns only the claim step and address polling needs the setup grant', async () => {
	process.env.RECODER_PUBLIC_URL = 'https://recoder.example.test';

	const locked = await send('GET', '/api/setup');

	expect(locked.status).toBe(200);
	expect(locked.headers.get('cache-control')).toBe('no-store');
	expect(await locked.json()).toEqual({ complete: false, steps: [{ id: 'claim', done: false }] });
	expect((await send('GET', '/api/setup/address')).status).toBe(403);
	expect((await send('POST', '/api/setup/address', {})).status).toBe(403);

	const cookie = await unlock();
	const address = await send('GET', '/api/setup/address', undefined, { cookie });

	expect(address.status).toBe(200);
	expect(await address.json()).toMatchObject({ publicUrl: 'https://recoder.example.test' });
	expect((await send('POST', '/api/setup/address', {}, { cookie })).status).toBe(400);
});

test('only the exact public paths and methods are reachable while locked', async () => {
	for (const [method, path] of [
		['GET', '/health'],
		['HEAD', '/health'],
		['GET', '/health/ready'],
		['HEAD', '/health/ready'],
		['GET', '/api/auth/me']
	] as const) {
		expect((await send(method, path)).status).toBe(200);
	}

	for (const [method, path] of [
		['GET', '/'],
		['POST', '/health'],
		['GET', '/health/identity'],
		['GET', '/health/ready/detail'],
		['DELETE', '/api/auth/me'],
		['GET', '/api/auth/setup'],
		['GET', '/api/setup/'],
		['POST', '/api/setup'],
		['GET', '/api/setup/address'],
		['POST', '/api/setup/storage'],
		['POST', '/api/auth/logout'],
		['GET', '/api/auth/device/unknown'],
		['GET', '/api/auth/oauth/unknown/start'],
		['POST', '/api/webhooks/github']
	] as const) {
		const response = await send(method, path);

		expect([method, path, response.status]).toEqual([method, path, 403]);
		expect(await response.json()).toMatchObject({ kind: 'setup-locked' });
	}
});

test('a new route next to the public routes needs credentials even if the device poll also matches', async () => {
	const routes = new Hono()
		.use('*', requireSession)
		.get('/api/auth/device/admin', (c) => c.text('private'))
		.all('/api/auth/device/config', (c) => c.text('private'))
		.get('/api/auth/device/:attemptId', (c) => c.text('poll'))
		.get('/api/auth/oauth/another/start', (c) => c.text('private'))
		.get('/health/future', (c) => c.text('private'));

	const privatePaths = [
		'/api/auth/device/admin',
		'/api/auth/device/config',
		'/api/auth/oauth/another/start',
		'/health/future'
	];

	for (const path of privatePaths) expect((await routes.request(path, {}, REMOTE_PEER)).status).toBe(403);

	await createOwnerAccount();

	for (const path of privatePaths) expect((await routes.request(path, {}, REMOTE_PEER)).status).toBe(401);

	expect(await (await routes.request('/api/auth/device/unknown', {}, REMOTE_PEER)).text()).toBe('poll');
	expect((await send('GET', '/api/setup')).status).toBe(401);
});

test('a setup grant cannot authorize browser writes from an untrusted origin', async () => {
	const cookie = await unlock();

	const response = await send(
		'POST',
		'/api/repos',
		{ name: 'org/repo', url: 'https://github.com/org/repo' },
		{
			cookie,
			origin: 'https://other.example'
		}
	);

	expect(response.status).toBe(403);
	expect(await db.repos.list()).toEqual([]);
});

test('the setup exemption is only a direct loopback request, never a proxy header or a missing peer', async () => {
	for (const address of ['127.1.2.3', '::1', '::ffff:127.0.0.1']) {
		expect((await requestFrom(address, '/api/repos')).status).toBe(200);
	}

	const proxied = await requestFrom('127.0.0.1', '/api/repos', {
		headers: { 'x-forwarded-for': REMOTE }
	});

	expect(proxied.status).toBe(403);
	expect((await app.request('/api/repos')).status).toBe(403);

	expect((await send('GET', '/api/repos', undefined, { authorization: `Bearer ${serverAccessToken()}` })).status).toBe(
		403
	);

	await createOwnerAccount();

	expect((await requestFrom('127.0.0.1', '/api/repos')).status).toBe(401);
});

test('an unrelated website cannot read private data using the local browser’s loopback access', async () => {
	const response = await requestFrom('127.0.0.1', '/api/settings/vllm', {
		headers: { origin: 'https://other.example' }
	});

	expect(response.status).toBe(403);
});
