import type { TipRow } from '$lib/charts/tip';
import type { BarRow, CellStage, DefectGroup, LegendItem, Segment, StackRow, XyPoint } from '$lib/charts/types';
import { seriesColor } from '$lib/charts/series';
import { categoryLabel, kindLabel, recallBar, recallRows } from './bars';
import { allRuns, minutes, percent } from './stats';
import type { BenchmarkReport, LabeledDefect, PrResult, ReportEntry, ScoredRun, Totals } from './types';

/** A planted defect that at least one scored run missed. */
interface MissedDefect {
	pr: string;
	id: string;
	kind: string;
	category: string;
	title: string;
	where: string;
	/** Scored runs that published it, of `scored`. */
	found: number;
	scored: number;
	/** Where its best candidate stopped in a run that missed it, when the run kept its candidates. */
	stoppedAt: string | null;
	reason: string | null;
}

/** A run that did not pass, or that the judge could not score. */
interface FailedRun {
	pr: string;
	run: number;
	outcome: string;
	minutes: string;
	why: string;
}

/** Everything the report page draws, built on the server so the page gets chart data, not the report. */
export interface ReportView {
	entry: ReportEntry;
	base: string;
	finished: boolean;
	kinds: BarRow[];
	categories: BarRow[];
	codebases: BarRow[];
	prs: BarRow[];
	prExtra: [string, TipRow[]][];
	defects: DefectGroup[];
	runs: number;
	stages: BarRow[] | null;
	stoppedAt: BarRow[];
	classes: StackRow[];
	funnel: BarRow[];
	durations: { categories: string[]; points: XyPoint[] };
	hidden: { candidates: number; matched: number; lost: number };
	missed: MissedDefect[];
	failed: FailedRun[];
	controls: { prs: number; runs: number; wrong: number; possiblyWrong: number };
}

/** The defect grid's legend; its colors match `.defect-cell` in charts.css. */
export const STAGE_LEGEND: LegendItem[] = [
	{ label: 'Published', color: 'var(--series-1)' },
	{ label: 'Verified', color: 'color-mix(in oklab, var(--series-1) 62%, var(--bg-panel))' },
	{ label: 'Raised', color: 'color-mix(in oklab, var(--series-1) 30%, var(--bg-panel))' },
	{ label: 'Missed', color: 'var(--text-faint)', shape: 'ring' }
];

const CLASS_LABELS: [string, string][] = [
	['planted', 'Planted defect'],
	['additional', 'Other real issue'],
	['unresolved', 'Not adjudicated'],
	['duplicate', 'Duplicate'],
	['false', 'False positive']
];

/** Where a found defect's best candidate stopped, in words. */
const STOP_LABELS: Record<string, string> = {
	location: 'Bad location',
	evidence: 'No evidence',
	category: 'Category',
	severity: 'Severity bar',
	dismissed: 'Dismissed',
	refuted: 'Refuted',
	covered: 'Covered by another',
	unproven: 'Unproven, hidden',
	consolidation: 'Lost in merge'
};

function stageOf(run: ScoredRun, defect: LabeledDefect): CellStage {
	if (run.outcome !== 'passed' || !run.score) return 'none';

	const stage = run.stages?.[defect.id];

	if (stage) return stage.published ? 'published' : stage.verified ? 'verified' : stage.found ? 'found' : 'missed';

	return run.score.found[defect.id] !== undefined ? 'published' : 'missed';
}

function cellRows(run: ScoredRun, defect: LabeledDefect): TipRow[] {
	const stage = run.stages?.[defect.id];
	const reason = stage?.reason ?? run.score?.reasons[defect.id];

	return [
		...(stage?.stoppedAt ? [{ label: 'Stopped at', value: STOP_LABELS[stage.stoppedAt] ?? stage.stoppedAt }] : []),
		...(reason ? [{ label: 'Judge', value: reason.length > 140 ? `${reason.slice(0, 139)}…` : reason }] : [])
	];
}

function defectGroups(prs: PrResult[]): DefectGroup[] {
	return prs
		.filter((pr) => pr.defects.length)
		.map((pr) => ({
			pr: pr.id,
			defects: pr.defects.map((defect) => ({
				id: `${pr.id}/${defect.id}`,
				title: defect.title,
				sub: defect.kind === 'bug' ? 'bug' : 'qual',
				cells: pr.runs.map((run) => ({ stage: stageOf(run, defect), rows: cellRows(run, defect) }))
			}))
		}));
}

function missedDefects(prs: PrResult[]): MissedDefect[] {
	return prs.flatMap((pr) => {
		const scored = pr.runs.filter((run) => run.outcome === 'passed' && run.score);

		return pr.defects.flatMap((defect) => {
			const found = scored.filter((run) => run.score!.found[defect.id] !== undefined).length;
			const miss = scored.find((run) => run.score!.found[defect.id] === undefined);

			if (!miss) return [];

			const stage = miss.stages?.[defect.id];

			return [
				{
					pr: pr.id,
					id: defect.id,
					kind: kindLabel(defect.kind),
					category: categoryLabel(defect.category),
					title: defect.title,
					where: `${defect.file}:${defect.line}`,
					found,
					scored: scored.length,
					stoppedAt: stage
						? stage.found
							? (STOP_LABELS[stage.stoppedAt ?? ''] ?? stage.stoppedAt ?? null)
							: 'Never raised'
						: null,
					reason: stage?.reason ?? miss.score!.reasons[defect.id] ?? null
				}
			];
		});
	});
}

/** A PR's recall summed over its scored runs; undefined before any run is scored. */
export function prTotals(pr: PrResult): Totals | undefined {
	const scored = pr.runs.filter((run) => run.outcome === 'passed' && run.score);
	const found = scored.reduce((sum, run) => sum + Object.keys(run.score!.found).length, 0);

	return scored.length ? { found, planted: pr.defects.length * scored.length } : undefined;
}

function prRows(prs: PrResult[]): { rows: BarRow[]; extra: [string, TipRow[]][] } {
	const rows: BarRow[] = [];
	const extra: [string, TipRow[]][] = [];

	for (const pr of prs.filter((item) => item.defects.length)) {
		const scored = pr.runs.filter((run) => run.outcome === 'passed' && run.score);
		const findings = scored.reduce((sum, run) => sum + run.findings.length, 0);
		const passedMs = pr.runs.filter((run) => run.outcome === 'passed').map((run) => run.durationMs);

		rows.push({
			key: pr.id,
			label: pr.id,
			sub: pr.staleHead ? 'stale head' : undefined,
			values: [recallBar(prTotals(pr))]
		});

		extra.push([
			pr.id,
			[
				{ label: 'Runs scored', value: `${scored.length}/${pr.runs.length}` },
				{ label: 'Findings per run', value: scored.length ? (findings / scored.length).toFixed(1) : '–' },
				{
					label: 'Mean time',
					value: passedMs.length ? minutes(passedMs.reduce((a, b) => a + b, 0) / passedMs.length) : '–'
				},
				...(pr.agreement ? [{ label: 'Agreement', value: percent(pr.agreement.loose.meanJaccard) }] : [])
			]
		]);
	}

	return { rows, extra };
}

function stageRows(report: BenchmarkReport): BarRow[] | null {
	const stages = report.summary.stages;

	if (!stages?.planted) return null;

	return (['found', 'verified', 'published'] as const).map((key) => ({
		key,
		label: key === 'found' ? 'Raised' : key === 'verified' ? 'Verified' : 'Published',
		values: [recallBar({ found: stages[key], planted: stages.planted })]
	}));
}

function stoppedRows(report: BenchmarkReport): BarRow[] {
	const stopped = report.summary.stages?.stoppedAt ?? {};
	const total = Object.values(stopped).reduce((sum, value) => sum + value, 0);

	return Object.entries(stopped)
		.toSorted(([, a], [, b]) => b - a)
		.map(([key, value]) => ({
			key,
			label: STOP_LABELS[key] ?? categoryLabel(key),
			values: [{ value: total ? value / total : 0, text: String(value), detail: percent(total ? value / total : null) }]
		}));
}

/** The judge's finding classes as stacked-bar segments, or null when the report has no labels. */
export function classSegments(report: BenchmarkReport): Segment[] | null {
	const counts = report.summary.labels?.overall.counts;

	if (!counts) return null;

	return CLASS_LABELS.map(([key, label], index) => ({
		key,
		label,
		value: counts[key as keyof typeof counts] ?? 0,
		color: seriesColor(index)
	}));
}

function classRows(report: BenchmarkReport): StackRow[] {
	const segments = classSegments(report);

	return segments ? [{ key: 'all', label: 'All findings', segments }] : [];
}

/** The review funnel summed over passed runs: candidates raised, then how many survived each step. */
function funnelRows(runs: ScoredRun[]): BarRow[] {
	const funnels = runs.flatMap((run) => (run.outcome === 'passed' && run.funnel ? [run.funnel] : []));

	if (!funnels.length) return [];

	const raised = funnels.reduce((sum, funnel) => sum + funnel.raised, 0);

	const sum = (pick: (funnel: (typeof funnels)[number]) => number) =>
		funnels.reduce((total, funnel) => total + pick(funnel), 0);

	const steps: [string, number][] = [
		['Raised', raised],
		['Verified', sum((funnel) => funnel.verified)],
		['Unproven, hidden', sum((funnel) => funnel.unproven)],
		['Shown', sum((funnel) => funnel.shown)]
	];

	return steps.map(([label, value]) => ({
		key: label,
		label,
		values: [{ value: raised ? value / raised : 0, text: (value / funnels.length).toFixed(1), detail: 'a run' }]
	}));
}

function durationPoints(prs: PrResult[]): { categories: string[]; points: XyPoint[] } {
	const categories = prs.map((pr) => pr.id);

	const points = prs.flatMap((pr, row) =>
		pr.runs.map((run): XyPoint => ({
			x: run.durationMs / 60_000,
			y: row,
			series: run.outcome === 'passed' ? 'passed' : 'other',
			color: run.outcome === 'passed' ? 'var(--series-1)' : 'var(--danger)',
			hollow: run.outcome !== 'passed',
			title: `${pr.id} · run ${run.index + 1}`,
			rows: [
				{ label: 'Outcome', value: run.outcome },
				{ label: 'Time', value: minutes(run.durationMs) },
				{ label: 'Findings', value: String(run.findings.length) },
				...(run.score ? [{ label: 'Found', value: `${Object.keys(run.score.found).length}/${pr.defects.length}` }] : [])
			]
		}))
	);

	return { categories, points };
}

function failedRuns(prs: PrResult[]): FailedRun[] {
	return prs.flatMap((pr) =>
		pr.runs
			.filter((run) => run.outcome !== 'passed' || !run.score)
			.map((run) => ({
				pr: pr.id,
				run: run.index + 1,
				outcome: run.outcome === 'passed' ? 'not scored' : run.outcome,
				minutes: minutes(run.durationMs),
				why: (run.judgeError ?? run.summary ?? '').slice(0, 300)
			}))
	);
}

/** Builds the report page's charts and tables. */
export function reportView(report: BenchmarkReport, entry: ReportEntry): ReportView {
	const { rows, extra } = prRows(report.prs);
	const summary = report.summary;

	return {
		entry,
		base: report.base,
		finished: entry.runsPassed + entry.runsFailed >= entry.runsExpected,
		kinds: recallRows([summary.byKind], kindLabel),
		categories: recallRows([summary.byCategory], categoryLabel),
		codebases: recallRows([summary.byCodebase]),
		prs: rows,
		prExtra: extra,
		defects: defectGroups(report.prs),
		runs: report.runsPerPr,
		stages: stageRows(report),
		stoppedAt: stoppedRows(report),
		classes: classRows(report),
		funnel: funnelRows(allRuns(report)),
		durations: durationPoints(report.prs),
		hidden: summary.hidden,
		missed: missedDefects(report.prs),
		failed: failedRuns(report.prs),
		controls: summary.labels?.control ?? { prs: 0, runs: 0, wrong: 0, possiblyWrong: 0 }
	};
}
