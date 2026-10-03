import { normalizeTokenUsage } from '../metrics';
import { asLlmError, cancelledError, LlmError, timedOutError } from './errors';
import { reasoningFields, responseFormat, thinkingFields } from './request-fields';
import { DEFAULT_TIMEOUT_MS, type ChatOptions } from './types';

/** Non-streaming `/chat/completions` reply body. */
interface ChatResponse {
	choices?: {
		finish_reason?: string;
		message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
	}[];
	usage?: unknown;
}

/**
 * An abort controller for one HTTP attempt. It aborts at the attempt's
 * `timeoutMs` or when the caller's signal does; `dispose` drops both hooks.
 */
export function attemptController(opts: ChatOptions) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const abort = () => controller.abort();

	opts.signal?.addEventListener('abort', abort, { once: true });
	if (opts.signal?.aborted) controller.abort();

	const dispose = () => {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', abort);
	};

	return { controller, dispose };
}

/**
 * Rejects once `signal` aborts. A body read on a half-dead socket doesn't
 * always wake on abort, so reads race against this.
 */
export function abortedPromise(signal: AbortSignal): Promise<never> {
	const aborted = new Promise<never>((_, reject) =>
		signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
	);

	aborted.catch(() => {});

	return aborted;
}

/** POST the chat request and throw an {@link LlmError} for an error status (or, streaming, a missing body). */
export async function postChat(opts: ChatOptions, signal: AbortSignal, stream: boolean): Promise<Response> {
	const res = await fetch(`${opts.baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {})
		},
		body: JSON.stringify({
			model: opts.model,
			messages: opts.messages,
			temperature: opts.temperature ?? 0.2,
			max_tokens: opts.maxTokens ?? 4000,
			...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
			...reasoningFields(opts),
			...(opts.seed !== undefined ? { seed: opts.seed } : {}),
			...responseFormat(opts),
			...thinkingFields(opts)
		}),
		signal
	});

	if (!res.ok || (stream && !res.body)) {
		const text = await res.text().catch(() => res.statusText);

		throw new LlmError(res.status, `LLM ${res.status}: ${text.slice(0, 500)}`);
	}

	return res;
}

/**
 * Turn whatever an attempt threw into an {@link LlmError}. Once the attempt's
 * controller has aborted, the cause is the caller cancelling, an idle stream
 * (`stalledAfterMs`), or the attempt's own timeout.
 */
export function attemptFailure(
	err: unknown,
	controller: AbortController,
	opts: ChatOptions,
	stalledAfterMs?: number
): LlmError {
	if (err instanceof LlmError) return err;

	if (controller.signal.aborted) {
		if (opts.signal?.aborted) return cancelledError();
		if (stalledAfterMs !== undefined)
			return new LlmError(0, `Model stream stalled: no data for ${Math.round(stalledAfterMs / 1000)}s`);

		return timedOutError(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	}

	return asLlmError(err);
}

/** Read a non-streaming reply: report usage and reasoning, then return the content. */
export async function readChatResponse(res: Response, opts: ChatOptions): Promise<string> {
	const body = (await res.json()) as ChatResponse;
	const choice = body.choices?.[0];

	opts.onUsage?.(normalizeTokenUsage(body.usage, 'openai-compatible'));

	const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;

	if (typeof reasoning === 'string' && reasoning) opts.onReasoning?.(reasoning);

	if (choice?.finish_reason === 'length') {
		throw new LlmError(0, 'Model output truncated at the output-token limit; return a shorter JSON result');
	}

	const content = choice?.message?.content;

	if (!content) throw new LlmError(res.status, 'LLM returned no content');

	return content;
}

/** One non-streaming chat completion attempt. */
export async function requestChat(opts: ChatOptions): Promise<string> {
	const { controller, dispose } = attemptController(opts);

	try {
		const res = await postChat(opts, controller.signal, false);

		return await Promise.race([readChatResponse(res, opts), abortedPromise(controller.signal)]);
	} catch (err) {
		throw attemptFailure(err, controller, opts);
	} finally {
		dispose();
	}
}
