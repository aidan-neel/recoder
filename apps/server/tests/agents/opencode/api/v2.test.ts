import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '../../../../src/agents/contract';
import type { OpenCodeAgent } from '../../../../src/agents/opencode/opencode';
import { ChatConversation } from '../../../../src/models/llm/conversation';
import type { ChatOptions } from '../../../../src/models/llm/types';
import { useFakeOpenCodeV2 } from '../../../helpers/fake-opencode-v2';
import { ask, calls, cancelledChat, expectProviderStatuses, streamedUsage } from '../../../helpers/opencode-chat';

const start = useFakeOpenCodeV2();

async function paths(target: OpenCodeAgent): Promise<string[]> {
	return (await calls(target)).map((call) => `${call.method} ${call.path}`);
}

describe('OpenCode 2 chat', () => {
	test('creates its session under /api with every permission denied and the model on the session', async () => {
		const target = await start();

		await target.complete(
			ask('hi', {
				reasoningEffort: 'high',
				messages: [
					{ role: 'system', content: 'Be brief.' },
					{ role: 'user', content: 'hi' }
				]
			})
		);

		const log = await calls(target);

		expect(log.find((call) => call.method === 'POST' && call.path === '/api/session')).toMatchObject({
			body: {
				model: { providerID: 'openai', id: 'm', variant: 'high' },
				permissions: [{ action: '*', resource: '*', effect: 'deny' }]
			}
		});

		expect(log).toContainEqual(
			expect.objectContaining({
				path: '/api/experimental/session/ses_1/instructions/entries/recoder',
				body: { value: 'Be brief.' }
			})
		);

		expect(log.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/session/ses_1' });
	});

	test('streams only its own session text and reasoning, and sums usage from the finished messages', async () => {
		expect(await streamedUsage(await start())).toMatchObject({
			inputTokens: 11,
			outputTokens: 6,
			cachedInputTokens: 1,
			reasoningOutputTokens: 2
		});
	});

	test('asks for plain JSON, because 2.x cannot force a schema', async () => {
		const target = await start();

		await target.complete(ask('hi', { jsonSchema: { name: 'r', schema: { type: 'object' } } }));

		const log = await calls(target);
		const prompt = log.find((call) => call.path.endsWith('/prompt'));

		expect(prompt?.body).not.toHaveProperty('format');
		expect(log.find((call) => call.path.endsWith('/instructions/entries/recoder'))?.body?.value).toContain('JSON');
	});

	test("keeps the provider's status on a failed reply", async () => {
		await expectProviderStatuses(await start());
	});

	test('finds the reply by polling when the wait route fails', async () => {
		const target = await start();

		expect(await target.complete(ask('no-wait'))).toBe('Hello world');
	});

	test('a cancelled call interrupts and deletes its session', async () => {
		const target = await start();

		expect(await cancelledChat(target, '/api/session/ses_1/prompt')).toMatchObject({
			message: 'Model request cancelled'
		});

		expect(await paths(target)).toEqual(
			expect.arrayContaining(['POST /api/session/ses_1/interrupt', 'DELETE /api/session/ses_1'])
		);
	});

	test('a failed call in a conversation starts a new session, since 2.x cannot remove messages', async () => {
		const target = await start();
		const conversation = new ChatConversation();
		const first = await target.complete(ask('hi', { conversation }));

		const next = (content: string): ChatOptions =>
			ask('', {
				conversation,
				messages: [
					{ role: 'user', content: 'hi' },
					{ role: 'assistant', content: first },
					{ role: 'user', content }
				]
			});

		await expect(target.complete(next('denied'))).rejects.toMatchObject({ status: 403 });
		await target.complete(next('again'));
		await conversation.close();

		const log = await calls(target);
		const prompts = log.filter((call) => call.path.endsWith('/prompt'));

		expect(prompts.map((call) => call.path)).toEqual([
			'/api/session/ses_1/prompt',
			'/api/session/ses_1/prompt',
			'/api/session/ses_2/prompt'
		]);

		expect(JSON.stringify(prompts[2].body)).toContain('Assistant:');

		expect(log.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
			'/api/session/ses_1',
			'/api/session/ses_2'
		]);
	});
});

describe('OpenCode 2 agent', () => {
	async function open(target: OpenCodeAgent, onEvent: (event: AgentEvent) => void = () => {}) {
		return target.openRun({
			model: 'openai/m',
			system: 'Review.',
			tools: ['search'],
			runTool: async () => ({ text: 'ok', isError: false }),
			onEvent,
			signal: new AbortController().signal
		});
	}

	test('registers its tools natively, not as code mode, and allows only the ones named on each prompt', async () => {
		const target = await start();
		const session = await open(target);

		await session.prompt('hi', { tools: true, timeoutMs: 5_000 });
		await session.prompt('hi', { tools: false, timeoutMs: 5_000 });
		await session.close();

		const log = await calls(target);
		const registered = log.find((call) => call.method === 'PUT' && call.path.startsWith('/api/experimental/mcp/'));
		const permissions = log.filter((call) => call.method === 'PATCH').map((call) => call.body?.permissions);

		expect(registered?.body).toMatchObject({ config: { type: 'remote', oauth: false, codemode: false } });
		expect(registered?.query).toContain('location%5Bdirectory%5D=');

		expect(permissions).toEqual([
			[
				{ action: '*', resource: '*', effect: 'deny' },
				{ action: 'recoder1_search', resource: '*', effect: 'allow' }
			],
			[{ action: '*', resource: '*', effect: 'deny' }]
		]);
	});

	test('reports each step once even when the provider call is announced again', async () => {
		const target = await start();
		const events: string[] = [];

		const session = await open(target, (event) => {
			if (event.type === 'step-start') events.push('start');
			if (event.type === 'usage') events.push(`finish ${event.usage.totalTokens}`);
		});

		const reply = await session.prompt('hi', { tools: true, timeoutMs: 5_000 });

		await session.close();

		expect(reply.text).toBe(' world');
		expect(events).toEqual(['start', 'finish 17']);
	});

	test('a prompt ends with an error as soon as the server stops mid-turn, long before its own time runs out', async () => {
		const session = await open(await start());
		const started = Date.now();

		const reply = await session.prompt('crash', { tools: true, timeoutMs: 60_000 });

		expect(reply.error).toBeInstanceOf(Error);
		expect(Date.now() - started).toBeLessThan(3_000);
	});
});
