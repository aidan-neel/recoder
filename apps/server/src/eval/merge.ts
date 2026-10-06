import { existsSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readReport } from './benchmark-report';
import { mergeReports, type Missing } from './benchmark-merge';

const USAGE = 'Usage: bun run --filter @recoder/server eval:merge -- <out.json> <report.json>... [--partial]';

/** Every missing task, then each missing run of a task that ran in part. */
function missingLines(missing: Missing): string[] {
	const partRuns = missing.runs.filter((run) => !missing.tasks.some((task) => run.startsWith(`${task}#`)));

	return [
		...(missing.tasks.length
			? [`Missing tasks (${missing.tasks.length}):`, ...missing.tasks.map((task) => `  ${task}`)]
			: []),
		...(partRuns.length ? [`Missing runs (${partRuns.length}):`, ...partRuns.map((run) => `  ${run}`)] : [])
	];
}

/**
 * Merges shard and repeat reports of one benchmark into `<out.json>`. Each
 * shard judged its own runs, so the merge only checks and combines them: it
 * exits 1, naming every reason, when the identities differ in a field, a PR is
 * at two heads or a task repeat is held twice, and when tasks are missing
 * unless `--partial` is passed, which marks the report partial.
 */
function main(): number {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { partial: { type: 'boolean' } },
		allowPositionals: true,
		strict: true
	});

	const [out, ...inputs] = positionals.map((path) => resolve(path));

	if (!out || !inputs.length) {
		console.error(`Pass the merged report's path and at least one report.\n${USAGE}`);

		return 1;
	}

	if (inputs.includes(out) || existsSync(out)) {
		console.error(`${out} exists; the merge writes a new file.\n${USAGE}`);

		return 1;
	}

	const { problems, missing, report } = mergeReports(
		inputs.map((path) => ({ name: basename(path), report: readReport(path) })),
		!!values.partial
	);

	if (problems.length) {
		console.error(['Not merging:', ...problems.map((problem) => `  ${problem}`)].join('\n'));

		return 1;
	}

	if (!report) {
		console.error(
			[
				...missingLines(missing),
				'Not merging: the reports miss tasks; pass --partial for a report marked partial.'
			].join('\n')
		);

		return 1;
	}

	writeFileSync(out, `${JSON.stringify(report, null, '\t')}\n`);

	console.log(
		[
			`Merged ${inputs.length} reports: ${report.prs.length} PRs, ${report.runIds?.length ?? 0} runs, identity ${report.identity?.hash.slice(0, 12)}`,
			...missingLines(missing),
			...(report.summary.partial ? ['Partial: tasks are missing, so this is no complete score.'] : []),
			report.merge.judging,
			`Report: ${out}`
		].join('\n')
	);

	return 0;
}

process.exit(main());
