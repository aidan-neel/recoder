import type { BriefQuestion, ReviewAssignment } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { questionRecord } from '../../../src/review/pipeline/question-ledger';
import { briefQuestionReport, questionSentence } from '../../../src/review/pipeline/question-report';
import { TRACE, answer, candidate, question, recorded, reply } from './question-fixtures';

const [Q1, Q2, Q3] = [question('Q1', 2), question('Q2', 52), question('Q3', 53)];

/** An assignment record with only the fields the report reads. */
const assignment = (id: string, status: ReviewAssignment['status']) => ({ id, status }) as ReviewAssignment;

test('a follow-up that could not run is reported with the reason, and the stored records are left as they are', () => {
	const records: BriefQuestion[] = recorded(
		reply('unit-1/correctness', [Q1, Q2, Q3], {
			answered: [answer('Q3', 'disproved', { note: 'Guarded.', contractEvidence: TRACE })],
			unsettled: ['Q1']
		})
	);

	questionRecord(records, Q1).followUps.push({ unitId: 'subagent-1' });
	questionRecord(records, Q2).followUps.push({ unitId: null, notRun: 'No subagent was left under the cap for it.' });

	const before = structuredClone(records);

	const report = briefQuestionReport({
		claims: [Q1, Q2, Q3],
		records,
		candidates: [candidate('c1')],
		hidden: [],
		assignments: [assignment('subagent-1', 'error')]
	})!;

	expect(records).toEqual(before);

	expect(report.questions.map(({ id, result, followUps }) => [id, result, followUps])).toEqual([
		['Q1', 'unresolved', [{ unitId: 'subagent-1', notRun: 'Its subagent ended error.' }]],
		['Q2', 'unresolved', [{ unitId: null, notRun: 'No subagent was left under the cap for it.' }]],
		['Q3', 'disproved', []]
	]);

	expect(report.counts).toEqual({
		asked: 3,
		confirmed: 0,
		disproved: 1,
		unresolved: 2,
		notApplicable: 0,
		followUpsRun: 0,
		followUpsNotRun: 2
	});

	expect(questionSentence(report)).toBe(
		'Of 3 brief questions, 1 was settled (0 confirmed, 1 disproved) and 2 are still open; 2 follow-ups could not run.'
	);
});

test('a brief with no open questions has no report', () => {
	expect(briefQuestionReport({ claims: [], records: [], candidates: [], hidden: [], assignments: [] })).toBeNull();
});
