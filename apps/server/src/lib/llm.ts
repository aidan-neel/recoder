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
}

export class LlmError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Global cap shared by review assignments and interactive discussions.
 * Bound concurrency to avoid overwhelming the model endpoint. Tune with
 * RECODER_LLM_CONCURRENCY (default 4).
 * Acquire a slot only when a concrete call is ready — never pre-create
 * hundreds of waiting promises.
 */
let llmActive = 0;
const llmWaiters: (() => void)[] = [];

function llmLimit(): number {
	const raw = Number(process.env.RECODER_LLM_CONCURRENCY);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
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
	try {
		await acquireLlmSlot(opts.signal, Math.max(1, deadline - Date.now()));
		acquired = true;
		state = 'running';
		started = Date.now();
		report();
		tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');
		const remaining = { ...opts, timeoutMs: Math.max(1, deadline - Date.now()), onUsage: (usage: TokenUsage) => { tracking!.usage(usage); opts.onUsage?.(usage); } };
		let result: string;
		if (opts.provider === 'codex') {
			const { codex } = await import('./codex');
			try { result = await codex.complete(remaining); }
			catch (error) { if (error instanceof LlmError) throw error; throw new LlmError(0, 'ChatGPT request failed'); }
		} else result = await chatCompletionInner(remaining);
		success = true;
		return result;
	} finally {
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
				authorization: `Bearer ${opts.apiKey}`
			},
			body: JSON.stringify({
				model: opts.model,
				messages: opts.messages,
				temperature: opts.temperature ?? 0.2,
				max_tokens: opts.maxTokens ?? 4000,
				...(opts.reasoningEffort !== undefined ? { reasoning_effort: opts.reasoningEffort } : {}),
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
				...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {})
			}),
			signal: controller.signal
		});
		if (!res.ok) {
			const text = await res.text().catch(() => res.statusText);
			throw new LlmError(res.status, `LLM ${res.status}: ${text.slice(0, 500)}`);
		}
		const body = (await res.json()) as {
			choices?: {
				finish_reason?: string;
				message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
			}[];
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

/**
 * Streaming variant of {@link chatCompletion}. Forwards each content delta to
 * `onToken` as it arrives and resolves with the full text once the stream ends.
 */
export async function streamChatCompletion(
	opts: ChatOptions,
	onToken: (text: string) => void
): Promise<string> {
	const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
	await acquireLlmSlot(opts.signal, Math.max(1, deadline - Date.now()));
	const tracking = trackTokenCall(opts.model, opts.provider ?? 'openai-compatible');
	let success = false;
	try {
		const remaining = { ...opts, timeoutMs: Math.max(1, deadline - Date.now()), onUsage: (usage: TokenUsage) => { tracking.usage(usage); opts.onUsage?.(usage); } };
		const result = opts.provider === 'codex'
			? await (await import('./codex')).codex.complete(remaining, onToken)
			: await streamChatCompletionInner(remaining, onToken);
		success = true;
		return result;
	} finally {
		releaseLlmSlot();
		tracking.finish(success);
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

	try {
		const res = await fetch(`${opts.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${opts.apiKey}`
			},
			body: JSON.stringify({
				model: opts.model,
				messages: opts.messages,
				temperature: opts.temperature ?? 0.2,
				max_tokens: opts.maxTokens ?? 4000,
				stream: true,
				stream_options: { include_usage: true },
				...(opts.reasoningEffort !== undefined ? { reasoning_effort: opts.reasoningEffort } : {}),
				...(opts.seed !== undefined ? { seed: opts.seed } : {})
			}),
			signal: controller.signal
		});
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => res.statusText);
			throw new LlmError(res.status, `LLM ${res.status}: ${text.slice(0, 500)}`);
		}
		let full = '';
		let ended = false;
		let streamError: string | undefined;
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (!ended) {
			const { done, value } = await reader.read();
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
		throw new LlmError(0, err instanceof Error ? err.message : String(err));
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', abort);
	}
}
