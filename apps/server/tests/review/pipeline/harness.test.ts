import { expect, test } from 'bun:test';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import { ReviewControl, runWithReviewControl } from '../../../src/review/session/review-control';
import { scaledReviewLimits } from '../../../src/review/session/review-policy';
import {
	DIFF,
	NOTHING,
	TWO_UNIT_DIFF,
	addedFile,
	confirmingVerifier,
	finding,
	isLensReviewer,
	isVerifier,
	lensIdsOf,
	messagesOf,
	modelReply,
	restoreAfterEach,
	stubModel,
	systemOf,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** Lens assignments one unit of code fans out into. */
const LENS_COUNT = lensIdsOf('unit-1').length;

/** What a finished review reported, by category and title. */
const reported = (result: { findings: { category?: string; title?: string }[] }) =>
	result.findings.map((item) => [item.category, item.title]);

/** The review clock reads wall time minus paused time; a negative pause skews it forward. */
class SkewedClock extends ReviewControl {
	skew = 0;

	override pausedMs(): number {
		return super.pausedMs() - this.skew;
	}
}

test('a resumed review reruns only unfinished lens assignments and keeps the finished ones’ findings', async () => {
	useTestModel();

	const first: string[] = [];

	stubModel(first, 'unit-2/correctness');

	let saved: ReviewProgressCheckpoint | null = null;

	const failed = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	expect(failed.assignments.find((record) => record.id === 'unit-2/correctness')?.status).toBe('error');
	expect(first).toContain('unit-2/correctness');

	const second: string[] = [];

	stubModel(second);

	const resumed = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, resume: saved });

	expect(second.filter((kind) => kind !== 'verifier')).toEqual(['unit-2/correctness']);
	expect(resumed.assignments.map((record) => record.id)).toEqual([...lensIdsOf('unit-1'), ...lensIdsOf('unit-2')]);
	expect(resumed.assignments.every((record) => record.status === 'done')).toBe(true);
	expect(reported(resumed)).toEqual([['correctness', 'possible miss']]);
});

test('consolidation makes no model call, so the same reviewer and verifier answers give the same findings', async () => {
	useTestModel();

	const runs: string[][] = [];

	for (let index = 0; index < 2; index++) {
		const calls: string[] = [];

		stubModel(calls);

		const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

		expect(result.outcome).toBe('complete');
		expect(calls.filter((kind) => kind === 'other')).toEqual([]);
		runs.push(result.findings.map((item) => `${item.category}:${item.title}:${item.fingerprint}`));
	}

	expect(runs[0]).toHaveLength(1);
	expect(runs[1]).toEqual(runs[0]);
});

test('a review that runs out of time keeps the findings its lenses reported instead of failing', async () => {
	useTestModel();

	const control = new SkewedClock();

	/** Never answers; once this call is in flight, the review's deadline has passed. */
	const stallPastDeadline = (init?: RequestInit) => {
		control.skew = scaledReviewLimits(2 * LENS_COUNT).deadlineMs + 5_000;

		return new Promise<Response>((_, reject) =>
			init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
		);
	};

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const unit = unitOf(init);

		if (unit === 'unit-2/correctness') return stallPastDeadline(init);
		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		return modelReply({
			message: 'ok',
			...NOTHING,
			findings: unit === 'unit-1/correctness' ? [finding('possible miss')] : []
		});
	}) as unknown as typeof fetch;

	const result = await runWithReviewControl(control, () =>
		runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, signal: control.abort.signal })
	);

	expect(result.outcome).toBe('complete');
	expect(result.summary).toContain('ran out of time');

	expect(reported({ findings: [...result.findings, ...result.unconfirmed] })).toEqual([
		['correctness', 'possible miss']
	]);

	expect(result.assignments.find((record) => record.id === 'unit-1/correctness')?.status).toBe('done');
	expect(result.assignments.find((record) => record.id === 'unit-2/correctness')?.status).toBe('error');
});

test('a review told to look only at Python files cuts its units from those files and tells every lens reviewer why', async () => {
	useTestModel();

	const diff = `${DIFF}diff --git a/src/b.py b/src/b.py
--- a/src/b.py
+++ b/src/b.py
@@ -1 +1 @@
-old
+new
`;

	const reviewerPrompts: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		if (isLensReviewer(init)) reviewerPrompts.push(messagesOf(init)[1].content);

		const reply = system.includes('file filter')
			? { includeGlobs: ['**/*.py'], excludeGlobs: [] }
			: { ...NOTHING, examinedHunks: ['src/b.py:1,1:1,1'] };

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff, sandboxPath: null, instructions: 'review only python files' });

	expect(result.outcome).toBe('complete');

	expect(new Set(result.assignments.flatMap((record) => record.scope.map((entry) => entry.path)))).toEqual(
		new Set(['src/b.py'])
	);

	expect(result.coverageGaps.find((gap) => gap.path === 'src/a.ts')?.reason).toContain('outside your instructions');
	expect(reviewerPrompts).toHaveLength(LENS_COUNT);
	expect(reviewerPrompts.every((prompt) => prompt.includes('review only python files'))).toBe(true);
});

test('an unattended review of many units runs every lens of every unit and finishes without waiting on anyone', async () => {
	useTestModel(8);

	const calls: string[] = [];
	const diff = Array.from({ length: 8 }, (_, index) => addedFile(`pkg${index}/index.ts`, 140)).join('');

	stubModel(calls);

	const result = await runAdaptiveReview({ diff, sandboxPath: null });

	expect(result.outcome).toBe('complete');
	expect(result.assignments).toHaveLength(8 * LENS_COUNT);
	expect(result.assignments.every((record) => record.status === 'done')).toBe(true);
});
