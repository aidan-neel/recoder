import type { BarRow, LegendItem, StackRow } from '$lib/charts/types';
import { seriesColor } from '$lib/charts/series';
import { categoryLabel, kindLabel, recallRows } from './bars';
import { classSegments, prTotals } from './detail';
import { shortDate } from './stats';
import type { BenchmarkReport, ReportEntry, Totals } from './types';

/** Two to four reports side by side, built on the server. */
export interface CompareView {
	entries: ReportEntry[];
	/** One series per report, colored by pick order. */
	legend: LegendItem[];
	kinds: BarRow[];
	categories: BarRow[];
	codebases: BarRow[];
	prs: BarRow[];
	classes: StackRow[];
	warnings: string[];
}

/** A report's name in legends: its reviewer and when it started. */
function seriesLabel(entry: ReportEntry): string {
	return `${entry.config.reviewer} · ${shortDate(entry.startedAt)}`;
}

function byPr(report: BenchmarkReport): Record<string, Totals> {
	return Object.fromEntries(
		report.prs.flatMap((pr) => {
			const totals = pr.defects.length ? prTotals(pr) : undefined;

			return totals ? [[pr.id, totals]] : [];
		})
	);
}

/** Reasons the scores may not compare: another dataset or PR set, another judge, or too few runs. */
function warnings(entries: ReportEntry[]): string[] {
	const out: string[] = [];
	const prSets = new Set(entries.map((entry) => `${entry.dataset}:${entry.prIds.toSorted().join(',')}`));

	if (prSets.size > 1)
		out.push('The reports cover different PRs, so their totals do not compare. Read the per-PR rows.');
	if (new Set(entries.map((entry) => entry.config.judge)).size > 1) out.push('The reports use different judges.');
	if (entries.some((entry) => entry.runsPerPr < 3))
		out.push('A report has fewer than three runs a PR. A gap of a few points can be noise.');

	return out;
}

export function compareView(reports: { report: BenchmarkReport; entry: ReportEntry }[]): CompareView {
	const entries = reports.map((item) => item.entry);
	const summaries = reports.map((item) => item.report.summary);

	return {
		entries,
		legend: entries.map((entry, index) => ({ label: seriesLabel(entry), color: seriesColor(index) })),
		kinds: recallRows(
			summaries.map((summary) => summary.byKind),
			kindLabel
		),
		categories: recallRows(
			summaries.map((summary) => summary.byCategory),
			categoryLabel
		),
		codebases: recallRows(summaries.map((summary) => summary.byCodebase)),
		prs: recallRows(reports.map((item) => byPr(item.report))),
		classes: reports.flatMap(({ report, entry }) => {
			const segments = classSegments(report);

			return segments?.some((segment) => segment.value)
				? [{ key: entry.key, label: seriesLabel(entry), segments }]
				: [];
		}),
		warnings: warnings(entries)
	};
}
