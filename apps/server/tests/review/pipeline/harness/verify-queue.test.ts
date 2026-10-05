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

/** A queue whose verifiers each wait for `release`, recording the order they start in. */
function gatedQueue() {
	const started: string[] = [];
	const gates: (() => void)[] = [];

	const run = {
		workspace: null,
		deadlineAt: Date.now() + 60 * 60_000,
		budget: new ModelBudget(10_000, 0),
		controller: new AbortController()
	} as unknown as ReviewRun;

	const queue = new VerifyQueue(run, (next) => {
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
