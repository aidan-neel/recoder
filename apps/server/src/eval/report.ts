import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serverDataDir } from '../util/data-dir';
import type { ObligationReport, ReviewFunnel } from '@recoder/shared';
import type { HarnessRecord } from './harness-tree';
import type { ConsistencyMetrics, EvalFinding, RankedFinding, StabilityMetrics } from './metrics';

/** How one run ended. Only `passed` runs count toward the metrics. */
export type RunOutcome = 'passed' | 'failed' | 'cancelled' | 'timeout';

export interface RunRecord {
	index: number;
	reviewId: string;
	outcome: RunOutcome;
	headSha: string;
	durationMs: number;
	/** The review summary, which says why a run that did not pass stopped. */
	summary: string | null;
	findings: EvalFinding[];
	/** The ids of `findings`, in the same order, so a finding can be matched to its candidate; absent from reports older than recording them. */
	findingIds?: string[];
	/** Unproven candidates the review hid, when its summary states the number. */
	hidden: number | null;
	/** The hidden candidates themselves; absent from reports and servers older than storing them. */
	unconfirmed?: EvalFinding[];
	/** Where the review's candidates went; absent from servers older than counting them. */
	funnel?: ReviewFunnel;
	/** Candidates before verification and merging, from the stored progress; null when unreadable. */
	candidates: number | null;
	/** Baseline checks the review took from an earlier review of the same commit instead of running; absent from servers older than the cache. */
	cachedChecks?: number;
	/** The "Testing the tests" task: its status, message (counts or skip reason) and time; absent when the review had none or the report predates it. */
	matrix?: { status: string; message: string; elapsedMs: number | null };
	/** Obligations derived and every investigation's answer, unresolved ones included; absent unless the server ran with `RECODER_OBLIGATIONS=1`. */
	obligations?: ObligationReport;
}

export interface StabilityReport {
	repo: { id: string; name: string };
	prNumber: number;
	base: string;
	requestedRuns: number;
	startedAt: string;
	finishedAt: string;
	/** The harness code the runs used; absent outside a git checkout and from reports older than recording it. */
	harness?: HarnessRecord;
	/** Distinct PR heads the runs reviewed. More than one means the PR moved and runs are not comparable. */
	headShas: string[];
	runs: RunRecord[];
	/** Over the passed runs only; null when none passed. */
	metrics: StabilityMetrics | null;
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

const minutes = (ms: number) =>
	`${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;

function consistencyLine(label: string, metrics: ConsistencyMetrics): string {
	return `${label.padEnd(30)} union ${String(metrics.union).padStart(3)} · mean stability ${percent(metrics.meanStability).padStart(4)} · in every run ${percent(metrics.everyRunShare).padStart(4)} · mean Jaccard ${metrics.meanJaccard.toFixed(2)}`;
}

function runLine(run: RunRecord, metrics: StabilityMetrics | null, passedIndex: number): string {
	const cached = run.cachedChecks ? ` · ${run.cachedChecks} cached checks` : '';
	const head = `  #${run.index} ${run.outcome.padEnd(9)} ${minutes(run.durationMs).padStart(7)}  ${run.reviewId}${cached}`;
	const counts = run.outcome === 'passed' ? metrics?.perRun[passedIndex] : undefined;

	if (!counts) return `${head}  ${run.summary?.split('\n')[0]?.slice(0, 100) ?? ''}`;

	const hidden = run.hidden === null ? '' : `, ${run.hidden} hidden`;
	const unfingerprinted = counts.unfingerprinted ? `, ${counts.unfingerprinted} without fingerprint` : '';

	return `${head}  ${counts.findings} findings (${counts.bugs} bug, ${counts.quality} quality${hidden}${unfingerprinted})`;
}

function findingLine(ranked: RankedFinding, runs: number): string {
	const { finding } = ranked;
	const location = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
	const tag = finding.ruleId ?? finding.smell ?? finding.category ?? '';

	return `  ${`${ranked.appearances}/${runs}`.padStart(5)}  ${finding.severity.padEnd(7)} ${tag.padEnd(18)} ${location.padEnd(40)} ${finding.title ?? ''}`;
}

function findingSection(title: string, findings: RankedFinding[], runs: number): string[] {
	if (!findings.length) return [];

	return ['', `${title} (${findings.length})`, ...findings.map((ranked) => findingLine(ranked, runs))];
}

/** The report as console lines: headline metrics, each run, then stable and flaky findings. */
function reportLines(report: StabilityReport): string[] {
	const { metrics } = report;
	const passed = report.runs.filter((run) => run.outcome === 'passed').length;
	let passedIndex = -1;

	const lines = [
		'',
		`Stability of ${report.repo.name} #${report.prNumber}: ${report.runs.length} of ${report.requestedRuns} runs, ${passed} passed`
	];

	if (report.headShas.length > 1) {
		lines.push(`WARNING: the PR head moved between runs (${report.headShas.join(', ')}); runs are not comparable.`);
	}

	if (metrics) {
		lines.push(
			'',
			consistencyLine('By fingerprint', metrics.strict),
			consistencyLine('By file + category + symbol', metrics.loose)
		);
	}

	lines.push('', 'Runs');

	for (const run of report.runs) {
		if (run.outcome === 'passed') passedIndex++;
		lines.push(runLine(run, metrics, passedIndex));
	}

	if (metrics) {
		const stable = metrics.findings.filter((ranked) => ranked.appearances === metrics.runs);
		const flaky = metrics.findings.filter((ranked) => ranked.appearances < metrics.runs);

		lines.push(
			...findingSection('Stable findings, in every run', stable, metrics.runs),
			...findingSection('Flaky findings', flaky, metrics.runs)
		);
	}

	return lines;
}

export function printReport(report: StabilityReport): void {
	console.log(reportLines(report).join('\n'));
}

/** Writes an eval report as `<name>-<start time>.json` under the server data dir's `evals/` and returns its path. */
export function writeEvalFile(name: string, startedAt: string, report: unknown): string {
	const dir = join(serverDataDir(), 'evals');
	const path = join(dir, `${name.replace(/[^\w.-]+/g, '-')}-${startedAt.replace(/[:.]/g, '-')}.json`);

	mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`);

	return path;
}

export function writeReport(report: StabilityReport): string {
	return writeEvalFile(`stability-${report.repo.name}-${report.prNumber}`, report.startedAt, report);
}
