import { reviewerSystemPrompt, reviewerUserPrompt } from '../../../src/review/pipeline/reviewer-prompts';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import type { LensId } from '../../../src/review/pipeline/lenses/types';
import { afterEach, expect, jest, mock, spyOn, test } from 'bun:test';
import { OpenCodeAgentRun } from '../../../src/agents/opencode/opencode-agent-session';
import { V2Api } from '../../../src/agents/opencode/api/v2';
import { V1Api } from '../../../src/agents/opencode/api/v1';
import type { Reply } from '../../../src/agents/opencode/api/types';
import type { SessionHandlers } from '../../../src/agents/opencode/opencode-events';
import { OpenCodeServer } from '../../../src/agents/opencode/opencode-server';
import { OpenCodeWarmStart } from '../../../src/agents/opencode/opencode-warm-start';
import { withUsageResources } from '../../../src/models/usage-resources';
import { useFakeClock } from '../../helpers/fake-clock';

useFakeClock();
afterEach(() => mock.restore());

const prompt = { tools: false, timeoutMs: 10000 };

/** Controlled model replies and step events exercise the real agent session without a server process or sleeps. */
function fixture() {
	const server = new OpenCodeServer({});
	const api = new V1Api(server);
	const handlers: SessionHandlers[] = [];
	const replies: ReturnType<typeof Promise.withResolvers<Reply>>[] = [];
	let sessions = 0;

	spyOn(server, 'api').mockResolvedValue(api);
	spyOn(api, 'createSession').mockImplementation(async () => `session-${++sessions}`);
	spyOn(api, 'abort').mockResolvedValue();
	spyOn(api, 'deleteSession').mockResolvedValue();

	spyOn(api.events, 'router').mockImplementation((value) => {
		handlers.push(value);

		return () => {};
	});

	spyOn(server, 'stream').mockImplementation(
		async () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
					controller.close();
				}
			})
	);

	const send = spyOn(api, 'prompt').mockImplementation(() => {
		const reply = Promise.withResolvers<Reply>();

		replies.push(reply);

		return reply.promise;
	});

	const host = { server, efforts: async () => null, noStructuredOutput: new Set<string>() };

	const open = (system = 'Review.', signal = new AbortController().signal) =>
		OpenCodeAgentRun.open(host, {
			model: 'openai/m',
			system,
			tools: [],
			runTool: async () => ({ text: '', isError: false }),
			onEvent: () => {},
			signal
		});

	return { open, send, handlers, replies };
}

async function flush(): Promise<void> {
	for (let round = 0; round < 20; round++) await Promise.resolve();
}

/** Opens a leader and a same-key follower and sends each one's first prompt. */
async function promptPair(f: ReturnType<typeof fixture>, signal?: AbortSignal) {
	const leader = await f.open('Review.', signal);
	const follower = await f.open();
	const work = [leader.prompt('first', prompt), follower.prompt('second', prompt)];

	await flush();

	return { leader, follower, work };
}

/** Answers every prompt sent so far, then closes the runs. */
async function settle(
	f: ReturnType<typeof fixture>,
	work: Promise<unknown>[],
	runs: { close(): Promise<void> }[]
): Promise<void> {
	for (const reply of f.replies) reply.resolve({ texts: [] });
	await Promise.all(work);
	await Promise.all(runs.map((run) => run.close()));
}

test('a same-key follower sends after the first step ends even without usage while the leader is still running', async () => {
	await withUsageResources('step', async () => {
		const f = fixture();
		const { leader, follower, work } = await promptPair(f);

		expect(f.send).toHaveBeenCalledTimes(1);
		f.handlers[0].onStepEnd?.();
		await flush();
		expect(f.send).toHaveBeenCalledTimes(2);

		const later = await f.open();
		const third = later.prompt('third', prompt);

		await flush();
		expect(f.send).toHaveBeenCalledTimes(3);
		await settle(f, [...work, third], [leader, follower, later]);
	});
});

test('a different system prompt sends without waiting for the leader', async () => {
	await withUsageResources('different', async () => {
		const f = fixture();
		const leader = await f.open();
		const other = await f.open('Verify.');
		const work = [leader.prompt('first', prompt), other.prompt('second', prompt)];

		await flush();
		expect(f.send).toHaveBeenCalledTimes(2);
		await settle(f, work, [leader, other]);
	});
});

test('followers send at the five-second cap when the leader never reports', async () => {
	await withUsageResources('cap', async () => {
		const f = fixture();
		const { leader, follower, work } = await promptPair(f);

		jest.advanceTimersByTime(4999);
		await flush();
		expect(f.send).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(1);
		await flush();
		expect(f.send).toHaveBeenCalledTimes(2);
		await settle(f, work, [leader, follower]);
	});
});

for (const outcome of ['failure', 'close', 'completion', 'abort'] as const) {
	test(`a follower sends when the leader settles through ${outcome}`, async () => {
		await withUsageResources(outcome, async () => {
			const f = fixture();
			const controller = new AbortController();
			const { leader, follower, work } = await promptPair(f, controller.signal);

			expect(f.send).toHaveBeenCalledTimes(1);

			if (outcome === 'failure') f.replies[0].reject(new Error('provider failed'));
			else if (outcome === 'close') await leader.close();
			else if (outcome === 'abort') controller.abort();
			else f.replies[0].resolve({ texts: [] });

			await flush();
			expect(f.send).toHaveBeenCalledTimes(2);
			await settle(f, work, [leader, follower]);
		});
	});
}

test('an aborted follower returns cancellation without sending or releasing the leader', async () => {
	await withUsageResources('cancel', async () => {
		const f = fixture();
		const controller = new AbortController();
		const leader = await f.open();
		const follower = await f.open('Review.', controller.signal);
		const first = leader.prompt('first', prompt);
		const second = follower.prompt('second', prompt);

		await flush();
		controller.abort();
		expect((await second).error?.message).toMatch(/cancel/i);
		expect(f.send).toHaveBeenCalledTimes(1);

		const later = await f.open();
		const third = later.prompt('third', prompt);

		await flush();
		expect(f.send).toHaveBeenCalledTimes(1);
		f.replies[0].resolve({ texts: [] });
		await first;
		await flush();
		f.replies[1].resolve({ texts: [] });
		await third;
		await Promise.all([leader.close(), follower.close(), later.close()]);
	});
});

test('catalogs and roots isolate gates and parentless sessions bypass them', async () => {
	await withUsageResources('keys', async () => {
		const signal = new AbortController().signal;

		const gates = [
			new OpenCodeWarmStart('root', 'catalog', 'system'),
			new OpenCodeWarmStart('root', 'other', 'system'),
			new OpenCodeWarmStart('other', 'catalog', 'system'),
			new OpenCodeWarmStart(undefined, undefined, 'system'),
			new OpenCodeWarmStart(undefined, undefined, 'system')
		];

		await Promise.all(gates.map((gate) => gate.wait(signal)));
	});
});

test('review cleanup releases pending followers and the next review starts a fresh gate', async () => {
	let waiting: Promise<void> | undefined;

	await withUsageResources('cleanup', async () => {
		const signal = new AbortController().signal;

		await new OpenCodeWarmStart('root', undefined, 'system').wait(signal);
		waiting = new OpenCodeWarmStart('root', undefined, 'system').wait(signal);
	});

	await waiting;

	await withUsageResources('cleanup', async () => {
		const signal = new AbortController().signal;
		const leader = new OpenCodeWarmStart('root', undefined, 'system');
		let sent = false;

		await leader.wait(signal);

		const follower = new OpenCodeWarmStart('root', undefined, 'system').wait(signal).then(() => (sent = true));

		await flush();
		expect(sent).toBe(false);
		leader.release();
		await follower;
	});
});

test('an interrupted session can still send its final prompt with tools off', async () => {
	await withUsageResources('final', async () => {
		const f = fixture();
		const run = await f.open();
		const first = run.prompt('work', prompt);

		await flush();
		await run.abort();
		f.replies[0].resolve({ texts: [] });
		await first;

		const final = run.prompt('answer now', prompt);

		await flush();
		expect(f.send).toHaveBeenCalledTimes(2);
		expect(f.send.mock.calls[1][0].signal.aborted).toBe(false);
		f.replies[1].resolve({ texts: ['answer'] });
		expect((await final).text).toBe('answer');
		await run.close();
	});
});

for (const Api of [V1Api, V2Api]) {
	test(`${Api.name} reports a step ending without usage and still accepts later usage`, () => {
		const api = new Api(new OpenCodeServer({}));
		const ended = mock(() => {});
		const usage = mock(() => {});
		const route = api.events.router({ onStepEnd: ended, onStepFinish: usage });
		const tokens = { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };

		const event = (withUsage: boolean) =>
			Api === V1Api
				? {
						type: 'message.part.updated',
						properties: {
							part: {
								id: 'part',
								type: 'step-finish',
								sessionID: 'session',
								messageID: 'message',
								...(withUsage && { tokens })
							}
						}
					}
				: {
						type: 'session.step.ended',
						data: { sessionID: 'session', assistantMessageID: 'message', ...(withUsage && { tokens }) }
					};

		route(event(false), 'session');
		expect(ended).toHaveBeenCalledTimes(1);
		expect(usage).not.toHaveBeenCalled();
		route(event(true), 'session');
		expect(usage).toHaveBeenCalledTimes(1);
	});
}

test('reviewers assigned different lenses wait on the same warm-start gate', async () => {
	await withUsageResources('lenses', async () => {
		const f = fixture();
		const system = reviewerSystemPrompt(false, null, { subagents: 4, delegate: false });
		const runs = await Promise.all([f.open(system), f.open(system)]);

		const work = runs.map((run, index) =>
			run.prompt(
				reviewerUserPrompt(
					{
						id: String(index),
						title: 'Review',
						reason: '',
						scope: [],
						lenses: [(['correctness', 'readability'] as LensId[])[index]]
					},
					{ turns: 4, calls: 30 },
					{
						directive: null,
						pr: { title: '', body: '', context: '', inventory: buildInventory(''), repo: null },
						changeModel: null,
						intent: null,
						ledger: null
					},
					'',
					'Unit'
				),
				prompt
			)
		);

		await flush();
		expect(f.send).toHaveBeenCalledTimes(1);
		f.handlers[0].onStepEnd?.();
		await flush();
		expect(f.send).toHaveBeenCalledTimes(2);
		await settle(f, work, runs);
	});
});
