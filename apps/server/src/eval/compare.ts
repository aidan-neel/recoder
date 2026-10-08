import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { identityLine, readReport, type BenchmarkReport } from './benchmark-report';
import { mergeNotes } from './benchmark-merge';
import { stageTotals, type StageTotals } from './benchmark-stages';
import { allowDiffFields, checkCompatibility, compatibilityLines, EXPERIMENT } from './identity';
import { mergeProblems } from './identity-merge';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:compare -- <reportA.json> <reportB.json> [--allow-diff field,field]';

/** "8/6/5 of 12": planted defects some candidate reported, a verifier proved, and a shown finding reported. */
function stageCell(totals: StageTotals | undefined): string {
	return totals ? `${totals.found}/${totals.verified}/${totals.published} of ${totals.planted}` : '-';
}

/** Each codebase's stage totals over the judged runs that kept their candidates, plus `all`. */
function codebaseStages(report: BenchmarkReport): Map<string, StageTotals> {
	const runs = report.prs.flatMap((pr) =>
		pr.runs.flatMap((run) =>
			run.score && run.stages ? [{ codebase: pr.codebase, defects: pr.defects, stages: run.stages }] : []
		)
	);

	const codebases = [...new Set(runs.map((run) => run.codebase))].sort();

	return new Map([
		...codebases.map((codebase) => [codebase, stageTotals(runs.filter((run) => run.codebase === codebase))] as const),
		['all', stageTotals(runs)]
	]);
}

function stageTable(a: BenchmarkReport, b: BenchmarkReport): string[] {
	const left = codebaseStages(a);
	const right = codebaseStages(b);
	const keys = [...new Set([...left.keys(), ...right.keys()])].filter((key) => key !== 'all').concat('all');

	return [
		'',
		'Planted defects by codebase: candidate/verified/published of planted',
		`  ${'codebase'.padEnd(14)} ${'A'.padEnd(18)} B`,
		...keys.map((key) => `  ${key.padEnd(14)} ${stageCell(left.get(key)).padEnd(18)} ${stageCell(right.get(key))}`)
	];
}

/**
 * Each difference a merge into A or B declared, and the fields among them this
 * compare does not declare too: a merged report's identity is its first
 * report's, so such a difference would otherwise leave no trace here.
 */
function declaredAtMerge(reports: readonly BenchmarkReport[], allow: readonly string[]) {
	const diffs = reports.flatMap((report, index) =>
		mergeNotes(report).declared.map((diff) => ({ ...diff, side: 'AB'[index]! }))
	);

	const declares = (field: string) => allow.some((name) => field === name || field.startsWith(`${name}.`));
	const undeclared = diffs.filter((diff) => !compareNames(diff.field).every(declares)).map((diff) => diff.field);

	return {
		lines: diffs.map((diff) => `${diff.side}  declared at merge: ${diff.report} ${diff.field}: ${diff.a} → ${diff.b}`),
		undeclared: [...new Set(undeclared)],
		names: [...new Set(undeclared.flatMap(compareNames))]
	};
}

/**
 * The `--allow-diff` names a compare takes for a difference a merge declared:
 * `shard` for a shard field, since a merged identity keeps no shard, and an
 * experiment field with `runs`, since its runs were reviewed under another hash.
 */
function compareNames(field: string): string[] {
	const section = field.split('.')[0]!;

	if (section === 'shard') return ['shard'];

	return EXPERIMENT.some((name) => name === section) ? [field, 'runs'] : [field];
}

/**
 * Prints how two benchmark reports' identities differ and, when they compare,
 * their per-codebase stage counts side by side. Exits 1 when they differ in a
 * field not declared with `--allow-diff`, or either records it as `unknown`, or
 * either holds a review that ran on other models than it declares (`reviewer`), or
 * a merge into either declared a difference this compare does not; a report without an identity is
 * compared with a warning, since nothing says the two runs are equivalent.
 */
function main(): number {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { 'allow-diff': { type: 'string' } },
		allowPositionals: true,
		strict: true
	});

	const { fields: allow, error } = allowDiffFields(values['allow-diff']);
	const problem = positionals.length === 2 ? error : 'Pass two reports.';

	if (problem) {
		console.error(`${problem}\n${USAGE}`);

		return 1;
	}

	const [a, b] = positionals.map((path) => ({ path: resolve(path), report: readReport(resolve(path)) }));

	const reports = [a!, b!].map(({ report }, index) => ({
		name: 'AB'[index]!,
		identity: report.identity,
		mixedReviewer: report.summary.mixedReviewer,
		reportId: report.reportId,
		runIds: report.runIds
	}));

	const result = checkCompatibility(reports[0]!, reports[1]!, 'compare', allow);
	const merge = mergeProblems(reports);
	const merged = declaredAtMerge([a!.report, b!.report], allow);

	console.log(
		[
			...[a!, b!].map(
				({ path, report }, index) =>
					`${'AB'[index]}  ${basename(path)} · report ${report.reportId ?? 'id not recorded'} · ${report.prs.length} PRs × ${report.runsPerPr} runs · ${identityLine(report)}${mergeNotes(report).mark}`
			),
			...merged.lines,
			'',
			...compatibilityLines(result),
			...(result.unrecorded.length || !result.compatible || merged.undeclared.length
				? []
				: ['Compatible: every checked field matches, or differs as declared or expected.']),
			`Merge: ${merge.length ? `refused, ${merge.join('; ')}` : 'possible'}`
		].join('\n')
	);

	if (result.undeclarable.length) {
		console.log('\n--allow-diff names a field neither report has; their counts are not compared.');

		return 1;
	}

	if (merged.undeclared.length) {
		console.log(
			`\nA merged report's sources differ in ${merged.undeclared.join(', ')}, declared at the merge; pass --allow-diff ${merged.names.join(',')} to compare its counts.`
		);

		return 1;
	}

	if (result.refused.length || result.unverifiable.length) {
		console.log(
			`\nThe reports ${result.refused.length ? 'differ in' : 'cannot be checked on'} undeclared fields; their counts are not compared.`
		);

		return 1;
	}

	if (result.unrecorded.length)
		console.warn('\nWarning: identity not recorded, so these counts may come from different experiments.');

	console.log(stageTable(a!.report, b!.report).join('\n'));

	return 0;
}

process.exit(main());
