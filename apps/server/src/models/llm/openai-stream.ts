import { normalizeTokenUsage } from '../metrics';
import { LlmError } from './errors';
import { abortedPromise, attemptController, attemptFailure, postChat, readChatResponse } from './openai-compatible';
import { sleep } from './retry';
import { sseData } from './sse';
import type { ChatOptions } from './types';

/** SSE `data:` payload shape for OpenAI-compatible chat chunk streams. */
interface ChatChunk {
	choices?: {
		finish_reason?: string;
		delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
	}[];
	usage?: unknown;
	error?: { message?: string };
}

/** What a stream has produced so far. */
interface StreamState {
	full: string;
	error?: string;
}

/** A stream with no bytes for this long is dead (RECODER_LLM_IDLE_MS, default 45s). */
function streamIdleMs(): number {
	const raw = Number(process.env.RECODER_LLM_IDLE_MS);

	return Number.isFinite(raw) && raw >= 1_000 ? raw : 45_000;
}

/** Abort `controller` once no data has arrived for `idleMs`; call `touch` on every read. */
function idleWatchdog(controller: AbortController, idleMs: number) {
	let lastData = Date.now();
	let stalled = false;

	const interval = setInterval(
		() => {
			if (Date.now() - lastData > idleMs) {
				stalled = true;
				controller.abort();
			}
		},
		Math.min(5_000, idleMs)
	);

	return {
		touch: () => {
			lastData = Date.now();
		},
		stalled: () => stalled,
		stop: () => clearInterval(interval)
	};
}

/**
 * Apply one chunk. Errors and truncation are recorded rather than thrown,
 * because providers can still send the final usage after them.
 */
function applyChunk(chunk: ChatChunk, state: StreamState, opts: ChatOptions, onToken: (text: string) => void): void {
	const choice = chunk.choices?.[0];

	if (chunk.usage) opts.onUsage?.(normalizeTokenUsage(chunk.usage, 'openai-compatible'));
	if (chunk.error) state.error = chunk.error.message || 'Model stream failed';

	if (choice?.finish_reason === 'length') {
		state.error = 'Model output truncated at the output-token limit';
	}

	const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;

	if (reasoning) opts.onReasoning?.(reasoning);

	const text = choice?.delta?.content;

	if (text) {
		state.full += text;
		onToken(text);
	}
}

function parseChunk(data: string): ChatChunk | undefined {
	try {
		return JSON.parse(data) as ChatChunk;
	} catch {
		return undefined;
	}
}

/**
 * Let go of the body reader. Cancelling a wedged stream can itself never
 * settle, so it gets a second at most, and `releaseLock` throws while a read
 * is still pending on the dead socket.
 */
async function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	await Promise.race([reader.cancel().catch(() => {}), sleep(1_000).catch(() => {})]);

	try {
		reader.releaseLock();
	} catch {}
}

/**
 * One streaming chat completion attempt. Forwards each content delta to
 * `onToken` and resolves with the full text. Some compatible endpoints answer
 * with a plain JSON reply despite `stream: true`; that reply is passed through whole.
 */
export async function streamChat(opts: ChatOptions, onToken: (text: string) => void): Promise<string> {
	const { controller, dispose } = attemptController(opts);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

	const cancelReader = () => {
		void reader?.cancel().catch(() => {});
	};

	controller.signal.addEventListener('abort', cancelReader, { once: true });

	const aborted = abortedPromise(controller.signal);
	const idleMs = streamIdleMs();
	const watchdog = idleWatchdog(controller, idleMs);

	try {
		const res = await postChat(opts, controller.signal, true);

		if (res.headers.get('content-type')?.includes('application/json')) {
			const text = await readChatResponse(res, opts);

			onToken(text);

			return text;
		}

		const state: StreamState = { full: '' };

		reader = res.body!.getReader();

		for await (const data of sseData(reader, controller.signal, aborted, watchdog.touch)) {
			if (data === '[DONE]') break;

			const chunk = parseChunk(data);

			if (chunk !== undefined) applyChunk(chunk, state, opts, onToken);
		}

		if (state.error) throw new LlmError(0, state.error);
		if (!state.full) throw new LlmError(res.status, 'LLM returned no content');

		return state.full;
	} catch (err) {
		throw attemptFailure(err, controller, opts, watchdog.stalled() ? idleMs : undefined);
	} finally {
		dispose();
		watchdog.stop();
		controller.signal.removeEventListener('abort', cancelReader);
		if (reader) await releaseReader(reader);
	}
}
