import { afterEach, expect, test } from 'bun:test';
import { z } from 'zod';
import { resetLlmLimiter } from '../../src/models/llm';
import { answer } from '../../src/repo-chat/chat-reply';
import { recoderSystemPrompt } from '../../src/repo-chat/identity';
import { chatting, committed, removeChatRepos } from '../helpers/chat-fixture';

afterEach(removeChatRepos);

test('a model that is not an agent CLI still prefetches repository context', async () => {
	const originalFetch = globalThis.fetch;
	const marker = 'WIDGET_MARKER_9f3a';
	const repo = await committed({ 'README.md': `# Shop\n${marker}\n` });
	let body = '';

	const fakeFetch = (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
		if (String(input).endsWith('/chat/completions')) {
			body = String(init?.body ?? '');

			return Promise.resolve(
				new Response(
					[
						'data: {"choices":[{"delta":{"content":"Hello"}}]}',
						'',
						'data: {"choices":[{"finish_reason":"stop"}]}',
						'',
						'data: [DONE]',
						''
					].join('\n'),
					{ status: 200, headers: { 'content-type': 'text/event-stream' } }
				)
			);
		}

		return originalFetch(input, init);
	};

	globalThis.fetch = Object.assign(fakeFetch, { preconnect: originalFetch.preconnect });

	const { job, reply, trail } = chatting(repo, 'How are widgets described?', 'openai-compatible');

	try {
		await answer(job, reply, trail, AbortSignal.timeout(15_000), () => undefined);

		const request = z
			.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) })
			.parse(JSON.parse(body));

		expect(request.messages[0]).toEqual({ role: 'system', content: recoderSystemPrompt([]) });
		expect(request.messages[1]?.content).toContain(marker);
		expect(reply.text).toBe('Hello');

		const read = reply.trail?.find((step) => step.kind === 'read');

		expect(read?.kind === 'read' ? read.files.map((file) => file.path) : []).toContain('README.md');
	} finally {
		globalThis.fetch = originalFetch;
		resetLlmLimiter();
	}
});
