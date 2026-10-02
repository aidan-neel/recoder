/**
 * Minimal OpenAI-compatible chat client (plain fetch, no SDK).
 * Works against vLLM, OpenRouter, DashScope, or anything else speaking
 * POST {baseUrl}/chat/completions.
 */

import type { ReasoningEffort, TokenUsage } from '@recoder/shared';
import { normalizeTokenUsage, trackTokenCall } from './metrics';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatOptions {
	reasoningEffort?: ReasoningEffort;
	provider?: 'openai-compatible' | 'codex';
	baseUrl: string;
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	/** Response format hint; ignored by servers that don't support it. */
	jsonMode?: boolean;
	/**
	 * Constrain the reply to this JSON schema (vLLM/SGLang guided decoding,
	 * OpenAI structured outputs). Endpoints that refuse it fall back to `jsonMode`.
	 */
	jsonSchema?: { name: string; schema: Record<string, unknown> };
	temperature?: number;
	/** Fixed seed for deterministic output. Only sent when set (some servers reject unknown fields). */
	seed?: number;
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Observable request lifecycle, including time waiting for a concurrency slot. */
	onProgress?: (state: 'queued' | 'running', elapsedMs: number) => void;
	/** Latest cumulative usage for this request, not a delta. */
	onUsage?: (usage: TokenUsage) => void;
	/** Provider-disclosed reasoning/thinking text, streamed as deltas when available. */
	onReasoning?: (text: string) => void;
	/** false: ask the model to answer without a thinking phase (quick summaries). */
	thinking?: boolean;
}

/** Endpoints that rejected `chat_template_kwargs`; later calls leave it off. */
const noTemplateKwargs = new Set<string>();

/** vLLM/SGLang templates read `enable_thinking`; strict providers may reject the field. */
function thinkingFields(opts: ChatOptions): Record<string, unknown> {
	return opts.thinking === false && !noTemplateKwargs.has(opts.baseUrl) ? { chat_template_kwargs: { enable_thinking: false } } : {};
}

/** Endpoints that rejected `json_schema` response formats; later calls send plain JSON mode. */
const noJsonSchema = new Set<string>();

function responseFormat(opts: ChatOptions): Record<string, unknown> {
	if (opts.jsonSchema && !noJsonSchema.has(opts.baseUrl)) return { response_format: { type: 'json_schema', json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema } } };
	return opts.jsonMode || opts.jsonSchema ? { response_format: { type: 'json_object' } } : {};
}

/** Retry in plain JSON mode when an endpoint refuses a schema-constrained reply. */
async function withSchemaFallback<T>(opts: ChatOptions, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (opts.jsonSchema && !noJsonSchema.has(opts.baseUrl) && err instanceof LlmError && err.status >= 400 && err.status < 500 && /response_format|json_schema|schema|guided|structured/i.test(err.message)) {
			noJsonSchema.add(opts.baseUrl);
			if (opts.signal?.aborted) throw err;
			return run();
		}
		throw err;
	}
}

/** Retry once without the thinking switch when an endpoint refuses it. */
/** OpenRouter takes effort as `reasoning: { effort }`; other OpenAI-compatible servers take `reasoning_effort`. */
export function reasoningFields(opts: Pick<ChatOptions, 'baseUrl' | 'reasoningEffort'>): Record<string, unknown> {
	if (opts.reasoningEffort === undefined) return {};
	return /(^|\.)openrouter\.ai$/i.test(hostOf(opts.baseUrl))
		? { reasoning: { effort: opts.reasoningEffort } }
		: { reasoning_effort: opts.reasoningEffort };
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

async function withThinkingFallback<T>(opts: ChatOptions, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (opts.thinking === false && !noTemplateKwargs.has(opts.baseUrl) && err instanceof LlmError && err.status >= 400 && err.status < 500 && /chat_template_kwargs|enable_thinking|unrecognized|unknown (field|parameter)|extra (fields|inputs)/i.test(err.message)) {
			noTemplateKwargs.add(opts.baseUrl);
			if (opts.signal?.aborted) throw err;
			return run();
		}
		throw err;
	}
}

export class LlmError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK = /stalled|socket|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|fetch failed|network|connection (?:was )?(?:closed|reset|refused|lost)|other side closed|Unable to connect|terminated/i;

/** ChatGPT's own wording for a dropped or cut-short response stream. */
const CODEX_TRANSIENT = /response failed|incomplete response|could not complete/i;

/** Dropped sockets and overloaded servers (vLLM restarts, proxies) are worth another try; bad requests are not. */
export function isTransientLlmError(err: unknown, provider?: ChatOptions['provider']): boolean {
	if (!(err instanceof LlmError)) return false;
	// ChatGPT's 429 is a usage cap that lasts hours, not a momentary rate limit.
	if (provider === 'codex' && err.status === 429) return false;
	if (TRANSIENT_STATUS.has(err.status)) return true;
	if (err.status !== 0 || /cancelled|timed out|truncated/i.test(err.message)) return false;
	return TRANSIENT_NETWORK.test(err.message) || (provider === 'codex' && CODEX_TRANSIENT.test(err.message));
}

/** A stream with no bytes for this long is dead (RECODER_LLM_IDLE_MS, default 45s). */
function streamIdleMs(): number {
	const raw = Number(process.env.RECODER_LLM_IDLE_MS);
	return Number.isFinite(raw) && raw >= 1_000 ? raw : 45_000;
}

function llmRetries(): number {
	const raw = Number(process.env.RECODER_LLM_RETRIES);
	return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new LlmError(0, 'Model request cancelled'));
		const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
		const onAbort = () => { clearTimeout(timer); reject(new LlmError(0, 'Model request cancelled')); };
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Run one model request, retrying transient failures with backoff (1s, 2s, 4s…
 * capped at 15s) while the request's deadline allows. `canRetry` lets streaming
 * callers stop once text has reached the user.
 */
async function withRetries<T>(
	opts: Pick<ChatOptions, 'signal' | 'timeoutMs' | 'provider'>,
	deadline: number,
	attempt: (timeoutMs: number) => Promise<T>,
	canRetry: () => boolean = () => true
): Promise<T> {
	const max = llmRetries();
	for (let tries = 0; ; tries++) {
		try {
			return await attempt(Math.max(1, deadline - Date.now()));
		} catch (err) {
			const wait = Math.min(15_000, 1_000 * 2 ** tries);
			if (opts.signal?.aborted || tries >= max || !isTransientLlmError(err, opts.provider) || !canRetry() || Date.now() + wait >= deadline - 5_000) throw err;
			console.warn(`[llm] ${(err as Error).message} — retrying in ${wait / 1000}s (${tries + 1}/${max})`);
			await sleep(wait, opts.signal);
		}
	}
}


/**
 * Settle at the deadline (or on cancel) no matter what `work` is stuck on.
 * Every layer below aborts its own fetch, but a socket can wedge somewhere an
 * abort doesn't reach; without this a review waits on that call forever and
 * the model slot it holds is never given back.
 */
function withHardDeadline<T>(work: Promise<T>, deadline: number, timeoutMs: number, signal?: AbortSignal): Promise<T> {
	work.catch(() => {});
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const backstop = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new LlmError(0, `Model request timed out after ${Math.round(timeoutMs / 1000)}s`)),
			// A little grace so the request can report its own timeout (or a stall) first.
			Math.max(0, deadline - Date.now()) + Math.min(5_000, Math.max(250, timeoutMs / 10))
		);
		onAbort = () => reject(new LlmError(0, 'Model request cancelled'));
		if (signal?.aborted) onAbort();
		else signal?.addEventListener('abort', onAbort, { once: true });
	});
	return Promise.race([work, backstop]).finally(() => {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	});
}

/**
 * One call's lifetime. Its signal aborts with the caller's or once the call
 * settles, so retries and the thinking fallback stop, and `live` drops
 * callbacks from work that outlived the call (a transport that ignored abort).
 */
function requestScope(signal?: AbortSignal) {
	const settled = new AbortController();
	const scoped = signal ? AbortSignal.any([signal, settled.signal]) : settled.signal;
	const live = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => { if (!scoped.aborted) fn(...args); };
	return { signal: scoped, live, end: () => settled.abort() };
}

/**
 * Global cap shared by review assignments and interactive discussions.
 * Bound concurrency to avoid overwhelming the model endpoint. Tune with
 * RECODER_LLM_CONCURRENCY (default 8, enough for every specialist at once).
 * Acquire a slot only when a concrete call is ready — never pre-create
 * hundreds of waiting promises.
 */
let llmActive = 0;
const llmWaiters: (() => void)[] = [];

function llmLimit(): number {
	const raw = Number(process.env.RECODER_LLM_CONCURRENCY);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

async function acquireLlmSlot(signal?: AbortSignal, timeoutMs = 120_000): Promise<void> {
	if (signal?.aborted) throw new LlmError(0, 'Model request cancelled');
	if (llmActive < llmLimit()) {
		llmActive++;
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		};
		const grant = () => { cleanup(); resolve(); };
		const fail = (message: string) => {
			const index = llmWaiters.indexOf(grant);
			if (index < 0) return;
			llmWaiters.splice(index, 1);
			cleanup();
			reject(new LlmError(0, message));
		};
		const abort = () => fail('Model request cancelled');
		const timer = setTimeout(() => fail('Timed out waiting for model capacity'), timeoutMs);
		llmWaiters.push(grant);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function releaseLlmSlot(): void {
	const next = llmWaiters.shift();
	// Transfer the occupied slot directly; new callers cannot steal it.
	if (next) next();
	else llmActive--;
}

/** Test helper: reset the limiter between tests. */
export function resetLlmLimiter(): void {
	llmActive = 0;
	llmWaiters.length = 0;
}

/** SSE `data:` payload shape for OpenAI-compatible chat chunk streams. */
interface ChatChunk {
	choices?: {
		finish_reason?: string;
		delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
	}[];
	usage?: unknown;
	error?: { message?: string };
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
	const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
	let state: 'queued' | 'running' = 'queued';
	let started = Date.now();
	const report = () => opts.onProgress?.(state, Date.now() - started);
	report();
	const heartbeat = setInterval(report, 5000);
	let acquired = false;
	let tracking: ReturnType<typeof trackTokenCall> | undefined;
	let success = false;
	const scope = requestScope(opts.signal);
	try {
		await acquireLlmSlot(opts.signal, Math.max(1, deadline - Date.now()));
		acquired = true;
		state = 'running';
		started = Date.now();
		report();
		tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');
		const remaining = {
			...opts,
			signal: scope.signal,
			timeoutMs: Math.max(1, deadline - Date.now()),
			onUsage: scope.live((usage: TokenUsage) => { tracking!.usage(usage); opts.onUsage?.(usage); }),
			onReasoning: opts.onReasoning && scope.live(opts.onReasoning)
		};
		const work = opts.provider === 'codex'
			? import('./codex').then(({ codex }) => withRetries(remaining, deadline, async (timeoutMs) => {
				try { return await codex.complete({ ...remaining, timeoutMs }); }
				catch (error) { if (error instanceof LlmError) throw error; throw new LlmError(0, 'ChatGPT request failed'); }
			}))
			: withRetries(remaining, deadline, (timeoutMs) => withThinkingFallback(remaining, () => withSchemaFallback(remaining, () => remaining.onReasoning
				? streamChatCompletionInner({ ...remaining, timeoutMs }, () => {})
				: chatCompletionInner({ ...remaining, timeoutMs }))));
		const result = await withHardDeadline(work, deadline, opts.timeoutMs ?? 120_000, opts.signal);
		success = true;
		return result;
	} finally {
		scope.end();
		clearInterval(heartbeat);
		if (acquired) releaseLlmSlot();
		tracking?.finish(success);
	}
}

async function chatCompletionInner(opts: ChatOptions): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
	const abort = () => controller.abort();
	opts.signal?.addEventListener('abort', abort, { once: true });
	if (opts.signal?.aborted) controller.abort();

	try {
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
				...reasoningFields(opts),
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
				...responseFormat(opts),
				...thinkingFields(opts)
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const text = await res.text().catch(() => res.statusText);
			throw new LlmError(res.status, `LLM ${res.status}: ${text.slice(0, 500)}`);
		}
		const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
		aborted.catch(() => {});
		return await Promise.race([readChatResponse(res, opts), aborted]);
	} catch (err) {
		if (err instanceof LlmError) throw err;
		if (controller.signal.aborted) {
			throw new LlmError(0, opts.signal?.aborted ? 'Model request cancelled' : `Model request timed out after ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s`);
		}
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', abort);
	}
}

async function readChatResponse(res: Response, opts: ChatOptions): Promise<string> {
	const body = await res.json() as {
		choices?: { finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[];
		usage?: unknown;
	};
	opts.onUsage?.(normalizeTokenUsage(body.usage, 'openai-compatible'));
	const reasoning = body.choices?.[0]?.message?.reasoning_content ?? body.choices?.[0]?.message?.reasoning;
	if (typeof reasoning === 'string' && reasoning) opts.onReasoning?.(reasoning);
	if (body.choices?.[0]?.finish_reason === 'length') {
		throw new LlmError(0, 'Model output truncated at the output-token limit; return a shorter JSON result');
	}
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new LlmError(res.status, 'LLM returned no content');
	return content;
}

/**
 * Streaming variant of {@link chatCompletion}. Forwards each content delta to
 * `onToken` as it arrives and resolves with the full text once the stream ends.
 */
export async function streamChatCompletion(
	opts: ChatOptions,
	onToken: (text: string) => void
): Promise<string> {
	const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
	let state: 'queued' | 'running' = 'queued';
	let started = Date.now();
	const report = () => opts.onProgress?.(state, Date.now() - started);
	report();
	const heartbeat = setInterval(report, 5000);
	let acquired = false;
	let tracking: ReturnType<typeof trackTokenCall> | undefined;
	let success = false;
	const scope = requestScope(opts.signal);
	try {
		await acquireLlmSlot(opts.signal, Math.max(1, deadline - Date.now()));
		acquired = true;
		state = 'running';
		started = Date.now();
		report();
		tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');
		const remaining = {
			...opts,
			signal: scope.signal,
			timeoutMs: Math.max(1, deadline - Date.now()),
			onUsage: scope.live((usage: TokenUsage) => { tracking!.usage(usage); opts.onUsage?.(usage); }),
			onReasoning: opts.onReasoning && scope.live(opts.onReasoning)
		};
		// Once text has streamed to the user a retry would repeat it, so only retry before the first token.
		let streamed = false;
		const forward = scope.live((text: string) => { streamed = true; onToken(text); });
		const work = opts.provider === 'codex'
			? withRetries(remaining, deadline, async (timeoutMs) => (await import('./codex')).codex.complete({ ...remaining, timeoutMs }, forward), () => !streamed)
			: withRetries(remaining, deadline, (timeoutMs) => withThinkingFallback(remaining, () => withSchemaFallback(remaining, () => streamChatCompletionInner({ ...remaining, timeoutMs }, forward))), () => !streamed);
		const result = await withHardDeadline(work, deadline, opts.timeoutMs ?? 120_000, opts.signal);
		success = true;
		return result;
	} finally {
		scope.end();
		clearInterval(heartbeat);
		if (acquired) releaseLlmSlot();
		tracking?.finish(success);
	}
}

async function streamChatCompletionInner(
	opts: ChatOptions,
	onToken: (text: string) => void
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
	const abort = () => controller.abort();
	opts.signal?.addEventListener('abort', abort, { once: true });
	if (opts.signal?.aborted) controller.abort();
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const cancelReader = () => { void reader?.cancel().catch(() => {}); };
	controller.signal.addEventListener('abort', cancelReader, { once: true });
	// Aborting doesn't always wake a pending read on a half-dead socket, so race
	// every read against the abort, and abort a stream that goes quiet.
	const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
	aborted.catch(() => {});
	let lastData = Date.now();
	let stalled = false;
	const idleMs = streamIdleMs();
	const watchdog = setInterval(() => {
		if (Date.now() - lastData > idleMs) { stalled = true; controller.abort(); }
	}, Math.min(5_000, idleMs));

	try {
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
				stream: true,
				stream_options: { include_usage: true },
				...reasoningFields(opts),
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
				...responseFormat(opts),
				...thinkingFields(opts)
			}),
			signal: controller.signal
		});
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => res.statusText);
			throw new LlmError(res.status, `LLM ${res.status}: ${text.slice(0, 500)}`);
		}
		// Some compatible endpoints return a normal response despite stream=true.
		if (res.headers.get('content-type')?.includes('application/json')) {
			const text = await readChatResponse(res, opts);
			onToken(text);
			return text;
		}
		let full = '';
		let ended = false;
		let streamError: string | undefined;
		reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (!ended) {
			controller.signal.throwIfAborted();
			const { done, value } = await Promise.race([reader.read(), aborted]);
			lastData = Date.now();
			controller.signal.throwIfAborted();
			buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (data === '[DONE]') {
					ended = true;
					break;
				}
				let chunk: ChatChunk;
				try { chunk = JSON.parse(data) as ChatChunk; }
				catch { continue; }
				if (chunk.usage) opts.onUsage?.(normalizeTokenUsage(chunk.usage, 'openai-compatible'));
				// Keep reading: providers can send final usage after the finish/error chunk.
				if (chunk.error) streamError = chunk.error.message || 'Model stream failed';
				if (chunk.choices?.[0]?.finish_reason === 'length') {
					streamError = 'Model output truncated at the output-token limit';
				}
				const reasoning = chunk.choices?.[0]?.delta?.reasoning_content ?? chunk.choices?.[0]?.delta?.reasoning;
				if (reasoning) opts.onReasoning?.(reasoning);
				const text = chunk.choices?.[0]?.delta?.content;
				if (text) {
					full += text;
					onToken(text);
				}
			}
			if (done) break;
		}
		if (streamError) throw new LlmError(0, streamError);
		if (!full) throw new LlmError(res.status, 'LLM returned no content');
		return full;
	} catch (err) {
		if (err instanceof LlmError) throw err;
		if (controller.signal.aborted) {
			if (opts.signal?.aborted) throw new LlmError(0, 'Model request cancelled');
			if (stalled) throw new LlmError(0, `Model stream stalled: no data for ${Math.round(idleMs / 1000)}s`);
			throw new LlmError(0, `Model request timed out after ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s`);
		}
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	} finally {
		clearTimeout(timer);
		clearInterval(watchdog);
		opts.signal?.removeEventListener('abort', abort);
		controller.signal.removeEventListener('abort', cancelReader);
		// Cancelling a wedged stream can itself never settle; don't wait on it for long.
		if (reader) {
			await Promise.race([reader.cancel().catch(() => {}), sleep(1_000).catch(() => {})]);
			try { reader.releaseLock(); } catch { /* a read is still pending on the dead socket */ }
		}
	}
}
