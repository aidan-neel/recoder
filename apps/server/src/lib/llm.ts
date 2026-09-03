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
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export class LlmError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
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
