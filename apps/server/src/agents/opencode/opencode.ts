import { randomUUID } from 'node:crypto';
import { TtlCache } from '../../util/ttl-cache';
import type {
	AgentOAuthAttempt,
	AgentOAuthStatus,
	AgentProvider,
	AgentStatus,
	ModelEntry,
	ReasoningEffort
} from '@recoder/shared';
import { withFieldFallback } from '../../models/llm/request-fields';
import type { ChatOptions } from '../../models/llm/types';
import type { AgentAdapter } from '../registry';
import { OAUTH_TIMEOUT_MS } from './api/types';
import { AgentSession, refusesStructuredOutput, type AgentSessionOptions } from './opencode-agent-session';
import { openCodeChat } from './opencode-chat';
import { normalizeCatalog, normalizeModels, normalizeProviders, type CatalogProvider } from './opencode-catalog';
import { OpenCodeError } from './opencode-error';
import { toolHost } from './opencode-mcp';
import { OpenCodeServer, findOpenCode, probeVersion, type ServerRequest } from './opencode-server';

export { OPENCODE_MODEL_PREFIX, normalizeModels, normalizeProviders } from './opencode-catalog';
export { OpenCodeError } from './opencode-error';

const INSTALL = 'curl -fsSL https://opencode.ai/install | bash';

/** How long a finished or expired sign-in stays readable before it is dropped. */
const ATTEMPT_GRACE_MS = 60_000;

/** The full catalog is large and slow to build, and only changes when OpenCode refreshes models.dev. */
const catalogCache = new TtlCache<CatalogProvider[]>(30 * 60_000, 1);

/** The same call with the schema dropped, asking for plain JSON instead. */
function plainJson(opts: ChatOptions): ChatOptions {
	return { ...opts, jsonSchema: undefined, jsonMode: true };
}

type Attempt = AgentOAuthAttempt & {
	finish: (code?: string) => Promise<boolean>;
	state: AgentOAuthStatus;
	expires: number;
};

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
	/**
	 * Models whose provider refused OpenCode's structured output. OpenCode forces
	 * its `StructuredOutput` tool call, and some providers accept only an `auto`
	 * tool choice; later calls to these models ask for JSON in the prompt instead.
	 */
	private noStructuredOutput = new Set<string>();
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
		const api = await this.server.api();
		const [catalog, config, auth] = await Promise.all([this.catalog(), api.connected(), api.authMethods()]);

		return normalizeProviders(catalog, config, auth);
	}

	async models(): Promise<ModelEntry[]> {
		const entries = normalizeModels(await (await this.server.api()).connected());

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

	/**
	 * One model call through the server. See {@link openCodeChat}. A server that cannot force a schema, and
	 * a model that refuses it, are asked for plain JSON instead.
	 */
	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		const api = await this.server.api();
		const host = { server: this.server, efforts: (model: string) => this.efforts(model) };

		if (!opts.jsonSchema) return openCodeChat(host, opts, onToken);
		if (!api.structuredOutput) return openCodeChat(host, plainJson(opts), onToken);

		const run = () => openCodeChat(host, this.noStructuredOutput.has(opts.model) ? plainJson(opts) : opts, onToken);

		return withFieldFallback(opts, opts.model, this.noStructuredOutput, refusesStructuredOutput, run);
	}

	/** A session in which OpenCode runs a whole agent with Recoder's tools. See {@link AgentSession}. */
	openAgent(options: AgentSessionOptions): Promise<AgentSession> {
		return AgentSession.open(
			{
				server: this.server,
				efforts: (model: string) => this.efforts(model),
				noStructuredOutput: this.noStructuredOutput
			},
			options
		);
	}

	private catalog(): Promise<CatalogProvider[]> {
		return catalogCache.get('all', async () => normalizeCatalog(await (await this.server.api()).providers()));
	}

	/** Save an API key (plus any prompt answers) for a provider. */
	async setKey(providerId: string, key: string, inputs: Record<string, string> = {}): Promise<void> {
		await (await this.server.api()).setKey(providerId, key, inputs);
	}

	async remove(providerId: string): Promise<void> {
		await (await this.server.api()).removeLogin(providerId);
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
		const started = await (await this.server.api()).startOAuth(providerId, method, inputs);

		this.pruneAttempts();

		const attempt: Attempt = {
			attemptId: randomUUID(),
			url: started.url,
			mode: started.mode,
			instructions: started.instructions,
			finish: started.finish,
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
			const ok = await attempt.finish(code);

			attempt.state = ok
				? { status: 'complete' }
				: { status: 'failed', message: 'The provider did not accept the sign-in.' };
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
		toolHost.stop();
		this.server.stop();
	}
}

export const opencode = new OpenCodeAgent();

process.once('exit', () => opencode.stop());
