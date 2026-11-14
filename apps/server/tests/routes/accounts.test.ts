import { describe, expect, jest, spyOn, test } from 'bun:test';
import { localApp as app } from '../helpers/local-app';
import { findAdmin } from '../../src/accounts/account-store';
import { getToken } from '../../src/forge/tokens';
import { useFakeClock } from '../helpers/fake-clock';
import {
	answerForge,
	deviceCodeAnswer,
	forgeCalls,
	tokenAnswer,
	useFakeForges,
	userAnswer
} from '../helpers/fake-forge-oauth';

useFakeForges();
useFakeClock();

const POLL_INTERVAL_MS = 5000;

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
	return app.request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
}

/** The `name=value` of the session cookie a response set, to send back. */
function sessionCookie(response: Response): string {
	return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

/** Starts a GitHub sign-in as the user `login` (whose forge id is `userId`) and finishes it, returning the poll response. */
async function signInWithGithub(login: string, headers: Record<string, string> = {}, userId = 7): Promise<Response> {
	answerForge('github.com/login/device/code', deviceCodeAnswer());
	answerForge('github.com/login/oauth/access_token', tokenAnswer({ access_token: `gho_${login}` }));
	answerForge('api.github.com/user', userAnswer(userId, login));

	const started = await (await post('/api/auth/device', { provider: 'github' }, headers)).json();

	jest.advanceTimersByTime(POLL_INTERVAL_MS);

	return app.request(`/api/auth/device/${started.attemptId}`, { headers });
}

describe('POST /api/auth/device', () => {
	test('answers with the code, page, interval and expiry the person needs', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const response = await post('/api/auth/device', { provider: 'github' });
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(Object.keys(body).sort()).toEqual(['attemptId', 'expiresAt', 'interval', 'userCode', 'verificationUri']);
		expect(body.userCode).toBe('ABCD-1234');
	});

	test('says which forge is not set up when it has no client id', async () => {
		delete process.env.RECODER_GITHUB_CLIENT_ID;

		const response = await post('/api/auth/device', { provider: 'github' });

		expect(response.status).toBe(400);

		expect(await response.json()).toEqual({
			error: 'Sign in with github is not set up on this server.',
			kind: 'unconfigured'
		});
	});

	test.each(['localhost', '127.0.0.1', '169.254.169.254', 'gitlab.localhost:8443', 'https://bad host/'])(
		'refuses the GitLab host %p',
		async (host) => {
			const response = await post('/api/auth/device', { provider: 'gitlab', host });

			expect(response.status).toBe(400);
			expect(forgeCalls()).toHaveLength(0);
		}
	);

	test('a self-managed GitLab host is asked at its own address', async () => {
		answerForge('git.acme.test/oauth/authorize_device', deviceCodeAnswer({ verification_uri: '/oauth/device' }));

		const response = await post('/api/auth/device', { provider: 'gitlab', host: 'https://Git.Acme.test/' });

		expect((await response.json()).verificationUri).toBe('https://git.acme.test/oauth/device');
	});

	test('refuses an untrusted origin', async () => {
		const response = await post('/api/auth/device', { provider: 'github' }, { origin: 'https://evil.example' });

		expect(response.status).toBe(403);
	});

	test('a forge that fails reports it without the forge’s own words', async () => {
		answerForge('github.com/login/device/code', { status: 500, body: { error: 'secret detail gho_leak' } });

		const response = await post('/api/auth/device', { provider: 'github' });

		expect(response.status).toBe(502);
		expect(JSON.stringify(await response.json())).not.toContain('gho_leak');
	});
});

describe('GET /api/auth/device/:attemptId', () => {
	test('signed-in sets an HttpOnly Lax cookie and returns the account, then the cookie signs the person in', async () => {
		const response = await signInWithGithub('octocat');
		const body = await response.json();

		expect(body.state).toBe('signed-in');
		expect(body.account).toMatchObject({ id: 'owner', forges: [{ provider: 'github', login: 'octocat' }] });
		expect(response.headers.get('set-cookie')).toMatch(/^recoder_session=[\w-]{43}; .*HttpOnly; .*SameSite=Lax/);
		expect(response.headers.get('set-cookie')).not.toContain('Secure');

		const me = await (await app.request('/api/auth/me', { headers: { cookie: sessionCookie(response) } })).json();

		expect(me.account.name).toBe('Name of octocat');
		expect(getToken('github')).toBe('gho_octocat');
	});

	test('the cookie is Secure when the request came over https, directly or through a proxy', async () => {
		const direct = await app.request('https://api.test/api/auth/logout', { method: 'POST' });
		const proxied = await post('/api/auth/logout', {}, { 'x-forwarded-proto': 'https' });

		expect(direct.headers.get('set-cookie')).toContain('Secure');
		expect(proxied.headers.get('set-cookie')).toContain('Secure');
	});

	test('pending leaves the cookie unset', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());
		answerForge('github.com/login/oauth/access_token', tokenAnswer({ error: 'authorization_pending' }));

		const started = await (await post('/api/auth/device', { provider: 'github' })).json();

		jest.advanceTimersByTime(POLL_INTERVAL_MS);

		const response = await app.request(`/api/auth/device/${started.attemptId}`);

		expect(await response.json()).toEqual({ state: 'pending' });
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	test('a stranger signs in as a member once the server has an account, and the first token stays the connection', async () => {
		await signInWithGithub('octocat');

		const response = await signInWithGithub('mallory', {}, 8);

		expect(await response.json()).toMatchObject({ state: 'signed-in', account: { role: 'member' } });
		expect(getToken('github')).toBe('gho_octocat');
		expect((await findAdmin())?.forges[0].login).toBe('octocat');
	});

	test('signed in, a second forge links to the account', async () => {
		const first = await signInWithGithub('octocat');
		const cookie = { cookie: sessionCookie(first) };

		answerForge('gitlab.com/oauth/authorize_device', deviceCodeAnswer());
		answerForge('gitlab.com/oauth/token', tokenAnswer({ access_token: 'glpat_linked' }));
		answerForge('gitlab.com/api/v4/user', userAnswer(99, 'tanuki'));

		const started = await (await post('/api/auth/device', { provider: 'gitlab' }, cookie)).json();

		jest.advanceTimersByTime(POLL_INTERVAL_MS);

		const linked = await (await app.request(`/api/auth/device/${started.attemptId}`, { headers: cookie })).json();

		expect(linked.account.forges.map((forge: { login: string }) => forge.login)).toEqual(['octocat', 'tanuki']);
		expect(getToken('gitlab')).toBe('glpat_linked');
	});
});

describe('POST /api/auth/logout', () => {
	test('ends the session so its cookie stops working, and clears the cookie', async () => {
		const signedIn = await signInWithGithub('octocat');
		const cookie = sessionCookie(signedIn);
		const response = await post('/api/auth/logout', {}, { cookie });

		expect(response.headers.get('set-cookie')).toMatch(/recoder_session=;/);
		expect((await (await app.request('/api/repos', { headers: { cookie } })).json()).kind).toBe('signed-out');
	});
});

describe('POST /api/auth/token', () => {
	test('pasting a token while the server has no account creates the account and signs in', async () => {
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const ghAuth = await import('../../src/forge/gh');
		const check = spyOn(ghAuth, 'ghAuth').mockResolvedValue({ authenticated: true, user: 'octocat' });

		try {
			const response = await post('/api/auth/token', { provider: 'github', token: 'ghp_pasted' });

			expect(response.status).toBe(200);
			expect(sessionCookie(response)).toMatch(/^recoder_session=/);
			expect((await findAdmin())?.forges[0].login).toBe('octocat');
			expect(getToken('github')).toBe('ghp_pasted');
		} finally {
			check.mockRestore();
		}
	});
});

describe('secrets', () => {
	test('no token, device code or refresh token appears in a failure response or the log', async () => {
		const logged: unknown[][] = [];
		const log = spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args));

		try {
			answerForge('github.com/login/device/code', deviceCodeAnswer());

			answerForge(
				'github.com/login/oauth/access_token',
				tokenAnswer({ access_token: 'gho_secret', refresh_token: 'refresh-secret' })
			);

			answerForge('api.github.com/user', { status: 500, body: { message: 'boom gho_secret' } });

			const started = await (await post('/api/auth/device', { provider: 'github' })).json();

			jest.advanceTimersByTime(POLL_INTERVAL_MS);

			const response = await app.request(`/api/auth/device/${started.attemptId}`);
			const text = JSON.stringify([await response.json(), logged, forgeCalls().map((call) => call.url)]);

			expect(text).toContain('failed');
			expect(text).not.toMatch(/gho_secret|refresh-secret|device-secret/);
		} finally {
			log.mockRestore();
		}
	});
});
