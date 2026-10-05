import { chooseMode } from './auto-mode';
import { readReport, type BenchmarkReport } from './benchmark-report';
import type { TreeState } from './harness-tree';

/** How a benchmark runs after `--mode auto` and the explicit flags are settled. */
export interface RunPlan {
	/** The report to replay, and whether to verify again; null for a rescore or a full run. */
	replay: { report: string; reverify: boolean } | null;
	rescore: boolean;
	/** The report a replay or rescore starts from, whose reviewers' output is reused. */
	origin: BenchmarkReport | null;
}

interface PlanInput {
	replay: { report: string; reverify: boolean } | null;
	auto: { since: string } | null;
}

/**
 * The mode `--mode auto` picks against its report, printed with the paths that
 * decided it. An explicit `--replay` or `--reverify` always wins over it.
 */
export function resolvePlan(input: PlanInput, now: TreeState | null, cwd: string): RunPlan {
	if (input.replay) {
		if (input.auto) console.log('An explicit --replay or --reverify wins over --mode auto.');

		return { replay: input.replay, rescore: false, origin: readReport(input.replay.report) };
	}

	if (!input.auto) return { replay: null, rescore: false, origin: null };

	const since = readReport(input.auto.since);
	const choice = chooseMode(since.harness, now, cwd);
	const decided = choice.decidedBy.length ? `\n${choice.decidedBy.map((path) => `  ${path}`).join('\n')}` : '';

	console.log(`Mode auto picked ${choice.mode}: ${choice.reason}.${decided}`);

	if (choice.mode === 'full') return { replay: null, rescore: false, origin: null };

	return {
		replay: choice.mode === 'rescore' ? null : { report: input.auto.since, reverify: choice.mode === 'reverify' },
		rescore: choice.mode === 'rescore',
		origin: since
	};
}
