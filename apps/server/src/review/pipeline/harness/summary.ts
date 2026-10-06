import {
	REVIEW_CANCELLED,
	settleAssignments,
	type CoverageSummary,
	type Finding,
	type FindingVerification,
	type ObligationReport,
	type ReviewAssignment,
	type ReviewFunnel
} from '@recoder/shared';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError } from '../agent-loop.js';
import { isHeldBack, toFinding, type CandidateFinding } from '../consolidate.js';
import type { CoverageLedger } from '../coverage.js';
import { obligationReport, obligationSentence } from '../obligations/report.js';
import { unfinishedAssignments } from './assignments.js';
import { confirmedFindings, type Consolidated } from './consolidation.js';
import type { ReviewRun } from './context.js';
import { droppedSentence } from './subagent-stage.js';
import type { AdaptiveReviewResult } from './types.js';
import { hideUnproven } from './verification.js';

/**
 * Candidates a verifier refuted, carrying its reason as their verification,
 * so an eval can tell a wrong refutation from a finding nobody raised.
 */
function refutedCandidates(run: ReviewRun): CandidateFinding[] {
	return run.candidates
		.filter((candidate) => candidate.refuted)
		.map((candidate) => ({
			...candidate,
			verification: {
				status: 'unverified',
				outcome: 'refuted',
				reason: candidate.dropReason ?? 'refuted by the verifier'
			}
		}));
}

/**
 * Counts where the run's candidates went. A candidate held back for being
 * below the reporting bar counts as dropped at `severity` however far it got,
 * so raised = dropped + unproven + verified. A candidate from a checkpoint
 * older than drop stages counts only as raised.
 */
export function reviewFunnel(run: Pick<ReviewRun, 'candidates' | 'hidden'>, shown: number): ReviewFunnel {
	const dropped: ReviewFunnel['dropped'] = {
		location: 0,
		evidence: 0,
		category: 0,
		severity: 0,
		dismissed: 0,
		refuted: 0,
		covered: 0
	};

	for (const candidate of run.candidates) {
		if (!candidate.valid && candidate.dropStage) dropped[candidate.dropStage]++;
		if (isHeldBack(candidate)) dropped.severity++;
	}

	return {
		raised: run.candidates.length,
		dropped,
		unproven: run.hidden.length,
		verified: run.candidates.filter(
			(candidate) => candidate.valid && !isHeldBack(candidate) && candidate.verification?.status === 'verified'
		).length,
		shown
	};
}

/**
 * The result of a review that reached the end. Coverage gaps and failed
 * units are reported in the summary and the coverage rail. Unproven
 * and refuted candidates come back as `unconfirmed`, never shown; the summary
 * counts only the unproven ones.
 */
export function completeReview(run: ReviewRun, consolidated: Consolidated): AdaptiveReviewResult {
	const { confirmed, checks } = consolidated;
	const coverage = run.coverage.summary();
	const obligations = run.obligations && obligationReport(run.obligations, run.candidates);

	const summary = buildSummary(run, run.assignments, confirmed, coverage, obligations);

	return {
		findings: confirmed,
		unconfirmed: [...run.hidden, ...refutedCandidates(run)].map(toFinding),
		funnel: reviewFunnel(run, confirmed.length),
		summary,
		outcome: 'complete',
		recommendedChecks: [...new Set(checks)],
		coverage,
		coverageGaps: run.coverage.gaps(),
		assignments: run.assignments,
		...(obligations ? { obligations } : {})
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
 * The clock ran out mid-review. Reviewers still running are closed out; the
 * candidates verified so far become the findings and the rest are hidden.
 */
function finishOutOfTime(run: ReviewRun, minutes: number): AdaptiveReviewResult {
	const settled = settleAssignments(run.assignments, 'Not finished: the review ran out of time');

	hideUnproven(run);

	const confirmed = confirmedFindings(run);
	const obligations = run.obligations && obligationReport(run.obligations, run.candidates);
	const summary = buildSummary(run, settled, confirmed, run.coverage.summary(), obligations);

	return {
		findings: confirmed,
		unconfirmed: run.hidden.map(toFinding),
		funnel: reviewFunnel(run, confirmed.length),
		summary: `${summary} The review ran out of time after ${minutes} minutes; only findings verified by then are shown.`,
		outcome: 'complete',
		recommendedChecks: [...run.recommended],
		coverage: run.coverage.summary(),
		coverageGaps: run.coverage.gaps(),
		assignments: settled,
		error: `Ran out of time after ${minutes} minutes`,
		...(obligations ? { obligations } : {})
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
		error
	};
}

/** How each verification method reads in the summary. */
const METHOD_WORDS: Record<NonNullable<FindingVerification['method']>, string> = {
	run: 'verified by running code',
	trace: 'traced through the code',
	detector: 'found by a deterministic check',
	rule: 'checked against a repo rule',
	convention: "checked against the repo's conventions"
};

/** "2 verified by running code, 1 traced through the code." — empty when nothing was checked. */
function verifiedSummary(findings: Finding[]): string {
	const parts = Object.entries(METHOD_WORDS).flatMap(([method, words]) => {
		const count = findings.filter((finding) => finding.verification?.method === method).length;

		return count ? [`${count} ${words}`] : [];
	});

	return parts.length ? `${parts.join(', ')}.` : '';
}

/** "3 unproven candidates were hidden." — empty when none were. */
function hiddenSentence(hidden: number): string {
	if (!hidden) return '';

	return `${hidden} unproven candidate${hidden === 1 ? ' was' : 's were'} hidden.`;
}

/**
 * The review's one-paragraph summary: unfinished units and subagents, subagent
 * requests past the limit, obligation counts when obligations ran, and partial coverage last.
 */
function buildSummary(
	run: ReviewRun,
	assignments: ReviewAssignment[],
	confirmed: Finding[],
	coverage: CoverageSummary,
	obligations: ObligationReport | null
): string {
	const incomplete = unfinishedAssignments(assignments);
	const units = incomplete.filter((record) => record.role !== 'subagent' && record.role !== 'obligation').length;
	const subagents = incomplete.filter((record) => record.role === 'subagent').length;

	const bits = [
		`Review complete. ${confirmed.length} confirmed finding${confirmed.length === 1 ? '' : 's'}.`,
		verifiedSummary(confirmed),
		hiddenSentence(run.hidden.length),
		units ? `${units} review unit${units === 1 ? '' : 's'} did not finish.` : '',
		subagents ? `${subagents} subagent${subagents === 1 ? '' : 's'} did not finish.` : '',
		droppedSentence(run.subagents.dropped),
		obligations ? obligationSentence(obligations) : '',
		coverage.partial + coverage.pending > 0 ? 'Some changes still need review.' : ''
	];

	return bits.filter(Boolean).join(' ');
}
