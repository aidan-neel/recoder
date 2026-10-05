import { expect } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import type { OpenCodeAgent } from '../../src/agents/opencode/opencode';
import type { ChatOptions } from '../../src/models/llm/types';

export interface Call {
	method: string;
	path: string;
	body: Record<string, unknown> | null;
	query?: string;
}

/** A one-message chat on the model `openai/m` the fake servers offer. */
export function ask(prompt: string, extra: Partial<ChatOptions> = {}): ChatOptions {
	return { baseUrl: '', apiKey: '', model: 'openai/m', messages: [{ role: 'user', content: prompt }], ...extra };
}

/** Every request the fake server has seen. */
export async function calls(target: OpenCodeAgent): Promise<Call[]> {
	return (await target.request('/test/calls')) as Call[];
}

/** A plain chat that must stream only its own text and reasoning, in order; returns the usage it reported. */
export async function streamedUsage(target: OpenCodeAgent): Promise<TokenUsage | undefined> {
	const tokens: string[] = [];
	const reasoning: string[] = [];
	let usage: TokenUsage | undefined;

	const text = await target.complete(
		ask('hi', { onReasoning: (r) => reasoning.push(r), onUsage: (u) => (usage = u) }),
		(t) => tokens.push(t)
	);

	expect(text).toBe('Hello world');
	expect(tokens).toEqual(['Hello', ' world']);
	expect(reasoning).toEqual(['Thinking']);

	return usage;
}

/** Chats that fail must keep the provider's own status and message. */
export async function expectProviderStatuses(target: OpenCodeAgent): Promise<void> {
	await expect(target.complete(ask('denied'))).rejects.toMatchObject({
		status: 403,
		message: 'Free tier is not available here.'
	});

	await expect(target.complete(ask('auth'))).rejects.toMatchObject({ status: 401 });
}

/** Runs the `slow` chat, aborts it once its prompt is on the wire, and returns what the call rejected with. */
export async function cancelledChat(target: OpenCodeAgent, promptPath: string): Promise<unknown> {
	const controller = new AbortController();
	const rejected = target.complete(ask('slow', { signal: controller.signal })).catch((error: unknown) => error);

	for (let i = 0; i < 100 && !(await calls(target)).some((c) => c.path === promptPath); i++) await Bun.sleep(10);
	controller.abort();

	return rejected;
}
