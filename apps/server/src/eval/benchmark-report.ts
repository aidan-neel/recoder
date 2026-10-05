import { readFileSync } from 'node:fs';
import type { ModelSettings, ReviewFunnel, SubagentCap } from '@recoder/shared';
import { recall, type BenchmarkSummary, type LabeledDefect, type PrScore, type Totals } from './benchmark-score';
import { labelLines, percent } from './benchmark-labels-report';
import { countClasses, type LabeledRun } from './benchmark-labels';
import type { LowTotals } from './benchmark-lows';
import type { DefectStage, PoolCandidate, StageTotals } from './benchmark-stages';
import type { HarnessRecord } from './harness-tree';
import type { ConsistencyMetrics } from './metrics';
import type { RunRecord } from './report';

/** One PR's runs, each scored against its labels when it passed. */
export interface PrResult {
	id: string;
	codebase: string;
	pull: number;
	verified: boolean;
	defects: LabeledDefect[];
	/** No planted defect: the PR only measures what a review publishes wrongly. */
	control: boolean;
	/** A run reviewed a different head than the labels describe, so its line numbers may not match. */
	staleHead: boolean;
	/** How much the passed runs' findings agree, by fingerprint and by file, category and symbol; null under two passed runs. */
	agreement: { strict: ConsistencyMetrics; loose: ConsistencyMetrics } | null;
	/** A failed run, or one the judge failed on, has no score. */
	runs: ScoredRun[];
}

/**
 * A run scored by the judge, or unscored when it failed or the judge did.
 * `hiddenScore` judges the candidates the review hid against the same defects.
 */
export type ScoredRun = RunRecord & {
	score: PrScore | null;
	hiddenScore?: PrScore | null;
	/** Every candidate the review raised, with the stage that stopped it; absent when the server could not list them. */
	pool?: PoolCandidate[];
	/** How far each planted defect got, by id; absent with `pool`. */
	stages?: Record<string, DefectStage>;
	/** The run's shown findings that were below the reporting bar, by why each was published; absent with `pool`. */
	lows?: LowTotals;
	/** What each of the run's findings is, by the dataset's adjudications at the time of the report. */
	labeled?: LabeledRun;
	judgeError?: string;
};

/** The model that matched findings to defects. Scores from different judges don't compare. */
export interface JudgeModel {
	model: string;
	provider: string;
	effort: string | null;
}

/** The reviewer settings the server ran with. Scores from different reviewers don't compare. */
export interface ReviewerManifest {
	model: string;
	effort: string | null;
	/** The second model, for subagents and verifiers; null when it follows the review model. */
	specialistModel: string | null;
	specialistEffort: string | null;
	subagentCap: SubagentCap;
	reportLowSeverity: boolean;
}

/** A server's settings as the manifest a report keeps; the API key and its preview stay out. */
export function reviewerManifest(settings: ModelSettings): ReviewerManifest {
	const named = (id: string | null | undefined) => settings.models.find((entry) => entry.id === id)?.model ?? null;

	return {
		model: named(settings.orchestratorModelId ?? settings.sharedModelId) ?? settings.model,
		effort: settings.orchestratorEffort ?? null,
		specialistModel: named(settings.specialistModelId),
		specialistEffort: settings.specialistEffort ?? null,
		subagentCap: settings.subagentCap,
		reportLowSeverity: settings.reportLowSeverity
	};
}

export interface BenchmarkReport {
	dataset: string;
	base: string;
	runsPerPr: number;
	judge: JudgeModel;
	/** Absent from reports older than recording it. */
	reviewer?: ReviewerManifest;
	/** The harness code the report was made with; absent from reports older than recording it. */
	harness?: HarnessRecord;
	startedAt: string;
	finishedAt: string;
	prs: PrResult[];
	summary: BenchmarkSummary;
}

/** A saved benchmark report. */
export function readReport(path: string): BenchmarkReport {
	return JSON.parse(readFileSync(path, 'utf8')) as BenchmarkReport;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Mean over PRs of how alike their runs' finding sets are; nothing with one run a PR. */
function agreementLines(prs: PrResult[]): string[] {
	const agreed = prs.flatMap((pr) => (pr.agreement ? [pr.agreement] : []));

	if (!agreed.length) return [];

	const line = (label: string, key: 'strict' | 'loose') =>
		`  ${label.padEnd(18)} runs agree ${percent(mean(agreed.map((item) => item[key].meanJaccard)))} (Jaccard) · in every run ${percent(mean(agreed.map((item) => item[key].everyRunShare)))} of findings`;

	return ['', 'Findings across runs', line('by fingerprint', 'strict'), line('by file+category', 'loose')];
}

function totalsLine(label: string, totals: Totals): string {
	return `  ${label.padEnd(18)} recall ${percent(recall(totals))} (${totals.found}/${totals.planted})`;
}

/** How many hidden candidates reported a planted defect, and how many of those the shown findings missed. */
function hiddenLines({ candidates, matched, lost }: BenchmarkSummary['hidden']): string[] {
	if (!candidates) return [];

	return [
		'',
		'Hidden by verification',
		`  ${candidates} candidates · ${matched} report a planted defect · ${lost} of those missing from the shown findings`
	];
}

/** How many planted defects some candidate reported, a verifier proved, and a shown finding reported, and what stopped the rest. */
function stageLines(stages: StageTotals | undefined): string[] {
	if (!stages) return [];

	const share = (count: number) =>
		`${percent(stages.planted ? count / stages.planted : 0)} (${count}/${stages.planted})`;

	const stopped = Object.entries(stages.stoppedAt)
		.sort(([, a], [, b]) => b - a)
		.map(([stage, count]) => `${stage} ${count}`)
		.join(' · ');

	return [
		'',
		'Recall by stage',
		`  found ${share(stages.found)} · verified ${share(stages.verified)} · published ${share(stages.published)}`,
		...(stopped ? [`  found but not published, by the stage that stopped it: ${stopped}`] : [])
	];
}

/** Findings below the reporting bar that were published anyway, by reason, with how the judge scored them. */
function lowLines(lows: LowTotals | undefined): string[] {
	if (!lows) return [];

	return [
		'',
		'Published below the bar',
		...Object.entries(lows).map(
			([reason, tally]) =>
				`  ${reason.padEnd(11)} ${tally.published} published · ${tally.matched} report a planted defect · ${tally.duplicates} duplicate a found defect · ${tally.unlabeled} unlabeled`
		)
	];
}

/** Defects a run found but did not publish, with the stage and reason that stopped their best candidate. */
function stoppedLines(prs: PrResult[]): string[] {
	const stopped = prs.flatMap((pr) =>
		pr.runs.flatMap((run) =>
			pr.defects.flatMap((defect) => {
				const stage = run.stages?.[defect.id];

				if (!stage?.stoppedAt) return [];

				return [
					`  ${`${pr.id}/${defect.id}`.padEnd(14)} run ${run.index} ${stage.stoppedAt.padEnd(13)} ${stage.reason ?? ''}`
				];
			})
		)
	);

	return stopped.length ? ['', `Found but not published (${stopped.length})`, ...stopped] : [];
}

/** Every run's candidates summed by where they went, for runs whose server counted them. */
function funnelLines(prs: PrResult[]): string[] {
	const funnels = prs.flatMap((pr) => pr.runs.flatMap((run) => (run.funnel ? [run.funnel] : [])));

	if (!funnels.length) return [];

	const sum = (pick: (funnel: ReviewFunnel) => number) => funnels.reduce((total, funnel) => total + pick(funnel), 0);

	const dropped = (['location', 'evidence', 'category', 'severity', 'dismissed', 'refuted', 'covered'] as const)
		.map((stage) => `${stage} ${sum((funnel) => funnel.dropped[stage] ?? 0)}`)
		.join(' · ');

	return [
		'',
		`Funnel (${funnels.length} runs)`,
		`  raised ${sum((funnel) => funnel.raised)} · verified ${sum((funnel) => funnel.verified)} · unproven ${sum((funnel) => funnel.unproven)} · shown after merging ${sum((funnel) => funnel.shown)}`,
		`  dropped: ${dropped}`
	];
}

/** "Reviewer gpt (high) · second model x (low) · subagent cap 8 · medium and above". */
function reviewerLine(reviewer: ReviewerManifest | undefined): string[] {
	if (!reviewer) return [];

	const second = reviewer.specialistModel
		? `${reviewer.specialistModel}${reviewer.specialistEffort ? ` (${reviewer.specialistEffort})` : ''}`
		: 'same model';

	return [
		`Reviewer ${reviewer.model}${reviewer.effort ? ` (${reviewer.effort})` : ''} · second model ${second} · subagent cap ${reviewer.subagentCap} · ${reviewer.reportLowSeverity ? 'all severities' : 'medium and above'}`
	];
}

function groupLines(title: string, groups: Record<string, Totals>): string[] {
	const keys = Object.keys(groups).sort();

	return ['', title, ...keys.map((key) => totalsLine(key, groups[key]!))];
}

/** "4·3·2": defects found, verified and published in one run. */
function stageCounts(stages: Record<string, DefectStage>): string {
	const all = Object.values(stages);

	return [
		all.filter((stage) => stage.found),
		all.filter((stage) => stage.verified),
		all.filter((stage) => stage.published)
	]
		.map((reached) => reached.length)
		.join('·');
}

/** "2/5": findings adjudicated false, over findings still unresolved. */
function noiseOf(labeled: LabeledRun | undefined): string {
	if (!labeled) return '-';

	const counts = countClasses(labeled.classes);

	return `${counts.false}/${counts.unresolved}`;
}

function prLine(pr: PrResult): string {
	const scored = pr.runs.filter((run) => run.score);

	const found = pr.control
		? 'control'
		: scored.map((run) => `${Object.keys(run.score!.found).length}/${pr.defects.length}`).join(' ');

	const noise = scored.map((run) => noiseOf(run.labeled)).join(' ');
	const staged = scored.flatMap((run) => (run.stages ? [stageCounts(run.stages)] : [])).join(' ');
	const failed = pr.runs.filter((run) => !run.score).map((run) => (run.judgeError ? 'judge failed' : run.outcome));
	const flags = [pr.verified ? '' : 'unverified', pr.staleHead ? 'STALE HEAD' : '', ...failed].filter(Boolean);
	const agree = pr.agreement ? `agree ${percent(pr.agreement.strict.meanJaccard)}` : '';

	return `  ${pr.id.padEnd(10)} #${String(pr.pull).padEnd(5)} ${agree.padEnd(10)} found ${found.padEnd(12)} false/? ${noise.padEnd(8)} stages ${staged.padEnd(8)} ${flags.join(', ')}`;
}

/** Defects some run missed, with how many runs found them, to read against the review's findings. */
function missedLines(prs: PrResult[]): string[] {
	const missed = prs.flatMap((pr) => {
		const scored = pr.runs.filter((run) => run.score);

		return pr.defects
			.map((defect) => ({ defect, hits: scored.filter((run) => defect.id in run.score!.found).length }))
			.filter(({ hits }) => hits < scored.length)
			.map(
				({ defect, hits }) =>
					`  ${`${pr.id}/${defect.id}`.padEnd(14)} found ${`${hits}/${scored.length}`.padEnd(6)} ${defect.kind.padEnd(8)} ${defect.category.padEnd(18)} ${`${defect.file}:${defect.line}`.padEnd(48)} ${defect.title}`
			);
	});

	return missed.length ? ['', `Missed in at least one run (${missed.length})`, ...missed] : [];
}

export function printBenchmark(report: BenchmarkReport): void {
	const { summary } = report;

	const stability =
		summary.defectStability === null
			? []
			: [`  found in every run ${percent(summary.defectStability)} of defects found at all`];

	console.log(
		[
			'',
			`Benchmark ${report.dataset}: ${report.prs.length} PRs × ${report.runsPerPr} runs`,
			`Judge ${report.judge.model} (${report.judge.provider}${report.judge.effort ? `, ${report.judge.effort}` : ''})`,
			...reviewerLine(report.reviewer),
			'Precision is an interval: unresolved findings are not counted wrong until a human labels them in adjudications.json.',
			'',
			'PRs',
			...report.prs.map(prLine),
			'',
			'Overall',
			totalsLine('all', summary.overall),
			...stability,
			...agreementLines(report.prs),
			...labelLines(summary.labels),
			...hiddenLines(summary.hidden),
			...stageLines(summary.stages),
			...lowLines(summary.lows),
			...funnelLines(report.prs),
			...groupLines('By codebase', summary.byCodebase),
			...groupLines('By kind', summary.byKind),
			...groupLines('By category', summary.byCategory),
			...missedLines(report.prs),
			...stoppedLines(report.prs)
		].join('\n')
	);
}
