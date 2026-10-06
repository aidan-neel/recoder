import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateOutcome } from '../../../src/review/pipeline/candidate-outcome';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	addedFile,
	confirmingVerifier,
	finding,
	isVerifier,
	modelReply,
	restoreAfterEach,
	stubFindings,
	systemOf,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-harness-repair-'));
});

afterEach(() => {
	delete process.env.RECODER_CANDIDATE_REPAIR;
	delete process.env.RECODER_REPAIR_CAP;
});

/** A correctness finding in `file` reported on line 400, past the change, whose execution path cites line 3. */
function lostAnchor(title: string, file = 'src/a.ts') {
	const base = finding(title);

	return {
		...base,
		file,
		line: 400,
		claim: { ...base.claim, executionPath: [{ file, line: 3, note: 'the changed line' }] }
	};
}

/**
 * Reviews `addedFile('src/a.ts', 5)` with correctness reviewers reporting
 * `findings`, counting verifier and repair calls; a repair call gets `repairAnswer`.
 */
async function reviewFindings(findings: unknown[], repairAnswer: unknown = {}) {
	let verifiers = 0;
	let repairs = 0;

	stubFindings(findings, () => verifiers++);

	const answerOthers = globalThis.fetch;

	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		if (!systemOf(init).includes('You repair one code review finding')) return answerOthers(url, init);

		repairs++;

		return modelReply(repairAnswer);
	}) as unknown as typeof fetch;

	return { ...(await review(addedFile('src/a.ts', 5))), verifiers, repairs };
}

/** A finding on line 400 whose path cites line 50, which the change does not touch, so the diff leaves its line open. */
function uncitedAnchor(title: string) {
	const lost = lostAnchor(title);

	return { ...lost, claim: { ...lost.claim, executionPath: [{ file: 'src/a.ts', line: 50, note: 'unchanged' }] } };
}

/** Reviews `diff`, keeping the last checkpoint it saved. */
async function review(diff: string, resume?: ReviewProgressCheckpoint | null) {
	let saved: ReviewProgressCheckpoint | null = null;

	const result = await runAdaptiveReview(
		{ diff, sandboxPath: null, resume },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	return { result, checkpoint: saved as ReviewProgressCheckpoint | null };
}

function titled(checkpoint: ReviewProgressCheckpoint | null, title: string): CandidateFinding | undefined {
	return checkpoint?.candidates.find((candidate) => candidate.title === title);
}

test('a supported candidate past the change is linked to the changed line it cites, verified and kept on its line', async () => {
	const { result, checkpoint, verifiers, repairs } = await reviewFindings([lostAnchor('lost anchor')]);
	const candidate = titled(checkpoint, 'lost anchor');

	expect(repairs).toBe(0);
	expect(verifiers).toBeGreaterThan(0);
	expect(result.findings.map((item) => [item.title, item.file, item.line])).toEqual([['lost anchor', 'src/a.ts', 400]]);
	expect(candidate?.relatedLocations).toContainEqual({ file: 'src/a.ts', line: 3, endLine: 3, side: 'new' });

	expect(candidateOutcome(candidate!)).toMatchObject({
		stage: null,
		verified: true,
		repair: { result: 'revalidated' }
	});

	expect(candidate?.repair?.original).toMatchObject({ line: 400, stage: 'location' });
	expect(checkpoint?.repairs).toBe(1);
});

test('a candidate on an invented path stays rejected with its original stop and is never verified', async () => {
	const { result, checkpoint, verifiers, repairs } = await reviewFindings([lostAnchor('invented', 'src/invented.ts')]);

	expect(repairs).toBe(0);

	expect(verifiers).toBe(0);
	expect(result.findings).toEqual([]);

	expect(candidateOutcome(titled(checkpoint, 'invented')!)).toMatchObject({
		stage: 'location',
		reason: 'path is not in the change inventory',
		verified: false,
		repair: { result: 'unsupported', method: null, changes: [] }
	});
});

test('with RECODER_CANDIDATE_REPAIR=0 the candidate stops at location as before, and its outcome carries no repair', async () => {
	process.env.RECODER_CANDIDATE_REPAIR = '0';

	const { result, checkpoint, verifiers, repairs } = await reviewFindings([lostAnchor('lost anchor')]);
	const candidate = titled(checkpoint, 'lost anchor');

	expect(repairs).toBe(0);
	expect(verifiers).toBe(0);
	expect(result.findings).toEqual([]);
	expect(result.funnel?.dropped.location).toBe(1);
	expect(candidate?.repair).toBeUndefined();
	expect(checkpoint && 'repairs' in checkpoint).toBe(false);

	expect(JSON.stringify(candidateOutcome(candidate!))).toBe(
		'{"stage":"location","reason":"new-side line is not associated with this change","verified":false}'
	);
});

test('when the diff leaves the line open, one model call picks an offered changed line and the candidate is verified', async () => {
	const answer = { file: 'src/a.ts', line: 3, evidenceIds: [], reason: 'line 3 drops the value' };
	const { result, checkpoint, repairs } = await reviewFindings([uncitedAnchor('model anchor')], answer);

	expect(repairs).toBe(1);
	expect(result.findings.map((item) => [item.title, item.line])).toEqual([['model anchor', 3]]);

	expect(candidateOutcome(titled(checkpoint, 'model anchor')!)).toMatchObject({
		stage: null,
		verified: true,
		repair: { method: 'model', result: 'revalidated', changes: [{ kind: 'anchor', line: 3 }] }
	});
});

test('a model answer outside the offered lines leaves the candidate rejected with its original stop', async () => {
	const { result, checkpoint, verifiers, repairs } = await reviewFindings([uncitedAnchor('model miss')], { line: 40 });

	expect(repairs).toBe(1);
	expect(verifiers).toBe(0);
	expect(result.findings).toEqual([]);

	expect(candidateOutcome(titled(checkpoint, 'model miss')!)).toMatchObject({
		stage: 'location',
		reason: 'new-side line is not associated with this change',
		repair: { result: 'unsupported', reason: 'the model chose no offered line', method: null }
	});
});

/**
 * Answers `TWO_UNIT_DIFF`: each unit's correctness reviewer reports one
 * candidate past the change in its own file, `failing` names an assignment the
 * endpoint rejects, and verifiers confirm.
 */
function stubTwoUnits(failing: string | null): void {
	useTestModel();

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		const unit = unitOf(init);

		if (unit === failing) return new Response('bad request', { status: 400 });

		const findings =
			unit === 'unit-1/correctness'
				? [lostAnchor('first', 'src/a.ts')]
				: unit === 'unit-2/correctness'
					? [lostAnchor('second', 'tests/b.ts')]
					: [];

		return modelReply({ message: 'ok', ...NOTHING, findings });
	}) as unknown as typeof fetch;
}

test('the repair cap holds across a restart: a resumed review counts the repairs its checkpoint saved', async () => {
	process.env.RECODER_REPAIR_CAP = '1';
	stubTwoUnits('unit-2/correctness');

	const first = await review(TWO_UNIT_DIFF);

	expect(first.checkpoint?.repairs).toBe(1);
	expect(titled(first.checkpoint, 'first')?.repair?.result).toBe('revalidated');

	stubTwoUnits(null);

	const second = await review(TWO_UNIT_DIFF, first.checkpoint);
	const capped = titled(second.checkpoint, 'second');

	expect(capped).toMatchObject({ valid: false, dropStage: 'location', line: 400 });
	expect(capped?.repair).toMatchObject({ result: 'not-run', reason: 'the review already made 1 repairs' });
	expect(second.checkpoint?.repairs).toBe(1);
	expect(second.result.findings.map((item) => item.title)).toEqual(['first']);
});
