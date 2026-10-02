import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { TtlCache } from '../../util/ttl-cache';
import {
	REASONING_EFFORTS,
	type AgentAuthMethod,
	type AgentAuthPrompt,
	type AgentOAuthAttempt,
	type AgentOAuthStatus,
	type AgentProvider,
	type AgentStatus,
	type ModelEntry,
	type ReasoningEffort
} from '@recoder/shared';

/**
 * OpenCode, driven through its headless server (`opencode serve`).
 *
 * Recoder never reads OpenCode's credential file. Sign-in, keys and the model
 * catalog all go through the server's HTTP API, which listens on loopback
 * behind a password generated per spawn.
 */

/** Prefix for registry ids of OpenCode models: `opencode:<provider>/<model>`. */
export const OPENCODE_MODEL_PREFIX = 'opencode:';

/** Agent-facing failure with a message safe to show in the UI. */
export class OpenCodeError extends Error {
	constructor(
		message: string,
		readonly status = 502
	) {
		super(message);
		this.name = 'OpenCodeError';
	}
}

const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Device-code sign-ins give the user a few minutes to finish in the browser. */
const OAUTH_TIMEOUT_MS = 10 * 60_000;

/** `RECODER_OPENCODE_BIN` when set (empty means none), else the binary on PATH, else OpenCode's installer location. */
export function findOpenCode(env: Record<string, string | undefined> = process.env): string | null {
	const pinned = env.RECODER_OPENCODE_BIN;

	if (pinned !== undefined) return pinned && existsSync(pinned) ? pinned : null;

	const onPath = Bun.which('opencode', { PATH: env.PATH ?? '' });

	if (onPath) return onPath;

	const installed = join(env.HOME ?? homedir(), '.opencode', 'bin', 'opencode');

	return existsSync(installed) ? installed : null;
}

/** `1.18.31`, `opencode 1.18.31` or `v1.18.31` → `1.18.31`. */
export function parseVersion(output: string): string | null {
	return output.match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/)?.[1] ?? null;
}

/** The URL `opencode serve` prints once it's listening. */
export function parseListenUrl(line: string): string | null {
	return line.match(/listening on (https?:\/\/[^\s]+)/)?.[1]?.replace(/\/$/, '') ?? null;
}

// ---- Normalizers for the server's JSON (outside input) ----

const conditionSchema = z.object({ key: z.string(), op: z.enum(['eq', 'neq']), value: z.string() });

const promptSchema = z.union([
	z.object({
		type: z.literal('text'),
		key: z.string(),
		message: z.string(),
		placeholder: z.string().optional(),
		when: conditionSchema.optional()
	}),
	z.object({
		type: z.literal('select'),
		key: z.string(),
		message: z.string(),
		options: z.array(z.object({ label: z.string(), value: z.string(), hint: z.string().optional() })),
		when: conditionSchema.optional()
	})
]);

const methodSchema = z.object({
	type: z.enum(['oauth', 'api']),
	label: z.string(),
	prompts: z.array(z.unknown()).optional()
});

const authMethodsSchema = z.record(z.string(), z.array(z.unknown()));

const modelSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().optional(),
		status: z.string().optional(),
		limit: z.object({ context: z.number().optional() }).partial().optional(),
		capabilities: z
			.object({ reasoning: z.boolean().optional(), toolcall: z.boolean().optional() })
			.partial()
			.optional(),
		variants: z.record(z.string(), z.unknown()).optional()
	})
	.passthrough();

const providerSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().optional(),
		source: z.string().optional(),
		env: z.array(z.string()).optional(),
		models: z.record(z.string(), z.unknown()).optional()
	})
	.passthrough();

const providerListSchema = z.object({ all: z.array(z.unknown()) });
const configProvidersSchema = z.object({ providers: z.array(z.unknown()) });

/** One entry per provider OpenCode knows, for the Add provider list. */
export interface CatalogProvider {
	id: string;
	name: string;
	modelCount: number;
}

function parseMethods(raw: unknown[]): AgentAuthMethod[] {
	return raw.flatMap((item, index) => {
		const method = methodSchema.safeParse(item);

		if (!method.success) return [];

		const prompts = (method.data.prompts ?? []).flatMap((p): AgentAuthPrompt[] => {
			const prompt = promptSchema.safeParse(p);

			if (!prompt.success) return [];

			const when = prompt.data.when ?? null;

			return prompt.data.type === 'text'
				? [
						{
							type: 'text',
							key: prompt.data.key,
							message: prompt.data.message,
							placeholder: prompt.data.placeholder ?? null,
							when
						}
					]
				: [
						{
							type: 'select',
							key: prompt.data.key,
							message: prompt.data.message,
							options: prompt.data.options.map((o) => ({ label: o.label, value: o.value, hint: o.hint ?? null })),
							when
						}
					];
		});

		return [{ index, type: method.data.type, label: method.data.label, prompts }];
	});
}

/** Models a review can use: active and able to call tools. */
function usableModels(raw: Record<string, unknown> | undefined): z.infer<typeof modelSchema>[] {
	return Object.values(raw ?? {}).flatMap((item) => {
		const model = modelSchema.safeParse(item);

		if (!model.success) return [];
		if (model.data.status && model.data.status !== 'active') return [];
		if (model.data.capabilities?.toolcall === false) return [];

		return [model.data];
	});
}

/** `/provider` (every provider OpenCode knows, ~6 MB) → names and model counts. Drops everything else, keys included. */
export function normalizeCatalog(providerJson: unknown): CatalogProvider[] {
	const list = providerListSchema.safeParse(providerJson);

	if (!list.success) throw new OpenCodeError('OpenCode returned a provider list Recoder could not read.');

	return list.data.all.flatMap((item) => {
		const provider = providerSchema.safeParse(item);

		if (!provider.success) return [];

		return [
			{
				id: provider.data.id,
				name: provider.data.name || provider.data.id,
				modelCount: usableModels(provider.data.models).length
			}
		];
	});
}

/** Connected providers from `/config/providers`. Its entries carry stored keys; only id, name, source and models are read. */
function connectedProviders(configJson: unknown): z.infer<typeof providerSchema>[] {
	const list = configProvidersSchema.safeParse(configJson);

	if (!list.success) throw new OpenCodeError('OpenCode returned a provider list Recoder could not read.');

	return list.data.providers.flatMap((item) => {
		const provider = providerSchema.safeParse(item);

		return provider.success ? [provider.data] : [];
	});
}

/** The catalog, what's connected and how, and each provider's sign-in methods → the list Recoder shows. */
export function normalizeProviders(
	catalog: CatalogProvider[],
	configJson: unknown,
	authJson: unknown
): AgentProvider[] {
	const auth = authMethodsSchema.safeParse(authJson);
	const methodsById = auth.success ? auth.data : {};
	const connected = new Map(connectedProviders(configJson).map((p) => [p.id, p]));
	const known = new Map(catalog.map((p) => [p.id, p]));

	// Providers from the agent's own config may be missing from the catalog.
	for (const p of connected.values())
		if (!known.has(p.id)) known.set(p.id, { id: p.id, name: p.name || p.id, modelCount: 0 });

	return [...known.values()]
		.map((entry): AgentProvider => {
			const live = connected.get(entry.id);
			const methods = parseMethods(methodsById[entry.id] ?? []);

			// `api` is a key saved through OpenCode; `custom` is a plugin's login (OAuth) or a built-in free tier.
			const via: AgentProvider['via'] = !live
				? null
				: live.source === 'api'
					? 'key'
					: live.source === 'config'
						? 'config'
						: live.source === 'env'
							? 'env'
							: methods.some((m) => m.type === 'oauth')
								? 'oauth'
								: 'builtin';

			return {
				id: entry.id,
				name: live?.name || entry.name,
				modelCount: live ? usableModels(live.models).length : entry.modelCount,
				connected: !!live,
				via,
				removable: via === 'key' || via === 'oauth',
				methods
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

const isEffort = (value: string): value is ReasoningEffort => (REASONING_EFFORTS as readonly string[]).includes(value);

/** Connected providers' models as registry entries the model picker understands. */
export function normalizeModels(configJson: unknown): ModelEntry[] {
	return connectedProviders(configJson).flatMap((provider) => {
		const providerName = provider.name || provider.id;

		return usableModels(provider.models).map((model): ModelEntry => {
			// Variants are OpenCode's reasoning presets; keep the ones that name an effort level.
			const efforts = Object.keys(model.variants ?? {}).filter(isEffort);
			const ordered = REASONING_EFFORTS.filter((effort) => efforts.includes(effort));

			return {
				provider: 'opencode',
				source: providerName,
				id: `${OPENCODE_MODEL_PREFIX}${provider.id}/${model.id}`,
				label: model.name || model.id,
				model: `${provider.id}/${model.id}`,
				baseUrl: null,
				apiKeyPreview: null,
				...(ordered.length
					? { efforts: [...ordered], defaultEffort: ordered.includes('medium') ? 'medium' : ordered[0] }
					: {}),
				...(model.limit?.context ? { contextWindow: model.limit.context } : {})
			};
		});
	});
}

// ---- The managed server ----

interface Running {
	url: string;
	password: string;
	proc: Bun.Subprocess;
}

const catalogCache = new TtlCache<CatalogProvider[]>(30 * 60_000, 1);

type Attempt = AgentOAuthAttempt & { providerId: string; method: number; state: AgentOAuthStatus; expires: number };

export class OpenCodeAgent {
	private running: Running | null = null;
	private starting: Promise<Running> | null = null;
	private status: AgentStatus | null = null;
	private attempts = new Map<string, Attempt>();

	constructor(private readonly env: Record<string, string | undefined> = process.env) {}

	/** Installed, version, and whether the server came up. Cached until `refresh`. */
	async detect(refresh = false): Promise<AgentStatus> {
		if (this.status && !refresh) return this.status;

		const path = findOpenCode(this.env);
		const base: AgentStatus = { id: 'opencode', name: 'OpenCode', installed: !!path, version: null, path, error: null };

		if (!path) return (this.status = base);

		try {
			const proc = Bun.spawn([path, '--version'], { stdout: 'pipe', stderr: 'pipe', env: this.childEnv() });
			const timer = setTimeout(() => proc.kill(), 10_000);
			const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

			clearTimeout(timer);
			base.version = parseVersion(out);
			if (!base.version) base.error = 'OpenCode did not report a version.';
		} catch {
			base.error = 'OpenCode could not be run.';
		}

		if (!base.error) {
			try {
				await this.ensure();
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
		return normalizeModels(await this.request('/config/providers'));
	}

	/** The full catalog is large and slow to build, and only changes when OpenCode refreshes models.dev. */
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

		const parsed = z
			.object({ url: z.string(), method: z.enum(['auto', 'code']), instructions: z.string() })
			.safeParse(raw);

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

		for (const [id, attempt] of this.attempts) if (attempt.expires + 60_000 < now) this.attempts.delete(id);
	}

	/** JSON request to the managed server. Errors carry OpenCode's own message when it gives one. */
	async request(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> {
		const server = await this.ensure();
		let response: Response;

		try {
			response = await fetch(`${server.url}${path}`, {
				method: init.method ?? 'GET',
				headers: {
					authorization: `Basic ${btoa(`opencode:${server.password}`)}`,
					...(init.body !== undefined ? { 'content-type': 'application/json' } : {})
				},
				body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
				signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS)
			});
		} catch (e) {
			if (e instanceof Error && e.name === 'TimeoutError')
				throw new OpenCodeError('OpenCode took too long to answer.', 504);
			this.running = null;
			throw new OpenCodeError('Lost the connection to OpenCode. Try again.');
		}

		const text = await response.text();
		const json = text ? safeJson(text) : null;

		if (!response.ok)
			throw new OpenCodeError(
				errorMessage(json) ?? `OpenCode answered HTTP ${response.status}.`,
				response.status >= 500 ? 502 : 400
			);

		return json;
	}

	/** Start `opencode serve` once; later calls share it. */
	private ensure(): Promise<Running> {
		if (this.running && this.running.proc.exitCode === null) return Promise.resolve(this.running);
		this.starting ??= this.spawn().finally(() => (this.starting = null));

		return this.starting;
	}

	private async spawn(): Promise<Running> {
		const path = findOpenCode(this.env);

		if (!path) throw new OpenCodeError('OpenCode is not installed.', 404);

		const password = randomBytes(24).toString('base64url');

		const proc = Bun.spawn([path, 'serve', '--hostname', '127.0.0.1', '--port', '0'], {
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...this.childEnv(), OPENCODE_SERVER_PASSWORD: password }
		});

		const url = await readListenUrl(proc, START_TIMEOUT_MS).catch((e) => {
			proc.kill();
			throw e;
		});

		this.running = { url, password, proc };

		void proc.exited.then(() => {
			if (this.running?.proc === proc) this.running = null;
		});

		return this.running;
	}

	private childEnv(): Record<string, string> {
		const out: Record<string, string> = {};

		for (const [k, v] of Object.entries(this.env)) if (v !== undefined) out[k] = v;

		return out;
	}

	stop(): void {
		this.running?.proc.kill();
		this.running = null;
	}
}

async function readListenUrl(proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>, timeoutMs: number): Promise<string> {
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	const deadline = setTimeout(() => void reader.cancel(), timeoutMs);

	try {
		for (;;) {
			const { value, done } = await reader.read();

			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const url = parseListenUrl(buffer);

			if (url) {
				// Keep draining so a full pipe never blocks the server.
				void (async () => {
					try {
						while (!(await reader.read()).done);
					} catch {}
				})();

				void new Response(proc.stderr).text().catch(() => {});

				return url;
			}
		}
	} finally {
		clearTimeout(deadline);
	}

	const err = (await new Response(proc.stderr).text().catch(() => '')).trim().split('\n').at(-1);

	throw new OpenCodeError(err ? `OpenCode did not start: ${err}` : 'OpenCode did not start.');
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function errorMessage(json: unknown): string | null {
	if (typeof json === 'string') return json.slice(0, 300) || null;

	const parsed = z
		.object({
			data: z.object({ message: z.string() }).partial().optional(),
			message: z.string().optional(),
			error: z.unknown().optional()
		})
		.safeParse(json);

	if (!parsed.success) return null;

	return (
		parsed.data.data?.message ??
		parsed.data.message ??
		(typeof parsed.data.error === 'string' ? parsed.data.error : null)
	);
}

export const opencode = new OpenCodeAgent();

process.once('exit', () => opencode.stop());
