import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CodexConnection } from '@recoder/shared';
import { serverDataDir } from './data-dir';
import { LlmError } from './llm';

// Public OAuth client and device flow used by Codex/OpenCode. No client secret.
// Protocol: openai/codex, codex-rs/login/src/device_code_auth.rs.
const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const API = 'https://chatgpt.com/backend-api';
const LOGIN_LIFETIME_MS = 15 * 60_000;
export type ChatGptFetch = (url: string, init?: RequestInit) => Promise<Response>;

const credentialsSchema = z.object({
	accessToken: z.string().min(1), refreshToken: z.string().min(1),
	expiresAt: z.number().finite().positive(), accountId: z.string().min(1),
	email: z.string().nullable(), planType: z.string().nullable(),
	residency: z.string().optional()
});
type Credentials = z.infer<typeof credentialsSchema>;
const storeSchema = z.object({ version: z.literal(1), credentials: credentialsSchema.nullable() });
const tokenResponseSchema = z.object({
	access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(), expires_in: z.number().finite().positive().optional()
});

function claims(token?: string): Record<string, any> {
	if (!token) return {};
	try {
		// Metadata from a token returned by the fixed HTTPS issuer, never an
		// authorization decision based on a browser-supplied JWT.
		const value = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	} catch { return {}; }
}

function credentialsFromTokens(raw: unknown, now: number, previous?: Credentials): Credentials {
	const parsed = tokenResponseSchema.safeParse(raw);
	if (!parsed.success) throw new LlmError(502, 'ChatGPT returned an invalid token response. Sign in again.');
	const tokens = parsed.data;
	const access = claims(tokens.access_token);
	const id = claims(tokens.id_token);
	const auth = id['https://api.openai.com/auth'] ?? {};
	const accessAuth = access['https://api.openai.com/auth'] ?? {};
	const text = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && value.length > 0);
	const accountId = text(auth.chatgpt_account_id, id.chatgpt_account_id, accessAuth.chatgpt_account_id, access.chatgpt_account_id, previous?.accountId);
	const refreshToken = tokens.refresh_token ?? previous?.refreshToken;
	if (!accountId || !refreshToken) throw new LlmError(502, 'ChatGPT sign-in did not return an account and refresh token. Sign in again.');
	if (previous && accountId !== previous.accountId) throw new LlmError(401, 'ChatGPT account changed during refresh. Disconnect and sign in again.');
	const expiresAt = tokens.expires_in ? now + tokens.expires_in * 1000
		: typeof access.exp === 'number' && Number.isFinite(access.exp) ? access.exp * 1000 : now + 3600_000;
	const residency = text(accessAuth.chatgpt_compute_residency, access.chatgpt_compute_residency, previous?.residency);
	return {
		accessToken: tokens.access_token, refreshToken, expiresAt, accountId,
		email: text(id.email, access.email, access['https://api.openai.com/profile']?.email, previous?.email) ?? null,
		planType: text(auth.chatgpt_plan_type, accessAuth.chatgpt_plan_type, previous?.planType) ?? null,
		...(residency && residency !== 'no_constraint' ? { residency } : {})
	};
}

/** Bound a caller's wait without cancelling a refresh shared by other requests. */
async function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

type DeviceLogin = NonNullable<CodexConnection['login']> & {
	deviceAuthId: string; intervalMs: number; nextPollAt: number;
};

/** Recoder-owned credentials and device OAuth lifecycle; no CLI or localhost callback server. */
export class ChatGptAuth {
	private login?: DeviceLogin;
	private loginError?: string;
	private loginStarting?: Promise<CodexConnection>;
	private polling?: Promise<void>;
	private refreshing?: Promise<Credentials>;
	private timer?: ReturnType<typeof setTimeout>;
	private lifecycle = new AbortController();
	private generation = 0;

	constructor(
		private readonly http: ChatGptFetch = (url, init) => fetch(url, init),
		private readonly dataDir: () => string = serverDataDir,
		private readonly now: () => number = Date.now
	) {}

	private readJson(file: string): unknown | undefined {
		try { return JSON.parse(readFileSync(file, 'utf8')); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw new LlmError(0, 'Could not read saved ChatGPT credentials. Check the server data directory.');
		}
	}

	private read(): Credentials | null {
		const raw = this.readJson(join(this.dataDir(), 'chatgpt-auth.json'));
		if (raw !== undefined) {
			const parsed = storeSchema.safeParse(raw);
			if (!parsed.success) throw new LlmError(0, 'Saved ChatGPT credentials are invalid. Disconnect and sign in again.');
			return parsed.data.credentials;
		}
		// Migrate only the old Recoder-owned session, never ~/.codex or CODEX_HOME.
		const legacy = this.readJson(join(this.dataDir(), 'codex', 'auth.json')) as Record<string, any> | undefined;
		if (!legacy || (legacy.auth_mode && legacy.auth_mode !== 'chatgpt') || !legacy.tokens) return null;
		const tokens = credentialsFromTokens(legacy.tokens, this.now());
		this.persist(tokens);
		return tokens;
	}

	private persist(credentials: Credentials | null): void {
		const directory = this.dataDir();
		const file = join(directory, 'chatgpt-auth.json');
		const temporary = `${file}.${crypto.randomUUID()}.tmp`;
		try {
			mkdirSync(directory, { recursive: true, mode: 0o700 });
			const fd = openSync(temporary, 'wx', 0o600);
			try { writeFileSync(fd, JSON.stringify({ version: 1, credentials })); fsyncSync(fd); }
			finally { closeSync(fd); }
			renameSync(temporary, file);
		} catch { throw new LlmError(0, 'Could not save ChatGPT credentials. Check server data-directory permissions.'); }
		finally { try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ } }
	}

	private async request(url: string, init: RequestInit = {}): Promise<Response> {
		try {
			return await this.http(url, {
				...init, redirect: 'error',
				signal: AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]),
				headers: { 'user-agent': 'recoder/0.1.0', ...init.headers }
			});
		} catch {
			throw new LlmError(0, 'Could not reach ChatGPT. Check the server connection and retry.');
		}
	}

	private async json(response: Response): Promise<unknown> {
		try { return await response.json(); }
		catch { throw new LlmError(502, 'ChatGPT returned an invalid response. Try again.'); }
	}

	private snapshot(): CodexConnection {
		const credentials = this.read();
		return {
			available: true, authenticated: Boolean(credentials),
			email: credentials?.email ?? null, planType: credentials?.planType ?? null,
			...(this.loginError ? { error: this.loginError } : {}),
			...(this.login ? { login: { verificationUrl: this.login.verificationUrl, userCode: this.login.userCode, expiresAt: this.login.expiresAt } } : {})
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
		try { return await work; }
		finally { if (this.loginStarting === work) this.loginStarting = undefined; }
	}

	private async beginLogin(): Promise<CodexConnection> {
		const current = this.generation;
		const status = await this.status();
		if (status.authenticated || status.login) return status;
		const response = await this.request(`${ISSUER}/api/accounts/deviceauth/usercode`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CLIENT_ID })
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new LlmError(response.status, response.status === 404
				? 'Device sign-in is unavailable. Enable device-code authorization in your ChatGPT security settings and try again.'
				: `Could not start ChatGPT sign-in (HTTP ${response.status}). Try again.`);
		}
		const parsed = z.object({ device_auth_id: z.string().min(1), user_code: z.string().optional(), usercode: z.string().optional(), interval: z.union([z.string(), z.number()]).optional() }).safeParse(await this.json(response));
		if (!parsed.success || !(parsed.data.user_code || parsed.data.usercode)) throw new LlmError(502, 'ChatGPT did not return a sign-in code. Try again.');
		if (current !== this.generation) throw new LlmError(0, 'ChatGPT sign-in cancelled.');
		const seconds = Number(parsed.data.interval);
		const intervalMs = (Number.isFinite(seconds) && seconds > 0 ? Math.max(1, seconds) : 5) * 1000;
		this.login = {
			verificationUrl: `${ISSUER}/codex/device`, userCode: (parsed.data.user_code || parsed.data.usercode)!,
			deviceAuthId: parsed.data.device_auth_id, intervalMs,
			expiresAt: this.now() + LOGIN_LIFETIME_MS, nextPollAt: this.now() + intervalMs
		};
		this.loginError = undefined;
		this.schedulePoll();
		return this.snapshot();
	}

	private schedulePoll(): void {
		clearTimeout(this.timer);
		if (!this.login) return;
		const delay = Math.max(1, Math.min(this.login.nextPollAt, this.login.expiresAt) - this.now());
		this.timer = setTimeout(() => { void this.pollLogin(); }, delay);
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
		const work = this.completeLogin(login).catch((error) => {
			if (current !== this.generation) return;
			this.loginError = error instanceof LlmError ? error.message : 'Could not complete ChatGPT sign-in. Try again.';
		}).finally(() => {
			if (current !== this.generation) return;
			this.polling = undefined;
			if (this.login === login) login.nextPollAt = this.now() + login.intervalMs;
			this.schedulePoll();
		});
		this.polling = work;
		return work;
	}

	private async completeLogin(login: DeviceLogin): Promise<void> {
		const current = this.generation;
		const response = await this.request(`${ISSUER}/api/accounts/deviceauth/token`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ device_auth_id: login.deviceAuthId, user_code: login.userCode })
		});
		if (current !== this.generation) { await response.body?.cancel(); return; }
		if (!response.ok) {
			await response.body?.cancel();
			if (response.status === 403 || response.status === 404) { this.loginError = undefined; return; }
			if (response.status === 429) { login.intervalMs += 5000; return; }
			if (response.status < 500) this.login = undefined;
			throw new LlmError(response.status, `Could not check ChatGPT sign-in (HTTP ${response.status}). ${this.login ? 'Retrying...' : 'Start sign-in again.'}`);
		}
		// The code is single-use. An exchange failure requires a new sign-in.
		this.login = undefined;
		const parsed = z.object({ authorization_code: z.string().min(1), code_verifier: z.string().min(1) }).safeParse(await this.json(response));
		if (!parsed.success) throw new LlmError(502, 'ChatGPT returned an invalid authorization code. Start sign-in again.');
		const exchange = await this.request(`${ISSUER}/oauth/token`, {
			method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID,
				redirect_uri: `${ISSUER}/deviceauth/callback`, code: parsed.data.authorization_code, code_verifier: parsed.data.code_verifier }).toString()
		});
		if (!exchange.ok) { await exchange.body?.cancel(); throw new LlmError(exchange.status, `ChatGPT token exchange failed (HTTP ${exchange.status}). Start sign-in again.`); }
		const tokens = credentialsFromTokens(await this.json(exchange), this.now());
		if (current !== this.generation) return;
		if (this.now() >= login.expiresAt) throw new LlmError(401, 'ChatGPT sign-in expired. Start sign-in again.');
		this.persist(tokens);
		this.loginError = undefined;
	}

	private async refresh(stale: Credentials): Promise<Credentials> {
		const stored = this.read();
		if (!stored) throw new LlmError(401, 'Sign in to ChatGPT in Connections.');
		if (stored.accessToken !== stale.accessToken) return stored;
		if (this.refreshing) return this.refreshing;
		const current = this.generation;
		const work = (async () => {
			const response = await this.request(`${ISSUER}/oauth/token`, {
				method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: stored.refreshToken }).toString()
			});
			if (current !== this.generation) { await response.body?.cancel(); throw new LlmError(401, 'ChatGPT connection changed. Try again.'); }
			if (!response.ok) {
				await response.body?.cancel();
				if ([400, 401, 403].includes(response.status)) {
					this.persist(null);
					this.loginError = 'ChatGPT sign-in expired or was revoked. Sign in again in Connections.';
					throw new LlmError(401, this.loginError);
				}
				throw new LlmError(response.status, `ChatGPT token refresh failed (HTTP ${response.status}). Try again.`);
			}
			const tokens = credentialsFromTokens(await this.json(response), this.now(), stored);
			if (current !== this.generation) throw new LlmError(401, 'ChatGPT connection changed. Try again.');
			this.persist(tokens);
			this.loginError = undefined;
			return tokens;
		})();
		this.refreshing = work;
		try { return await work; }
		finally { if (this.refreshing === work) this.refreshing = undefined; }
	}

	/** Fixed origin/path only: configured API endpoints can never receive OAuth credentials. */
	async authorizedFetch(path: '/codex/responses' | '/codex/models?client_version=0.153.4' | '/wham/usage', init: RequestInit = {}): Promise<Response> {
		const signal = AbortSignal.any([this.lifecycle.signal, init.signal ?? AbortSignal.timeout(20_000)]);
		let credentials = this.read();
		if (!credentials) throw new LlmError(401, this.loginError ?? 'Sign in to ChatGPT in Connections.');
		const current = this.generation;
		if (credentials.expiresAt <= this.now() + 60_000) credentials = await waitFor(this.refresh(credentials), signal);
		for (let attempt = 0; attempt < 2; attempt++) {
			signal.throwIfAborted();
			if (current !== this.generation) throw new LlmError(401, 'ChatGPT connection changed. Try again.');
			const headers = new Headers(init.headers);
			headers.set('authorization', `Bearer ${credentials.accessToken}`);
			headers.set('ChatGPT-Account-Id', credentials.accountId);
			headers.set('user-agent', 'recoder/0.1.0');
			headers.set('originator', 'recoder');
			if (credentials.residency) headers.set('x-openai-internal-codex-residency', credentials.residency);
			let response: Response;
			try { response = await this.http(`${API}${path}`, { ...init, signal, headers, redirect: 'error' }); }
			catch { signal.throwIfAborted(); throw new LlmError(0, 'Could not reach ChatGPT. Check the server connection and retry.'); }
			if (response.status !== 401) return response;
			await response.body?.cancel();
			if (attempt === 0) credentials = await waitFor(this.refresh(credentials), signal);
			else {
				if (current === this.generation && this.read()?.accessToken === credentials.accessToken) this.persist(null);
				throw new LlmError(401, 'ChatGPT rejected the refreshed login. Sign in again in Connections.');
			}
		}
		throw new LlmError(401, 'Sign in to ChatGPT in Connections.');
	}

	disconnect(): void {
		// Explicit empty store prevents re-importing the old Recoder session.
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
		this.refreshing = undefined;
	}
}
