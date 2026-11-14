import { afterEach, describe, expect, test } from 'bun:test';

import type { AgentSetupJob } from '@recoder/shared';
import { followSetupJob } from '../../../src/lib/settings/providers/follow-setup-job';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

function job(patch: Partial<AgentSetupJob>): AgentSetupJob {
	return {
		id: 'job-1',
		agent: 'codex',
		step: 'install',
		status: 'running',
		output: '',
		url: null,
		needsInput: false,
		error: null,
		...patch
	};
}

/** Answers each poll with the next job in turn and counts the polls. */
function stubPolls(answers: AgentSetupJob[]): { polls: () => number } {
	let polls = 0;

	globalThis.fetch = (async () => {
		const answer = answers[Math.min(polls, answers.length - 1)];

		polls += 1;

		return new Response(JSON.stringify(answer), { status: 200 });
	}) as unknown as typeof fetch;

	return { polls: () => polls };
}

const noWait = () => Promise.resolve();

describe('following an agent setup job', () => {
	test('polls until the job is done, then refreshes once', async () => {
		const stub = stubPolls([job({ output: 'a' }), job({ status: 'done', output: 'ab' })]);
		const seen: string[] = [];
		let refreshes = 0;

		await followSetupJob({
			job: job({}),
			signal: new AbortController().signal,
			onJob: (next) => seen.push(next.status),
			refresh: async () => {
				refreshes += 1;
			},
			wait: noWait
		});

		expect(stub.polls()).toBe(2);
		expect(seen).toEqual(['running', 'done']);
		expect(refreshes).toBe(1);
	});

	test('hands a failed job to the caller without refreshing', async () => {
		stubPolls([job({ status: 'failed', error: 'npm exited 1' })]);

		const seen: AgentSetupJob[] = [];
		let refreshes = 0;

		await followSetupJob({
			job: job({}),
			signal: new AbortController().signal,
			onJob: (next) => seen.push(next),
			refresh: async () => {
				refreshes += 1;
			},
			wait: noWait
		});

		expect(seen[0]?.error).toBe('npm exited 1');
		expect(refreshes).toBe(0);
	});

	test('stops polling when the signal aborts', async () => {
		const stub = stubPolls([job({})]);
		const controller = new AbortController();

		const finished = followSetupJob({
			job: job({}),
			signal: controller.signal,
			onJob: () => undefined,
			refresh: async () => undefined,
			wait: async (_ms, signal) => {
				controller.abort(new Error('unmounted'));
				signal.throwIfAborted();
			}
		});

		await expect(finished).rejects.toThrow('unmounted');
		expect(stub.polls()).toBe(0);
	});
});
