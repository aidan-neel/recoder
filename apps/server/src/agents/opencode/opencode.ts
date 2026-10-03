import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TtlCache } from '../../util/ttl-cache';
import type {
	AgentOAuthAttempt,
	AgentOAuthStatus,
	AgentProvider,
	AgentStatus,
	ModelEntry,
	ReasoningEffort
} from '@recoder/shared';
import type { ChatOptions } from '../../models/llm/types';
import type { AgentAdapter } from '../registry';
import { openCodeChat } from './opencode-chat';
import { normalizeCatalog, normalizeModels, normalizeProviders, type CatalogProvider } from './opencode-catalog';
import { OpenCodeError } from './opencode-error';
import { OpenCodeServer, findOpenCode, probeVersion, type ServerRequest } from './opencode-server';

export { OPENCODE_MODEL_PREFIX, normalizeModels, normalizeProviders } from './opencode-catalog';
export { OpenCodeError } from './opencode-error';

const INSTALL = 'curl -fsSL https://opencode.ai/install | bash';

/** Device-code sign-ins give the user a few minutes to finish in the browser. */
const OAUTH_TIMEOUT_MS = 10 * 60_000;

/** How long a finished or expired sign-in stays readable before it is dropped. */
const ATTEMPT_GRACE_MS = 60_000;

/** The full catalog is large and slow to build, and only changes when OpenCode refreshes models.dev. */
const catalogCache = new TtlCache<CatalogProvider[]>(30 * 60_000, 1);

const authorizeSchema = z.object({ url: z.string(), method: z.enum(['auto', 'code']), instructions: z.string() });

type Attempt = AgentOAuthAttempt & { providerId: string; method: number; state: AgentOAuthStatus; expires: number };

/**
 * OpenCode, driven through its headless server (`opencode serve`).
 *
 * Recoder never reads OpenCode's credential file. Sign-in, keys and the model
 * catalog all go through the server's HTTP API.
 */
export class OpenCodeAgent implements AgentAdapter {
	readonly id = 'opencode';
	readonly name = 'OpenCode';
	private readonly server: OpenCodeServer;
	private status: AgentStatus | null = null;
	private attempts = new Map<string, Attempt>();
	/** The last model list, keyed by `provider/model`, for efforts and provider names. */
	private known = new Map<string, ModelEntry>();

	constructor(private readonly env: Record<string, string | undefined> = process.env) {
		this.server = new OpenCodeServer(env);
	}

	/** Installed, version, and whether the server came up. Cached until `refresh`. */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const path = findOpenCode(this.env);

		const base: AgentStatus = {
			id: this.id,
			name: this.name,
			installed: !!path,
			version: null,
			path,
			error: null,
			install: INSTALL,
			signedIn: null,
			login: null,
			providers: true
		};

		if (!path) return (this.status = base);

		try {
			base.version = await probeVersion(path, this.env);
			if (!base.version) base.error = 'OpenCode did not report a version.';
		} catch {
			base.error = 'OpenCode could not be run.';
		}

		if (!base.error) {
			try {
				await this.server.ensure();
			} catch (e) {
				base.error = e instanceof Error ? e.message : 'OpenCode did not start.';
			}
		}

		return (this.status = base);
	}

	async providers(): Promise<AgentProvider[]> {
		const [catalog, config, auth] = await Promise.all([
			this.catalog(),
			this.request('/config/providers'),
			this.request('/provider/auth')
		]);

		return normalizeProviders(catalog, config, auth);
	}

	async models(): Promise<ModelEntry[]> {
		const entries = normalizeModels(await this.request('/config/providers'));

		this.known = new Map(entries.map((entry) => [entry.model, entry]));

		return entries;
	}

	/** The reasoning levels a model offers as variants; null when it has none or is unknown. */
	async efforts(model: string): Promise<ReasoningEffort[] | null> {
		if (!this.known.has(model)) await this.models();

		return this.known.get(model)?.efforts ?? null;
	}

	/** The name OpenCode shows for a provider, once its models have been listed; else the id. */
	providerName(providerId: string): string {
		for (const entry of this.known.values())
			if (entry.model.startsWith(`${providerId}/`)) return entry.source ?? providerId;

		return providerId;
	}

	/** One model call through the server. See {@link openCodeChat}. */
	complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		return openCodeChat({ server: this.server, efforts: (model) => this.efforts(model) }, opts, onToken);
	}

	private catalog(): Promise<CatalogProvider[]> {
		return catalogCache.get('all', async () => normalizeCatalog(await this.request('/provider')));
	}

	/** Save an API key (plus any prompt answers) for a provider. */
	async setKey(providerId: string, key: string, inputs: Record<string, string> = {}): Promise<void> {
		await this.request(`/auth/${encodeURIComponent(providerId)}`, {
			method: 'PUT',
			body: { type: 'api', key, ...(Object.keys(inputs).length ? { metadata: inputs } : {}) }
		});

		await this.reload();
	}

	async remove(providerId: string): Promise<void> {
		await this.request(`/auth/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
		await this.reload();
	}

	/** OpenCode caches which providers are connected per instance; drop it after credentials change. */
	private async reload(): Promise<void> {
		await this.request('/global/dispose', { method: 'POST' });
	}

	/**
	 * Start a sign-in. For `auto`, OpenCode's callback call waits until the
	 * browser finishes, so it runs in the background and the UI polls `attempt`.
	 */
	async startOAuth(
		providerId: string,
		method: number,
		inputs: Record<string, string> = {}
	): Promise<AgentOAuthAttempt> {
		const raw = await this.request(`/provider/${encodeURIComponent(providerId)}/oauth/authorize`, {
			method: 'POST',
			body: { method, ...(Object.keys(inputs).length ? { inputs } : {}) }
		});

		const parsed = authorizeSchema.safeParse(raw);

		if (!parsed.success) throw new OpenCodeError('OpenCode did not return a sign-in link.');
		this.pruneAttempts();

		const attempt: Attempt = {
			attemptId: randomUUID(),
			url: parsed.data.url,
			mode: parsed.data.method,
			instructions: parsed.data.instructions,
			providerId,
			method,
			state: { status: 'pending' },
			expires: Date.now() + OAUTH_TIMEOUT_MS
		};

		this.attempts.set(attempt.attemptId, attempt);
		if (attempt.mode === 'auto') void this.finishOAuth(attempt);

		const { attemptId, url, mode, instructions } = attempt;

		return { attemptId, url, mode, instructions };
	}

	/** Paste-back sign-ins: hand OpenCode the code the provider showed. */
	async submitCode(attemptId: string, code: string): Promise<AgentOAuthStatus> {
		const attempt = this.attempts.get(attemptId);

		if (!attempt) throw new OpenCodeError('That sign-in expired. Start again.', 404);
		await this.finishOAuth(attempt, code);

		return attempt.state;
	}

	attempt(attemptId: string): AgentOAuthStatus | null {
		const attempt = this.attempts.get(attemptId);

		if (!attempt) return null;

		if (attempt.state.status === 'pending' && attempt.expires < Date.now()) {
			attempt.state = { status: 'failed', message: 'The sign-in timed out. Start again.' };
		}

		return attempt.state;
	}

	cancel(attemptId: string): void {
		this.attempts.delete(attemptId);
	}

	private async finishOAuth(attempt: Attempt, code?: string): Promise<void> {
		try {
			const ok = await this.request(`/provider/${encodeURIComponent(attempt.providerId)}/oauth/callback`, {
				method: 'POST',
				body: { method: attempt.method, ...(code ? { code } : {}) },
				timeoutMs: OAUTH_TIMEOUT_MS
			});

			if (ok === false) attempt.state = { status: 'failed', message: 'The provider did not accept the sign-in.' };
			else {
				await this.reload();
				attempt.state = { status: 'complete' };
			}
		} catch (e) {
			attempt.state = { status: 'failed', message: e instanceof Error ? e.message : 'Sign-in failed.' };
		}
	}

	private pruneAttempts(): void {
		const now = Date.now();

		for (const [id, attempt] of this.attempts) if (attempt.expires + ATTEMPT_GRACE_MS < now) this.attempts.delete(id);
	}

	/** JSON request to the managed server. Errors carry OpenCode's own message when it gives one. */
	request(path: string, init: ServerRequest = {}): Promise<unknown> {
		return this.server.request(path, init);
	}

	stop(): void {
		this.server.stop();
	}
}

export const opencode = new OpenCodeAgent();

process.once('exit', () => opencode.stop());
