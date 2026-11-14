import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../../src/app';
import { grantSetup, SETUP_GRANT_MS, startSetupCode, retireSetup } from '../../src/accounts/setup-code';
import { setToken } from '../../src/forge/tokens';
import { useFakeClock } from '../helpers/fake-clock';
import {
	answerForge,
	connectForges,
	createOwnerAccount,
	deviceCodeAnswer,
	forgeCalls,
	useFakeForges,
	userAnswer
} from '../helpers/fake-forge-oauth';
import { requestFrom } from '../helpers/local-app';

useFakeForges();
useFakeClock();

const TAILNET_PEER = '100.64.0.7';
const MINUTE_MS = 60_000;

/** What the server shows a person and what it logs: collected so no test can miss a place the code leaks to. */
const seen: string[] = [];
const logged: string[] = [];

let code = '';

/** Each test starts ten minutes after the last, so the attempt limits of one never count against the next. */
let testClock = Date.parse('2030-01-01T00:00:00Z');

beforeEach(async () => {
	jest.setSystemTime((testClock += 10 * MINUTE_MS));
	seen.length = 0;
	logged.length = 0;
	spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.join(' ')));

	await startSetupCode(false);

	code = readFileSync(join(process.env.RECODER_DATA_DIR ?? '', 'setup-code'), 'utf8').trim();
});

afterEach(async () => {
	spyOn(console, 'log').mockRestore();
	await retireSetup();
});

/** A request that reaches the server through a proxy on the same machine, like `tailscale serve`. */
function proxied(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = { 'x-forwarded-for': '100.64.0.9', ...init.headers };

	return send('127.0.0.1', path, { ...init, headers });
}

async function send(address: string, path: string, init?: RequestInit): Promise<Response> {
	const response = await requestFrom(address, path, init);

	seen.push(JSON.stringify([await response.clone().text(), [...response.headers]]));

	return response;
}

function unlock(address: string, attempt: string): Promise<Response> {
	return send(address, '/api/auth/setup', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code: attempt })
	});
}

function cookieOf(response: Response): string {
	return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

async function setupLocked(response: Response): Promise<boolean> {
	return (await response.json()).setupLocked;
}

describe('the setup code', () => {
	test('is 8 characters from an alphabet without look-alikes, logged once and kept in a 0600 file', () => {
		expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
		expect(logged.filter((line) => line.includes(code))).toHaveLength(1);
		expect(statSync(join(process.env.RECODER_DATA_DIR ?? '', 'setup-code')).mode & 0o777).toBe(0o600);
	});

	test('is new on each start, and the old one stops working', async () => {
		const first = code;

		await startSetupCode(false);

		expect((await unlock('127.0.0.1', first)).status).toBe(403);
	});

	test('is deleted, with its record, once an account exists', async () => {
		await createOwnerAccount();

		expect(existsSync(join(process.env.RECODER_DATA_DIR ?? '', 'setup-code'))).toBe(false);
		expect((await unlock('127.0.0.1', code)).status).toBe(409);
	});

	test('is not made when the server starts with an account', async () => {
		await retireSetup();
		await startSetupCode(true);

		expect(existsSync(join(process.env.RECODER_DATA_DIR ?? '', 'setup-code'))).toBe(false);
	});
});

describe('setupLocked', () => {
	test.each([
		['a forwarded request', { 'x-forwarded-for': '100.64.0.9' }],
		['a Forwarded header', { forwarded: 'for=100.64.0.9' }],
		['an X-Real-IP header', { 'x-real-ip': '100.64.0.9' }],
		['an X-Forwarded-Host header', { 'x-forwarded-host': 'recoder.tailnet.ts.net' }],
		['a Tailscale-User header', { 'tailscale-user-login': 'someone@example.com' }]
	])('is true for %s from a loopback socket', async (_name, headers) => {
		expect(await setupLocked(await send('127.0.0.1', '/api/auth/me', { headers }))).toBe(true);
	});

	test('is true for a peer that is not loopback, and for a request with no known peer', async () => {
		expect(await setupLocked(await send('100.64.0.7', '/api/auth/me'))).toBe(true);
		expect(await setupLocked(await send('192.168.1.20', '/api/auth/me'))).toBe(true);
		expect(await setupLocked(await app.request('/api/auth/me'))).toBe(true);
	});

	test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('is false for a bare request from %s', async (address) => {
		expect(await setupLocked(await send(address, '/api/auth/me'))).toBe(false);
	});

	test('is false once an account exists, from anywhere', async () => {
		await createOwnerAccount();

		expect(await setupLocked(await proxied('/api/auth/me'))).toBe(false);
	});

	test('hides the server’s connections from a locked request', async () => {
		connectForges({ github: 'octocat' });

		expect((await (await proxied('/api/auth/me')).json()).connected).toEqual([]);
		expect((await (await send('127.0.0.1', '/api/auth/me')).json()).connected).toHaveLength(1);
	});
});

describe('POST /api/auth/setup', () => {
	test('the code unlocks the browser with an HttpOnly Lax cookie, in any case and with dashes or spaces', async () => {
		const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
		const response = await unlock('127.0.0.1', ` ${typed} `);

		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toMatch(/^recoder_setup=[\w-]{43}; .*HttpOnly; .*SameSite=Lax/);
		expect(response.headers.get('set-cookie')).toContain('Max-Age=900');

		const me = await proxied('/api/auth/me', { headers: { cookie: cookieOf(response) } });

		expect(await setupLocked(me)).toBe(false);
	});

	test('a wrong code is refused with 403 and unlocks nothing', async () => {
		const response = await unlock(TAILNET_PEER, 'AAAAAAAA');

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'That is not the setup code.', kind: 'setup-code' });
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	test('a fifteen-minute-old grant no longer unlocks', async () => {
		const grant = await grantSetup(Date.now() - SETUP_GRANT_MS - 1000);
		const stale = await proxied('/api/auth/me', { headers: { cookie: `recoder_setup=${grant.token}` } });
		const live = await grantSetup();
		const fresh = await proxied('/api/auth/me', { headers: { cookie: `recoder_setup=${live.token}` } });

		expect(await setupLocked(stale)).toBe(true);
		expect(await setupLocked(fresh)).toBe(false);
	});

	test('a made-up cookie unlocks nothing', async () => {
		const response = await proxied('/api/auth/me', { headers: { cookie: `recoder_setup=${'A'.repeat(43)}` } });

		expect(await setupLocked(response)).toBe(true);
	});

	test('the sixth try in a minute from one peer is limited, and the minute lets it try again', async () => {
		for (let attempt = 0; attempt < 5; attempt++) expect((await unlock(TAILNET_PEER, 'AAAAAAAA')).status).toBe(403);

		const limited = await unlock(TAILNET_PEER, code);

		expect(limited.status).toBe(429);
		expect(limited.headers.get('retry-after')).toBe('60');
		expect(limited.headers.get('set-cookie')).toBeNull();

		jest.advanceTimersByTime(MINUTE_MS + 1);

		expect((await unlock(TAILNET_PEER, code)).status).toBe(200);
	});

	test('tries from many peers share a global limit', async () => {
		for (let peer = 0; peer < 10; peer++) expect((await unlock(`100.64.1.${peer}`, 'AAAAAAAA')).status).toBe(403);

		expect((await unlock('100.64.2.1', code)).status).toBe(429);
	});

	test('refuses an untrusted origin', async () => {
		const crossSite = await send('127.0.0.1', '/api/auth/setup', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
			body: JSON.stringify({ code })
		});

		expect(crossSite.status).toBe(403);
		expect(crossSite.headers.get('set-cookie')).toBeNull();
	});

	test('the code appears nowhere a client can see: not in a response body or header, wrong or right', async () => {
		await unlock(TAILNET_PEER, 'AAAAAAAA');
		await unlock(TAILNET_PEER, code);
		await proxied('/api/auth/me');

		expect(seen.length).toBeGreaterThan(2);
		expect(seen.join('\n')).not.toContain(code);
	});
});

describe('the gate on the claim routes', () => {
	function claim(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
		return proxied(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		});
	}

	test.each([
		['/api/auth/device', { provider: 'github' }],
		['/api/auth/token', { provider: 'github', token: 'ghp_x' }],
		['/api/auth/adopt', { provider: 'github' }]
	])('%s answers 403 setup-locked from a proxied request and calls no forge', async (path, body) => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const response = await claim(path, body);

		expect(response.status).toBe(403);
		expect((await response.json()).kind).toBe('setup-locked');
		expect(forgeCalls()).toHaveLength(0);
	});

	test('the setup cookie opens them', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const cookie = cookieOf(await unlock(TAILNET_PEER, code));
		const response = await claim('/api/auth/device', { provider: 'github' }, { cookie });

		expect(response.status).toBe(200);
	});

	test('two adopts racing through an unlocked proxy still make one account', async () => {
		setToken('github', 'gho_saved');
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const cookie = { cookie: cookieOf(await unlock(TAILNET_PEER, code)) };

		const results = await Promise.all([
			claim('/api/auth/adopt', { provider: 'github' }, cookie),
			claim('/api/auth/adopt', { provider: 'github' }, cookie)
		]);

		expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
	});

	test('a signed-out sign-in for an existing account is not subject to the lock', async () => {
		await createOwnerAccount();

		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const response = await claim('/api/auth/device', { provider: 'github' });

		expect(response.status).toBe(200);
	});
});
