import type { ChatOptions } from './llm';
import { LlmError } from './llm';
import { normalizeTokenUsage } from './metrics';

type OutputItem = { id?: string; type?: string; role?: string; phase?: string; content?: Array<{ type?: string; text?: string }>; summary?: Array<{ type?: string; text?: string }> };
type ResponseData = { status?: string; output?: OutputItem[]; usage?: Record<string, any>; incomplete_details?: { reason?: string }; error?: { code?: string } };
type ResponseEvent = { type?: string; item_id?: string; output_index?: number; summary_index?: number; content_index?: number; delta?: string; text?: string; part?: { text?: string }; item?: OutputItem; response?: ResponseData; code?: string };

/** Preserve roles instead of embedding the conversation in one JSON user message. */
export function chatGptRequest(opts: ChatOptions): Record<string, unknown> {
	const instructions = opts.messages.filter((message) => message.role === 'system').map((message) => message.content);
	if (opts.jsonMode) instructions.push('Return a single valid JSON object, without markdown fences.');
	return {
		model: opts.model, store: false, stream: true,
		instructions: instructions.join('\n\n') || 'You are a code reviewer. Respond to the supplied conversation.',
		input: opts.messages.filter((message) => message.role !== 'system').map((message) => ({
			type: 'message', role: message.role,
			content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }]
		})),
		reasoning: { effort: opts.reasoningEffort ?? 'low', ...(opts.onReasoning ? { summary: 'auto' } : {}) },
		tools: [], tool_choice: 'none', parallel_tool_calls: false, include: []
		// The ChatGPT endpoint does not accept max_output_tokens, temperature or
		// seed. Recoder retains its deadlines and bounded evidence/tool loop.
	};
}

function finalItem(item: OutputItem): boolean {
	return item.type === 'message' && item.role === 'assistant' && (!item.phase || item.phase === 'final_answer');
}

function itemText(item: OutputItem): string {
	return (item.content ?? []).filter((content) => content.type === 'output_text' && typeof content.text === 'string').map((content) => content.text).join('');
}

function streamFailure(event: ResponseEvent): LlmError {
	const code = event.response?.error?.code ?? event.code;
	if (code === 'usage_limit_reached' || code === 'rate_limit_exceeded') return new LlmError(429, 'ChatGPT usage limit reached. Check Usage in Connections for reset times.');
	if (code === 'context_length_exceeded') return new LlmError(400, 'The review exceeds this ChatGPT model’s context window. Reduce the review scope.');
	if (event.type === 'response.incomplete') return new LlmError(0, event.response?.incomplete_details?.reason === 'max_output_tokens'
		? 'ChatGPT output was truncated at the output-token limit. Return a shorter result.' : 'ChatGPT returned an incomplete response. Try again.');
	return new LlmError(0, 'ChatGPT could not complete the model response. Try again.');
}

/** Parse Responses SSE, forwarding only assistant output text and terminal usage. */
export async function readChatGptResponse(response: Response, opts: ChatOptions, signal: AbortSignal, onToken?: (text: string) => void): Promise<string> {
	if (!response.body) throw new LlmError(502, 'ChatGPT returned an empty response stream.');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const items = new Map<string, OutputItem>();
	const deltas = new Map<string, string>();
	const reasoningParts = new Map<string, string>();
	const reportReasoning = (key: string, text: string, delta = false) => {
		const previous = reasoningParts.get(key) ?? '';
		const next = delta ? previous + text : text;
		if (!next.startsWith(previous) || next === previous) return;
		const separator = !reasoningParts.has(key) && reasoningParts.size > 0 ? '\n\n' : '';
		reasoningParts.set(key, next);
		opts.onReasoning?.(separator + next.slice(previous.length));
	};
	const reportSummary = (item: OutputItem, key: string) => {
		if (item.type !== 'reasoning') return;
		item.summary?.forEach((part, index) => {
			if (part.text) reportReasoning(`${key}:${index}`, part.text);
		});
	};
	let streamed = '';
	let final = '';
	let completed = false;
	let buffer = '';
	let data: string[] = [];
	let dataSize = 0;
	let eventName = '';
	let outputSize = 0;
	const abort = () => { void reader.cancel().catch(() => {}); };
	signal.addEventListener('abort', abort, { once: true });

	const dispatch = () => {
		if (!data.length) { eventName = ''; return; }
		const payload = data.join('\n');
		data = []; dataSize = 0;
		if (payload === '[DONE]') { eventName = ''; return; }
		let event: ResponseEvent;
		try { event = JSON.parse(payload); }
		catch { throw new LlmError(502, 'ChatGPT returned a malformed response event.'); }
		if (!event || typeof event !== 'object') throw new LlmError(502, 'ChatGPT returned an invalid response event.');
		event.type ??= eventName;
		eventName = '';
		const key = event.item_id ?? event.item?.id ?? String(event.output_index ?? 0);
		if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
			if (event.item) items.set(key, event.item);
			if (event.item && event.type === 'response.output_item.done') reportSummary(event.item, key);
		}
		if (
			(event.type === 'response.reasoning_text.delta' ||
				event.type === 'response.reasoning_summary_text.delta') &&
			typeof event.delta === 'string'
		) {
			reportReasoning(`${key}:${event.summary_index ?? event.content_index ?? 0}`, event.delta, true);
		}
		if (event.type === 'response.reasoning_summary_text.done' && event.text) {
			reportReasoning(`${key}:${event.summary_index ?? 0}`, event.text);
		}
		if (event.type === 'response.reasoning_summary_part.done' && event.part?.text) {
			reportReasoning(`${key}:${event.summary_index ?? 0}`, event.part.text);
		}
		if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
			const item = items.get(key);
			if (!item || finalItem(item)) {
				outputSize += event.delta.length;
				if (outputSize > 16 * 1024 * 1024) throw new LlmError(0, 'ChatGPT output exceeded the response size limit. Return a shorter result.');
				deltas.set(key, (deltas.get(key) ?? '') + event.delta);
				streamed += event.delta;
				onToken?.(event.delta);
			}
		}
		if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type ?? '')) {
			const usage = event.response?.usage;
			if (usage) opts.onUsage?.(normalizeTokenUsage({
				inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
				cachedInputTokens: usage.input_tokens_details?.cached_tokens,
				cacheWriteInputTokens: usage.input_tokens_details?.cache_write_tokens,
				reasoningOutputTokens: usage.output_tokens_details?.reasoning_tokens
			}, 'codex'));
			if (event.type !== 'response.completed' || (event.response?.status && event.response.status !== 'completed')) throw streamFailure(event);
			const output = event.response?.output ?? [...items.values()];
			output.forEach((item, index) => reportSummary(item, item.id ?? String(index)));
			final = output.filter(finalItem).map(itemText).join('') || [...deltas.entries()].filter(([id]) => !items.has(id) || finalItem(items.get(id)!)).map(([, text]) => text).join('');
			if (!final) throw new LlmError(502, 'ChatGPT returned no final answer.');
			if (!streamed) onToken?.(final);
			completed = true;
		}
		if (event.type === 'error') throw streamFailure(event);
	};

	try {
		signal.throwIfAborted();
		while (!completed) {
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true });
			let newline: number;
			while (!completed && (newline = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				if (!line) dispatch();
				else if (line.startsWith('data:')) {
					data.push(line.slice(5).replace(/^ /, ''));
					dataSize += line.length;
				} else if (line.startsWith('event:')) eventName = line.slice(6).trim();
				if (dataSize > 8 * 1024 * 1024) throw new LlmError(502, 'ChatGPT response event exceeded the size limit.');
			}
			if (buffer.length > 8 * 1024 * 1024) throw new LlmError(502, 'ChatGPT response event exceeded the size limit.');
			if (done) break;
		}
		if (!completed) throw new LlmError(502, 'ChatGPT response stream ended before completion. Try again.');
		return final;
	} finally {
		signal.removeEventListener('abort', abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
