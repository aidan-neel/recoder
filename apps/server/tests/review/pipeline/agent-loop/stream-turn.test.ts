import { afterEach, expect, test } from 'bun:test';
import { runJsonAgent } from '../../../../src/review/pipeline/agent-loop';
import { doneAgentOptions } from '../../../helpers/done-agent';
import { settleOnClock, useFakeClock } from '../../../helpers/fake-clock';
import { messagesOf, stubFetch } from '../harness-fixtures';

useFakeClock();

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const ANSWER = '{"message":"Done.","done":true}';

/** A model behind an OpenAI-compatible endpoint, which Recoder runs turn by turn. */
const CONFIG = { model: 'test', baseUrl: 'https://model.test', apiKey: 'test' };

/** How often a live stream sends a reasoning chunk: well inside the stream's idle limit. */
const BEAT_MS = 10_000;

/**
 * A model whose stream stays alive, sending a reasoning chunk every {@link BEAT_MS}. Call `n` (from 1) answers after
 * `answerAfterMs(n)` milliseconds, or never when that is null. Returns the last message of every prompt sent.
 */
function liveModel(answerAfterMs: (call: number) => number | null): string[] {
	const prompts: string[] = [];

	stubFetch((init) => {
		prompts.push(messagesOf(init).at(-1)?.content ?? '');

		return liveStream(answerAfterMs(prompts.length), init?.signal ?? undefined);
	});

	return prompts;
}

function liveStream(answerAfterMs: number | null, signal: AbortSignal | undefined): Response {
	const encoder = new TextEncoder();
	const timers: ReturnType<typeof setTimeout>[] = [];
	const stop = () => timers.forEach(clearTimeout);

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			const chunk = (delta: Record<string, string>) => send(JSON.stringify({ choices: [{ delta }] }));

			timers.push(setInterval(() => chunk({ reasoning_content: 'Thinking.' }), BEAT_MS));

			if (answerAfterMs !== null) {
				timers.push(
					setTimeout(() => {
						stop();
						chunk({ content: ANSWER });
						send('[DONE]');
						controller.close();
					}, answerAfterMs)
				);
			}

			signal?.addEventListener('abort', () => {
				stop();
				controller.error(new Error('aborted'));
			});
		},
		cancel: stop
	});

	return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

test('a model call whose stream stays alive for minutes completes, sent once', async () => {
	const prompts = liveModel(() => 150_000);

	const result = await settleOnClock(runJsonAgent(doneAgentOptions(CONFIG)), 1_000, 20 * 60_000);

	expect(result).toEqual({ value: { done: true } });
	expect(prompts).toHaveLength(1);
});

/** Final turn from 30 s, stopped at 80 s: a turn before the final one may run to 55 s, half of what is left. */
const TIME_LIMIT = { finalTurnAfterMs: 30_000, maxWallMs: 80_000 };

test('a call still running at the agent’s final-turn time may finish in half of the time that is left', async () => {
	const prompts = liveModel(() => 45_000);

	const result = await settleOnClock(runJsonAgent(doneAgentOptions(CONFIG, { timeLimit: TIME_LIMIT })), 1_000, 600_000);

	expect(result).toEqual({ value: { done: true } });
	expect(prompts).toHaveLength(1);
});

test('a call that outlasts that half is cut, and the agent answers in its final turn', async () => {
	const prompts = liveModel((call) => (call === 1 ? null : 0));

	const result = await settleOnClock(runJsonAgent(doneAgentOptions(CONFIG, { timeLimit: TIME_LIMIT })), 1_000, 600_000);

	expect(result).toEqual({ value: { done: true } });
	expect(prompts).toHaveLength(2);
	expect(prompts[1]).toStartWith('This is your final turn.');
});

test('an agent whose final call is still running at its deadline ends as out of time, with no further call', async () => {
	const prompts = liveModel(() => null);

	const result = await settleOnClock(runJsonAgent(doneAgentOptions(CONFIG, { timeLimit: TIME_LIMIT })), 1_000, 600_000);

	expect(result.value).toBeNull();
	expect(result.error).toStartWith('Ran out of time');
	expect(prompts).toHaveLength(2);
});
