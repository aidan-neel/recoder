import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventReader, parseEvent, readUsage } from '../../../src/agents/copilot/copilot-output';
import { emptyTokenUsage } from '@recoder/shared';
import type { AgentEvent } from '../../../src/agents/contract';
import { LlmError, UsageLimitError } from '../../../src/models/llm/errors';
import type { CliExit } from '../../../src/agents/cli-stream';

const EXIT_OK: CliExit = { code: 0, stderr: '' };

/** The events a reader sent, collected as they arrived. */
function reader(): { reader: EventReader; events: AgentEvent[] } {
	const events: AgentEvent[] = [];

	return { reader: new EventReader((event) => events.push(event)), events };
}

/** Feeds `lines` to a fresh reader and returns its events and the reply it finished with. */
function feed(
	lines: string[],
	exit: CliExit = EXIT_OK
): { events: AgentEvent[]; reply: ReturnType<EventReader['finish']> } {
	const { reader: r, events } = reader();

	for (const line of lines) r.line(line);

	return { events, reply: r.finish(exit) };
}

const jsonl = (event: unknown): string => JSON.stringify(event);

describe('parseEvent', () => {
	test.each([
		[
			'assistant.message_delta',
			{ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'he' } },
			{ type: 'delta', messageId: 'm1', content: 'he' }
		],
		[
			'assistant.message',
			{ type: 'assistant.message', data: { messageId: 'm1', content: 'hello' } },
			{ type: 'message', messageId: 'm1', content: 'hello' }
		],
		[
			'assistant.reasoning_delta',
			{ type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: 'Hm' } },
			{ type: 'reasoning-delta', partId: 'r1', content: 'Hm' }
		],
		[
			'assistant.reasoning',
			{ type: 'assistant.reasoning', data: { reasoningId: 'r1', content: 'Hmm.' } },
			{ type: 'reasoning-message', partId: 'r1', content: 'Hmm.' }
		],
		[
			'session.error',
			{ type: 'session.error', data: { errorType: 'rate_limit', message: '429 slow down', statusCode: 429 } },
			{ type: 'failure', message: '429 slow down', statusCode: 429, errorType: 'rate_limit' }
		],
		[
			'model.call_start',
			{ type: 'model.call_start', data: { turnId: '0', model: 'gpt-5.6-sol' } },
			{ type: 'step-start' }
		],
		['session.start', { type: 'session.start', data: { sessionId: 's1' } }, { type: 'other' }],
		['a bare string', 'not json at all', { type: 'invalid' }],
		['a line with no type', { data: {} }, { type: 'invalid' }]
	] as const)('%s parses as %j', (_name, line, expected) => {
		expect(parseEvent(typeof line === 'string' ? line : jsonl(line))).toEqual(expected);
	});
});

describe('EventReader', () => {
	test('a streamed reply and its authoritative message are sent once, not twice', () => {
		const { events, reply } = feed([
			jsonl({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'the ' } }),
			jsonl({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'reply' } }),
			jsonl({ type: 'assistant.message', data: { messageId: 'm1', content: 'the reply' } })
		]);

		expect(events.filter((event) => event.type === 'text')).toEqual([
			{ type: 'text', delta: 'the ', partId: 'm1' },
			{ type: 'text', delta: 'reply', partId: 'm1' }
		]);

		expect(reply.text).toBe('the reply');
		expect(reply.error).toBeUndefined();
	});

	test('an authoritative message with no deltas still produces the whole reply', () => {
		const { events, reply } = feed([jsonl({ type: 'assistant.message', data: { messageId: 'm1', content: 'whole' } })]);

		expect(events).toContainEqual({ type: 'text', delta: 'whole', partId: 'm1' });
		expect(reply.text).toBe('whole');
	});

	test('reasoning deltas and the authoritative reasoning part are sent once', () => {
		const { events } = feed([
			jsonl({ type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: 'Hmm' } }),
			jsonl({ type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: '.' } }),
			jsonl({ type: 'assistant.reasoning', data: { reasoningId: 'r1', content: 'Hmm.' } })
		]);

		expect(events.filter((event) => event.type === 'reasoning')).toEqual([
			{ type: 'reasoning', delta: 'Hmm', partId: 'r1' },
			{ type: 'reasoning', delta: '.', partId: 'r1' }
		]);
	});

	test('a model call that succeeded ends its step, usage unknown, when the next call starts', () => {
		const { events } = feed([
			jsonl({ type: 'model.call_start', data: { turnId: '0', model: 'm' } }),
			jsonl({ type: 'model.call_finished', data: { turnId: '0', outcome: 'success' } }),
			jsonl({ type: 'model.call_start', data: { turnId: '1', model: 'm' } }),
			jsonl({ type: 'model.call_finished', data: { turnId: '1', outcome: 'success' } }),
			jsonl({ type: 'assistant.message', data: { messageId: 'm2', content: 'two' } })
		]);

		expect(events.filter((event) => event.type === 'step-start' || event.type === 'usage')).toEqual([
			{ type: 'step-start' },
			{ type: 'usage', usage: emptyTokenUsage() },
			{ type: 'step-start' }
		]);
	});

	test('a model call that failed gets no end before the call that follows it', () => {
		const { events } = feed([
			jsonl({ type: 'model.call_start', data: { turnId: '0', model: 'm' } }),
			jsonl({ type: 'model.call_finished', data: { turnId: '0', outcome: 'error' } }),
			jsonl({ type: 'model.call_start', data: { turnId: '0', model: 'm' } })
		]);

		expect(events.filter((event) => event.type === 'step-start' || event.type === 'usage')).toEqual([
			{ type: 'step-start' },
			{ type: 'step-start' }
		]);
	});

	test('output that no model call announced starts the prompt’s one step', () => {
		const { events } = feed([
			jsonl({ type: 'assistant.message', data: { messageId: 'm1', content: 'one' } }),
			jsonl({ type: 'assistant.message', data: { messageId: 'm2', content: 'two' } })
		]);

		expect(events).toEqual([
			{ type: 'step-start' },
			{ type: 'text', delta: 'one', partId: 'm1' },
			{ type: 'text', delta: 'two', partId: 'm2' }
		]);
	});

	test('a tool turn’s narration is not part of the reply: only the last message is', () => {
		const { events, reply } = feed([
			jsonl({
				type: 'assistant.message',
				data: { messageId: 'm1', content: 'Let me read the diff. ', toolRequests: [{ name: 'read_diff' }] }
			}),
			jsonl({ type: 'assistant.message', data: { messageId: 'm2', content: '{"answer":"final"}', toolRequests: [] } })
		]);

		expect(reply.text).toBe('{"answer":"final"}');
		expect(events).toContainEqual({ type: 'text', delta: 'Let me read the diff. ', partId: 'm1' });
	});

	test('a line that is not JSONL is an error event whose credential is redacted, and the prompt can still finish', () => {
		const { events, reply } = feed([
			'Authorization: Bearer fake-copilot-credential',
			jsonl({ type: 'assistant.message', data: { messageId: 'm1', content: 'ok' } })
		]);

		expect(events[0]).toMatchObject({ type: 'error' });

		if (events[0]?.type !== 'error') throw new Error('expected an error event');

		expect(events[0].message).not.toContain('fake-copilot-credential');
		expect(reply.text).toBe('ok');
	});
});

describe('EventReader.finish', () => {
	test('a clean exit with a reply returns the text', () => {
		expect(feed([jsonl({ type: 'assistant.message', data: { messageId: 'm', content: 'hi' } })]).reply).toEqual({
			text: 'hi'
		});
	});

	test('a clean exit with nothing to say fails as ended without a reply', () => {
		const { reply } = feed([]);

		expect(reply.error).toBeInstanceOf(LlmError);
		expect(reply.error?.message).toContain('ended without a reply');
	});

	test('a session.error naming sign-in is a 401 that says how to sign in', () => {
		const { reply } = feed(
			[jsonl({ type: 'session.error', data: { errorType: 'auth', message: 'No authentication information found.' } })],
			{ code: 1, stderr: '' }
		);

		expect(reply.error).toBeInstanceOf(LlmError);
		expect(reply.error?.status).toBe(401);
		expect(reply.error?.message).toContain('gh auth login');
	});

	test('a session.error quoting a tool slot URL never puts its token in the error', () => {
		const { reply } = feed(
			[
				jsonl({
					type: 'session.error',
					data: {
						errorType: 'query',
						message: 'request failed: http://127.0.0.1:43123/mcp/kX9mP2vQ7rT4wZ8nB3yH6jF5dS1aG0cV',
						statusCode: 400
					}
				})
			],
			{ code: 1, stderr: '' }
		);

		expect(reply.error?.message).not.toContain('kX9mP2vQ7rT4wZ8nB3yH6jF5dS1aG0cV');
	});

	test('a session.error naming a spent plan is a UsageLimitError', () => {
		const { reply } = feed(
			[
				jsonl({
					type: 'session.error',
					data: { errorType: 'quota', message: 'You have exhausted your premium requests for this billing cycle.' }
				})
			],
			{ code: 1, stderr: '' }
		);

		expect(reply.error).toBeInstanceOf(UsageLimitError);
		expect(reply.error?.status).toBe(429);
	});

	test('a session.error with a bare 429 is a retryable LlmError, not a usage cap', () => {
		const { reply } = feed(
			[
				jsonl({
					type: 'session.error',
					data: { errorType: 'rate_limit', message: '429 Rate limit exceeded for this model', statusCode: 429 }
				})
			],
			{ code: 1, stderr: '' }
		);

		expect(reply.error).toBeInstanceOf(LlmError);
		expect(reply.error).not.toBeInstanceOf(UsageLimitError);
		expect(reply.error?.status).toBe(429);
	});

	test('a nonzero exit with no structured failure quotes the stderr tail', () => {
		const { reply } = feed([], { code: 2, stderr: 'Error: the provider exploded\n' });

		expect(reply.error).toBeInstanceOf(LlmError);
		expect(reply.error?.message).toContain('the provider exploded');
	});
});

describe('usage files', () => {
	const usageFile = {
		totalNanoAiu: 1,
		modelMetrics: {
			'gpt-5.6-sol': {
				usage: {
					inputTokens: 1000,
					outputTokens: 20,
					cacheReadTokens: 600,
					cacheWriteTokens: 5,
					reasoningTokens: 3
				}
			}
		}
	};

	async function writeUsage(value: unknown): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), 'copilot-usage-'));
		const file = join(dir, 'usage.json');

		await writeFile(file, JSON.stringify(value));

		return file;
	}

	test('a well-formed usage file reads as cumulative TokenUsage', async () => {
		const usage = await readUsage(await writeUsage(usageFile));

		expect(usage).toEqual({
			inputTokens: 1000,
			outputTokens: 20,
			totalTokens: 1020,
			cachedInputTokens: 600,
			cacheWriteInputTokens: 5,
			reasoningOutputTokens: 3
		});
	});

	test('a missing or malformed usage file reads as null, never zero', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'copilot-usage-'));

		expect(await readUsage(join(dir, 'missing.json'))).toBeNull();
		expect(await readUsage(await writeUsage({ nope: true }))).toBeNull();
	});
});
