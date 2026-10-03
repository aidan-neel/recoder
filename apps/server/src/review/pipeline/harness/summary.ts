import {
	REVIEW_CANCELLED,
	settleAssignments,
	type CoverageSummary,
	type Finding,
	type ReviewAssignment
} from '@recoder/shared';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError } from '../agent-loop.js';
import type { CoverageLedger } from '../coverage.js';
import { unfinishedAssignments } from './assignments.js';
import { keepUnconsolidated, type Consolidated } from './consolidation.js';
import { validCandidates, type ReviewRun } from './context.js';
import type { AdaptiveReviewResult } from './types.js';

/**
 * The result of a review that reached the end. Coverage gaps and failed
 * units are reported in the summary and the coverage rail.
 */
export function completeReview(run: ReviewRun, consolidated: Consolidated): AdaptiveReviewResult {
	const { confirmed, checks, error } = consolidated;
	const coverage = run.coverage.summary();

	const summary = buildSummary(run.assignments, confirmed, coverage);

	return {
		findings: confirmed,
		unconfirmed: [],
		summary,
		outcome: 'complete',
		recommendedChecks: [...new Set(checks)],
		coverage,
		coverageGaps: run.coverage.gaps(),
		assignments: run.assignments,
		planningDegraded: run.planningDegraded,
		error
	};
}

/**
 * The result of a review that threw. A blocked model or a cancel fails it; running
 * out of time once units exist still finishes with what the reviewers found.
 * The deadline grows with change size, prep and verification, so the message reports what actually elapsed.
 */
export function stoppedReview(run: ReviewRun, err: unknown): AdaptiveReviewResult {
	const { assignments, coverage } = run;

	if (err instanceof ModelBlockedError) {
		return { ...failReview(assignments, coverage, err.message), failure: err.failure };
	}

	if (!(err instanceof ReviewAbortedError) && !run.controller.signal.aborted) {
		return failReview(assignments, coverage, err instanceof Error ? err.message : 'Review failed');
	}

	if (run.input.signal?.aborted) return failReview(assignments, coverage, REVIEW_CANCELLED);

	const minutes = Math.max(1, Math.round((reviewNow() - run.startedAt) / 60_000));

	if (run.units.length) return finishOutOfTime(run, minutes);

	return failReview(assignments, coverage, `The review ran out of time (${minutes} minutes) before reviewing started.`);
}

/**
 * The clock ran out mid-review. Reviewers still running are closed out, and
 * the valid candidates found so far become the findings, as reported.
 */
function finishOutOfTime(run: ReviewRun, minutes: number): AdaptiveReviewResult {
	const reason = `the review ran out of time after ${minutes} minutes`;
	const settled = settleAssignments(run.assignments, 'Not finished: the review ran out of time');
	const confirmed = keepUnconsolidated(validCandidates(run.candidates), reason, run.task);

	const summary = buildSummary(settled, confirmed, run.coverage.summary());

	return {
		findings: confirmed,
		unconfirmed: [],
		summary: `${summary} The review ran out of time after ${minutes} minutes; findings were kept as the reviewers reported them.`,
		outcome: 'complete',
		recommendedChecks: [...run.recommended],
		coverage: run.coverage.summary(),
		coverageGaps: run.coverage.gaps(),
		assignments: settled,
		planningDegraded: run.planningDegraded,
		error: `Ran out of time after ${minutes} minutes`
	};
}

/** A failed review: no findings, and every unfinished assignment is settled with the error. */
function failReview(assignments: ReviewAssignment[], coverage: CoverageLedger, error: string): AdaptiveReviewResult {
	return {
		findings: [],
		unconfirmed: [],
		summary: error,
		outcome: 'failed',
		recommendedChecks: [],
		coverage: coverage.summary(),
		coverageGaps: coverage.gaps(),
		assignments: settleAssignments(assignments, error),
		planningDegraded: true,
		error
	};
}

/** "2 verified by running code, 1 unverified." — empty when nothing was checked. */
function verifiedSummary(findings: Finding[]): string {
	const verified = findings.filter(
		(finding) => finding.verification?.status === 'verified' && finding.verification.method !== 'trace'
	).length;

	const traced = findings.filter((finding) => finding.verification?.method === 'trace').length;
	const unverified = findings.filter((finding) => finding.verification?.status === 'unverified').length;

	if (!verified && !traced && !unverified) return '';

	return (
		[
			verified ? `${verified} verified by running code` : '',
			traced ? `${traced} traced through the code` : '',
			unverified ? `${unverified} unverified` : ''
		]
			.filter(Boolean)
			.join(', ') + '.'
	);
}

/** The review's one-paragraph summary; partial coverage is reported by its last sentence. */
function buildSummary(assignments: ReviewAssignment[], confirmed: Finding[], coverage: CoverageSummary): string {
	const incomplete = unfinishedAssignments(assignments);

	const bits = [
		`Review complete. ${confirmed.length} confirmed finding${confirmed.length === 1 ? '' : 's'}.`,
		verifiedSummary(confirmed),
		incomplete.length ? `${incomplete.length} review unit${incomplete.length === 1 ? '' : 's'} did not finish.` : '',
		coverage.partial + coverage.pending > 0 ? 'Some changes still need review.' : ''
	];

	return bits.filter(Boolean).join(' ');
}
