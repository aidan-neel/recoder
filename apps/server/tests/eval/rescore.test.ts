import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReasoningEffort } from '@recoder/shared';
import { JUDGE_VERSION } from '../../src/eval/benchmark-judge';
import { printBenchmark, type BenchmarkReport, type Derivation } from '../../src/eval/benchmark-report';
import type { Judge } from '../../src/eval/benchmark-scoring';
import type { EvalFinding } from '../../src/eval/metrics';
import { judgeChoice, rescoreFile } from '../../src/eval/rescore';
import { defect } from '../helpers/benchmark';
import { identityFields, recordedIdentity } from '../helpers/identity';

const originalFetch = globalThis.fetch;
const root = mkdtempSync(join(tmpdir(), 'recoder-rescore-'));
const dataset = join(root, 'synth');
const adjudications = join(dataset, 'adjudications.json');
const requests: string[] = [];

mkdirSync(join(dataset, 'labels'), { recursive: true });
writeFileSync(adjudications, '{}\n');

for (const pull of [1, 2, 3]) {
	const label = { id: `pr-${pull}`, codebase: 'hono', repo: 'file:///hono', pull, headSha: 'aaa', verified: true };

	writeFileSync(join(dataset, 'labels', `pr-${pull}.json`), JSON.stringify({ ...label, defects: [defect] }));
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Every request is recorded and refused, so a test can show the rescore made none. */
function refuseRequests(): void {
	requests.length = 0;

	globalThis.fetch = (async (input: Request | string | URL) => {
		requests.push(String(input));

		throw new Error('a rescore asks no server');
	}) as unknown as typeof fetch;
}

/** A judge that matches the planted defect to the first finding of whatever it is shown, and counts what it was asked. */
function fakeJudge() {
	const seen = { built: [] as [string, ReasoningEffort | undefined][], calls: 0 };
	const model = `judge-${crypto.randomUUID()}`;

	const factory = (choice: string, effort: ReasoningEffort | undefined): Judge => {
		seen.built.push([choice, effort]);

		return {
			chat: async () => {
				seen.calls++;

				return JSON.stringify({
					matches: [{ defect: defect.id, finding: 0, sameBehavior: true, sameCause: true, reason: 'same' }]
				});
			},
			model: { model, provider: 'test', effort: effort ?? null }
		};
	};

	return { seen, model, factory };
}

const claim = (pull: number): EvalFinding => ({
	file: 'src/a.ts',
	line: 10,
	message: `rescore-${pull}-${crypto.randomUUID()}`,
	severity: 'warning'
});

const outcome = { stage: null, reason: null, verified: true };

/** A passed run that published `finding`, with what it saved of its candidates. */
function passed(finding: EvalFinding, saved: object) {
	return {
		index: 1,
		reviewId: `review-${crypto.randomUUID()}`,
		outcome: 'passed',
		headSha: 'aaa',
		durationMs: 1,
		summary: null,
		findings: [finding],
		hidden: null,
		candidates: 1,
		score: null,
		...saved
	};
}

/**
 * Writes a saved benchmark report of three PRs: one whose pool records ids
 * and a candidate published below the bar, one from an older tree whose pool
 * records none, and one that saved no pool.
 */
function writeSaved(name: string, extra: object = {}): string {
	const [a, b, c] = [claim(1), claim(2), claim(3)];

	const runs = [
		passed(a, { findingIds: ['c1'], pool: [{ ...a, ...outcome, id: 'c1', publishedBy: 'reproduced' }] }),
		passed(b, { findingIds: ['c2'], pool: [{ ...b, ...outcome }] }),
		passed(c, {})
	];

	const report = {
		dataset: 'synth',
		base: 'http://localhost:3001',
		runsPerPr: 1,
		judge: { model: 'openai/gpt-x', provider: 'opencode', effort: 'medium' },
		startedAt: '2026-10-06T00:00:00.000Z',
		finishedAt: '2026-10-06T00:10:00.000Z',
		prs: runs.map((run, index) => ({
			id: `pr-${index + 1}`,
			codebase: 'hono',
			pull: index + 1,
			verified: true,
			control: false,
			staleHead: false,
			agreement: null,
			defects: [defect],
			runs: [run]
		})),
		summary: { overall: { planted: 0, found: 0 } },
		...extra
	};

	const path = join(root, name);

	writeFileSync(path, JSON.stringify(report));

	return path;
}

/** The lines `printBenchmark` gives a rescored report about where it came from. */
function printed(report: BenchmarkReport): string[] {
	const log = spyOn(console, 'log').mockImplementation(() => undefined);

	printBenchmark(report);

	const lines = String(log.mock.calls[0]?.[0]).split('\n');

	log.mockRestore();

	const start = lines.findIndex((line) => line.startsWith('Rescored from'));

	return lines.slice(start, start + 1 + lines.slice(start + 1).findIndex((line) => !line.startsWith('  ')));
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('a rescore with a fake judge reproduces the totals of the report it rescores, marks it rescored and leaves the input alone', async () => {
	refuseRequests();

	const saved = writeSaved('saved.json');
	const before = sha256(saved);
	const first = fakeJudge();
	const once = await rescoreFile(saved, join(root, 'once.json'), { dataset }, first.factory);

	expect(first.seen.built).toEqual([['opencode:openai/gpt-x', 'medium']]);
	expect(first.seen.calls).toBeGreaterThan(0);
	expect(once.report.summary.overall).toEqual({ planted: 3, found: 3 });
	expect(once.report.summary.lows?.reproduced).toEqual({ published: 1, matched: 1, duplicates: 0, unlabeled: 0 });

	expect(once.report.rescoredFrom).toEqual({
		path: saved,
		sha256: before,
		judge: { model: 'openai/gpt-x', provider: 'opencode', effort: 'medium', version: 'not recorded' },
		rescoredBy: { model: first.model, provider: 'test', effort: 'medium', version: JUDGE_VERSION },
		withoutPool: 1,
		withoutIds: 1
	});

	expect(once.notes).toEqual([]);

	expect(printed(once.report)).toEqual([
		`Rescored from ${saved} (sha256 ${before.slice(0, 12)}), judged there by openai/gpt-x version not recorded, here by ${first.model} v${JUDGE_VERSION}`,
		'  1 passed runs saved no candidate pool: no stages, no below-the-bar tallies',
		'  1 passed runs record no candidate ids: their below-the-bar tallies are left out'
	]);

	const again = fakeJudge();

	const twice = await rescoreFile(
		join(root, 'once.json'),
		join(root, 'twice.json'),
		{ judge: 'fake', dataset },
		again.factory
	);

	expect(twice.report.summary).toEqual(once.report.summary);

	expect(twice.report.rescoredFrom).toMatchObject({
		path: join(root, 'once.json'),
		sha256: sha256(join(root, 'once.json'))
	});

	expect(twice.report.rescoredFrom?.judge).toEqual({ ...once.report.judge, version: JUDGE_VERSION });

	expect(printed(twice.report)[0]).toBe(
		`Rescored from ${join(root, 'once.json')} (sha256 ${sha256(join(root, 'once.json')).slice(0, 12)}), judged there by ${first.model} v${JUDGE_VERSION}, here by ${again.model} v${JUDGE_VERSION}`
	);

	expect((twice.report.derivedFrom as Derivation[]).map((derivation) => derivation.report)).toEqual([
		'saved.json',
		'once.json'
	]);

	expect(JSON.parse(readFileSync(join(root, 'twice.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(twice.report)));
	expect(sha256(saved)).toBe(before);
	expect(readFileSync(adjudications, 'utf8')).toBe('{}\n');
	expect(requests).toEqual([]);
});

test('a rescore refuses an output that exists, its input included, before building a judge', async () => {
	const saved = writeSaved('kept.json');
	const taken = join(root, 'taken.json');
	const judge = fakeJudge();

	writeFileSync(taken, 'earlier report\n');

	await expect(rescoreFile(saved, taken, { dataset }, judge.factory)).rejects.toThrow('never overwrites a report');
	await expect(rescoreFile(saved, saved, { dataset }, judge.factory)).rejects.toThrow('never overwrites its input');

	expect(judge.seen.built).toEqual([]);
	expect(readFileSync(taken, 'utf8')).toBe('earlier report\n');

	const cli = Bun.spawnSync(['bun', 'src/eval/rescore.ts', saved, taken], { cwd: join(import.meta.dir, '../..') });

	expect(cli.exitCode).toBe(1);
	expect(cli.stderr.toString()).toContain('never overwrites a report');
	expect(readFileSync(taken, 'utf8')).toBe('earlier report\n');
});

test('a rescore records the new judge and labels in the identity, keeping the identity each run was reviewed under', async () => {
	refuseRequests();

	const identity = recordedIdentity(identityFields(), 3);
	const saved = writeSaved('identity.json', { identity, reportId: 'report-1' });
	const judge = fakeJudge();
	const { report } = await rescoreFile(saved, join(root, 'identity-out.json'), { dataset }, judge.factory);

	expect(report.reportId).toBe('report-1');
	expect(report.identity?.hash).not.toBe(identity.hash);

	expect(report.identity?.judge).toEqual({
		model: judge.model,
		provider: 'test',
		effort: 'medium',
		version: JUDGE_VERSION,
		seed: 7
	});

	expect(report.identity?.caches['benchmark-judge']).toBe(`v${JUDGE_VERSION}`);
	expect(report.identity?.execution).toMatchObject({ mode: 'rescore', auto: false });
	expect(report.identity?.dataset.labels).not.toBe(identity.dataset.labels);
	expect(report.identity?.runs).toEqual({ 'not recorded': 3 });
	expect(report.rescoredFrom?.judge.version).toBe(identity.judge.version);
	expect((report.derivedFrom as Derivation[])[0]).toMatchObject({ operation: 'rescore', identity: identity.hash });
	expect(report.runIds).toEqual(['pr-1@aaa#1', 'pr-2@aaa#1', 'pr-3@aaa#1']);
});

test("a rescore says when it drops the input's below-the-bar section and when labels changed since the input", async () => {
	const saved = writeSaved('older.json');
	const report = JSON.parse(readFileSync(saved, 'utf8')) as BenchmarkReport;
	const [first, second, third] = report.prs;
	const { id: _id, ...anonymous } = first!.runs[0]!.pool![0]!;

	const older = {
		...report,
		prs: [
			{ ...first, runs: [{ ...first!.runs[0], pool: [anonymous] }] },
			{ ...second, defects: [{ ...defect, title: 'renamed since' }] },
			third
		],
		summary: { ...report.summary, lows: {} }
	};

	writeFileSync(saved, JSON.stringify(older));

	const { report: out, notes } = await rescoreFile(
		saved,
		join(root, 'older-out.json'),
		{ dataset },
		fakeJudge().factory
	);

	expect(out.summary.lows).toBeUndefined();
	expect(out.rescoredFrom).toMatchObject({ withoutPool: 1, withoutIds: 2 });

	expect(notes).toEqual([
		'The input had a "Published below the bar" section; without candidate ids this report drops it.',
		"1 PRs have labels that differ from the defects the input recorded (pr-2); they are scored against the dataset's labels."
	]);

	expect(printed(out).at(-1)).toBe(
		'  2 passed runs record no candidate ids: their below-the-bar tallies are left out, so the "Published below the bar" section is absent'
	);
});

test("the input's judge is named again only when its model alone names it, and a PR without labels is refused", async () => {
	expect(judgeChoice({ model: 'openai/gpt-x', provider: 'opencode', effort: 'medium' })).toBe('opencode:openai/gpt-x');
	expect(() => judgeChoice({ model: 'gpt-x', provider: 'openai-compatible', effort: null })).toThrow('pass --judge');

	const saved = writeSaved('unlabeled.json');
	const report = JSON.parse(readFileSync(saved, 'utf8')) as BenchmarkReport;

	writeFileSync(saved, JSON.stringify({ ...report, prs: [...report.prs, { ...report.prs[0], id: 'pr-9' }] }));

	await expect(rescoreFile(saved, join(root, 'unlabeled-out.json'), { dataset }, fakeJudge().factory)).rejects.toThrow(
		'has no labels for pr-9'
	);
});
