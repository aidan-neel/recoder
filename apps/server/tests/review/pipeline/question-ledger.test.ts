import { expect, test } from 'bun:test';
import { questionStatus, restoreQuestions } from '../../../src/review/pipeline/question-ledger';
import { TRACE, TRIED, answer, candidate, question, recorded, reply } from './question-fixtures';

const Q1 = question('Q1', 2);
const Q2 = question('Q2', 52);

/** Q1's stored record after `owner` replies with `answered` and the `findings` it names. */
function afterAnswer(
	answered: ReturnType<typeof answer>[],
	findings: { questionId: string | null; id: string }[] = []
) {
	const shown = [Q1, Q2];
	const linked = findings.map(({ questionId, id }) => ({ questionId, candidate: candidate(id) }));

	return recorded(reply('unit-1/correctness', shown, { answered, findings: linked }));
}

test('an empty disproof cannot close the question', () => {
	const unbacked = [
		answer('Q1', 'disproved', { note: '', contractEvidence: TRACE }),
		answer('Q1', 'disproved', { note: 'It is fine.' }),
		answer('Q1', 'disproved', { contractEvidence: [{ kind: 'source', location: 'src/z.ts:3', note: 'Unread.' }] }),
		answer('Q1', 'disproved', { contractEvidence: [{ kind: 'source', location: 'src/a.ts:2', note: '' }] }),
		answer('Q1', 'disproved', { attemptedCounterexample: { ...TRIED, evidenceId: 'ev_read' } })
	];

	for (const entry of unbacked) {
		const [record] = afterAnswer([entry]);

		expect(record.answers.map(({ result }) => result)).toEqual(['unresolved']);
		expect(record.answers[0].reason).toStartWith('Disproved without a note');
		expect(questionStatus(record, []).result).toBe('unresolved');
	}

	expect(afterAnswer([unbacked[0]])[0].answers[0].contractEvidence).toEqual(TRACE);
});

test('a disproof backed by a source trace or a command result closes it, keeping that evidence', () => {
	const [traced] = afterAnswer([answer('Q1', 'disproved', { note: 'Guarded.', contractEvidence: TRACE })]);
	const [ran] = afterAnswer([answer('Q1', 'disproved', { note: 'Tried it.', attemptedCounterexample: TRIED })]);

	expect(questionStatus(traced, [])).toEqual({ result: 'disproved', reason: 'Guarded.' });
	expect(traced.answers[0].contractEvidence).toEqual(TRACE);

	expect(questionStatus(ran, []).result).toBe('disproved');

	expect(ran.answers[0]).toMatchObject({
		attemptedCounterexample: { input: '""', command: 'bun repro.ts', evidenceId: 'ev_run', observed: 'returned []' },
		evidenceIds: ['ev_run']
	});
});

test('an unrelated finding cannot confirm a question', () => {
	const records = afterAnswer(
		[answer('Q1', 'confirmed')],
		[
			{ questionId: 'Q2', id: 'c1' },
			{ questionId: null, id: 'c2' }
		]
	);

	const [q1, q2] = records;
	const candidates = [candidate('c1'), candidate('c2')];

	expect(q1.answers[0]).toMatchObject({ result: 'unresolved', candidateIds: [] });
	expect(q1.answers[0].reason).toStartWith('Confirmed, but no finding in the reply names Q1');
	expect(questionStatus(q1, candidates).result).toBe('unresolved');
	expect(questionStatus(q2, candidates).result).toBe('confirmed');
});

test('a valid answer closes only its own question', () => {
	const [q1, q2] = afterAnswer([answer('Q1', 'confirmed')], [{ questionId: 'Q1', id: 'c1' }]);

	expect(q1.answers[0]).toMatchObject({ owner: 'unit-1/correctness', result: 'confirmed', candidateIds: ['c1'] });
	expect(questionStatus(q1, [candidate('c1')]).result).toBe('confirmed');

	expect(q2).toMatchObject({ owners: ['unit-1/correctness'], answers: [] });
	expect(questionStatus(q2, [candidate('c1')])).toEqual({ result: 'unresolved', reason: 'No reviewer answered it.' });
});

test('a not-applicable answer leaves the question open for another reviewer', () => {
	const security = reply('unit-1/security', [Q1], { answered: [answer('Q1', 'not-applicable', { note: '' })] });
	const outside = reply('unit-2/correctness', [], { brief: [Q1], answered: [answer('Q1', 'confirmed')] });

	const [open] = recorded(security, outside);

	expect(open.answers.map(({ owner, result }) => [owner, result])).toEqual([
		['unit-1/security', 'not-applicable'],
		['unit-2/correctness', 'not-applicable']
	]);

	expect(open.owners).toEqual(['unit-1/security']);

	expect(questionStatus(open, [])).toEqual({
		result: 'unresolved',
		reason: 'Every answer came from a reviewer it was outside the scope of.'
	});

	const correctness = reply('unit-1/correctness', [Q1], {
		answered: [answer('Q1', 'disproved', { note: 'Guarded.', contractEvidence: TRACE })]
	});

	const [settled] = recorded(security, outside, correctness);

	expect(questionStatus(settled, []).result).toBe('disproved');
});

test('the sole supporting candidate failing verification reopens the question', () => {
	const [record] = afterAnswer([answer('Q1', 'confirmed')], [{ questionId: 'Q1', id: 'c1' }]);
	const verified = { status: 'verified', method: 'trace', reason: 'checked' } as const;

	expect(questionStatus(record, [candidate('c1', { verification: verified })]).result).toBe('confirmed');

	const fallen = [
		candidate('c1', { verification: { status: 'unverified', reason: 'Not run.' } }),
		candidate('c1', { valid: false, refuted: true, dropReason: 'It is guarded.' })
	];

	for (const entry of fallen) {
		expect(questionStatus(record, [entry])).toEqual({
			result: 'unresolved',
			reason: 'Reopened: the finding that confirmed it (c1) failed validation or verification.'
		});
	}

	expect(questionStatus(record, [candidate('c1')], [candidate('c1')]).result).toBe('unresolved');
});

test('a confirmation still stands while another finding that names the question does', () => {
	const first = reply('unit-1/correctness', [Q1], { findings: [{ questionId: 'Q1', candidate: candidate('c1') }] });
	const second = reply('subagent-1', [Q1], { findings: [{ questionId: 'Q1', candidate: candidate('c2') }] });
	const [record] = recorded(first, second);

	expect(questionStatus(record, [candidate('c1', { valid: false }), candidate('c2')]).result).toBe('confirmed');
});

test('a reviewer that replies again replaces its answer, and its unsettled mark on a question it was not shown is dropped', () => {
	const first = reply('unit-1/correctness', [Q1], { brief: [Q1, Q2], unsettled: ['Q1', 'Q2', 'Q9'] });
	const again = reply('unit-1/correctness', [Q1], { brief: [Q1, Q2], unsettled: ['Q1'] });

	const records = recorded(first, again);

	expect(records.map(({ id, owners, answers }) => [id, owners, answers.map(({ result }) => result)])).toEqual([
		['Q1', ['unit-1/correctness'], ['unresolved']]
	]);

	expect(questionStatus(records[0], [])).toEqual({ result: 'unresolved', reason: 'Left unresolved by 1 reviewer.' });
});

test('saved questions restore as a copy, and a checkpoint without them restores none', () => {
	const saved = afterAnswer([answer('Q1', 'disproved', { note: 'Guarded.', contractEvidence: TRACE })]);
	const restored = restoreQuestions(saved);

	expect(restored).toEqual(saved);
	expect(restored[0]).not.toBe(saved[0]);
	expect(restoreQuestions(undefined)).toEqual([]);
});
