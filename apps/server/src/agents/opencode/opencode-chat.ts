import { z } from 'zod';
import type { ReasoningEffort } from '@recoder/shared';
import { LlmError, cancelledError, timedOutError } from '../../models/llm/errors';
import { emptyDirectory } from '../cli-process';
import { JSON_MODE_INSTRUCTION } from '../../models/llm/request-fields';
import type { ChatMessage, ChatOptions } from '../../models/llm/types';
import { splitModel, type Reply } from './api/types';
import { OpenCodeError } from './opencode-error';
import { followSession } from './opencode-events';
import type { OpenCodeServer } from './opencode-server';
import { openTurn, type SessionTurn } from './opencode-session';

/** The slice of the agent a chat call needs: the managed server and a model's reasoning levels. */
export interface OpenCodeChatHost {
	server: OpenCodeServer;
	efforts(model: string): Promise<ReasoningEffort[] | null>;
}

/** The empty directory OpenCode sessions run in, see {@link emptyDirectory}. */
export const OPENCODE_EMPTY_DIR = 'opencode-empty';

/** The system prompt OpenCode takes apart from the turns, and the turns themselves. */
function promptParts({ messages, jsonMode }: ChatOptions): { system: string; turns: ChatMessage[] } {
	const system = messages.filter((m) => m.role === 'system').map((m) => m.content);

	if (jsonMode) system.push(JSON_MODE_INSTRUCTION);

	return { system: system.join('\n\n'), turns: messages.filter((m) => m.role !== 'system') };
}

/** The effort, when the model offers it as a variant; models without variants get none. */
export async function variantFor(
	host: OpenCodeChatHost,
	opts: Pick<ChatOptions, 'model' | 'thinking' | 'reasoningEffort'>
): Promise<string | undefined> {
	if (opts.thinking === false || !opts.reasoningEffort) return undefined;

	const efforts = await host.efforts(opts.model);

	return efforts?.includes(opts.reasoningEffort) ? opts.reasoningEffort : undefined;
}

/**
 * The reply text: the structured object when a schema was sent, else the text parts in order. Some
 * models answer the structured-output tool with `{}` every time; that counts as refusing it, so the
 * call is asked again for plain JSON.
 */
function replyText(reply: Reply, structured: boolean): string {
	const value = reply.structured;

	if (structured && isEmptyObject(value)) throw new LlmError(0, 'The model returned empty structured output.');
	if (structured && value !== undefined) return JSON.stringify(value);

	return reply.texts.join('');
}

export function isEmptyObject(value: unknown): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

/**
 * Forward this session's streamed text and reasoning. Returns a `settle` that
 * stops forwarding and sends whatever of the final text the stream had not
 * delivered yet.
 */
async function followDeltas(
	host: OpenCodeChatHost,
	directory: string,
	sessionId: () => string | null,
	opts: ChatOptions,
	onToken: ((text: string) => void) | undefined,
	signal: AbortSignal
): Promise<(final: string) => void> {
	let streamed = '';
	let settled = false;

	await followSession(
		host.server,
		directory,
		sessionId,
		{
			onText: (delta) => {
				if (settled) return;

				streamed += delta;
				onToken?.(delta);
			},
			onReasoning: (delta) => {
				if (!settled) opts.onReasoning?.(delta);
			}
		},
		signal
	);

	return (final) => {
		if (settled) return;

		settled = true;
		if (final.startsWith(streamed) && final.length > streamed.length) onToken?.(final.slice(streamed.length));
	};
}

/**
 * One model call through OpenCode, in an empty directory with every tool and
 * permission off. Recoder still runs the review loop; OpenCode only carries
 * the model call. A call on its own gets a throwaway session; calls of one
 * conversation share a session, see {@link openTurn}.
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
	const directory = await emptyDirectory(OPENCODE_EMPTY_DIR);
	let turn: SessionTurn | null = null;
	let settle: (final: string) => void = () => {};
	let ok = false;

	try {
		splitModel(opts.model);

		if (onToken || opts.onReasoning) {
			settle = await followDeltas(
				host,
				directory,
				() => turn?.session ?? null,
				opts,
				onToken,
				AbortSignal.any([signal, stream.signal])
			);
		}

		const prompt = promptParts(opts);
		const variant = await variantFor(host, opts);

		turn = await openTurn({
			server: host.server,
			directory,
			model: opts.model,
			system: prompt.system,
			variant,
			turns: prompt.turns,
			conversation: opts.conversation,
			signal
		});

		const reply = await (
			await host.server.api()
		).prompt({
			session: turn.session,
			directory,
			text: turn.text,
			model: opts.model,
			system: prompt.system,
			variant,
			tools: [],
			schema: opts.jsonSchema?.schema,
			timeoutMs,
			signal
		});

		if (reply.tokens) opts.onUsage?.(reply.tokens);
		if (reply.error) throw reply.error;

		const text = replyText(reply, !!opts.jsonSchema);

		turn.commit(text, reply.id);
		ok = true;
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
		await turn?.end(ok, signal.aborted);
	}
}
