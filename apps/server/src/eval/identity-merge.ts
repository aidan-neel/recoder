import { checkCompatibility, NOT_RECORDED, type FieldDiff, type Named } from './identity';

/** The PR a task id names. */
function prOfTask(taskId: string): string {
	return taskId.slice(0, taskId.lastIndexOf('@'));
}

/** A report as a merge reads it. */
export interface MergeInput extends Named {
	/** Kept by every reuse of one benchmark; absent from reports older than recording it. */
	reportId?: string;
	runIds?: string[];
}

/**
 * Run ids that appear more than once across the reports, by report id and run
 * id: repeats of one experiment are other runs, while a resume or replay of a
 * report keeps its report id and so its runs.
 */
function duplicateRuns(reports: readonly MergeInput[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();

	for (const report of reports) {
		for (const id of report.runIds ?? []) {
			const key = `${report.reportId ?? NOT_RECORDED}/${id}`;

			if (seen.has(key)) repeated.add(id);
			seen.add(key);
		}
	}

	return [...repeated].sort();
}

/** PRs the reports name at more than one head. */
function splitHeads(reports: readonly MergeInput[]): string[] {
	const tasks = new Map<string, Set<string>>();

	for (const { taskId } of reports.flatMap((report) => report.identity?.tasks ?? [])) {
		const pr = prOfTask(taskId);

		tasks.set(pr, (tasks.get(pr) ?? new Set()).add(taskId));
	}

	return [...tasks.values()].filter((ids) => ids.size > 1).map((ids) => [...ids].sort().join(' vs '));
}

/**
 * Why the reports cannot be merged into one: a missing identity, an experiment
 * field that differs, a PR at two heads, or a run counted twice, which would
 * sum one run's defects as new ones. Fields named in `allow` may differ, and
 * a name in it that is no field refuses. Empty when they merge.
 */
export function mergeProblems(reports: readonly MergeInput[], allow: readonly string[] = []): string[] {
	const unrecorded = reports.filter((report) => !report.identity);

	if (unrecorded.length) return unrecorded.map((report) => `identity not recorded in ${report.name}`);

	const [first, ...rest] = reports;
	const duplicates = duplicateRuns(reports);

	return [
		...new Set(
			rest.flatMap((report) =>
				checkCompatibility(first!, report, 'merge', allow).undeclarable.map(
					({ name }) => `--allow-diff ${name} names no field of ${first!.name} or ${report.name}`
				)
			)
		),
		...rest.flatMap((report) => {
			const result = checkCompatibility(first!, report, 'merge', allow);
			const line = (diff: FieldDiff) => `${diff.field}: ${diff.a} → ${diff.b}`;

			return [
				...result.refused.map((diff) => `${report.name} differs from ${first!.name} in ${line(diff)}`),
				...result.unverifiable.map((diff) => `${report.name} cannot be checked against ${first!.name} in ${line(diff)}`)
			];
		}),
		...splitHeads(reports).map((ids) => `one PR at two heads: ${ids}`),
		...(duplicates.length
			? [
					`run ids listed more than once (${duplicates.length}): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? ', …' : ''}; a run counted twice would sum its defects as new ones`
				]
			: [])
	];
}
