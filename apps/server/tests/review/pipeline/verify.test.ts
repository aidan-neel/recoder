import { expect, test } from 'bun:test';
import { EvidenceStore, type EvidenceRecord } from '../../../src/evidence/evidence';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { parseVerdict, settleVerdict } from '../../../src/review/pipeline/verify';

/** A run record as the store keeps it. */
function run(id: string, command: string, output: string, exitCode: number, agentId?: string): EvidenceRecord {
	return {
		id,
		revision: 'head',
		path: '',
		startLine: 1,
		endLine: 1,
		content: `$ ${command}\n${output}\n[exit ${exitCode} · 0.1s]`,
		truncated: false,
		kind: 'run',
		command,
		exitCode,
		...(agentId ? { agentId } : {})
	};
}

/** The verifier `v`'s failing and passing runs, a read, a baseline check and another agent's run. */
function store(): EvidenceStore {
	const evidence = new EvidenceStore(null, buildInventory(''), 1000);

	const records: EvidenceRecord[] = [
		run('ev_1', 'bun test', '1 fail', 1, 'v'),
		{ id: 'ev_2', revision: 'head', path: 'src/a.ts', startLine: 1, endLine: 10, content: '1|x', truncated: false },
		run('ev_3', 'bun repro.ts', 'refill() returned NaN', 0, 'v'),
		run('ev_4', 'bun test', '12 pass', 0),
		run('ev_5', 'bun test src/a.test.ts', '3 pass', 0, 'other')
	];

	for (const record of records) evidence.records.set(record.id, record);

	return evidence;
}

test('verifier answers with verdict synonyms and alternate field names are repaired', () => {
	expect(parseVerdict({ status: 'Reproduced', explanation: 'The repro fails.', evidenceIds: 'ev_1' })).toEqual({
		verdict: 'confirmed',
		reason: 'The repro fails.',
		evidenceIds: ['ev_1']
	});

	expect(parseVerdict({ verdict: 'false positive', reason: 'Passes.' })?.verdict).toBe('refuted');
	expect(parseVerdict({ verdict: 'maybe', reason: 'x' })).toBeNull();
});

test('a confirmed verdict is proven by a failing run, traced by cited reads, and unverified with nothing cited', () => {
	const evidence = store();

	expect(
		settleVerdict({ verdict: 'confirmed', reason: 'The test fails.', evidenceIds: ['ev_2', 'ev_1'] }, evidence, 'v')
	).toEqual({
		status: 'verified',
		method: 'run',
		reason: 'The test fails.',
		command: 'bun test',
		exitCode: 1
	});

	expect(
		settleVerdict({ verdict: 'confirmed', reason: 'Read the code.', evidenceIds: ['ev_2'] }, evidence, 'v')
	).toEqual({ status: 'verified', method: 'trace', reason: 'Read the code.' });

	expect(settleVerdict({ verdict: 'confirmed', reason: 'Trust me.', evidenceIds: [] }, evidence, 'v')).toMatchObject({
		status: 'unverified'
	});
});

test('a passing run confirms a finding only when its output holds what the verifier quoted', () => {
	const evidence = store();

	const confirm = (reason: string) =>
		settleVerdict({ verdict: 'confirmed', reason, evidenceIds: ['ev_3'] }, evidence, 'v');

	expect(confirm('It prints `returned NaN` for an empty bucket.')).toMatchObject({ status: 'verified', method: 'run' });
	expect(confirm('`bun repro.ts` shows the bug.')).toMatchObject({ status: 'unverified' });
	expect(confirm('The repro shows the bug.')).toMatchObject({ status: 'unverified' });
});

test("a refutation drops a finding only on a passing run of the verifier's own", () => {
	const evidence = store();

	const refute = (...evidenceIds: string[]) =>
		settleVerdict({ verdict: 'refuted', reason: 'It works.', evidenceIds }, evidence, 'v');

	expect(refute('ev_3')).toBe('refuted');
	expect(refute('ev_4')).toMatchObject({ status: 'unverified' });
	expect(refute('ev_5')).toMatchObject({ status: 'unverified' });
	expect(refute('ev_1')).toMatchObject({ status: 'unverified' });
	expect(refute('ev_2')).toMatchObject({ status: 'unverified' });
	expect(refute()).toMatchObject({ status: 'unverified' });
});
