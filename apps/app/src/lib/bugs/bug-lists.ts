import { prettyModelName, type Review } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import type { Vote } from '../pull/session-state';
import { formatDuration, plural } from '../shell/format';
import { bugView } from './bug-view';
import type { BugsView, BugTone, BugView, UnresolvedItem } from './types';

/** What the Bugs tab lists, read from one finished review. */
export type BugLists = Pick<
	BugsView,
	'open' | 'decided' | 'resolved' | 'quieted' | 'unresolved' | 'checked' | 'reviewedAt' | 'headSha' | 'duration'
>;

const TONE_ORDER: Record<BugTone, number> = { high: 0, medium: 1, low: 2 };

/** Bugs before suggestions, then the strongest tone, then by file and line. */
function byUrgency(a: BugView, b: BugView): number {
	return (
		Number(a.kind === 'suggestion') - Number(b.kind === 'suggestion') ||
		TONE_ORDER[a.tone] - TONE_ORDER[b.tone] ||
		a.file.localeCompare(b.file) ||
		(a.line ?? 0) - (b.line ?? 0)
	);
}

/** Newest decision first. */
function byDecision(a: BugView, b: BugView): number {
	return Date.parse(b.decision?.decidedAt ?? '') - Date.parse(a.decision?.decidedAt ?? '');
}

/** Brief questions no reviewer could settle. */
function openQuestions(review: Review): UnresolvedItem[] {
	return (review.questions?.questions ?? [])
		.filter((question) => question.result === 'unresolved')
		.map((question) => ({
			id: `question:${question.id}`,
			kind: 'question',
			title: question.question,
			detail: question.reason
		}));
}

/** Risky changes whose investigation ended unresolved; one that never started was left out. */
function openObligations(review: Review): UnresolvedItem[] {
	const report = review.obligations;
	const questions = new Map(report?.obligations.map((obligation) => [obligation.id, obligation.question]));

	return (report?.answers ?? [])
		.filter((answer) => answer.result === 'unresolved')
		.map((answer) => ({
			id: `obligation:${answer.obligationId}`,
			kind: answer.launched ? 'question' : 'skipped',
			title: questions.get(answer.obligationId) ?? answer.obligationId,
			detail: answer.reason
		}));
}

/** Claims raised that no verifier could prove or refute. */
function unprovenClaims(review: Review): UnresolvedItem[] {
	return (review.unconfirmed ?? []).map((finding) => ({
		id: `unconfirmed:${finding.id}`,
		kind: 'question',
		title: finding.title ?? finding.message,
		detail: finding.verification?.reason ?? 'No check could prove or refute it.'
	}));
}

/** Findings shown unverified because none of the repository's checks could run in the review. */
function checksNotRun(review: Review): UnresolvedItem[] {
	const notRun = review.funnel?.notRun ?? 0;

	if (notRun === 0) return [];

	return [
		{
			id: 'prerequisite:checks',
			kind: 'prerequisite',
			title: 'The repository’s checks could not run',
			detail: `No code could run in the review, so ${plural(notRun, 'finding')} could not be verified.`
		}
	];
}

/** Work the review could not finish; it is listed apart and never counts as a finding. */
function unresolvedItems(review: Review): UnresolvedItem[] {
	return [...openQuestions(review), ...openObligations(review), ...unprovenClaims(review), ...checksNotRun(review)];
}

/** Questions and risky changes the review investigated, and those it disproved. */
function checkedClaims(review: Review): BugsView['checked'] {
	const questions = review.questions?.questions ?? [];
	const answers = review.obligations?.answers ?? [];
	const disproved = [...questions, ...answers].filter((item) => item.result === 'disproved').length;

	return { claims: questions.length + answers.length, cleared: disproved };
}

/** How long the review took, from its start to its last update. */
function durationOf(review: Review): string | null {
	const took = Date.parse(review.updatedAt) - Date.parse(review.startedAt ?? review.createdAt);

	return Number.isFinite(took) && took >= 0 ? formatDuration(took) : null;
}

/** The model the review's orchestrator ran on, in words; null until the review says. */
export function modelLabel(model: string | undefined): string | null {
	return model ? prettyModelName(model) : null;
}

/** The finished review's findings, sorted into the Bugs tab's lists. */
export function bugLists(review: Review, votes: Record<string, Vote>): BugLists {
	const view = (finding: Review['findings'][number]) => bugView(finding, review, votes[finding.id] ?? null);
	const shown = review.findings.filter((finding) => !finding.topic?.quieted);

	return {
		open: shown.filter(isOpenFinding).map(view).sort(byUrgency),
		decided: shown
			.filter((finding) => finding.decision)
			.map(view)
			.sort(byDecision),
		resolved: (review.resolved ?? []).map((resolved) => ({ bug: view(resolved.finding), reason: resolved.reason })),
		quieted: review.findings.filter((finding) => finding.topic?.quieted).map(view),
		unresolved: unresolvedItems(review),
		checked: checkedClaims(review),
		reviewedAt: review.updatedAt,
		headSha: review.headSha,
		duration: durationOf(review)
	};
}
