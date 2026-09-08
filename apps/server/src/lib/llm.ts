/**
 * Minimal OpenAI-compatible chat client (plain fetch, no SDK).
 * Works against vLLM, OpenRouter, DashScope, or anything else speaking
 * POST {baseUrl}/chat/completions.
 */

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatOptions {
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
}

export class LlmError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Global cap on concurrent model calls. A review fans out to dozens of
 * calls (10 roles × 3 scouts + synthesis); unbounded concurrency thrashes
 * a local GPU server and slows everything down. Tune with
 * RECODER_LLM_CONCURRENCY (default 4).
 */
let llmActive = 0;
const llmWaiters: (() => void)[] = [];

function llmLimit(): number {
	const raw = Number(process.env.RECODER_LLM_CONCURRENCY);
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
}

async function acquireLlmSlot(): Promise<void> {
	if (llmActive < llmLimit()) {
		llmActive++;
		return;
	}
	await new Promise<void>((resolve) => llmWaiters.push(resolve));
	llmActive++;
}

function releaseLlmSlot(): void {
	llmActive--;
	const next = llmWaiters.shift();
	if (next) next();
}

/** Test helper: reset the limiter between tests. */
export function resetLlmLimiter(): void {
	llmActive = 0;
	llmWaiters.length = 0;
}

/** SSE `data:` payload shape for OpenAI-compatible chat chunk streams. */
interface ChatChunk {
	choices?: { delta?: { content?: string | null } }[];
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
	let state: 'queued' | 'running' = 'queued';
	let started = Date.now();
	const report = () => opts.onProgress?.(state, Date.now() - started);
	report();
	const heartbeat = setInterval(report, 5000);
	let acquired = false;
	try {
		await acquireLlmSlot();
		acquired = true;
		state = 'running';
		started = Date.now();
		report();
		return await chatCompletionInner(opts);
	} finally {
		clearInterval(heartbeat);
		if (acquired) releaseLlmSlot();
	}
}

async function chatCompletionInner(opts: ChatOptions): Promise<string> {
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
			choices?: { message?: { content?: string | null } }[];
		};
		const content = body.choices?.[0]?.message?.content;
		if (!content) throw new LlmError(res.status, 'LLM returned no content');
		return content;
	} catch (err) {
		if (err instanceof LlmError) throw err;
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
	await acquireLlmSlot();
	try {
		return await streamChatCompletionInner(opts, onToken);
	} finally {
		releaseLlmSlot();
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
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (!ended) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
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
				try {
					const text = (JSON.parse(data) as ChatChunk).choices?.[0]?.delta?.content;
					if (text) {
						full += text;
						onToken(text);
					}
				} catch {
					// Heartbeats / comments — safe to ignore.
				}
			}
		}
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
