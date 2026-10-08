import { basename } from 'node:path';
import {
	derivations,
	type BenchmarkReport,
	type Derivation,
	type JudgeModel,
	type ScoredRun
} from './benchmark-report';
import { sameTree, type TreeState } from './harness-tree';
import {
	NOT_RECORDED,
	checkCompatibility,
	compatibilityLines,
	runCache,
	runIdOf,
	taskIdOf,
	type ExecutionMode,
	type RunCache,
	type RunIdentity
} from './identity';

/** A labeled PR as reuse reads it. */
interface Task {
	id: string;
	headSha: string;
}

/** The report a resume, replay or rescore reuses, and how. */
export interface Prior {
	path: string;
	report: BenchmarkReport;
	operation: Derivation['operation'];
}

/** What a run is stamped with: where its review came from, the identity it was reviewed under, the judge that scored it. */
interface Stamp {
	review: RunCache['review'];
	identity: string;
	judge: JudgeModel | typeof NOT_RECORDED;
}

/** The reused report's id, which a resume, replay, reverify or rescore keeps; a new one for a fresh start or a report that recorded none. */
export function reportIdOf(prior: Prior | null): string {
	return prior?.report.reportId ?? crypto.randomUUID();
}

/**
 * How a benchmark obtains its runs: continued from a report, reused by a
 * replay, reverify or rescore of one, or reviewed now for every task or only
 * the `--only` ones.
 */
export function executionMode(
	reuse: 'full' | 'replay' | 'reverify' | 'rescore',
	resume: boolean,
	only: boolean
): ExecutionMode {
	if (resume) return 'resume';
	if (reuse !== 'full') return reuse;

	return only ? 'partial' : 'full';
}

/** A run with its stable id and its stamp. */
export function stamped(task: Task, run: ScoredRun, stamp: Stamp): ScoredRun {
	return {
		...run,
		runId: runIdOf(taskIdOf(task.id, task.headSha), run.index),
		cache: runCache(stamp.review),
		identity: stamp.identity,
		judge: stamp.judge
	};
}

/**
 * The judged runs of a saved report, placed by run number. Failed and unjudged
 * runs are left out so they run again: a restart mid-review fails it without
 * saying anything about the review itself.
 */
export function resumedRecords(report: BenchmarkReport, tasks: readonly Task[]): ScoredRun[][] {
	return tasks.map((task) => {
		const records: ScoredRun[] = [];

		for (const run of report.prs.find((pr) => pr.id === task.id)?.runs ?? []) {
			if (run.score) records[run.index - 1] = run;
		}

		return records;
	});
}

/**
 * Reused runs stamped for the new report. Each keeps the identity it was
 * reviewed under, `not recorded` when its report stamped none. A resumed run
 * keeps the judge that scored it; a rescored one was scored again by `judge`.
 */
export function reusedRuns(
	records: ScoredRun[][],
	tasks: readonly Task[],
	review: 'resume' | 'rescore',
	judge: JudgeModel
): ScoredRun[][] {
	return records.map((runs, index) =>
		runs.map((run) =>
			stamped(tasks[index]!, run, {
				review,
				identity: run.identity ?? NOT_RECORDED,
				judge: review === 'rescore' ? judge : (run.judge ?? NOT_RECORDED)
			})
		)
	);
}

/** How many runs were reviewed under each identity hash, for the report's identity. */
export function runIdentities(runs: readonly ScoredRun[]): Record<string, number> {
	const counts: Record<string, number> = {};

	for (const run of runs) {
		const hash = run.identity ?? NOT_RECORDED;

		counts[hash] = (counts[hash] ?? 0) + 1;
	}

	return counts;
}

/**
 * The review ids of a saved report's passed runs, placed by run number. A
 * replay updates those reviews in place, so replaying a report twice replays
 * the first replay's result.
 */
export function replayedReviews(report: BenchmarkReport, tasks: readonly Task[]): string[][] {
	return tasks.map((task) => {
		const ids: string[] = [];

		for (const run of report.prs.find((pr) => pr.id === task.id)?.runs ?? []) {
			if (run.outcome === 'passed') ids[run.index - 1] = run.reviewId;
		}

		return ids;
	});
}

/** The harness record for a new report: where its reviewers ran is the report their output came from, or this tree for a run that starts them. */
export function harnessRecord(tree: TreeState | null, origin: BenchmarkReport | null, resumed: BenchmarkReport | null) {
	if (!tree) return undefined;
	if (origin) return { tree, reviewers: origin.harness?.reviewers ?? null };

	return { tree, reviewers: !resumed || sameTree(resumed.harness?.reviewers, tree) ? tree : null };
}

/**
 * Refuses to reuse a report whose identity differs from this run's in a field
 * the reuse does not expect and `--allow-diff` does not declare, naming each
 * field. A report that records no identity is refused unless `identity` is
 * declared, and an `--allow-diff` name that is no field of either identity is
 * refused too. Returns the reused report's chain with this reuse appended.
 */
export function checkReuse(identity: RunIdentity, prior: Prior, allow: string[]): Derivation[] {
	const name = basename(prior.path);
	const operation = prior.operation === 'resume' ? 'resume' : 'replay';

	const result = checkCompatibility(
		{ name, identity: prior.report.identity },
		{ name: 'this run', identity },
		operation,
		allow
	);

	const lines = compatibilityLines(result);

	if (lines.length) console.log([`Identity of ${name} → this run`, ...lines].join('\n'));

	if (result.undeclarable.length)
		throw new Error(
			`Not reusing ${name}: --allow-diff ${result.undeclarable.map((field) => field.name).join(', ')} names no field of either identity.`
		);

	if (!result.compatible) {
		const fields = result.unrecorded.length
			? ['identity']
			: [
					...new Set(
						[...result.refused, ...result.unverifiable].map((diff) =>
							diff.field.startsWith('tasks.') ? 'tasks' : diff.field
						)
					)
				];

		const code = fields.some((field) => field === 'code' || field.startsWith('code.'))
			? ' Any change to server or shared code, their package manifests or bun.lock changes code and blocks reuse.'
			: '';

		throw new Error(
			`Not reusing ${name}.${code} To reuse it anyway, declare the difference: --allow-diff ${fields.join(',')}`
		);
	}

	return [
		...derivations(prior.report),
		{
			operation: prior.operation,
			report: name,
			identity: prior.report.identity?.hash ?? NOT_RECORDED,
			declared: result.declared
		}
	];
}

/** The index of the run before a repeat's first: repeat `k` of `runs` runs numbers its runs after the `k - 1` repeats before it. */
export function runOffset(repeat: number, runs: number): number {
	return (repeat - 1) * runs;
}

/**
 * Refuses to reuse a report of another repeat, whose runs are numbered apart
 * from this one's and would join it as extra runs instead of being reused.
 */
export function checkRepeat(prior: BenchmarkReport, repeat: number, runs: number): void {
	const execution = prior.identity?.execution;
	const before = execution ? runOffset(execution.repeat ?? 1, execution.runsPerPr) : 0;

	if (before !== runOffset(repeat, runs))
		throw new Error(
			`The reused report's runs start after run ${before}, this run's after run ${runOffset(repeat, runs)}; pass the --repeat and --runs it ran with.`
		);
}
