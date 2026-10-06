import { existsSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readReport } from './benchmark-report';
import { mergeReports, missingWhat, partRuns, type Missing } from './benchmark-merge';
import { allowDiffFields } from './identity';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:merge -- <out.json> <report.json>... [--partial] [--allow-diff field,field]';

/** Every missing task, then each missing run of a task that ran in part. */
function missingLines(missing: Missing): string[] {
	const runs = partRuns(missing);

	return [
		...(missing.tasks.length
			? [`Missing tasks (${missing.tasks.length}):`, ...missing.tasks.map((task) => `  ${task}`)]
			: []),
		...(runs.length ? [`Missing runs (${runs.length}):`, ...runs.map((run) => `  ${run}`)] : [])
	];
}

/**
 * Merges shard and repeat reports of one benchmark into `<out.json>`. Each
 * shard judged its own runs, so the merge only checks and combines them: it
 * exits 1, naming every reason, when the identities differ in a field, a PR is
 * at two heads or a task repeat is held twice, and when tasks or runs are
 * missing unless `--partial` is passed, which marks the report partial.
 */
function main(): number {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { partial: { type: 'boolean' }, 'allow-diff': { type: 'string' } },
		allowPositionals: true,
		strict: true
	});

	const [out, ...inputs] = positionals.map((path) => resolve(path));
	const { fields: allow, error } = allowDiffFields(values['allow-diff']);
	const problem = !out || !inputs.length ? "Pass the merged report's path and at least one report." : error;

	if (problem) {
		console.error(`${problem}\n${USAGE}`);

		return 1;
	}

	if (existsSync(out!)) {
		console.error(`${out} exists; the merge writes a new file.\n${USAGE}`);

		return 1;
	}

	const { problems, missing, report } = mergeReports(
		inputs.map((path) => ({ name: basename(path), report: readReport(path) })),
		{ partial: !!values.partial, allow }
	);

	if (problems.length) {
		console.error(['Not merging:', ...problems.map((problem) => `  ${problem}`)].join('\n'));

		return 1;
	}

	if (!report) {
		console.error(
			[
				...missingLines(missing),
				`Not merging: the reports miss ${missingWhat(missing)}; pass --partial for a report marked partial.`
			].join('\n')
		);

		return 1;
	}

	writeFileSync(out!, `${JSON.stringify(report, null, '\t')}\n`);

	console.log(
		[
			`Merged ${inputs.length} reports: ${report.prs.length} PRs, ${report.runIds?.length ?? 0} runs, identity ${report.identity?.hash.slice(0, 12)}`,
			...missingLines(missing),
			...report.merge.declared.map((diff) => `Declared: ${diff.report} ${diff.field}: ${diff.a} → ${diff.b}`),
			...(report.summary.partial
				? [`Partial: ${missingWhat(missing)} are missing, so this is no complete score.`]
				: []),
			report.merge.judging,
			`Report: ${out}`
		].join('\n')
	);

	return 0;
}

process.exit(main());
