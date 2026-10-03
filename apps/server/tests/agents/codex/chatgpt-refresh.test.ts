import { afterEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import {
	cancellableCompletion,
	cleanupFixtures,
	fixture,
	input,
	now,
	storedCredentials,
	token,
	tokens,
	until
} from './chatgpt-fixture';

afterEach(cleanupFixtures);

test('concurrent expired-token requests share one refresh and save token rotation', async () => {
	const f = fixture({ expired: true });

	await Promise.all([f.provider.complete(input), f.provider.complete(input), f.provider.models()]);
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);

	for (const call of f.calls.filter((call) => call.url.includes('chatgpt.com'))) {
		expect(call.headers.get('authorization')).toBe(`Bearer ${token('-new')}`);
		expect(call.headers.get('ChatGPT-Account-Id')).toBe('account-test');
		expect(call.init.redirect).toBe('error');
	}

	expect(f.saved()?.refreshToken).toBe('private-refresh-new');
});

test('a 401 refreshes once and retries the same request without API fallback', async () => {
	const f = fixture({
		handler: (call) =>
			call.url.endsWith('/responses') && call.headers.get('authorization') === `Bearer ${token()}`
				? new Response('', { status: 401 })
				: undefined
	});

	expect(await f.provider.complete(input)).toBe('{"findings":[]}');
	expect(f.calls.filter((call) => call.url.endsWith('/responses'))).toHaveLength(2);
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);
	expect(f.calls.every((call) => !call.url.includes('must-not-receive-oauth'))).toBe(true);
	expect(f.calls.every((call) => call.headers.get('authorization') !== `Bearer ${input.apiKey}`)).toBe(true);
});

test('a 401 after a fresh refresh fails the request but keeps the login', async () => {
	const f = fixture({
		handler: (call) => (call.url.endsWith('/responses') ? new Response('', { status: 401 }) : undefined)
	});

	await expect(f.provider.complete(input)).rejects.toThrow('right after renewing the sign-in');
	expect(f.calls.filter((call) => call.url.endsWith('/oauth/token'))).toHaveLength(1);
	expect((await f.provider.status()).authenticated).toBe(true);
});

test.each([
	[401, { error: 'invalid_token' }, false],
	[400, { error: 'invalid_grant' }, false],
	[400, { error: { code: 'refresh_token_reused' } }, false],
	[400, { error: 'private-refresh' }, true],
	[403, { error: 'private-refresh' }, true],
	[500, { error: 'private-refresh' }, true]
])('refresh HTTP %s %j keeps the login only when the failure is temporary', async (status, body, kept) => {
	const f = fixture({
		expired: true,
		handler: (call) => (call.url.endsWith('/oauth/token') ? Response.json(body, { status }) : undefined)
	});

	const error = await f.provider.complete(input).then(
		() => null,
		(e: Error) => e
	);

	expect(error?.message).toContain(kept ? `HTTP ${status}` : 'Sign in again');
	expect(error?.message).not.toContain('private-refresh');
	expect(Boolean(f.saved())).toBe(kept);
	expect(f.calls.some((call) => call.url.endsWith('/responses'))).toBe(false);
});

test('a rejected refresh keeps tokens another instance rotated meanwhile', async () => {
	let rotated = () => {};

	const f = fixture({
		expired: true,
		handler: (call) => {
			if (!call.url.endsWith('/oauth/token')) return undefined;
			rotated();

			return Response.json({ error: 'refresh_token_reused' }, { status: 400 });
		}
	});

	rotated = () =>
		writeFileSync(
			f.file,
			JSON.stringify({
				version: 1,
				credentials: storedCredentials(token('-other'), 'private-refresh-other', now + 3600_000)
			})
		);

	await f.provider.complete(input);
	expect(f.saved()?.refreshToken).toBe('private-refresh-other');

	expect(f.calls.find((call) => call.url.endsWith('/responses'))?.headers.get('authorization')).toBe(
		`Bearer ${token('-other')}`
	);
});

test('two instances on one credentials file share a single refresh', async () => {
	let refreshes = 0;

	const f = fixture({
		expired: true,
		handler: async (call) => {
			if (!call.url.endsWith('/oauth/token')) return undefined;
			refreshes++;
			await Bun.sleep(5);

			return Response.json(tokens('-new'));
		}
	});

	await Promise.all([f.provider.complete(input), f.reopen().complete(input)]);
	expect(refreshes).toBe(1);
});

test('refresh retains the previous refresh token when rotation is omitted', async () => {
	const f = fixture({
		expired: true,
		handler: (call) =>
			call.url.endsWith('/oauth/token') ? Response.json({ access_token: token('-new'), expires_in: 3600 }) : undefined
	});

	await f.provider.complete(input);
	expect(f.saved()?.refreshToken).toBe('private-refresh');
});

test('a caller deadline also bounds waiting for a shared token refresh', async () => {
	let release!: (response: Response) => void;

	const f = fixture({
		expired: true,
		handler: (call) =>
			call.url.endsWith('/oauth/token')
				? new Promise<Response>((resolve) => {
						release = resolve;
					})
				: undefined
	});

	const { controller, outcome } = cancellableCompletion(f.provider);

	await until(() => !!release);
	controller.abort();
	expect(await outcome).toContain('cancelled');
	expect(f.calls.some((call) => call.url.endsWith('/responses'))).toBe(false);
	await f.provider.disconnect();
	release(Response.json(tokens()));
	await new Promise((resolve) => setTimeout(resolve, 1));
	expect(f.saved()).toBeNull();
});
