import type { ObligationAnswer, ObligationReport, ObligationResult, ObligationSpend } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';
import type { ObligationState } from './state.js';

/** The review's obligations, their answers and the counts the summary and the eval report show. */
export function obligationReport(state: ObligationState, candidates: CandidateFinding[]): ObligationReport {
	const derived = state.derived ?? [];
	const { answers } = state;
	const count = (result: ObligationResult) => answers.filter((answer) => answer.result === result).length;

	const verified = answers.filter((answer) =>
		candidates.some(
			(candidate) => candidate.candidateId === answer.candidateId && candidate.verification?.status === 'verified'
		)
	).length;

	return {
		counts: {
			derived: derived.length,
			launched: answers.filter((answer) => answer.launched).length,
			overCap: derived.length - state.units.length,
			notLaunched: answers.filter((answer) => !answer.launched).length,
			confirmed: count('confirmed'),
			disproved: count('disproved'),
			notApplicable: count('not-applicable'),
			unresolved: count('unresolved'),
			verified
		},
		spent: spentOn(answers.filter((answer) => answer.launched)),
		cap: state.cap,
		timeBoxMs: state.timeBoxMs,
		obligations: derived,
		answers
	};
}

/** The launched investigations' time, model calls and output tokens, summed. */
function spentOn(launched: ObligationAnswer[]): ObligationSpend {
	const sum = (pick: (answer: ObligationAnswer) => number) =>
		launched.reduce((total, answer) => total + pick(answer), 0);

	return {
		elapsedMs: sum((answer) => answer.elapsedMs),
		queuedMs: sum((answer) => answer.queuedMs),
		workingMs: sum((answer) => answer.workingMs),
		turns: sum((answer) => answer.turns),
		tokens: launched.some((answer) => answer.tokens !== null) ? sum((answer) => answer.tokens ?? 0) : null
	};
}

/** "3 obligations derived, 2 investigated: 1 confirmed, 1 unresolved." for the review summary. */
export function obligationSentence({ counts }: ObligationReport): string {
	if (!counts.derived) return 'No obligations were derived.';

	const results = [
		[counts.confirmed, 'confirmed'],
		[counts.disproved, 'disproved'],
		[counts.notApplicable, 'not applicable'],
		[counts.unresolved, 'unresolved']
	] as const;

	const parts = results.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`);

	return `${counts.derived} obligation${counts.derived === 1 ? '' : 's'} derived, ${counts.launched} investigated${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}
