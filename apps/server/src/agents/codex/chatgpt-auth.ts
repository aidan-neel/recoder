import type { CodexConnection } from '@recoder/shared';
import { serverDataDir } from '../../util/data-dir';
import { LlmError } from '../../models/llm';
import {
	VERIFICATION_URL,
	exchangeAuthorization,
	pollDeviceCode,
	readBody,
	requestDeviceCode,
	tokenRequest,
	type DeviceCode,
	type IssuerRequest
} from './chatgpt-oauth';
import { credentialsPath, readCredentials, writeCredentials } from './chatgpt-store';
import { credentialsFromTokens, refreshFailure, type Credentials } from './chatgpt-tokens';

/** The ChatGPT backend. Only fixed paths under it ever receive the login. */
const API = 'https://chatgpt.com/backend-api';
const LOGIN_LIFETIME_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Refresh credentials this long before they expire. */
const REFRESH_MARGIN_MS = 60_000;

export type ChatGptFetch = (url: string, init?: RequestInit) => Promise<Response>;

type DeviceLogin = NonNullable<CodexConnection['login']> & DeviceCode & { nextPollAt: number };

/**
 * Refresh tokens are single-use: two refreshes with the same token make OpenAI
 * reject the second, and a rejection used to delete the login the first one
 * just saved. One in-flight refresh per credentials file, shared across
 * instances so `bun --hot` reloads (a new instance each) cannot race.
 */
const sharedRefreshes: Map<string, Promise<unknown>> = ((
	globalThis as Record<string, unknown>
).__recoderChatGptRefreshes ??= new Map()) as Map<string, Promise<unknown>>;

/** Bound a caller's wait without cancelling a refresh shared by other requests. */
async function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();

	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);

		signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/** Request headers that carry the ChatGPT login to the fixed backend. */
function chatGptHeaders(base: HeadersInit | undefined, credentials: Credentials): Headers {
	const headers = new Headers(base);

	headers.set('authorization', `Bearer ${credentials.accessToken}`);
	headers.set('ChatGPT-Account-Id', credentials.accountId);
	headers.set('user-agent', 'recoder/0.1.0');
	headers.set('originator', 'recoder');
	if (credentials.residency) headers.set('x-openai-internal-codex-residency', credentials.residency);

	return headers;
}

/** Recoder-owned credentials and device OAuth lifecycle; no CLI or localhost callback server. */
export class ChatGptAuth {
	private login?: DeviceLogin;
	private loginError?: string;
	private loginStarting?: Promise<CodexConnection>;
	private polling?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private lifecycle = new AbortController();
	private generation = 0;

	/** Issuer calls go through `request`, so they share its lifecycle, timeout and error message. */
	private readonly issuer: IssuerRequest = (url, init) => this.request(url, init);

	constructor(
		private readonly http: ChatGptFetch = (url, init) => fetch(url, init),
		private readonly dataDir: () => string = serverDataDir,
		private readonly now: () => number = Date.now
	) {}

	private read(): Credentials | null {
		return readCredentials(this.dataDir(), this.now());
	}

	private persist(credentials: Credentials | null): void {
		writeCredentials(this.dataDir(), credentials);
	}

	private async request(url: string, init: RequestInit = {}): Promise<Response> {
		try {
			return await this.http(url, {
				...init,
				redirect: 'error',
				signal: AbortSignal.any([
					this.lifecycle.signal,
					AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					...(init.signal ? [init.signal] : [])
				]),
				headers: { 'user-agent': 'recoder/0.1.0', ...init.headers }
			});
		} catch {
			throw new LlmError(0, 'Could not reach ChatGPT. Check the server connection and retry.');
		}
	}

	private snapshot(): CodexConnection {
		const credentials = this.read();

		return {
			available: true,
			authenticated: Boolean(credentials),
			email: credentials?.email ?? null,
			planType: credentials?.planType ?? null,
			...(this.loginError ? { error: this.loginError } : {}),
			...(this.login
				? {
						login: {
							verificationUrl: this.login.verificationUrl,
							userCode: this.login.userCode,
							expiresAt: this.login.expiresAt
						}
					}
				: {})
		};
	}

	async status(): Promise<CodexConnection> {
		await this.pollLogin();

		return this.snapshot();
	}

	async connect(): Promise<CodexConnection> {
		if (this.loginStarting) return this.loginStarting;

		const work = this.beginLogin();

		this.loginStarting = work;

		try {
			return await work;
		} finally {
			if (this.loginStarting === work) this.loginStarting = undefined;
		}
	}

	private async beginLogin(): Promise<CodexConnection> {
		const current = this.generation;
		const status = await this.status();

		if (status.authenticated || status.login) return status;

		const code = await requestDeviceCode(this.issuer);

		if (current !== this.generation) throw new LlmError(0, 'ChatGPT sign-in cancelled.');

		this.login = {
			verificationUrl: VERIFICATION_URL,
			...code,
			expiresAt: this.now() + LOGIN_LIFETIME_MS,
			nextPollAt: this.now() + code.intervalMs
		};

		this.loginError = undefined;
		this.schedulePoll();

		return this.snapshot();
	}

	private schedulePoll(): void {
		clearTimeout(this.timer);
		if (!this.login) return;

		const delay = Math.max(1, Math.min(this.login.nextPollAt, this.login.expiresAt) - this.now());

		this.timer = setTimeout(() => {
			void this.pollLogin();
		}, delay);

		this.timer.unref?.();
	}

	private async pollLogin(): Promise<void> {
		if (this.polling) return this.polling;
		if (!this.login) return;

		if (this.now() >= this.login.expiresAt) {
			this.login = undefined;
			this.loginError = 'ChatGPT sign-in expired. Start sign-in again.';
			clearTimeout(this.timer);

			return;
		}

		if (this.now() < this.login.nextPollAt) return;

		const login = this.login;
		const current = this.generation;

		const work = this.completeLogin(login)
			.catch((error) => {
				if (current !== this.generation) return;
				this.loginError = error instanceof LlmError ? error.message : 'Could not complete ChatGPT sign-in. Try again.';
			})
			.finally(() => {
				if (current !== this.generation) return;
				this.polling = undefined;
				if (this.login === login) login.nextPollAt = this.now() + login.intervalMs;
				this.schedulePoll();
			});

		this.polling = work;

		return work;
	}

	/**
	 * Poll the issuer once and, when the user has approved, exchange the
	 * authorization code for tokens. The code is single-use, so the pending
	 * login is cleared before the exchange: a failed exchange needs a new sign-in.
	 */
	private async completeLogin(login: DeviceLogin): Promise<void> {
		const current = this.generation;

		const response = await pollDeviceCode(this.issuer, login);

		if (current !== this.generation) {
			await response.body?.cancel();

			return;
		}

		if (!response.ok) return this.pollPending(login, response);

		this.login = undefined;

		const tokens = credentialsFromTokens(await exchangeAuthorization(this.issuer, response), this.now());

		if (current !== this.generation) return;
		if (this.now() >= login.expiresAt) throw new LlmError(401, 'ChatGPT sign-in expired. Start sign-in again.');
		this.persist(tokens);
		this.loginError = undefined;
	}

	/**
	 * A poll the issuer did not approve. 403 and 404 mean the user has not
	 * finished yet, 429 slows polling down, other client errors end the login.
	 */
	private async pollPending(login: DeviceLogin, response: Response): Promise<void> {
		await response.body?.cancel();

		if (response.status === 403 || response.status === 404) {
			this.loginError = undefined;

			return;
		}

		if (response.status === 429) {
			login.intervalMs += 5000;

			return;
		}

		if (response.status < 500) this.login = undefined;
		throw new LlmError(
			response.status,
			`Could not check ChatGPT sign-in (HTTP ${response.status}). ${this.login ? 'Retrying...' : 'Start sign-in again.'}`
		);
	}

	/** Renew `stale` credentials, sharing one in-flight refresh per credentials file. */
	private async refresh(stale: Credentials): Promise<Credentials> {
		const stored = this.read();

		if (!stored) throw new LlmError(401, 'Sign in to ChatGPT to use this model.');
		if (stored.accessToken !== stale.accessToken) return stored;

		const file = credentialsPath(this.dataDir());
		const inFlight = sharedRefreshes.get(file) as Promise<Credentials> | undefined;

		if (inFlight) return inFlight;

		const work = this.runRefresh(stored, this.generation);

		sharedRefreshes.set(file, work);

		try {
			return await work;
		} finally {
			if (sharedRefreshes.get(file) === work) sharedRefreshes.delete(file);
		}
	}

	private async runRefresh(stored: Credentials, current: number): Promise<Credentials> {
		const response = await tokenRequest(this.issuer, {
			grant_type: 'refresh_token',
			refresh_token: stored.refreshToken
		});

		if (current !== this.generation) {
			await response.body?.cancel();
			throw new LlmError(401, 'ChatGPT connection changed. Try again.');
		}

		if (!response.ok) {
			const { dead, code } = await refreshFailure(response);

			if (dead) return this.endRejectedLogin(stored, response.status, code);

			throw new LlmError(response.status, `ChatGPT token refresh failed (HTTP ${response.status}). Try again.`);
		}

		const tokens = credentialsFromTokens(await readBody(response), this.now(), stored);

		if (current !== this.generation) throw new LlmError(401, 'ChatGPT connection changed. Try again.');
		this.persist(tokens);
		this.loginError = undefined;

		return tokens;
	}

	/**
	 * Clear a login whose refresh token was rejected. Another instance may have
	 * rotated the token meanwhile; their save wins and is returned instead.
	 */
	private endRejectedLogin(stored: Credentials, status: number, code: string | undefined): Credentials {
		const latest = this.read();

		if (latest && latest.refreshToken !== stored.refreshToken) return latest;

		console.warn(
			`[recoder] ChatGPT sign-in cleared: token refresh rejected (HTTP ${status}${code ? `, ${code}` : ''})`
		);

		this.persist(null);
		this.loginError = 'Your ChatGPT sign-in expired. Sign in again.';
		throw new LlmError(401, this.loginError);
	}

	/**
	 * Fetch from the ChatGPT backend with the login attached. Fixed origin and
	 * paths only, so configured API endpoints can never receive OAuth
	 * credentials. A 401 refreshes once and retries; a 401 right after a
	 * successful refresh is about this request, not the login, so the login stays.
	 */
	async authorizedFetch(
		path: '/codex/responses' | '/codex/models?client_version=0.153.4' | '/wham/usage',
		init: RequestInit = {}
	): Promise<Response> {
		const signal = AbortSignal.any([this.lifecycle.signal, init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
		let credentials = this.read();

		if (!credentials) throw new LlmError(401, this.loginError ?? 'Sign in to ChatGPT to use this model.');

		const current = this.generation;

		if (credentials.expiresAt <= this.now() + REFRESH_MARGIN_MS)
			credentials = await waitFor(this.refresh(credentials), signal);

		for (let attempt = 0; attempt < 2; attempt++) {
			signal.throwIfAborted();
			if (current !== this.generation) throw new LlmError(401, 'ChatGPT connection changed. Try again.');

			const headers = chatGptHeaders(init.headers, credentials);
			let response: Response;

			try {
				response = await this.http(`${API}${path}`, { ...init, signal, headers, redirect: 'error' });
			} catch {
				signal.throwIfAborted();
				throw new LlmError(0, 'Could not reach ChatGPT. Check the server connection and retry.');
			}

			if (response.status !== 401) return response;
			await response.body?.cancel();
			if (attempt === 0) credentials = await waitFor(this.refresh(credentials), signal);
			else throw new LlmError(502, 'ChatGPT rejected this request right after renewing the sign-in. Try again.');
		}

		throw new LlmError(401, 'Sign in to ChatGPT to use this model.');
	}

	/** Sign out. Saves an explicit empty store so the legacy session is never re-imported. */
	disconnect(): void {
		this.persist(null);
		this.stop();
		this.loginError = undefined;
	}

	stop(): void {
		this.generation++;
		this.lifecycle.abort();
		this.lifecycle = new AbortController();
		clearTimeout(this.timer);
		this.login = undefined;
		this.polling = undefined;
		this.loginStarting = undefined;
	}
}
