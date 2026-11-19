import { expect, test } from 'bun:test';
import { withAgentSlot, withReviewAgentSlots } from '../../../../src/review/pipeline/agent-loop/agent-slots';
import { ReviewAbortedError } from '../../../../src/review/pipeline/agent-loop/budget';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';

/** Agents that each run until released, recording how many ran at once. */
function gatedAgents() {
	const releases: (() => void)[] = [];
	let running = 0;
	let peak = 0;

	const agent = () =>
		new Promise<void>((resolve) => {
			running++;
			peak = Math.max(peak, running);

			releases.push(() => {
				running--;
				resolve();
			});
		});

	return { agent, releases, peak: () => peak, running: () => running };
}

/** Lets every queued microtask and promise continuation run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a review runs at most its cap of agents at once and starts the rest as slots free', async () => {
	const gate = gatedAgents();
	const signal = new AbortController().signal;
	const total = REVIEW_POLICY.maxConcurrentAgents + 3;

	const all = withReviewAgentSlots(() =>
		Promise.all(Array.from({ length: total }, () => withAgentSlot('reviewer', signal, gate.agent)))
	);

	await settle();
	expect(gate.running()).toBe(REVIEW_POLICY.maxConcurrentAgents);

	while (gate.releases.length) {
		gate.releases.shift()!();
		await settle();
	}

	await all;
	expect(gate.peak()).toBe(REVIEW_POLICY.maxConcurrentAgents);
});

test('workers and agents outside a review run without waiting for a slot', async () => {
	const gate = gatedAgents();
	const signal = new AbortController().signal;
	const total = REVIEW_POLICY.maxConcurrentAgents + 2;

	void withReviewAgentSlots(() =>
		Promise.all(Array.from({ length: total }, () => withAgentSlot('worker', signal, gate.agent)))
	);

	void Promise.all(Array.from({ length: total }, () => withAgentSlot('reviewer', signal, gate.agent)));

	await settle();
	expect(gate.running()).toBe(total * 2);

	for (const release of gate.releases) release();
});

test('an agent waiting for a slot stops when its review is aborted, and the slot it never took stays free', async () => {
	const gate = gatedAgents();
	const running = new AbortController().signal;
	const aborting = new AbortController();

	const result = withReviewAgentSlots(async () => {
		const held = Array.from({ length: REVIEW_POLICY.maxConcurrentAgents }, () =>
			withAgentSlot('reviewer', running, gate.agent)
		);

		const waiting = withAgentSlot('verifier', aborting.signal, gate.agent);

		await settle();
		aborting.abort();
		await expect(waiting).rejects.toBeInstanceOf(ReviewAbortedError);

		gate.releases.shift()!();
		await settle();

		const next = withAgentSlot('reviewer', running, gate.agent);

		await settle();

		return { held, next, running: gate.running() };
	});

	const { held, next, running: runningAfter } = await result;

	expect(runningAfter).toBe(REVIEW_POLICY.maxConcurrentAgents);

	for (const release of gate.releases) release();
	await Promise.all([...held, next]);
});
