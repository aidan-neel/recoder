import { expect, test } from 'bun:test';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import type { ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { VerifyQueue } from '../../../../src/review/pipeline/harness/verify-queue';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';

function candidate(candidateId: string, belowBar = false): CandidateFinding {
	return {
		candidateId,
		valid: true,
		severity: 'warning',
		category: 'correctness',
		belowBar
	} as never;
}

/** A review with an hour left and a budget of 10,000 model calls. */
function testRun(): ReviewRun {
	return {
		workspace: null,
		deadlineAt: Date.now() + 60 * 60_000,
		budget: new ModelBudget(10_000, 0),
		controller: new AbortController()
	} as unknown as ReviewRun;
}

/** A queue whose verifiers each wait for `release`, recording the order they start in. */
function gatedQueue() {
	const started: string[] = [];
	const gates: (() => void)[] = [];

	const queue = new VerifyQueue(testRun(), (next) => {
		started.push(next.candidateId);

		return new Promise<boolean>((resolve) => gates.push(() => resolve(true)));
	});

	const release = async () => {
		gates.shift()?.();
		await Bun.sleep(0);
	};

	return { queue, started, release };
}

test('the verify queue takes a candidate that can be published before an earlier held-back one', async () => {
	const { queue, started, release } = gatedQueue();

	for (let slot = 0; slot < REVIEW_POLICY.maxConcurrentVerifications; slot++) queue.add(candidate(`busy${slot}`));

	queue.add(candidate('held', true));
	queue.add(candidate('shown'));

	await release();

	expect(started.at(-1)).toBe('shown');
});

test('a candidate that can be published bumps one waiting held-back candidate once the verification cap is spent', () => {
	const { queue } = gatedQueue();
	const held = Array.from({ length: REVIEW_POLICY.maxVerifications }, (_, index) => candidate(`held${index}`, true));
	const shown = candidate('shown');

	for (const entry of [...held, shown]) queue.add(entry);

	const bumped = held.filter((entry) => entry.verification);

	expect(bumped).toHaveLength(1);
	expect(bumped[0]?.verification?.reason).toContain('can be published');
	expect(shown.verification).toBeUndefined();
});

test('a held-back candidate does not bump another once the verification cap is spent', () => {
	const { queue } = gatedQueue();
	const held = Array.from({ length: REVIEW_POLICY.maxVerifications }, (_, index) => candidate(`held${index}`, true));
	const late = candidate('late', true);

	for (const entry of [...held, late]) queue.add(entry);

	expect(held.some((entry) => entry.verification)).toBe(false);
	expect(late.verification?.reason).toContain('already verified');
});

test('a bug no verifier could run hands back the model calls it added to the budget', async () => {
	const run = testRun();

	const queue = new VerifyQueue(run, async (next) => {
		next.verification = { status: 'unverified', outcome: 'not-run', reason: 'Not verified: no check passed.' };

		return true;
	});

	queue.add(candidate('bug'));

	expect(run.budget.limit).toBeGreaterThan(10_000);

	await queue.drain();

	expect(run.budget.limit).toBe(10_000);
});
