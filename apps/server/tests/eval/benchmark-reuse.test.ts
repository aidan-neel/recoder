import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityLine, readReport, type BenchmarkReport, type JudgeModel } from '../../src/eval/benchmark-report';
import {
	checkRepeat,
	checkReuse,
	executionMode,
	reportIdOf,
	resumedRecords,
	reusedRuns,
	runIdentities,
	stamped
} from '../../src/eval/benchmark-reuse';
import { checkCompatibility } from '../../src/eval/identity';
import { identityFields, recordedIdentity, writeReport } from '../helpers/identity';

const dir = mkdtempSync(join(tmpdir(), 'recoder-reuse-'));
const tasks = [{ id: 'pr-1', headSha: 'aaa' }];
const judge: JudgeModel = { model: 'judge-x', provider: 'opencode', effort: 'medium' };

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

test('a fresh start mints a report id; a reuse keeps the id of the report it reuses', () => {
	const report = { ...readReport(writeReport(dir, 'ided.json')), reportId: 'report-a' };
	const fresh = reportIdOf(null);

	expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
	expect(reportIdOf(null)).not.toBe(fresh);
	expect(reportIdOf({ path: 'ided.json', report, operation: 'replay' })).toBe('report-a');
});

test('a resume keeps each reused run its own stamp, so a report mixing old runs says so and compare refuses it', () => {
	const old = readReport(writeReport(dir, 'old.json'));
	const now = recordedIdentity();
	const resumed = reusedRuns(resumedRecords(old, tasks), tasks, 'resume', judge)[0]![0]!;

	const fresh = stamped(
		tasks[0]!,
		{ ...old.prs[0]!.runs[0]!, index: 2 },
		{ review: 'fresh', identity: now.hash, judge }
	);

	expect(resumed).toMatchObject({ runId: 'pr-1@aaa#1', identity: 'not recorded', judge: 'not recorded' });
	expect(fresh).toMatchObject({ runId: 'pr-1@aaa#2', identity: now.hash, judge });

	const mixed = { ...now, runs: runIdentities([resumed, fresh]) };
	const report: BenchmarkReport = { ...old, identity: mixed, runIds: ['pr-1@aaa#1', 'pr-1@aaa#2'] };

	expect(mixed.runs).toEqual({ 'not recorded': 1, [now.hash]: 1 });
	expect(identityLine(report)).toContain(`2 runs (mixed: 1 not recorded, 1 under ${now.hash.slice(0, 12)})`);

	const result = checkCompatibility({ name: 'A', identity: mixed }, { name: 'B', identity: now }, 'compare', []);

	expect(result.compatible).toBe(false);

	expect(result.unverifiable).toEqual([
		{ field: 'runs', a: `1 not recorded, 1 under ${now.hash.slice(0, 12)}`, b: `1 under ${now.hash.slice(0, 12)}` }
	]);

	expect(
		checkCompatibility({ name: 'A', identity: mixed }, { name: 'B', identity: now }, 'compare', ['runs']).compatible
	).toBe(true);
});

test('a resumed run keeps the judge that scored it; a rescored run takes the judge that scored it again', () => {
	const old = readReport(writeReport(dir, 'judged.json'));
	const earlier: JudgeModel = { model: 'judge-old', provider: 'opencode', effort: 'low' };
	const records = [[{ ...old.prs[0]!.runs[0]!, identity: 'hash-old', judge: earlier }]];

	expect(reusedRuns(records, tasks, 'resume', judge)[0]![0]).toMatchObject({ identity: 'hash-old', judge: earlier });
	expect(reusedRuns(records, tasks, 'rescore', judge)[0]![0]).toMatchObject({ identity: 'hash-old', judge });
});

test('a second resume appends to the chain of reports reused instead of replacing it', () => {
	const identity = recordedIdentity(identityFields());
	const first = readReport(writeReport(dir, 'first.json', { identity, runIds: ['pr-1@aaa#1'] }));
	const once = checkReuse(identity, { path: join(dir, 'first.json'), report: first, operation: 'resume' }, []);
	const second: BenchmarkReport = { ...first, derivedFrom: once };
	const twice = checkReuse(identity, { path: join(dir, 'second.json'), report: second, operation: 'resume' }, []);

	expect(twice.map((step) => step.report)).toEqual(['first.json', 'second.json']);

	const legacy: BenchmarkReport = { ...first, derivedFrom: once[0] };

	expect(
		checkReuse(identity, { path: join(dir, 'third.json'), report: legacy, operation: 'resume' }, []).map(
			(step) => step.report
		)
	).toEqual(['first.json', 'third.json']);
});

test('a resume across a code change is refused, saying any server or shared code change blocks reuse', () => {
	const before = recordedIdentity();
	const report = readReport(writeReport(dir, 'before.json', { identity: before, runIds: ['pr-1@aaa#1'] }));
	const fields = identityFields();

	fields.code.server = 'source:changed';

	expect(() =>
		checkReuse(recordedIdentity(fields), { path: join(dir, 'before.json'), report, operation: 'resume' }, [])
	).toThrow(
		'Not reusing before.json. Any change to server or shared code, their package manifests or bun.lock changes code and blocks reuse. To reuse it anyway, declare the difference: --allow-diff code.server'
	);
});

test('a misspelt --allow-diff path refuses the reuse instead of declaring nothing', () => {
	const before = recordedIdentity();
	const report = readReport(writeReport(dir, 'typo.json', { identity: before, runIds: ['pr-1@aaa#1'] }));

	expect(() =>
		checkReuse(before, { path: join(dir, 'typo.json'), report, operation: 'resume' }, ['flags.RECODER_TEST_STRENGHT'])
	).toThrow('Not reusing typo.json: --allow-diff flags.RECODER_TEST_STRENGHT names no field of either identity.');
});

test('the execution mode says how the runs were obtained, a resume included', () => {
	expect(executionMode('full', true, false)).toBe('resume');
	expect(executionMode('reverify', false, false)).toBe('reverify');
	expect(executionMode('rescore', false, true)).toBe('rescore');
	expect(executionMode('full', false, true)).toBe('partial');
	expect(executionMode('full', false, false)).toBe('full');
});

test('a resume of a report from another task set is refused until --allow-diff taskSet declares it', () => {
	const quick = recordedIdentity({ ...identityFields(), taskSet: 'quick' });
	const path = writeReport(dir, 'quick.json', { identity: quick, runIds: ['pr-1@aaa#1'] });
	const prior = { path, report: readReport(path), operation: 'resume' as const };

	expect(() => checkReuse(recordedIdentity(), prior, [])).toThrow(
		'Not reusing quick.json. To reuse it anyway, declare the difference: --allow-diff taskSet'
	);

	expect(checkReuse(recordedIdentity(), prior, ['taskSet']).at(-1)?.declared).toEqual([
		{ field: 'taskSet', a: 'quick', b: 'full' }
	]);
});

test('a resume of a --repeat run lines its runs up with this one, and a report of another repeat is refused', () => {
	const fields = identityFields();

	fields.execution = { ...fields.execution, runsPerPr: 2, repeat: 2 };

	const repeat = { ...readReport(writeReport(dir, 'repeat-2.json')), identity: recordedIdentity(fields) };

	expect(() => checkRepeat(repeat, 2, 2)).not.toThrow();
	expect(() => checkRepeat(repeat, 1, 2)).toThrow("The reused report's runs start after run 2, this run's after run 0");
	expect(() => checkRepeat(readReport(writeReport(dir, 'first.json')), 2, 1)).toThrow('start after run 0');

	repeat.prs[0]!.runs = [3, 4].map((index) => ({ ...repeat.prs[0]!.runs[0]!, index }));

	expect(resumedRecords(repeat, tasks)[0]!.flatMap((run, slot) => (run ? [slot] : []))).toEqual([2, 3]);
});
