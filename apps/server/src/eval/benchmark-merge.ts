import { benchmarkSummary } from './benchmark-score';
import type { BenchmarkReport, PrResult, ScoredRun } from './benchmark-report';
import { runIdentities, runOffset } from './benchmark-reuse';
import { checkCompatibility, runIdOf, type FieldDiff, type RunIdentity } from './identity';
import { mergeProblems } from './identity-merge';
import { stabilityMetrics } from './metrics';
import { mergedMixedReviewer } from './run-reviewer';
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
	shard: { index: number; count: number; tasks: string[] } | null;
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
	/** `declared` holds each difference from the first report that `--allow-diff` let through, by the report that has it. */
	merge: { judging: string; reports: MergedSource[]; declared: (FieldDiff & { report: string })[] };
};

/** How alike a PR's passed runs' findings are; null under two passed runs. */
export function runAgreement(runs: readonly ScoredRun[]): PrResult['agreement'] {
	const passed = runs.filter((run) => run.outcome === 'passed').map((run) => run.findings);
	const stability = passed.length > 1 ? stabilityMetrics(passed) : null;

	return stability && { strict: stability.strict, loose: stability.loose };
}

/** Missing runs of tasks that ran in part; the runs of a task that never ran are in its missing task. */
export function partRuns(missing: Missing): string[] {
	return missing.runs.filter((run) => !missing.tasks.some((task) => run.startsWith(`${task}#`)));
}

/** What is missing in words: "tasks", "runs" of tasks that ran in part, or both. */
export function missingWhat(missing: Missing): string {
	const runs = partRuns(missing).length > 0;

	return missing.tasks.length ? (runs ? 'tasks and runs' : 'tasks') : 'runs';
}

/** A merged report's partial and declared marks for a header line, and each difference declared at the merge; none for another report. */
export function mergeNotes(report: BenchmarkReport): { mark: string; declared: MergedReport['merge']['declared'] } {
	const { summary, merge } = report as Partial<MergedReport>;
	const declared = merge?.declared ?? [];
	const missing = { tasks: summary?.missingTasks ?? [], runs: summary?.missingRuns ?? [] };

	return {
		mark: `${summary?.partial === true ? ` · PARTIAL merge, ${missingWhat(missing)} missing` : ''}${declared.length ? ` · merged with ${declared.length} declared difference${declared.length === 1 ? '' : 's'}` : ''}`,
		declared
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
function problems(sources: readonly MergeSource[], allow: readonly string[]): string[] {
	const repeated = repeatedRuns(sources);

	const identity = mergeProblems(
		sources.map(({ name, report }) => ({
			name,
			identity: report.identity,
			mixedReviewer: report.summary.mixedReviewer,
			reportId: report.reportId,
			runIds: report.runIds
		})),
		allow
	);

	return [
		...identity,
		...(repeated.length && !identity.some((line) => line.startsWith('run ids listed more than once'))
			? [
					`task repeats held by more than one report (${repeated.length}): ${repeated.slice(0, 3).join(', ')}${repeated.length > 3 ? ', …' : ''}; run each repeat with its own --repeat`
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
		shard: identity.shard
			? { index: identity.shard.index, count: identity.shard.count, tasks: identity.shard.tasks }
			: null,
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

/**
 * The merged runs' execution: the first report's, over every repeat, and a
 * full run again when shards of the full set leave no task out.
 */
function mergedExecution(identity: RunIdentity, runsPerPr: number, missing: Missing): RunIdentity['execution'] {
	const { repeat: _repeat, ...execution } = identity.execution;
	const whole = execution.mode === 'partial' && identity.taskSet === 'full' && !missing.runs.length;

	return { ...execution, mode: whole ? 'full' : execution.mode, runsPerPr };
}

/** Each difference `allow` let through between the first report's identity and another's. */
function declaredDiffs(sources: readonly MergeSource[], allow: readonly string[]): MergedReport['merge']['declared'] {
	const [first, ...rest] = sources.map(({ name, report }) => ({
		name,
		identity: report.identity,
		mixedReviewer: report.summary.mixedReviewer
	}));

	return rest.flatMap((other) =>
		checkCompatibility(first!, other, 'merge', allow).declared.map((diff) => ({ ...diff, report: other.name }))
	);
}

/** The merged report: the first report's experiment over every report's tasks and runs, with each source kept. */
function mergedReport(sources: readonly MergeSource[], missing: Missing, allow: readonly string[]): MergedReport {
	const { identity: firstIdentity, derivedFrom: _derivedFrom, ...first } = sources[0]!.report;
	const { shard: _shard, ...identity } = firstIdentity!;
	const prs = mergedPrs(sources);
	const runs = prs.flatMap((pr) => pr.runs);
	const runsPerPr = new Set(sources.flatMap(({ report }) => plannedRuns(report.identity!))).size;

	const bases = new Map(
		sources.flatMap(({ report }) => report.identity!.tasks.map((task) => [task.taskId, task] as const))
	);

	const times = (key: 'startedAt' | 'finishedAt') => sources.map(({ report }) => report[key]).sort();

	return {
		...first,
		runsPerPr,
		reportId: crypto.randomUUID(),
		identity: {
			...identity,
			tasks: prs.flatMap((pr) => bases.get(taskOf(pr)) ?? []),
			execution: mergedExecution(identity, runsPerPr, missing),
			runs: runIdentities(runs)
		},
		runIds: prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run))),
		startedAt: times('startedAt')[0]!,
		finishedAt: times('finishedAt').at(-1)!,
		prs,
		summary: {
			...benchmarkSummary(prs, identity.taskSet),
			...mergedMixedReviewer(sources.map(({ report }) => report.summary.mixedReviewer)),
			partial: missing.runs.length > 0,
			missingTasks: missing.tasks,
			missingRuns: missing.runs
		},
		merge: { judging: JUDGING, reports: sources.map(mergedSource), declared: declaredDiffs(sources, allow) }
	};
}

/**
 * Merges shard and repeat reports of one experiment. Refuses, with every
 * reason, reports whose identities differ in an undeclared field, a report
 * whose reviews ran on other models than it declares unless `reviewer` is
 * declared, a PR at two heads, or a task repeat held twice. The merged
 * report's `mixedReviewer` is true when any source's is. Tasks or runs the reports were meant to
 * hold and do not are listed; the merged report is made with them missing only
 * when `partial` is set, and is then marked partial. Identity fields named in
 * `allow` may differ, and the merged report lists how.
 */
export function mergeReports(
	sources: readonly MergeSource[],
	options: { partial: boolean; allow: readonly string[] }
): { problems: string[]; missing: Missing; report: MergedReport | null } {
	const found = problems(sources, options.allow);

	if (found.length) return { problems: found, missing: { tasks: [], runs: [] }, report: null };

	const present = new Set(
		sources.flatMap(({ report }) => report.prs.flatMap((pr) => pr.runs.map((run) => runIdIn(pr, run))))
	);

	const missing = missingRuns(sources, present);

	const refused = missing.runs.length && !options.partial;

	return { problems: [], missing, report: refused ? null : mergedReport(sources, missing, options.allow) };
}
