import { summarize } from './benchmark-score';
import type { BenchmarkReport, PrResult, ScoredRun } from './benchmark-report';
import { runIdentities, runOffset } from './benchmark-reuse';
import { mergeProblems, runIdOf, type RunIdentity } from './identity';
import { stabilityMetrics } from './metrics';
import { byId } from './task-set';

/** Where the scores of a merged report were judged; the merge only combines judged runs. */
const JUDGING = 'Each shard judged its own runs before the merge; the merge combines judged runs and judges nothing.';

/** A saved report under the name a merge reports it by. */
export interface MergeSource {
	name: string;
	report: BenchmarkReport;
}

/** Tasks and runs the reports were meant to hold and do not: whole tasks no report ran, and every missing run id. */
export interface Missing {
	tasks: string[];
	runs: string[];
}

/** One merged report as the merged report keeps it: where it ran, on what, and when. */
interface MergedSource {
	report: string;
	reportId: string | null;
	shard: { index: number; count: number } | null;
	repeat: number;
	host: RunIdentity['host'];
	base: string;
	startedAt: string;
	finishedAt: string;
	elapsedMs: number;
	runIds: string[];
	/** The reports it reused, when it resumed, replayed or rescored one. */
	derivedFrom?: BenchmarkReport['derivedFrom'];
}

/** Shard and repeat reports combined into one, with each source's host and timing. */
export type MergedReport = Omit<BenchmarkReport, 'summary'> & {
	/** `partial` is true when tasks or runs are missing, listed in `missingTasks` and `missingRuns`; such a report is no complete score. */
	summary: BenchmarkReport['summary'] & { partial: boolean; missingTasks: string[]; missingRuns: string[] };
	merge: { judging: string; reports: MergedSource[] };
};

/** How alike a PR's passed runs' findings are; null under two passed runs. */
export function runAgreement(runs: readonly ScoredRun[]): PrResult['agreement'] {
	const passed = runs.filter((run) => run.outcome === 'passed').map((run) => run.findings);
	const stability = passed.length > 1 ? stabilityMetrics(passed) : null;

	return stability && { strict: stability.strict, loose: stability.loose };
}

/** A report's totals over its PRs, under the task set they came from. */
export function benchmarkSummary(prs: readonly PrResult[], taskSet: string | undefined): BenchmarkReport['summary'] {
	return {
		taskSet,
		...summarize(
			prs.map((pr) => ({
				codebase: pr.codebase,
				defects: pr.defects,
				scores: pr.runs.flatMap((run) => (run.score ? [run.score] : [])),
				hiddenRuns: pr.runs.flatMap((run) =>
					run.score && run.hiddenScore ? [{ shown: run.score, hidden: run.hiddenScore }] : []
				),
				stageRuns: pr.runs.flatMap((run) => (run.score && run.stages ? [run.stages] : [])),
				lowRuns: pr.runs.flatMap((run) => (run.score && run.lows ? [run.lows] : [])),
				control: pr.control,
				labeledRuns: pr.runs.flatMap((run) => (run.labeled ? [run.labeled] : []))
			}))
		)
	};
}

const taskOf = (pr: PrResult) => pr.taskId ?? pr.id;

const runIdIn = (pr: PrResult, run: ScoredRun) => run.runId ?? runIdOf(taskOf(pr), run.index);

/**
 * Run ids that more than one report, or one report twice, holds. Unlike
 * `mergeProblems`, a run id repeats here whatever the report ids say, since
 * the merged PR would hold two runs under one id; a repeat run with
 * `--repeat` takes the next run numbers instead.
 */
function repeatedRuns(sources: readonly MergeSource[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();

	for (const { report } of sources) {
		for (const id of report.prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run)))) {
			if (seen.has(id)) repeated.add(id);
			seen.add(id);
		}
	}

	return [...repeated].sort(byId);
}

/** Why the reports cannot be merged: an identity that differs or cannot be checked, a PR at two heads, a run held twice. */
function problems(sources: readonly MergeSource[]): string[] {
	const repeated = repeatedRuns(sources);

	const identity = mergeProblems(
		sources.map(({ name, report }) => ({
			name,
			identity: report.identity,
			reportId: report.reportId,
			runIds: report.runIds
		}))
	);

	return [
		...identity,
		...(repeated.length && !identity.some((line) => line.startsWith('run ids listed more than once'))
			? [
					`task repeats held by more than one report (${repeated.length}): ${repeated.join(', ')}; run each repeat with its own --repeat`
				]
			: [])
	];
}

/** The run indices a report was meant to hold: its repeat's `runsPerPr` runs. */
function plannedRuns(identity: RunIdentity): number[] {
	const { runsPerPr, repeat = 1 } = identity.execution;

	return Array.from({ length: runsPerPr }, (_, run) => runOffset(repeat, runsPerPr) + run + 1);
}

/** Every task and run the reports were meant to hold that none does, tasks in the task set's order. */
function missingRuns(sources: readonly MergeSource[], present: ReadonlySet<string>): Missing {
	const planned = new Map<string, Set<number>>();

	for (const identity of sources.map(({ report }) => report.identity!)) {
		for (const task of identity.shard?.all ?? identity.tasks.map((entry) => entry.taskId)) {
			const runs = planned.get(task) ?? new Set();

			for (const index of plannedRuns(identity)) runs.add(index);
			planned.set(task, runs);
		}
	}

	const runs = [...planned].flatMap(([task, indices]) =>
		[...indices]
			.sort((a, b) => a - b)
			.flatMap((index) => (present.has(runIdOf(task, index)) ? [] : [runIdOf(task, index)]))
	);

	const tasks = [...planned.keys()].filter((task) =>
		[...planned.get(task)!].every((index) => !present.has(runIdOf(task, index)))
	);

	return { tasks, runs };
}

/** Each task's PR with the runs of every report that ran it, in task-set order; a PR one report holds is kept as it is. */
function mergedPrs(sources: readonly MergeSource[]): PrResult[] {
	const byTask = new Map<string, PrResult[]>();

	for (const pr of sources.flatMap(({ report }) => report.prs))
		byTask.set(taskOf(pr), [...(byTask.get(taskOf(pr)) ?? []), pr]);

	return [...byTask.values()]
		.map(([first, ...rest]) => {
			if (!rest.length) return first!;

			const runs = [first!, ...rest].flatMap((pr) => pr.runs).sort((a, b) => a.index - b.index);

			return {
				...first!,
				staleHead: [first!, ...rest].some((pr) => pr.staleHead),
				agreement: runAgreement(runs),
				runs
			};
		})
		.sort((a, b) => byId(a.id, b.id));
}

function mergedSource({ name, report }: MergeSource): MergedSource {
	const identity = report.identity!;

	return {
		report: name,
		reportId: report.reportId ?? null,
		shard: identity.shard ? { index: identity.shard.index, count: identity.shard.count } : null,
		repeat: identity.execution.repeat ?? 1,
		host: identity.host,
		base: report.base,
		startedAt: report.startedAt,
		finishedAt: report.finishedAt,
		elapsedMs: Date.parse(report.finishedAt) - Date.parse(report.startedAt),
		runIds: report.prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run))),
		...(report.derivedFrom ? { derivedFrom: report.derivedFrom } : {})
	};
}

/** The merged report: the first report's experiment over every report's tasks and runs, with each source kept. */
function mergedReport(sources: readonly MergeSource[], missing: Missing): MergedReport {
	const { identity: firstIdentity, derivedFrom: _derivedFrom, ...first } = sources[0]!.report;
	const { shard: _shard, ...identity } = firstIdentity!;
	const prs = mergedPrs(sources);
	const runs = prs.flatMap((pr) => pr.runs);
	const runsPerPr = new Set(sources.flatMap(({ report }) => plannedRuns(report.identity!))).size;

	const bases = new Map(
		sources.flatMap(({ report }) => report.identity!.tasks.map((task) => [task.taskId, task] as const))
	);

	const times = (key: 'startedAt' | 'finishedAt') => sources.map(({ report }) => report[key]).sort();
	const { repeat: _repeat, ...execution } = identity.execution;

	return {
		...first,
		runsPerPr,
		reportId: crypto.randomUUID(),
		identity: {
			...identity,
			tasks: prs.flatMap((pr) => bases.get(taskOf(pr)) ?? []),
			execution: { ...execution, runsPerPr },
			runs: runIdentities(runs)
		},
		runIds: prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run))),
		startedAt: times('startedAt')[0]!,
		finishedAt: times('finishedAt').at(-1)!,
		prs,
		summary: {
			...benchmarkSummary(prs, identity.taskSet),
			partial: missing.runs.length > 0,
			missingTasks: missing.tasks,
			missingRuns: missing.runs
		},
		merge: { judging: JUDGING, reports: sources.map(mergedSource) }
	};
}

/**
 * Merges shard and repeat reports of one experiment. Refuses, with every
 * reason, reports whose identities differ in an undeclared field, a PR at two
 * heads, or a task repeat held twice. Tasks or runs the reports were meant to
 * hold and do not are listed; the merged report is made with them missing only
 * when `partial` is set, and is then marked partial.
 */
export function mergeReports(
	sources: readonly MergeSource[],
	partial: boolean
): { problems: string[]; missing: Missing; report: MergedReport | null } {
	const found = problems(sources);

	if (found.length) return { problems: found, missing: { tasks: [], runs: [] }, report: null };

	const present = new Set(
		sources.flatMap(({ report }) => report.prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run))))
	);

	const missing = missingRuns(sources, present);

	return { problems: [], missing, report: missing.runs.length && !partial ? null : mergedReport(sources, missing) };
}
