import { expect, test } from 'bun:test';
import type { ReviewCandidate } from '@recoder/shared';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import type { ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { VerifyQueue } from '../../../../src/review/pipeline/harness/verify-queue';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';

const VERIFIED_TASK = { message: 'Verified by a run' };

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

test('FYI never reserves verifier calls or starts a verifier or repair', () => {
	let calls = 0;
	const candidates: ReviewCandidate[] = [];

	const verify = async () => {
		calls++;

		return VERIFIED_TASK;
	};

	const run = { ...testRun(), events: { onCandidate: (candidate: ReviewCandidate) => candidates.push(candidate) } };

	const queue = new VerifyQueue(run, verify, async () => {
		calls++;

		return true;
	});

	queue.add({ ...candidate('observation'), tier: 'fyi' });
	queue.add({ ...candidate('invalid-observation'), tier: 'fyi', valid: false });
	expect(calls).toBe(0);
	expect(queue.heldCalls).toBe(0);

	expect(candidates.map(({ id, state, verifierId }) => [id, state, verifierId])).toEqual([
		['observation', 'raised', undefined],
		['observation', 'unproven', undefined],
		['invalid-observation', 'raised', undefined],
		['invalid-observation', 'dropped', undefined]
	]);
});

/** A queue whose verifiers each wait for `release`, recording the order they start in. */
function gatedQueue() {
	const started: string[] = [];
	const lanes: string[] = [];
	const gates: (() => void)[] = [];
	let notifyStart: (() => void) | undefined;

	const queue = new VerifyQueue(testRun(), (next, _attempt, verifierId) => {
		started.push(next.candidateId);
		lanes.push(verifierId);
		notifyStart?.();

		return new Promise<typeof VERIFIED_TASK>((resolve) => gates.push(() => resolve(VERIFIED_TASK)));
	});

	return {
		queue,
		started,
		lanes,
		release: () => gates.shift()?.(),
		nextStart: () => new Promise<void>((resolve) => (notifyStart = resolve))
	};
}

test('concurrent verifiers have distinct lanes and a waiting candidate takes the freed lane', async () => {
	const { queue, started, lanes, release, nextStart } = gatedQueue();
	const count = REVIEW_POLICY.maxConcurrentVerifications;

	for (let slot = 0; slot <= count; slot++) queue.add(candidate(`c${slot}`));

	expect(started).toHaveLength(count);
	expect(lanes).toEqual(Array.from({ length: count }, (_, index) => `verifier-${index + 1}`));

	const waitingStarted = nextStart();

	release();
	await waitingStarted;

	expect(started.at(-1)).toBe(`c${count}`);
	expect(lanes.at(-1)).toBe('verifier-1');

	for (let slot = 0; slot < count; slot++) release();
	await queue.drain();
});

test('an inconclusive attempt settles before releasing its lane and the retry starts a new verification', async () => {
	const candidates: ReviewCandidate[] = [];
	const run = { ...testRun(), events: { onCandidate: (candidate: ReviewCandidate) => candidates.push(candidate) } };

	const queue = new VerifyQueue(run, async (candidate, attempt) => {
		if (attempt === 1) return { message: 'Could not verify', retry: true };

		candidate.verification = { status: 'verified', method: 'run', reason: 'The repro fails.' };

		return VERIFIED_TASK;
	});

	queue.add(candidate('c1'));
	await queue.drain();

	expect(candidates.map(({ state, message }) => [state, message])).toEqual([
		['raised', undefined],
		['verifying', undefined],
		['unproven', 'Could not verify'],
		['verifying', undefined],
		['proven', VERIFIED_TASK.message]
	]);

	expect(candidates[2].verifierId).toBe(candidates[1].verifierId);
	expect(candidates[4].verifierId).toBe(candidates[3].verifierId);
});

test('the verify queue takes a candidate that can be published before an earlier held-back one', async () => {
	const { queue, started, release, nextStart } = gatedQueue();

	for (let slot = 0; slot < REVIEW_POLICY.maxConcurrentVerifications; slot++) queue.add(candidate(`busy${slot}`));

	queue.add(candidate('held', true));
	queue.add(candidate('shown'));

	const waitingStarted = nextStart();

	release();
	await waitingStarted;

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

		return { message: 'Not run: the code cannot run here' };
	});

	queue.add(candidate('bug'));

	expect(run.budget.limit).toBeGreaterThan(10_000);

	await queue.drain();

	expect(run.budget.limit).toBe(10_000);
});

test('the calls a verifier was given stay held until it finishes, so a later stage cannot plan to spend them', async () => {
	const { queue, release } = gatedQueue();

	queue.add(candidate('waiting'));

	expect(queue.heldCalls).toBe(REVIEW_POLICY.maxVerifierTurns);

	release();
	await queue.drain();

	expect(queue.heldCalls).toBe(0);
});

/** A bug at one place that consolidation would merge with any other report of it. */
function bug(candidateId: string): CandidateFinding {
	return {
		...candidate(candidateId),
		kind: 'bug',
		file: 'src/parse.ts',
		line: 10,
		fingerprint: 'parse-null',
		title: 'Empty input dereferences null in parse',
		message: 'parse dereferences a null token when the input is empty.'
	} as never;
}

/** A queue that shares proofs, whose verifiers settle as `verdict` says once released. */
function sharingQueue(verdict: (next: CandidateFinding) => void) {
	const started: string[] = [];
	const gates: (() => void)[] = [];
	const candidates: ReviewCandidate[] = [];

	const run = {
		...testRun(),
		inventory: { diffs: [] },
		events: { onCandidate: (candidate: ReviewCandidate) => candidates.push(candidate) }
	} as unknown as ReviewRun;

	const queue = new VerifyQueue(
		run,
		(next) => {
			started.push(next.candidateId);

			return new Promise<typeof VERIFIED_TASK>((resolve) =>
				gates.push(() => {
					verdict(next);
					resolve(VERIFIED_TASK);
				})
			);
		},
		undefined,
		(follower, leader) => {
			follower.verification = { ...leader.verification! };

			return 'Verified with another candidate';
		}
	);

	return { queue, started, candidates, release: () => gates.shift()?.() };
}

test('a report of an issue a waiting verifier proves takes that proof without a verifier of its own', async () => {
	const { queue, started, candidates, release } = sharingQueue((next) => {
		next.verification = { status: 'verified', method: 'run', reason: 'The repro fails.' };
	});

	const [leader, follower, late] = [bug('a'), bug('b'), bug('c')];

	queue.add(leader);
	queue.add(follower);
	release();
	await queue.drain();
	queue.add(late);

	expect(started).toEqual(['a']);
	expect(follower.verification?.status).toBe('verified');
	expect(late.verification?.status).toBe('verified');

	expect(candidates.filter((candidate) => candidate.id === 'b')).toMatchObject([
		{ state: 'raised' },
		{ state: 'proven', verifierId: 'verifier-1', message: 'Verified with another candidate' }
	]);
});

test('a report whose leader was not proved gets a verifier of its own', async () => {
	const { queue, started, release } = sharingQueue((next) => {
		if (next.candidateId === 'a') next.valid = false;
		else next.verification = { status: 'verified', method: 'run', reason: 'The repro fails.' };
	});

	const follower = bug('b');

	queue.add(bug('a'));
	queue.add(follower);
	release();
	await Bun.sleep(0);
	release();
	await queue.drain();

	expect(started).toEqual(['a', 'b']);
	expect(follower.verification?.status).toBe('verified');
});
