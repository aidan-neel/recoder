import type { Finding, FindingSeverity } from './findings';
import type { ObligationResult } from './obligations';
import type { BriefQuestionResult } from './questions';
import type { Review } from './review';

/**
 * A finding as the review list carries it: enough to count what is left to
 * decide, of which kind, and how urgent it is. A list item leaves quieted findings out; a full
 * review read as a list item still holds them, so `topic` says which they are.
 */
export type ReviewListFinding = Pick<Finding, 'id' | 'severity' | 'topic' | 'kind' | 'decision'>;

/**
 * A review as `GET /api/reviews?view=summary` lists it: the fields the queue,
 * the tabs and the command palette read, with findings, brief questions and
 * obligation answers cut to their ids and outcomes. Every full `Review` is
 * one, so code written for a list item also takes a full review.
 */
export interface ReviewListItem extends Pick<
	Review,
	'id' | 'repoId' | 'prNumber' | 'headSha' | 'status' | 'summary' | 'prTitle' | 'prUrl' | 'createdAt' | 'updatedAt'
> {
	findings: ReviewListFinding[];
	questions?: { questions: { id: string; result: BriefQuestionResult }[] };
	obligations?: { obligations: { id: string }[]; answers: { obligationId: string; result: ObligationResult }[] };
}

/** How strongly a decision asks for attention: a finding by its severity, or a question no reviewer could settle. */
export type DecisionTone = 'high' | 'medium' | 'low' | 'question';

/** What a review leaves to decide, given the saved decisions. */
export interface ReviewTally {
	/** Decisions still open, and the strongest tone among them. */
	open: number;
	tone: DecisionTone | null;
	/** Decisions sent back to the author. */
	sent: number;
	/** Things a reviewer checked and found sound. */
	receipts: number;
}

/** Strongest first. */
const TONE_RANK: Record<DecisionTone, number> = { high: 0, medium: 1, question: 2, low: 3 };

/** A finding's tone: an error is high, a warning medium, the rest low. */
export function findingTone(severity: FindingSeverity): DecisionTone {
	if (severity === 'error') return 'high';
	if (severity === 'warning') return 'medium';

	return 'low';
}

/**
 * The list item for one review: each finding feedback did not quiet keeps its id and severity, and
 * records only the review page reads are left out. It reads only what a list
 * item carries, so it also cuts down a full review typed as a list item.
 */
export function reviewListItem(review: ReviewListItem): ReviewListItem {
	const { id, repoId, prNumber, headSha, status, summary, prTitle, prUrl, createdAt, updatedAt } = review;

	return {
		id,
		repoId,
		prNumber,
		headSha,
		status,
		summary,
		prTitle,
		prUrl,
		createdAt,
		updatedAt,
		findings: review.findings
			.filter((finding) => !finding.topic?.quieted)
			.map((finding) => ({
				id: finding.id,
				severity: finding.severity,
				...(finding.kind && { kind: finding.kind }),
				...(finding.decision && { decision: finding.decision })
			})),
		...(review.questions && {
			questions: {
				questions: review.questions.questions.map((question) => ({ id: question.id, result: question.result }))
			}
		}),
		...(review.obligations && {
			obligations: {
				obligations: review.obligations.obligations.map((obligation) => ({ id: obligation.id })),
				answers: review.obligations.answers.map((answer) => ({
					obligationId: answer.obligationId,
					result: answer.result
				}))
			}
		})
	};
}

/**
 * Every decision the review leaves to a person, keyed as saved decisions are:
 * each finding feedback did not quiet, and each unsettled brief question.
 */
function decisionsOf(review: ReviewListItem): { id: string; tone: DecisionTone }[] {
	const findings = review.findings
		.filter((finding) => !finding.topic?.quieted)
		.map((finding) => ({ id: finding.id, tone: findingTone(finding.severity) }));

	const questions = (review.questions?.questions ?? [])
		.filter((question) => question.result === 'unresolved')
		.map((question) => ({ id: `question:${question.id}`, tone: 'question' as const }));

	return [...findings, ...questions];
}

/** Brief questions a reviewer disproved, and risky changes whose investigation came back clean. */
function receiptCount(review: ReviewListItem): number {
	const disproved = (review.questions?.questions ?? []).filter((question) => question.result === 'disproved').length;
	const obligations = new Set(review.obligations?.obligations.map((obligation) => obligation.id));

	const clean = (review.obligations?.answers ?? []).filter(
		(answer) => answer.result === 'disproved' && obligations.has(answer.obligationId)
	).length;

	return disproved + clean;
}

/**
 * What a review leaves to decide, given each decision's saved state by id
 * (absent or `open` until the person acts, `sent` when sent back). A list
 * item and its full review give the same tally.
 */
export function reviewTally(review: ReviewListItem, states: Record<string, string | undefined>): ReviewTally {
	const decisions = decisionsOf(review);
	const open = decisions.filter((decision) => (states[decision.id] ?? 'open') === 'open');
	const tone = open.map((decision) => decision.tone).sort((a, b) => TONE_RANK[a] - TONE_RANK[b])[0] ?? null;

	return {
		open: open.length,
		tone,
		sent: decisions.filter((decision) => states[decision.id] === 'sent').length,
		receipts: receiptCount(review)
	};
}
