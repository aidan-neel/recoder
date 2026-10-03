import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReasoningEffort, TokenUsage } from '@recoder/shared';
import { LlmError, cancelledError, timedOutError } from '../../models/llm/errors';
import { abortedPromise } from '../../models/llm/openai-compatible';
import { sseData } from '../../models/llm/sse';
import type { ChatMessage, ChatOptions } from '../../models/llm/types';
import { serverDataDir } from '../../util/data-dir';
import { OpenCodeError } from './opencode-error';
import type { OpenCodeServer } from './opencode-server';

/** The slice of the agent a chat call needs: the managed server and a model's reasoning levels. */
export interface OpenCodeChatHost {
	server: OpenCodeServer;
	efforts(model: string): Promise<ReasoningEffort[] | null>;
}

/** Every permission denied: a review call only reads the prompt it is given. */
const DENY_ALL = [{ permission: '*', pattern: '*', action: 'deny' }];

/** How long the session cleanup may take after the call settles. */
const CLEANUP_TIMEOUT_MS = 5_000;

const errorSchema = z.object({
	name: z.string(),
	data: z.object({ message: z.string().optional(), statusCode: z.number().optional() }).partial().optional()
});

const replySchema = z.object({
	info: z.object({
		error: errorSchema.optional(),
		structured: z.unknown().optional(),
		tokens: z
			.object({
				input: z.number(),
				output: z.number(),
				reasoning: z.number(),
				cache: z.object({ read: z.number(), write: z.number() })
			})
			.optional()
	}),
	parts: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
});

type Reply = z.infer<typeof replySchema>;

const eventSchema = z.object({
	type: z.string(),
	properties: z
		.object({
			sessionID: z.string().optional(),
			partID: z.string().optional(),
			field: z.string().optional(),
			delta: z.string().optional(),
			part: z.object({ id: z.string(), type: z.string(), sessionID: z.string() }).partial().optional()
		})
		.passthrough()
});

/**
 * A directory with nothing in it, so the session never sees the user's files
 * or the PR checkout. OpenCode scopes a session's project to its directory.
 */
async function emptyDirectory(): Promise<string> {
	const dir = join(serverDataDir(), 'opencode-empty');

	await mkdir(dir, { recursive: true });

	return dir;
}

/** `openrouter/qwen/qwen3` → provider `openrouter`, model `qwen/qwen3`. */
function splitModel(model: string): { providerID: string; modelID: string } {
	const slash = model.indexOf('/');

	if (slash <= 0) throw new LlmError(400, `"${model}" is not an OpenCode model.`);

	return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

/** OpenCode takes one system prompt and one user turn, so earlier turns become a transcript. */
function promptParts(messages: ChatMessage[]): { system: string; text: string } {
	const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
	const turns = messages.filter((m) => m.role !== 'system');

	const text =
		turns.length === 1
			? turns[0].content
			: turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`).join('\n\n');

	return { system: system.join('\n\n'), text };
}

/** The effort, when the model offers it as a variant; models without variants get none. */
async function variantFor(host: OpenCodeChatHost, opts: ChatOptions): Promise<string | undefined> {
	if (opts.thinking === false || !opts.reasoningEffort) return undefined;

	const efforts = await host.efforts(opts.model);

	return efforts?.includes(opts.reasoningEffort) ? opts.reasoningEffort : undefined;
}

/** OpenCode's error on a finished message, with the provider's HTTP status kept for retry and usage-limit checks. */
function replyError(error: NonNullable<Reply['info']['error']>): LlmError {
	const message = error.data?.message || 'OpenCode could not get a reply from the model.';

	if (error.name === 'MessageAbortedError') return cancelledError();
	if (error.name === 'ProviderAuthError') return new LlmError(401, message);

	return new LlmError(error.data?.statusCode ?? 0, message);
}

/** The reply text: the structured object when a schema was sent, else the text parts in order. */
function replyText(reply: Reply, structured: boolean): string {
	if (structured && reply.info.structured !== undefined) return JSON.stringify(reply.info.structured);

	return reply.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text ?? '')
		.join('');
}

function usage(tokens: NonNullable<Reply['info']['tokens']>): TokenUsage {
	return {
		inputTokens: tokens.input,
		outputTokens: tokens.output,
		totalTokens: tokens.input + tokens.output,
		cachedInputTokens: tokens.cache.read,
		cacheWriteInputTokens: tokens.cache.write,
		reasoningOutputTokens: tokens.reasoning
	};
}

/**
 * Forward this session's streamed text and reasoning. A delta names only its
 * part, so part types are learned from `message.part.updated` first. Resolves
 * once the stream is connected, so no early delta is missed, with a `settle`
 * that stops forwarding and sends whatever of the final text the stream had
 * not delivered yet.
 */
async function followDeltas(
	host: OpenCodeChatHost,
	directory: string,
	sessionId: () => string | null,
	opts: ChatOptions,
	onToken: ((text: string) => void) | undefined,
	signal: AbortSignal
): Promise<(final: string) => void> {
	const body = await host.server.stream(`/event?directory=${encodeURIComponent(directory)}`, signal);
	const reader = body.getReader();
	const events = sseData(reader, signal, abortedPromise(signal), () => {});
	const partTypes = new Map<string, string>();
	let streamed = '';
	let settled = false;

	const settle = (final: string) => {
		if (settled) return;
		settled = true;
		if (final.startsWith(streamed) && final.length > streamed.length) onToken?.(final.slice(streamed.length));
	};

	const first = await events.next();

	if (first.done) return settle;

	void (async () => {
		for await (const data of events) {
			if (settled) break;

			const parsed = eventSchema.safeParse(safeJson(data));

			if (!parsed.success || parsed.data.properties.sessionID !== sessionId()) continue;

			const { type, properties } = parsed.data;

			if (type === 'message.part.updated' && properties.part?.id && properties.part.type) {
				partTypes.set(properties.part.id, properties.part.type);
			}

			if (type !== 'message.part.delta' || properties.field !== 'text' || !properties.delta) continue;

			const kind = partTypes.get(properties.partID ?? '');

			if (kind === 'text') {
				streamed += properties.delta;
				onToken?.(properties.delta);
			} else if (kind === 'reasoning') opts.onReasoning?.(properties.delta);
		}
	})()
		.catch(() => {})
		.finally(() => reader.cancel().catch(() => {}));

	return settle;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Best effort: stop the model and drop the session so nothing piles up in OpenCode. */
async function cleanup(host: OpenCodeChatHost, directory: string, id: string, aborted: boolean): Promise<void> {
	const query = `?directory=${encodeURIComponent(directory)}`;
	const path = `/session/${encodeURIComponent(id)}`;

	if (aborted)
		await host.server
			.request(`${path}/abort${query}`, { method: 'POST', timeoutMs: CLEANUP_TIMEOUT_MS })
			.catch(() => {});
	await host.server.request(`${path}${query}`, { method: 'DELETE', timeoutMs: CLEANUP_TIMEOUT_MS }).catch(() => {});
}

/**
 * One model call through OpenCode: a throwaway session in an empty directory
 * with every tool and permission off, one prompt, then the session is deleted.
 * Recoder still runs the review loop; OpenCode only carries the model call.
 */
export async function openCodeChat(
	host: OpenCodeChatHost,
	opts: ChatOptions,
	onToken?: (text: string) => void
): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
	const stream = new AbortController();
	const directory = await emptyDirectory();
	const query = `?directory=${encodeURIComponent(directory)}`;
	let session: string | null = null;
	let settle: (final: string) => void = () => {};

	try {
		const { providerID, modelID } = splitModel(opts.model);

		if (onToken || opts.onReasoning) {
			settle = await followDeltas(
				host,
				directory,
				() => session,
				opts,
				onToken,
				AbortSignal.any([signal, stream.signal])
			);
		}

		const created = await host.server.request(`/session${query}`, {
			method: 'POST',
			body: { title: 'Recoder', permission: DENY_ALL },
			signal
		});

		session = z.object({ id: z.string() }).parse(created).id;

		const prompt = promptParts(opts.messages);
		const variant = await variantFor(host, opts);

		const raw = await host.server.request(`/session/${encodeURIComponent(session)}/message${query}`, {
			method: 'POST',
			body: {
				model: { providerID, modelID },
				...(prompt.system ? { system: prompt.system } : {}),
				...(variant ? { variant } : {}),
				tools: { '*': false },
				...(opts.jsonSchema ? { format: { type: 'json_schema', schema: opts.jsonSchema.schema } } : {}),
				parts: [{ type: 'text', text: prompt.text }]
			},
			timeoutMs,
			signal
		});

		const reply = replySchema.parse(raw);

		if (reply.info.tokens) opts.onUsage?.(usage(reply.info.tokens));
		if (reply.info.error) throw replyError(reply.info.error);

		const text = replyText(reply, !!opts.jsonSchema);

		settle(text);

		return text;
	} catch (error) {
		if (opts.signal?.aborted) throw cancelledError();
		if (timeout.aborted) throw timedOutError(timeoutMs);
		if (error instanceof LlmError) throw error;
		if (error instanceof OpenCodeError) throw new LlmError(error.status, error.message);
		if (error instanceof z.ZodError) throw new LlmError(0, 'OpenCode sent a reply Recoder could not read.');
		throw new LlmError(0, error instanceof Error ? error.message : 'OpenCode request failed.');
	} finally {
		stream.abort();
		if (session) await cleanup(host, directory, session, signal.aborted);
	}
}
