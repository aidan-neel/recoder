import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { identityLine, readReport, type BenchmarkReport } from './benchmark-report';
import { stageTotals, type StageTotals } from './benchmark-stages';
import { allowDiffFields, checkCompatibility, compatibilityLines, mergeProblems } from './identity';

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
 * Prints how two benchmark reports' identities differ and, when they compare,
 * their per-codebase stage counts side by side. Exits 1 when they differ in a
 * field not declared with `--allow-diff`, or either records it as `unknown`; a report without an identity is
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

	const reports = [
		{ name: 'A', identity: a!.report.identity, reportId: a!.report.reportId, runIds: a!.report.runIds },
		{ name: 'B', identity: b!.report.identity, reportId: b!.report.reportId, runIds: b!.report.runIds }
	];

	const result = checkCompatibility(reports[0]!, reports[1]!, 'compare', allow);
	const merge = mergeProblems(reports);

	console.log(
		[
			...[a!, b!].map(
				({ path, report }, index) =>
					`${'AB'[index]}  ${basename(path)} · report ${report.reportId ?? 'id not recorded'} · ${report.prs.length} PRs × ${report.runsPerPr} runs · ${identityLine(report)}`
			),
			'',
			...compatibilityLines(result),
			...(result.unrecorded.length || result.refused.length || result.unverifiable.length
				? []
				: ['Compatible: every checked field matches, or differs as declared or expected.']),
			`Merge: ${merge.length ? `refused, ${merge.join('; ')}` : 'possible'}`
		].join('\n')
	);

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
