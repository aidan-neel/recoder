import { z } from 'zod';
import { LlmError, cancelledError } from '../../../models/llm/errors';
import type { SessionHandlers } from '../opencode-events';
import { OpenCodeError } from '../opencode-error';
import type { OpenCodeServer, ServerRequest } from '../opencode-server';
import { tokensSchema, usage } from './tokens';
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
import {
	authJson,
	connectedJson,
	integrationSchema,
	modelSchema,
	providersJson,
	signInMethods,
	type Integration
} from './v2-catalog';

const CLEANUP_TIMEOUT_MS = 5_000;

/** How often an unfinished prompt, MCP connection or sign-in is looked at again. */
const POLL_MS = 400;

/** How many times a fresh server is asked for its integrations before an empty list is believed. */
const LOAD_ATTEMPTS = 8;

/** How long a new MCP server needs after it reports connected before its tools reach new sessions. */
const TOOLS_SETTLE_MS = 1000;

/** The key under which Recoder's system prompt sits among the session's instructions. */
const INSTRUCTIONS_KEY = 'recoder';

const failureSchema = z.object({ type: z.string(), message: z.string().optional(), status: z.number().optional() });

const messageSchema = z
	.object({
		id: z.string(),
		type: z.string(),
		outcome: z.string().optional(),
		content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
		tokens: tokensSchema.optional(),
		error: failureSchema.optional()
	})
	.passthrough();

type Message = z.infer<typeof messageSchema>;

const eventSchema = z.object({
	type: z.string(),
	data: z
		.object({
			sessionID: z.string().optional(),
			assistantMessageID: z.string().optional(),
			ordinal: z.number().optional(),
			delta: z.string().optional(),
			tokens: tokensSchema.optional()
		})
		.passthrough()
});

const wrapped = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

/** Every permission denied, then each pattern allowed: a session uses only the tools it is handed. */
function permissions(allow: string[]): { action: string; resource: string; effect: string }[] {
	return [
		{ action: '*', resource: '*', effect: 'deny' },
		...allow.map((action) => ({ action, resource: '*', effect: 'allow' }))
	];
}

/** OpenCode's error on a finished message, with the provider's HTTP status kept for retry and usage-limit checks. */
function failure(error: z.infer<typeof failureSchema>): LlmError {
	if (error.type === 'aborted') return cancelledError();

	const message = error.message || 'OpenCode could not get a reply from the model.';

	return new LlmError(error.status ?? (error.type === 'provider.auth' ? 401 : 0), message);
}

/** The usage of every model call in a run, added up. */
function totalTokens(messages: Message[]): Reply['tokens'] {
	const all = messages.flatMap((message) => (message.tokens ? [message.tokens] : []));

	if (!all.length) return undefined;

	return usage({
		input: all.reduce((sum, t) => sum + t.input, 0),
		output: all.reduce((sum, t) => sum + t.output, 0),
		reasoning: all.reduce((sum, t) => sum + t.reasoning, 0),
		cache: {
			read: all.reduce((sum, t) => sum + t.cache.read, 0),
			write: all.reduce((sum, t) => sum + t.cache.write, 0)
		}
	});
}

/**
 * What a run left behind: the messages after the user's, ending in `idle`.
 * Null while the run is still going.
 */
function settled(newest: Message[], userId: string): Reply | null {
	const at = newest.findIndex((message) => message.id === userId);
	const after = (at < 0 ? newest : newest.slice(0, at)).reverse();
	const idle = after.find((message) => message.type === 'idle');

	if (!idle) return null;

	const assistants = after.filter((message) => message.type === 'assistant');
	const last = assistants.at(-1);
	const tokens = totalTokens(assistants);
	const texts = (last?.content ?? []).flatMap((part) => (part.type === 'text' ? [part.text ?? ''] : []));

	if (last?.error) return { id: last.id, texts, tokens, error: failure(last.error) };
	if (idle.outcome === 'interrupted') return { id: last?.id, texts, tokens, error: cancelledError() };
	if (idle.outcome === 'failed') return { id: last?.id, texts, tokens, error: failure({ type: 'failed' }) };

	return { id: last?.id, texts, tokens };
}

/**
 * Routes one session's events to its handlers. A model call can be announced
 * again when the provider is retried, so each step is reported once.
 */
function sessionRouter(handlers: SessionHandlers): (event: unknown, session: string | null) => void {
	const steps = new Set<string>();

	return (raw, session) => {
		const parsed = eventSchema.safeParse(raw);

		if (!parsed.success || parsed.data.data.sessionID !== session) return;

		const { type, data } = parsed.data;
		const message = data.assistantMessageID ?? '';
		const part = `${message}:${data.ordinal ?? 0}`;

		handlers.onActivity?.();

		if (type === 'session.text.delta' && data.delta) handlers.onText?.(data.delta, part);
		else if (type === 'session.reasoning.delta' && data.delta) handlers.onReasoning?.(data.delta, part);
		else if (type === 'session.step.started' && !steps.has(`start:${message}`)) {
			steps.add(`start:${message}`);
			handlers.onStepStart?.();
		} else if (type === 'session.step.ended' && data.tokens && !steps.has(`end:${message}`)) {
			steps.add(`end:${message}`);
			handlers.onStepFinish?.(usage(data.tokens));
		}
	};
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);

		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(signal?.reason);
			},
			{ once: true }
		);
	});
}

/** `location[directory]`, the query form v2 reads a directory from. */
function locationQuery(directory: string): string {
	return `location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
}

/**
 * `opencode serve` 2.x: everything under `/api`, replies wrapped in `{ data }`.
 * A prompt is queued and answered by reading the session's messages, and a
 * session's model, system prompt and permissions are set on the session, not
 * sent with each prompt.
 */
export class V2Api implements OpenCodeApi {
	/** v2 has no schema-forced answer; the model is asked for plain JSON. */
	readonly structuredOutput = false;

	readonly events: SessionEvents = { path: () => '/api/event', router: sessionRouter };

	/** The tools each session may call right now, so a prompt changes permissions only when they differ. */
	private readonly allowed = new Map<string, string>();
	private readonly registered = new Set<string>();

	constructor(private readonly server: OpenCodeServer) {}

	private async data<T extends z.ZodType>(schema: T, path: string, init: ServerRequest = {}): Promise<z.infer<T>> {
		return (wrapped(schema).parse(await this.server.request(path, init)) as { data: z.infer<T> }).data;
	}

	/**
	 * A fresh server answers `[]` until it has loaded its integrations, which takes a moment and starts with
	 * the first ask, so an empty list is asked again. A server always knows some, so empty means not loaded yet.
	 */
	private async integrations(): Promise<Integration[]> {
		for (let attempt = 1; ; attempt++) {
			const list = await this.data(z.array(integrationSchema), '/api/integration');

			if (list.length || attempt >= LOAD_ATTEMPTS) return list;

			await sleep(POLL_MS);
		}
	}

	/** Asked after the integrations, which are what a fresh server loads first. */
	private models(): Promise<z.infer<typeof modelSchema>[]> {
		return this.data(z.array(modelSchema), '/api/model');
	}

	async providers(): Promise<unknown> {
		const integrations = await this.integrations();

		return providersJson(integrations, await this.models());
	}

	async connected(): Promise<unknown> {
		const integrations = await this.integrations();

		return connectedJson(integrations, await this.models());
	}

	async authMethods(): Promise<unknown> {
		return authJson(await this.integrations());
	}

	async setKey(providerId: string, key: string, inputs: Record<string, string>): Promise<void> {
		await this.server.request(`/api/integration/${encodeURIComponent(providerId)}/connect/key`, {
			method: 'POST',
			body: { key, ...(Object.keys(inputs).length ? { answer: inputs } : {}) }
		});
	}

	async removeLogin(providerId: string): Promise<void> {
		const integration = (await this.integrations()).find((item) => item.id === providerId);

		for (const connection of integration?.connections ?? [])
			if (connection.type === 'credential' && connection.id)
				await this.server.request(`/api/credential/${encodeURIComponent(connection.id)}`, { method: 'DELETE' });
	}

	async startOAuth(providerId: string, method: number, inputs: Record<string, string>): Promise<OAuthStart> {
		const integration = (await this.integrations()).find((item) => item.id === providerId);
		const chosen = integration && signInMethods(integration)[method];

		if (chosen?.type !== 'oauth' || !chosen.id) throw new OpenCodeError('That sign-in is not available.', 404);

		const base = `/api/integration/${encodeURIComponent(providerId)}/connect/oauth`;

		const attempt = await this.data(
			z.object({ attemptID: z.string(), url: z.string(), instructions: z.string(), mode: z.enum(['auto', 'code']) }),
			base,
			{ method: 'POST', body: { methodID: chosen.id, ...(Object.keys(inputs).length ? { answer: inputs } : {}) } }
		);

		const path = `${base}/${encodeURIComponent(attempt.attemptID)}`;

		return {
			url: attempt.url,
			mode: attempt.mode,
			instructions: attempt.instructions,
			finish: async (code) => {
				if (code) {
					await this.server.request(`${path}/complete`, { method: 'POST', body: { code } });

					return true;
				}

				return this.awaitSignIn(path);
			}
		};
	}

	/** Waits for the browser sign-in; OpenCode finishes it by itself when the user approves. */
	private async awaitSignIn(path: string): Promise<boolean> {
		const deadline = AbortSignal.timeout(OAUTH_TIMEOUT_MS);

		for (;;) {
			const { status, message } = await this.data(
				z.object({ status: z.string(), message: z.string().optional() }),
				path
			);

			if (status === 'complete') return true;
			if (status !== 'pending') throw new OpenCodeError(message ?? 'The sign-in did not finish.');

			await sleep(POLL_MS * 2, deadline).catch(() => {
				throw new OpenCodeError('The sign-in timed out. Start again.');
			});
		}
	}

	/** The model, effort and permissions go on the session; the system prompt is one of its instruction entries. */
	async createSession({ directory, model, system, variant, allow, signal }: NewSession): Promise<string> {
		const { providerID, modelID } = splitModel(model);

		const { id } = await this.data(z.object({ id: z.string() }), '/api/session', {
			method: 'POST',
			body: {
				title: 'Recoder',
				model: { providerID, id: modelID, ...(variant ? { variant } : {}) },
				location: { directory },
				permissions: permissions(allow)
			},
			signal
		});

		this.allowed.set(id, JSON.stringify(allow));

		if (!system) return id;

		try {
			await this.server.request(
				`/api/experimental/session/${encodeURIComponent(id)}/instructions/entries/${INSTRUCTIONS_KEY}`,
				{
					method: 'PUT',
					body: { value: system },
					signal
				}
			);
		} catch (error) {
			await this.deleteSession(directory, id).catch(() => {});

			throw error;
		}

		return id;
	}

	private async allowTools(session: string, tools: string[]): Promise<void> {
		const key = JSON.stringify(tools);

		if (this.allowed.get(session) === key) return;

		await this.server.request(`/api/session/${encodeURIComponent(session)}`, {
			method: 'PATCH',
			body: { permissions: permissions(tools) }
		});

		this.allowed.set(session, key);
	}

	/** The newest messages of a session, newest first. */
	private newest(session: string): Promise<Message[]> {
		return this.data(
			z.array(messageSchema),
			`/api/session/${encodeURIComponent(session)}/message?order=desc&limit=200`
		);
	}

	/**
	 * Queues the prompt and waits for the session to go idle. The wait route
	 * blocks until then; polling the messages covers a server that answers it
	 * early or not at all.
	 */
	async prompt(request: Prompt): Promise<Reply> {
		const { session, signal, timeoutMs } = request;
		const path = `/api/session/${encodeURIComponent(session)}`;
		const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

		await this.allowTools(session, request.tools);

		const sent = await this.data(z.object({ id: z.string() }), `${path}/prompt`, {
			method: 'POST',
			body: { text: request.text },
			signal
		});

		await this.server
			.request(`/api/experimental/session/${encodeURIComponent(session)}/wait`, {
				method: 'POST',
				timeoutMs,
				signal
			})
			.catch((error: unknown) => {
				if (signal.aborted || (error instanceof OpenCodeError && error.status === 504)) throw error;
			});

		for (;;) {
			const reply = settled(await this.newest(session), sent.id);

			if (reply) return reply;
			if (deadline.aborted)
				throw signal.aborted ? signal.reason : new OpenCodeError('OpenCode took too long to answer.', 504);

			await sleep(POLL_MS, deadline).catch(() => {});
		}
	}

	async abort(_directory: string, session: string): Promise<void> {
		await this.server.request(`/api/session/${encodeURIComponent(session)}/interrupt`, {
			method: 'POST',
			timeoutMs: CLEANUP_TIMEOUT_MS
		});
	}

	async deleteSession(_directory: string, session: string): Promise<void> {
		this.allowed.delete(session);

		await this.server.request(`/api/session/${encodeURIComponent(session)}`, {
			method: 'DELETE',
			timeoutMs: CLEANUP_TIMEOUT_MS
		});
	}

	async rollBack(): Promise<void> {
		throw new OpenCodeError('OpenCode 2 cannot remove a session message.');
	}

	/**
	 * OpenCode reports a server connected before it has listed its tools, and a session started in that gap
	 * gets none (the model then writes tool calls as text). The first time a server is added in a directory,
	 * wait out the gap; adding it again changes nothing.
	 */
	private async settle(directory: string, name: string, signal: AbortSignal): Promise<void> {
		const key = `${directory}\0${name}`;

		if (this.registered.has(key)) return;

		await sleep(TOOLS_SETTLE_MS, signal).catch(() => {});
		this.registered.add(key);
	}

	/** Tools come in natively as `<server>_<tool>`; the default hands the model one code sandbox in their place. */
	async addMcp(directory: string, name: string, url: string, signal: AbortSignal): Promise<void> {
		const deadline = AbortSignal.any([signal, AbortSignal.timeout(MCP_TIMEOUT_MS)]);

		await this.server.request(`/api/experimental/mcp/${encodeURIComponent(name)}?${locationQuery(directory)}`, {
			method: 'PUT',
			body: { config: { type: 'remote', url, oauth: false, codemode: false } },
			timeoutMs: MCP_TIMEOUT_MS,
			signal
		});

		const listed = z.array(z.object({ name: z.string(), status: z.object({ status: z.string() }).passthrough() }));
		let status: string | undefined;

		do {
			const servers = await this.data(listed, `/api/mcp?${locationQuery(directory)}`, { signal });

			status = servers.find((server) => server.name === name)?.status.status;

			if (status === 'connected') return this.settle(directory, name, deadline);
			if (status !== 'pending') break;

			await sleep(POLL_MS / 2, deadline).catch(() => {});
		} while (!deadline.aborted);

		throw new Error(`OpenCode could not reach Recoder's tools (${status ?? 'missing'}).`);
	}
}
