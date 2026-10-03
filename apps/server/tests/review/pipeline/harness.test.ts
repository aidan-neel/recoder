import { expect, test } from 'bun:test';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../src/review/pipeline/harness';
import { ReviewControl, runWithReviewControl } from '../../../src/review/session/review-control';
import { REVIEW_POLICY } from '../../../src/review/session/review-policy';
import {
	DIFF,
	NOTHING,
	PLAN,
	finding,
	modelReply,
	restoreAfterEach,
	stubModel,
	systemOf,
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

test('a resumed review reruns only unfinished specialists and keeps the finished ones’ findings', async () => {
	useTestModel();

	const first: string[] = [];

	stubModel(first, 'fail');

	let saved: ReviewProgressCheckpoint | null = null;

	const failed = await runAdaptiveReview(
		{ diff: DIFF, sandboxPath: null },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	expect(failed.assignments.find((record) => record.id === 'patterns-core')?.status).toBe('error');
	expect(first).toContain('patterns');

	const second: string[] = [];

	stubModel(second, 'ok');

	const resumed = await runAdaptiveReview({ diff: DIFF, sandboxPath: null, resume: saved });

	expect(second).toEqual(['patterns', 'patterns', 'consolidation']);
	expect(resumed.assignments.map((record) => record.status)).toEqual(['done', 'done']);
	expect(resumed.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);
});

test('a review whose consolidation fails still finishes with its findings', async () => {
	useTestModel();

	const calls: string[] = [];

	stubModel(calls, 'ok');

	const answer = globalThis.fetch;

	globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		if (
			!system.includes('review orchestrator') &&
			!system.includes('(correctness)') &&
			!system.includes('(patterns)')
		) {
			return Response.json({ choices: [{ message: { content: 'not json' } }] });
		}

		return answer(url, init);
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff: DIFF, sandboxPath: null });

	expect(result.outcome).toBe('complete');
	expect(result.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);
	expect(result.assignments.every((record) => record.status === 'done')).toBe(true);
});

test('a review that runs out of time finishes with the findings its specialists reported instead of failing', async () => {
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
		const system = systemOf(init);

		if (system.includes('(patterns)')) return stallPastDeadline(init);

		const reply = system.includes('review orchestrator') ? PLAN : { ...NOTHING, findings: [finding('possible miss')] };

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	const result = await runWithReviewControl(control, () =>
		runAdaptiveReview({ diff: DIFF, sandboxPath: null, signal: control.abort.signal })
	);

	expect(result.outcome).toBe('complete');
	expect(result.summary).toContain('ran out of time');
	expect(result.findings.map((item) => item.message)).toEqual(['[bug] possible miss']);

	expect(result.assignments.map((record) => [record.id, record.status])).toEqual([
		['correctness-core', 'done'],
		['patterns-core', 'error']
	]);
});
