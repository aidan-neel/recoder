import { expect, test } from 'bun:test';
import { EvidenceStore, type EvidenceRecord } from '../../../src/evidence/evidence';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';
import type { ChangeIntent } from '../../../src/review/pipeline/intent/types';
import { settleQualityVerdict } from '../../../src/review/pipeline/quality-verify';
import {
	coveredByIntent,
	parseVerdict,
	settleVerdict,
	verifierPushBack,
	withOutcome
} from '../../../src/review/pipeline/verify';

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

test('a verdict without an expected sentence still parses, and a blank one is dropped', () => {
	expect(parseVerdict({ verdict: 'confirmed', reason: 'The test fails.', evidenceIds: ['ev_1'] })).toEqual({
		verdict: 'confirmed',
		reason: 'The test fails.',
		evidenceIds: ['ev_1']
	});

	expect(parseVerdict({ verdict: 'confirmed', reason: 'Fails.', expected: '  ' })).not.toHaveProperty('expected');
	expect(parseVerdict({ verdict: 'confirmed', reason: 'Fails.', expected: ' It fails. ' })?.expected).toBe('It fails.');
});

test('a confirmed verdict is proven by a failing run, traced by cited reads, and unverified with nothing cited', () => {
	const evidence = store();

	expect(
		settleVerdict({ verdict: 'confirmed', reason: 'The test fails.', evidenceIds: ['ev_2', 'ev_1'] }, evidence, 'v')
	).toMatchObject({
		status: 'verified',
		method: 'run',
		reason: 'The test fails.',
		command: 'bun test',
		exitCode: 1
	});

	expect(
		settleVerdict({ verdict: 'confirmed', reason: 'Read the code.', evidenceIds: ['ev_2'] }, evidence, 'v')
	).toEqual({ status: 'verified', method: 'trace', outcome: 'traced', reason: 'Read the code.' });

	expect(settleVerdict({ verdict: 'confirmed', reason: 'Trust me.', evidenceIds: [] }, evidence, 'v')).toMatchObject({
		status: 'unverified'
	});
});

test('a confirmation citing its own passing run is kept however the reason is worded', () => {
	const evidence = store();

	const confirm = (reason: string, ...evidenceIds: string[]) =>
		settleVerdict({ verdict: 'confirmed', reason, evidenceIds }, evidence, 'v');

	expect(confirm('The repro printed NaN for an empty bucket.', 'ev_3')).toMatchObject({
		status: 'verified',
		method: 'run',
		reason: 'The repro printed NaN for an empty bucket.',
		command: 'bun repro.ts',
		exitCode: 0
	});

	expect(confirm('It prints `returned NaN`.', 'ev_3', 'ev_1')).toMatchObject({ command: 'bun repro.ts' });
});

test('a run-proved finding is reproduced and records the output the harness read from the run', () => {
	const evidence = store();

	const settled = settleVerdict(
		{
			verdict: 'confirmed',
			reason: 'It prints `returned NaN`; the model also claims `made-up line`.',
			evidenceIds: ['ev_3'],
			expected: 'The repro prints NaN for an empty bucket.'
		},
		evidence,
		'v'
	);

	expect(settled).toMatchObject({ status: 'verified', method: 'run', outcome: 'reproduced' });

	expect(settled).toMatchObject({
		evidence: {
			command: 'bun repro.ts',
			exitCode: 0,
			expected: 'The repro prints NaN for an empty bucket.',
			observed: 'refill() returned NaN',
			evidenceId: 'ev_3'
		}
	});
});

test('a verdict that quotes output no run printed is traced, not reproduced', () => {
	const evidence = store();

	const settled = settleVerdict(
		{ verdict: 'confirmed', reason: 'It prints `Error: bucket is empty`.', evidenceIds: ['ev_3'] },
		evidence,
		'v'
	);

	expect(settled).toEqual({
		status: 'verified',
		method: 'trace',
		outcome: 'traced',
		reason: 'It prints `Error: bucket is empty`.'
	});
});

test('a failing run stays reproduced when the reason quotes a location instead of its output', () => {
	const evidence = store();

	const settled = settleVerdict(
		{ verdict: 'confirmed', reason: 'The test fails at `src/limiter.ts:42`.', evidenceIds: ['ev_1'] },
		evidence,
		'v'
	);

	expect(settled).toMatchObject({ method: 'run', outcome: 'reproduced', exitCode: 1 });
});

test('a finding nothing proved is inconclusive and a refutation is dropped', () => {
	const evidence = store();

	expect(settleVerdict({ verdict: 'unverified', reason: 'No.', evidenceIds: [] }, evidence, 'v')).toMatchObject({
		status: 'unverified',
		outcome: 'inconclusive'
	});

	expect(
		settleVerdict({ verdict: 'refuted', reason: 'It works.', evidenceIds: ['ev_1'] }, evidence, 'v')
	).toMatchObject({ status: 'unverified', outcome: 'inconclusive' });
});

test('an outcome is filled in for verifications saved without one', () => {
	expect(withOutcome({ status: 'verified', method: 'run', reason: 'x' }).outcome).toBe('reproduced');
	expect(withOutcome({ status: 'verified', method: 'detector', reason: 'x' }).outcome).toBe('traced');
	expect(withOutcome({ status: 'unverified', reason: 'x' }).outcome).toBe('inconclusive');
	expect(withOutcome({ status: 'unverified', reason: 'x', outcome: 'refuted' }).outcome).toBe('refuted');
});

test('a verifier is sent back until it ran something and its confirming run shows the defect', () => {
	const evidence = store();

	const pushBack = (verdict: 'confirmed' | 'refuted', reason: string, evidenceIds: string[], runs = 1) =>
		verifierPushBack({ verdict, reason, evidenceIds }, { runs }, evidence, 'v');

	expect(pushBack('confirmed', 'Obvious.', [], 0)).toContain('not run anything');
	expect(pushBack('confirmed', '`bun repro.ts` shows the bug.', ['ev_3'])).toContain('assertion');
	expect(pushBack('confirmed', 'Read the code.', ['ev_2'])).toContain('assertion');
	expect(pushBack('confirmed', 'It prints `returned NaN`.', ['ev_3'])).toBeNull();
	expect(pushBack('confirmed', 'The test fails.', ['ev_1'])).toBeNull();
	expect(pushBack('refuted', 'It works.', ['ev_3'])).toBeNull();
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

test('a weak-test finding is refuted only by a planted bug that made the test fail', () => {
	const evidence = store();

	const settle = (verdict: 'confirmed' | 'refuted', ...evidenceIds: string[]) =>
		settleVerdict({ verdict, reason: 'Planted the bug.', evidenceIds }, evidence, 'v', true);

	const pushBack = (verdict: 'confirmed' | 'refuted', ...evidenceIds: string[]) =>
		verifierPushBack({ verdict, reason: 'Planted the bug.', evidenceIds }, { runs: 1 }, evidence, 'v', true);

	expect(settle('refuted', 'ev_1')).toBe('refuted');
	expect(settle('refuted', 'ev_3')).toMatchObject({ status: 'unverified' });
	expect(settle('confirmed', 'ev_3')).toMatchObject({ status: 'verified', method: 'run', exitCode: 0 });
	expect(pushBack('confirmed', 'ev_3')).toBeNull();
	expect(pushBack('refuted', 'ev_1')).toBeNull();
	expect(pushBack('refuted', 'ev_3')).not.toBeNull();
});

test('a refutation is covered only by a real non-goal or a stacked pull request', () => {
	const pr = { title: 'Parent', state: 'open', headRef: 'a', baseRef: 'main' };

	const intent: ChangeIntent = {
		summary: '',
		goals: [],
		acceptanceCriteria: [],
		statedConstraints: [],
		nonGoals: [{ id: 'N1', text: 'Retries come later.', source: 'pr' }],
		priorDecisions: [],
		observedChanges: [],
		openQuestions: [],
		stack: { parent: { number: 41, ...pr }, children: [] }
	};

	const refuted = (coveredBy: string) => ({ verdict: 'refuted' as const, reason: 'r', evidenceIds: [], coveredBy });

	expect(coveredByIntent(refuted('N1'), intent)).toBe(true);
	expect(coveredByIntent(refuted('#41'), intent)).toBe(true);
	expect(coveredByIntent(refuted('N7'), intent)).toBe(false);
	expect(coveredByIntent(refuted('#99'), intent)).toBe(false);
	expect(coveredByIntent(refuted('N1'), null)).toBe(false);
	expect(coveredByIntent({ ...refuted('N1'), verdict: 'confirmed' }, intent)).toBe(false);
});

test('a quality confirmation counts only with the proof its category needs', () => {
	const evidence = store();

	const search: EvidenceRecord = {
		id: 'ev_6',
		revision: 'head',
		path: '',
		startLine: 1,
		endLine: 1,
		content: 'abc1234:src/b.ts:3:const x = load();',
		truncated: false
	};

	evidence.records.set(search.id, search);

	const quality = (category: string) => ({ category, file: 'src/a.ts', line: 2 }) as CandidateFinding;
	const confirmed = (evidenceIds: string[]) => ({ verdict: 'confirmed' as const, reason: 'r', evidenceIds });

	expect(settleQualityVerdict(quality('readability'), confirmed(['ev_2']), evidence)).toMatchObject({
		status: 'verified',
		method: 'trace'
	});

	expect(settleQualityVerdict(quality('readability'), confirmed(['ev_6']), evidence)).toMatchObject({
		status: 'unverified'
	});

	expect(settleQualityVerdict(quality('convention'), confirmed(['ev_6']), evidence)).toMatchObject({
		status: 'verified',
		method: 'convention'
	});

	expect(settleQualityVerdict(quality('convention'), confirmed(['ev_2']), evidence)).toMatchObject({
		status: 'unverified'
	});

	expect(settleQualityVerdict(quality('convention'), { ...confirmed([]), verdict: 'refuted' }, evidence)).toMatchObject(
		{ status: 'unverified' }
	);
});

test('a run that broke before reaching the code settles nothing either way', () => {
	const evidence = store();
	const missing = "error: Cannot find module './limiter' from 'repro.ts'";

	evidence.records.set('ev_6', run('ev_6', 'bun repro.ts', missing, 1, 'v'));
	evidence.records.set('ev_7', run('ev_7', 'bun test src/a.test.ts', missing, 1, 'v'));
	evidence.records.set('ev_8', run('ev_8', 'bun repro.ts', 'SyntaxError: Unexpected end of JSON input', 1, 'v'));

	const verdict = (kind: 'confirmed' | 'refuted', ...evidenceIds: string[]) => ({
		verdict: kind,
		reason: 'The run fails.',
		evidenceIds
	});

	expect(settleVerdict(verdict('confirmed', 'ev_6'), evidence, 'v')).toMatchObject({ status: 'unverified' });
	expect(settleVerdict(verdict('confirmed', 'ev_6', 'ev_1'), evidence, 'v')).toMatchObject({ command: 'bun test' });
	expect(settleVerdict(verdict('confirmed', 'ev_8'), evidence, 'v')).toMatchObject({ status: 'verified' });
	expect(settleVerdict(verdict('refuted', 'ev_7'), evidence, 'v', true)).toMatchObject({ status: 'unverified' });
	expect(settleVerdict(verdict('refuted', 'ev_8'), evidence, 'v', true)).toMatchObject({ status: 'unverified' });
	expect(verifierPushBack(verdict('confirmed', 'ev_6'), { runs: 1 }, evidence, 'v')).toContain('before it reached');
	expect(verifierPushBack(verdict('refuted', 'ev_7'), { runs: 1 }, evidence, 'v', true)).toContain('still compiles');
});

test('a run recorded as never reaching its assertion proves nothing, even when its output is quoted', () => {
	const evidence = store();
	const untransformed = 'ReferenceError: $state is not defined';
	const reason = 'The toast queue breaks: `$state is not defined`.';

	evidence.records.set('ev_6', {
		...run('ev_6', 'bun test src/toast.test.ts', untransformed, 1, 'v'),
		outcome: 'unsupported-execution'
	});

	evidence.records.set('ev_7', run('ev_7', 'bun test src/toast.test.ts', untransformed, 1, 'v'));

	evidence.records.set('ev_8', {
		...run('ev_8', 'bunx vitest run a.test.ts', 'Error: boom', 1, 'v'),
		outcome: 'setup-failed'
	});

	const verdict = (kind: 'confirmed' | 'refuted', id: string) => ({ verdict: kind, reason, evidenceIds: [id] });

	expect(settleVerdict(verdict('confirmed', 'ev_6'), evidence, 'v')).toMatchObject({
		status: 'unverified',
		outcome: 'inconclusive'
	});

	expect(settleVerdict(verdict('confirmed', 'ev_8'), evidence, 'v')).toMatchObject({ status: 'unverified' });
	expect(settleVerdict(verdict('refuted', 'ev_6'), evidence, 'v')).not.toBe('refuted');
	expect(settleVerdict(verdict('refuted', 'ev_8'), evidence, 'v', true)).not.toBe('refuted');
	expect(verifierPushBack(verdict('confirmed', 'ev_6'), { runs: 1 }, evidence, 'v')).toContain('before it reached');
	expect(settleVerdict(verdict('confirmed', 'ev_7'), evidence, 'v')).toMatchObject({ outcome: 'reproduced' });
});
