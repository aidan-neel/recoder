import { z } from 'zod';
import { LlmError, cancelledError } from '../../../models/llm/errors';
import type { SessionHandlers } from '../opencode-events';
import { OpenCodeError } from '../opencode-error';
import type { OpenCodeServer } from '../opencode-server';
import {
	MCP_TIMEOUT_MS,
	OAUTH_TIMEOUT_MS,
	splitModel,
	type NewSession,
	type OAuthStart,
	type OpenCodeApi,
	type Prompt,
	type Reply,
	type SessionEvents
} from './types';
import { tokensSchema, usage } from './tokens';

/** How long session cleanup may take after the call settles. */
const CLEANUP_TIMEOUT_MS = 5_000;

const DENY_ALL = { permission: '*', pattern: '*', action: 'deny' };

const errorSchema = z.object({
	name: z.string(),
	data: z.object({ message: z.string().optional(), statusCode: z.number().optional() }).partial().optional()
});

const replySchema = z.object({
	info: z.object({
		id: z.string().optional(),
		error: errorSchema.optional(),
		structured: z.unknown().optional(),
		tokens: tokensSchema.optional()
	}),
	parts: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
});

const messageListSchema = z.array(z.object({ info: z.object({ id: z.string() }) }));

const mcpStatusSchema = z.record(z.string(), z.object({ status: z.string() }).passthrough());

const authorizeSchema = z.object({ url: z.string(), method: z.enum(['auto', 'code']), instructions: z.string() });

const eventSchema = z.object({
	type: z.string(),
	properties: z
		.object({
			sessionID: z.string().optional(),
			partID: z.string().optional(),
			field: z.string().optional(),
			delta: z.string().optional(),
			part: z
				.object({ id: z.string(), type: z.string(), sessionID: z.string(), tokens: tokensSchema })
				.partial()
				.optional()
		})
		.passthrough()
});

type SessionEvent = z.infer<typeof eventSchema>;

/** OpenCode's error on a finished message, with the provider's HTTP status kept for retry and usage-limit checks. */
function replyError(error: NonNullable<z.infer<typeof replySchema>['info']['error']>): LlmError {
	const message = error.data?.message || 'OpenCode could not get a reply from the model.';

	if (error.name === 'MessageAbortedError') return cancelledError();
	if (error.name === 'ProviderAuthError') return new LlmError(401, message);

	return new LlmError(error.data?.statusCode ?? 0, message);
}

/**
 * Routes one session's events to its handlers. A delta names only its part,
 * so part types are learned from `message.part.updated` first; a part can be
 * updated many times, so each step boundary is reported once.
 */
function sessionRouter(handlers: SessionHandlers): (event: unknown, session: string | null) => void {
	const partTypes = new Map<string, string>();
	const steps = new Set<string>();

	const stepBoundary = (part: NonNullable<SessionEvent['properties']['part']>) => {
		if (!part.id || steps.has(part.id)) return;

		if (part.type === 'step-start') {
			steps.add(part.id);
			handlers.onStepStart?.();
		} else if (part.type === 'step-finish' && part.tokens) {
			steps.add(part.id);
			handlers.onStepFinish?.(usage(part.tokens));
		}
	};

	return (raw, session) => {
		const parsed = eventSchema.safeParse(raw);

		if (!parsed.success || parsed.data.properties.sessionID !== session) return;

		const { type, properties } = parsed.data;

		handlers.onActivity?.();

		if (type === 'message.part.updated' && properties.part?.id && properties.part.type) {
			partTypes.set(properties.part.id, properties.part.type);
			stepBoundary(properties.part);
		}

		if (type !== 'message.part.delta' || properties.field !== 'text' || !properties.delta) return;

		const partId = properties.partID ?? '';
		const kind = partTypes.get(partId);

		if (kind === 'text') handlers.onText?.(properties.delta, partId);
		else if (kind === 'reasoning') handlers.onReasoning?.(properties.delta, partId);
	};
}

/** `opencode serve` 1.x: routes at the root, scoped by a `directory` query, one synchronous message per prompt. */
export class V1Api implements OpenCodeApi {
	readonly structuredOutput = true;

	readonly events: SessionEvents = {
		path: (directory) => `/event?directory=${encodeURIComponent(directory)}`,
		router: sessionRouter
	};

	constructor(private readonly server: OpenCodeServer) {}

	private sessionPath(directory: string, id: string, suffix = ''): string {
		return `/session/${encodeURIComponent(id)}${suffix}?directory=${encodeURIComponent(directory)}`;
	}

	providers(): Promise<unknown> {
		return this.server.request('/provider');
	}

	connected(): Promise<unknown> {
		return this.server.request('/config/providers');
	}

	authMethods(): Promise<unknown> {
		return this.server.request('/provider/auth');
	}

	/** OpenCode caches which providers are connected per instance; drop it after credentials change. */
	private async reload(): Promise<void> {
		await this.server.request('/global/dispose', { method: 'POST' });
	}

	async setKey(providerId: string, key: string, inputs: Record<string, string>): Promise<void> {
		await this.server.request(`/auth/${encodeURIComponent(providerId)}`, {
			method: 'PUT',
			body: { type: 'api', key, ...(Object.keys(inputs).length ? { metadata: inputs } : {}) }
		});

		await this.reload();
	}

	async removeLogin(providerId: string): Promise<void> {
		await this.server.request(`/auth/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
		await this.reload();
	}

	/** For `auto`, OpenCode's callback call waits until the browser finishes, so `finish` stays pending until then. */
	async startOAuth(providerId: string, method: number, inputs: Record<string, string>): Promise<OAuthStart> {
		const raw = await this.server.request(`/provider/${encodeURIComponent(providerId)}/oauth/authorize`, {
			method: 'POST',
			body: { method, ...(Object.keys(inputs).length ? { inputs } : {}) }
		});

		const parsed = authorizeSchema.safeParse(raw);

		if (!parsed.success) throw new OpenCodeError('OpenCode did not return a sign-in link.');

		return {
			url: parsed.data.url,
			mode: parsed.data.method,
			instructions: parsed.data.instructions,
			finish: async (code) => {
				const ok = await this.server.request(`/provider/${encodeURIComponent(providerId)}/oauth/callback`, {
					method: 'POST',
					body: { method, ...(code ? { code } : {}) },
					timeoutMs: OAUTH_TIMEOUT_MS
				});

				if (ok === false) return false;

				await this.reload();

				return true;
			}
		};
	}

	/** A session that may use nothing of OpenCode's own; `allow` names the patterns it may call. */
	async createSession({ directory, allow, signal }: NewSession): Promise<string> {
		const created = await this.server.request(`/session?directory=${encodeURIComponent(directory)}`, {
			method: 'POST',
			body: {
				title: 'Recoder',
				permission: [DENY_ALL, ...allow.map((permission) => ({ permission, pattern: '*', action: 'allow' }))]
			},
			signal
		});

		return z.object({ id: z.string() }).parse(created).id;
	}

	/**
	 * OpenCode answers a JSON schema by calling its `StructuredOutput` tool, so
	 * that one tool stays on when a schema is sent; every other tool is off but
	 * the ones named.
	 */
	async prompt(request: Prompt): Promise<Reply> {
		const { schema, variant, system } = request;

		const raw = await this.server.request(this.sessionPath(request.directory, request.session, '/message'), {
			method: 'POST',
			body: {
				model: splitModel(request.model),
				...(system ? { system } : {}),
				...(variant ? { variant } : {}),
				tools: {
					'*': false,
					...Object.fromEntries(request.tools.map((name) => [name, true])),
					...(schema ? { StructuredOutput: true } : {})
				},
				...(schema ? { format: { type: 'json_schema', schema } } : {}),
				parts: [{ type: 'text', text: request.text }]
			},
			timeoutMs: request.timeoutMs,
			signal: request.signal
		});

		const { info, parts } = replySchema.parse(raw);

		return {
			id: info.id,
			texts: parts.filter((part) => part.type === 'text').map((part) => part.text ?? ''),
			structured: info.structured,
			tokens: info.tokens && usage(info.tokens),
			error: info.error && replyError(info.error)
		};
	}

	async abort(directory: string, session: string): Promise<void> {
		await this.server.request(this.sessionPath(directory, session, '/abort'), {
			method: 'POST',
			timeoutMs: CLEANUP_TIMEOUT_MS
		});
	}

	async deleteSession(directory: string, session: string): Promise<void> {
		await this.server.request(this.sessionPath(directory, session), {
			method: 'DELETE',
			timeoutMs: CLEANUP_TIMEOUT_MS
		});
	}

	async rollBack(directory: string, session: string, lastMessageId: string | null, held: boolean): Promise<void> {
		const list = await this.server.request(this.sessionPath(directory, session, '/message'), {
			timeoutMs: CLEANUP_TIMEOUT_MS
		});

		const ids = messageListSchema.parse(list).map((message) => message.info.id);
		const last = lastMessageId ? ids.indexOf(lastMessageId) : -1;

		if (held && last < 0) throw new Error('the last good message is not in the session');

		for (const id of ids.slice(last + 1).reverse())
			await this.server.request(this.sessionPath(directory, session, `/message/${encodeURIComponent(id)}`), {
				method: 'DELETE',
				timeoutMs: CLEANUP_TIMEOUT_MS
			});
	}

	async addMcp(directory: string, name: string, url: string, signal: AbortSignal): Promise<void> {
		const added = await this.server.request(`/mcp?directory=${encodeURIComponent(directory)}`, {
			method: 'POST',
			body: { name, config: { type: 'remote', url, oauth: false } },
			timeoutMs: MCP_TIMEOUT_MS,
			signal
		});

		const status = mcpStatusSchema.parse(added)[name]?.status;

		if (status !== 'connected') throw new Error(`OpenCode could not reach Recoder's tools (${status ?? 'missing'}).`);
	}
}
