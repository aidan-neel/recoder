import { expect, test } from 'bun:test';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import { ReviewControl, runWithReviewControl } from '../../../src/review/session/review-control';
import { REVIEW_POLICY } from '../../../src/review/session/review-policy';
import {
	DIFF,
	KEEP_NONE,
	NOTHING,
	TWO_UNIT_DIFF,
	finding,
	messagesOf,
	modelReply,
	restoreAfterEach,
	stubModel,
	systemOf,
	unitOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

/** The review clock reads wall time minus paused time; a negative pause skews it forward. */
class SkewedClock extends ReviewControl {
	skew = 0;

	override pausedMs(): number {
		return super.pausedMs() - this.skew;
	}
}

test('a resumed review reruns only unfinished units and keeps the finished ones’ findings', async () => {
	useTestModel();

	const first: string[] = [];

	stubModel(first, 'unit-2');

	let saved: ReviewProgressCheckpoint | null = null;

	const failed = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	expect(failed.assignments.find((record) => record.id === 'unit-2')?.status).toBe('error');
	expect(first).toContain('unit-2');

	const second: string[] = [];

	stubModel(second);

	const resumed = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, resume: saved });

	expect(second).toEqual(['unit-2', 'unit-2', 'consolidation']);
	expect(resumed.assignments.map((record) => record.status)).toEqual(['done', 'done']);
	expect(resumed.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);
});

test('a review whose consolidation fails still finishes with its findings', async () => {
	useTestModel();

	const calls: string[] = [];

	stubModel(calls);

	const answer = globalThis.fetch;

	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		if (!unitOf(init)) return Response.json({ choices: [{ message: { content: 'not json' } }] });

		return answer(url, init);
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

	expect(result.outcome).toBe('complete');
	expect(result.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);
	expect(result.assignments.every((record) => record.status === 'done')).toBe(true);
});

test('a review that runs out of time finishes with the findings its reviewers reported instead of failing', async () => {
	useTestModel();

	const control = new SkewedClock();

	/** Never answers; once this call is in flight, the review's deadline has passed. */
	const stallPastDeadline = (init?: RequestInit) => {
		control.skew = REVIEW_POLICY.analysisDeadlineMs + 5_000;

		return new Promise<Response>((_, reject) =>
			init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
		);
	};

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (unitOf(init) === 'unit-2') return stallPastDeadline(init);

		return modelReply({ message: 'ok', ...NOTHING, findings: [finding('possible miss')] });
	}) as unknown as typeof fetch;

	const result = await runWithReviewControl(control, () =>
		runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, signal: control.abort.signal })
	);

	expect(result.outcome).toBe('complete');
	expect(result.summary).toContain('ran out of time');
	expect(result.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);

	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['unit-1', 'done'],
		['unit-2', 'error']
	]);
});

test('a review told to look only at Python files cuts its units from those files and tells every reviewer why', async () => {
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

		if (system.includes('primary reviewer')) reviewerPrompts.push(messagesOf(init)[1].content);

		const reply = system.includes('file filter')
			? { includeGlobs: ['**/*.py'], excludeGlobs: [], roles: [] }
			: system.includes('primary reviewer')
				? { ...NOTHING, examinedHunks: ['src/b.py:1,1:1,1'] }
				: KEEP_NONE;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff, sandboxPath: null, instructions: 'review only python files' });

	expect(result.outcome).toBe('complete');
	expect(result.assignments.flatMap((record) => record.scope.map((entry) => entry.path))).toEqual(['src/b.py']);
	expect(result.coverageGaps.find((gap) => gap.path === 'src/a.ts')?.reason).toContain('outside your instructions');
	expect(reviewerPrompts.length).toBeGreaterThan(0);
	expect(reviewerPrompts.every((prompt) => prompt.includes('review only python files'))).toBe(true);
});
