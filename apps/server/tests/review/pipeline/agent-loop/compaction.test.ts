import { expect, test } from 'bun:test';
import type { ChatMessage } from '../../../../src/models/llm';
import { compactTranscript } from '../../../../src/review/pipeline/agent-loop/compaction';

/** A system prompt, the brief, then four rounds of a request and a 1,000-character tool result. */
function transcript(): { messages: ChatMessage[]; results: ChatMessage[] } {
	const messages: ChatMessage[] = [
		{ role: 'system', content: 'You review code.' },
		{ role: 'user', content: 'The brief.' }
	];

	const results: ChatMessage[] = [];

	for (let round = 0; round < 4; round++) {
		const result: ChatMessage = { role: 'user', content: `${round}`.repeat(1000) };

		messages.push({ role: 'assistant', content: '{"actions":[]}' }, result);
		results.push(result);
	}

	return { messages, results };
}

test('compaction stubs the oldest tool results until the transcript fits, keeping the brief and the latest two', () => {
	const { messages, results } = transcript();

	expect(compactTranscript(messages, results, 2_500)).toBe(2);

	expect(results.map((result) => result.content.startsWith('[Earlier tool output removed'))).toEqual([
		true,
		true,
		false,
		false
	]);

	expect(messages[1]?.content).toBe('The brief.');
});

test('a transcript within the limit is sent unchanged', () => {
	const { messages, results } = transcript();
	const before = messages.map((message) => message.content);

	expect(compactTranscript(messages, results, 10_000)).toBe(0);
	expect(messages.map((message) => message.content)).toEqual(before);
});
