import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityLine, readReport, type BenchmarkReport, type JudgeModel } from '../../src/eval/benchmark-report';
import {
	checkReuse,
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
