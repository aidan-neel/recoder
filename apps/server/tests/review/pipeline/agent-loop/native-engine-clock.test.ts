import { expect, test } from 'bun:test';
import type { AgentAdapter, AgentPromptOptions, AgentReply, AgentRun } from '../../../../src/agents/contract';
import { cancelledError, timedOutError } from '../../../../src/models/llm/errors';
import { runNativeAgent } from '../../../../src/review/pipeline/agent-loop/native-engine';
import { doneAgentOptions } from '../../../helpers/done-agent';
import { settleOnClock, useFakeClock } from '../../../helpers/fake-clock';

useFakeClock();

const ANSWER = '{"done":true}';

/** A model of an agent CLI, which the engine runs as a native run. */
const CONFIG = { provider: 'fake-cli', model: 'm', baseUrl: '', apiKey: '' };

/** A model call of minutes, on the review's clock. */
const SLOW_CALL_MS = 150_000;

/**
 * A run of an agent CLI whose process is alive and silent: each prompt answers after `answerAfterMs`, or never when
 * it is null. Like the real runs, `abort` settles the prompt as cancelled and its own `timeoutMs` as timed out.
 */
class SilentRun implements AgentRun {
	prompts = 0;
	private stop: (() => void) | null = null;

	constructor(private readonly answerAfterMs: number | null) {}

	prompt(_text: string, options: AgentPromptOptions): Promise<AgentReply> {
		this.prompts++;

		return new Promise((resolve) => {
			const timers = [
				setTimeout(() => settle({ text: '', error: timedOutError(options.timeoutMs) }), options.timeoutMs)
			];

			const settle = (reply: AgentReply) => {
				for (const timer of timers) clearTimeout(timer);
				this.stop = null;
				resolve(reply);
			};

			if (this.answerAfterMs !== null) timers.push(setTimeout(() => settle({ text: ANSWER }), this.answerAfterMs));

			this.stop = () => settle({ text: '', error: cancelledError() });
		});
	}

	async abort(): Promise<void> {
		this.stop?.();
	}

	async close(): Promise<void> {
		this.stop?.();
	}
}

/**
 * An agent CLI that opens `run`. The engine only opens runs, so the rest of the adapter is left out; the cast is
 * safe because nothing else of it is called.
 */
function agentOf(run: SilentRun): AgentAdapter {
	return { openRun: async () => run } as unknown as AgentAdapter;
}

test('a model call that runs silently for minutes, its process alive, is waited for and not stopped', async () => {
	const run = new SilentRun(SLOW_CALL_MS);

	const result = await settleOnClock(runNativeAgent(doneAgentOptions(CONFIG), agentOf(run)), 5_000, 20 * 60_000);

	expect(result).toEqual({ value: { done: true } });
	expect(run.prompts).toBe(1);
});

test('a model call still running at the agent’s deadline ends it as out of time, not as a timed-out request', async () => {
	const run = new SilentRun(null);
	const timeLimit = { finalTurnAfterMs: 31_000, maxWallMs: 62_000 };

	const result = await settleOnClock(
		runNativeAgent(doneAgentOptions(CONFIG, { timeLimit }), agentOf(run)),
		1_000,
		10 * 60_000
	);

	expect(result).toEqual({ value: null, error: 'Ran out of time: no answer within 1 minutes' });
	expect(run.prompts).toBe(1);
});
