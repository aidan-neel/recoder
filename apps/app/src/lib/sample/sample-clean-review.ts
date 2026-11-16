import type { BriefQuestionReport, Review } from '@recoder/shared';

/** A question the sample's clean review asked about its change, and why it did not hold. */
function cleared(id: string, file: string, line: number, question: string, reason: string) {
	return {
		id,
		question,
		owners: ['correctness'],
		source: { file, line },
		answers: [],
		followUps: [],
		result: 'disproved' as const,
		reason
	};
}

const QUESTIONS: BriefQuestionReport['questions'] = [
	cleared(
		'Q1',
		'src/http/pagination.ts',
		48,
		'Can the Link header point past the last page?',
		'The handler stops adding rel="next" once offset plus limit reaches the total.'
	),
	cleared(
		'Q2',
		'src/http/params.ts',
		21,
		'Does a limit of 0 return every row?',
		'The schema clamps limit to 1–100, so 0 is rejected with a 400.'
	),
	cleared(
		'Q3',
		'src/users/list-users.ts',
		63,
		'Can X-Total-Count drift when rows change mid-page?',
		'The count and the page are read in one transaction.'
	)
];

/**
 * What the sample's clean review checked: the questions it disproved, the
 * changed units its brief read in full, and the leads it raised and dropped,
 * so the Bugs tab's no-bugs state shows its figures.
 */
export function cleanReviewChecks(): Pick<Review, 'funnel' | 'questions'> {
	return {
		questions: {
			counts: {
				asked: QUESTIONS.length,
				confirmed: 0,
				disproved: QUESTIONS.length,
				unresolved: 0,
				notApplicable: 0,
				followUpsRun: 0,
				followUpsNotRun: 0
			},
			questions: QUESTIONS
		},
		funnel: {
			raised: 7,
			dropped: { location: 1, evidence: 2, category: 0, severity: 1, dismissed: 0, refuted: 3, covered: 0 },
			unproven: 0,
			verified: 0,
			shown: 0,
			brief: {
				complete: true,
				units: ['pagination', 'params', 'list-users'].map((id) => ({ id, status: 'included' as const }))
			}
		}
	};
}
