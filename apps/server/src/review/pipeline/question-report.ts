import type { BriefQuestion, BriefQuestionReport, BriefQuestionResult, ReviewAssignment } from '@recoder/shared';
import type { CandidateFinding } from './consolidate.js';
import type { CodeClaim } from './intent/types.js';
import { questionRecord, questionStatus } from './question-ledger.js';

/** What the report reads from the run, as it stands when the review ends. */
export interface QuestionReportInput {
	/** The brief's open questions. */
	claims: CodeClaim[];
	records: BriefQuestion[];
	candidates: CandidateFinding[];
	/** Valid candidates no verifier proved, held back from the findings. */
	hidden: CandidateFinding[];
	/** The assignments as settled, which say whether each follow-up subagent finished. */
	assignments: ReviewAssignment[];
}

/** A planned follow-up, with why it did not run when its subagent did not finish. */
function settledFollowUp(followUp: BriefQuestion['followUps'][number], assignments: ReviewAssignment[]) {
	if (!followUp.unitId || followUp.notRun) return followUp;

	const assignment = assignments.find((record) => record.id === followUp.unitId);

	if (assignment?.status === 'done') return followUp;

	return { ...followUp, notRun: `Its subagent ended ${assignment?.status ?? 'without being scheduled'}.` };
}

/**
 * Every open question of the brief, in its order, with the answers and
 * follow-ups it got and its result as the candidates now stand; null when the
 * brief had none. The stored records are left as they are.
 */
export function briefQuestionReport(input: QuestionReportInput): BriefQuestionReport | null {
	if (!input.claims.length) return null;

	const records = structuredClone(input.records);

	const questions = input.claims.map((claim) => {
		const record = questionRecord(records, claim);
		const followUps = record.followUps.map((followUp) => settledFollowUp(followUp, input.assignments));

		return { ...record, followUps, ...questionStatus(record, input.candidates, input.hidden) };
	});

	const count = (result: BriefQuestionResult) => questions.filter((question) => question.result === result).length;
	const followUps = questions.flatMap((question) => question.followUps);

	return {
		counts: {
			asked: questions.length,
			confirmed: count('confirmed'),
			disproved: count('disproved'),
			unresolved: count('unresolved'),
			notApplicable: questions.flatMap(({ answers }) => answers).filter(({ result }) => result === 'not-applicable')
				.length,
			followUpsRun: followUps.filter((followUp) => followUp.unitId && !followUp.notRun).length,
			followUpsNotRun: followUps.filter((followUp) => followUp.notRun).length
		},
		questions
	};
}

/**
 * The behavior the review investigated, apart from the code it covered:
 * "Of 3 brief questions, 2 were settled (1 confirmed, 1 disproved) and 1 is
 * still open; 1 follow-up could not run."
 */
export function questionSentence({ counts }: BriefQuestionReport): string {
	const settled = counts.confirmed + counts.disproved;

	const open = counts.unresolved
		? ` and ${counts.unresolved} ${counts.unresolved === 1 ? 'is' : 'are'} still open`
		: '';

	const lost = counts.followUpsNotRun;
	const missed = lost ? `; ${lost} follow-up${lost === 1 ? '' : 's'} could not run` : '';

	return `Of ${counts.asked} brief question${counts.asked === 1 ? '' : 's'}, ${settled} ${settled === 1 ? 'was' : 'were'} settled (${counts.confirmed} confirmed, ${counts.disproved} disproved)${open}${missed}.`;
}
