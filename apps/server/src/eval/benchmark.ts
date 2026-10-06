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
import { getServerIdentity, getSettings, replayReview, resolveRepo } from './client';
import { captureTree } from './harness-tree';
import { UNKNOWN, allowDiffFields, taskIdOf } from './identity';
import {
	checkReuse,
	harnessRecord,
	replayedReviews,
	resumedRecords,
	reusedRuns,
	runIdentities,
	stamped,
	type Prior
} from './benchmark-reuse';
import { captureIdentity } from './identity-capture';
import { writeEvalFile } from './report';
import { runReview, stopOnInterrupt } from './run-review';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:benchmark -- --dataset <dir> [--only id,id] [--judge review|second|<model id>] [--judge-effort medium] [--resume <report.json>] [--replay|--reverify <report.json>] [--mode auto --since <report.json>] [--allow-diff field,field] [--runs 1] [--concurrency 3] [--base http://localhost:3001] [--timeout 45] [--no-baseline-cache]';

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
	/** Identity fields this run may differ in from the report it reuses, shown in the report as declared. */
	allowDiff: string[];
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
			since: { type: 'string' },
			'allow-diff': { type: 'string' }
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

	const { fields: allowDiff, error: allowError } = allowDiffFields(values['allow-diff']);

	if (allowError) return fail(allowError);
	if (allowDiff.length && !values.resume && !replayed && !values.mode)
		return fail('--allow-diff declares how this run differs from the report it reuses; pass it with that report.');

	return {
		dataset: resolve(values.dataset),
		only: values.only ? values.only.split(',') : null,
		judge,
		judgeEffort,
		resume: values.resume ? resolve(values.resume) : null,
		replay: replayed ? { report: resolve(replayed), reverify: !values.replay } : null,
		auto: values.mode && values.since ? { since: resolve(values.since) } : null,
		allowDiff,
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
 * Every run of every PR not already in `records`, `concurrency` reviews at a
 * time, each judged as it finishes. Jobs go round by round, so a long
 * benchmark stopped early still covers every PR; `onRun` sees the records
 * after each run. With `replays`, each run replays that saved review instead,
 * and runs without one are skipped. Each run is stamped with `identity`, the
 * hash it is reviewed under, and the judge that scores it.
 */
async function runAll(
	options: Options,
	labels: PrLabel[],
	repos: Map<string, Repo>,
	judge: Judge,
	identity: string,
	records: ScoredRun[][],
	replays: string[][] | null,
	onRun: (records: ScoredRun[][]) => void
): Promise<ScoredRun[][]> {
	const jobs = Array.from({ length: options.runs }, (_, run) => labels.map((label, pr) => ({ label, pr, run })))
		.flat()
		.filter(({ pr, run }) => !records[pr]![run] && (!replays || replays[pr]![run]));

	const reverify = options.replay?.reverify ?? false;
	const review = replays ? (reverify ? 'reverify' : 'replay') : 'fresh';

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

			records[pr]![run] = stamped(label, await scoreRun(judge, label, record, options.base), {
				review,
				identity,
				judge: judge.model
			});

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
function prResult(label: PrLabel, records: ScoredRun[], bases: Map<string, string>): PrResult {
	const runs = records.filter(Boolean);
	const passed = runs.filter((run) => run.outcome === 'passed').map((run) => run.findings);
	const stability = passed.length > 1 ? stabilityMetrics(passed) : null;
	const taskId = taskIdOf(label.id, label.headSha);

	return {
		id: label.id,
		taskId,
		baseSha: bases.get(taskId) ?? UNKNOWN,
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
	const settings = await getSettings(options.base);
	const resumed = options.resume ? readReport(options.resume) : null;
	const reviewer = plan.rescore ? (plan.origin?.reviewer ?? reviewerManifest(settings)) : reviewerManifest(settings);
	const startedAt = resumed?.startedAt ?? new Date().toISOString();
	const adjudicationFile = adjudicationPath(options.dataset);
	const adjudications = readAdjudications(adjudicationFile);
	const ran = plan.rescore ? 'rescore' : plan.replay ? (plan.replay.reverify ? 'reverify' : 'replay') : 'full';

	const identity = await captureIdentity({
		dataset: options.dataset,
		tasks: labels,
		adjudications,
		settings,
		judge: judge.model,
		server: await getServerIdentity(options.base),
		execution: {
			mode: requested.auto ? 'auto' : requested.replay ? (requested.replay.reverify ? 'reverify' : 'replay') : 'full',
			ran,
			concurrency: options.concurrency,
			timeoutMs: options.timeoutMs,
			runsPerPr: options.runs,
			baselineCache: options.baselineCache
		}
	});

	for (const [part, reason] of Object.entries(identity.unavailable))
		console.warn(`Identity: ${part} unavailable: ${reason}. Comparisons on it are refused unless declared.`);

	const prior: Prior | null =
		resumed && options.resume
			? { path: options.resume, report: resumed, operation: 'resume' }
			: plan.origin && ran !== 'full'
				? { path: plan.replay?.report ?? requested.auto!.since, report: plan.origin, operation: ran }
				: null;

	const derivedFrom = prior ? checkReuse(identity, prior, options.allowDiff) : undefined;
	const bases = new Map(identity.tasks.map((task) => [task.taskId, task.base]));

	const initial = plan.rescore
		? reusedRuns(await rescoredRecords(plan.origin!, labels, judge, options.base), labels, 'rescore', judge.model)
		: resumed
			? reusedRuns(resumedRecords(resumed, labels), labels, 'resume', judge.model)
			: labels.map(() => []);

	stopOnInterrupt(options.base);

	const verb = plan.rescore ? 'Rescoring' : options.replay ? 'Replaying' : 'Benchmarking';

	console.log(
		`${verb} ${labels.length} PRs × ${options.runs} runs, ${options.concurrency} at once, against ${options.base}; judge ${judge.model.model}; identity ${identity.hash.slice(0, 12)}`
	);

	const report = (records: ScoredRun[][]): BenchmarkReport => {
		const prs = labels.map((label, index) => prResult(label, records[index]!, bases));
		const queued = prs.map((pr, index) => labelRuns(labels[index]!, pr.runs, adjudications).queued);

		if (queued.some(Boolean)) writeAdjudications(adjudicationFile, adjudications);

		return {
			dataset: basename(options.dataset),
			base: options.base,
			runsPerPr: options.runs,
			judge: judge.model,
			reviewer,
			harness: harnessRecord(tree, plan.origin, resumed),
			identity: { ...identity, runs: runIdentities(prs.flatMap((pr) => pr.runs)) },
			runIds: prs.flatMap((pr) => pr.runs.flatMap((run) => (run.runId ? [run.runId] : []))),
			...(derivedFrom ? { derivedFrom } : {}),
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
		await runAll(options, labels, repos, judge, identity.hash, initial, replays, (records) => save(report(records)))
	);

	printBenchmark(final);
	console.log(`\nReport: ${save(final)}`);
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

process.exit(0);
