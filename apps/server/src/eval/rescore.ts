import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REASONING_EFFORTS, type ReasoningEffort } from '@recoder/shared';
import { OPENCODE_MODEL_PREFIX } from '../agents/opencode/opencode-catalog';
import { JUDGE_VERSION } from './benchmark-judge';
import { adjudicationPath, labelRun, readAdjudications, type Adjudications } from './benchmark-labels';
import {
	derivations,
	printBenchmark,
	type BenchmarkReport,
	type JudgeModel,
	type PrResult,
	type RescoredFrom,
	type ScoredRun
} from './benchmark-report';
import { harnessRecord, reusedRuns, runIdentities } from './benchmark-reuse';
import { benchmarkSummary } from './benchmark-score';
import { judgeModel, rescoredRecords, type Judge } from './benchmark-scoring';
import { captureTree } from './harness-tree';
import { NOT_RECORDED, contentHash, withHash, type RunIdentity } from './identity';
import { datasetHashes, judgeIdentity } from './identity-capture';
import { sourceVersion } from './source-hash';
import { readLabels, type PrLabel } from './task-set';

const USAGE =
	'Usage: bun run --filter @recoder/server eval:rescore -- <in-report.json> <out-report.json> [--judge <model id>] [--judge-effort <effort>] [--dataset <dir>]';

/**
 * A base no request can be made to: a path resolved against it is an invalid
 * URL, so a run that saved no pool asks no server for its candidates and is
 * left without stages.
 */
const NO_SERVER = 'no-server:';

/** What the command line may override; each defaults to what the input report recorded. */
export interface RescoreOptions {
	/** A judge model id, as `eval:benchmark --judge` takes it. */
	judge?: string;
	judgeEffort?: ReasoningEffort;
	/** The dataset with the labels and adjudications; `~/.recoder/datasets/<report.dataset>` by default. */
	dataset?: string;
}

/** Builds the judge a model id and effort name; the real one calls the model, a test's does not. */
export type JudgeFactory = (choice: string, effort: ReasoningEffort | undefined) => Judge;

/** The rescored report and the lines that say what the rescore could not judge again. */
export interface Rescored {
	report: BenchmarkReport;
	notes: string[];
}

/** The saved report being rescored: its absolute path, its bytes and what they parse to. */
interface Source {
	path: string;
	bytes: Buffer;
	report: BenchmarkReport;
}

/** The judge id that names the input's judge again; only an OpenCode judge is named by its model alone. */
export function judgeChoice(judge: JudgeModel): string {
	if (judge.provider === 'opencode') return `${OPENCODE_MODEL_PREFIX}${judge.model}`;

	throw new Error(
		`The input was judged by ${judge.model} (${judge.provider}), which only a settings model id names: pass --judge <model id>.`
	);
}

/** The input judge's effort, when it is one a judge takes. */
function effortOf(judge: JudgeModel): ReasoningEffort | undefined {
	return REASONING_EFFORTS.find((effort) => effort === judge.effort);
}

/** Each PR's labels from the dataset, in the report's order; a PR the dataset has no labels for is refused. */
function labelsOf(report: BenchmarkReport, dataset: string): PrLabel[] {
	const labels = new Map(readLabels(dataset).map((label) => [label.id, label]));
	const missing = report.prs.filter((pr) => !labels.has(pr.id)).map((pr) => pr.id);

	if (missing.length) throw new Error(`The dataset ${dataset} has no labels for ${missing.join(', ')}.`);

	return report.prs.map((pr) => labels.get(pr.id)!);
}

/**
 * The input's identity with what a rescore changes recorded again: the judge,
 * the labels and adjudications it scored against, the harness code that
 * scored, and how the runs were obtained. Each run keeps the identity it was
 * reviewed under. None for a report older than identities.
 */
function rescoredIdentity(
	identity: RunIdentity | undefined,
	dataset: string,
	adjudications: Adjudications,
	judge: JudgeModel,
	runs: readonly ScoredRun[]
): RunIdentity | undefined {
	if (!identity) return undefined;

	const { version: _version, hash: _hash, runs: _runs, ...fields } = identity;

	const next = withHash({
		...fields,
		dataset: { ...fields.dataset, ...datasetHashes(dataset, adjudications) },
		code: { ...fields.code, harness: sourceVersion() },
		judge: judgeIdentity(judge),
		caches: { ...fields.caches, 'benchmark-judge': `v${JUDGE_VERSION}` },
		execution: { ...fields.execution, mode: 'rescore', auto: false }
	});

	return { ...next, runs: runIdentities(runs) };
}

/** The input judge's version: from its identity, or from the rescore that wrote it when it has none. */
function inputJudgeVersion(input: BenchmarkReport): number | typeof NOT_RECORDED {
	return input.identity?.judge.version ?? input.rescoredFrom?.rescoredBy.version ?? NOT_RECORDED;
}

/** Passed runs that saved no pool, and those whose pool or findings record no ids, so their lows cannot be read. */
function untraced(report: BenchmarkReport): Pick<RescoredFrom, 'withoutPool' | 'withoutIds'> {
	const passed = report.prs.flatMap((pr) => pr.runs.filter((run) => run.outcome === 'passed'));
	const pooled = passed.filter((run) => run.pool);

	return {
		withoutPool: passed.length - pooled.length,
		withoutIds: pooled.filter((run) => !run.findingIds || run.pool!.some((candidate) => !candidate.id)).length
	};
}

/**
 * What the report's own rescore lines do not say: that the input's
 * below-the-bar section is gone, and which PRs were scored against labels
 * other than the defects the input recorded.
 */
function notesOf(input: BenchmarkReport, output: BenchmarkReport, labels: readonly PrLabel[]): string[] {
	const changed = input.prs.filter((pr, index) => contentHash(pr.defects) !== contentHash(labels[index]!.defects));

	return [
		...(input.summary.lows && !output.summary.lows
			? ['The input had a "Published below the bar" section; without candidate ids this report drops it.']
			: []),
		...(changed.length
			? [
					`${changed.length} PRs have labels that differ from the defects the input recorded (${changed.map((pr) => pr.id).join(', ')}); they are scored against the dataset's labels.`
				]
			: [])
	];
}

/**
 * The saved report judged again by `judge` at this harness's judge version,
 * from the findings and candidate pools its runs saved. It starts no review
 * and asks no server anything; the adjudications are read, never written.
 * Each run's `reviewer` and the summary's `mixedReviewer` are kept as they are.
 */
async function rescore(source: Source, dataset: string, judge: Judge): Promise<Rescored> {
	const input = source.report;
	const labels = labelsOf(input, dataset);
	const adjudications = readAdjudications(adjudicationPath(dataset));
	const startedAt = new Date().toISOString();
	const records = await rescoredRecords(input, labels, judge, NO_SERVER, adjudications);
	const stamped = reusedRuns(records, labels, 'rescore', judge.model);

	const prs = input.prs.map((pr, index): PrResult => {
		const runs = stamped[index]!.filter(Boolean).map((run) =>
			run.score ? { ...run, labeled: labelRun(pr.id, { ...run, score: run.score }, adjudications) } : run
		);

		return { ...pr, defects: labels[index]!.defects, runs };
	});

	const runs = prs.flatMap((pr) => pr.runs);
	const identity = rescoredIdentity(input.identity, dataset, adjudications, judge.model, runs);

	const rescoredFrom: RescoredFrom = {
		path: source.path,
		sha256: createHash('sha256').update(source.bytes).digest('hex'),
		judge: { ...input.judge, version: inputJudgeVersion(input) },
		rescoredBy: { ...judge.model, version: JUDGE_VERSION },
		...untraced(input)
	};

	const harness = harnessRecord(captureTree(import.meta.dir), input, null);

	const report: BenchmarkReport = {
		...input,
		judge: judge.model,
		...(harness ? { harness } : {}),
		reportId: input.reportId ?? crypto.randomUUID(),
		...(identity ? { identity } : {}),
		runIds: runs.flatMap((run) => (run.runId ? [run.runId] : [])),
		derivedFrom: [
			...derivations(input),
			{
				operation: 'rescore',
				report: basename(source.path),
				identity: input.identity?.hash ?? NOT_RECORDED,
				declared: []
			}
		],
		rescoredFrom,
		startedAt,
		finishedAt: new Date().toISOString(),
		prs,
		summary: {
			...benchmarkSummary(prs, input.summary.taskSet),
			...(input.summary.mixedReviewer !== undefined && { mixedReviewer: input.summary.mixedReviewer })
		}
	};

	return { report, notes: notesOf(input, report, labels) };
}

/**
 * Rescores the report at `input` into a new report at `output`. Refuses an
 * output that exists, the input included, before judging anything; reads the
 * input and never writes it. The judge and its effort default to the input's.
 */
export async function rescoreFile(
	input: string,
	output: string,
	options: RescoreOptions,
	judgeFor: JudgeFactory = judgeModel
): Promise<Rescored> {
	const path = resolve(input);
	const out = resolve(output);

	if (path === out) throw new Error('The output is the input: a rescore never overwrites its input.');
	if (existsSync(out)) throw new Error(`${out} exists: a rescore never overwrites a report. Pass a new path.`);

	const bytes = readFileSync(path);
	const report = JSON.parse(bytes.toString('utf8')) as BenchmarkReport;
	const judge = judgeFor(options.judge ?? judgeChoice(report.judge), options.judgeEffort ?? effortOf(report.judge));
	const dataset = resolve(options.dataset ?? join(homedir(), '.recoder', 'datasets', report.dataset));

	console.log(
		`Rescoring ${path} (sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}) with judge ${judge.model.model}${judge.model.effort ? ` (${judge.model.effort})` : ''} v${JUDGE_VERSION}, labels from ${dataset}`
	);

	const rescored = await rescore({ path, bytes, report }, dataset, judge);

	writeFileSync(out, `${JSON.stringify(rescored.report, null, '\t')}\n`, { flag: 'wx' });

	return rescored;
}

function parseOptions(): { input: string; output: string; options: RescoreOptions } {
	const fail = (message: string): never => {
		console.error(`${message}\n${USAGE}`);
		process.exit(1);
	};

	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			judge: { type: 'string' },
			'judge-effort': { type: 'string' },
			dataset: { type: 'string' },
			help: { type: 'boolean' }
		},
		allowPositionals: true,
		strict: true
	});

	if (values.help) {
		console.log(USAGE);
		process.exit(0);
	}

	const [input, output, ...extra] = positionals;

	if (!input || !output || extra.length) return fail('Pass the report to rescore and a new path to write.');

	const judgeEffort = values['judge-effort'] as ReasoningEffort | undefined;

	if (judgeEffort && !REASONING_EFFORTS.includes(judgeEffort))
		return fail(`--judge-effort is one of ${REASONING_EFFORTS.join(', ')}.`);

	return { input, output, options: { judge: values.judge, judgeEffort, dataset: values.dataset } };
}

if (import.meta.main) {
	const { input, output, options } = parseOptions();

	try {
		const { report, notes } = await rescoreFile(input, output, options);

		printBenchmark(report);
		console.log(['', ...notes, `Report: ${resolve(output)}`].join('\n'));
		process.exit(0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
