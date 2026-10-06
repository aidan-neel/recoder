import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkSummary, runAgreement } from '../../src/eval/benchmark-merge';
import type { BenchmarkReport, PrResult, ScoredRun } from '../../src/eval/benchmark-report';
import { runIdOf, withHash, type RunIdentity } from '../../src/eval/identity';
import type { EvalFinding } from '../../src/eval/metrics';
import { splitTasks } from '../../src/eval/shard';
import { defect, score } from './benchmark';
import { identityFields, recordedIdentity } from './identity';

/** Five PRs over three codebases, in id order with numbers as numbers, as the benchmark lists a dataset's labels. */
const TASKS = [
	{ id: 'hono-2', codebase: 'hono' },
	{ id: 'hono-10', codebase: 'hono' },
	{ id: 'ky-1', codebase: 'ky' },
	{ id: 'ky-3', codebase: 'ky' },
	{ id: 'zod-1', codebase: 'zod' }
];

const finding = (fingerprint: string): EvalFinding =>
	({
		fingerprint,
		message: fingerprint,
		file: 'src/a.ts',
		line: 10,
		category: 'correctness',
		severity: 'error',
		title: fingerprint
	}) as EvalFinding;

/** Run `index` of a PR: found its defect on odd runs, so repeats disagree. */
function run(taskId: string, index: number, identity: string): ScoredRun {
	return {
		index,
		reviewId: `${taskId}-review-${index}`,
		outcome: 'passed',
		headSha: taskId.split('@')[1]!,
		durationMs: 60_000 * index,
		summary: null,
		findings: index % 2 ? [finding('f1'), finding(`extra-${index}`)] : [finding('f1')],
		hidden: 0,
		candidates: 2,
		runId: runIdOf(taskId, index),
		identity,
		score: score(index % 2 ? { d1: 0 } : {}),
		stages: { d1: { found: true, verified: true, published: index % 2 === 1 } }
	} as ScoredRun;
}

/** An unsplit report of every fixture PR with `runs` runs each, made as the benchmark makes one. */
export function unsplitReport(runs = 2): BenchmarkReport {
	const fields = identityFields();

	fields.tasks = TASKS.map((task) => ({ taskId: `${task.id}@${task.id}-head`, base: 'base-1' }));
	fields.execution = { ...fields.execution, runsPerPr: runs };

	const identity = recordedIdentity(fields, TASKS.length * runs);

	const prs: PrResult[] = TASKS.map((task) => {
		const taskId = `${task.id}@${task.id}-head`;
		const records = Array.from({ length: runs }, (_, index) => run(taskId, index + 1, identity.hash));

		return {
			id: task.id,
			taskId,
			baseSha: 'base-1',
			codebase: task.codebase,
			pull: 1,
			verified: true,
			control: false,
			defects: [defect],
			staleHead: false,
			agreement: runAgreement(records),
			runs: records
		};
	});

	return {
		dataset: 'synth',
		base: 'http://localhost:3001',
		runsPerPr: runs,
		judge: { model: 'judge-x', provider: 'opencode', effort: 'medium' },
		reportId: 'unsplit',
		identity,
		runIds: prs.flatMap((pr) => pr.runs.map((entry) => entry.runId!)),
		startedAt: '2026-10-06T00:00:00.000Z',
		finishedAt: '2026-10-06T02:00:00.000Z',
		prs,
		summary: benchmarkSummary(prs, 'full')
	};
}

/** A report of only `prs`, with its identity and runs narrowed to them, as a host running part of the set writes it. */
function narrowed(report: BenchmarkReport, prs: PrResult[], identity: RunIdentity, name: string): BenchmarkReport {
	const runIds = prs.flatMap((pr) => pr.runs.map((entry) => entry.runId!));

	return {
		...report,
		reportId: name,
		identity: {
			...identity,
			tasks: identity.tasks.filter((task) => prs.some((pr) => pr.taskId === task.taskId)),
			runs: { [identity.hash]: runIds.length }
		},
		runIds,
		prs,
		summary: benchmarkSummary(prs, identity.taskSet)
	};
}

/** Shard `index` of `count` of the report, as `--shard index/count` on another host would have written it. */
export function shardOf(
	report: BenchmarkReport,
	index: number,
	count: number,
	host = `host-${index}`
): BenchmarkReport {
	const identity = report.identity!;
	const prs = splitTasks(report.prs, count)[index - 1]!;

	const shard = {
		index,
		count,
		tasks: prs.map((pr) => pr.taskId!),
		all: report.prs.map((pr) => pr.taskId!)
	};

	return narrowed(
		report,
		prs,
		{
			...identity,
			shard,
			host: { ...identity.host, name: host },
			execution: { ...identity.execution, mode: 'partial' }
		},
		`shard-${index}`
	);
}

/** Repeat `repeat` of the report as a one-run benchmark with `--repeat` wrote it: run `repeat` of each PR alone. */
export function repeatOf(report: BenchmarkReport, repeat: number): BenchmarkReport {
	const identity = report.identity!;

	const prs = report.prs.map((pr) => {
		const runs = pr.runs.filter((entry) => entry.index === repeat);

		return { ...pr, agreement: runAgreement(runs), runs };
	});

	return {
		...narrowed(
			report,
			prs,
			{ ...identity, execution: { ...identity.execution, runsPerPr: 1, repeat } },
			`repeat-${repeat}`
		),
		runsPerPr: 1
	};
}

/** Writes each report as `<name>.json` in `dir` and returns their paths. */
export function writeReports(dir: string, reports: Record<string, BenchmarkReport>): string[] {
	return Object.entries(reports).map(([name, report]) => {
		const path = join(dir, `${name}.json`);

		writeFileSync(path, JSON.stringify(report));

		return path;
	});
}

/** The report with one identity field changed and its hash and run stamps recomputed, as a run under that change records it. */
export function changedIdentity(report: BenchmarkReport, change: (identity: RunIdentity) => void): BenchmarkReport {
	const { version: _version, hash: _hash, ...fields } = structuredClone(report.identity!);

	change(fields as RunIdentity);

	const identity = withHash(fields);
	const runs = report.prs.flatMap((pr) => pr.runs);

	return {
		...report,
		identity: { ...identity, runs: { [identity.hash]: runs.length } },
		prs: report.prs.map((pr) => ({ ...pr, runs: pr.runs.map((run) => ({ ...run, identity: identity.hash })) }))
	};
}
