import { describe, expect, test } from 'bun:test';
import { findAdmin } from '../../src/accounts/account-store';
import { DeviceSignIns, type AttemptResult } from '../../src/accounts/device-sign-ins';
import { getToken } from '../../src/forge/tokens';
import {
	answerForge,
	deviceCodeAnswer,
	type ForgeAnswer,
	forgeCalls,
	tokenAnswer,
	useFakeForges,
	userAnswer
} from '../helpers/fake-forge-oauth';

useFakeForges();

const GITHUB = { provider: 'github', host: null } as const;
const GITLAB = { provider: 'gitlab', host: null } as const;
const SECONDS = 1000;

/** Sign-ins on a clock the test moves, so the forge's polling interval is crossed without waiting. */
function signInsOnClock(): { signIns: DeviceSignIns; advance: (seconds: number) => void } {
	let now = Date.parse('2026-11-13T10:00:00Z');

	return { signIns: new DeviceSignIns(() => now), advance: (seconds) => (now += seconds * SECONDS) };
}

/** A GitHub sign-in the forge answers `tokenAnswers` to, one per poll, and the clock it runs on. */
async function openGithubAttempt(...tokenAnswers: ForgeAnswer[]) {
	answerForge('github.com/login/device/code', deviceCodeAnswer());
	answerForge('github.com/login/oauth/access_token', ...tokenAnswers);

	const clock = signInsOnClock();
	const { attemptId } = await clock.signIns.start(GITHUB, null);

	return { ...clock, attemptId };
}

describe('device sign-in', () => {
	test('start hands the person the code and the page to enter it on', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const { signIns } = signInsOnClock();
		const started = await signIns.start(GITHUB, null);

		expect(started).toMatchObject({
			userCode: 'ABCD-1234',
			verificationUri: 'https://github.com/login/device',
			interval: 5,
			expiresAt: '2026-11-13T10:15:00.000Z'
		});

		expect(forgeCalls()[0].form).toEqual({ client_id: 'github-client', scope: 'repo read:user read:org' });
	});

	test('does not poll the forge before its interval has passed', async () => {
		const { signIns, advance, attemptId } = await openGithubAttempt(tokenAnswer({ error: 'authorization_pending' }));

		advance(3);
		expect(await signIns.check(attemptId)).toEqual({ state: 'pending' });
		expect(forgeCalls()).toHaveLength(1);

		advance(3);
		expect(await signIns.check(attemptId)).toEqual({ state: 'pending' });
		expect(forgeCalls()).toHaveLength(2);

		expect(forgeCalls()[1].form).toEqual({
			client_id: 'github-client',
			device_code: 'device-secret-1',
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
		});
	});

	test('slow_down lengthens the interval by the forge’s new value, or five seconds when it names none', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		answerForge(
			'github.com/login/oauth/access_token',
			tokenAnswer({ error: 'slow_down', interval: 10 }),
			tokenAnswer({ error: 'slow_down' }),
			tokenAnswer({ error: 'authorization_pending' })
		);

		const { signIns, advance } = signInsOnClock();
		const { attemptId } = await signIns.start(GITHUB, null);

		advance(5);
		await signIns.check(attemptId);
		advance(9);
		await signIns.check(attemptId);
		expect(forgeCalls()).toHaveLength(2);

		advance(1);
		await signIns.check(attemptId);
		expect(forgeCalls()).toHaveLength(3);

		advance(14);
		await signIns.check(attemptId);
		expect(forgeCalls()).toHaveLength(3);

		advance(1);
		await signIns.check(attemptId);
		expect(forgeCalls()).toHaveLength(4);
	});

	test('a GitLab pending answer sent with status 400 still keeps the attempt pending', async () => {
		answerForge('gitlab.com/oauth/authorize_device', deviceCodeAnswer({ verification_uri: '/oauth/device' }));
		answerForge('gitlab.com/oauth/token', tokenAnswer({ error: 'authorization_pending' }, 400));

		const { signIns, advance } = signInsOnClock();
		const started = await signIns.start(GITLAB, null);

		advance(5);

		expect(started.verificationUri).toBe('https://gitlab.com/oauth/device');
		expect(await signIns.check(started.attemptId)).toEqual({ state: 'pending' });
	});

	test.each<[string, AttemptResult]>([
		['expired_token', { state: 'expired' }],
		['access_denied', { state: 'denied' }]
	])('%s ends the attempt', async (error, expected) => {
		const { signIns, advance, attemptId } = await openGithubAttempt(tokenAnswer({ error }));

		advance(5);

		expect(await signIns.check(attemptId)).toEqual(expected);
		expect(await signIns.check(attemptId)).toEqual(expected);
		expect(forgeCalls()).toHaveLength(2);
	});

	test('an attempt past its expiry is expired without asking the forge', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer({ expires_in: 60 }));

		const { signIns, advance } = signInsOnClock();
		const { attemptId } = await signIns.start(GITHUB, null);

		advance(61);

		expect(await signIns.check(attemptId)).toEqual({ state: 'expired' });
		expect(forgeCalls()).toHaveLength(1);
	});

	test('an unknown attempt reads as expired', async () => {
		expect(await signInsOnClock().signIns.check('no-such-attempt')).toEqual({ state: 'expired' });
	});

	test('a forge with device flow switched off fails the attempt in words that name no code', async () => {
		const { signIns, advance, attemptId } = await openGithubAttempt(tokenAnswer({ error: 'device_flow_disabled' }));

		advance(5);

		expect(await signIns.check(attemptId)).toEqual({
			state: 'failed',
			reason: 'Device flow is not enabled for this OAuth application.'
		});
	});

	test('success creates the account, makes the token the forge connection and starts a session', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		answerForge(
			'github.com/login/oauth/access_token',
			tokenAnswer({ access_token: 'gho_first', token_type: 'bearer' })
		);

		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const { signIns, advance } = signInsOnClock();
		const { attemptId } = await signIns.start(GITHUB, null);

		advance(5);

		const result = await signIns.check(attemptId);

		expect(result.state).toBe('signed-in');
		if (result.state !== 'signed-in') return;

		expect(result.signIn.session?.token).toHaveLength(43);

		expect(result.signIn.account).toMatchObject({
			name: 'Name of octocat',
			forges: [{ provider: 'github', login: 'octocat' }]
		});

		expect(getToken('github')).toBe('gho_first');
		expect(forgeCalls().at(-1)?.authorization).toBe('Bearer gho_first');
	});

	test('overlapping checks share one poll of the forge', async () => {
		const { signIns, advance, attemptId } = await openGithubAttempt(tokenAnswer({ error: 'authorization_pending' }));

		advance(5);
		await Promise.all([signIns.check(attemptId), signIns.check(attemptId), signIns.check(attemptId)]);

		expect(forgeCalls()).toHaveLength(2);
	});

	test('an unreachable forge leaves the attempt pending to retry at the next interval', async () => {
		const { signIns, advance, attemptId } = await openGithubAttempt(new Error('connect ECONNREFUSED 140.82.0.1:443'));

		advance(5);

		expect(await signIns.check(attemptId)).toEqual({ state: 'pending' });
	});
});

describe('linking and strangers', () => {
	async function signInFirstAccount(signIns: DeviceSignIns, advance: (seconds: number) => void): Promise<void> {
		answerForge('github.com/login/device/code', deviceCodeAnswer());
		answerForge('github.com/login/oauth/access_token', tokenAnswer({ access_token: 'gho_first' }));
		answerForge('api.github.com/user', userAnswer(7, 'octocat'));

		const { attemptId } = await signIns.start(GITHUB, null);

		advance(5);
		await signIns.check(attemptId);
	}

	test('signed in, a sign-in with another forge links it to the same account and starts no new session', async () => {
		const { signIns, advance } = signInsOnClock();

		await signInFirstAccount(signIns, advance);
		answerForge('gitlab.com/oauth/authorize_device', deviceCodeAnswer());

		answerForge(
			'gitlab.com/oauth/token',
			tokenAnswer({ access_token: 'glpat_second', refresh_token: 'refresh-1', expires_in: 7200 })
		);

		answerForge('gitlab.com/api/v4/user', userAnswer(99, 'tanuki'));

		const { attemptId } = await signIns.start(GITLAB, 'owner');

		advance(5);

		const result = await signIns.check(attemptId);

		expect(result.state).toBe('signed-in');
		if (result.state !== 'signed-in') return;

		expect(result.signIn.session).toBeNull();
		expect(result.signIn.account.forges.map((forge) => forge.login)).toEqual(['octocat', 'tanuki']);
		expect(getToken('gitlab')).toBe('glpat_second');
		expect(getToken('github')).toBe('gho_first');
	});

	test('signed out, another forge account signs in as a member and its token is not saved', async () => {
		const { signIns, advance } = signInsOnClock();

		await signInFirstAccount(signIns, advance);
		answerForge('github.com/login/device/code', deviceCodeAnswer());
		answerForge('github.com/login/oauth/access_token', tokenAnswer({ access_token: 'gho_stranger' }));
		answerForge('api.github.com/user', userAnswer(8, 'mallory'));

		const { attemptId } = await signIns.start(GITHUB, null);

		advance(5);

		expect(await signIns.check(attemptId)).toMatchObject({
			state: 'signed-in',
			signIn: { account: { role: 'member' } }
		});

		expect(getToken('github')).toBe('gho_first');
		expect((await findAdmin())?.forges.map((forge) => forge.login)).toEqual(['octocat']);
	});

	test('signed out, the linked forge account signs back in with a new session', async () => {
		const { signIns, advance } = signInsOnClock();

		await signInFirstAccount(signIns, advance);
		answerForge('github.com/login/oauth/access_token', tokenAnswer({ access_token: 'gho_again' }));
		answerForge('api.github.com/user', { body: { id: 7, login: 'octocat-renamed' } });

		const { attemptId } = await signIns.start(GITHUB, null);

		advance(5);

		const result = await signIns.check(attemptId);

		expect(result.state === 'signed-in' && result.signIn.session !== null).toBe(true);
		expect(getToken('github')).toBe('gho_again');
	});

	test('too many open sign-ins are refused', async () => {
		answerForge('github.com/login/device/code', deviceCodeAnswer());

		const { signIns } = signInsOnClock();

		for (let opened = 0; opened < 20; opened++) await signIns.start(GITHUB, null);

		await expect(signIns.start(GITHUB, null)).rejects.toMatchObject({ reason: 'busy' });
	});
});
