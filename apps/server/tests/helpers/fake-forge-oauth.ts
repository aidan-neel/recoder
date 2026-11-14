import { afterEach, beforeEach, spyOn } from 'bun:test';
import type { ProviderAuth } from '@recoder/shared';
import { recordSignIn } from '../../src/accounts/account-store';
import * as authStatus from '../../src/forge/auth-status';
import { collection } from '../../src/storage/backend';
import { setGitlabHost } from '../../src/forge/gitlab-host';
import { clearToken } from '../../src/forge/tokens';
import { restoreEnvAfterEach } from './env';

/** One call the code under test made to a forge. */
export interface ForgeCall {
	method: string;
	url: string;
	form: Record<string, string>;
	authorization: string | null;
}

export type ForgeAnswer = { status?: number; body: unknown } | Error;

const calls: ForgeCall[] = [];
const answers = new Map<string, ForgeAnswer[]>();
const realFetch = globalThis.fetch;

const signedOut = (provider: 'github' | 'gitlab'): ProviderAuth => ({
	provider,
	available: true,
	authenticated: false,
	user: null
});

let forgeStatus = { github: signedOut('github'), gitlab: signedOut('gitlab') };

/** Makes the server's forge status report these users as already connected (a saved token or a signed-in CLI). */
export function connectForges(users: { github?: string; gitlab?: string }): void {
	forgeStatus = {
		github: users.github ? { ...signedOut('github'), authenticated: true, user: users.github } : signedOut('github'),
		gitlab: users.gitlab ? { ...signedOut('gitlab'), authenticated: true, user: users.gitlab } : signedOut('gitlab')
	};
}

/** Every forge call made since the test began, oldest first. */
export function forgeCalls(): ForgeCall[] {
	return calls;
}

/** Queues the answers a forge URL (`host/path`, no scheme) gives, one per call; the last repeats. */
export function answerForge(hostAndPath: string, ...queued: ForgeAnswer[]): void {
	answers.set(hostAndPath, queued);
}

/**
 * For a test file: the sign-in client ids are set (no secrets, so forges sign in by device code), no forge is connected (`connectForges` changes that), `fetch` is a stub that answers from `answerForge` and fails on
 * any URL nothing answers, and each test leaves no account, session, token or host behind.
 */
export function useFakeForges(): void {
	restoreEnvAfterEach([
		'RECODER_GITHUB_CLIENT_ID',
		'RECODER_GITLAB_CLIENT_ID',
		'RECODER_GITHUB_CLIENT_SECRET',
		'RECODER_GITLAB_CLIENT_SECRET',
		'RECODER_PUBLIC_URL',
		'RECODER_API_TOKEN'
	]);

	beforeEach(() => {
		process.env.RECODER_GITHUB_CLIENT_ID = 'github-client';
		process.env.RECODER_GITLAB_CLIENT_ID = 'gitlab-client';
		delete process.env.RECODER_GITHUB_CLIENT_SECRET;
		delete process.env.RECODER_GITLAB_CLIENT_SECRET;
		delete process.env.RECODER_PUBLIC_URL;
		calls.length = 0;
		answers.clear();
		connectForges({});
		spyOn(authStatus, 'forgeAuthStatus').mockImplementation(async () => forgeStatus);
		globalThis.fetch = fakeFetch as typeof fetch;
	});

	afterEach(async () => {
		globalThis.fetch = realFetch;
		spyOn(authStatus, 'forgeAuthStatus').mockRestore();
		await collection('accounts').clear();
		await collection('sessions').clear();
		await collection('oauth_redirects').clear();
		clearToken('github');
		clearToken('gitlab');
		setGitlabHost(null);
	});
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url = new URL(input instanceof Request ? input.url : input);
	const headers = new Headers(init?.headers);
	const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};

	calls.push({
		method: init?.method ?? 'GET',
		url: url.href,
		form: body,
		authorization: headers.get('authorization')
	});

	const queue = answers.get(url.host + url.pathname);
	const answer = queue && (queue.length > 1 ? queue.shift() : queue[0]);

	if (!answer) throw new Error(`No fake forge answer for ${url.host}${url.pathname}`);
	if (answer instanceof Error) throw answer;

	return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
}

/** A device code answer in the shape both forges send. */
export function deviceCodeAnswer(overrides: Record<string, unknown> = {}): ForgeAnswer {
	return {
		body: {
			device_code: 'device-secret-1',
			user_code: 'ABCD-1234',
			verification_uri: 'https://github.com/login/device',
			expires_in: 900,
			interval: 5,
			...overrides
		}
	};
}

/** The access token answer a code exchange gives. */
export function codeExchangeAnswer(accessToken = 'gho_redirect'): ForgeAnswer {
	return { body: { access_token: accessToken, token_type: 'bearer' } };
}

/** A token endpoint answer: the error code a pending state carries, or an access token. */
export function tokenAnswer(overrides: Record<string, unknown>, status = 200): ForgeAnswer {
	return { status, body: overrides };
}

/** The profile both forges' user endpoints return. */
export function userAnswer(id: number, login: string): ForgeAnswer {
	return {
		body: { id, login, username: login, name: `Name of ${login}`, avatar_url: `https://avatars.test/${login}` }
	};
}

/** Gives the server its account: GitHub user 7, `octocat`. */
export async function createOwnerAccount(): Promise<void> {
	await recordSignIn({
		target: { provider: 'github', host: null },
		user: { remoteId: '7', login: 'octocat', name: null, avatarUrl: null },
		token: { refreshToken: null, expiresAt: null },
		linkTo: null
	});
}
