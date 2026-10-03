import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupFixtures, fixture, now, tokens, until } from './chatgpt-fixture';

afterEach(cleanupFixtures);

test('device OAuth returns only public login fields and persists credentials with restrictive permissions', async () => {
	const f = fixture({ authenticated: false });
	const [connection, concurrent] = await Promise.all([f.provider.connect(), f.provider.connect()]);

	expect(connection).toEqual(concurrent);

	expect(connection.login).toEqual({
		verificationUrl: 'https://auth.openai.com/codex/device',
		userCode: 'TEST-CODE',
		expiresAt: now + 15 * 60_000
	});

	expect(JSON.stringify(connection)).not.toContain('private-device-id');
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]!.body.client_id).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
	await f.auth.status();
	expect(f.calls).toHaveLength(1);
	f.advance(5000);

	expect(await f.provider.status()).toMatchObject({
		authenticated: true,
		email: 'tester@example.test',
		planType: 'plus'
	});

	const poll = f.calls.find((call) => call.url.endsWith('/deviceauth/token'))!;

	expect(poll.body).toEqual({ device_auth_id: 'private-device-id', user_code: 'TEST-CODE' });

	const exchange = f.calls.find((call) => call.url.endsWith('/oauth/token'))!;

	expect(exchange.body).toMatchObject({
		grant_type: 'authorization_code',
		code: 'private-code',
		code_verifier: 'private-verifier',
		redirect_uri: 'https://auth.openai.com/deviceauth/callback'
	});

	expect(statSync(f.file).mode & 0o777).toBe(0o600);
	expect(f.saved()?.refreshToken).toBe('private-refresh-new');

	const reopened = f.reopen();

	expect((await reopened.status()).authenticated).toBe(true);

	const publicData = JSON.stringify(await reopened.status());

	for (const secret of ['private-refresh', 'private-code', 'private-verifier', 'accessToken', 'account-test'])
		expect(publicData).not.toContain(secret);
});

test.each([403, 404])('device polling treats HTTP %s as pending, then succeeds', async (status) => {
	let pending = true;

	const f = fixture({
		authenticated: false,
		handler: (call) => (call.url.endsWith('/deviceauth/token') && pending ? new Response('', { status }) : undefined)
	});

	await f.provider.connect();
	f.advance(5000);
	expect((await f.auth.status()).login?.userCode).toBe('TEST-CODE');
	pending = false;
	f.advance(5000);
	expect((await f.auth.status()).authenticated).toBe(true);
});

test('pending device login expires and cancellation prevents subsequent polling', async () => {
	const f = fixture({ authenticated: false });

	await f.provider.connect();
	f.advance(15 * 60_000);
	expect(await f.auth.status()).toMatchObject({ authenticated: false, error: expect.stringContaining('expired') });
	expect(f.calls).toHaveLength(1);
	await f.provider.connect();
	await f.provider.disconnect();
	f.advance(5000);
	expect((await f.auth.status()).login).toBeUndefined();
	expect(f.calls.filter((call) => call.url.endsWith('/deviceauth/token'))).toHaveLength(0);
});

test('disconnect during an in-flight OAuth exchange cannot restore credentials', async () => {
	let release!: (response: Response) => void;

	const f = fixture({
		authenticated: false,
		handler: (call) =>
			call.url.endsWith('/oauth/token')
				? new Promise<Response>((resolve) => {
						release = resolve;
					})
				: undefined
	});

	await f.provider.connect();
	f.advance(5000);

	const polling = f.auth.status();

	await until(() => !!release);
	await f.provider.disconnect();
	release(Response.json(tokens()));
	await polling;
	expect(f.saved()).toBeNull();
	expect((await f.provider.status()).authenticated).toBe(false);
});

test('device errors do not expose provider bodies containing credentials', async () => {
	const f = fixture({
		authenticated: false,
		handler: (call) =>
			call.url.endsWith('/deviceauth/usercode')
				? Response.json({ access_token: 'private-token', error: 'private-token' }, { status: 500 })
				: undefined
	});

	await expect(f.provider.connect()).rejects.toThrow('HTTP 500');

	try {
		await f.provider.connect();
	} catch (error) {
		expect(String(error)).not.toContain('private-token');
	}
});

test('Recoder-owned legacy login migrates once; disconnect never resurrects it', async () => {
	const f = fixture({ authenticated: false });

	mkdirSync(join(f.directory, 'codex'));

	writeFileSync(
		join(f.directory, 'codex', 'auth.json'),
		JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: 'ignore-this', tokens: tokens() })
	);

	expect((await f.provider.status()).authenticated).toBe(true);
	expect(statSync(f.file).mode & 0o777).toBe(0o600);
	expect(readFileSync(f.file, 'utf8')).not.toContain('ignore-this');
	await f.provider.disconnect();
	expect((await f.reopen().status()).authenticated).toBe(false);
});
