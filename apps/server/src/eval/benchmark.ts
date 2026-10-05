import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { REASONING_EFFORTS, type ReasoningEffort, type Repo } from '@recoder/shared';
import {
	printBenchmark,
	readReport,
	reviewerManifest,
	type BenchmarkReport,
	type PrResult,
	type ScoredRun
} from './benchmark-report';
import {
	adjudicationPath,
	labelRun,
	queueUnresolved,
	readAdjudications,
	writeAdjudications,
	type Adjudications
} from './benchmark-labels';
import { judgeModel, rescoredRecords, scoreRun, type Judge } from './benchmark-scoring';
import { summarize, type LabeledDefect } from './benchmark-score';
import { resolvePlan } from './auto-plan';
import { parseEvalArgs, type RunOptions } from './cli';
import { stabilityMetrics } from './metrics';
import { getSettings, replayReview, resolveRepo } from './client';
import { captureTree, sameTree, type TreeState } from './harness-tree';
import { writeEvalFile } from './report';
import { runReview, stopOnInterrupt } from './run-review';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:benchmark -- --dataset <dir> [--only id,id] [--judge review|second|<model id>] [--judge-effort medium] [--resume <report.json>] [--replay|--reverify <report.json>] [--mode auto --since <report.json>] [--runs 1] [--concurrency 3] [--base http://localhost:3001] [--timeout 45] [--no-baseline-cache]';

/** One synthetic PR's label file, as the dataset's assemble step writes it. */
interface PrLabel {
	id: string;
	codebase: string;
	/** The local forge repo's `file://` URL. */
	repo: string;
	pull: number;
	headSha: string;
	verified: boolean;
	defects: LabeledDefect[];
}

interface Options extends RunOptions {
	dataset: string;
	only: string[] | null;
	/**
	 * Which model judges: the review model, the second model, or one named by
	 * id (`opencode:openai/gpt-6-luna`) at `judgeEffort`, so runs that swap the
	 * review model are still scored by the same judge.
	 */
	judge: string;
	judgeEffort: ReasoningEffort | undefined;
	/** A saved benchmark report whose judged runs count toward this one instead of rerunning. */
	resume: string | null;
	/**
	 * A saved benchmark report whose passed reviews are replayed without their
	 * reviewers, keeping their verdicts or, with `reverify`, verifying again.
	 */
	replay: { report: string; reverify: boolean } | null;
	/** `--mode auto --since`: the saved report to pick the cheapest covering mode against. */
	auto: { since: string } | null;
}

function parseOptions(): Options {
	const { values, run, fail } = parseEvalArgs(
		USAGE,
		{
			dataset: { type: 'string' },
			only: { type: 'string' },
			judge: { type: 'string' },
			'judge-effort': { type: 'string' },
			resume: { type: 'string' },
			replay: { type: 'string' },
			reverify: { type: 'string' },
			mode: { type: 'string' },
			since: { type: 'string' }
		},
		{ runs: '1', concurrency: '3', timeout: '45' }
	);

	if (!values.dataset) return fail('--dataset is required.');

	const judge = values.judge ?? 'review';

	const judgeEffort = values['judge-effort'] as ReasoningEffort | undefined;

	if (judgeEffort && !REASONING_EFFORTS.includes(judgeEffort))
		return fail(`--judge-effort is one of ${REASONING_EFFORTS.join(', ')}.`);

	const replayed = values.replay ?? values.reverify;

	if (values.replay && values.reverify)
		return fail('--replay and --reverify each take the report to replay; pass one.');
	if (replayed && values.resume) return fail('--resume continues a benchmark; it does not combine with a replay.');
	if (values.mode && values.mode !== 'auto') return fail('--mode is only auto.');
	if (values.mode && !values.since) return fail('--mode auto needs --since <report.json>.');
	if (values.since && !values.mode) return fail('--since goes with --mode auto.');
	if (values.mode && values.resume)
		return fail('--resume continues a benchmark; it does not combine with --mode auto.');

	return {
		dataset: resolve(values.dataset),
		only: values.only ? values.only.split(',') : null,
		judge,
		judgeEffort,
		resume: values.resume ? resolve(values.resume) : null,
		replay: replayed ? { report: resolve(replayed), reverify: !values.replay } : null,
		auto: values.mode && values.since ? { since: resolve(values.since) } : null,
		...run
	};
}

function readLabels(options: Options): PrLabel[] {
	const dir = join(options.dataset, 'labels');

	const labels = readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as PrLabel)
		.filter((label) => !options.only || options.only.includes(label.id))
		.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

	if (!labels.length) throw new Error(`No labeled PRs in ${dir}.`);

	return labels;
}

/** Each forge repo once, since several PRs share one. */
async function resolveRepos(base: string, labels: PrLabel[]): Promise<Map<string, Repo>> {
	const urls = [...new Set(labels.map((label) => label.repo))];
	const repos = await Promise.all(urls.map((url) => resolveRepo(base, url)));

	return new Map(urls.map((url, index) => [url, repos[index]!]));
}

/**
 * The judged runs of a saved report, placed by run number. Failed and unjudged
 * runs are left out so they run again: a restart mid-review fails it without
 * saying anything about the review itself.
 */
function resumedRecords(report: BenchmarkReport, labels: PrLabel[]): ScoredRun[][] {
	return labels.map((label) => {
		const records: ScoredRun[] = [];

		for (const run of report.prs.find((pr) => pr.id === label.id)?.runs ?? []) {
			if (run.score) records[run.index - 1] = run;
		}

		return records;
	});
}

/**
 * The review ids of a saved report's passed runs, placed by run number. A
 * replay updates those reviews in place, so replaying a report twice replays
 * the first replay's result.
 */
function replayedReviews(report: BenchmarkReport, labels: PrLabel[]): string[][] {
	return labels.map((label) => {
		const ids: string[] = [];

		for (const run of report.prs.find((pr) => pr.id === label.id)?.runs ?? []) {
			if (run.outcome === 'passed') ids[run.index - 1] = run.reviewId;
		}

		return ids;
	});
}

/**
 * Every run of every PR not already in `records`, `concurrency` reviews at a
 * time, each judged as it finishes. Jobs go round by round, so a long
 * benchmark stopped early still covers every PR; `onRun` sees the records
 * after each run. With `replays`, each run replays that saved review instead,
 * and runs without one are skipped.
 */
async function runAll(
	options: Options,
	labels: PrLabel[],
	repos: Map<string, Repo>,
	judge: Judge,
	records: ScoredRun[][],
	replays: string[][] | null,
	onRun: (records: ScoredRun[][]) => void
): Promise<ScoredRun[][]> {
	const jobs = Array.from({ length: options.runs }, (_, run) => labels.map((label, pr) => ({ label, pr, run })))
		.flat()
		.filter(({ pr, run }) => !records[pr]![run] && (!replays || replays[pr]![run]));

	const reverify = options.replay?.reverify ?? false;

	let next = 0;

	const worker = async () => {
		while (next < jobs.length) {
			const { label, pr, run } = jobs[next++]!;
			const runLabel = options.runs > 1 ? ` run ${run + 1}/${options.runs}` : '';

			const record = await runReview(
				{ ...options, inPlace: false },
				{
					repoId: repos.get(label.repo)!.id,
					pr: label.pull,
					index: run + 1,
					label: `${label.id} #${label.pull}${runLabel}`
				},
				replays ? () => replayReview(options.base, replays[pr]![run]!, reverify) : undefined
			);

			records[pr]![run] = await scoreRun(judge, label, record, options.base);
			onRun(records);
		}
	};

	await Promise.all(Array.from({ length: Math.min(options.concurrency, jobs.length) }, worker));

	return records;
}

/**
 * Gives each passed run's findings their class from the dataset's current
 * adjudications, so a label entered once applies to every run that has the
 * finding, resumed ones included. Findings with no human label are queued in
 * the adjudication file as unresolved.
 */
function labelRuns(label: PrLabel, runs: ScoredRun[], adjudications: Adjudications): { queued: boolean } {
	let queued = false;

	for (const run of runs) {
		if (!run.score) continue;

		run.labeled = labelRun(label.id, { ...run, score: run.score }, adjudications);
		queued = queueUnresolved(adjudications, run.findings, run.labeled) || queued;

		if (run.labeled.hidden && run.unconfirmed)
			queued = queueUnresolved(adjudications, run.unconfirmed, run.labeled.hidden) || queued;
	}

	return { queued };
}

/** A PR's finished runs so far; runs still going leave holes, which `filter` skips. */
function prResult(label: PrLabel, records: ScoredRun[]): PrResult {
	const runs = records.filter(Boolean);
	const passed = runs.filter((run) => run.outcome === 'passed').map((run) => run.findings);
	const stability = passed.length > 1 ? stabilityMetrics(passed) : null;

	return {
		id: label.id,
		codebase: label.codebase,
		pull: label.pull,
		verified: label.verified,
		control: label.defects.length === 0,
		defects: label.defects,
		staleHead: runs.some((run) => run.headSha !== 'unknown' && run.headSha !== label.headSha),
		agreement: stability && { strict: stability.strict, loose: stability.loose },
		runs
	};
}

/** The harness record for a new report: where its reviewers ran is the report their output came from, or this tree for a run that starts them. */
function harnessRecord(tree: TreeState | null, origin: BenchmarkReport | null, resumed: BenchmarkReport | null) {
	if (!tree) return undefined;
	if (origin) return { tree, reviewers: origin.harness?.reviewers ?? null };

	return { tree, reviewers: !resumed || sameTree(resumed.harness?.reviewers, tree) ? tree : null };
}

async function main(): Promise<void> {
	const requested = parseOptions();
	const tree = captureTree(import.meta.dir);
	const plan = resolvePlan(requested, tree, import.meta.dir);

	const options = {
		...requested,
		replay: plan.replay,
		runs: plan.origin && plan.rescore ? plan.origin.runsPerPr : requested.runs
	};

	const all = readLabels(options);
	const labels = plan.rescore ? all.filter((label) => plan.origin?.prs.some((pr) => pr.id === label.id)) : all;
	const judge = judgeModel(options.judge, options.judgeEffort);
	const repos = plan.rescore ? new Map<string, Repo>() : await resolveRepos(options.base, labels);
	const current = reviewerManifest(await getSettings(options.base));
	const resumed = options.resume ? readReport(options.resume) : null;
	const reviewer = plan.rescore ? (plan.origin?.reviewer ?? current) : current;
	const startedAt = resumed?.startedAt ?? new Date().toISOString();

	const initial = plan.rescore
		? await rescoredRecords(plan.origin!, labels, judge, options.base)
		: resumed
			? resumedRecords(resumed, labels)
			: labels.map(() => []);

	stopOnInterrupt(options.base);

	const verb = plan.rescore ? 'Rescoring' : options.replay ? 'Replaying' : 'Benchmarking';

	console.log(
		`${verb} ${labels.length} PRs × ${options.runs} runs, ${options.concurrency} at once, against ${options.base}; judge ${judge.model.model}`
	);

	const adjudicationFile = adjudicationPath(options.dataset);
	const adjudications = readAdjudications(adjudicationFile);

	const report = (records: ScoredRun[][]): BenchmarkReport => {
		const prs = labels.map((label, index) => prResult(label, records[index]!));
		const queued = prs.map((pr, index) => labelRuns(labels[index]!, pr.runs, adjudications).queued);

		if (queued.some(Boolean)) writeAdjudications(adjudicationFile, adjudications);

		return {
			dataset: basename(options.dataset),
			base: options.base,
			runsPerPr: options.runs,
			judge: judge.model,
			reviewer,
			harness: harnessRecord(tree, plan.origin, resumed),
			startedAt,
			finishedAt: new Date().toISOString(),
			prs,
			summary: summarize(
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
	};

	const save = (current: BenchmarkReport) => writeEvalFile(`benchmark-${current.dataset}`, startedAt, current);

	console.log(`Report: ${save(report(initial))}`);

	const replays = plan.rescore ? labels.map(() => []) : options.replay ? replayedReviews(plan.origin!, labels) : null;

	const final = report(
		await runAll(options, labels, repos, judge, initial, replays, (records) => save(report(records)))
	);

	printBenchmark(final);
	console.log(`\nReport: ${save(final)}`);
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

process.exit(0);
