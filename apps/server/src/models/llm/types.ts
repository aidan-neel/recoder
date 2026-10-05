import type { ModelProvider, OutputRate, ReasoningEffort, TokenUsage } from '@recoder/shared';

import type { ChatConversation } from './conversation';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatOptions {
	reasoningEffort?: ReasoningEffort;
	/** Selects the transport a call goes through; unset means OpenAI-compatible. */
	provider?: ModelProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	/**
	 * The run of calls this one belongs to. `messages` still carries the whole
	 * transcript; a transport that keeps a session sends only what was added.
	 */
	conversation?: ChatConversation;
	/** Response format hint; ignored by servers that don't support it. */
	jsonMode?: boolean;
	/**
	 * Constrain the reply to this JSON schema (vLLM/SGLang guided decoding,
	 * OpenAI structured outputs). Endpoints that refuse it fall back to `jsonMode`.
	 */
	jsonSchema?: { name: string; schema: Record<string, unknown> };
	/** `null` leaves the field out of the request; unset sends the default. */
	temperature?: number | null;
	topP?: number;
	/** Fixed seed for deterministic output. Only sent when set (some servers reject unknown fields). */
	seed?: number;
	maxTokens?: number;
	/** The call's own budget, counted from when it gets a concurrency slot. */
	timeoutMs?: number;
	/**
	 * Wall-clock time (epoch ms) the call must settle by, slot wait included.
	 * Unset, the wait for a slot is bounded by `timeoutMs` alone.
	 */
	settleBy?: number;
	signal?: AbortSignal;
	/** Observable request lifecycle, including time waiting for a concurrency slot. */
	onProgress?: (state: 'queued' | 'running', elapsedMs: number) => void;
	/** Latest cumulative usage for this request, not a delta. */
	onUsage?: (usage: TokenUsage) => void;
	/** Provider-disclosed reasoning/thinking text, streamed as deltas when available. */
	onReasoning?: (text: string) => void;
	/** Output speed as the call streams (estimated), then its average once it ends. */
	onRate?: (rate: OutputRate) => void;
	/** false: ask the model to answer without a thinking phase (quick summaries). */
	thinking?: boolean;
}

/** Whole-call budget when the caller sets no `timeoutMs`. */
export const DEFAULT_TIMEOUT_MS = 120_000;
