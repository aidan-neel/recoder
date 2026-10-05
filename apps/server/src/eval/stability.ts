import type { Repo } from '@recoder/shared';
import { parseEvalArgs, type RunOptions } from './cli';
import { resolveRepo } from './client';
import { stabilityMetrics } from './metrics';
import { printReport, writeReport, type RunRecord, type StabilityReport } from './report';
import { runReview, stopOnInterrupt } from './run-review';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:stability -- --repo <id|owner/name> --pr <number> [--runs 5] [--concurrency 1] [--base http://localhost:3001] [--timeout 60]';

interface Options extends RunOptions {
	repo: string;
	pr: number;
}

function parseOptions(): Options {
	const { values, run, fail, positiveInt } = parseEvalArgs(
		USAGE,
		{ repo: { type: 'string' }, pr: { type: 'string' } },
		{ runs: '5', concurrency: '1', timeout: '60' }
	);

	if (!values.repo) return fail('--repo is required.');

	return {
		repo: values.repo,
		pr: positiveInt(values.pr, 'pr'),
		...run
	};
}

/** Every run, `concurrency` at a time, in run order. */
async function runAll(options: Options, repo: Repo): Promise<RunRecord[]> {
	const runs: RunRecord[] = [];
	let next = 1;

	const worker = async () => {
		while (next <= options.runs) {
			const index = next++;

			runs[index - 1] = await runReview(
				{ ...options, inPlace: Boolean(process.stdout.isTTY) && options.concurrency === 1 },
				{ repoId: repo.id, pr: options.pr, index, label: `Run ${index}/${options.runs}` }
			);
		}
	};

	await Promise.all(Array.from({ length: Math.min(options.concurrency, options.runs) }, worker));

	return runs;
}

async function main(): Promise<void> {
	const options = parseOptions();
	const repo = await resolveRepo(options.base, options.repo);
	const startedAt = new Date().toISOString();

	stopOnInterrupt(options.base);

	console.log(
		`Reviewing ${repo.name} #${options.pr} ${options.runs} times, ${options.concurrency} at once, against ${options.base}`
	);

	const runs = await runAll(options, repo);

	const passed = runs.filter((run) => run.outcome === 'passed');

	const report: StabilityReport = {
		repo: { id: repo.id, name: repo.name },
		prNumber: options.pr,
		base: options.base,
		requestedRuns: options.runs,
		startedAt,
		finishedAt: new Date().toISOString(),
		headShas: [...new Set(runs.map((run) => run.headSha).filter((sha) => sha !== 'unknown'))],
		runs,
		metrics: passed.length ? stabilityMetrics(passed.map((run) => run.findings)) : null
	};

	printReport(report);
	console.log(`\nReport: ${writeReport(report)}`);
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

process.exit(0);
