import { afterEach, expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { createRun, type ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { candidateRepairOn, repairCandidate } from '../../../../src/review/pipeline/harness/repair';
import { VerifyQueue } from '../../../../src/review/pipeline/harness/verify-queue';
import type { ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness/types';
import { REPAIR_DIFF, candidateOf, reported } from '../candidate-repair-fixtures';

afterEach(() => {
	delete process.env.RECODER_CANDIDATE_REPAIR;
	delete process.env.RECODER_REPAIR_CAP;
});

/** A run over `REPAIR_DIFF`, resumed from a checkpoint that already counted `repairs`. */
function runOf(repairs?: number): ReviewRun {
	const resume = repairs === undefined ? null : ({ candidates: [], repairs } as unknown as ReviewProgressCheckpoint);

	return createRun({ diff: REPAIR_DIFF, sandboxPath: null, resume });
}

/** A queue on a fresh run whose verifier records what it is given and settles at once. */
function recordingQueue(repair?: (candidate: CandidateFinding) => Promise<boolean>) {
	const verified: string[] = [];

	const record = async (candidate: CandidateFinding) => {
		verified.push(candidate.candidateId);

		return true;
	};

	return { queue: new VerifyQueue(runOf(), record, repair), verified };
}

test('candidate repair is on unless RECODER_CANDIDATE_REPAIR=0', () => {
	expect(candidateRepairOn()).toBe(true);
	process.env.RECODER_CANDIDATE_REPAIR = '0';
	expect(candidateRepairOn()).toBe(false);
});

test('a rejected candidate its repair makes valid is verified, and drain waits for the repair', async () => {
	const { queue, verified } = recordingQueue(async (candidate) => {
		await Bun.sleep(5);
		candidate.valid = true;

		return true;
	});

	queue.add({ candidateId: 'c1', valid: false, severity: 'warning' } as CandidateFinding);
	expect(queue.busy).toBe(true);
	await queue.drain();
	expect(verified).toEqual(['c1']);
});

test('a candidate whose repair fails is not verified, and a queue without a repair ignores rejected candidates', async () => {
	const failed = recordingQueue(async () => false);
	const plain = recordingQueue();

	for (const { queue } of [failed, plain]) {
		queue.add({ candidateId: 'c1', valid: false, severity: 'warning' } as CandidateFinding);
		await queue.drain();
	}

	expect(failed.verified).toEqual([]);
	expect(plain.verified).toEqual([]);
	expect(plain.queue.busy).toBe(false);
});

test('an error in a repair stops the queue like a verifier error', async () => {
	const { queue } = recordingQueue(async () => {
		throw new Error('model blocked');
	});

	queue.add({ candidateId: 'c1', valid: false, severity: 'warning' } as CandidateFinding);
	await expect(queue.drain()).rejects.toThrow('model blocked');
});

test('a repair counts against the review, and stops once the cap is spent', async () => {
	process.env.RECODER_REPAIR_CAP = '1';

	const run = runOf();
	const first = candidateOf(reported());
	const second = candidateOf(reported({ line: 31 }));

	expect(await repairCandidate(run, first)).toBe(true);
	expect(first.repair).toMatchObject({ method: 'deterministic', result: 'revalidated' });
	expect(await repairCandidate(run, second)).toBe(false);
	expect(second).toMatchObject({ valid: false, dropStage: 'location', line: 31 });
	expect(second.repair).toMatchObject({ result: 'not-run', reason: 'the review already made 1 repairs', changes: [] });
	expect(run.repairs).toBe(1);
});

test('a resumed review keeps the repairs its checkpoint counted, so the cap holds across a restart', async () => {
	const resumed = runOf(8);
	const fresh = runOf();

	expect(resumed.repairs).toBe(8);
	expect(await repairCandidate(resumed, candidateOf(reported()))).toBe(false);
	expect(await repairCandidate(fresh, candidateOf(reported()))).toBe(true);
	expect(resumed.repairs).toBe(8);
});

test('a candidate repaired once is never repaired again', async () => {
	const run = runOf();
	const candidate = candidateOf(reported({ file: 'src/invented.ts' }));

	expect(await repairCandidate(run, candidate)).toBe(false);
	expect(candidate.repair?.result).toBe('unsupported');
	expect(await repairCandidate(run, candidate)).toBe(false);
	expect(run.repairs).toBe(1);
});
